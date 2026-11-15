#!/usr/bin/env node
// 从 ch32-data 导入只读数据：interrupts.json / remap.json / dma.json + 芯片索引。
// 用法：node scripts/import-ch32data.mjs [--ch32data <dir>] [--chip CH32V003F4P6]
// 说明：
//   - 引脚物理编号（chip.json）来自数据手册，人工录入，本脚本不生成。
//   - remap.json 来自 cores[0].include_peripherals 列出的全部 YAML（family + 追加外设文件），
//     按外设名去重后合并；与 ch32-hal 同源，权威。
//   - H4 家族的引脚复用是「每引脚 AF 号」（pin.af），其它家族是 PCFR 分组（pin.remap）。
//     本脚本把两者统一写入 remap 字段：H4 的 remap 即 AF 值（配合 remapModel=per_pin_af）。
//   - 仅导入 HAL 有驱动的外设信号（usart/spi/i2c/timer/rcc MCO）；OPA/USB/CAN/USBSS/USBPD
//     等 HAL 尚无 H4 驱动或未建模的外设跳过。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function argOf(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const dataDir = path.resolve(argOf('--ch32data', path.join(root, '../reference/ch32-data')))
const onlyChip = argOf('--chip', null)

if (!fs.existsSync(path.join(dataDir, 'data/chips'))) {
  console.error(`找不到 ch32-data：${dataDir}（用 --ch32data 指定）`)
  process.exit(1)
}

// HAL 有驱动、需要引脚 trait 的外设 kind
const PIN_KINDS = new Set(['usart', 'spi', 'i2c', 'timer', 'rcc'])
// kind → 信号前缀归一（rcc 的 MCO 保留 RCC_MCO）
function signalName(periName, kind, signal) {
  if (kind === 'adc') return `ADC_${signal}` // INn → ADC_INn
  return `${periName}_${signal}`
}

