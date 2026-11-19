//! M18 GATT client/server convenience layer.
//!
//! The EVT comparison programs need four things the M17 shim did not expose:
//!
//! 1. decoding of `gattMsgEvent_t` into typed client events,
//! 2. discovery / read / write / MTU request wrappers,
//! 3. variable-length notify and indication helpers, and
//! 4. per-connection CCCD handling (`GATTServApp_ProcessCharCfg`, which is in
//!    `gattservapp.rs`).
//!
//! The FFI declarations live in [`crate::ffi`]; this module only adds safe-ish
//! wrappers. Payload slices returned by [`gattMsgEvent_t::decode`] borrow the
//! TMOS message, so they must be copied before the [`crate::TmosEvent`] is
//! dropped (its `Drop` calls `tmos_msg_deallocate`).

#![allow(non_snake_case, non_camel_case_types)]

use core::num::NonZeroU8;
use core::ptr;
use core::slice;

use crate::ffi;
use crate::gatt::{
    attAttrType_t, attExchangeMTUReq_t, attHandleValueInd_t, attHandleValueNoti_t,
    attReadBlobReq_t, attReadByTypeReq_t, attReadReq_t, attWriteReq_t, gattMsgEvent_t, gattMsg_t,
    ATT_ERROR_RSP, ATT_EXCHANGE_MTU_RSP, ATT_FIND_BY_TYPE_VALUE_RSP, ATT_FIND_INFO_RSP,
    ATT_FLOW_CTRL_VIOLATED_EVENT, ATT_HANDLE_VALUE_CFM, ATT_HANDLE_VALUE_IND,
    ATT_HANDLE_VALUE_NOTI, ATT_MTU_UPDATED_EVENT, ATT_READ_BLOB_RSP, ATT_READ_BY_GRP_TYPE_RSP,
    ATT_READ_BY_TYPE_RSP, ATT_READ_RSP, ATT_WRITE_CMD, ATT_WRITE_REQ, ATT_WRITE_RSP,
    GATT_Indication, GATT_Notification, GATT_bm_alloc, GATT_bm_free,
};

/// GATT status codes used by the wrappers (see `ffi.rs` comment block).
const BLE_INVALID_PARAMETER: u8 = 0x02;
const BLE_MEM_ALLOC_ERROR: u8 = 0x13;

#[inline]
const fn status(code: u8) -> NonZeroU8 {
    match NonZeroU8::new(code) {
        Some(v) => v,
        None => panic!("zero BLE status"),
    }
}

#[inline]
fn invalid_parameter() -> NonZeroU8 {
    status(BLE_INVALID_PARAMETER)
}

#[inline]
fn mem_alloc_error() -> NonZeroU8 {
    status(BLE_MEM_ALLOC_ERROR)
}

#[inline]
unsafe fn bytes<'a>(p: *const u8, len: usize) -> &'a [u8] {
    if p.is_null() || len == 0 {
        &[]
    } else {
        slice::from_raw_parts(p, len)
    }
}

#[inline]
fn entries_len(count: u16, entry_len: u16) -> usize {
    (count as usize).saturating_mul(entry_len as usize)
}

