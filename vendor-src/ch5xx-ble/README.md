# ch5xx-ble

WCH CH58x BLE 5.x stack shim for [`ch5xx-hal`](https://github.com/ch32-rs/ch5xx-hal)
and [`ch5xx-metapac`](https://github.com/ch32-rs/ch5xx-metapac).

`ch5xx-hal` does not implement BLE. This crate keeps the BLE wrapper layer from
[`ch32-rs/ch58x-hal`](https://github.com/ch32-rs/ch58x-hal) and re-targets the
small platform-glue surface (temperature sensor, entropy, SysTick rate, 32 kHz
clock, UART log hook) at the `ch5xx` PAC. The linkable stack itself is WCH's
precompiled library; there is no reverse-engineered BLE implementation here.

## Provenance / attribution

* `src/ffi.rs`, `src/gap.rs`, `src/gatt.rs`, `src/gatt_uuid.rs`,
  `src/gattservapp.rs`, `src/linkdb.rs` are copied verbatim (PAC-independent)
  from `ch32-rs/ch58x-hal` at `611954e`, `src/ble/`.
  Copyright (c) 2023 Andelf. Licensed MIT OR Apache-2.0; see `LICENSE-MIT` and
  `LICENSE-APACHE` in this directory.
* `src/lib.rs` is derived from the same revision's `src/ble/mod.rs` plus the
  register sequences of `src/sysctl.rs`, adapted to `ch5xx-metapac` per
  `docs/CH5XX_BACKEND_CONTRACT.md` D3.
* `vendor/LIBCH58xBLE.a` and `vendor/libISP583.a` are **WCH proprietary
  precompiled binaries**, taken unchanged from `ch58x-hal/vendor/`. They are
  not covered by the MIT/Apache-2.0 licence above; use is subject to WCH's
  terms. Link name mapping: `LIBCH58xBLE.a` -> `-lCH58xBLE`,
  `libISP583.a` -> `-lISP583`.

## Scope

* Target: CH582/CH583 (`pac::SYS` 32 kHz block, `pac::TOUCHKEY` shared with the
  ADC). Other CH5xx parts are untested and may need different register paths.
* Not ported in this milestone: PA (external RF front-end) control. The stack
  is initialised with `PaConfig = None`, so `BLE_PAControlInit` is never
  called.
* No SNV/bonding flash callbacks, no sleep callbacks: the config keeps the
  legacy `init()` defaults (RAM-only bonding).

## Usage

```rust
let p = ch5xx_hal::init(ch5xx_hal::Config {
    rcc: ch5xx_hal::rcc::presets::PLL_60MHZ,
});
ch5xx_ble::enable_lse();
let (task_id, events) = ch5xx_ble::init(ch5xx_ble::Config {
    mac_lsb: [0x11, 0x22, 0x33, 0x44, 0x55, 0x66],
    sel_rtc_clock: 0, // LSE 32768 Hz
    rc_cb: None,
})
.unwrap();
```

The application must install `LLE_IRQLibHandler` and `BB_IRQLibHandler` in the
`BLEL` and `BLEB` vectors and call `TMOS_SystemProcess()` from its main loop.

Build requires nightly Rust with `rust-src` (the `ch5xx-hal` examples use
`build-std = ["core"]`). See `docs/m17-shim-notes.md` in the configurator repo
for the build proof and toolchain ruling.