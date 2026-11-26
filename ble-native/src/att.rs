//! 单个固定 ATT bearer，默认 MTU 23，协商上限 64。

use crate::gatt::{uuid_eq, Database, ATTRIBUTES, PRIMARY_SERVICE, SECONDARY_SERVICE};

const DEFAULT_MTU: usize = 23;
pub const MAX_MTU: usize = 64;

#[derive(Clone, Copy)]
#[repr(u8)]
pub(crate) enum Error {
    InvalidHandle = 0x01,
    WriteNotPermitted = 0x03,
    InvalidPdu = 0x04,
    RequestNotSupported = 0x06,
    InvalidOffset = 0x07,
    AttributeNotFound = 0x0a,
    InvalidValueLength = 0x0d,
    InsufficientEncryption = 0x0f,
    UnsupportedGroupType = 0x10,
    ValueNotAllowed = 0x13,
}

fn word(bytes: &[u8]) -> u16 {
    u16::from_le_bytes([bytes[0], bytes[1]])
}

pub struct Server {
    mtu: usize,
    db: Database,
    locked: bool,
}

impl Server {
    pub fn new() -> Self {
        Self {
            mtu: DEFAULT_MTU,
            db: Database::new(),
            locked: false,
        }
    }

    #[cfg(feature = "pairing")]
    pub fn lock(&mut self, until_encrypted: bool) {
        self.locked = until_encrypted;
    }

    #[cfg(feature = "pairing")]
    pub(crate) fn subscribed(&self) -> bool {
        self.db.subscribed
    }

    #[cfg(feature = "pairing")]
    pub(crate) fn restore_subscription(&mut self, enabled: bool) {
        self.db.subscribed = enabled;
    }

    fn check_security(&self, handle: u16) -> Result<(), Error> {
        if self.locked && crate::gatt::requires_encryption(handle) {
            return Err(Error::InsufficientEncryption);
        }
        Ok(())
    }

    fn write(&mut self, handle: u16, bytes: &[u8]) -> Result<(), Error> {
        self.check_security(handle)?;
        self.db.write(handle, bytes)
    }

    /// 处理客户端 PDU，返回响应长度。命令与确认返回 0。
    pub fn request(&mut self, pdu: &[u8], out: &mut [u8; MAX_MTU]) -> usize {
        let [opcode, args @ ..] = pdu else { return 0 };
        let opcode = *opcode;
        if opcode & 0x40 != 0 {
            if opcode == 0x52 && args.len() >= 2 && pdu.len() <= self.mtu {
                let _ = self.write(word(args), &args[2..]);
            }
            return 0;
        }
        // 奇数方法码是响应或通知。0x1e 是确认，测试服务仅用通知。
        if opcode & 1 != 0 || opcode == 0x1e {
            return 0;
        }
        let result = if pdu.len() > self.mtu {
            Err((0, Error::InvalidPdu))
        } else {
            self.respond(opcode, args, &mut out[..self.mtu])
        };
        match result {
            Ok(len) => len,
            Err((handle, error)) => {
                let [lo, hi] = handle.to_le_bytes();
                out[..5].copy_from_slice(&[0x01, opcode, lo, hi, error as u8]);
                5
            }
        }
    }

    pub fn notification(&mut self, out: &mut [u8; MAX_MTU]) -> usize {
        let Some((handle, value)) = self.db.take_notification() else {
            return 0;
        };
        out[0] = 0x1b;
        out[1..3].copy_from_slice(&handle.to_le_bytes());
        let len = value.len().min(self.mtu - 3);
        out[3..3 + len].copy_from_slice(&value[..len]);
        3 + len
    }

