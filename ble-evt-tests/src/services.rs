//! GATT service tables used by the EVT comparison binaries.
//!
//! Attribute order follows the specification tables. Characteristic
//! declarations are patched with the real value handles after registration
//! (see [`crate::register_attrs`]); the stack may do the same, and the patch
//! is idempotent.

#![allow(static_mut_refs)]

use core::ptr::addr_of;
use core::ptr::addr_of_mut;

use crate::ble;
use crate::ble::gatt_uuid::{GATT_CHAR_USER_DESC_UUID, GATT_REPORT_REF_UUID};
use crate::gatt::*;
use crate::gattservapp::*;
use crate::*;

// ---------------------------------------------------------------------------
// UUIDs (16-bit, little endian on the wire)
// ---------------------------------------------------------------------------

pub static UUID_FFE0: u16 = 0xFFE0;
pub static UUID_FFE1: u16 = 0xFFE1;
pub static UUID_FFE2: u16 = 0xFFE2;
pub static UUID_FFE3: u16 = 0xFFE3;
pub static UUID_FFE4: u16 = 0xFFE4;
pub static UUID_FFE5: u16 = 0xFFE5;
pub static UUID_FFF0: u16 = 0xFFF0;
pub static UUID_FFF1: u16 = 0xFFF1;
pub static UUID_FFF2: u16 = 0xFFF2;
pub static UUID_FFF3: u16 = 0xFFF3;
pub static UUID_FFF4: u16 = 0xFFF4;
pub static UUID_FFF5: u16 = 0xFFF5;
pub static UUID_FEE0: u16 = 0xFEE0;
pub static UUID_FEE1: u16 = 0xFEE1;

pub static UUID_180A: u16 = 0x180A;
pub static UUID_2A24: u16 = 0x2A24;
pub static UUID_2A26: u16 = 0x2A26;
pub static UUID_2A29: u16 = 0x2A29;

pub static UUID_180F: u16 = 0x180F;
pub static UUID_2A19: u16 = 0x2A19;

pub static UUID_180D: u16 = 0x180D;
pub static UUID_2A37: u16 = 0x2A37;
pub static UUID_2A38: u16 = 0x2A38;
pub static UUID_2A39: u16 = 0x2A39;

pub static UUID_1816: u16 = 0x1816;
pub static UUID_2A55: u16 = 0x2A55;
pub static UUID_2A5B: u16 = 0x2A5B;
pub static UUID_2A5C: u16 = 0x2A5C;
pub static UUID_2A5D: u16 = 0x2A5D;

pub static UUID_1814: u16 = 0x1814;
pub static UUID_2A53: u16 = 0x2A53;
pub static UUID_2A54: u16 = 0x2A54;

pub static UUID_1812: u16 = 0x1812;
pub static UUID_2A22: u16 = 0x2A22;
pub static UUID_2A32: u16 = 0x2A32;
pub static UUID_2A4A: u16 = 0x2A4A;
pub static UUID_2A4B: u16 = 0x2A4B;
pub static UUID_2A4C: u16 = 0x2A4C;
pub static UUID_2A4D: u16 = 0x2A4D;
pub static UUID_2A4E: u16 = 0x2A4E;

pub static UUID_1813: u16 = 0x1813;
pub static UUID_2A31: u16 = 0x2A31;
pub static UUID_2A4F: u16 = 0x2A4F;

pub static UUID_USER_DESC: u16 = GATT_CHAR_USER_DESC_UUID;
pub static UUID_REPORT_REF: u16 = GATT_REPORT_REF_UUID;

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

pub const fn svc(uuid: &'static u16) -> GattAttribute {
    GattAttribute {
        type_: GattAttrType::PRIMARY_SERVICE,
        permissions: GATT_PERMIT_READ,
        handle: 0,
        value: uuid as *const u16 as *const u8,
    }
}

pub const fn decl_attr(value: *const u8) -> GattAttribute {
    GattAttribute {
        type_: GattAttrType::CHARACTERISTIC,
        permissions: GATT_PERMIT_READ,
        handle: 0,
        value,
    }
}

pub const fn val(uuid: &'static u16, perms: u8, value: *const u8) -> GattAttribute {
    GattAttribute {
        type_: GattAttrType::new_u16(uuid),
        permissions: perms,
        handle: 0,
        value,
    }
}

pub const fn desc(uuid: &'static u16, value: *const u8) -> GattAttribute {
    GattAttribute {
        type_: GattAttrType::new_u16(uuid),
        permissions: GATT_PERMIT_READ,
        handle: 0,
        value,
    }
}

pub const fn cccd(tbl: *const gattCharCfg_t) -> GattAttribute {
    GattAttribute {
        type_: GattAttrType::CLIENT_CHAR_CFG,
        permissions: GATT_PERMIT_READ | GATT_PERMIT_WRITE,
        handle: 0,
        value: tbl as *const u8,
    }
}

/// Characteristic declaration bytes: properties, placeholder value handle,
/// and the 16-bit characteristic UUID.
pub const fn decl(props: u8, uuid: u16) -> [u8; 5] {
    [props, 0, 0, uuid as u8, (uuid >> 8) as u8]
}

pub const CCCD_INIT: gattCharCfg_t = gattCharCfg_t {
    connHandle: 0xFFFF,
    value: 0,
};

pub fn service_handle(attrs: &[GattAttribute]) -> u16 {
    attrs.first().map(|a| a.handle).unwrap_or(0)
}

// ---------------------------------------------------------------------------
// SimpleProfile 0xFFE0 / FFE1..FFE5
// ---------------------------------------------------------------------------

pub mod simple {
    use super::*;

    static mut D1: [u8; 5] = decl(GATT_PROP_READ | GATT_PROP_WRITE, 0xFFE1);
    static mut D2: [u8; 5] = decl(GATT_PROP_READ, 0xFFE2);
    static mut D3: [u8; 5] = decl(GATT_PROP_WRITE, 0xFFE3);
    static mut D4: [u8; 5] = decl(GATT_PROP_NOTIFY, 0xFFE4);
    static mut D5: [u8; 5] = decl(GATT_PROP_READ, 0xFFE5);

    static U1: [u8; 5] = *b"CHAR1";
    static U2: [u8; 5] = *b"CHAR2";
    static U3: [u8; 5] = *b"CHAR3";
    static U4: [u8; 5] = *b"CHAR4";
    static U5: [u8; 5] = *b"CHAR5";

    pub static mut V1: [u8; 1] = [1];
    pub static mut V2: [u8; 1] = [2];
    pub static mut V3: [u8; 1] = [3];
    pub static mut V4: [u8; 1] = [4];
    pub static mut V5: [u8; 5] = [1, 2, 3, 4, 5];
    pub static mut CCCD4: [gattCharCfg_t; 3] = [CCCD_INIT; 3];

