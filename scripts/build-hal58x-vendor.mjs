#!/usr/bin/env node
// 把本机 ch58x-hal 克隆打包为 public/vendor/ch58x-hal.zip，供浏览器导出时内嵌进工程。
// 用法：node scripts/build-hal58x-vendor.mjs [--hal <dir>]
// 导出工程用 path 依赖指向 vendor/ch58x-hal，开箱即可查阅 HAL 源码、离线编译（crates.io 依赖除外）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const i = process.argv.indexOf('--hal')
const halDir = path.resolve(i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : path.join(root, '../reference/ch58x-hal'))

if (!fs.existsSync(path.join(halDir, 'Cargo.toml'))) {
  console.error(`找不到 ch58x-hal：${halDir}`)
  process.exit(1)
}

const zip = new JSZip()
let count = 0
function walk(dir, rel) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'target') continue
    const full = path.join(dir, entry.name)
    const r = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) walk(full, r)
    else {
      zip.file(`ch58x-hal/${r}`, fs.readFileSync(full))
      count++
    }
  }
}
walk(halDir, '')

const outDir = path.join(root, 'public/vendor')
fs.mkdirSync(outDir, { recursive: true })
const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
fs.writeFileSync(path.join(outDir, 'ch58x-hal.zip'), buf)
console.log(`[vendor] ${count} 个文件 → public/vendor/ch58x-hal.zip（${(buf.length / 1024 / 1024).toFixed(2)} MB）`)
