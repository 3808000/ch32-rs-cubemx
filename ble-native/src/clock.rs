//! LSE selection for the CK32K domain.
//!
//! Sequence copied from this repository's M17/M18 shim (`ch5xx-ble::enable_lse`,
//! itself the `Clock32KSrc::LSE` branch of the legacy `ch58x-hal` freeze).

use critical_section::with;
use ch5xx_hal::pac;

const SAFE_ACCESS_SIG1: u8 = 0x57;
const SAFE_ACCESS_SIG2: u8 = 0xA8;
const SAFE_ACCESS_SIG0: u8 = 0x00;

fn with_safe_access<R>(f: impl FnOnce() -> R) -> R {
    with(|_| {
        let sig = pac::SYSTEM_CONTROL.safe_access_sig();
        unsafe { core::arch::asm!("fence.i") };
        sig.write(|w| w.set_safe_access_sig(SAFE_ACCESS_SIG1));
        sig.write(|w| w.set_safe_access_sig(SAFE_ACCESS_SIG2));
        unsafe { core::arch::asm!("fence.i") };
        let result = f();
        sig.write(|w| w.set_safe_access_sig(SAFE_ACCESS_SIG0));
        unsafe { core::arch::asm!("fence.i") };
        result
    })
}

fn delay_cycles(cycles: u32) {
    let mut delay = ch5xx_hal::delay::Delay;
    let hz = ch5xx_hal::rcc::clocks().sysclk.0;
    let us = (u64::from(cycles) * 1_000_000 / u64::from(hz)) as u32;
    if us >= 1000 {
        delay.delay_ms(us / 1000);
    }
    if us % 1000 != 0 {
        delay.delay_us(us % 1000);
    }
}

/// Power the 32.768 kHz crystal and select it as `CK32K`.
///
/// Call after `hal::init` and before the RF driver is initialised.
pub fn enable_lse() {
    with_safe_access(|| {
        pac::SYS.ck32k_config().modify(|w| w.set_clk_xt32k_pon(true));
    });
    let hz = ch5xx_hal::rcc::clocks().sysclk.0;
    delay_cycles(hz / 10 / 4);
    with_safe_access(|| {
        pac::SYS.ck32k_config().modify(|w| w.set_clk_osc32k_xt(true));
    });
    delay_cycles(hz / 1000);
}
