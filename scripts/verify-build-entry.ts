// verify-build 内层：在 vite-node 下运行浏览器同一份生成逻辑，输出工程到临时目录。
// 由 scripts/verify-build.mjs 调用：npx vite-node scripts/verify-build-entry.ts -- --chip CH32V003F4P6 --out <dir>
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateProject } from '@/model/codegen'
import { getDeviceData } from '@/model/device'
import { defaultClock, presetToConfig } from '@/model/clock'
import { DEFAULT_BLE_CONFIG } from '@/model/types'
import type { PinAssignment, ProjectConfig } from '@/model/types'
import { HAL_REV } from '@/model/codegen/halRev'
import { clockMatrix } from './clock-matrix'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function argOf(name: string, fallback: string): string {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const chip = argOf('--chip', 'CH32V003F4P6')
const out = argOf('--out', '')
const embassy = process.argv.includes('--embassy')
// --ble：ch58x / ch5xx 后端（各自 BLE 路径），其它后端直接报错退出（诚实失败而非静默忽略）
const ble = process.argv.includes('--ble')
const clock32k = argOf('--clock32k', 'lse') === 'lsi' ? 'lsi' : 'lse'
const halDir = process.env.CH32_HAL_DIR ?? ''
// ch58x-hal / ch5xx-hal 后端用各自 rev 常量（config.hal.rev 不适用）
const ch58xHalDir = process.env.CH58X_HAL_DIR ?? path.resolve(root, '../reference/ch58x-hal')
const ch5xxHalDir = process.env.CH5XX_HAL_DIR ?? path.resolve(root, '../reference/ch5xx-hal')
// ch5xx-hal 的 build.rs 读取 ../ch5xx-data/data（兄弟目录）；vendor 树需一并复制
const ch5xxDataDir = process.env.CH5XX_DATA_DIR ?? path.resolve(path.dirname(ch5xxHalDir), 'ch5xx-data')
const ch5xxBleDir = process.env.CH5XX_BLE_DIR ?? path.resolve(root, 'vendor-src/ch5xx-ble')
const halRev = process.env.CH32_HAL_REV ?? HAL_REV

if (!out) {
  console.error('缺少 --out 参数')
  process.exit(1)
}

const data = getDeviceData(chip)
// M17：显式后端（verify-build.mjs 总会传；缺省按芯片数据，CH582 缺省 ch5xx-hal）
const backend = argOf('--hal-backend', data.chip.halBackend ?? 'ch32-hal')
const isCh58x = backend === 'ch58x-hal'
const isCh5xx = backend === 'ch5xx-hal'

if (ble && !isCh58x && !isCh5xx) {
  console.error(`--ble 仅对 ch58x-hal / ch5xx-hal 后端有效（${chip} 选择的是 ${backend}）`)
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

// 时钟：优先第一预设；ch5xx 的 I2C 要求 Fsys 2..36MHz（第一预设常为 60MHz），
// 启用 I2C 时改选 15..36MHz 的预设（32MHz = 480÷15），保证 I2C 模板进入编译验证。
const i2cSafePreset =
  isCh5xx && i2c
    ? data.clock.presets.find((p) => {
        const div = p.match.div
        if (typeof div !== 'number') return false
        const mhz = 480 / div
        return mhz >= 15 && mhz <= 36
      })
    : undefined
const firstPreset = i2cSafePreset ?? data.clock.presets[0]
const defaults = defaultClock(data.clock)
const clock = firstPreset ? presetToConfig(data.clock, firstPreset, defaults) : defaults

const config: ProjectConfig = {
  version: 1,
  chip,
  // 显式写入后端（仅非 ch32）：确保不会落入「历史工程 → legacy」的缺省分支
  ...(backend !== 'ch32-hal' ? { halBackend: backend } : {}),
  projectName: 'verify-build',
  pins,
  naming: { prefix: '' },
  clock,
  peripherals: periState,
  features: { embassy: embassy || ble, debugPrint: true, ...(ble ? { ble: true } : {}) },
  hal: { rev: halRev },
  // --ble：features.ble=true + 缺省 BLE 配置（peripheral / 出厂 MAC / 100ms / FFE0-2）
  ...(ble ? { ble: { ...DEFAULT_BLE_CONFIG, clock32k } } : {}),
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
  } else if (isCh5xx) {
    // ch5xx-hal：git 行 → 本地 path（缺省 ../reference/ch5xx-hal）
    if (f.path === 'Cargo.toml' && fs.existsSync(path.join(ch5xxHalDir, 'Cargo.toml')) && content.includes('ch5xx-hal = { git = ')) {
      content = content.replace(/ch5xx-hal = \{ git = "[^"]+", (?:rev = "[^"]+", )?/, `ch5xx-hal = { path = "${ch5xxHalDir}", `)
    }
  } else if (halDir && f.path === 'Cargo.toml' && content.includes('git = ')) {
    content = content.replace(/ch32-hal = \{ git = "[^"]+", (?:rev = "[^"]+", )?/, `ch32-hal = { path = "${halDir}", `)
  }
  fs.writeFileSync(dest, content)
}

if (process.argv.includes('--clock-matrix')) {
  const clockFile = result.files.find((file) => file.path.endsWith('src/generated/clock.rs'))
  if (!clockFile) throw new Error('时钟矩阵缺少 clock.rs 入口')

  const recipes = new Map<string, string>()
  let rejected = 0
  const cases = clockMatrix(data.clock)
  for (const [index, clock] of cases.entries()) {
    const candidate = generateProject({
      ...config, clock, pins: [], peripherals: {}, features: { embassy: false, debugPrint: false },
    }, data)
    if (candidate.errors.length) {
      if (candidate.errors.some((e) => !e.code.includes('CLOCK'))) {
        throw new Error(`时钟用例 ${index} 遇到非时钟错误：${JSON.stringify(candidate.errors)}`)
      }
      rejected++
      continue
    }
    const rust = candidate.files.find((file) => file.path === clockFile.path)?.content
    if (!rust) throw new Error(`时钟用例 ${index} 未生成 Clock 模块`)
    // 注释中的频率不影响 API 编译，只去重实际配方。
    recipes.set(rust.replace(/^\s*\/\/.*$/gm, '').trim(), rust)
  }

  const clkDir = path.dirname(clockFile.path)
  const probe = path.join(out, clkDir, 'clock_matrix.rs')
  const modules: string[] = []
  for (const [index, rust] of [...recipes.values()].entries()) {
    fs.writeFileSync(path.join(out, clkDir, `clock_case_${index}.rs`), rust)
    modules.push(`#[path = "clock_case_${index}.rs"] mod case_${index};`)
  }

  const adcClock = data.clock.peripheralClocks?.adc
  const raw = adcClock?.clkDiv
  const knob = adcClock?.knob
  const adcCases: ProjectConfig[] = []
  if (raw?.programmable) {
    for (let value = 0; value < 2 ** raw.bits; value++) {
      adcCases.push({ ...config, clock: { ...clock, adcClkDiv: value } })
    }
  } else if (knob && adc && periState[adc.id]) {
    for (const value of adc.params[knob]?.options ?? []) {
      adcCases.push({ ...config, peripherals: {
        ...periState, [adc.id]: { ...periState[adc.id], params: { ...periState[adc.id].params, [knob]: value } },
      } })
    }
  }
  for (const [index, adcCase] of adcCases.entries()) {
    const candidate = generateProject(adcCase, data)
    if (candidate.errors.length) throw new Error(`ADC 时钟用例 ${index}：${JSON.stringify(candidate.errors)}`)
    const adcFile = candidate.files.find((file) => file.path === path.join(clkDir, 'adc.rs'))
    if (!adcFile) throw new Error(`ADC 时钟用例 ${index} 未生成 ADC 模块`)
    fs.writeFileSync(path.join(out, clkDir, `adc_clock_case_${index}.rs`), adcFile.content)
    modules.push(`#[path = "adc_clock_case_${index}.rs"] mod adc_${index};`)
  }
  fs.writeFileSync(probe, modules.join('\n'))
  fs.appendFileSync(path.join(out, clkDir, 'mod.rs'), '\n#[allow(dead_code)] mod clock_matrix;\n')
  console.log(`[verify] 时钟矩阵：${cases.length} 档，${rejected} 拦截，${recipes.size} 个不同 Rust 配方`)
  if (adcCases.length) console.log(`[verify] ADC 采样时钟：${adcCases.length} 档`)
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
} else if (isCh5xx) {
  const cargoText = fs.existsSync(cargoPath) ? fs.readFileSync(cargoPath, 'utf8') : ''
  if (cargoText.includes('path = "vendor/ch5xx-hal"') && fs.existsSync(path.join(ch5xxHalDir, 'Cargo.toml'))) {
    fs.cpSync(ch5xxHalDir, path.join(out, 'vendor/ch5xx-hal'), {
      recursive: true,
      filter: (src) => !src.includes('/.git') && !src.includes('/target'),
    })
    console.log(`[verify] vendor/ch5xx-hal ← ${ch5xxHalDir}`)
    // 兄弟数据目录：HAL build.rs 的硬依赖（../ch5xx-data/data）
    if (fs.existsSync(path.join(ch5xxDataDir, 'data'))) {
      fs.cpSync(ch5xxDataDir, path.join(out, 'vendor/ch5xx-data'), {
        recursive: true,
        filter: (src) => !src.includes('/.git') && !src.includes('/target'),
      })
      console.log(`[verify] vendor/ch5xx-data ← ${ch5xxDataDir}`)
    } else {
      console.error(`[verify] 缺少 ch5xx-data：${ch5xxDataDir}（ch5xx-hal build.rs 会失败）`)
    }
  }
  // BLE shim：Cargo 始终 path 依赖，必须复制（与浏览器导出的 ch5xx-ble.zip 对应）
  if (cargoText.includes('path = "vendor/ch5xx-ble"')) {
    if (fs.existsSync(path.join(ch5xxBleDir, 'Cargo.toml'))) {
      fs.cpSync(ch5xxBleDir, path.join(out, 'vendor/ch5xx-ble'), {
        recursive: true,
        filter: (src) => !src.includes('/.git') && !src.includes('/target'),
      })
      console.log(`[verify] vendor/ch5xx-ble ← ${ch5xxBleDir}`)
    } else {
      console.error(`[verify] 缺少 ch5xx-ble shim：${ch5xxBleDir}（BLE 构建会失败）`)
    }
  }
} else if (halDir && fs.existsSync(cargoPath) && fs.readFileSync(cargoPath, 'utf8').includes('path = "vendor/ch32-hal"')) {
  fs.cpSync(halDir, path.join(out, 'vendor/ch32-hal'), {
    recursive: true,
    filter: (src) => !src.includes('/.git') && !src.includes('/target'),
  })
  console.log(`[verify] vendor/ch32-hal ← ${halDir}`)
}
console.log(`[verify] ${chip}: ${result.files.length} 个文件 → ${out}`)