/// Decoded view of one `GATT_MSG_EVENT` (`gattMsgEvent_t`).
///
/// `method` is the ATT opcode (or one of the locally generated
/// `ATT_*_EVENT` values). Unknown methods are surfaced as [`Self::Other`] so
/// the caller can still release the message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GattClientEvent<'a> {
    /// `ATT_READ_RSP` (`GATT_ReadCharValue` / `GATT_ReadCharDesc`).
    ReadRsp {
        conn_handle: u16,
        value: &'a [u8],
    },
    /// `ATT_READ_BLOB_RSP` (`GATT_ReadLongCharValue`).
    ReadBlobRsp {
        conn_handle: u16,
        value: &'a [u8],
    },
    /// `ATT_WRITE_RSP` (`GATT_WriteCharValue` / `GATT_WriteCharDesc`).
    WriteRsp { conn_handle: u16 },
    /// `ATT_EXCHANGE_MTU_RSP`.
    ExchangeMtuRsp {
        conn_handle: u16,
        server_rx_mtu: u16,
    },
    /// `ATT_FIND_INFO_RSP`; `info` is `num_info` entries of 4 (format 0x01)
    /// or 18 (format 0x02) bytes.
    FindInfoRsp {
        conn_handle: u16,
        format: u8,
        num_info: u16,
        info: &'a [u8],
    },
    /// `ATT_FIND_BY_TYPE_VALUE_RSP`; each entry is a 4-byte handle range.
    FindByTypeValueRsp {
        conn_handle: u16,
        num_info: u16,
        handles_info: &'a [u8],
    },
    /// `ATT_READ_BY_TYPE_RSP`; `data` is `num_pairs` entries of `entry_len`.
    ReadByTypeRsp {
        conn_handle: u16,
        num_pairs: u16,
        entry_len: u16,
        data: &'a [u8],
    },
    /// `ATT_READ_BY_GRP_TYPE_RSP` (`GATT_DiscAllPrimaryServices`).
    ReadByGrpTypeRsp {
        conn_handle: u16,
        num_grps: u16,
        entry_len: u16,
        data: &'a [u8],
    },
    /// `ATT_HANDLE_VALUE_NOTI`.
    HandleValueNoti {
        conn_handle: u16,
        handle: u16,
        value: &'a [u8],
    },
    /// `ATT_HANDLE_VALUE_IND`.
    HandleValueInd {
        conn_handle: u16,
        handle: u16,
        value: &'a [u8],
    },
    /// `ATT_HANDLE_VALUE_CFM`: confirmation for a previous indication.
    HandleValueCfm { conn_handle: u16, status: u8 },
    /// `ATT_MTU_UPDATED_EVENT`.
    MtuUpdated { conn_handle: u16, mtu: u16 },
    /// `ATT_FLOW_CTRL_VIOLATED_EVENT`.
    FlowCtrlViolated {
        conn_handle: u16,
        opcode: u8,
        pending_opcode: u8,
    },
    /// `ATT_ERROR_RSP`.
    ErrorRsp {
        conn_handle: u16,
        req_opcode: u8,
        handle: u16,
        err_code: u8,
    },
    /// Any method not covered above.
    Other { conn_handle: u16, method: u8 },
}

impl gattMsgEvent_t {
    /// Decode this event by `method`.
    ///
    /// Payload slices point into the TMOS message allocation owned by the
    /// `TmosEvent`; copy them before dropping the event.
    pub fn decode(&self) -> GattClientEvent<'_> {
        let conn_handle = self.connHandle;
        unsafe {
            match self.method {
                ATT_READ_RSP => {
                    let rsp = self.msg.readRsp;
                    GattClientEvent::ReadRsp {
                        conn_handle,
                        value: bytes(rsp.pValue, rsp.len as usize),
                    }
                }
                ATT_READ_BLOB_RSP => {
                    let rsp = self.msg.readBlobRsp;
                    GattClientEvent::ReadBlobRsp {
                        conn_handle,
                        value: bytes(rsp.pValue, rsp.len as usize),
                    }
                }
                ATT_WRITE_RSP => GattClientEvent::WriteRsp { conn_handle },
                ATT_EXCHANGE_MTU_RSP => GattClientEvent::ExchangeMtuRsp {
                    conn_handle,
                    server_rx_mtu: self.msg.exchangeMTURsp.serverRxMTU,
                },
                ATT_FIND_INFO_RSP => {
                    let rsp = self.msg.findInfoRsp;
                    let entry_len = match rsp.format {
                        0x01 => 4,
                        0x02 => 18,
                        _ => 0,
                    };
                    GattClientEvent::FindInfoRsp {
                        conn_handle,
                        format: rsp.format,
                        num_info: rsp.numInfo,
                        info: bytes(rsp.pInfo, entries_len(rsp.numInfo, entry_len)),
                    }
                }
                ATT_FIND_BY_TYPE_VALUE_RSP => {
                    let rsp = self.msg.findByTypeValueRsp;
                    GattClientEvent::FindByTypeValueRsp {
                        conn_handle,
                        num_info: rsp.numInfo,
                        handles_info: bytes(rsp.pHandlesInfo, entries_len(rsp.numInfo, 4)),
                    }
                }
                ATT_READ_BY_TYPE_RSP => {
                    let rsp = self.msg.readByTypeRsp;
                    GattClientEvent::ReadByTypeRsp {
                        conn_handle,
                        num_pairs: rsp.numPairs,
                        entry_len: rsp.len,
                        data: bytes(rsp.pDataList, entries_len(rsp.numPairs, rsp.len)),
                    }
                }
                ATT_READ_BY_GRP_TYPE_RSP => {
                    let rsp = self.msg.readByGrpTypeRsp;
                    GattClientEvent::ReadByGrpTypeRsp {
                        conn_handle,
                        num_grps: rsp.numGrps,
                        entry_len: rsp.len,
                        data: bytes(rsp.pDataList, entries_len(rsp.numGrps, rsp.len)),
                    }
                }
                ATT_HANDLE_VALUE_NOTI => {
                    let noti = self.msg.handleValueNoti;
                    GattClientEvent::HandleValueNoti {
                        conn_handle,
                        handle: noti.handle,
                        value: bytes(noti.pValue, noti.len as usize),
                    }
                }
                ATT_HANDLE_VALUE_IND => {
                    let ind = self.msg.handleValueInd;
                    GattClientEvent::HandleValueInd {
                        conn_handle,
                        handle: ind.handle,
                        value: bytes(ind.pValue, ind.len as usize),
                    }
                }
                ATT_HANDLE_VALUE_CFM => GattClientEvent::HandleValueCfm {
                    conn_handle,
                    status: self.hdr.status,
                },
                ATT_MTU_UPDATED_EVENT => GattClientEvent::MtuUpdated {
                    conn_handle,
                    mtu: self.msg.mtuEvt.MTU,
                },
                ATT_FLOW_CTRL_VIOLATED_EVENT => {
                    let evt = self.msg.flowCtrlEvt;
                    GattClientEvent::FlowCtrlViolated {
                        conn_handle,
                        opcode: evt.opcode,
                        pending_opcode: evt.pendingOpcode,
                    }
                }
                ATT_ERROR_RSP => {
                    let rsp = self.msg.errorRsp;
                    GattClientEvent::ErrorRsp {
                        conn_handle,
                        req_opcode: rsp.reqOpcode,
                        handle: rsp.handle,
                        err_code: rsp.errCode,
                    }
                }
                method => GattClientEvent::Other {
                    conn_handle,
                    method,
                },
            }
        }
    }
}

