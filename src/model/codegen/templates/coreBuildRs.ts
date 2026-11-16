// 双核单个核的 build.rs（启动核额外提供 memory.x/link.x）
export const CORE_BUILD_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
<% if (mainCore) { -%>
// 启动核（V3F）：随 crate 提供 memory.x 与 link.x。
// memory.x 覆盖 metapac 的 memory-x 版本（其中没有 qingke-rt link.x 需要的 RAM 区）；
// link.x 覆盖 qingke-rt 的版本，让整个程序从零等待共享 SRAM 执行（hart0 无 I-cache）。
fn main() {
    println!("cargo:rustc-link-arg-bins=-Tlink.x");

    let out_dir = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    std::fs::write(out_dir.join("memory.x"), include_bytes!("memory.x")).unwrap();
    std::fs::write(out_dir.join("link.x"), include_bytes!("link.x")).unwrap();
    println!("cargo:rustc-link-search={}", out_dir.display());
    println!("cargo:rerun-if-changed=memory.x");
    println!("cargo:rerun-if-changed=link.x");
}
<% } else { -%>
// 从核（V5F）：只提供自己的 memory.x（FLASH/DTCM/共享 SRAM 分区）。
// device.x 由 metapac 的 rt feature 提供，此处不得遮蔽它。
fn main() {
    println!("cargo:rustc-link-arg-bins=-Tlink.x");

    let out_dir = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    std::fs::write(out_dir.join("memory.x"), include_bytes!("memory.x")).unwrap();
    println!("cargo:rustc-link-search={}", out_dir.display());
    println!("cargo:rerun-if-changed=memory.x");
}
<% } -%>
`
