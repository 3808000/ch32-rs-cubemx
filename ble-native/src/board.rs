//! Shared power-on sequence for the native binaries.

use ch5xx_hal as hal;

/// Clock tree, 32 kHz source, UART log and radio calibration.
pub fn init() {
    let _peripherals = hal::init(hal::Config {
        rcc: hal::rcc::Config::PLL_60MHZ,
    });

    crate::clock::enable_lse();
    crate::log::init(115_200);
    crate::println!("=== M19 native BLE (no WCH blob) ===");

    crate::rf::init(crate::rf::TX_POWER_0_DBM);
    crate::println!("rf init done (0 dBm, LSE)");
}
