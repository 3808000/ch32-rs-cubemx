//! Diagnostic: park the receiver on channel 37 and dump every frame raw.
//!
//! Used to separate "channel-hopping schedule misses the peer" from "the RX
//! path cannot demodulate the peer at all".

#![no_std]
#![no_main]
#![allow(static_mut_refs)]

use core::str;

use ble_native::adv;
use ble_native::{board, println, rf};
use panic_halt as _;
use qingke_rt::entry;

#[entry]
fn main() -> ! {
    let mut delay = board::init();
    println!("diag rx37 raw probe");

    let mut n = 0u32;
    loop {
        rf::rx_start(adv::ACCESS_ADDRESS, 37, rf::Phy::M1);
        let mut got = false;
        for _ in 0..1000 {
            if rf::rx_ready() {
                got = true;
                break;
            }
            delay.delay_us(100);
        }
        if got {
            let rssi = rf::rssi();
            let raw = rf::rx_buf();
            let len = raw[1] as usize;
            let mut hex = [0u8; 96];
            let hn = adv::hex_preview(&raw[..2 + len.min(30)], &mut hex);
            n += 1;
            println!(
                "#{} rssi {} hdr {:02x} len {} raw \"{}\"",
                n,
                rssi,
                raw[0],
                len,
                str::from_utf8(&hex[..hn]).unwrap_or("?")
            );
        } else {
            rf::stop();
        }
        rf::rx_clear();
    }
}
