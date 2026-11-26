use crate::att::{Server, MAX_MTU};
use crate::l2cap::AttChannel;
use crate::ll::{DataChannel, CONTINUATION, MAX_PDU, START};
use crate::schedule::Instant;

#[test]
fn discovery_pages_use_uniform_uuid_widths() {
    let mut server = Server::new();
    let mut out = [0; MAX_MTU];
    let len = server.request(&[0x10, 1, 0, 0xff, 0xff, 0, 0x28], &mut out);
    assert_eq!(&out[..len], &[0x11, 6, 1, 0, 5, 0, 0, 0x18]);
    let len = server.request(&[0x10, 6, 0, 0xff, 0xff, 0, 0x28], &mut out);
    assert_eq!(len, 22);
    assert_eq!(&out[..6], &[0x11, 20, 6, 0, 9, 0]);
    let mut by_value = vec![0x06, 1, 0, 0xff, 0xff, 0, 0x28];
    by_value.extend_from_slice(&out[6..22]);
    let len = server.request(&by_value, &mut out);
    assert_eq!(&out[..len], &[7, 6, 0, 9, 0]);
    let len = server.request(&[0x04, 8, 0, 9, 0], &mut out);
    assert_eq!(len, 20);
    assert_eq!(&out[..4], &[5, 2, 8, 0]);
    let len = server.request(&[0x04, 9, 0, 9, 0], &mut out);
    assert_eq!(&out[..len], &[5, 1, 9, 0, 2, 0x29]);
    let len = server.request(&[0x08, 7, 0, 9, 0, 3, 0x28], &mut out);
    assert_eq!(len, 23);
    assert_eq!(&out[..7], &[0x09, 21, 7, 0, 0x1e, 8, 0]);
}

#[test]
fn write_permissions_mtu_and_subscription_errors_keep_state_consistent() {
    let mut server = Server::new();
    let mut out = [0; MAX_MTU];
    let len = server.request(&[2, 22, 0], &mut out);
    assert_eq!(&out[..len], &[1, 2, 0, 0, 4]);
    let len = server.request(&[0x12, 3, 0, 1], &mut out);
    assert_eq!(&out[..len], &[1, 0x12, 3, 0, 3]);
    let len = server.request(&[0x12, 9, 0, 2, 0], &mut out);
    assert_eq!(&out[..len], &[1, 0x12, 9, 0, 0x13]);
    let len = server.request(&[0x0a, 99, 0], &mut out);
    assert_eq!(&out[..len], &[1, 0x0a, 99, 0, 1]);
    let len = server.request(&[0x0c, 8, 0, 99, 0], &mut out);
    assert_eq!(&out[..len], &[1, 0x0c, 8, 0, 7]);
    assert_eq!(server.notification(&mut out), 0);
    assert_eq!(server.request(&[0x12, 9, 0, 1, 0], &mut out), 1);
    assert_eq!(server.request(&[0x52, 8, 0, 0xaa], &mut out), 0);
    let len = server.notification(&mut out);
    assert_eq!(&out[..len], &[0x1b, 8, 0, 0xaa]);
    assert_eq!(server.request(&[0x12, 9, 0, 0, 0], &mut out), 1);
    assert_eq!(server.request(&[0x12, 8, 0, 0xbb], &mut out), 1);
    assert_eq!(server.notification(&mut out), 0);
    let len = Server::new().request(&[0x0a, 9, 0], &mut out);
    assert_eq!(&out[..len], &[0x0b, 0, 0]);
}

#[test]
fn l2cap_reassembles_then_splits_a_full_mtu_notification() {
    let mut channel = AttChannel::new();
    let mut server = Server::new();
    assert!(channel.receive(START, &[3, 0])); // 分片也可以横跨 Basic Header。
    assert!(channel.receive(CONTINUATION, &[4, 0, 2, 64, 0]));
    assert!(!channel.receive(START, &[1, 0, 4, 0, 0x0a]));
    channel.process(&mut server);
    assert_eq!(
        channel.transmit(),
        Some((START, &[3, 0, 4, 0, 3, 64, 0][..]))
    );

    assert!(channel.receive(START, &[5, 0, 4, 0, 0x12, 9, 0, 1, 0]));
    channel.process(&mut server);
    assert_eq!(channel.transmit(), Some((START, &[1, 0, 4, 0, 0x13][..])));

    let mut write = vec![64, 0, 4, 0, 0x12, 8, 0];
    write.extend(0..61);
    for (index, chunk) in write.chunks(27).enumerate() {
        assert!(channel.receive(if index == 0 { START } else { CONTINUATION }, chunk));
        channel.process(&mut server);
        if index < 2 {
            assert!(!channel.has_pending());
        }
    }
    assert_eq!(channel.transmit(), Some((START, &[1, 0, 4, 0, 0x13][..])));
    channel.process(&mut server);
    let mut notification = vec![64, 0, 4, 0, 0x1b, 8, 0];
    notification.extend(0..61);
    for (index, chunk) in notification.chunks(27).enumerate() {
        let llid = if index == 0 { START } else { CONTINUATION };
        assert_eq!(channel.transmit(), Some((llid, chunk)));
    }
    assert!(!channel.has_pending());
}

#[test]
fn ll_data_retransmit_does_not_consume_another_fragment() {
    let mut link = super::connection(Instant(0));
    let mut channel = AttChannel::new();
    let mut server = Server::new();
    let mut out = [0; MAX_PDU];
    let read = [START, 7, 3, 0, 4, 0, 0x0a, 8, 0];
    assert_eq!(link.reply(&read, &mut out, &mut channel), Some(2));
    link.sent();
    channel.process(&mut server);
    assert_eq!(link.reply(&read, &mut out, &mut channel), Some(2));
    assert!(channel.has_pending());
    let ack = [0x0d, 0];
    let len = link.reply(&ack, &mut out, &mut channel).unwrap();
    let staged = out;
    assert_eq!(&out[2..len], b"\x06\x00\x04\x00\x0bready");
    link.sent();
    assert!(!channel.has_pending());
    assert_eq!(link.reply(&ack, &mut out, &mut channel), Some(len));
    assert_eq!(&staged[..len], &out[..len]);
    channel.process(&mut server);
    assert!(!channel.has_pending());
    assert_eq!(link.reply(&[1, 0], &mut out, &mut channel), Some(2));
}
