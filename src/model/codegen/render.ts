// EJS 渲染：同一模板字符串只编译一次（client:true，生成期无文件系统依赖）。
import * as ejs from 'ejs'

type CompiledTpl = (data: Record<string, unknown>) => string
const compileCache = new Map<string, CompiledTpl>()

export function render(tpl: string, data: Record<string, unknown>): string {
  let fn = compileCache.get(tpl)
  if (!fn) {
    fn = ejs.compile(tpl, { client: true }) as CompiledTpl
    compileCache.set(tpl, fn)
  }
  return fn(data)
}