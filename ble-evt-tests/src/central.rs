//! Small GATT-client state machine shared by the central-role binaries.
//!
//! The flow follows the specification's observable steps: exchange MTU,
//! discover the 0xFFE0 service, enumerate its characteristics, find the
//! 0xFFE4 CCCD, enable notifications, then alternate write/read on 0xFFE1.
//! Nothing here depends on a fixed peer address; the binaries match the
//! advertising name instead (deviation documented in their headers).

use crate::ble;
use crate::ble::client::{self, GattClientEvent};
use crate::ble::ffi::*;
use crate::ble::gatt::*;

/// MTU requested by the central binaries (spec: bufs 251 -> MTU 247).
pub const REQUESTED_MTU: u16 = 247;

const UUID_FFE1: u16 = 0xFFE1;

const UUID_FFE4: u16 = 0xFFE4;
const UUID_CCCD: u16 = 0x2902;
const UUID_CHARACTERISTIC: u16 = 0x2803;

/// Discovery / steady-state phase.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LinkState {
    Idle,
    WaitMtu,
    DiscService,
    DiscChars,
    DiscCccd,
    WaitCccd,
    Ready,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Pending {
    None,
    /// Client procedure still busy (blePending); retry from `poll`.
    DiscService,
    DiscChars,
    DiscDescs,
    CccdWrite,
}

/// One discovered/active connection.
#[derive(Clone, Copy)]
pub struct SingleLink {
    pub conn: u16,
    pub state: LinkState,
    pub ffe1: u16,
    pub ffe4: u16,
    pub cccd: u16,
    pub service_start: u16,
    pub service_end: u16,
    pub mtu: u16,
    pub rx_bytes: u32,
    pub notifications: u32,
    pub writes: u32,
    pub reads: u32,
    /// Ready-state cycle phase: false = next tick writes 0xFFE1, true = next
    /// tick reads it back (spec: 1600 ms alternation).
    next_read: bool,
    retry: Pending,
    retry_at: u32,
}

impl Default for SingleLink {
    fn default() -> Self {
        Self {
            conn: INVALID_CONNHANDLE,
            state: LinkState::Idle,
            ffe1: 0,
            ffe4: 0,
            cccd: 0,
            service_start: 0,
            service_end: 0,
            mtu: 23,
            rx_bytes: 0,
            notifications: 0,
            writes: 0,
            reads: 0,
            next_read: false,
            retry: Pending::None,
            retry_at: 0,
        }
    }
}

impl SingleLink {
    /// Start the discovery sequence for a freshly established link.
    pub fn new(conn: u16, task: u8) -> Self {
        let mut link = Self {
            conn,
            state: LinkState::WaitMtu,
            ..Self::default()
        };
        ble::println!("[central] conn 0x{:04x} exchange MTU {}", conn, REQUESTED_MTU);
        if let Err(e) = client::exchange_mtu(conn, REQUESTED_MTU, task) {
            ble::println!("[central] exchange MTU rejected: {:?}", e);
            link.discover_service(task);
        }
        link
    }

    pub fn is_ready(&self) -> bool {
        self.state == LinkState::Ready
    }

    fn discover_service(&mut self, task: u8) {
        self.state = LinkState::DiscService;
        ble::println!("[central] discover service FFE0 (read by group type)");
        // Read By Group Type rather than Find By Type Value: the WCH client's
        // Find-By-Type-Value continuation (start = found handle + 1) draws an
        // ATT 0x0a from the peer and the procedure then reports the error
        // instead of the successful range, so the service is never found.
        self.try_service(task);
    }

    fn schedule_retry(&mut self, call: Pending) {
        self.retry = call;
        // The client keeps its request slot busy until the previous
        // discovery's auto-continuation finishes; retry well after one
        // connection interval and never in a tight loop (each attempt
        // allocates a small request buffer that the busy path leaks).
        self.retry_at = crate::now_ms().wrapping_add(200);
    }

