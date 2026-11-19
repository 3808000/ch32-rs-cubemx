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

const UUID_FFE0_BYTES: [u8; 2] = [0xE0, 0xFF];
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
    Cccd,
    Write,
    Read,
}

/// One discovered/active connection.
#[derive(Clone, Copy)]
pub struct SingleLink {
    pub conn: u16,
    pub state: LinkState,
    pub ffe1: u16,
    pub ffe4: u16,
    pub cccd: u16,
    pub service_end: u16,
    pub mtu: u16,
    pub rx_bytes: u32,
    pub notifications: u32,
    pub writes: u32,
    pub reads: u32,
    pending: Pending,
}

impl Default for SingleLink {
    fn default() -> Self {
        Self {
            conn: INVALID_CONNHANDLE,
            state: LinkState::Idle,
            ffe1: 0,
            ffe4: 0,
            cccd: 0,
            service_end: 0,
            mtu: 23,
            rx_bytes: 0,
            notifications: 0,
            writes: 0,
            reads: 0,
            pending: Pending::None,
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
        if client::exchange_mtu(conn, REQUESTED_MTU, task).is_err() {
            link.discover_service(task);
        }
        link
    }

    pub fn is_ready(&self) -> bool {
        self.state == LinkState::Ready
    }

    fn discover_service(&mut self, task: u8) {
        self.state = LinkState::DiscService;
        ble::println!("[central] discover service FFE0");
        let _ = client::disc_primary_service_by_uuid(self.conn, &UUID_FFE0_BYTES, task);
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
                    self.service_end = end;
                    self.state = LinkState::DiscChars;
                    ble::println!("[central] FFE0 handles {}..{}", start, end);
                    let _ = client::disc_all_chars(self.conn, start, end, task);
                } else {
                    ble::println!("[central] service not found");
                    self.state = LinkState::Idle;
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
                let _ = client::disc_all_char_descs(
                    self.conn,
                    self.ffe4 + 1,
                    self.service_end,
                    task,
                );
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
                if client::write_char_desc(self.conn, cccd, &[0x01, 0x00], task).is_ok() {
                    self.pending = Pending::Cccd;
                } else {
                    self.state = LinkState::Ready;
                }
            }
            GattClientEvent::WriteRsp { .. } => match self.pending {
                Pending::Cccd => {
                    self.pending = Pending::None;
                    self.state = LinkState::Ready;
                    ble::println!("[central] notifications enabled");
                }
                Pending::Write => {
                    self.pending = Pending::Read;
                    self.writes += 1;
                    let _ = client::read_char_value(self.conn, self.ffe1, task);
                }
                _ => {}
            },
            GattClientEvent::ReadRsp { value, .. } => {
                if self.pending == Pending::Read {
                    self.pending = Pending::None;
                    self.reads += 1;
                    ble::println!("[central] read FFE1 len {} first 0x{:02x}", value.len(), value.first().copied().unwrap_or(0));
                }
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
    pub fn tick(&mut self, task: u8) {
        if self.state != LinkState::Ready || self.pending != Pending::None {
            return;
        }
        if self.ffe1 == 0 {
            return;
        }
        self.pending = Pending::Write;
        if client::write_char_value(self.conn, self.ffe1, &[0x5A], task).is_err() {
            self.pending = Pending::None;
        }
    }

    pub fn reset(&mut self) {
        let conn = self.conn;
        *self = Self::default();
        self.conn = conn;
    }
}