#!/usr/bin/env node
// 器件数据校验（CI 必过）：npm run validate:device
// 规则见提示词 §9.3。时钟预设校验通过 vite ssrLoadModule 复用浏览器同一份 computeClock。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const devicesDir = path.join(root, 'data/devices')

let errors = 0
const warnings = 0
function err(file, msg) {
  errors++
  console.error(`  ✗ [${file}] ${msg}`)
}
function ok(msg) {
  console.log(`  ✓ ${msg}`)
}

function loadJson(dir, name) {
  const p = path.join(dir, name)
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

// 时钟库（TS）——与浏览器同源
const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
  // configFile:false → 手动提供与 vite.config.ts 相同的 @ 别名（树模块有运行时别名 import）
  resolve: { alias: { '@': path.join(root, 'src') } },
  optimizeDeps: { noDiscovery: true, include: [] },
})
const clockLib = await server.ssrLoadModule('/src/model/clock/index.ts')
// M16：树模型/布局（diagram 覆盖与走线校验）
const treeLib = await server.ssrLoadModule('/src/model/clock/tree/index.ts')

function validateDevice(dir) {
  const id = path.basename(dir)
  console.log(`\n[validate] ${id}`)
  const chip = loadJson(dir, 'chip.json')
  const remap = loadJson(dir, 'remap.json')
  const exti = loadJson(dir, 'exti.json')
  const clock = loadJson(dir, 'clock.json')
  const peripherals = loadJson(dir, 'peripherals.json')
  const interrupts = loadJson(dir, 'interrupts.json')
  const dma = loadJson(dir, 'dma.json')

  for (const [name, data] of Object.entries({ chip, remap, exti, clock, peripherals, interrupts })) {
    if (!data) err(id, `缺少 ${name}.json`)
  }
  if (!chip || !remap || !exti || !clock || !peripherals || !interrupts) return

  // ---- 1. chip.json 引脚 ----
  const pins = chip.pins
  const numbers = pins.map((p) => p.number)
  const n = pins.length
  if (new Set(numbers).size !== n) err('chip.json', '引脚编号重复')
  const sorted = [...numbers].sort((a, b) => a - b)
  if (sorted.some((v, i) => v !== i + 1)) err('chip.json', `引脚编号必须 1..${n} 连续`)
  const perSide = {}
  for (const p of pins) perSide[p.side] = (perSide[p.side] ?? 0) + 1
  if (chip.packageKind === 'dual') {
    for (const side of ['left', 'right']) {
      if ((perSide[side] ?? 0) !== chip.pinsPerSide) err('chip.json', `${side} 侧引脚数 ${perSide[side] ?? 0} ≠ pinsPerSide ${chip.pinsPerSide}`)
    }
  } else if (chip.packageKind === 'quad') {
    for (const side of ['left', 'right', 'top', 'bottom']) {
      if ((perSide[side] ?? 0) !== chip.pinsPerSide) err('chip.json', `${side} 侧引脚数 ${perSide[side] ?? 0} ≠ pinsPerSide ${chip.pinsPerSide}`)
    }
  } else {
    err('chip.json', `未知 packageKind: ${chip.packageKind}`)
  }
  const pinByName = new Map(pins.map((p) => [p.name, p]))
  for (const p of pins) {
    if (!['IO', 'POWER', 'NC'].includes(p.type)) err('chip.json', `${p.name}: 非法 type ${p.type}`)
    if (p.special && !['nrst', 'boot', 'swd', 'osc'].includes(p.special)) err('chip.json', `${p.name}: 非法 special ${p.special}`)
  }
  ok(`引脚 ${n} 个，编号连续，每边数量符合 ${chip.packageKind}`)

  // ---- 1b. 多核描述（可选；单核芯片不填 cores） ----
  if (chip.cores !== undefined) {
    if (!Array.isArray(chip.cores) || chip.cores.length === 0) {
      err('chip.json', 'cores 必须是非空数组')
    } else {
      const ids = chip.cores.map((c) => c.id)
      const features = chip.cores.map((c) => c.halFeature)
      if (new Set(ids).size !== ids.length) err('chip.json', 'cores.id 重复')
      if (new Set(features).size !== features.length) err('chip.json', 'cores.halFeature 重复')
      for (const c of chip.cores) {
        if (!/^[a-z][a-z0-9_]*$/.test(c.id ?? '')) err('chip.json', `cores.id 非法：${c.id}（小写字母/数字/下划线，且用于目录名）`)
        if (!c.label) err('chip.json', `${c.id}: cores.label 缺失`)
        if (!c.halFeature) err('chip.json', `${c.id}: cores.halFeature 缺失`)
        if (!c.target) err('chip.json', `${c.id}: cores.target 缺失`)
      }
      const mains = chip.cores.filter((c) => c.mainCore === true)
      if (mains.length !== 1) err('chip.json', `cores 必须恰有一个 mainCore=true（当前 ${mains.length} 个）`)
      const main = mains[0]
      if (main) {
        if (chip.halFeature !== main.halFeature) err('chip.json', `chip.halFeature ${chip.halFeature} ≠ 主核 ${main.halFeature}`)
        if (chip.target !== main.target) err('chip.json', `chip.target ${chip.target} ≠ 主核 ${main.target}`)
      }
      ok(`多核描述 ${chip.cores.length} 个核心，主核 ${main?.id ?? '?'}，halFeature/target 一致`)
    }
  }

  // ---- 2. remap.json ----
  const seen = new Set()
  for (const e of remap.entries) {
    const pin = pinByName.get(e.pin)
    if (!pin) err('remap.json', `引用不存在的引脚 ${e.pin}`)
    else if (pin.type !== 'IO') err('remap.json', `${e.pin} 非 IO 引脚却有复用信号`)
    // 同一 (pin, signal) 可出现在多个 remap 档（如 SPI1_SCK@PC5 remap0/1），
    // 真正的唯一性约束是 (pin, signal, remap) 三元组
    const key = `${e.pin}|${e.signal}|${e.remap}`
    if (seen.has(key)) err('remap.json', `(pin, signal, remap) 重复：${key}`)
    seen.add(key)
    // per_pin_af（H4）：remap 字段是 4 位 AF 号；其它家族是 PCFR 分组号（8 位上限）
    const remapMax = chip.remapModel === 'per_pin_af' ? 15 : 255
    if (!Number.isInteger(e.remap) || e.remap < 0 || e.remap > remapMax) {
      err('remap.json', `${key}: ${chip.remapModel === 'per_pin_af' ? 'AF 号' : 'remap'} 必须 0..${remapMax} 整数`)
    }
    if (!/^[A-Z0-9]+_[A-Z0-9_]+$/.test(e.signal)) err('remap.json', `${key}: 信号名格式非法`)
  }
  ok(`remap ${remap.entries.length} 条，引脚引用/唯一性/值域通过`)

  // ---- 3. peripherals.json 与 remap.json 双向一致 ----
  const remapSignals = new Set(remap.entries.map((e) => e.signal))
  const periSignals = new Set()
  const checkPin = (pin, ctx) => {
    if (!pinByName.has(pin)) err('peripherals.json', `${ctx}: 引用不存在的引脚 ${pin}`)
  }
  for (const u of peripherals.usart ?? []) {
    for (const r of u.remaps) {
      for (const sig of ['tx', 'rx']) {
        const signal = `${u.id}_${sig.toUpperCase()}`
        periSignals.add(signal)
        checkPin(r[sig], `${u.id} remap${r.remap} ${sig}`)
        const hit = remap.entries.find((e) => e.pin === r[sig] && e.signal === signal && e.remap === r.remap)
        if (!hit) err('peripherals.json', `${signal} @ ${r[sig]} remap${r.remap} 在 remap.json 中不存在`)
      }
    }
    for (const [k, spec] of Object.entries(u.params)) validateParam(`usart.${u.id}.${k}`, spec)
  }
  for (const s of peripherals.spi ?? []) {
    for (const r of s.remaps) {
      for (const sig of ['sck', 'mosi', 'miso']) {
        const signal = `${s.id}_${sig.toUpperCase()}`
        periSignals.add(signal)
        checkPin(r[sig], `${s.id} remap${r.remap} ${sig}`)
        const hit = remap.entries.find((e) => e.pin === r[sig] && e.signal === signal && e.remap === r.remap)
        if (!hit) err('peripherals.json', `${signal} @ ${r[sig]} remap${r.remap} 在 remap.json 中不存在`)
      }
    }
    for (const [k, spec] of Object.entries(s.params)) validateParam(`spi.${s.id}.${k}`, spec)
  }
  for (const ic of peripherals.i2c ?? []) {
    for (const r of ic.remaps) {
      for (const sig of ['scl', 'sda']) {
        const signal = `${ic.id}_${sig.toUpperCase()}`
        periSignals.add(signal)
        checkPin(r[sig], `${ic.id} remap${r.remap} ${sig}`)
        const hit = remap.entries.find((e) => e.pin === r[sig] && e.signal === signal && e.remap === r.remap)
        if (!hit) err('peripherals.json', `${signal} @ ${r[sig]} remap${r.remap} 在 remap.json 中不存在`)
      }
    }
    for (const [k, spec] of Object.entries(ic.params)) validateParam(`i2c.${ic.id}.${k}`, spec)
  }
  // 双向差集（仅限外设引脚信号；TIMER/MCO 等不在 peripherals.json 建模，允许 remap 多出）
  for (const sig of periSignals) {
    if (!remapSignals.has(sig)) err('peripherals.json', `信号 ${sig} 在 remap.json 缺失`)
  }
  // ADC 通道与 chip.json 双向一致
  for (const adc of peripherals.adc ?? []) {
    const chipAdc = new Map()
    for (const p of pins) for (const ch of p.adc ?? []) chipAdc.set(ch, p.name)
    const periAdc = new Map(adc.channels.map((c) => [c.channel, c.pin]))
    for (const [ch, pin] of periAdc) {
      if (!chipAdc.has(ch)) err('peripherals.json', `ADC 通道 ${ch} 在 chip.json 缺失`)
      else if (chipAdc.get(ch) !== pin) err('peripherals.json', `ADC 通道 ${ch} 引脚不一致：${pin} vs ${chipAdc.get(ch)}`)
    }
    for (const [ch, pin] of chipAdc) {
      if (!periAdc.has(ch)) err('chip.json', `ADC 通道 ${ch}（${pin}）在 peripherals.json 缺失`)
    }
    for (const [k, spec] of Object.entries(adc.params)) validateParam(`adc.${adc.id}.${k}`, spec)
  }
  ok('peripherals 与 remap/chip 双向一致，参数默认值合法')

  // ---- 4. exti.json ----
  const irqNames = new Set(interrupts.irqs.map((i) => i.name))

  // ---- 3b. BLE 能力声明（可选；M19 数据驱动外设入口） ----
  if (peripherals.ble !== undefined) {
    const ble = peripherals.ble
    const ids = new Set(
      [...(peripherals.usart ?? []), ...(peripherals.spi ?? []), ...(peripherals.i2c ?? []), ...(peripherals.adc ?? [])].map(
        (i) => i.id,
      ),
    )
    if (typeof ble.instance !== 'string' || ble.instance.trim() === '') err('peripherals.json', 'ble.instance 必须是非空字符串')
    else if (ids.has(ble.instance)) err('peripherals.json', `ble.instance ${ble.instance} 与已有外设 id 重复`)
    const roles = ['peripheral', 'broadcaster', 'observer']
    if (!Array.isArray(ble.roles) || ble.roles.length === 0) err('peripherals.json', 'ble.roles 必须是非空数组')
    else for (const r of ble.roles) if (!roles.includes(r)) err('peripherals.json', `ble.roles 含非法角色 ${r}`)
    if (!Array.isArray(ble.backends) || ble.backends.length === 0) err('peripherals.json', 'ble.backends 必须是非空数组')
    else
      for (const b of ble.backends) {
        if (typeof b.id !== 'string' || b.id.trim() === '') err('peripherals.json', 'ble.backends[].id 必须是非空字符串')
        if (typeof b.label !== 'string' || b.label.trim() === '') err('peripherals.json', `ble.backends ${b.id}: label 必须是非空字符串`)
        if (typeof b.exportable !== 'boolean') err('peripherals.json', `ble.backends ${b.id}: exportable 必须是布尔`)
      }
    if (!Array.isArray(ble.interrupts) || ble.interrupts.length === 0) err('peripherals.json', 'ble.interrupts 必须是非空数组')
    else for (const irq of ble.interrupts) if (!irqNames.has(irq)) err('peripherals.json', `ble 中断 ${irq} 不在 interrupts.json`)
    if (ble.requires !== undefined) {
      if (typeof ble.requires !== 'object') err('peripherals.json', 'ble.requires 必须是对象')
      else for (const [k, v] of Object.entries(ble.requires)) if (typeof v !== 'boolean') err('peripherals.json', `ble.requires.${k} 必须是布尔`)
    }
    ok(`BLE ${ble.instance}: ${ble.roles.length} 角色 / ${ble.backends.length} 后端 / 中断 ${ble.interrupts.join(',')}`)
  }
  for (const e of exti.entries) {
    const pin = pinByName.get(e.pin)
    if (!pin) {
      err('exti.json', `引用不存在的引脚 ${e.pin}`)
      continue
    }
    const portIndex = parseInt(e.pin.slice(2), 10)
    if (e.channel !== portIndex) err('exti.json', `${e.pin}: channel ${e.channel} ≠ 端口内引脚号 ${portIndex}`)
    if (!irqNames.has(e.irq)) err('exti.json', `${e.pin}: IRQ ${e.irq} 不在中断表内`)
  }
  ok(`exti ${exti.entries.length} 条，通道号/IRQ 名通过`)

  // ---- 5. clock.json 预设可复现 ----
  for (const p of clock.presets) {
    const cfg = clockLib.presetToConfig(clock, p, clockLib.defaultClock(clock))
    const f = clockLib.computeClock(clock, cfg)
    const issues = clockLib.validateClock(clock, cfg)
    const errs = issues.filter((i) => i.level === 'error' || (p.adc !== undefined && i.node === 'ADC'))
    if (errs.length) err('clock.json', `预设 ${p.id} 非法：${errs.map((i) => i.message).join('；')}`)
    const target = parseInt(p.id, 10) // '48MHZ_HSE' → 48
    // 无 PLL 芯片（M14，如 X035）：HAL 的 SYSCLK_FREQ_*MHZ_HSI 常量实际只设 AHB 分频，
    // sysclk 恒为源频率（HSI 48），标称频率对应 HCLK（见 ch32-hal src/rcc/x0.rs:48-63,97-113）。
    const nominalMhz = clock.pll === undefined ? f.hclkMhz : f.sysclkMhz
    if (!Number.isNaN(target) && Math.abs(nominalMhz - target) > 1e-6) {
      err('clock.json', `预设 ${p.id} 复现频率 ${nominalMhz}MHz ≠ 标称 ${target}MHz`)
    }
    const matched = clockLib.matchPreset(clock, cfg)
    if (!matched || matched.id !== p.id) err('clock.json', `预设 ${p.id} 无法被 matchPreset 命中`)
    if (!clock.codegen.presetConstMap[p.id]) err('clock.json', `预设 ${p.id} 缺 presetConstMap 映射`)
  }
  ok(`clock 预设 ${clock.presets.length} 个全部可复现且可命中`)

  // ---- 5b. clock.json peripheralClocks 结构（M15 契约 D6）----
  if (clock.peripheralClocks) {
    const before = errors
    validatePeripheralClockBlock(clock, peripherals)
    if (errors === before) ok('clock peripheralClocks 结构通过')
  }

  // ---- 5c. clock.json diagram 结构（M16 契约 D3/D6）----
  if (clock.diagram) {
    const before = errors
    validateClockDiagram(clock, peripherals)
    if (errors === before) ok('clock diagram 结构通过（覆盖/坐标/分组/走线）')
  }

  // ---- 6. interrupts.json / dma.json ----
  const names = interrupts.irqs.map((i) => i.name)
  if (new Set(names).size !== names.length) err('interrupts.json', 'IRQ name 重复')
  const nums = interrupts.irqs.map((i) => i.number)
  if (new Set(nums).size !== nums.length) err('interrupts.json', 'IRQ number 重复')
  ok(`interrupts ${interrupts.irqs.length} 条唯一`)
  if (dma) {
    const reqs = dma.requests.map((r) => r.request)
    if (new Set(reqs).size !== reqs.length) err('dma.json', 'DMA request 重复')
    ok(`dma ${dma.requests.length} 条唯一`)
  }

  // ---- 覆盖率报表 ----
  const sigCount = {}
  for (const e of remap.entries) sigCount[e.pin] = (sigCount[e.pin] ?? 0) + 1
  const ioPins = pins.filter((p) => p.type === 'IO')
  const covered = ioPins.filter((p) => sigCount[p.name] > 0).length
  console.log(`  📊 信号覆盖率：${covered}/${ioPins.length} 个 IO 引脚有复用信号`)
  for (const p of ioPins) {
    const adcN = (p.adc ?? []).length
    console.log(`     ${p.name.padEnd(4)} remap×${sigCount[p.name] ?? 0}  adc×${adcN}`)
  }
}

