//! M19 native advertiser: legacy `ADV_NONCONN_IND` once per 100 ms on
//! channels 37/38/39, no WCH BLE library linked.
//!
//! Host criterion: `bluetoothctl scan on` (or any LE scanner) reports a
//! device named `M18-NATIVE` with a plausible RSSI.

#![no_std]
#![no_main]
#![allow(static_mut_refs)]

use ble_native::adv;
use ble_native::{board, println, rf, ADV_NAME, MAC_LSB};
use panic_halt as _;
use qingke_rt::entry;

#[entry]
fn main() -> ! {
    board::init();

    let mut ad = [0u8; 31];
    let mut n = 0;
    n += adv::ad_flags(0x06, &mut ad[n..]); // LE General Discoverable + BR/EDR not supported
    n += adv::ad_name(ADV_NAME.as_bytes(), &mut ad[n..]);

    let mut pdu = [0u8; 40];
    let pdu_len = adv::build_adv_nonconn(&mut pdu, &MAC_LSB, &ad[..n]).expect("adv fits");

    println!("native adv: name {} pdu {} bytes", ADV_NAME, pdu_len);

    let mut rounds = 0u32;
    let mut next = rf::now();
    loop {
        rf::wait(next, || false);
        next = next.after_slots(160);
        for channel in [37u8, 38, 39] {
            rf::tx_prepare(rf::Link::advertising(channel), &pdu[..pdu_len]);
            rf::wait(rf::now().after_us(100), || false);
            rf::tx_start();
            rf::wait(rf::now().after_us(5_000), || rf::tx_end().is_some());
            if rf::tx_end().is_none() {
                rf::stop();
                println!("tx failed on channel {}", channel);
            }
        }
        rounds += 1;
        if rounds % 10 == 0 {
            println!("adv rounds {}", rounds);
        }
    }
}
