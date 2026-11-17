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

const chips = argOf('--chip', 'CH32V003F4P6,CH32V203C8T6,CH582M').split(',')
const embassy = process.argv.includes('--embassy')
const ble = process.argv.includes('--ble')
const halDir = process.env.CH32_HAL_DIR ?? path.resolve(root, '../reference/ch32-hal')
const hal58xDir = process.env.CH58X_HAL_DIR ?? path.resolve(root, '../reference/ch58x-hal')

// cargo 1.98 会直接读取 git 全局的 http.proxy（不走 GIT_CONFIG_GLOBAL 覆盖）；
// 本机代理可能并未运行——代理挂了时用「临时 HOME + 空 .gitconfig + CARGO_HOME 指回原位」
// 中和该回退，同时保留依赖缓存。
const env = { ...process.env }
const realHome = env.HOME ?? os.homedir()
{
  const proxy = env.HTTPS_PROXY ?? spawnSync('git', ['config', '--global', '--get', 'http.proxy'], { encoding: 'utf8' }).stdout.trim()
  if (proxy && proxyAlive(proxy)) {
    env.HTTPS_PROXY = proxy
    env.HTTP_PROXY = proxy
  } else if (proxy) {
    const cleanHome = path.join(os.tmpdir(), 'ch32-cubemx-clean-home')
    fs.mkdirSync(cleanHome, { recursive: true })
    fs.writeFileSync(path.join(cleanHome, '.gitconfig'), '[http]\n\tproxy = ""\n')
    env.HOME = cleanHome
    env.CARGO_HOME = env.CARGO_HOME ?? path.join(realHome, '.cargo')
    // rustup 默认 RUSTUP_HOME=$HOME/.rustup——不钉住会在隔离 HOME 里新建空白/残缺工具链家目录
    // （M11 事故：自动更新中断留下半套 stable，cargo 随机 crate 编译失败）。与 CARGO_HOME 同理指回原位。
    env.RUSTUP_HOME = env.RUSTUP_HOME ?? path.join(realHome, '.rustup')
    console.log(`[verify:build] 本机代理 ${proxy} 不可达 → 使用隔离 HOME（${cleanHome}）禁用 git 代理回退`)
  }
}

/** 探测代理 URL 对应的主机端口是否可连（curl 兜底，2s 超时；拒绝连接返回 false）。 */
function proxyAlive(proxyUrl) {
  try {
    const u = new URL(proxyUrl.startsWith('http') ? proxyUrl : `http://${proxyUrl}`)
    const probe = spawnSync('curl', ['-s', '-o', '/dev/null', '-m', '2', `http://${u.hostname}:${u.port || 80}`], { encoding: 'utf8' })
    return probe.status !== null && probe.status !== 7 // 7 = connection refused
  } catch {
    return false
  }
}
if (fs.existsSync(halDir)) env.CH32_HAL_DIR = halDir
if (fs.existsSync(hal58xDir)) env.CH58X_HAL_DIR = hal58xDir

let failed = 0
for (const chip of chips) {
  console.log(`\n[verify:build] === ${chip} ===`)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `ch32-cubemx-${chip.toLowerCase()}-`))

  // 1. vite-node 运行浏览器同一份生成逻辑
  const entryArgs = [path.join(root, 'node_modules/vite-node/vite-node.mjs'), path.join(root, 'scripts/verify-build-entry.ts'), '--chip', chip, '--out', tmp]
  if (embassy) entryArgs.push('--embassy')
  if (ble) entryArgs.push('--ble')
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