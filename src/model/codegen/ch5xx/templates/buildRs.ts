// build.rs（ch5xx 新增）：ch5xx-hal 不提供应用的 link.x/memory.x 链接参数，
// 需要二进制 crate 自己发 -Tlink.x；memory.x 由 HAL 的 memory-x feature 写入 OUT_DIR 并提供 link-search。
export const BUILD_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
fn main() {
    // 与 reference/ch5xx-hal/examples/ch582/build.rs 一致：link.x 由 qingke-rt 提供，
    // memory.x 来自 ch5xx-metapac 的 memory-x feature（已写入 OUT_DIR）。
    println!("cargo:rustc-link-arg-bins=-Tlink.x");
}
`