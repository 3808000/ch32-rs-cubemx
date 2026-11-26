//! M19 单连接 LE 1M GATT Peripheral 固件。

#![no_std]
#![no_main]

#[cfg(not(feature = "pairing"))]
use ble_native::l2cap;
use ble_native::ll::{ConnectInd, Connection, MAX_PDU, MD};
use ble_native::schedule::Instant;
#[cfg(feature = "pairing")]
use ble_native::security::{self, PeripheralSecurity};
use ble_native::{adv, board, println, rf, MAC_LSB};
use ble_native::{att, gatt};
use panic_halt as _;
use qingke_rt::entry;

const ADV_SLOTS: u32 = 160;
const TX_SETTLE_US: u32 = 100;
const T_IFS_US: u32 = 150;
// CH582M / 60 MHz：LLE TMR 唤醒、退出临界区到 LL0 写入约 9–10 µs。
const TX_WAKE_US: u32 = 10;

fn earlier(a: Instant, b: Instant) -> Instant {
    if a.reached(b) {
        b
    } else {
        a
    }
}

fn air_time_us(pdu_len: usize) -> u32 {
    // LE 1M：前导 1 B、接入地址 4 B、CRC 3 B。
    (pdu_len as u32 + 8) * 8
}

fn advertise(pdu: &[u8]) -> (ConnectInd, Instant, u32) {
    let mut next = rf::now();
    let mut packet = [0; 257];
    loop {
        rf::wait(next, || false);
        next = next.after_slots(ADV_SLOTS);
        for channel in [37, 38, 39] {
            let link = rf::Link::advertising(channel);
            rf::tx_prepare(link, pdu);
            rf::wait(rf::now().after_us(TX_SETTLE_US), || false);
            let trigger = rf::now();
            rf::tx_start();
            rf::wait(trigger.after_us(5_000), || rf::tx_end().is_some());
            let Some(end) = rf::tx_end() else {
                rf::stop();
                continue;
            };
            let tx_lead = (end.elapsed_ticks(trigger) / 2).saturating_sub(air_time_us(pdu.len()));
            let deadline = end.after_slots(1);
            rf::rx_start(link);
            while !rf::now().reached(deadline) {
                rf::wait(deadline, || rf::rx_end().is_some());
                let Some(frame) = rf::take_rx(&mut packet) else {
                    break;
                };
                if frame.crc_ok {
                    if let Some(request) = ConnectInd::parse(frame.pdu, &MAC_LSB) {
                        return (request, frame.end, tx_lead);
                    }
                }
                if !rf::now().reached(deadline) {
                    rf::rx_start(link);
                }
            }
            rf::stop();
        }
    }
}