    pub static mut ATTRS: [GattAttribute; 17] = [
        svc(&UUID_FFE0),
        decl_attr(addr_of!(D1) as *const u8),
        val(&UUID_FFE1, GATT_PERMIT_READ | GATT_PERMIT_WRITE, addr_of!(V1) as *const u8),
        desc(&UUID_USER_DESC, U1.as_ptr()),
        decl_attr(addr_of!(D2) as *const u8),
        val(&UUID_FFE2, GATT_PERMIT_READ, addr_of!(V2) as *const u8),
        desc(&UUID_USER_DESC, U2.as_ptr()),
        decl_attr(addr_of!(D3) as *const u8),
        val(&UUID_FFE3, GATT_PERMIT_WRITE, addr_of!(V3) as *const u8),
        desc(&UUID_USER_DESC, U3.as_ptr()),
        decl_attr(addr_of!(D4) as *const u8),
        val(&UUID_FFE4, GATT_PERMIT_READ, addr_of!(V4) as *const u8),
        cccd(addr_of!(CCCD4) as *const gattCharCfg_t),
        desc(&UUID_USER_DESC, U4.as_ptr()),
        decl_attr(addr_of!(D5) as *const u8),
        val(&UUID_FFE5, GATT_PERMIT_READ, addr_of!(V5) as *const u8),
        desc(&UUID_USER_DESC, U5.as_ptr()),
    ];

    pub const IDX_CHAR4_VALUE: usize = 11;

    pub fn register() -> bStatus_t {
        unsafe {
            note_value(addr_of!(V1) as *const u8, 1, 1);
            note_value(addr_of!(V2) as *const u8, 1, 0);
            note_value(addr_of!(V3) as *const u8, 1, 1);
            note_value(addr_of!(V4) as *const u8, 1, 0);
            note_value(addr_of!(V5) as *const u8, 5, 0);
            note_value(addr_of!(D1) as *const u8, 5, 0);
            note_value(addr_of!(D2) as *const u8, 5, 0);
            note_value(addr_of!(D3) as *const u8, 5, 0);
            note_value(addr_of!(D4) as *const u8, 5, 0);
            note_value(addr_of!(D5) as *const u8, 5, 0);
            note_value(U1.as_ptr(), 5, 0);
            note_value(U2.as_ptr(), 5, 0);
            note_value(U3.as_ptr(), 5, 0);
            note_value(U4.as_ptr(), 5, 0);
            note_value(U5.as_ptr(), 5, 0);
            GATTServApp::init_char_cfg(
                INVALID_CONNHANDLE,
                addr_of_mut!(CCCD4) as *mut gattCharCfg_t,
            );
            register_attrs(&mut *addr_of_mut!(ATTRS))
        }
    }

    pub fn char4_handle() -> u16 {
        unsafe { attr_handle(&*addr_of!(ATTRS), IDX_CHAR4_VALUE) }
    }

    pub fn cccd4() -> *const gattCharCfg_t {
        addr_of!(CCCD4) as *const gattCharCfg_t
    }

    pub fn set_char4(value: u8) {
        unsafe { *addr_of_mut!(V4) = [value] };
    }

    /// Per-connection notify through the CCCD table (multi-link path).
    pub fn notify_cfg(task_id: u8, value: u8) -> bStatus_t {
        unsafe {
            *addr_of_mut!(V4) = [value];
            GATTServApp::process_char_cfg(
                &mut *addr_of_mut!(CCCD4),
                core::slice::from_raw_parts_mut(addr_of_mut!(V4) as *mut u8, 1),
                false,
                &mut *addr_of_mut!(ATTRS),
                task_id,
                service_read_cb(),
            )
        }
    }

    pub fn notify_conn(conn: u16, value: u8) -> bool {
        notify_if(conn, cccd4(), char4_handle(), &[value])
    }
}

// ---------------------------------------------------------------------------
// SimpleProfile variant used by BackupUpgrade_OTA: CHAR4 is 8 bytes
// ---------------------------------------------------------------------------

pub mod simple8 {
    use super::*;

    static mut D1: [u8; 5] = decl(GATT_PROP_READ | GATT_PROP_WRITE, 0xFFE1);
    static mut D2: [u8; 5] = decl(GATT_PROP_READ, 0xFFE2);
    static mut D3: [u8; 5] = decl(GATT_PROP_WRITE, 0xFFE3);
    static mut D4: [u8; 5] = decl(GATT_PROP_NOTIFY, 0xFFE4);
    static mut D5: [u8; 5] = decl(GATT_PROP_READ, 0xFFE5);

    static U1: [u8; 5] = *b"CHAR1";
    static U2: [u8; 5] = *b"CHAR2";
    static U3: [u8; 5] = *b"CHAR3";
    static U4: [u8; 5] = *b"CHAR4";
    static U5: [u8; 5] = *b"CHAR5";

    pub static mut V1: [u8; 1] = [1];
    pub static mut V2: [u8; 1] = [2];
    pub static mut V3: [u8; 1] = [3];
    pub static mut V4: [u8; 8] = *b"01234567";
    pub static mut V5: [u8; 5] = [1, 2, 3, 4, 5];
    pub static mut CCCD4: [gattCharCfg_t; 3] = [CCCD_INIT; 3];

    pub static mut ATTRS: [GattAttribute; 17] = [
        svc(&UUID_FFE0),
        decl_attr(addr_of!(D1) as *const u8),
        val(&UUID_FFE1, GATT_PERMIT_READ | GATT_PERMIT_WRITE, addr_of!(V1) as *const u8),
        desc(&UUID_USER_DESC, U1.as_ptr()),
        decl_attr(addr_of!(D2) as *const u8),
        val(&UUID_FFE2, GATT_PERMIT_READ, addr_of!(V2) as *const u8),
        desc(&UUID_USER_DESC, U2.as_ptr()),
        decl_attr(addr_of!(D3) as *const u8),
        val(&UUID_FFE3, GATT_PERMIT_WRITE, addr_of!(V3) as *const u8),
        desc(&UUID_USER_DESC, U3.as_ptr()),
        decl_attr(addr_of!(D4) as *const u8),
        val(&UUID_FFE4, GATT_PERMIT_READ, addr_of!(V4) as *const u8),
        cccd(addr_of!(CCCD4) as *const gattCharCfg_t),
        desc(&UUID_USER_DESC, U4.as_ptr()),
        decl_attr(addr_of!(D5) as *const u8),
        val(&UUID_FFE5, GATT_PERMIT_READ, addr_of!(V5) as *const u8),
        desc(&UUID_USER_DESC, U5.as_ptr()),
    ];

    pub fn register() -> bStatus_t {
        unsafe {
            note_value(addr_of!(V1) as *const u8, 1, 1);
            note_value(addr_of!(V2) as *const u8, 1, 0);
            note_value(addr_of!(V3) as *const u8, 1, 1);
            note_value(addr_of!(V4) as *const u8, 8, 0);
            note_value(addr_of!(V5) as *const u8, 5, 0);
            note_value(addr_of!(D1) as *const u8, 5, 0);
            note_value(addr_of!(D2) as *const u8, 5, 0);
            note_value(addr_of!(D3) as *const u8, 5, 0);
            note_value(addr_of!(D4) as *const u8, 5, 0);
            note_value(addr_of!(D5) as *const u8, 5, 0);
            note_value(U1.as_ptr(), 5, 0);
            note_value(U2.as_ptr(), 5, 0);
            note_value(U3.as_ptr(), 5, 0);
            note_value(U4.as_ptr(), 5, 0);
            note_value(U5.as_ptr(), 5, 0);
            GATTServApp::init_char_cfg(
                INVALID_CONNHANDLE,
                addr_of_mut!(CCCD4) as *mut gattCharCfg_t,
            );
            register_attrs(&mut *addr_of_mut!(ATTRS))
        }
    }

    pub fn char4_handle() -> u16 {
        unsafe { attr_handle(&*addr_of!(ATTRS), 11) }
    }

    pub fn cccd4() -> *const gattCharCfg_t {
        addr_of!(CCCD4) as *const gattCharCfg_t
    }

