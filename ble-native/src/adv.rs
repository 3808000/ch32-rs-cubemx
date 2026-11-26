//! Legacy advertising PDUs: construction for the transmitter and parsing for
//! the scanner.
//!
//! On-air layout (BT Core, Vol 6, Part B): access address 0x8E89BED6 followed
//! by the PDU. The baseband handles preamble, access address and CRC; this
//! module works on the PDU only.

/// Advertising-channel access address.
pub const ACCESS_ADDRESS: u32 = 0x8E89_BED6;

/// Advertising PDU types (header bits 0..3).
pub const PDU_ADV_IND: u8 = 0x00;
pub const PDU_ADV_DIRECT_IND: u8 = 0x01;
pub const PDU_ADV_NONCONN_IND: u8 = 0x02;
pub const PDU_SCAN_REQ: u8 = 0x03;
pub const PDU_SCAN_RSP: u8 = 0x04;
pub const PDU_CONNECT_IND: u8 = 0x05;
pub const PDU_ADV_SCAN_IND: u8 = 0x06;

/// AD type: flags.
pub const AD_FLAGS: u8 = 0x01;
/// AD type: complete local name.
pub const AD_NAME_COMPLETE: u8 = 0x09;

/// Build an `ADV_NONCONN_IND` PDU: `[header, length, AdvA, AdvData...]`.
///
/// Returns the PDU length (header + length + payload), or `None` if the
/// advertising data does not fit in the 31-byte legacy budget.
pub fn build_adv_nonconn(out: &mut [u8], addr: &[u8; 6], ad: &[u8]) -> Option<usize> {
    build_legacy(out, PDU_ADV_NONCONN_IND, addr, ad)
}

/// 构造 public AdvA 的可连接广播。ChSel 保持为 0，选择 CSA#1。
pub fn build_adv_ind(out: &mut [u8], addr: &[u8; 6], ad: &[u8]) -> Option<usize> {
    build_legacy(out, PDU_ADV_IND, addr, ad)
}

fn build_legacy(out: &mut [u8], pdu_type: u8, addr: &[u8; 6], ad: &[u8]) -> Option<usize> {
    let payload = 6 + ad.len();
    if payload > 37 || out.len() < payload + 2 {
        return None;
    }
    out[0] = pdu_type;
    out[1] = payload as u8;
    out[2..8].copy_from_slice(addr);
    out[8..8 + ad.len()].copy_from_slice(ad);
    Some(payload + 2)
}

/// Append a flags AD structure; returns the number of bytes written.
pub fn ad_flags(flags: u8, out: &mut [u8]) -> usize {
    out[0] = 2;
    out[1] = AD_FLAGS;
    out[2] = flags;
    3
}

/// Append a complete-local-name AD structure; returns bytes written.
pub fn ad_name(name: &[u8], out: &mut [u8]) -> usize {
    let len = name.len() + 1;
    out[0] = len as u8;
    out[1] = AD_NAME_COMPLETE;
    out[2..2 + name.len()].copy_from_slice(name);
    len + 1
}

/// A decoded advertising report.
#[derive(Clone, Copy)]
pub struct Report<'a> {
    pub pdu_type: u8,
    pub addr: [u8; 6],
    pub adv_data: &'a [u8],
    pub rssi: i8,
    pub channel: u8,
}

/// Parse one legacy advertising PDU from the link-layer buffer
/// (`[header, length, payload...]`).
pub fn parse(buf: &[u8], rssi: i8, channel: u8) -> Option<Report<'_>> {
    if buf.len() < 2 {
        return None;
    }
    let header = buf[0];
    let len = buf[1] as usize;
    if len < 6 || buf.len() < 2 + len {
        return None;
    }

    let pdu_type = header & 0x0f;
    let payload = &buf[2..2 + len];
    // Directed, scannable, connectable and non-connectable legacy adv PDUs all
    // start with AdvA. Scan responses do too. Other types are ignored.
    let addr = match pdu_type {
        PDU_ADV_IND | PDU_ADV_DIRECT_IND | PDU_ADV_NONCONN_IND | PDU_ADV_SCAN_IND
        | PDU_SCAN_RSP => {
            let mut a = [0u8; 6];
            a.copy_from_slice(&payload[..6]);
            a
        }
        _ => return None,
    };

    // ADV_DIRECT_IND carries TargetA after AdvA; it has no AD structures.
    let adv_data: &[u8] = if pdu_type == PDU_ADV_DIRECT_IND {
        &[]
    } else {
        &payload[6..]
    };

    Some(Report {
        pdu_type,
        addr,
        adv_data,
        rssi,
        channel,
    })
}

/// Find the complete/shortened local name in an AD structure list.
pub fn find_name(data: &[u8]) -> Option<&[u8]> {
    let mut i = 0;
    while i < data.len() {
        let len = data[i] as usize;
        if len == 0 {
            break;
        }
        if i + 1 + len > data.len() {
            break;
        }
        let ty = data[i + 1];
        if ty == 0x08 || ty == AD_NAME_COMPLETE {
            return Some(&data[i + 2..i + 1 + len]);
        }
        i += 1 + len;
    }
    None
}

/// Find the payload of the first AD structure of type `ty`.
pub fn find_ad(data: &[u8], ty: u8) -> Option<&[u8]> {
    let mut i = 0;
    while i < data.len() {
        let len = data[i] as usize;
        if len == 0 {
            break;
        }
        if i + 1 + len > data.len() {
            break;
        }
        if data[i + 1] == ty {
            return Some(&data[i + 2..i + 1 + len]);
        }
        i += 1 + len;
    }
    None
}

/// Format up to `out.len() / 3` bytes as space-separated uppercase hex.
pub fn hex_preview(data: &[u8], out: &mut [u8]) -> usize {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut n = 0;
    for &b in data.iter().take(out.len() / 3) {
        if n != 0 {
            out[n] = b' ';
            n += 1;
        }
        out[n] = HEX[(b >> 4) as usize];
        out[n + 1] = HEX[(b & 0x0f) as usize];
        n += 2;
    }
    n
}

/// Write the six address bytes as `AA:BB:CC:DD:EE:FF` in display order
/// (the on-air first byte is the address LSB, so display is reversed).
pub fn format_addr(addr: &[u8; 6], out: &mut [u8; 17]) {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut o = 0;
    for (i, b) in addr.iter().enumerate().rev() {
        out[o] = HEX[(b >> 4) as usize];
        out[o + 1] = HEX[(b & 0x0f) as usize];
        o += 2;
        if i != 0 {
            out[o] = b':';
            o += 1;
        }
    }
}