// --- discovery --------------------------------------------------------------

/// `GATT_DiscAllPrimaryServices`.
pub fn disc_all_primary_services(conn_handle: u16, task_id: u8) -> ffi::bStatus_t {
    unsafe { ffi::GATT_DiscAllPrimaryServices(conn_handle, task_id) }
}

/// `GATT_DiscPrimaryServiceByUUID`; `uuid` must be 2 or 16 bytes.
pub fn disc_primary_service_by_uuid(
    conn_handle: u16,
    uuid: &[u8],
    task_id: u8,
) -> ffi::bStatus_t {
    if uuid.len() != 2 && uuid.len() != 16 {
        return Err(invalid_parameter());
    }
    let mut buf = [0u8; 16];
    buf[..uuid.len()].copy_from_slice(uuid);
    unsafe {
        ffi::GATT_DiscPrimaryServiceByUUID(
            conn_handle,
            buf.as_mut_ptr(),
            uuid.len() as u8,
            task_id,
        )
    }
}

/// `GATT_DiscAllChars`.
pub fn disc_all_chars(
    conn_handle: u16,
    start_handle: u16,
    end_handle: u16,
    task_id: u8,
) -> ffi::bStatus_t {
    unsafe { ffi::GATT_DiscAllChars(conn_handle, start_handle, end_handle, task_id) }
}

/// `GATT_DiscCharsByUUID`; `uuid` must be 2 or 16 bytes.
pub fn disc_chars_by_uuid(
    conn_handle: u16,
    start_handle: u16,
    end_handle: u16,
    uuid: &[u8],
    task_id: u8,
) -> ffi::bStatus_t {
    let mut req = attReadByTypeReq_t {
        startHandle: start_handle,
        endHandle: end_handle,
        type_: match att_type(uuid) {
            Ok(t) => t,
            Err(e) => return Err(e),
        },
    };
    unsafe { ffi::GATT_DiscCharsByUUID(conn_handle, &mut req, task_id) }
}

/// `GATT_DiscAllCharDescs`.
pub fn disc_all_char_descs(
    conn_handle: u16,
    start_handle: u16,
    end_handle: u16,
    task_id: u8,
) -> ffi::bStatus_t {
    unsafe { ffi::GATT_DiscAllCharDescs(conn_handle, start_handle, end_handle, task_id) }
}

// --- MTU --------------------------------------------------------------------

