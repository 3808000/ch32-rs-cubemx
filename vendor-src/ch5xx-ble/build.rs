//! Link the WCH BLE and ISP blobs.
//!
//! Mirrors `ch58x-hal/build.rs` (which copied `vendor/libISP583.a` and
//! `vendor/LIBCH58xBLE.a` into `OUT_DIR` and added it to the link search
//! path). The library names are the ones the `#[link(name = ...)]` attributes
//! in `src/ffi.rs` and the WCH ISP API expect:
//!
//! * `LIBCH58xBLE.a` -> `-lCH58xBLE`
//! * `libISP583.a`   -> `-lISP583`
//!
//! ISP583 is linked for parity with the legacy stack even though this shim's
//! public API does not expose the ISP/Flash-ROM helpers; an unreferenced
//! archive member is not pulled in by the linker.

use std::path::PathBuf;
use std::{env, fs};

fn main() {
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());

    fs::write(
        out_dir.join("libCH58xBLE.a"),
        include_bytes!("vendor/LIBCH58xBLE.a"),
    )
    .unwrap();
    fs::write(
        out_dir.join("libISP583.a"),
        include_bytes!("vendor/libISP583.a"),
    )
    .unwrap();

    println!("cargo:rustc-link-search={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=CH58xBLE");
    println!("cargo:rustc-link-lib=static=ISP583");

    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=vendor/LIBCH58xBLE.a");
    println!("cargo:rerun-if-changed=vendor/libISP583.a");
}