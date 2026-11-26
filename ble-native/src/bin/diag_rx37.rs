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
    board::init();
    println!("diag rx37 raw probe");

    let mut n = 0u32;
    let mut pdu = [0u8; 257];
    let link = rf::Link::advertising(37);
    rf::rx_start(link);
    loop {
        rf::wait(rf::now().after_slots(160), || rf::rx_end().is_some());
        if let Some(frame) = rf::take_rx(&mut pdu) {
            rf::rx_start(link);
            let mut hex = [0u8; 96];
            let hn = adv::hex_preview(frame.pdu, &mut hex);
            n += 1;
            println!(
                "#{} rssi {} hdr {:02x} len {} raw \"{}\"",
                n,
                frame.rssi,
                frame.pdu[0],
                frame.pdu[1],
                str::from_utf8(&hex[..hn]).unwrap_or("?")
            );
        }
    }
}
