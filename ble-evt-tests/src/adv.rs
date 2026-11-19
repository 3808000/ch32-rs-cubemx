//! Advertising / scan-response TLV builder.
//!
//! EVT examples embed literal byte arrays; this module keeps the same wire
//! bytes while making the structure (length, type, payload) explicit. Each
//! push silently ignores a field that does not fit, so a malformed table can
//! never overrun the 31-byte legacy limit.

use ch5xx_ble::ffi::*;

/// Maximum legacy advertising payload.
pub const MAX_ADV_LEN: usize = 31;

#[derive(Clone, Copy)]
pub struct AdvBuilder {
    buf: [u8; MAX_ADV_LEN],
    len: usize,
}

impl AdvBuilder {
    pub const fn new() -> Self {
        Self {
            buf: [0; MAX_ADV_LEN],
            len: 0,
        }
    }

    pub fn as_slice(&self) -> &[u8] {
        &self.buf[..self.len]
    }

    pub fn len(&self) -> usize {
        self.len
    }

    fn push_field(&mut self, ty: u8, payload: &[u8]) {
        let field_len = 1 + payload.len();
        if field_len > 0xFF || self.len + 1 + field_len > MAX_ADV_LEN {
            return;
        }
        self.buf[self.len] = field_len as u8;
        self.buf[self.len + 1] = ty;
        self.buf[self.len + 2..self.len + 2 + payload.len()].copy_from_slice(payload);
        self.len += 1 + field_len;
    }

    /// Flags field (`GAP_ADTYPE_FLAGS`).
    pub fn flags(&mut self, value: u8) -> &mut Self {
        self.push_field(GAP_ADTYPE_FLAGS, &[value]);
        self
    }

    /// Incomplete list of 16-bit service UUIDs.
    pub fn uuids16_more(&mut self, uuids: &[u16]) -> &mut Self {
        let mut tmp = [0u8; 30];
        let n = core::cmp::min(uuids.len(), tmp.len() / 2);
        for (i, uuid) in uuids[..n].iter().enumerate() {
            tmp[2 * i] = *uuid as u8;
            tmp[2 * i + 1] = (*uuid >> 8) as u8;
        }
        self.push_field(GAP_ADTYPE_16BIT_MORE, &tmp[..2 * n]);
        self
    }

    /// Complete local name.
    pub fn name_complete(&mut self, name: &[u8]) -> &mut Self {
        self.push_field(GAP_ADTYPE_LOCAL_NAME_COMPLETE, name);
        self
    }

    /// Shortened local name.
    pub fn name_short(&mut self, name: &[u8]) -> &mut Self {
        self.push_field(GAP_ADTYPE_LOCAL_NAME_SHORT, name);
        self
    }

    /// Appearance (16-bit, little endian).
    pub fn appearance(&mut self, value: u16) -> &mut Self {
        self.push_field(GAP_ADTYPE_APPEARANCE, &value.to_le_bytes());
        self
    }

    /// Tx power level (signed dBm).
    pub fn tx_power(&mut self, dbm: i8) -> &mut Self {
        self.push_field(GAP_ADTYPE_POWER_LEVEL, &[dbm as u8]);
        self
    }

    /// Peripheral preferred connection interval range (units 1.25 ms).
    pub fn conn_interval_range(&mut self, min: u16, max: u16) -> &mut Self {
        let mut tmp = [0u8; 4];
        tmp[0..2].copy_from_slice(&min.to_le_bytes());
        tmp[2..4].copy_from_slice(&max.to_le_bytes());
        self.push_field(GAP_ADTYPE_SLAVE_CONN_INTERVAL_RANGE, &tmp);
        self
    }

    /// Manufacturer specific data (no company ID is inserted).
    pub fn manufacturer(&mut self, data: &[u8]) -> &mut Self {
        self.push_field(GAP_ADTYPE_MANUFACTURER_SPECIFIC, data);
        self
    }

    /// Copy into a caller-owned fixed buffer, returning the used length.
    pub fn copy_to(&self, out: &mut [u8]) -> usize {
        let n = core::cmp::min(out.len(), self.len);
        out[..n].copy_from_slice(&self.buf[..n]);
        n
    }
}

impl Default for AdvBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// `02 01 06 | 03 02 <uuid>` — SimpleProfile-style connectable advertising.
pub fn simple_adv(uuid: u16) -> AdvBuilder {
    let mut b = AdvBuilder::new();
    b.flags(GAP_ADTYPE_FLAGS_GENERAL | GAP_ADTYPE_FLAGS_BREDR_NOT_SUPPORTED);
    b.uuids16_more(&[uuid]);
    b
}