    pub fn notify_conn(conn: u16) -> bool {
        let payload = unsafe { *addr_of!(V4) };
        notify_if(conn, cccd4(), char4_handle(), &payload)
    }

    pub fn notify_cfg(task_id: u8) -> bStatus_t {
        unsafe {
            GATTServApp::process_char_cfg(
                &mut *addr_of_mut!(CCCD4),
                core::slice::from_raw_parts_mut(addr_of_mut!(V4) as *mut u8, 8),
                false,
                &mut *addr_of_mut!(ATTRS),
                task_id,
                service_read_cb(),
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Battery 0x180F / 0x2A19
// ---------------------------------------------------------------------------

pub mod battery {
    use super::*;

    static mut D: [u8; 5] = decl(GATT_PROP_READ | GATT_PROP_NOTIFY, 0x2A19);
    pub static mut V: [u8; 1] = [100];
    pub static mut CCCD: [gattCharCfg_t; 3] = [CCCD_INIT; 3];

    pub static mut ATTRS: [GattAttribute; 4] = [
        svc(&UUID_180F),
        decl_attr(addr_of!(D) as *const u8),
        val(&UUID_2A19, GATT_PERMIT_READ, addr_of!(V) as *const u8),
        cccd(addr_of!(CCCD) as *const gattCharCfg_t),
    ];

    pub fn register() -> bStatus_t {
        unsafe {
            note_value(addr_of!(D) as *const u8, 5, 0);
            note_value(addr_of!(V) as *const u8, 1, 0);
            GATTServApp::init_char_cfg(
                INVALID_CONNHANDLE,
                addr_of_mut!(CCCD) as *mut gattCharCfg_t,
            );
            register_attrs(&mut *addr_of_mut!(ATTRS))
        }
    }

    pub fn handle() -> u16 {
        unsafe { attr_handle(&*addr_of!(ATTRS), 2) }
    }

    pub fn cccd_ptr() -> *const gattCharCfg_t {
        addr_of!(CCCD) as *const gattCharCfg_t
    }

    pub fn notify_conn(conn: u16, level: u8) -> bool {
        unsafe { *addr_of_mut!(V) = [level] };
        notify_if(conn, cccd_ptr(), handle(), &[level])
    }
}

// ---------------------------------------------------------------------------
// Device Information 0x180A (minimal read-only)
// ---------------------------------------------------------------------------

pub mod devinfo {
    use super::*;

    static mut D29: [u8; 5] = decl(GATT_PROP_READ, 0x2A29);
    static mut D24: [u8; 5] = decl(GATT_PROP_READ, 0x2A24);
    static mut D26: [u8; 5] = decl(GATT_PROP_READ, 0x2A26);

    static V29: [u8; 17] = *b"M18 clean-room   ";
    static V24: [u8; 7] = *b"M18-EVT";
    static V26: [u8; 5] = *b"0.1.0";

    pub static mut ATTRS: [GattAttribute; 7] = [
        svc(&UUID_180A),
        decl_attr(addr_of!(D29) as *const u8),
        val(&UUID_2A29, GATT_PERMIT_READ, V29.as_ptr()),
        decl_attr(addr_of!(D24) as *const u8),
        val(&UUID_2A24, GATT_PERMIT_READ, V24.as_ptr()),
        decl_attr(addr_of!(D26) as *const u8),
        val(&UUID_2A26, GATT_PERMIT_READ, V26.as_ptr()),
    ];

    pub fn register() -> bStatus_t {
        unsafe {
            note_value(addr_of!(D29) as *const u8, 5, 0);
            note_value(addr_of!(D24) as *const u8, 5, 0);
            note_value(addr_of!(D26) as *const u8, 5, 0);
            note_value(V29.as_ptr(), 17, 0);
            note_value(V24.as_ptr(), 7, 0);
            note_value(V26.as_ptr(), 5, 0);
            register_attrs(&mut *addr_of_mut!(ATTRS))
        }
    }
}

// ---------------------------------------------------------------------------
// Heart Rate 0x180D
// ---------------------------------------------------------------------------

pub mod heart_rate {
    use super::*;

    static mut D37: [u8; 5] = decl(GATT_PROP_NOTIFY, 0x2A37);
    static mut D38: [u8; 5] = decl(GATT_PROP_READ, 0x2A38);
    static mut D39: [u8; 5] = decl(GATT_PROP_WRITE, 0x2A39);

    pub static mut V37: [u8; 2] = [0x00, 73];
    pub static mut V38: [u8; 1] = [0x00];
    pub static mut V39: [u8; 1] = [0x00];
    pub static mut CCCD37: [gattCharCfg_t; 3] = [CCCD_INIT; 3];

    pub static mut ATTRS: [GattAttribute; 8] = [
        svc(&UUID_180D),
        decl_attr(addr_of!(D37) as *const u8),
        val(&UUID_2A37, GATT_PERMIT_READ, addr_of!(V37) as *const u8),
        cccd(addr_of!(CCCD37) as *const gattCharCfg_t),
        decl_attr(addr_of!(D38) as *const u8),
        val(&UUID_2A38, GATT_PERMIT_READ, addr_of!(V38) as *const u8),
        decl_attr(addr_of!(D39) as *const u8),
        val(&UUID_2A39, GATT_PERMIT_WRITE, addr_of!(V39) as *const u8),
    ];

    pub fn register() -> bStatus_t {
        unsafe {
            note_value(addr_of!(D37) as *const u8, 5, 0);
            note_value(addr_of!(D38) as *const u8, 5, 0);
            note_value(addr_of!(D39) as *const u8, 5, 0);
            note_value(addr_of!(V37) as *const u8, 2, 0);
            note_value(addr_of!(V38) as *const u8, 1, 0);
            note_value(addr_of!(V39) as *const u8, 1, 1);
            GATTServApp::init_char_cfg(
                INVALID_CONNHANDLE,
                addr_of_mut!(CCCD37) as *mut gattCharCfg_t,
            );
            register_attrs(&mut *addr_of_mut!(ATTRS))
        }
    }

    pub fn meas_handle() -> u16 {
        unsafe { attr_handle(&*addr_of!(ATTRS), 2) }
    }

    pub fn cccd_ptr() -> *const gattCharCfg_t {
        addr_of!(CCCD37) as *const gattCharCfg_t
    }

    pub fn notify_conn(conn: u16, bpm: u8) -> bool {
        let payload = [0x00, bpm];
        unsafe { *addr_of_mut!(V37) = payload };
        notify_if(conn, cccd_ptr(), meas_handle(), &payload)
    }
}

// ---------------------------------------------------------------------------
// Cycling Speed and Cadence 0x1816
// ---------------------------------------------------------------------------

pub mod csc {
    use super::*;

    static mut D5B: [u8; 5] = decl(GATT_PROP_NOTIFY, 0x2A5B);
    static mut D5C: [u8; 5] = decl(GATT_PROP_READ, 0x2A5C);
    static mut D5D: [u8; 5] = decl(GATT_PROP_READ, 0x2A5D);
    static mut D55: [u8; 5] = decl(GATT_PROP_WRITE | GATT_PROP_INDICATE, 0x2A55);

    pub static mut V5B: [u8; 11] = [0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    pub static mut V5C: [u8; 2] = [0x00, 0x00];
    pub static mut V5D: [u8; 1] = [0x01];
    pub static mut V55: [u8; 1] = [0x00];
    pub static mut CCCD5B: [gattCharCfg_t; 3] = [CCCD_INIT; 3];
    pub static mut CCCD55: [gattCharCfg_t; 3] = [CCCD_INIT; 3];

    pub static mut ATTRS: [GattAttribute; 11] = [
        svc(&UUID_1816),
        decl_attr(addr_of!(D5B) as *const u8),
        val(&UUID_2A5B, GATT_PERMIT_READ, addr_of!(V5B) as *const u8),
        cccd(addr_of!(CCCD5B) as *const gattCharCfg_t),
        decl_attr(addr_of!(D5C) as *const u8),
        val(&UUID_2A5C, GATT_PERMIT_READ, addr_of!(V5C) as *const u8),
        decl_attr(addr_of!(D5D) as *const u8),
        val(&UUID_2A5D, GATT_PERMIT_READ, addr_of!(V5D) as *const u8),
        decl_attr(addr_of!(D55) as *const u8),
        val(
            &UUID_2A55,
            GATT_PERMIT_WRITE,
            addr_of!(V55) as *const u8,
        ),
        cccd(addr_of!(CCCD55) as *const gattCharCfg_t),
    ];

    pub fn register() -> bStatus_t {
        unsafe {
            note_value(addr_of!(D5B) as *const u8, 5, 0);
            note_value(addr_of!(D5C) as *const u8, 5, 0);
            note_value(addr_of!(D5D) as *const u8, 5, 0);
            note_value(addr_of!(D55) as *const u8, 5, 0);
            note_value(addr_of!(V5B) as *const u8, 11, 0);
            note_value(addr_of!(V5C) as *const u8, 2, 0);
            note_value(addr_of!(V5D) as *const u8, 1, 0);
            note_value(addr_of!(V55) as *const u8, 1, 1);
            GATTServApp::init_char_cfg(
                INVALID_CONNHANDLE,
                addr_of_mut!(CCCD5B) as *mut gattCharCfg_t,
            );
            GATTServApp::init_char_cfg(
                INVALID_CONNHANDLE,
                addr_of_mut!(CCCD55) as *mut gattCharCfg_t,
            );
            register_attrs(&mut *addr_of_mut!(ATTRS))
        }
    }

    pub fn meas_handle() -> u16 {
        unsafe { attr_handle(&*addr_of!(ATTRS), 2) }
    }

    pub fn ctrl_handle() -> u16 {
        unsafe { attr_handle(&*addr_of!(ATTRS), 9) }
    }

    pub fn cccd_meas() -> *const gattCharCfg_t {
        addr_of!(CCCD5B) as *const gattCharCfg_t
    }

    pub fn cccd_ctrl() -> *const gattCharCfg_t {
        addr_of!(CCCD55) as *const gattCharCfg_t
    }

    pub fn notify_conn(conn: u16, payload: &[u8; 11]) -> bool {
        unsafe { *addr_of_mut!(V5B) = *payload };
        notify_if(conn, cccd_meas(), meas_handle(), payload)
    }

    pub fn indicate_conn(conn: u16, value: &[u8]) -> bool {
        indicate_if(conn, cccd_ctrl(), ctrl_handle(), value)
    }
}

// ---------------------------------------------------------------------------
// Running Speed and Cadence 0x1814
// ---------------------------------------------------------------------------

pub mod rsc {
    use super::*;

    static mut D53: [u8; 5] = decl(GATT_PROP_NOTIFY, 0x2A53);
    static mut D54: [u8; 5] = decl(GATT_PROP_READ, 0x2A54);
    static mut D5D: [u8; 5] = decl(GATT_PROP_READ, 0x2A5D);
    static mut D55: [u8; 5] = decl(GATT_PROP_WRITE | GATT_PROP_INDICATE, 0x2A55);

    pub static mut V53: [u8; 10] = [0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    pub static mut V54: [u8; 2] = [0x00, 0x00];
    pub static mut V5D: [u8; 1] = [0x00];
    pub static mut V55: [u8; 1] = [0x00];
    pub static mut CCCD53: [gattCharCfg_t; 3] = [CCCD_INIT; 3];
    pub static mut CCCD55: [gattCharCfg_t; 3] = [CCCD_INIT; 3];

    pub static mut ATTRS: [GattAttribute; 11] = [
        svc(&UUID_1814),
        decl_attr(addr_of!(D53) as *const u8),
        val(&UUID_2A53, GATT_PERMIT_READ, addr_of!(V53) as *const u8),
        cccd(addr_of!(CCCD53) as *const gattCharCfg_t),
        decl_attr(addr_of!(D54) as *const u8),
        val(&UUID_2A54, GATT_PERMIT_READ, addr_of!(V54) as *const u8),
        decl_attr(addr_of!(D5D) as *const u8),
        val(&UUID_2A5D, GATT_PERMIT_READ, addr_of!(V5D) as *const u8),
        decl_attr(addr_of!(D55) as *const u8),
        val(
            &UUID_2A55,
            GATT_PERMIT_WRITE,
            addr_of!(V55) as *const u8,
        ),
        cccd(addr_of!(CCCD55) as *const gattCharCfg_t),
    ];

    pub fn register() -> bStatus_t {
        unsafe {
            note_value(addr_of!(D53) as *const u8, 5, 0);
            note_value(addr_of!(D54) as *const u8, 5, 0);
            note_value(addr_of!(D5D) as *const u8, 5, 0);
            note_value(addr_of!(D55) as *const u8, 5, 0);
            note_value(addr_of!(V53) as *const u8, 10, 0);
            note_value(addr_of!(V54) as *const u8, 2, 0);
            note_value(addr_of!(V5D) as *const u8, 1, 0);
            note_value(addr_of!(V55) as *const u8, 1, 1);
            GATTServApp::init_char_cfg(
                INVALID_CONNHANDLE,
                addr_of_mut!(CCCD53) as *mut gattCharCfg_t,
            );
            GATTServApp::init_char_cfg(
                INVALID_CONNHANDLE,
                addr_of_mut!(CCCD55) as *mut gattCharCfg_t,
            );
            register_attrs(&mut *addr_of_mut!(ATTRS))
        }
    }

    pub fn meas_handle() -> u16 {
        unsafe { attr_handle(&*addr_of!(ATTRS), 2) }
    }

    pub fn ctrl_handle() -> u16 {
        unsafe { attr_handle(&*addr_of!(ATTRS), 9) }
    }

    pub fn cccd_meas() -> *const gattCharCfg_t {
        addr_of!(CCCD53) as *const gattCharCfg_t
    }

    pub fn cccd_ctrl() -> *const gattCharCfg_t {
        addr_of!(CCCD55) as *const gattCharCfg_t
    }

    pub fn notify_conn(conn: u16, payload: &[u8; 10]) -> bool {
        unsafe { *addr_of_mut!(V53) = *payload };
        notify_if(conn, cccd_meas(), meas_handle(), payload)
    }

    pub fn indicate_conn(conn: u16, value: &[u8]) -> bool {
        indicate_if(conn, cccd_ctrl(), ctrl_handle(), value)
    }
}

// ---------------------------------------------------------------------------
// Scan Parameters 0x1813
// ---------------------------------------------------------------------------

pub mod scan_params {
    use super::*;

    static mut D4F: [u8; 5] = decl(GATT_PROP_WRITE, 0x2A4F);
    static mut D31: [u8; 5] = decl(GATT_PROP_NOTIFY, 0x2A31);

    pub static mut V4F: [u8; 4] = [0; 4];
    pub static mut V31: [u8; 1] = [0];
    pub static mut CCCD31: [gattCharCfg_t; 3] = [CCCD_INIT; 3];

    pub static mut ATTRS: [GattAttribute; 6] = [
        svc(&UUID_1813),
        decl_attr(addr_of!(D4F) as *const u8),
        val(&UUID_2A4F, GATT_PERMIT_WRITE, addr_of!(V4F) as *const u8),
        decl_attr(addr_of!(D31) as *const u8),
        val(&UUID_2A31, GATT_PERMIT_READ, addr_of!(V31) as *const u8),
        cccd(addr_of!(CCCD31) as *const gattCharCfg_t),
    ];

    pub fn register() -> bStatus_t {
        unsafe {
            note_value(addr_of!(D4F) as *const u8, 5, 0);
            note_value(addr_of!(D31) as *const u8, 5, 0);
            note_value(addr_of!(V4F) as *const u8, 4, 4);
            note_value(addr_of!(V31) as *const u8, 1, 0);
            GATTServApp::init_char_cfg(
                INVALID_CONNHANDLE,
                addr_of_mut!(CCCD31) as *mut gattCharCfg_t,
            );
            register_attrs(&mut *addr_of_mut!(ATTRS))
        }
    }

    pub fn refresh_handle() -> u16 {
        unsafe { attr_handle(&*addr_of!(ATTRS), 4) }
    }

    pub fn cccd_ptr() -> *const gattCharCfg_t {
        addr_of!(CCCD31) as *const gattCharCfg_t
    }
}

// ---------------------------------------------------------------------------
// UART transparent service 0xFFF0 / FFF1 notify / FFF2 write
// ---------------------------------------------------------------------------

pub mod uart {
    use super::*;

    static mut D1: [u8; 5] = decl(GATT_PROP_NOTIFY, 0xFFF1);
    static mut D2: [u8; 5] = decl(GATT_PROP_WRITE | GATT_PROP_WRITE_NO_RSP, 0xFFF2);

    pub static mut V1: [u8; 1] = [0];
    pub static mut V2: [u8; 1] = [0];
    pub static mut CCCD1: [gattCharCfg_t; 3] = [CCCD_INIT; 3];

    pub static mut ATTRS: [GattAttribute; 6] = [
        svc(&UUID_FFF0),
        decl_attr(addr_of!(D1) as *const u8),
        val(&UUID_FFF1, GATT_PERMIT_READ, addr_of!(V1) as *const u8),
        cccd(addr_of!(CCCD1) as *const gattCharCfg_t),
        decl_attr(addr_of!(D2) as *const u8),
        val(
            &UUID_FFF2,
            GATT_PERMIT_WRITE,
            addr_of!(V2) as *const u8,
        ),
    ];

    pub fn register() -> bStatus_t {
        unsafe {
            note_value(addr_of!(D1) as *const u8, 5, 0);
            note_value(addr_of!(D2) as *const u8, 5, 0);
            note_value(addr_of!(V1) as *const u8, 1, 0);
            note_value(addr_of!(V2) as *const u8, 1, 1);
            GATTServApp::init_char_cfg(
                INVALID_CONNHANDLE,
                addr_of_mut!(CCCD1) as *mut gattCharCfg_t,
            );
            register_attrs(&mut *addr_of_mut!(ATTRS))
        }
    }

    pub fn tx_handle() -> u16 {
        unsafe { attr_handle(&*addr_of!(ATTRS), 2) }
    }

    pub fn rx_handle() -> u16 {
        unsafe { attr_handle(&*addr_of!(ATTRS), 5) }
    }

    pub fn cccd_tx() -> *const gattCharCfg_t {
        addr_of!(CCCD1) as *const gattCharCfg_t
    }
}

// ---------------------------------------------------------------------------
// IoChub 0xFFF3 / FFF4 notify / FFF5 write
// ---------------------------------------------------------------------------

pub mod iochub {
    use super::*;

    static mut D1: [u8; 5] = decl(GATT_PROP_NOTIFY, 0xFFF4);
    static mut D2: [u8; 5] = decl(GATT_PROP_WRITE | GATT_PROP_WRITE_NO_RSP, 0xFFF5);

    pub static mut V1: [u8; 1] = [0];
    pub static mut V2: [u8; 1] = [0];
    pub static mut CCCD1: [gattCharCfg_t; 3] = [CCCD_INIT; 3];

    pub static mut ATTRS: [GattAttribute; 6] = [
        svc(&UUID_FFF3),
        decl_attr(addr_of!(D1) as *const u8),
        val(&UUID_FFF4, GATT_PERMIT_READ, addr_of!(V1) as *const u8),
        cccd(addr_of!(CCCD1) as *const gattCharCfg_t),
        decl_attr(addr_of!(D2) as *const u8),
        val(
            &UUID_FFF5,
            GATT_PERMIT_WRITE,
            addr_of!(V2) as *const u8,
        ),
    ];

    pub fn register() -> bStatus_t {
        unsafe {
            note_value(addr_of!(D1) as *const u8, 5, 0);
            note_value(addr_of!(D2) as *const u8, 5, 0);
            note_value(addr_of!(V1) as *const u8, 1, 0);
            note_value(addr_of!(V2) as *const u8, 1, 1);
            GATTServApp::init_char_cfg(
                INVALID_CONNHANDLE,
                addr_of_mut!(CCCD1) as *mut gattCharCfg_t,
            );
            register_attrs(&mut *addr_of_mut!(ATTRS))
        }
    }

    pub fn tx_handle() -> u16 {
        unsafe { attr_handle(&*addr_of!(ATTRS), 2) }
    }

    pub fn rx_handle() -> u16 {
        unsafe { attr_handle(&*addr_of!(ATTRS), 5) }
    }

    pub fn cccd_tx() -> *const gattCharCfg_t {
        addr_of!(CCCD1) as *const gattCharCfg_t
    }
}

// ---------------------------------------------------------------------------
// OTA 0xFEE0 / FEE1 read+write+WNR
// ---------------------------------------------------------------------------

pub mod ota {
    use super::*;

    pub const IAP_LEN: usize = 247;

    static mut D1: [u8; 5] = decl(
        GATT_PROP_READ | GATT_PROP_WRITE | GATT_PROP_WRITE_NO_RSP,
        0xFEE1,
    );

    pub static U1: [u8; 11] = *b"OTA Channel";

    pub static mut V1: [u8; IAP_LEN] = [0; IAP_LEN];
    pub static mut RESP_LEN: u16 = 20;

    pub static mut ATTRS: [GattAttribute; 4] = [
        svc(&UUID_FEE0),
        decl_attr(addr_of!(D1) as *const u8),
        val(
            &UUID_FEE1,
            GATT_PERMIT_READ | GATT_PERMIT_WRITE,
            addr_of!(V1) as *const u8,
        ),
        desc(&UUID_USER_DESC, U1.as_ptr()),
    ];

    pub fn register() -> bStatus_t {
        unsafe {
            note_value(addr_of!(D1) as *const u8, 5, 0);
            // Read is capped at 20 bytes; writes may carry a full 247-byte
            // program block.
            note_value(addr_of!(V1) as *const u8, RESP_LEN, IAP_LEN as u16);
            note_value(U1.as_ptr(), 11, 0);
            register_attrs(&mut *addr_of_mut!(ATTRS))
        }
    }

    pub fn value_handle() -> u16 {
        unsafe { attr_handle(&*addr_of!(ATTRS), 2) }
    }

    pub fn value_ptr() -> *mut u8 {
        addr_of_mut!(V1) as *mut u8
    }

    pub fn value() -> &'static mut [u8; IAP_LEN] {
        unsafe { &mut *addr_of_mut!(V1) }
    }

    pub fn set_resp_len(len: u16) {
        let len = core::cmp::min(len, 20);
        unsafe { RESP_LEN = len };
        set_read_len(addr_of!(V1) as *const u8, len);
    }

    /// Command frame parser (spec §21): `cmd, len, addr16, block16, ...`.
    pub fn cmd_info() -> [u8; 8] {
        // image flag = 0 (no valid image), image size, block size.
        [0x00, 0x00, 0x00, 0x00, 0xF7, 0x00, 0x00, 0x00]
    }
}

// ---------------------------------------------------------------------------
// HID services
// ---------------------------------------------------------------------------

mod hid_common {
    use super::*;

    pub const HID_INFO: [u8; 4] = [0x11, 0x01, 0x00, 0x01];

    pub fn register(attrs: &'static mut [GattAttribute], notes: &[(usize, u16, u16)]) -> bStatus_t {
        unsafe {
            for (index, read_len, write_cap) in notes {
                note_value(attrs[*index].value, *read_len, *write_cap);
            }
            // Characteristic declarations are read-only 5-byte buffers; their
            // value pointers are also registered so a local read succeeds.
            for (index, read_len, write_cap) in notes {
                if *read_len == 5 && *write_cap == 0 {
                    note_value(attrs[*index].value, 5, 0);
                }
            }
            register_attrs(attrs)
        }
    }

    pub fn cccd_slice(tbl: *mut gattCharCfg_t) -> &'static mut [gattCharCfg_t] {
        unsafe { core::slice::from_raw_parts_mut(tbl, 3) }
    }

    pub fn init_cccd(tbl: *mut gattCharCfg_t) {
        unsafe { GATTServApp::init_char_cfg(INVALID_CONNHANDLE, tbl) };
    }
}

pub mod hid_keyboard {
    use super::hid_common::*;
    use super::*;

    pub const REPORT_MAP: [u8; 63] = [
        0x05, 0x01, 0x09, 0x06, 0xA1, 0x01, 0x05, 0x07, 0x19, 0xE0, 0x29, 0xE7, 0x15, 0x00, 0x25,
        0x01, 0x75, 0x01, 0x95, 0x08, 0x81, 0x02, 0x95, 0x01, 0x75, 0x08, 0x81, 0x01, 0x05, 0x08,
        0x19, 0x01, 0x29, 0x05, 0x95, 0x05, 0x75, 0x01, 0x91, 0x02, 0x95, 0x01, 0x75, 0x03, 0x91,
        0x01, 0x05, 0x07, 0x19, 0x00, 0x29, 0x65, 0x15, 0x00, 0x25, 0x65, 0x75, 0x08, 0x95, 0x06,
        0x81, 0x00, 0xC0,
    ];

    static mut D4A: [u8; 5] = decl(GATT_PROP_READ, 0x2A4A);
    static mut D4B: [u8; 5] = decl(GATT_PROP_READ, 0x2A4B);
    static mut D4C: [u8; 5] = decl(GATT_PROP_WRITE_NO_RSP, 0x2A4C);
    static mut D4E: [u8; 5] = decl(GATT_PROP_READ | GATT_PROP_WRITE_NO_RSP, 0x2A4E);
    static mut DIN: [u8; 5] = decl(GATT_PROP_READ | GATT_PROP_NOTIFY, 0x2A4D);
    static mut DOUT: [u8; 5] = decl(
        GATT_PROP_READ | GATT_PROP_WRITE | GATT_PROP_WRITE_NO_RSP,
        0x2A4D,
    );
    static mut DBOOTIN: [u8; 5] = decl(GATT_PROP_READ | GATT_PROP_NOTIFY, 0x2A22);
    static mut DBOOTOUT: [u8; 5] = decl(
        GATT_PROP_READ | GATT_PROP_WRITE | GATT_PROP_WRITE_NO_RSP,
        0x2A32,
    );
    static mut DFEAT: [u8; 5] = decl(GATT_PROP_READ | GATT_PROP_WRITE, 0x2A4D);

    static REF_IN: [u8; 2] = [0x00, 0x01];
    static REF_OUT: [u8; 2] = [0x00, 0x02];
    static REF_FEAT: [u8; 2] = [0x00, 0x03];

    pub static mut VINFO: [u8; 4] = HID_INFO;
    pub static mut VCP: [u8; 1] = [0];
    pub static mut VPM: [u8; 1] = [0x01];
    pub static mut VIN: [u8; 8] = [0; 8];
    pub static mut VOUT: [u8; 1] = [0];
    pub static mut VBOOTIN: [u8; 8] = [0; 8];
    pub static mut VBOOTOUT: [u8; 1] = [0];
    pub static mut VFEAT: [u8; 1] = [0];
    pub static mut CCCD_IN: [gattCharCfg_t; 3] = [CCCD_INIT; 3];
    pub static mut CCCD_BOOT: [gattCharCfg_t; 3] = [CCCD_INIT; 3];

    pub static mut ATTRS: [GattAttribute; 24] = [
        svc(&UUID_1812),
        decl_attr(addr_of!(D4A) as *const u8),
        val(&UUID_2A4A, GATT_PERMIT_READ, addr_of!(VINFO) as *const u8),
        decl_attr(addr_of!(D4B) as *const u8),
        val(&UUID_2A4B, GATT_PERMIT_READ, REPORT_MAP.as_ptr()),
        decl_attr(addr_of!(D4C) as *const u8),
        val(&UUID_2A4C, GATT_PERMIT_WRITE, addr_of!(VCP) as *const u8),
        decl_attr(addr_of!(D4E) as *const u8),
        val(&UUID_2A4E, GATT_PERMIT_READ | GATT_PERMIT_WRITE, addr_of!(VPM) as *const u8),
        decl_attr(addr_of!(DIN) as *const u8),
        val(&UUID_2A4D, GATT_PERMIT_READ, addr_of!(VIN) as *const u8),
        cccd(addr_of!(CCCD_IN) as *const gattCharCfg_t),
        desc(&UUID_REPORT_REF, REF_IN.as_ptr()),
        decl_attr(addr_of!(DOUT) as *const u8),
        val(
            &UUID_2A4D,
            GATT_PERMIT_READ | GATT_PERMIT_WRITE,
            addr_of!(VOUT) as *const u8,
        ),
        desc(&UUID_REPORT_REF, REF_OUT.as_ptr()),
        decl_attr(addr_of!(DBOOTIN) as *const u8),
        val(&UUID_2A22, GATT_PERMIT_READ, addr_of!(VBOOTIN) as *const u8),
        cccd(addr_of!(CCCD_BOOT) as *const gattCharCfg_t),
        decl_attr(addr_of!(DBOOTOUT) as *const u8),
        val(
            &UUID_2A32,
            GATT_PERMIT_READ | GATT_PERMIT_WRITE,
            addr_of!(VBOOTOUT) as *const u8,
        ),
        decl_attr(addr_of!(DFEAT) as *const u8),
        val(
            &UUID_2A4D,
            GATT_PERMIT_READ | GATT_PERMIT_WRITE,
            addr_of!(VFEAT) as *const u8,
        ),
        desc(&UUID_REPORT_REF, REF_FEAT.as_ptr()),
    ];

    pub fn register() -> bStatus_t {
        init_cccd(addr_of_mut!(CCCD_IN) as *mut gattCharCfg_t);
        init_cccd(addr_of_mut!(CCCD_BOOT) as *mut gattCharCfg_t);
        let notes: &[(usize, u16, u16)] = &[
            (2, 4, 0),   // HID info
            (4, 63, 0),  // report map
            (6, 1, 1),   // control point
            (8, 1, 1),   // protocol mode
            (10, 8, 0),  // input report
            (12, 2, 0),  // report reference
            (14, 1, 1),  // output report
            (15, 2, 0),  // report reference
            (17, 8, 0),  // boot input
            (19, 1, 1),  // boot output
            (21, 1, 1),  // feature report
            (23, 2, 0),  // report reference
        ];
        unsafe { hid_common::register(&mut *addr_of_mut!(ATTRS), notes) }
    }

    pub fn input_handle() -> u16 {
        unsafe { attr_handle(&*addr_of!(ATTRS), 10) }
    }

    pub fn boot_input_handle() -> u16 {
        unsafe { attr_handle(&*addr_of!(ATTRS), 17) }
    }

    pub fn cccd_input() -> *const gattCharCfg_t {
        addr_of!(CCCD_IN) as *const gattCharCfg_t
    }

    pub fn cccd_boot() -> *const gattCharCfg_t {
        addr_of!(CCCD_BOOT) as *const gattCharCfg_t
    }

    pub fn notify_conn(conn: u16, report: &[u8; 8]) -> bool {
        unsafe { *addr_of_mut!(VIN) = *report };
        notify_if(conn, cccd_input(), input_handle(), report)
    }
}

pub mod hid_mouse {
    use super::hid_common::*;
    use super::*;

    pub const REPORT_MAP: [u8; 46] = [
        0x05, 0x01, 0x09, 0x02, 0xA1, 0x01, 0x09, 0x01, 0xA1, 0x00, 0x05, 0x09, 0x19, 0x01, 0x29,
        0x03, 0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x08, 0x81, 0x02, 0x05, 0x01, 0x09, 0x30,
        0x09, 0x31, 0x09, 0x38, 0x15, 0x81, 0x25, 0x7F, 0x75, 0x08, 0x95, 0x03, 0x81, 0x06, 0xC0,
        0xC0,
    ];

    static mut D4A: [u8; 5] = decl(GATT_PROP_READ, 0x2A4A);
    static mut D4B: [u8; 5] = decl(GATT_PROP_READ, 0x2A4B);
    static mut D4C: [u8; 5] = decl(GATT_PROP_WRITE_NO_RSP, 0x2A4C);
    static mut D4E: [u8; 5] = decl(GATT_PROP_READ | GATT_PROP_WRITE_NO_RSP, 0x2A4E);
    static mut DIN: [u8; 5] = decl(GATT_PROP_READ | GATT_PROP_NOTIFY, 0x2A4D);
    static mut DFEAT: [u8; 5] = decl(GATT_PROP_READ | GATT_PROP_WRITE, 0x2A4D);

    static REF_IN: [u8; 2] = [0x00, 0x01];
    static REF_FEAT: [u8; 2] = [0x00, 0x03];

    pub static mut VINFO: [u8; 4] = HID_INFO;
    pub static mut VCP: [u8; 1] = [0];
    pub static mut VPM: [u8; 1] = [0x01];
    pub static mut VIN: [u8; 4] = [0; 4];
    pub static mut VFEAT: [u8; 1] = [0];
    pub static mut CCCD_IN: [gattCharCfg_t; 3] = [CCCD_INIT; 3];

    pub static mut ATTRS: [GattAttribute; 16] = [
        svc(&UUID_1812),
        decl_attr(addr_of!(D4A) as *const u8),
        val(&UUID_2A4A, GATT_PERMIT_READ, addr_of!(VINFO) as *const u8),
        decl_attr(addr_of!(D4B) as *const u8),
        val(&UUID_2A4B, GATT_PERMIT_READ, REPORT_MAP.as_ptr()),
        decl_attr(addr_of!(D4C) as *const u8),
        val(&UUID_2A4C, GATT_PERMIT_WRITE, addr_of!(VCP) as *const u8),
        decl_attr(addr_of!(D4E) as *const u8),
        val(&UUID_2A4E, GATT_PERMIT_READ | GATT_PERMIT_WRITE, addr_of!(VPM) as *const u8),
        decl_attr(addr_of!(DIN) as *const u8),
        val(&UUID_2A4D, GATT_PERMIT_READ, addr_of!(VIN) as *const u8),
        cccd(addr_of!(CCCD_IN) as *const gattCharCfg_t),
        desc(&UUID_REPORT_REF, REF_IN.as_ptr()),
        decl_attr(addr_of!(DFEAT) as *const u8),
        val(
            &UUID_2A4D,
            GATT_PERMIT_READ | GATT_PERMIT_WRITE,
            addr_of!(VFEAT) as *const u8,
        ),
        desc(&UUID_REPORT_REF, REF_FEAT.as_ptr()),
    ];

    pub fn register() -> bStatus_t {
        init_cccd(addr_of_mut!(CCCD_IN) as *mut gattCharCfg_t);
        let notes: &[(usize, u16, u16)] = &[
            (2, 4, 0),
            (4, 46, 0),
            (6, 1, 1),
            (8, 1, 1),
            (10, 4, 0),
            (12, 2, 0),
            (14, 1, 1),
            (15, 2, 0),
        ];
        unsafe { hid_common::register(&mut *addr_of_mut!(ATTRS), notes) }
    }

    pub fn input_handle() -> u16 {
        unsafe { attr_handle(&*addr_of!(ATTRS), 10) }
    }

    pub fn cccd_input() -> *const gattCharCfg_t {
        addr_of!(CCCD_IN) as *const gattCharCfg_t
    }

    pub fn notify_conn(conn: u16, report: &[u8; 4]) -> bool {
        unsafe { *addr_of_mut!(VIN) = *report };
        notify_if(conn, cccd_input(), input_handle(), report)
    }
}

pub mod hid_consumer {
    use super::hid_common::*;
    use super::*;

    pub const REPORT_MAP: [u8; 25] = [
        0x05, 0x0C, 0x09, 0x01, 0xA1, 0x01, 0x85, 0x01, 0x15, 0x00, 0x25, 0x01, 0x75, 0x08, 0x95,
        0x01, 0x09, 0xE9, 0x81, 0x06, 0x09, 0xEA, 0x81, 0x06, 0xC0,
    ];

    static mut D4A: [u8; 5] = decl(GATT_PROP_READ, 0x2A4A);
    static mut D4B: [u8; 5] = decl(GATT_PROP_READ, 0x2A4B);
    static mut D4C: [u8; 5] = decl(GATT_PROP_WRITE_NO_RSP, 0x2A4C);
    static mut D4E: [u8; 5] = decl(GATT_PROP_READ | GATT_PROP_WRITE_NO_RSP, 0x2A4E);
    static mut DIN: [u8; 5] = decl(GATT_PROP_READ | GATT_PROP_NOTIFY, 0x2A4D);
    static mut DFEAT: [u8; 5] = decl(GATT_PROP_READ | GATT_PROP_WRITE, 0x2A4D);

    static REF_IN: [u8; 2] = [0x01, 0x01];
    static REF_FEAT: [u8; 2] = [0x01, 0x03];

    pub static mut VINFO: [u8; 4] = HID_INFO;
    pub static mut VCP: [u8; 1] = [0];
    pub static mut VPM: [u8; 1] = [0x01];
    pub static mut VIN: [u8; 2] = [0; 2];
    pub static mut VFEAT: [u8; 1] = [0];
    pub static mut CCCD_IN: [gattCharCfg_t; 3] = [CCCD_INIT; 3];

    pub static mut ATTRS: [GattAttribute; 16] = [
        svc(&UUID_1812),
        decl_attr(addr_of!(D4A) as *const u8),
        val(&UUID_2A4A, GATT_PERMIT_READ, addr_of!(VINFO) as *const u8),
        decl_attr(addr_of!(D4B) as *const u8),
        val(&UUID_2A4B, GATT_PERMIT_READ, REPORT_MAP.as_ptr()),
        decl_attr(addr_of!(D4C) as *const u8),
        val(&UUID_2A4C, GATT_PERMIT_WRITE, addr_of!(VCP) as *const u8),
        decl_attr(addr_of!(D4E) as *const u8),
        val(&UUID_2A4E, GATT_PERMIT_READ | GATT_PERMIT_WRITE, addr_of!(VPM) as *const u8),
        decl_attr(addr_of!(DIN) as *const u8),
        val(&UUID_2A4D, GATT_PERMIT_READ, addr_of!(VIN) as *const u8),
        cccd(addr_of!(CCCD_IN) as *const gattCharCfg_t),
        desc(&UUID_REPORT_REF, REF_IN.as_ptr()),
        decl_attr(addr_of!(DFEAT) as *const u8),
        val(
            &UUID_2A4D,
            GATT_PERMIT_READ | GATT_PERMIT_WRITE,
            addr_of!(VFEAT) as *const u8,
        ),
        desc(&UUID_REPORT_REF, REF_FEAT.as_ptr()),
    ];

    pub fn register() -> bStatus_t {
        init_cccd(addr_of_mut!(CCCD_IN) as *mut gattCharCfg_t);
        let notes: &[(usize, u16, u16)] = &[
            (2, 4, 0),
            (4, 25, 0),
            (6, 1, 1),
            (8, 1, 1),
            (10, 2, 0),
            (12, 2, 0),
            (14, 1, 1),
            (15, 2, 0),
        ];
        unsafe { hid_common::register(&mut *addr_of_mut!(ATTRS), notes) }
    }

    pub fn input_handle() -> u16 {
        unsafe { attr_handle(&*addr_of!(ATTRS), 10) }
    }

    pub fn cccd_input() -> *const gattCharCfg_t {
        addr_of!(CCCD_IN) as *const gattCharCfg_t
    }

    pub fn notify_conn(conn: u16, report: &[u8; 2]) -> bool {
        unsafe { *addr_of_mut!(VIN) = *report };
        notify_if(conn, cccd_input(), input_handle(), report)
    }
}

pub mod hid_touch {
    use super::hid_common::*;
    use super::*;

    pub const REPORT_MAP: [u8; 72] = [
        0x05, 0x0D, 0x09, 0x04, 0xA1, 0x01, 0x85, 0x01, 0x09, 0x22, 0xA1, 0x02, 0x09, 0x42, 0x15,
        0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x01, 0x81, 0x02, 0x95, 0x07, 0x81, 0x03, 0x09, 0x51,
        0x25, 0x0A, 0x75, 0x08, 0x95, 0x01, 0x81, 0x02, 0xC0, 0x05, 0x01, 0x09, 0x30, 0x09, 0x31,
        0x15, 0x00, 0x26, 0x00, 0x08, 0x75, 0x10, 0x95, 0x02, 0x81, 0x02, 0x06, 0x00, 0xFF,
        0x09, 0x01, 0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x01, 0xB1, 0x02, 0xC0,
    ];

    static mut D4A: [u8; 5] = decl(GATT_PROP_READ, 0x2A4A);
    static mut D4B: [u8; 5] = decl(GATT_PROP_READ, 0x2A4B);
    static mut D4C: [u8; 5] = decl(GATT_PROP_WRITE_NO_RSP, 0x2A4C);
    static mut D4E: [u8; 5] = decl(GATT_PROP_READ | GATT_PROP_WRITE_NO_RSP, 0x2A4E);
    static mut DIN: [u8; 5] = decl(GATT_PROP_READ | GATT_PROP_NOTIFY, 0x2A4D);
    static mut DFEAT: [u8; 5] = decl(GATT_PROP_READ | GATT_PROP_WRITE, 0x2A4D);

    static REF_IN: [u8; 2] = [0x01, 0x01];
    static REF_FEAT: [u8; 2] = [0x01, 0x03];

    pub static mut VINFO: [u8; 4] = HID_INFO;
    pub static mut VCP: [u8; 1] = [0];
    pub static mut VPM: [u8; 1] = [0x01];
    pub static mut VIN: [u8; 6] = [0; 6];
    pub static mut VFEAT: [u8; 1] = [0];
    pub static mut CCCD_IN: [gattCharCfg_t; 3] = [CCCD_INIT; 3];

    pub static mut ATTRS: [GattAttribute; 16] = [
        svc(&UUID_1812),
        decl_attr(addr_of!(D4A) as *const u8),
        val(&UUID_2A4A, GATT_PERMIT_READ, addr_of!(VINFO) as *const u8),
        decl_attr(addr_of!(D4B) as *const u8),
        val(&UUID_2A4B, GATT_PERMIT_READ, REPORT_MAP.as_ptr()),
        decl_attr(addr_of!(D4C) as *const u8),
        val(&UUID_2A4C, GATT_PERMIT_WRITE, addr_of!(VCP) as *const u8),
        decl_attr(addr_of!(D4E) as *const u8),
        val(&UUID_2A4E, GATT_PERMIT_READ | GATT_PERMIT_WRITE, addr_of!(VPM) as *const u8),
        decl_attr(addr_of!(DIN) as *const u8),
        val(&UUID_2A4D, GATT_PERMIT_READ, addr_of!(VIN) as *const u8),
        cccd(addr_of!(CCCD_IN) as *const gattCharCfg_t),
        desc(&UUID_REPORT_REF, REF_IN.as_ptr()),
        decl_attr(addr_of!(DFEAT) as *const u8),
        val(
            &UUID_2A4D,
            GATT_PERMIT_READ | GATT_PERMIT_WRITE,
            addr_of!(VFEAT) as *const u8,
        ),
        desc(&UUID_REPORT_REF, REF_FEAT.as_ptr()),
    ];

    pub fn register() -> bStatus_t {
        init_cccd(addr_of_mut!(CCCD_IN) as *mut gattCharCfg_t);
        let notes: &[(usize, u16, u16)] = &[
            (2, 4, 0),
            (4, 72, 0),
            (6, 1, 1),
            (8, 1, 1),
            (10, 6, 0),
            (12, 2, 0),
            (14, 1, 1),
            (15, 2, 0),
        ];
        unsafe { hid_common::register(&mut *addr_of_mut!(ATTRS), notes) }
    }

    pub fn input_handle() -> u16 {
        unsafe { attr_handle(&*addr_of!(ATTRS), 10) }
    }

    pub fn cccd_input() -> *const gattCharCfg_t {
        addr_of!(CCCD_IN) as *const gattCharCfg_t
    }

    pub fn notify_conn(conn: u16, report: &[u8; 6]) -> bool {
        unsafe { *addr_of_mut!(VIN) = *report };
        notify_if(conn, cccd_input(), input_handle(), report)
    }
}

