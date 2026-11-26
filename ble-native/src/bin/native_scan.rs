//! M19 native scanner: listens 100 ms on each of channels 37/38/39 in turn and
//! decodes legacy advertising PDUs. No WCH BLE library linked.
//!
//! Logging is deduplicated by address (and re-emitted when a name first
//! appears in a scan response) so the UART write time does not dominate the
//! receive duty cycle in a dense 2.4 GHz environment.
//!
//! Host criterion: with a controlled advertiser (`peer_advertiser_m19.py`,
//! manufacturer data `FF FF "M18-ADV"`), the UART log shows that marker with
//! its address and RSSI.

#![no_std]
#![no_main]
#![allow(static_mut_refs)]

use core::str;
use core::sync::atomic::{AtomicU32, Ordering};

use ble_native::adv;
use ble_native::{board, println, rf};
use panic_halt as _;
use qingke_rt::entry;

/// 每个广播信道驻留 100 ms。
const WINDOW_SLOTS: u32 = 160;
/// Address cache size for log deduplication.
const SEEN_MAX: usize = 64;

static FRAMES: AtomicU32 = AtomicU32::new(0);
static LOGGED: AtomicU32 = AtomicU32::new(0);

#[derive(Clone, Copy)]
struct Seen {
    addr: [u8; 6],
    named: bool,
}

static mut SEEN: [Seen; SEEN_MAX] = [Seen {
    addr: [0; 6],
    named: false,
}; SEEN_MAX];
static mut SEEN_N: usize = 0;
static mut SEEN_NEXT: usize = 0;

/// Returns true when this frame should be logged: a new address, or the first
/// frame carrying a name for an address already seen without one.
fn should_log(addr: &[u8; 6], has_name: bool) -> bool {
    unsafe {
        let table = &mut *core::ptr::addr_of_mut!(SEEN);
        let n = *core::ptr::addr_of!(SEEN_N);
        for entry in table[..n].iter_mut() {
            if &entry.addr == addr {
                if has_name && !entry.named {
                    entry.named = true;
                    return true;
                }
                return false;
            }
        }
        let next = *core::ptr::addr_of!(SEEN_NEXT);
        table[next] = Seen {
            addr: *addr,
            named: has_name,
        };
        let next = (next + 1) % SEEN_MAX;
        *core::ptr::addr_of_mut!(SEEN_NEXT) = next;
        if n < SEEN_MAX {
            *core::ptr::addr_of_mut!(SEEN_N) = n + 1;
        }
        true
    }
}

#[entry]
fn main() -> ! {
    board::init();
    println!("native scan: legacy adv on 37/38/39");

    let mut cycles = 0u32;
    let mut deadline = rf::now();
    let mut pdu = [0u8; 257];
    loop {
        for channel in [37u8, 38, 39] {
            deadline = deadline.after_slots(WINDOW_SLOTS);
            let link = rf::Link::advertising(channel);
            rf::rx_start(link);

            // 窗口截止时间独立于帧率。每帧后原地重臂，直到轮到下个信道。
            loop {
                rf::wait(deadline, || rf::rx_end().is_some());
                if rf::now().reached(deadline) {
                    break;
                }
                if let Some(frame) = rf::take_rx(&mut pdu) {
                    rf::rx_start(link);
                    if let Some(report) = adv::parse(frame.pdu, frame.rssi, channel) {
                        FRAMES.fetch_add(1, Ordering::Relaxed);
                        let name = adv::find_name(report.adv_data)
                            .and_then(|n| str::from_utf8(n).ok())
                            .unwrap_or("");
                        // 给 115200 波特率的诊断日志预留一整行的发送时间。
                        let now = rf::now();
                        if !now.after_us(15_000).reached(deadline)
                            && should_log(&report.addr, !name.is_empty())
                        {
                            let mut addr = [0u8; 17];
                            adv::format_addr(&report.addr, &mut addr);
                            let count = LOGGED.fetch_add(1, Ordering::Relaxed) + 1;
                            let mut mfg = [0u8; 32];
                            let mfg = adv::find_ad(report.adv_data, 0xff)
                                .map(|d| {
                                    let n = adv::hex_preview(d, &mut mfg);
                                    str::from_utf8(&mfg[..n]).unwrap_or("?")
                                })
                                .unwrap_or("");
                            println!(
                                "#{} ch{} type0x{:02x} {} rssi {} name \"{}\" mfg \"{}\"",
                                count,
                                report.channel,
                                report.pdu_type,
                                str::from_utf8(&addr).unwrap_or("?"),
                                report.rssi,
                                name,
                                mfg
                            );
                        }
                    }
                }
            }
            rf::stop();
        }

        cycles += 1;
        if cycles % 10 == 0 {
            println!(
                "scan cycles {}, frames {}, unique {}",
                cycles,
                FRAMES.load(Ordering::Relaxed),
                unsafe { *core::ptr::addr_of!(SEEN_N) }
            );
        }
    }
}