/// `GATT_ExchangeMTU`; the response arrives as [`GattClientEvent::ExchangeMtuRsp`].
pub fn exchange_mtu(
    conn_handle: u16,
    client_rx_mtu: u16,
    task_id: u8,
) -> ffi::bStatus_t {
    let mut req = attExchangeMTUReq_t { clientRxMTU: client_rx_mtu };
    unsafe { ffi::GATT_ExchangeMTU(conn_handle, &mut req, task_id) }
}

/// Largest ATT payload for an MTU (`ATT_MTU - 3`, the notification header).
#[inline]
pub fn max_notify_payload(mtu: u16) -> u16 {
    mtu.saturating_sub(3)
}

// --- reads ------------------------------------------------------------------

/// `GATT_ReadCharValue`; response is [`GattClientEvent::ReadRsp`].
pub fn read_char_value(conn_handle: u16, handle: u16, task_id: u8) -> ffi::bStatus_t {
    let mut req = attReadReq_t { handle };
    unsafe { ffi::GATT_ReadCharValue(conn_handle, &mut req, task_id) }
}

/// `GATT_ReadLongCharValue`; response is [`GattClientEvent::ReadBlobRsp`].
pub fn read_long_char_value(
    conn_handle: u16,
    handle: u16,
    offset: u16,
    task_id: u8,
) -> ffi::bStatus_t {
    let mut req = attReadBlobReq_t { handle, offset };
    unsafe { ffi::GATT_ReadLongCharValue(conn_handle, &mut req, task_id) }
}

/// `GATT_ReadUsingCharUUID`; response is [`GattClientEvent::ReadByTypeRsp`].
pub fn read_using_char_uuid(
    conn_handle: u16,
    start_handle: u16,
    end_handle: u16,
    uuid: &[u8],
    task_id: u8,
) -> ffi::bStatus_t {
    let mut req = attReadByTypeReq_t {
        startHandle: start_handle,
        endHandle: end_handle,
        type_: match att_type(uuid) {
            Ok(t) => t,
            Err(e) => return Err(e),
        },
    };
    unsafe { ffi::GATT_ReadUsingCharUUID(conn_handle, &mut req, task_id) }
}

/// `GATT_ReadCharDesc`; response is [`GattClientEvent::ReadRsp`].
pub fn read_char_desc(conn_handle: u16, handle: u16, task_id: u8) -> ffi::bStatus_t {
    let mut req = attReadReq_t { handle };
    unsafe { ffi::GATT_ReadCharDesc(conn_handle, &mut req, task_id) }
}

// --- writes -----------------------------------------------------------------

fn att_type(uuid: &[u8]) -> Result<attAttrType_t, NonZeroU8> {
    if uuid.len() != 2 && uuid.len() != 16 {
        return Err(invalid_parameter());
    }
    let mut type_ = attAttrType_t {
        len: uuid.len() as u8,
        uuid: [0u8; 16],
    };
    type_.uuid[..uuid.len()].copy_from_slice(uuid);
    Ok(type_)
}

/// Copy `value` into a `GATT_bm_alloc` buffer and hand it to `call`.
///
/// On failure the buffer is released. On success the stack owns the buffer
/// until the operation completes (or until the write command is sent).
fn write_value<F>(
    conn_handle: u16,
    handle: u16,
    value: &[u8],
    opcode: u8,
    call: F,
) -> ffi::bStatus_t
where
    F: FnOnce(*mut attWriteReq_t) -> ffi::bStatus_t,
{
    if value.len() > u16::MAX as usize {
        return Err(invalid_parameter());
    }
    let mut size_alloc: u16 = 0;
    let buf = unsafe {
        GATT_bm_alloc(
            conn_handle,
            opcode,
            value.len() as u16,
            &mut size_alloc,
            0,
        ) as *mut u8
    };
    if buf.is_null() {
        return Err(mem_alloc_error());
    }
    unsafe { ptr::copy_nonoverlapping(value.as_ptr(), buf, value.len()) };

    let mut req = attWriteReq_t {
        handle,
        len: value.len() as u16,
        pValue: buf,
        sig: 0,
        cmd: u8::from(opcode == ATT_WRITE_CMD),
    };
    let result = call(&mut req);
    if result.is_err() {
        unsafe {
            GATT_bm_free(&mut req as *mut attWriteReq_t as *mut gattMsg_t, opcode);
        }
    }
    result
}