function validateParam(ctx, spec) {
  if (spec.options && !spec.options.includes(spec.default)) {
    err('peripherals.json', `${ctx}: 默认值 ${spec.default} 不在 options 内`)
  }
  if (spec.kind === 'number') {
    if (spec.min !== undefined && spec.default < spec.min) err('peripherals.json', `${ctx}: 默认值低于 min`)
    if (spec.max !== undefined && spec.default > spec.max) err('peripherals.json', `${ctx}: 默认值高于 max`)
  }
}

// ---------- M15：peripheralClocks 结构校验（纯 JSON，无额外依赖） ----------
const PERIPHERAL_BUSES = ['SYSCLK', 'HCLK', 'APB1', 'APB2', 'CK32M']
const PERIPHERAL_RATE_CATEGORIES = ['usart', 'spi', 'i2c']

function isPeripheralBus(v) {
  return PERIPHERAL_BUSES.includes(v)
}

function validatePeripheralClockBlock(clock, peripherals) {
  const pc = clock.peripheralClocks
  if (!pc || typeof pc !== 'object' || Array.isArray(pc)) {
    err('clock.json', 'peripheralClocks 必须是对象')
    return
  }
  const instances = (cat) => (Array.isArray(peripherals[cat]) ? peripherals[cat] : [])

  // 5b-1. 速率类外设（USART/SPI/I2C）：源总线 + 旋钮存在性
  for (const cat of PERIPHERAL_RATE_CATEGORIES) {
    const s = pc[cat]
    if (s === undefined) continue
    const ctx = `peripheralClocks.${cat}`
    if (!s || typeof s !== 'object') {
      err('clock.json', `${ctx} 必须是对象`)
      continue
    }
    if (!isPeripheralBus(s.sourceDefault)) {
      err('clock.json', `${ctx}.sourceDefault 非法总线 ${s.sourceDefault}（允许 ${PERIPHERAL_BUSES.join('/')}）`)
    }
    for (const [iid, bus] of Object.entries(s.sourceOverrides ?? {})) {
      if (!isPeripheralBus(bus)) {
        err('clock.json', `${ctx}.sourceOverrides.${iid} 非法总线 ${bus}（允许 ${PERIPHERAL_BUSES.join('/')}）`)
      }
    }
    if (typeof s.knob !== 'string' || !s.knob) err('clock.json', `${ctx}.knob 缺失或非字符串`)
    const insts = instances(cat)
    if (insts.length === 0) err('clock.json', `${ctx}: peripherals.${cat} 无实例`)
    if (typeof s.knob === 'string') {
      for (const inst of insts) {
        if (!inst.params || inst.params[s.knob] === undefined) {
          err('peripherals.json', `${cat}.${inst.id}: 缺少 peripheralClocks 旋钮参数 ${s.knob}`)
        }
      }
    }
  }

  // 5b-2. SPI BRG：2 的幂档位非空 或 线性 min<max
  if (pc.spi !== undefined) {
    const brg = pc.spi?.brg
    if (!brg || typeof brg !== 'object') {
      err('clock.json', 'peripheralClocks.spi.brg 缺失')
    } else {
      const divs = brg.divs
      const linear = brg.linear
      const divsOk =
        Array.isArray(divs) && divs.length > 0 && divs.every((d) => Number.isInteger(d) && d > 0)
      const linOk =
        linear &&
        Number.isInteger(linear.min) &&
        Number.isInteger(linear.max) &&
        linear.min >= 2 &&
        linear.min < linear.max
      if (!divsOk && !linOk) {
        err('clock.json', 'peripheralClocks.spi.brg 需提供非空 divs 或 linear（整数 min<max，min≥2）')
      }
    }
  }

  // 5b-3. I2C maxKhz
  if (pc.i2c !== undefined && !(typeof pc.i2c?.maxKhz === 'number' && pc.i2c.maxKhz > 0)) {
    err('clock.json', 'peripheralClocks.i2c.maxKhz 必须大于 0')
  }

  // 5b-4. ADC：源/固定输入/CLK_DIV/采样时钟枚举
  if (pc.adc !== undefined) {
    const adc = pc.adc
    if (!adc || typeof adc !== 'object') {
      err('clock.json', 'peripheralClocks.adc 必须是对象')
    } else {
      if (!isPeripheralBus(adc.source)) {
        err('clock.json', `peripheralClocks.adc.source 非法总线 ${adc.source}`)
      }
      if (adc.fixedInMhz !== undefined && !(typeof adc.fixedInMhz === 'number' && adc.fixedInMhz > 0)) {
        err('clock.json', 'peripheralClocks.adc.fixedInMhz 必须大于 0')
      }
      if (adc.clkDiv) {
        const cd = adc.clkDiv
        if (typeof cd.programmable !== 'boolean') err('clock.json', 'peripheralClocks.adc.clkDiv.programmable 必须是布尔')
        if (cd.raw !== undefined && typeof cd.raw !== 'boolean') err('clock.json', 'peripheralClocks.adc.clkDiv.raw 必须是布尔')
        if (!Number.isInteger(cd.bits) || cd.bits < 1 || cd.bits > 16) {
          err('clock.json', `peripheralClocks.adc.clkDiv.bits 必须是 1..16 整数（当前 ${cd.bits}）`)
        } else if (!Number.isInteger(cd.default) || cd.default < 0 || cd.default >= 2 ** cd.bits) {
          err('clock.json', `peripheralClocks.adc.clkDiv.default 必须是 [0, ${2 ** cd.bits}) 整数（当前 ${cd.default}）`)
        }
      }
      if (adc.knob !== undefined) {
        if (typeof adc.knob !== 'string' || !adc.knob) {
          err('clock.json', 'peripheralClocks.adc.knob 必须是非空字符串')
        } else {
          const insts = instances('adc')
          for (const inst of insts) {
            const spec = inst.params?.[adc.knob]
            if (!spec) {
              err('peripherals.json', `adc.${inst.id}: 缺少 peripheralClocks 旋钮参数 ${adc.knob}`)
              continue
            }
            if (adc.enumMhz) {
              const opts = spec.options ?? []
              for (const key of Object.keys(adc.enumMhz)) {
                if (!opts.includes(key)) {
                  err('clock.json', `peripheralClocks.adc.enumMhz 键 ${key} 不在 adc.${inst.id}.${adc.knob} options 内`)
                }
              }
            }
          }
        }
        for (const [key, mhz] of Object.entries(adc.enumMhz ?? {})) {
          if (!(typeof mhz === 'number' && mhz > 0)) err('clock.json', `peripheralClocks.adc.enumMhz.${key} 必须大于 0`)
        }
      }
    }
  }

  // 5b-5. USB：autoPre 键 ∈ validPllMhz（fixedMhz 芯片除外）
  if (pc.usb !== undefined) {
    const usb = pc.usb
    if (!usb || typeof usb !== 'object') {
      err('clock.json', 'peripheralClocks.usb 必须是对象')
    } else {
      if (usb.fixedMhz !== undefined && !(typeof usb.fixedMhz === 'number' && usb.fixedMhz > 0)) {
        err('clock.json', 'peripheralClocks.usb.fixedMhz 必须大于 0')
      }
      const autoPre = usb.autoPre
      if (!autoPre || typeof autoPre !== 'object' || Array.isArray(autoPre)) {
        err('clock.json', 'peripheralClocks.usb.autoPre 必须是对象（可为空）')
      } else {
        for (const [key, div] of Object.entries(autoPre)) {
          if (!(typeof div === 'number' && div > 0)) {
            err('clock.json', `peripheralClocks.usb.autoPre.${key} 分频必须大于 0`)
          }
          if (usb.fixedMhz === undefined) {
            const keyMhz = Number(key)
            const valid = Array.isArray(usb.validPllMhz) ? usb.validPllMhz : []
            if (!Number.isFinite(keyMhz) || !valid.includes(keyMhz)) {
              err('clock.json', `peripheralClocks.usb.autoPre 键 ${key} 不在 validPllMhz [${valid.join(',')}] 内`)
            }
          }
        }
      }
      if (!Array.isArray(usb.validPllMhz)) {
        err('clock.json', 'peripheralClocks.usb.validPllMhz 必须是数组')
      } else {
        for (const mhz of usb.validPllMhz) {
          if (!(typeof mhz === 'number' && mhz > 0)) err('clock.json', 'peripheralClocks.usb.validPllMhz 元素必须大于 0')
        }
      }
    }
  }
}

