//! Minimal UART1 (PA9) logger.
//!
//! The M18 test firmware logs on UART1/PA9 through the CH-Link bridge. This
//! module keeps the same wiring so the existing capture script still works.

use core::fmt::{self, Write};

use ch5xx_hal as hal;
use hal::mode::Blocking;
use hal::peripherals::{PA9, UART1};
use hal::uart::{Config, UartTx};

static mut SERIAL: Option<UartTx<'static, UART1, Blocking>> = None;

/// Configure UART1 on PA9 as a blocking transmitter.
pub fn init(baud: u32) {
    let serial = UartTx::new_blocking::<0>(
        unsafe { UART1::steal() },
        unsafe { PA9::steal() },
        Config::new(baud),
    )
    .expect("UART1 config");
    unsafe { SERIAL = Some(serial) };
}

/// Write a formatted message.
pub fn print_fmt(args: fmt::Arguments<'_>) {
    unsafe {
        if let Some(serial) = (*core::ptr::addr_of_mut!(SERIAL)).as_mut() {
            let _ = serial.write_fmt(args);
            // 进入 WFI 前排空 UART；CH582 空闲时 UART 发送会停顿。
            let _ = serial.blocking_flush();
        }
    }
}

#[macro_export]
macro_rules! print {
    ($($arg:tt)*) => {
        $crate::log::print_fmt(format_args!($($arg)*))
    };
}

#[macro_export]
macro_rules! println {
    () => {
        $crate::log::print_fmt(format_args!("\r\n"))
    };
    ($($arg:tt)*) => {
        $crate::log::print_fmt(format_args!("{}\r\n", format_args!($($arg)*)))
    };
}
