#!/usr/bin/env node
// git-api-push.mjs —— github.com:443 被断时，经 api.github.com（Git Data API）逐提交推送。
// 用法: node scripts/git-api-push.mjs [origin/main..HEAD 的每个本地提交按序推送]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const REPO = '3808000/ch32-rs-cubemx'
const TOKEN = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
const API = 'https://api.github.com'

const git = (...a) => execFileSync('git', a, { cwd: '/home/teze/CH32/CubeMX/ch32-rs-cubemx', encoding: 'utf8' }).trim()

async function api(method, path, body) {
  const resp = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await resp.text()
  const json = text ? JSON.parse(text) : {}
  if (!resp.ok) throw new Error(`${method} ${path} → ${resp.status}: ${text.slice(0, 300)}`)
  return json
}

// 1. 对齐基点：远端 main 的树 ↔ 本地同名树的提交（API 推送的提交 sha 与本地不同，
//    以「树内容」对齐；剩余提交逐个推。）
const remoteMain = (await api('GET', `/repos/${REPO}/branches/main`)).commit.sha
const remoteTree = (await api('GET', `/repos/${REPO}/git/commits/${remoteMain}`)).tree.sha
const localMain = git('rev-parse', 'HEAD')
let base = null
for (const c of git('rev-list', `${localMain}`).split('\n').filter(Boolean)) {
  if (git('rev-parse', `${c}^{tree}`) === remoteTree) { base = c; break }
}
if (!base) throw new Error(`远端 main 树 ${remoteTree.slice(0, 7)} 在本地历史中找不到（非快进，需人工处理）`)
const commits = git('rev-list', '--reverse', `${base}..${localMain}`).split('\n').filter(Boolean)
console.log(`远端 main: ${remoteMain.slice(0, 7)}（↔ 本地 ${base.slice(0, 7)}）；待推 ${commits.length} 个提交`)

let parent = remoteMain
let parentTree = (await api('GET', `/repos/${REPO}/git/commits/${parent}`)).tree.sha

for (const sha of commits) {
  // 2. 该提交相对父提交的变更（--no-renames：重命名拆成删除+新增，逐路径单列）
  const diff = execFileSync('git', ['diff-tree', '-r', '--no-commit-id', '--raw', '--no-renames', `${sha}^`, sha], {
    cwd: '/home/teze/CH32/CubeMX/ch32-rs-cubemx',
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'))
    .map(([meta, path]) => {
      const [oldModeRaw, newMode, oldSha, newSha] = meta.split(' ')
      const oldMode = oldModeRaw.replace(/^:/, '') // raw 格式首段带 ':'
      return { oldMode, newMode, oldSha, newSha, path }
    })

  const entries = []
  for (const d of diff) {
    if (d.newSha === '0000000000000000000000000000000000000000') {
      entries.push({ path: d.path, mode: d.oldMode, type: 'blob', sha: null }) // 删除
    } else {
      // 3. 上传 blob（内容寻址：同 sha 远端已存在则直接复用）
      const content = execFileSync('git', ['cat-file', 'blob', d.newSha], {
        cwd: '/home/teze/CH32/CubeMX/ch32-rs-cubemx',
        maxBuffer: 64 * 1024 * 1024,
      })
      const blob = await api('POST', `/repos/${REPO}/git/blobs`, {
        content: content.toString('base64'),
        encoding: 'base64',
      })
      entries.push({ path: d.path, mode: d.newMode, type: 'blob', sha: blob.sha })
    }
  }

  // 4. 基于远端父树建新树
  const tree = await api('POST', `/repos/${REPO}/git/trees`, { base_tree: parentTree, tree: entries })

  // 5. 提交（沿用本地作者/时间戳/消息）
  const fields = git('show', '-s', '--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B%x00', sha).split('\0')
  const commit = await api('POST', `/repos/${REPO}/git/commits`, {
    message: fields[6] ?? git('show', '-s', '--format=%B', sha),
    tree: tree.sha,
    parents: [parent],
    author: { name: fields[0], email: fields[1], date: fields[2] },
    committer: { name: fields[3], email: fields[4], date: fields[5] },
  })

  // 6. 快进 main
  await api('PATCH', `/repos/${REPO}/git/refs/heads/main`, { sha: commit.sha })
  parent = commit.sha
  parentTree = tree.sha
  console.log(`✓ ${sha.slice(0, 7)} → ${commit.sha.slice(0, 7)}  ${git('show', '-s', '--format=%s', sha)}`)
}

console.log(`\n完成：main → ${parent}`)
fs.writeFileSync('/tmp/api-push-head.txt', parent)
