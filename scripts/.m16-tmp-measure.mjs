import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
  resolve: { alias: { '@': path.join(root, 'src') } },
  optimizeDeps: { noDiscovery: true, include: [] },
})
const clockLib = await server.ssrLoadModule('/src/model/clock/index.ts')
const treeLib = await server.ssrLoadModule('/src/model/clock/tree/index.ts')

const ids = process.argv.slice(2)
const dirs = ids.length
  ? ids
  : fs.readdirSync(path.join(root, 'data/devices')).sort()
for (const id of dirs) {
  const dir = path.join(root, 'data/devices', id)
  const clock = JSON.parse(fs.readFileSync(path.join(dir, 'clock.json'), 'utf8'))
  const peripherals = JSON.parse(fs.readFileSync(path.join(dir, 'peripherals.json'), 'utf8'))
  const cfg = clockLib.mergeClockConfig(clock)
  const freqs = clockLib.computeClock(clock, cfg)
  const periCtx = { peripherals, state: {}, periFreqs: [] }
  const layout = treeLib.buildClockTree(clock, cfg, freqs, clockLib.validateClock(clock, cfg, periCtx), periCtx)
  console.log(`\n=== ${id} canvas ${layout.width}x${layout.height} ===`)
  const byGroup = new Map()
  for (const n of layout.nodes) {
    if (!byGroup.has(n.group)) byGroup.set(n.group, [])
    byGroup.get(n.group).push(n)
  }
  for (const [g, ns] of byGroup) {
    const maxR = Math.max(...ns.map((n) => n.x + n.w))
    const maxB = Math.max(...ns.map((n) => n.y + n.h))
    console.log(` ${g}: minX=${Math.min(...ns.map((n) => n.x))} minY=${Math.min(...ns.map((n) => n.y))} maxR=${maxR} maxB=${maxB}`)
    for (const n of ns) console.log(`   ${n.id.padEnd(12)} ${n.kind.padEnd(7)} x=${n.x} y=${n.y} w=${n.w} h=${n.h}`)
  }
  for (const g of layout.groups) console.log(` group ${g.id} x=${g.x} y=${g.y} w=${g.w} h=${g.h}`)
  const minY = Math.min(...layout.nodes.map((n) => n.y))
  const maxY = Math.max(...layout.nodes.map((n) => n.y + n.h))
  for (const e of layout.edges) {
    const p = e.points
    const flag = p.some((q) => q.y < minY - 0.5)
      ? ' TOP-DETOUR'
      : p.some((q) => q.y > maxY + 0.5)
        ? ' BOTTOM-DETOUR'
        : ''
    console.log(` edge ${e.id}:${flag} ${p.map((q) => `${q.x},${q.y}`).join(' -> ')}`)
  }
}
await server.close()
