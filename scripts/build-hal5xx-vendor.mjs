#!/usr/bin/env node
// 把本机 ch5xx-hal 与 ch5xx-ble shim 打包为 public/vendor/{ch5xx-hal,ch5xx-ble}.zip，
// 供浏览器导出时内嵌进工程（path 依赖，开箱即可查阅源码/离线编译）。
// 用法：node scripts/build-hal5xx-vendor.mjs [--hal <dir>] [--shim <dir>]
//   --hal  默认 ../reference/ch5xx-hal
//   --shim 默认 vendor-src/ch5xx-ble（S1 的 shim crate；含 vendor/*.a）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function argOf(name, fallback) {
  const i = process.argv.indexOf(name)
  return path.resolve(i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback)
}

const halDir = argOf('--hal', path.join(root, '../reference/ch5xx-hal'))
const shimDir = argOf('--shim', path.join(root, 'vendor-src/ch5xx-ble'))
// ch5xx-hal 的 build.rs 读取 `$CARGO_MANIFEST_DIR/../ch5xx-data/data`（兄弟目录，非 crate 依赖）；
// vendor 树里必须同时内嵌 vendor/ch5xx-data，否则 cargo build 在 HAL build.rs 直接 panic。
const dataDir = argOf('--data', process.env.CH5XX_DATA_DIR ?? path.join(path.dirname(halDir), 'ch5xx-data'))

if (!fs.existsSync(path.join(halDir, 'Cargo.toml'))) {
  console.error(`找不到 ch5xx-hal：${halDir}`)
  process.exit(1)
}

/** 把目录追加进 zip，条目名为 <prefix>/...（跳过 .git / target）；返回文件数。 */
function addDir(zip, dir, prefix) {
  let count = 0
  function walk(current, rel) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'target') continue
      const full = path.join(current, entry.name)
      const r = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(full, r)
      else {
        zip.file(`${prefix}/${r}`, fs.readFileSync(full))
        count++
      }
    }
  }
  walk(dir, '')
  return count
}

async function writeZip(zip, fileName) {
  const outDir = path.join(root, 'public/vendor')
  fs.mkdirSync(outDir, { recursive: true })
  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  fs.writeFileSync(path.join(outDir, fileName), buf)
  return buf
}

// 1) ch5xx-hal（上游 tarball/克隆）+ ch5xx-data（HAL build.rs 的兄弟数据目录）
{
  const zip = new JSZip()
  const count = addDir(zip, halDir, 'ch5xx-hal')
  let dataCount = 0
  if (fs.existsSync(path.join(dataDir, 'data'))) {
    dataCount = addDir(zip, dataDir, 'ch5xx-data')
  } else {
    console.warn(`[vendor] 警告：找不到 ch5xx-data（${dataDir}）；vendor 树中的 HAL build.rs 会失败`)
  }
  const buf = await writeZip(zip, 'ch5xx-hal.zip')
  console.log(
    `[vendor] ch5xx-hal：${count} 个文件 + ch5xx-data ${dataCount} 个文件 → public/vendor/ch5xx-hal.zip（${(buf.length / 1024 / 1024).toFixed(2)} MB）`,
  )
}

// 2) ch5xx-ble shim（我方 crate，含 WCH 预编译 blob）
if (!fs.existsSync(path.join(shimDir, 'Cargo.toml'))) {
  console.warn(`[vendor] 跳过 ch5xx-ble：找不到 shim crate（${shimDir}）；BLE 导出会缺 vendor/ch5xx-ble`)
} else {
  const zip = new JSZip()
  const count = addDir(zip, shimDir, 'ch5xx-ble')
  const buf = await writeZip(zip, 'ch5xx-ble.zip')
  const hasBlob = ['LIBCH58xBLE.a', 'libISP583.a'].every((f) =>
    fs.existsSync(path.join(shimDir, 'vendor', f)),
  )
  if (!hasBlob) console.warn('[vendor] 警告：ch5xx-ble/vendor 缺少 WCH 预编译 .a（链接会失败）')
  console.log(`[vendor] ch5xx-ble：${count} 个文件 → public/vendor/ch5xx-ble.zip（${(buf.length / 1024 / 1024).toFixed(2)} MB）`)
}