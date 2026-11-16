// Cargo.toml 标记区合并：生成器把自动维护的内容包在两条 TOML 注释标记之间；
// 重新导出时只替换标记区内内容，保留用户写在标记区外的依赖 / profile / [[bin]]。
// 纯函数、无 IO，便于单测，也可在导出流程中直接复用。
//
// 注意：标记文本同时硬编码在 model/codegen/templates/{cargoToml,coreCargo,dualRootCargo,xtaskCargo}.ts
// （model 层不得反向依赖 services），tests/codegen.test.ts 会校验两边一致。

/** 标记区起始行（TOML 注释，对 cargo 解析无影响）。 */
export const GENERATED_START_MARKER = '# >>> ch32-cubemx generated >>>'
/** 标记区结束行。 */
export const GENERATED_END_MARKER = '# <<< ch32-cubemx generated <<<'

// 标记行必须独占一行，并允许行首缩进、行尾空格与 CRLF 等空白差异。
const START_RE = /^[ \t]*#[ \t]*>>>[ \t]*ch32-cubemx[ \t]+generated[ \t]*>>>[ \t]*\r?$/m
const END_RE = /^[ \t]*#[ \t]*<<<[ \t]*ch32-cubemx[ \t]+generated[ \t]*<<<[ \t]*\r?$/m

/** 标记区位置：innerStart 为起始标记行换行后的偏移，innerEnd 为结束标记行行首偏移。 */
interface RegionSpan {
  innerStart: number
  innerEnd: number
}

/** 定位首个有效标记区（起始在前、结束在后）；任一行缺失或顺序颠倒返回 null。 */
function findRegionSpan(text: string): RegionSpan | null {
  const start = START_RE.exec(text)
  if (!start) return null
  const afterStart = start.index + start[0].length
  const end = END_RE.exec(text.slice(afterStart))
  if (!end) return null

  // 跳过起始标记行剩余的行尾（\r\n 或 \n）；结束标记行之前的换行保留在区内。
  let innerStart = afterStart
  if (text[innerStart] === '\r') innerStart++
  if (text[innerStart] === '\n') innerStart++
  return { innerStart, innerEnd: afterStart + end.index }
}

/** 文本是否含一对有效的生成标记。 */
export function hasGeneratedMarkers(text: string): boolean {
  return findRegionSpan(text) !== null
}

/** 提取标记区内文本（不含两条标记行，保留结束标记行前的换行）；无有效标记时返回 null。 */
export function extractGeneratedRegion(text: string): string | null {
  const span = findRegionSpan(text)
  return span ? text.slice(span.innerStart, span.innerEnd) : null
}

/**
 * 合并重新生成的 Cargo.toml：
 * - existing 含标记区：只把标记区内内容替换为 generated 的标记区内容，标记区外用户内容原样保留；
 * - existing 不含标记区（用户自有 Cargo.toml）：原样返回，绝不覆盖（生成一次语义）；
 * - existing 为空 / 不存在：返回 generated（首次生成）。
 * generated 缺少标记区（模板异常）时保守返回 existing，避免误删用户文件。
 */
export function mergeCargoToml(existing: string, generated: string): string {
  if (!existing || existing.trim() === '') return generated
  const span = findRegionSpan(existing)
  if (!span) return existing
  const region = extractGeneratedRegion(generated)
  if (region === null) return existing
  return existing.slice(0, span.innerStart) + region + existing.slice(span.innerEnd)
}