    /// Run `call` after a delay instead of immediately: every discovery
    /// response is followed by the client's own continuation request.
    fn defer(&mut self, call: Pending, delay_ms: u32) {
        self.retry = call;
        self.retry_at = crate::now_ms().wrapping_add(delay_ms);
    }

    /// The client rejects overlapping procedures with blePending (0x16) while
    /// the previous discovery's continuation is still in flight; retry later.
    fn retry_busy(&mut self, status: bStatus_t, call: Pending) -> bool {
        match status {
            Ok(()) => {
                self.retry = Pending::None;
                false
            }
            Err(e) if e.get() == 0x16 => {
                self.schedule_retry(call);
                true
            }
            Err(_) => false,
        }
    }

    fn try_service(&mut self, task: u8) {
        let status = client::disc_all_primary_services(self.conn, task);
        if !self.retry_busy(status, Pending::DiscService) {
            if let Err(e) = status {
                ble::println!("[central] discover request rejected: {:?}", e);
            }
        }
    }

    fn try_chars(&mut self, task: u8) {
        let status =
            client::disc_all_chars(self.conn, self.service_start, self.service_end, task);
        if !self.retry_busy(status, Pending::DiscChars) {
            if let Err(e) = status {
                ble::println!("[central] chars request rejected: {:?}", e);
            }
        }
    }

    fn try_descs(&mut self, task: u8) {
        let status = client::disc_all_char_descs(
            self.conn,
            self.ffe4.wrapping_add(1),
            self.service_end,
            task,
        );
        if !self.retry_busy(status, Pending::DiscDescs) {
            if let Err(e) = status {
                ble::println!("[central] descriptor request rejected: {:?}", e);
            }
        }
    }

    fn try_cccd_write(&mut self, task: u8) {
        // Spec API: a Write Request to the CCCD. With the 20-buffer pool the
        // response is delivered normally (5 buffers at MTU 247 starved the RX
        // path and the response was silently dropped, leaving the client slot
        // pending forever).
        let status = client::write_char_desc(self.conn, self.cccd, &[0x01, 0x00], task);
        match status {
            Ok(()) => {
                self.retry = Pending::None;
                self.state = LinkState::Ready;
                ble::println!("[central] CCCD write sent, ready");
            }
            Err(e) if e.get() == 0x16 => self.schedule_retry(Pending::CccdWrite),
            Err(e) => {
                ble::println!("[central] CCCD write rejected: {:?}", e);
                self.state = LinkState::Ready;
            }
        }
    }

    /// Retry a blePending client call; call every millisecond from the main loop.
    pub fn poll(&mut self, now: u32, task: u8) {
        if self.retry == Pending::None {
            return;
        }
        if now.wrapping_sub(self.retry_at) >= 0x8000_0000 {
            return;
        }
        let call = self.retry;
        match call {
            Pending::DiscService => self.try_service(task),
            Pending::DiscChars => self.try_chars(task),
            Pending::DiscDescs => self.try_descs(task),
            Pending::CccdWrite => self.try_cccd_write(task),
            _ => self.retry = Pending::None,
        }
    }

