//! Rust-native CH582/583 BLE link layer (no WCH BLE blob).
//!
//! M19：BLE 射频驱动、广播/扫描、单连接 LL 与 GATT 服务端。
//! The register-level facts (addresses, bit fields and the TX/RX calibration
//! sequences) are ported from the MIT-licensed ch32fun `iSLER` project; see
//! `NOTICE` and `docs/M19_NATIVE_BLE_CONTRACT.md` for provenance. No WCH
//! library object is linked by this crate.
//!
//! Modules:
//! - [`rf`]: BB/LLE/RF register driver, calibration, TX/RX primitives, ISR
//! - [`adv`]: legacy advertising PDU construction and scanner-side parsing
//! - [`clock`]: LSE selection (CK32K domain)
//! - [`log`]: UART1 PA9 logger
//! - [`board`]: shared power-on sequence for the binaries

#![no_std]
#![allow(static_mut_refs)]

#[cfg(target_arch = "riscv32")]
pub use ch5xx_hal as hal;
#[cfg(target_arch = "riscv32")]
pub use qingke_rt;

pub mod adv;
pub mod att;
#[cfg(target_arch = "riscv32")]
pub mod board;
#[cfg(target_arch = "riscv32")]
pub mod clock;
#[cfg(feature = "pairing")]
mod crypto;
pub mod gatt;
pub mod l2cap;
pub mod ll;
#[cfg(target_arch = "riscv32")]
pub mod log;
#[cfg(target_arch = "riscv32")]
pub mod rf;
pub mod schedule;
#[cfg(feature = "pairing")]
pub mod security;
#[cfg(feature = "pairing")]
mod sm;

/// Factory MAC `0C:3D:5E:A6:62:94` in over-the-air (LSB-first) order.
///
/// The M17/M18 firmware uses this address; the native stack reads it from a
/// constant until an InfoFlash reader exists.
pub const MAC_LSB: [u8; 6] = [0x94, 0x62, 0xA6, 0x5E, 0x3D, 0x0C];

/// Advertising name used by the native test binaries.
pub const ADV_NAME: &str = "M18-NATIVE";
