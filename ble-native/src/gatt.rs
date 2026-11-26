//! GAP 和 Phase C 测试服务的静态 GATT 属性表。

use crate::att::{Error, MAX_MTU};

#[cfg(not(feature = "pairing"))]
pub const DEVICE_NAME: &[u8] = b"M19-GATT";
#[cfg(feature = "pairing")]
pub const DEVICE_NAME: &[u8] = b"M19-SEC";
pub(crate) const PRIMARY_SERVICE: [u8; 2] = 0x2800u16.to_le_bytes();
pub(crate) const SECONDARY_SERVICE: [u8; 2] = 0x2801u16.to_le_bytes();
const CHARACTERISTIC: [u8; 2] = 0x2803u16.to_le_bytes();
const CCCD: [u8; 2] = 0x2902u16.to_le_bytes();

// UUID 在 ATT 上采用低字节在前的表示。
const SERVICE_UUID: [u8; 16] = 0xd0f10000_98cb_4d61_be71_228c9171d719u128.to_le_bytes();
const VALUE_UUID: [u8; 16] = 0xd0f10001_98cb_4d61_be71_228c9171d719u128.to_le_bytes();
const VALUE_HANDLE: u16 = 8;
const CCCD_HANDLE: u16 = 9;

pub(crate) fn requires_encryption(handle: u16) -> bool {
    matches!(handle, VALUE_HANDLE | CCCD_HANDLE)
}

const fn declaration(properties: u8, handle: u16, uuid: [u8; 16]) -> [u8; 19] {
    let mut bytes = [0; 19];
    bytes[0] = properties;
    let [lo, hi] = handle.to_le_bytes();
    bytes[1] = lo;
    bytes[2] = hi;
    let mut i = 0;
    while i < uuid.len() {
        bytes[3 + i] = uuid[i];
        i += 1;
    }
    bytes
}

pub(crate) struct Attribute {
    pub uuid: &'static [u8],
    pub group_end: u16,
    value: &'static [u8],
}

impl Attribute {
    const fn value(uuid: &'static [u8], value: &'static [u8]) -> Self {
        Self {
            uuid,
            group_end: 0,
            value,
        }
    }

    const fn service(value: &'static [u8], group_end: u16) -> Self {
        Self {
            uuid: &PRIMARY_SERVICE,
            group_end,
            value,
        }
    }
}

pub(crate) const ATTRIBUTES: [Attribute; 9] = [
    Attribute::service(&[0x00, 0x18], 5),
    Attribute::value(&CHARACTERISTIC, &[0x02, 3, 0, 0x00, 0x2a]),
    Attribute::value(&[0x00, 0x2a], DEVICE_NAME),
    Attribute::value(&CHARACTERISTIC, &[0x02, 5, 0, 0x01, 0x2a]),
    Attribute::value(&[0x01, 0x2a], &[0, 0]),
    Attribute::service(&SERVICE_UUID, CCCD_HANDLE),
    Attribute::value(
        &CHARACTERISTIC,
        &declaration(0x1e, VALUE_HANDLE, VALUE_UUID),
    ),
    Attribute::value(&VALUE_UUID, &[]),
    Attribute::value(&CCCD, &[]),
];

pub(crate) fn uuid_eq(a: &[u8], b: &[u8]) -> bool {
    let (short, long) = if a.len() == 2 { (a, b) } else { (b, a) };
    const BASE: [u8; 16] = 0x00000000_0000_1000_8000_00805f9b34fbu128.to_le_bytes();
    a == b
        || (short.len() == 2
            && long.len() == 16
            && long[..12] == BASE[..12]
            && long[12..14] == *short
            && long[14..] == [0, 0])
}

pub(crate) struct Database {
    value: [u8; MAX_MTU - 3],
    len: usize,
    pub(crate) subscribed: bool,
    changed: bool,
}

impl Database {
    pub fn new() -> Self {
        let mut value = [0; MAX_MTU - 3];
        value[..5].copy_from_slice(b"ready");
        Self {
            value,
            len: 5,
            subscribed: false,
            changed: false,
        }
    }

    pub fn read(&self, handle: u16) -> Result<&[u8], Error> {
        match handle {
            VALUE_HANDLE => Ok(&self.value[..self.len]),
            CCCD_HANDLE => Ok(if self.subscribed { &[1, 0] } else { &[0, 0] }),
            _ => {
                let index = handle.checked_sub(1).ok_or(Error::InvalidHandle)?;
                ATTRIBUTES
                    .get(usize::from(index))
                    .map(|a| a.value)
                    .ok_or(Error::InvalidHandle)
            }
        }
    }

    pub fn write(&mut self, handle: u16, bytes: &[u8]) -> Result<(), Error> {
        match handle {
            VALUE_HANDLE if bytes.len() <= self.value.len() => {
                self.value[..bytes.len()].copy_from_slice(bytes);
                self.len = bytes.len();
                self.changed = self.subscribed;
            }
            VALUE_HANDLE => return Err(Error::InvalidValueLength),
            CCCD_HANDLE => {
                self.subscribed = match bytes {
                    [0, 0] => false,
                    [1, 0] => true,
                    [_, _] => return Err(Error::ValueNotAllowed),
                    _ => return Err(Error::InvalidValueLength),
                };
                if !self.subscribed {
                    self.changed = false;
                }
            }
            1..=9 => return Err(Error::WriteNotPermitted),
            _ => return Err(Error::InvalidHandle),
        }
        Ok(())
    }

    pub fn take_notification(&mut self) -> Option<(u16, &[u8])> {
        if !core::mem::take(&mut self.changed) {
            return None;
        }
        Some((VALUE_HANDLE, &self.value[..self.len]))
    }
}
