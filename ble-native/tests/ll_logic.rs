//! 直接用宿主 rustc 运行，测试与 CH582 寄存器无关的协议状态。

#![allow(dead_code)]

#[path = "../src/adv.rs"]
mod adv;
#[path = "../src/att.rs"]
mod att;
#[path = "../src/gatt.rs"]
mod gatt;
#[path = "../src/l2cap.rs"]
mod l2cap;
#[path = "../src/ll.rs"]
mod ll;
#[path = "protocol/phase_c.rs"]
mod phase_c;
#[path = "../src/schedule.rs"]
mod schedule;

use ll::{ConnectInd, Connection, MAX_PDU};
use schedule::Instant;

const ADDR: [u8; 6] = [1, 2, 3, 4, 5, 6];

fn connect_ind() -> [u8; 36] {
    [
        0x25,
        34,
        6,
        5,
        4,
        3,
        2,
        1,
        1,
        2,
        3,
        4,
        5,
        6,
        0x9e,
        0xca,
        0x57,
        0x5d,
        0x12,
        0x34,
        0x56,
        2,
        3,
        0,
        36,
        0,
        0,
        0,
        72,
        0,
        0b0000_1001,
        0,
        0,
        0,
        0,
        5,
    ]
}

fn connection(at: Instant) -> Connection {
    Connection::new(ConnectInd::parse(&connect_ind(), &ADDR).unwrap(), at)
}

#[test]
fn connect_ind_validates_address_timing_and_map() {
    let mut pdu = connect_ind();
    let request = ConnectInd::parse(&pdu, &ADDR).unwrap();
    assert_eq!(request.access, 0x5d57ca9e);
    assert_eq!(request.crc_init, 0x563412);
    assert_eq!(request.interval_slots(), 72);
    assert!(ConnectInd::parse(&pdu, &[0; 6]).is_none());
    assert!(ConnectInd::parse(&pdu[..35], &ADDR).is_none());
    pdu[0] |= 0x80;
    assert!(ConnectInd::parse(&pdu, &ADDR).is_none());
    pdu[0] &= !0x80;
    pdu[30] = 1;
    assert!(ConnectInd::parse(&pdu, &ADDR).is_none());
    pdu[30] = 9;
    pdu[28] = 9;
    assert!(ConnectInd::parse(&pdu, &ADDR).is_none());
}

#[test]
fn window_tracks_first_packet_and_csa1_advances_through_misses() {
    let request_end = Instant(u32::MAX - 2500);
    let window_start = request_end.after_slots(8);
    let mut link = connection(request_end);

    let window = link.open_event();
    assert_eq!(window.channel, 3); // 5 mod 2，映射到可用信道 [0, 3] 的第二项。
    assert!(window_start.reached(window.start));
    assert!(window.end.reached(window_start.after_slots(4)));
    link.close_event();

    let window = link.open_event();
    assert_eq!(window.channel, 0); // 第二个连接事件使用 unmapped = 10。
    let anchor = window_start.after_slots(73);
    assert!(anchor.reached(window.start));
    assert!(window.end.reached(anchor));
    link.on_air_packet(anchor, true);
    link.close_event();

    let window = link.open_event();
    assert_eq!(window.channel, 3);
    assert!(anchor.after_slots(72).reached(window.start));
    assert!(window.end.reached(anchor.after_slots(72)));
    assert!(!window.end.reached(anchor.after_slots(73)));
    assert_eq!(link.stats.missed, 1);
}

#[test]
fn supervision_expires_at_deadline_and_after_six_unheard_events() {
    let start = Instant(0);
    let mut link = connection(start);
    for _ in 0..6 {
        link.open_event();
        link.close_event();
    }
    assert!(link.timed_out(start.after_slots(432)));

    let mut link = connection(start);
    let first = start.after_slots(8);
    link.open_event();
    link.on_air_packet(first, true);
    link.close_event();
    let expires = first.after_slots(72 * 16);
    assert!(!link.timed_out(expires.before_us(1)));
    link.on_air_packet(first.after_slots(72), false);
    assert!(link.timed_out(expires));
    assert_eq!(link.stats.crc_errors, 1);
}

#[test]
fn ack_toggles_sn_and_repeats_control_until_acknowledged() {
    let mut link = connection(Instant(0));
    let mut reply = [0; MAX_PDU];
    let feature_request = [0x03, 9, 0x08, 0, 0, 0, 0, 0, 0, 0, 0];

    assert_eq!(link.reply(&feature_request, &mut reply, &mut ()), Some(11));
    assert_eq!(&reply[..3], &[0x07, 9, 0x09]);
    link.sent();
    assert_eq!(link.reply(&feature_request, &mut reply, &mut ()), Some(11));
    assert_eq!(&reply[..3], &[0x07, 9, 0x09]);
    assert_eq!(link.stats.duplicates, 1);
    assert_eq!(link.stats.retransmits, 1);

    assert_eq!(link.reply(&[0x0d, 0], &mut reply, &mut ()), Some(2));
    assert_eq!(&reply[..2], &[0x09, 0]);
    link.sent();
    assert_eq!(link.reply(&[0x01, 0], &mut reply, &mut ()), Some(2));
    assert_eq!(&reply[..2], &[0x05, 0]);
}

#[test]
fn map_update_applies_at_instant() {
    let mut link = connection(Instant(0));
    let mut reply = [0; MAX_PDU];
    assert_eq!(link.open_event().channel, 3);
    assert_eq!(
        link.reply(&[3, 8, 1, 0x50, 0, 0, 0, 0, 2, 0], &mut reply, &mut ()),
        Some(2)
    );
    link.close_event();
    assert_eq!(link.open_event().channel, 0);
    link.close_event();
    assert_eq!(link.open_event().channel, 6);
}

#[test]
fn defers_connection_update_until_its_instant_and_reanchors() {
    let start = Instant(0);
    let mut link = connection(start);
    let mut reply = [0; MAX_PDU];
    link.open_event();
    let anchor = start.after_slots(8);
    link.on_air_packet(anchor, true);
    let update = [3, 12, 0, 2, 1, 0, 24, 0, 0, 0, 72, 0, 2, 0];
    assert_eq!(link.reply(&update, &mut reply, &mut ()), Some(2));
    link.close_event();

    let window = link.open_event();
    assert!(anchor.after_slots(72).reached(window.start));
    assert!(!window.end.reached(anchor.after_slots(74)));
    link.close_event();

    let window = link.open_event();
    let requested_start = anchor.after_slots(2 * 72 + 2);
    assert!(!anchor.after_slots(2 * 72).reached(window.start));
    assert!(requested_start.reached(window.start));
    let new_anchor = requested_start.after_slots(1);
    assert!(window.end.reached(new_anchor));
    link.on_air_packet(new_anchor, true);
    link.close_event();
    let window = link.open_event();
    assert!(new_anchor.after_slots(48).reached(window.start));
    assert!(window.end.reached(new_anchor.after_slots(48)));
}

#[test]
fn missed_tx_deadline_retains_unsent_control() {
    let mut link = connection(Instant(0));
    let mut reply = [0; MAX_PDU];
    let feature_request = [0x03, 9, 0x08, 0, 0, 0, 0, 0, 0, 0, 0];
    assert_eq!(link.reply(&feature_request, &mut reply, &mut ()), Some(11));
    // 调度过晚，未调用 sent()。重收同一 PDU 后仍然回原先的控制应答。
    assert_eq!(link.reply(&feature_request, &mut reply, &mut ()), Some(11));
    assert_eq!(&reply[..3], &[0x07, 9, 0x09]);
    assert_eq!(link.stats.retransmits, 0);
}
