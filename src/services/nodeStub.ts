// 浏览器端空 stub：ejs 惰性引用 fs/path，实际不会调用。
// 见 vite.config.ts 的 resolve.alias。
export default {}
export const readFileSync = () => {
  throw new Error('fs stub: 浏览器端不可用')
}
export const join = (...parts: string[]) => parts.join('/')
export const resolve = (...parts: string[]) => parts.join('/')
export const dirname = (p: string) => p.split('/').slice(0, -1).join('/')
export const basename = (p: string) => p.split('/').pop() ?? ''
export const extname = (p: string) => {
  const b = p.split('/').pop() ?? ''
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i) : ''
}