fn connected(
    request: ConnectInd,
    end: Instant,
    tx_lead: u32,
    #[cfg(feature = "pairing")] controller: &mut PeripheralSecurity,
) {
    let mut connection = Connection::new(request, end);
    #[cfg(not(feature = "pairing"))]
    let mut channel = l2cap::AttChannel::new();
    #[cfg(feature = "pairing")]
    let mut channel = controller.connect(request.initiator);
    let mut server = att::Server::new();
    #[cfg(feature = "pairing")]
    server.lock(true);
    let mut rx = [0; 257];
    let mut tx = [0; MAX_PDU];
    let mut next_report = end.after_slots(16_000);
    // 启动至发射的额外延迟来自当前板上相同 PHY 的广播测量。
    let lead = tx_lead.min(100);
    let mut first_valid = false;
    let mut late = 0;
    let mut tx_timeouts = 0;

    while !connection.terminated && !connection.timed_out(rf::now()) {
        let window = connection.open_event();
        let supervision = connection.supervision_deadline();
        let mut listen_until = earlier(window.end, supervision);
        let link = rf::Link {
            access: request.access,
            crc_init: request.crc_init,
            channel: window.channel,
            phy: rf::Phy::M1,
        };
        rf::wait(earlier(window.start, supervision), || false);
        if !rf::now().reached(listen_until) {
            rf::rx_start(link);
            loop {
                rf::wait(listen_until, || rf::rx_end().is_some());
                let Some(frame) = rf::take_rx(&mut rx) else {
                    break;
                };
                if frame.end.reached(listen_until) || frame.pdu.len() > MAX_PDU {
                    break;
                }

                let start = frame.end.before_us(air_time_us(frame.pdu.len()));
                connection.on_air_packet(start, frame.crc_ok);
                if !frame.crc_ok {
                    break;
                }
                let Some(len) = connection.reply(frame.pdu, &mut tx, &mut channel) else {
                    break;
                };
                let launch = frame.end.after_us(T_IFS_US - lead - TX_WAKE_US);
                if !rf::tx_prepare(link, &tx[..len]) || rf::now().reached(launch) {
                    rf::stop();
                    late += 1;
                    break;
                }
                rf::wait(launch, || false);
                rf::tx_start();
                connection.sent();
                rf::wait(launch.after_us(500), || rf::tx_end().is_some());

                let Some(tx_end) = rf::tx_end() else {
                    tx_timeouts += 1;
                    break;
                };
                if connection.terminated || (frame.pdu[0] | tx[0]) & MD == 0 {
                    break;
                }
                listen_until = earlier(
                    tx_end.after_us(T_IFS_US + air_time_us(MAX_PDU) + 50),
                    connection.next_anchor().before_us(400),
                );
                if rf::now().reached(listen_until) {
                    break;
                }
                rf::rx_start(link);
            }
        }
        rf::stop();
        let next = connection.next_anchor();
        connection.close_event();
        #[cfg(not(feature = "pairing"))]
        channel.process(&mut server);
        #[cfg(feature = "pairing")]
        {
            channel.process(controller, &mut connection, &mut server, rf::now());
            loop {
                let room = next.elapsed_ticks(rf::now());
                // 点运算最多一个步骤；CMAC 派生有单独的时序余量。
                if !(7_000..(1 << 31)).contains(&room) || !channel.work_step() {
                    break;
                }
            }
        }
        let gap = next.elapsed_ticks(rf::now());
        if gap > 7_000 && gap < (1 << 31) && !first_valid && connection.stats.received != 0 {
            first_valid = true;
            println!("LL up interval={} lead={}", request.interval_slots(), lead);
        } else if gap > 23_000 && gap < (1 << 31) && rf::now().reached(next_report) {
            next_report = next_report.after_slots(16_000);
            let s = connection.stats;
            println!(
                "LL ev={} miss={} crc={} rx={} dup={} retx={}",
                s.events, s.missed, s.crc_errors, s.received, s.duplicates, s.retransmits
            );
        }
    }
    #[cfg(feature = "pairing")]
    if let Some(event) = channel.event() {
        println!("SM {}", event);
    }
    #[cfg(feature = "pairing")]
    let peer = connection.terminated && !channel.failed();
    #[cfg(not(feature = "pairing"))]
    let peer = connection.terminated;
    let s = connection.stats;
    println!(
        "LL end peer={} ev={} miss={} crc={} rx={} dup={} retx={} late={} tx_timeout={}",
        peer,
        s.events,
        s.missed,
        s.crc_errors,
        s.received,
        s.duplicates,
        s.retransmits,
        late,
        tx_timeouts
    );
}

#[entry]
fn main() -> ! {
    board::init();
    #[cfg(not(feature = "pairing"))]
    println!("M19 Phase C GATT peripheral");
    #[cfg(feature = "pairing")]
    let mut controller = {
        println!("M19 Phase D waiting for seed");
        let security = PeripheralSecurity::new(security::provision(), MAC_LSB);
        println!("M19 Phase D seed ready");
        security
    };
    let mut ad = [0; 31];
    let mut len = adv::ad_flags(0x06, &mut ad);
    len += adv::ad_name(gatt::DEVICE_NAME, &mut ad[len..]);
    let mut pdu = [0; 39];
    let len = adv::build_adv_ind(&mut pdu, &MAC_LSB, &ad[..len]).expect("ADV_IND");
    loop {
        #[cfg(feature = "pairing")]
        controller.prepare();
        let (request, end, tx_lead) = advertise(&pdu[..len]);
        connected(
            request,
            end,
            tx_lead,
            #[cfg(feature = "pairing")]
            &mut controller,
        );
    }
}
