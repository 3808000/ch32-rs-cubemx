fn main() {
    // qingke-rt supplies the vector table and the highcode copy-down script.
    println!("cargo:rustc-link-arg-bins=-Tlink.x");
}