    /// Feed one decoded GATT event. Events for other connections are ignored.
    pub fn handle(&mut self, event: &GattClientEvent, task: u8) {
        let conn = match event {
            GattClientEvent::ReadRsp { conn_handle, .. }
            | GattClientEvent::ReadBlobRsp { conn_handle, .. }
            | GattClientEvent::WriteRsp { conn_handle }
            | GattClientEvent::ExchangeMtuRsp { conn_handle, .. }
            | GattClientEvent::FindInfoRsp { conn_handle, .. }
            | GattClientEvent::FindByTypeValueRsp { conn_handle, .. }
            | GattClientEvent::ReadByTypeRsp { conn_handle, .. }
            | GattClientEvent::ReadByGrpTypeRsp { conn_handle, .. }
            | GattClientEvent::HandleValueNoti { conn_handle, .. }
            | GattClientEvent::HandleValueInd { conn_handle, .. }
            | GattClientEvent::HandleValueCfm { conn_handle, .. }
            | GattClientEvent::MtuUpdated { conn_handle, .. }
            | GattClientEvent::FlowCtrlViolated { conn_handle, .. }
            | GattClientEvent::ErrorRsp { conn_handle, .. }
            | GattClientEvent::Other { conn_handle, .. } => *conn_handle,
        };
        if conn != self.conn {
            return;
        }

        match event {
            GattClientEvent::ExchangeMtuRsp { server_rx_mtu, .. } => {
                self.mtu = core::cmp::min(*server_rx_mtu, REQUESTED_MTU);
                ble::println!("[central] MTU {}", self.mtu);
                self.discover_service(task);
            }
            GattClientEvent::MtuUpdated { mtu, .. } => {
                self.mtu = *mtu;
                ble::println!("[central] MTU updated {}", mtu);
            }
            GattClientEvent::FindByTypeValueRsp { handles_info, .. } => {
                if self.state != LinkState::DiscService {
                    return;
                }
                if handles_info.len() >= 4 {
                    let start = u16::from_le_bytes([handles_info[0], handles_info[1]]);
                    let end = u16::from_le_bytes([handles_info[2], handles_info[3]]);
                    self.service_start = start;
                    self.service_end = end;
                    self.state = LinkState::DiscChars;
                    ble::println!("[central] FFE0 handles {}..{}", start, end);
                    self.defer(Pending::DiscChars, 200);
                } else {
                    ble::println!("[central] service not found");
                    self.state = LinkState::Idle;
                }
            }
            GattClientEvent::ReadByGrpTypeRsp {
                num_grps,
                entry_len,
                data,
                ..
            } => {
                if self.state != LinkState::DiscService {
                    return;
                }
                let elen = *entry_len as usize;
                for i in 0..*num_grps as usize {
                    let off = i.saturating_mul(elen);
                    if elen < 6 || off + elen > data.len() {
                        break;
                    }
                    let start = u16::from_le_bytes([data[off], data[off + 1]]);
                    let end = u16::from_le_bytes([data[off + 2], data[off + 3]]);
                    let uuid = u16::from_le_bytes([data[off + 4], data[off + 5]]);
                    if uuid == 0xFFE0 {
                        self.service_start = start;
                        self.service_end = end;
                        self.state = LinkState::DiscChars;
                        ble::println!("[central] FFE0 handles {}..{}", start, end);
                        self.defer(Pending::DiscChars, 200);
                        return;
                    }
                }
            }
            GattClientEvent::ReadByTypeRsp {
                num_pairs,
                entry_len,
                data,
                ..
            } => {
                if self.state != LinkState::DiscChars {
                    return;
                }
                let mut found_ffe1 = 0;
                let mut found_ffe4 = 0;
                for i in 0..*num_pairs as usize {
                    let off = i * *entry_len as usize;
                    if off + 7 > data.len() {
                        break;
                    }
                    let uuid = u16::from_le_bytes([data[off + 5], data[off + 6]]);
                    if uuid == UUID_CHARACTERISTIC {
                        continue;
                    }
                    let value_handle = u16::from_le_bytes([data[off + 3], data[off + 4]]);
                    match uuid {
                        UUID_FFE1 => found_ffe1 = value_handle,
                        UUID_FFE4 => found_ffe4 = value_handle,
                        _ => {}
                    }
                }
                if found_ffe1 != 0 {
                    self.ffe1 = found_ffe1;
                }
                if found_ffe4 != 0 {
                    self.ffe4 = found_ffe4;
                }
                ble::println!(
                    "[central] chars FFE1 0x{:04x} FFE4 0x{:04x}",
                    self.ffe1,
                    self.ffe4
                );
                if self.ffe4 == 0 {
                    ble::println!("[central] CCCD source missing");
                    self.state = LinkState::Idle;
                    return;
                }
                self.state = LinkState::DiscCccd;
                self.defer(Pending::DiscDescs, 200);
            }
            GattClientEvent::FindInfoRsp {
                format,
                num_info,
                info,
                ..
            } => {
                if self.state != LinkState::DiscCccd {
                    return;
                }
                let mut cccd = 0;
                if *format == 0x01 {
                    for i in 0..*num_info as usize {
                        let off = i * 4;
                        if off + 4 > info.len() {
                            break;
                        }
                        let uuid = u16::from_le_bytes([info[off + 2], info[off + 3]]);
                        if uuid == UUID_CCCD {
                            cccd = u16::from_le_bytes([info[off], info[off + 1]]);
                            break;
                        }
                    }
                }
                if cccd == 0 {
                    // The WCH profile places the CCCD directly after the
                    // FFE4 value; use that when the descriptor walk was
                    // truncated.
                    cccd = self.ffe4 + 1;
                }
                self.cccd = cccd;
                self.state = LinkState::WaitCccd;
                ble::println!("[central] CCCD 0x{:04x}, enable notifications", cccd);
                // Diagnostic: keep the spec's 200 ms spacing (the spec's own
                // cadence is 1600 ms for the write/read cycle).
                self.defer(Pending::CccdWrite, 200);
            }
            GattClientEvent::WriteRsp { .. } => {
                // Informational only: the stack itself already counted the
                // write as complete when it received this response. Reaching
                // Ready does not depend on it (see try_cccd_write).
                if self.state == LinkState::Ready {
                    ble::println!("[central] write response");
                }
            }
            GattClientEvent::ReadRsp { value, .. } => {
                self.reads += 1;
                ble::println!(
                    "[central] read FFE1 len {} first 0x{:02x}",
                    value.len(),
                    value.first().copied().unwrap_or(0)
                );
            }
            GattClientEvent::HandleValueNoti { value, .. } => {
                self.notifications += 1;
                self.rx_bytes += value.len() as u32;
            }
            GattClientEvent::HandleValueInd { .. } => {
                self.notifications += 1;
            }
            GattClientEvent::ErrorRsp {
                req_opcode,
                handle,
                err_code,
                ..
            } => {
                ble::println!(
                    "[central] ATT error op 0x{:02x} handle 0x{:04x} err 0x{:02x}",
                    req_opcode,
                    handle,
                    err_code
                );
                if self.state == LinkState::WaitMtu {
                    self.discover_service(task);
                }
            }
            GattClientEvent::FlowCtrlViolated { .. } => {
                ble::println!("[central] flow control violated");
            }
            _ => {}
        }
    }

