//! LE ATT 固定信道的 Basic Frame 和 27 字节 LL 分片。

use crate::att::{Server, MAX_MTU};
use crate::ll::{DataChannel, CONTINUATION, MAX_PAYLOAD, START};

const ATT_CID: u16 = 0x0004;
const HEADER: usize = 4;
const BUFFER: usize = HEADER + 65; // 65 字节 SMP Public Key。

pub struct AttChannel {
    rx: [u8; BUFFER],
    rx_len: usize,
    rx_target: usize,
    tx: [u8; BUFFER],
    tx_len: usize,
    tx_cursor: usize,
}

impl AttChannel {
    pub const fn new() -> Self {
        Self {
            rx: [0; BUFFER],
            rx_len: 0,
            rx_target: 0,
            tx: [0; BUFFER],
            tx_len: 0,
            tx_cursor: 0,
        }
    }

    /// 在事件之间分发完整 ATT PDU，响应优先于通知。
    pub fn process(&mut self, server: &mut Server) {
        if self.has_pending() {
            return;
        }
        let out: &mut [u8; MAX_MTU] = (&mut self.tx[HEADER..HEADER + MAX_MTU]).try_into().unwrap();
        let mut len = 0;
        if self.rx_target != 0 && self.rx_len == self.rx_target {
            if self.rx[2] == ATT_CID as u8 {
                len = server.request(&self.rx[HEADER..self.rx_len], out);
            }
            self.rx_len = 0;
            self.rx_target = 0;
        }
        if len == 0 {
            len = server.notification(out);
        }
        if len != 0 {
            self.stage(ATT_CID, len);
        }
    }

    fn stage(&mut self, cid: u16, len: usize) {
        self.tx[..2].copy_from_slice(&(len as u16).to_le_bytes());
        self.tx[2..HEADER].copy_from_slice(&cid.to_le_bytes());
        self.tx_cursor = 0;
        self.tx_len = HEADER + len;
    }

    #[cfg(feature = "pairing")]
    pub(crate) fn smp(&self) -> Option<&[u8]> {
        (self.rx_target != 0
            && self.rx_len == self.rx_target
            && self.rx[2] == crate::sm::SMP_CID as u8)
            .then(|| &self.rx[HEADER..self.rx_len])
    }

    #[cfg(feature = "pairing")]
    pub(crate) fn pop_smp(&mut self) {
        self.rx[..self.rx_len].fill(0);
        self.rx_len = 0;
        self.rx_target = 0;
    }

    #[cfg(feature = "pairing")]
    pub(crate) fn queue_smp(&mut self, bytes: &[u8]) {
        self.tx[HEADER..HEADER + bytes.len()].copy_from_slice(bytes);
        self.stage(crate::sm::SMP_CID, bytes.len());
    }
}

impl DataChannel for AttChannel {
    fn receive(&mut self, llid: u8, bytes: &[u8]) -> bool {
        if self.rx_target != 0 && self.rx_len == self.rx_target {
            return false;
        }
        if llid == START {
            self.rx_len = 0;
            self.rx_target = 0;
        } else if llid != CONTINUATION || self.rx_len == 0 {
            return true;
        }
        let end = self.rx_len + bytes.len();
        if end > self.rx.len() {
            self.rx_len = 0;
            self.rx_target = 0;
            return true;
        }

        self.rx[self.rx_len..end].copy_from_slice(bytes);
        self.rx_len = end;
        if self.rx_target == 0 && end >= HEADER {
            let len = usize::from(u16::from_le_bytes([self.rx[0], self.rx[1]]));
            let cid = u16::from_le_bytes([self.rx[2], self.rx[3]]);
            let supported = cid == ATT_CID && (1..=MAX_MTU).contains(&len);
            #[cfg(feature = "pairing")]
            let supported =
                supported || cid == crate::sm::SMP_CID && (1..=crate::sm::MAX_SMP).contains(&len);
            if !supported {
                self.rx_len = 0;
                return true;
            }
            self.rx_target = HEADER + len;
        }
        if self.rx_target != 0 && end > self.rx_target {
            self.rx_len = 0;
            self.rx_target = 0;
        }
        true
    }

    fn transmit(&mut self) -> Option<(u8, &[u8])> {
        if !self.has_pending() {
            return None;
        }
        let start = self.tx_cursor;
        let end = (start + MAX_PAYLOAD).min(self.tx_len);
        self.tx_cursor = end;
        let llid = if start == 0 { START } else { CONTINUATION };
        Some((llid, &self.tx[start..end]))
    }

    fn has_pending(&self) -> bool {
        self.tx_cursor < self.tx_len
    }
}
