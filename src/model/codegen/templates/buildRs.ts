// 单核工程 build.rs（仅注入 -Tlink.x 链接参数）
export const BUILD_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
// memory.x 由 ch32-hal 的 memory-x feature（metapac 自动渲染）提供，此处只需注入链接参数。
fn main() {
    println!("cargo:rustc-link-arg-bins=-Tlink.x");
}
`