// ---------- M16：clock.json diagram 结构校验（契约 D3/D6） ----------
const CLOCK_NODE_KINDS = new Set(['osc', 'mux', 'div', 'readout', 'peri', 'pll'])
const RECT_EPS = 0.5

function rectOverlap(a, b) {
  return (
    Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > RECT_EPS &&
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > RECT_EPS
  )
}

/** 线段是否穿过矩形内部（贴边/端点不算）。 */
function segmentHitsRect(a, b, r) {
  if (a.y === b.y) {
    if (a.y <= r.y + RECT_EPS || a.y >= r.y + r.h - RECT_EPS) return false
    const lo = Math.min(a.x, b.x)
    const hi = Math.max(a.x, b.x)
    return Math.min(hi, r.x + r.w) - Math.max(lo, r.x) > RECT_EPS
  }
  if (a.x === b.x) {
    if (a.x <= r.x + RECT_EPS || a.x >= r.x + r.w - RECT_EPS) return false
    const lo = Math.min(a.y, b.y)
    const hi = Math.max(a.y, b.y)
    return Math.min(hi, r.y + r.h) - Math.max(lo, r.y) > RECT_EPS
  }
  return true
}

/**
 * 5c：diagram 存在时的结构校验（无 diagram 跳过=回退合法）。
 * 1) nodes 键全覆盖（逻辑节点含 aux/外设；由 buildClockModel 派生）+ 坐标非负有限；
 * 2) groups 覆盖成员且互不重叠；
 * 3) 簇互不重叠 + buildClockTree 走线不穿簇；
 * 4) aux inputs 引用存在的节点；5) 仅显示源不进 control options。
 */
