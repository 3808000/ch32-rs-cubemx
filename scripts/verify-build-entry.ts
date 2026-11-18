// verify-build 内层：在 vite-node 下运行浏览器同一份生成逻辑，输出工程到临时目录。
// 由 scripts/verify-build.mjs 调用：npx vite-node scripts/verify-build-entry.ts -- --chip CH32V003F4P6 --out <dir>
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateProject } from '@/model/codegen'
import { getDeviceData } from '@/model/device'
import { mergeClockConfig } from '@/model/clock'
import { DEFAULT_BLE_CONFIG } from '@/model/types'
import type { PinAssignment, ProjectConfig } from '@/model/types'
import { HAL_REV } from '@/model/codegen/halRev'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function argOf(name: string, fallback: string): string {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const chip = argOf('--chip', 'CH32V003F4P6')
const out = argOf('--out', '')
const embassy = process.argv.includes('--embassy')
// --ble：ch58x 专属（BLE ⇒ embassy，契约 D2），非 ch58x 后端直接报错退出（诚实失败而非静默忽略）
const ble = process.argv.includes('--ble')
const halDir = process.env.CH32_HAL_DIR ?? ''
// ch58x-hal 后端用 CH58X_HAL_REV 常量（config.hal.rev 不适用），本地路径默认 ../reference/ch58x-hal
const ch58xHalDir = process.env.CH58X_HAL_DIR ?? path.resolve(root, '../reference/ch58x-hal')
const halRev = process.env.CH32_HAL_REV ?? HAL_REV

if (!out) {
  console.error('缺少 --out 参数')
  process.exit(1)
}

const data = getDeviceData(chip)
const isCh58x = data.chip.halBackend === 'ch58x-hal'

if (ble && !isCh58x) {
  console.error(`--ble 仅对 ch58x-hal 后端有效（${chip} 的 halBackend=${data.chip.halBackend ?? 'ch32-hal（缺省）'}）`)
  process.exit(2)
}

// ---- 按芯片数据自适应构造测试配置（不写死任何引脚名）----
const ioPins = data.chip.pins.filter((p) => p.type === 'IO' && !p.special) // 排除 NRST/SWD/OSC 等特殊脚
const used = new Set<string>()
const pins: PinAssignment[] = []

// LED 输出：第一个非特殊 IO 引脚
const ledPin = ioPins[0]
if (ledPin) {
  used.add(ledPin.name)
  pins.push({ pin: ledPin.name, label: 'LED_RUN', mode: 'OUTPUT', params: { outputType: 'PUSH_PULL', speed: 'HIGH', level: 'LOW' } })
}

// 按键输入 + EXTI：找一个有 EXTI 通道的非特殊 IO 引脚
const btnPin = ioPins.find((p) => !used.has(p.name) && data.exti.entries.some((e) => e.pin === p.name))
if (btnPin) {
  used.add(btnPin.name)
  pins.push({ pin: btnPin.name, label: 'BUTTON', mode: 'INPUT', params: { pull: 'UP', exti: { enabled: true, edge: 'FALLING' } } })
}

// USART：第一实例第一档 remap（引脚必须在芯片上且未被占用）
const usart = data.peripherals.usart[0]
const periState: ProjectConfig['peripherals'] = {}
if (usart) {
  const r = usart.remaps.find((x) => {
    const names = [x.tx, x.rx].filter(Boolean)
    return names.every((n) => ioPins.some((p) => p.name === n) && !used.has(n))
  })
  if (r) {
    used.add(r.tx)
    used.add(r.rx)
    pins.push({ pin: r.tx, mode: 'AF', function: `${usart.id}_TX`, remap: r.remap, params: {} })
    pins.push({ pin: r.rx, mode: 'AF', function: `${usart.id}_RX`, remap: r.remap, params: {} })
    periState[usart.id] = { enabled: true, params: { baudrate: 115200 }, remap: r.remap }
  }
}

// ADC：第一通道（引脚必须可用且未占用）
const adc = data.peripherals.adc[0]
if (adc) {
  const ch = adc.channels.find((c) => ioPins.some((p) => p.name === c.pin) && !used.has(c.pin))
  if (ch) {
    used.add(ch.pin)
    pins.push({ pin: ch.pin, mode: 'ANALOG', function: ch.channel, params: {} })
    periState[adc.id] = { enabled: true, params: {} }
  }
}

// SPI：第一实例第一档可用 remap（引脚必须在芯片上且未被占用）——M11 起覆盖 SPI 模板的 rustc 验证
const spi = data.peripherals.spi[0]
if (spi) {
  const r = spi.remaps.find((x) => {
    const names = [x.sck, x.mosi, x.miso].filter(Boolean)
    return names.every((n) => ioPins.some((p) => p.name === n) && !used.has(n))
  })
  if (r) {
    for (const [role, pinName] of [['sck', r.sck], ['mosi', r.mosi], ['miso', r.miso]] as const) {
      if (!pinName) continue
      used.add(pinName)
      pins.push({ pin: pinName, mode: 'AF', function: `${spi.id}_${role.toUpperCase()}`, remap: r.remap, params: {} })
    }
    periState[spi.id] = { enabled: true, params: {}, remap: r.remap }
  }
}

// I2C：第一实例第一档可用 remap（同上）
// M14：embassy 档异步 I2C 需要 TX/RX DMA 请求；上游 ch32-data 对个别芯片（如 V103）未定义
// I2C DMA 映射（ch32-hal build.rs 同源，HAL 亦无 TxDma<I2C> impl）→ 该组合上游不支持，
// 自动配置跳过 I2C（产品侧 derive.ts 会对用户显式启用给出 REMAP_UNDEFINED 明确报错）。
const i2cDmaReady = (id: string) =>
  !embassy || ['_TX', '_RX'].every((s) => (data.dma?.requests ?? []).some((r) => r.request === id + s))
const i2c = data.peripherals.i2c[0]
if (i2c && i2cDmaReady(i2c.id)) {
  const r = i2c.remaps.find((x) => {
    const names = [x.scl, x.sda].filter(Boolean)
    return names.every((n) => ioPins.some((p) => p.name === n) && !used.has(n))
  })
  if (r) {
    for (const [role, pinName] of [['scl', r.scl], ['sda', r.sda]] as const) {
      if (!pinName) continue
      used.add(pinName)
      pins.push({ pin: pinName, mode: 'AF', function: `${i2c.id}_${role.toUpperCase()}`, remap: r.remap, params: {} })
    }
    periState[i2c.id] = { enabled: true, params: {}, remap: r.remap }
  }
}

// 时钟：优先第一预设
const firstPreset = data.clock.presets[0]
const pll: Record<string, number> = {}
if (firstPreset) {
  // 无 PLL 芯片（M14，如 X035）clock.pll 缺省：不补 PLL 参数
  for (const param of data.clock.pll?.params ?? []) {
    const v = (firstPreset.match as Record<string, unknown>)[param.key]
    if (typeof v === 'number') pll[param.key] = v
  }
}
const clock = mergeClockConfig(data.clock, {
  source: firstPreset?.match.source ?? 'HSI',
  pllSource: firstPreset?.match.pllSource,
  hxtalMhz: firstPreset?.match.hxtalMhz,
  pll: Object.keys(pll).length ? pll : undefined,
  ahb: firstPreset?.match.ahb ?? data.clock.ahb.default,
  apb1: firstPreset?.match.apb1 ?? data.clock.apb1.default,
  apb2: firstPreset?.match.apb2 ?? data.clock.apb2.default,
})

const config: ProjectConfig = {
  version: 1,
  chip,
  projectName: 'verify-build',
  pins,
  naming: { prefix: '' },
  clock,
  peripherals: periState,
  features: { embassy: embassy || ble, debugPrint: true, ...(ble ? { ble: true } : {}) },
  hal: { rev: halRev },
  // --ble：features.ble=true + 缺省 BLE 配置（peripheral / 出厂 MAC / 100ms / FFE0-2）
  ...(ble ? { ble: DEFAULT_BLE_CONFIG } : {}),
}

const result = generateProject(config, data)
if (result.errors.length > 0) {
  console.error('生成期错误：')
  for (const e of result.errors) console.error(`  [${e.code}] ${e.message}`)
  process.exit(2)
}

fs.mkdirSync(out, { recursive: true })
for (const f of result.files) {
  const dest = path.join(out, f.path)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  let content = f.content
  // 非 vendor 模式（git 依赖）时可用本地 HAL 路径覆盖加速
  if (isCh58x) {
    // ch58x-hal：Cargo.toml 中的 ch58x-hal git 行 → 本地 path（缺省 ../reference/ch58x-hal）
    if (f.path === 'Cargo.toml' && fs.existsSync(path.join(ch58xHalDir, 'Cargo.toml')) && content.includes('ch58x-hal = { git = ')) {
      content = content.replace(/ch58x-hal = \{ git = "[^"]+", (?:rev = "[^"]+", )?/, `ch58x-hal = { path = "${ch58xHalDir}", `)
    }
  } else if (halDir && f.path === 'Cargo.toml' && content.includes('git = ')) {
    content = content.replace(/ch32-hal = \{ git = "[^"]+", (?:rev = "[^"]+", )?/, `ch32-hal = { path = "${halDir}", `)
  }
  fs.writeFileSync(dest, content)
}

// vendor 模式：把完整 HAL 源码复制进 vendor/<hal>（与浏览器导出一致）
const cargoPath = path.join(out, 'Cargo.toml')
if (isCh58x) {
  if (fs.existsSync(cargoPath) && fs.readFileSync(cargoPath, 'utf8').includes('path = "vendor/ch58x-hal"') && fs.existsSync(path.join(ch58xHalDir, 'Cargo.toml'))) {
    fs.cpSync(ch58xHalDir, path.join(out, 'vendor/ch58x-hal'), {
      recursive: true,
      filter: (src) => !src.includes('/.git') && !src.includes('/target'),
    })
    console.log(`[verify] vendor/ch58x-hal ← ${ch58xHalDir}`)
  }
} else if (halDir && fs.existsSync(cargoPath) && fs.readFileSync(cargoPath, 'utf8').includes('path = "vendor/ch32-hal"')) {
  fs.cpSync(halDir, path.join(out, 'vendor/ch32-hal'), {
    recursive: true,
    filter: (src) => !src.includes('/.git') && !src.includes('/target'),
  })
  console.log(`[verify] vendor/ch32-hal ← ${halDir}`)
}
console.log(`[verify] ${chip}: ${result.files.length} 个文件 → ${out}`)