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
  optimizeDeps: { noDiscovery: true, include: [] },
})
const clockLib = await server.ssrLoadModule('/src/model/clock/index.ts')

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
    const pll = {}
    for (const param of clock.pll.params) {
      if (p.match[param.key] !== undefined) pll[param.key] = p.match[param.key]
    }
    const cfg = clockLib.mergeClockConfig(clock, {
      source: p.match.source,
      pllSource: p.match.pllSource,
      hxtalMhz: p.match.hxtalMhz,
      pll: Object.keys(pll).length ? pll : undefined,
      ahb: p.match.ahb,
      apb1: p.match.apb1,
      apb2: p.match.apb2,
    })
    const f = clockLib.computeClock(clock, cfg)
    const issues = clockLib.validateClock(clock, cfg)
    const errs = issues.filter((i) => i.level === 'error')
    if (errs.length) err('clock.json', `预设 ${p.id} 非法：${errs.map((i) => i.message).join('；')}`)
    const target = parseInt(p.id, 10) // '48MHZ_HSE' → 48
    if (!Number.isNaN(target) && Math.abs(f.sysclkMhz - target) > 1e-6) {
      err('clock.json', `预设 ${p.id} 复现频率 ${f.sysclkMhz}MHz ≠ 标称 ${target}MHz`)
    }
    const matched = clockLib.matchPreset(clock, cfg)
    if (!matched || matched.id !== p.id) err('clock.json', `预设 ${p.id} 无法被 matchPreset 命中`)
    if (!clock.codegen.presetConstMap[p.id]) err('clock.json', `预设 ${p.id} 缺 presetConstMap 映射`)
  }
  ok(`clock 预设 ${clock.presets.length} 个全部可复现且可命中`)

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

const targets = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const dirs = targets.length
  ? targets.map((t) => path.join(devicesDir, t.toLowerCase()))
  : fs.readdirSync(devicesDir).map((d) => path.join(devicesDir, d)).filter((d) => fs.statSync(d).isDirectory())

for (const dir of dirs) validateDevice(dir)
await server.close()

console.log(`\n[validate] 完成：${errors} 错误，${warnings} 警告`)
process.exit(errors ? 1 : 0)