    fn respond(&mut self, opcode: u8, args: &[u8], out: &mut [u8]) -> Result<usize, (u16, Error)> {
        let invalid = (0, Error::InvalidPdu);
        match opcode {
            0x02 => {
                if args.len() != 2 || usize::from(word(args)) < DEFAULT_MTU {
                    return Err(invalid);
                }
                self.mtu = usize::from(word(args)).min(MAX_MTU);
                out[0] = 0x03;
                out[1..3].copy_from_slice(&(MAX_MTU as u16).to_le_bytes());
                Ok(3)
            }
            0x04 | 0x06 | 0x08 | 0x10 => self.discover(opcode, args, out),
            0x0a | 0x0c => {
                if args.len() != if opcode == 0x0a { 2 } else { 4 } {
                    return Err(invalid);
                }
                let handle = word(args);
                self.check_security(handle)
                    .map_err(|error| (handle, error))?;
                let value = self.db.read(handle).map_err(|error| (handle, error))?;
                let offset = if opcode == 0x0a {
                    0
                } else {
                    usize::from(word(&args[2..]))
                };
                let tail = value.get(offset..).ok_or((handle, Error::InvalidOffset))?;
                let len = tail.len().min(out.len() - 1);
                out[0] = opcode + 1;
                out[1..1 + len].copy_from_slice(&tail[..len]);
                Ok(1 + len)
            }
            0x12 => {
                if args.len() < 2 {
                    return Err(invalid);
                }
                let handle = word(args);
                self.write(handle, &args[2..])
                    .map_err(|error| (handle, error))?;
                out[0] = 0x13;
                Ok(1)
            }
            _ => Err((0, Error::RequestNotSupported)),
        }
    }

    fn discover(&self, opcode: u8, args: &[u8], out: &mut [u8]) -> Result<usize, (u16, Error)> {
        let valid_len = match opcode {
            0x04 => args.len() == 4,
            0x06 => args.len() >= 7,
            _ => matches!(args.len(), 6 | 20),
        };
        if !valid_len {
            return Err((0, Error::InvalidPdu));
        }
        let start = word(args);
        let end = word(&args[2..]);
        if start == 0 || start > end {
            return Err((start, Error::InvalidHandle));
        }

        let mut len = if opcode == 0x06 { 1 } else { 2 };
        let mut width = 0;
        let mut value_len = 0;
        let uuid = &args[4..];
        if opcode == 0x10 && !uuid_eq(uuid, &PRIMARY_SERVICE) && !uuid_eq(uuid, &SECONDARY_SERVICE)
        {
            return Err((start, Error::UnsupportedGroupType));
        }
        for handle in start..=end.min(ATTRIBUTES.len() as u16) {
            let attr = &ATTRIBUTES[usize::from(handle - 1)];
            let value = self.db.read(handle).map_err(|error| (handle, error))?;
            if matches!(opcode, 0x06 | 0x08) {
                let type_uuid = if opcode == 0x06 { &uuid[..2] } else { uuid };
                if uuid_eq(type_uuid, attr.uuid) {
                    if let Err(error) = self.check_security(handle) {
                        if width == 0 {
                            return Err((handle, error));
                        }
                        break;
                    }
                }
            }
            let (prefix, bytes) = match opcode {
                0x04 => (2, attr.uuid),
                0x06 if uuid_eq(&args[4..6], attr.uuid) && uuid_eq(&args[6..], value) => {
                    (4, &[][..])
                }
                0x10 if uuid_eq(uuid, attr.uuid) => (4, value),
                0x08 if uuid_eq(uuid, attr.uuid) => (2, value),
                _ => continue,
            };

            if width != 0 && value_len != bytes.len() {
                break;
            }
            let size = prefix + bytes.len().min(out.len() - len.min(2) - prefix);
            if len + size > out.len() {
                break;
            }
            width = size;
            value_len = bytes.len();
            out[len..len + 2].copy_from_slice(&handle.to_le_bytes());
            if prefix == 4 {
                let group_end = if attr.group_end == 0 {
                    handle
                } else {
                    attr.group_end
                };
                out[len + 2..len + 4].copy_from_slice(&group_end.to_le_bytes());
            }
            out[len + prefix..len + size].copy_from_slice(&bytes[..size - prefix]);
            len += size;
        }

        if width == 0 {
            return Err((start, Error::AttributeNotFound));
        }
        out[0] = opcode + 1;
        if opcode == 0x04 {
            out[1] = if value_len == 2 { 1 } else { 2 };
        } else if opcode != 0x06 {
            out[1] = width as u8;
        }
        Ok(len)
    }
}
