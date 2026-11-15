#!/usr/bin/env node
// 端到端编译验证：vite-node 跑浏览器同一份生成逻辑 → 临时目录 → cargo build。
// 用法：npm run verify:build [-- --chip CH32V003F4P6]
// 环境变量：CH32_HAL_DIR（本地 HAL 路径，加速）、CH32_HAL_REV（覆盖锁定 rev）
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function argOf(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const chips = argOf('--chip', 'CH32V003F4P6,CH32V203C8T6').split(',')
const embassy = process.argv.includes('--embassy')
const halDir = process.env.CH32_HAL_DIR ?? path.resolve(root, '../reference/ch32-hal')

// cargo 走 git 拉取时需要代理（与 git 全局配置一致）
const env = { ...process.env }
if (!env.HTTPS_PROXY) {
  const proxy = spawnSync('git', ['config', '--global', '--get', 'http.proxy'], { encoding: 'utf8' }).stdout.trim()
  if (proxy) {
    env.HTTPS_PROXY = proxy
    env.HTTP_PROXY = proxy
  }
}
if (fs.existsSync(halDir)) env.CH32_HAL_DIR = halDir

let failed = 0
for (const chip of chips) {
  console.log(`\n[verify:build] === ${chip} ===`)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `ch32-cubemx-${chip.toLowerCase()}-`))

  // 1. vite-node 运行浏览器同一份生成逻辑
  const entryArgs = [path.join(root, 'node_modules/vite-node/vite-node.mjs'), path.join(root, 'scripts/verify-build-entry.ts'), '--chip', chip, '--out', tmp]
  if (embassy) entryArgs.push('--embassy')
  const gen = spawnSync(process.execPath, entryArgs, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  process.stdout.write(gen.stdout ?? '')
  if (gen.status !== 0) {
    console.error(gen.stderr ?? '')
    console.error(`[verify:build] ${chip}: 生成失败`)
    failed++
    continue
  }

  // 2. cargo build（target 由 .cargo/config.toml 提供）
  // 双核芯片的生成结果是 Cargo workspace：根目录没有 target，必须走 xtask（逐个核在各自目录构建）
  const rootCargo = path.join(tmp, 'Cargo.toml')
  const isWorkspace = fs.existsSync(rootCargo) && /^\s*\[workspace\]/m.test(fs.readFileSync(rootCargo, 'utf8'))
  const target = chip.toUpperCase().includes('V003') ? 'riscv32ec-unknown-none-elf.json' : undefined
  const args = isWorkspace ? ['xtask', 'build'] : ['build', '--release']
  if (!isWorkspace && target) args.push('--target', target)
  console.log(`[verify:build] cargo ${args.join(' ')}（首次需拉取依赖，可能数分钟）`)
  const build = spawnSync('cargo', args, { cwd: tmp, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900000 })
  if (build.status !== 0) {
    console.error(build.stderr?.slice(-8000) ?? '')
    console.error(`[verify:build] ${chip}: cargo build 失败（工程保留在 ${tmp}）`)
    failed++
    continue
  }
  console.log(`[verify:build] ${chip}: ✓ cargo build 通过`)
  // 成功后清理临时目录
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n[verify:build] 完成：${chips.length - failed}/${chips.length} 通过`)
process.exit(failed ? 1 : 0)