function validateClockDiagram(clock, peripherals) {
  const diagram = clock.diagram
  if (!diagram || typeof diagram !== 'object' || Array.isArray(diagram)) {
    err('clock.json', 'diagram 必须是对象')
    return
  }
  const dnodes = diagram.nodes
  if (!dnodes || typeof dnodes !== 'object' || Array.isArray(dnodes)) {
    err('clock.json', 'diagram.nodes 必须是对象')
    return
  }

  let model
  let layout
  try {
    const cfg = clockLib.mergeClockConfig(clock)
    const freqs = clockLib.computeClock(clock, cfg)
    const periCtx = peripherals ? { peripherals, state: {}, periFreqs: [] } : undefined
    model = treeLib.buildClockModel(clock, cfg, freqs, undefined, periCtx)
    layout = treeLib.buildClockTree(clock, cfg, freqs, undefined, periCtx)
  } catch (e) {
    err('clock.json', `diagram 构建树失败：${e instanceof Error ? e.message : String(e)}`)
    return
  }

  const ids = new Set(model.nodes.map((n) => n.id))
  if (ids.size !== model.nodes.length) err('clock.json', '时钟图节点 ID 重复')
  for (const { id, from, to } of model.edges) {
    if (!ids.has(from) || !ids.has(to)) err('clock.json', `时钟连线 ${id} 引用不存在的节点 ${from} → ${to}`)
  }
  for (const source of clock.sources) {
    if (source.sysclkDividerParam !== undefined && !clock.pll?.params.some((param) => param.key === source.sysclkDividerParam && param.options.every((value) => value > 0))) {
      err('clock.json', `${source.id}.sysclkDividerParam 必须引用合法的分频参数`)
    }
  }
  for (const [name, id] of [
    ['adc.fixedSource', clock.adc.fixedSource],
    ['peripheralClocks.usb.fixedSource', clock.peripheralClocks?.usb?.fixedSource],
  ]) {
    if (id !== undefined && !clock.sources.some((source) => source.id === id && !source.pll)) {
      err('clock.json', `${name} 必须引用振荡器节点`)
    }
  }
  for (const id of ids) {
    const p = dnodes[id]
    if (!p) {
      err('clock.json', `diagram.nodes 缺少节点 ${id}`)
      continue
    }
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      err('clock.json', `diagram.nodes.${id} 坐标必须为有限数字`)
    } else if (p.x < 0 || p.y < 0) {
      err('clock.json', `diagram.nodes.${id} 坐标必须非负（当前 ${p.x},${p.y}）`)
    }
    if (p.kind !== undefined && !CLOCK_NODE_KINDS.has(p.kind)) {
      err('clock.json', `diagram.nodes.${id}.kind 非法：${p.kind}`)
    }
  }
  for (const id of Object.keys(dnodes)) {
    if (!ids.has(id)) err('clock.json', `diagram.nodes 含未知节点 ${id}`)
  }

  // 分组框：字段/唯一性/互不重叠/成员覆盖（成员=model.group 同 id 的节点）
  if (diagram.groups !== undefined) {
    if (!Array.isArray(diagram.groups)) {
      err('clock.json', 'diagram.groups 必须是数组')
    } else {
      const gids = new Set()
      for (const g of diagram.groups) {
        if (!g || typeof g.id !== 'string' || !g.id) {
          err('clock.json', 'diagram.groups: 每组必须有非空 id')
          continue
        }
        if (gids.has(g.id)) err('clock.json', `diagram.groups: id ${g.id} 重复`)
        gids.add(g.id)
        if (!g.label) err('clock.json', `diagram.groups.${g.id}: label 缺失`)
        if (![g.x, g.y, g.w, g.h].every((v) => Number.isFinite(v)) || g.w <= 0 || g.h <= 0) {
          err('clock.json', `diagram.groups.${g.id}: x/y/w/h 必须是有限数字且 w/h>0`)
        }
      }
      const boxes = diagram.groups.filter((g) => g && Number.isFinite(g.x))
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          if (rectOverlap(boxes[i], boxes[j])) {
            err('clock.json', `diagram.groups: ${boxes[i].id} 与 ${boxes[j].id} 重叠`)
          }
        }
      }
      // 每个有分组归属的节点必须被同名分组框完全覆盖
      for (const n of layout.nodes) {
        if (!n.group) continue
        const g = boxes.find((b) => b.id === n.group)
        if (!g) {
          err('clock.json', `diagram.groups: 缺少分组框 ${n.group}（节点 ${n.id}）`)
        } else if (
          n.x < g.x - RECT_EPS ||
          n.y < g.y - RECT_EPS ||
          n.x + n.w > g.x + g.w + RECT_EPS ||
          n.y + n.h > g.y + g.h + RECT_EPS
        ) {
          err('clock.json', `diagram.groups.${g.id}: 未覆盖成员 ${n.id}`)
        }
      }
    }
  }

  // 簇互不重叠（走线不穿簇的前提）
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      const a = layout.nodes[i]
      const b = layout.nodes[j]
      if (rectOverlap(a, b)) err('clock.json', `diagram: 簇 ${a.id} 与 ${b.id} 重叠`)
    }
  }

  // 走线不穿任何簇矩形
  const seen = new Set()
  for (const e of layout.edges) {
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1]
      const b = e.points[i]
      for (const n of layout.nodes) {
        if (!segmentHitsRect(a, b, n)) continue
        const key = `${e.id}|${n.id}`
        if (seen.has(key)) continue
        seen.add(key)
        err('clock.json', `diagram: 走线 ${e.id} 穿过簇 ${n.id}`)
      }
    }
  }

  // lanes hint 必须引用存在的边
  for (const key of Object.keys(diagram.lanes ?? {})) {
    if (!layout.edges.some((e) => e.id === key)) {
      err('clock.json', `diagram.lanes 引用不存在的边 ${key}`)
    }
  }

  // aux 引用 + 仅显示源语义（diagram 不改变逻辑语义，这里顺带守门）
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]))
  for (const a of clock.aux ?? []) {
    for (const inp of a.inputs ?? []) {
      if (!ids.has(inp.id)) err('clock.json', `aux.${a.id} 输入引用不存在的节点 ${inp.id}`)
    }
    const n = nodeById.get(a.id)
    if (!n) err('clock.json', `aux.${a.id} 未进入时钟树模型`)
    else {
      if (!n.displayOnly) err('clock.json', `aux.${a.id} 必须 displayOnly=true`)
      if (n.control !== null) err('clock.json', `aux.${a.id} 不可有配置控件（control=null）`)
      if (n.lockable !== false) err('clock.json', `aux.${a.id} 必须 lockable=false`)
    }
    // D12：派生分频正数；group 覆盖须有同名分组框（成员覆盖在上面分组段已按 model.group 守门）
    if (a.deriveDiv !== undefined && !(Number.isFinite(a.deriveDiv) && a.deriveDiv > 0)) {
      err('clock.json', `aux.${a.id}.deriveDiv 必须为正有限数`)
    }
    if (a.group !== undefined && !(diagram.groups ?? []).some((g) => g && g.id === a.group)) {
      err('clock.json', `aux.${a.id}.group=${a.group} 无同名 diagram.groups 框`)
    }
  }
  for (const s of clock.sources ?? []) {
    if (!s.displayOnly) continue
    const n = nodeById.get(s.id)
    if (!n) err('clock.json', `displayOnly 源 ${s.id} 未进入时钟树模型`)
    else if (!n.displayOnly) err('clock.json', `源 ${s.id} 必须 displayOnly=true`)
    for (const other of model.nodes) {
      for (const o of other.control?.options ?? []) {
        if (String(o.value) === s.id) {
          err('clock.json', `节点 ${other.id} 的 control options 含仅显示源 ${s.id}`)
        }
      }
    }
  }
}

const targets = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const dirs = targets.length
  ? targets.map((t) => path.join(devicesDir, t.toLowerCase()))
  : fs.readdirSync(devicesDir).map((d) => path.join(devicesDir, d)).filter((d) => fs.statSync(d).isDirectory())

for (const dir of dirs) validateDevice(dir)
await server.close()

console.log(`\n[validate] 完成：${errors} 错误，${warnings} 警告`)
process.exit(errors ? 1 : 0)