    /// Periodic write/read cycle; call at the spec's 1600 ms cadence.
    ///
    /// The spec's EVT loop writes 0xFFE1 = 0x5A and reads it back on
    /// alternating events; it does not gate the cycle on Write/Read responses
    /// (the WCH client drops simple write responses internally).
    pub fn tick(&mut self, task: u8) {
        if self.state != LinkState::Ready || self.ffe1 == 0 {
            return;
        }
        // Spec cycle: write 0xFFE1 = 0x5A, then read it back on the next
        // period. A blePending (0x16) response means the previous request has
        // not completed yet; the next tick retries.
        if !self.next_read {
            let status = client::write_char_value(self.conn, self.ffe1, &[0x5A], task);
            match status {
                Ok(()) => {
                    self.next_read = true;
                    self.writes += 1;
                    ble::println!("[central] Write sent: 5a");
                }
                Err(e) => ble::println!("[central] write rejected: {:?}", e),
            }
        } else {
            let status = client::read_char_value(self.conn, self.ffe1, task);
            match status {
                Ok(()) => {
                    self.next_read = false;
                    ble::println!("[central] Read sent");
                }
                Err(e) => ble::println!("[central] read rejected: {:?}", e),
            }
        }
    }

    pub fn reset(&mut self) {
        let conn = self.conn;
        *self = Self::default();
        self.conn = conn;
    }
}