/// `GATT_WriteCharValue`; response is [`GattClientEvent::WriteRsp`].
pub fn write_char_value(
    conn_handle: u16,
    handle: u16,
    value: &[u8],
    task_id: u8,
) -> ffi::bStatus_t {
    write_value(conn_handle, handle, value, ATT_WRITE_REQ, |req| unsafe {
        ffi::GATT_WriteCharValue(conn_handle, req, task_id)
    })
}

/// `GATT_WriteNoRsp` (ATT Write Command); no response follows.
pub fn write_no_rsp(conn_handle: u16, handle: u16, value: &[u8]) -> ffi::bStatus_t {
    write_value(conn_handle, handle, value, ATT_WRITE_CMD, |req| unsafe {
        ffi::GATT_WriteNoRsp(conn_handle, req)
    })
}

/// `GATT_WriteCharDesc`; response is [`GattClientEvent::WriteRsp`].
pub fn write_char_desc(
    conn_handle: u16,
    handle: u16,
    value: &[u8],
    task_id: u8,
) -> ffi::bStatus_t {
    write_value(conn_handle, handle, value, ATT_WRITE_REQ, |req| unsafe {
        ffi::GATT_WriteCharDesc(conn_handle, req, task_id)
    })
}

// --- server side notify / indicate -----------------------------------------

/// Send a notification of any length (`GATT_bm_alloc` + `GATT_Notification`).
///
/// `value.len()` must not exceed the negotiated MTU minus 3; callers can use
/// [`max_notify_payload`] with the value seen in
/// [`GattClientEvent::MtuUpdated`]. The allocation size passed to
/// `GATT_bm_alloc` is exactly `value.len()` (as in the generated peripheral
/// template).
pub fn send_notification(
    conn_handle: u16,
    attr_handle: u16,
    value: &[u8],
    authenticated: bool,
) -> ffi::bStatus_t {
    if value.len() > u16::MAX as usize {
        return Err(invalid_parameter());
    }
    let mut size_alloc: u16 = 0;
    let buf = unsafe {
        GATT_bm_alloc(
            conn_handle,
            ATT_HANDLE_VALUE_NOTI,
            value.len() as u16,
            &mut size_alloc,
            0,
        ) as *mut u8
    };
    if buf.is_null() {
        return Err(mem_alloc_error());
    }
    unsafe { ptr::copy_nonoverlapping(value.as_ptr(), buf, value.len()) };

    let mut noti = attHandleValueNoti_t {
        handle: attr_handle,
        len: value.len() as u16,
        pValue: buf,
    };
    let result = unsafe { GATT_Notification(conn_handle, &noti, authenticated as u8) };
    if result.is_err() {
        unsafe {
            GATT_bm_free(
                &mut noti as *mut attHandleValueNoti_t as *mut gattMsg_t,
                ATT_HANDLE_VALUE_NOTI,
            );
        }
    }
    result
}

/// Send an indication (`GATT_bm_alloc` + `GATT_Indication`).
///
/// The confirmation is delivered as
/// [`GattClientEvent::HandleValueCfm`] on `task_id` (`status == 0` means the
/// peer confirmed). Only one indication may be outstanding per connection, so
/// do not reuse or free the buffer before the confirmation arrives.
pub fn send_indication(
    conn_handle: u16,
    attr_handle: u16,
    value: &[u8],
    authenticated: bool,
    task_id: u8,
) -> ffi::bStatus_t {
    if value.len() > u16::MAX as usize {
        return Err(invalid_parameter());
    }
    let mut size_alloc: u16 = 0;
    let buf = unsafe {
        GATT_bm_alloc(
            conn_handle,
            ATT_HANDLE_VALUE_IND,
            value.len() as u16,
            &mut size_alloc,
            0,
        ) as *mut u8
    };
    if buf.is_null() {
        return Err(mem_alloc_error());
    }
    unsafe { ptr::copy_nonoverlapping(value.as_ptr(), buf, value.len()) };

    let mut ind = attHandleValueInd_t {
        handle: attr_handle,
        len: value.len() as u16,
        pValue: buf,
    };
    let result = unsafe { GATT_Indication(conn_handle, &ind, authenticated as u8, task_id) };
    if result.is_err() {
        unsafe {
            GATT_bm_free(
                &mut ind as *mut attHandleValueInd_t as *mut gattMsg_t,
                ATT_HANDLE_VALUE_IND,
            );
        }
    }
    result
}