function importChip(chipName) {
  const chipFile = path.join(dataDir, 'data/chips', `${chipName}.yaml`)
  const chip = yaml.load(fs.readFileSync(chipFile, 'utf8'))
  const core = chip.cores?.[0]
  if (!core) throw new Error(`${chipName}: 无 cores 定义`)

  // include_peripherals 可能是多个文件（H417：family + USART8/SPI4/USBFS/USBSS/USBPD/SDIO/ETH）。
  // 必须全部读取并合并；只读第一个会漏掉 H4 的 USART8/SPI4 等追加外设。
  const includeRels = core.include_peripherals ?? []
  const includeFiles = includeRels.map((rel) => path.resolve(path.dirname(chipFile), rel))
  const includeLabels = includeRels.map((rel) => rel.replace(/^\.\.\//, ''))
  const peripherals = new Map() // name → peripheral（同名以先出现者为准）
  for (const file of includeFiles) {
    const list = yaml.load(fs.readFileSync(file, 'utf8')) ?? []
    for (const peri of list) {
      if (!peripherals.has(peri.name)) peripherals.set(peri.name, peri)
    }
  }

  // ---- remap.json ----
  const entries = []
  let usesAf = false
  for (const peri of peripherals.values()) {
    const kind = peri.registers?.kind
    if (!peri.pins || !PIN_KINDS.has(kind)) continue
    for (const p of peri.pins) {
      // H4：pin.af 是 AFIO.GPIO_AFR 的 4 位 AF 号；其它家族：pin.remap 是 PCFR 分组。
      if (p.af !== undefined) usesAf = true
      entries.push({
        pin: p.pin,
        signal: signalName(peri.name, kind, p.signal),
        remap: p.af ?? p.remap ?? 0,
      })
    }
  }
  entries.sort((a, b) => a.signal.localeCompare(b.signal) || a.pin.localeCompare(b.pin) || a.remap - b.remap)
  // 同一 (pin, signal, af) 在合并多个文件时可能出现重复，按三元组去重
  const deduped = []
  const seen = new Set()
  for (const e of entries) {
    const key = `${e.pin}|${e.signal}|${e.remap}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(e)
  }
  const remap = {
    chip: chipName,
    entries: deduped,
    notes: usesAf
      ? `由 import-ch32data.mjs 从 ch32-data ${includeLabels.join(' + ')} 合并生成；H4 每引脚 AF 号（AFIO.GPIO_AFR），remap 字段即 AF 值，与 ch32-hal build.rs 的 pin.af 一致`
      : `由 import-ch32data.mjs 从 ch32-data ${includeLabels.join(' + ')} 合并生成；PCFR 分组 remap 值与 ch32-hal const 泛型一致`,
  }

  // ---- interrupts.json ----
  const irqRel = core.include_interrupts
  const irqFile = path.resolve(path.dirname(chipFile), irqRel)
  const irqRaw = yaml.load(fs.readFileSync(irqFile, 'utf8'))
  const irqs = Object.entries(irqRaw).map(([name, number]) => ({ name, number }))
  irqs.sort((a, b) => a.number - b.number)

  // ---- dma.json ----
  let dma = { chip: chipName, requests: [] }
  const dmaRel = core.include_dma_channels && Object.values(core.include_dma_channels)[0]
  if (dmaRel) {
    const dmaFile = path.resolve(path.dirname(chipFile), dmaRel)
    const dmaRaw = yaml.load(fs.readFileSync(dmaFile, 'utf8'))
    dma = {
      chip: chipName,
      requests: Object.entries(dmaRaw).map(([request, channel]) => ({ request, channel })),
    }
    if (usesAf) {
      // H4：channel 字段是 DMAMUX 请求号，不是固定 DMA 通道；现有 embassy 生成按固定通道建模
      dma.notes =
        '由 import-ch32data.mjs 从 ch32-data 的 DMA/DMAMUX YAML 生成；channel 字段是 DMAMUX 请求号（不是固定 DMA 通道），H4 有 16 个 DMA 通道，任一通道可经 DMAMUX 路由到这些请求。当前代码生成的 embassy/DMA 路径按固定通道建模，故此类芯片标记 unsupportedFeatures=[embassy]；阻塞模式不使用本表。'
    }
  }

  // ---- 写出 ----
  const outDir = path.join(root, 'data/devices', chipName.toLowerCase())
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'remap.json'), JSON.stringify(remap, null, 2) + '\n')
  fs.writeFileSync(path.join(outDir, 'interrupts.json'), JSON.stringify({ chip: chipName, irqs }, null, 2) + '\n')
  fs.writeFileSync(path.join(outDir, 'dma.json'), JSON.stringify(dma, null, 2) + '\n')
  console.log(`[import] ${chipName}: remap ${entries.length} 条 / irq ${irqs.length} 条 / dma ${dma.requests.length} 条 → ${path.relative(root, outDir)}`)
  return { chipName, includes: includeLabels, chip }
}

// ---- 芯片索引（全部芯片，供 Home/选型用） ----
const chipFiles = fs.readdirSync(path.join(dataDir, 'data/chips')).filter((f) => f.endsWith('.yaml'))
const index = []
for (const f of chipFiles) {
  const chip = yaml.load(fs.readFileSync(path.join(dataDir, 'data/chips', f), 'utf8'))
  const pkg = chip.packages?.[0]
  index.push({
    name: chip.name,
    family: chip.family,
    subfamily: chip.subfamily,
    package: pkg?.package ?? '',
    deviceId: pkg?.device_id ?? '',
    memory: chip.memory_sizes ?? {},
  })
}
index.sort((a, b) => a.name.localeCompare(b.name))
fs.mkdirSync(path.join(root, 'data'), { recursive: true })
fs.writeFileSync(path.join(root, 'data/chip-index.json'), JSON.stringify(index, null, 2) + '\n')
console.log(`[import] 芯片索引：${index.length} 颗 → data/chip-index.json`)

// ---- 指定芯片导入 ----
const targets = onlyChip ? [onlyChip] : ['CH32V003F4P6']
for (const t of targets) importChip(t)
console.log('[import] 完成')