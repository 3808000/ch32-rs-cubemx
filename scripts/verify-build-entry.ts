// verify-build 内层：在 vite-node 下运行浏览器同一份生成逻辑，输出工程到临时目录。
// 由 scripts/verify-build.mjs 调用：npx vite-node scripts/verify-build-entry.ts -- --chip CH32V003F4P6 --out <dir>
import fs from 'node:fs'
import path from 'node:path'
import { generateProject } from '../src/lib/codegen/index'
import { getDeviceData } from '../src/data/device'
import { mergeClockConfig } from '../src/lib/clock/index'
import type { PinAssignment, ProjectConfig } from '../src/types'
import { HAL_REV } from '../src/lib/codegen/halRev'

function argOf(name: string, fallback: string): string {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const chip = argOf('--chip', 'CH32V003F4P6')
const out = argOf('--out', '')
const embassy = process.argv.includes('--embassy')
const halDir = process.env.CH32_HAL_DIR ?? ''
const halRev = process.env.CH32_HAL_REV ?? HAL_REV

if (!out) {
  console.error('缺少 --out 参数')
  process.exit(1)
}

const data = getDeviceData(chip)

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

// 时钟：优先第一预设
const firstPreset = data.clock.presets[0]
const pll: Record<string, number> = {}
if (firstPreset) {
  for (const param of data.clock.pll.params) {
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
  features: { embassy, debugPrint: true },
  hal: { rev: halRev },
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
  if (halDir && f.path === 'Cargo.toml' && content.includes('git = ')) {
    content = content.replace(/ch32-hal = \{ git = "[^"]+", (?:rev = "[^"]+", )?/, `ch32-hal = { path = "${halDir}", `)
  }
  fs.writeFileSync(dest, content)
}

// vendor 模式：把完整 HAL 源码复制进 vendor/ch32-hal（与浏览器导出一致）
const cargoPath = path.join(out, 'Cargo.toml')
if (halDir && fs.existsSync(cargoPath) && fs.readFileSync(cargoPath, 'utf8').includes('path = "vendor/ch32-hal"')) {
  fs.cpSync(halDir, path.join(out, 'vendor/ch32-hal'), {
    recursive: true,
    filter: (src) => !src.includes('/.git') && !src.includes('/target'),
  })
  console.log(`[verify] vendor/ch32-hal ← ${halDir}`)
}
console.log(`[verify] ${chip}: ${result.files.length} 个文件 → ${out}`)