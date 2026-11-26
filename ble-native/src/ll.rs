//! Legacy LE 1M Peripheral 链路层。连接状态和时间计算不依赖寄存器。

use crate::adv::{ACCESS_ADDRESS, PDU_CONNECT_IND};
use crate::schedule::{Instant, SLOT_TICKS};

const NESN: u8 = 1 << 2;
const SN: u8 = 1 << 3;
pub const MD: u8 = 1 << 4;
pub const CONTINUATION: u8 = 1;
pub const START: u8 = 2;
pub(crate) const CONTROL: u8 = 3;
pub const MAX_PAYLOAD: usize = 27;
pub(crate) const MAX_WIRE_PAYLOAD: usize = MAX_PAYLOAD + 4;
pub const MAX_PDU: usize = 2 + MAX_WIRE_PAYLOAD;

fn le16(data: &[u8]) -> u16 {
    u16::from_le_bytes([data[0], data[1]])
}

fn valid_timing(interval: u16, latency: u16, timeout: u16) -> bool {
    (6..=3200).contains(&interval)
        && latency <= 499
        && (10..=3200).contains(&timeout)
        && u32::from(timeout) * 4 > u32::from(interval) * (u32::from(latency) + 1)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ChannelMap(u64);

impl ChannelMap {
    fn parse(data: &[u8]) -> Option<Self> {
        let mut bytes = [0; 8];
        bytes[..5].copy_from_slice(data);
        let map = u64::from_le_bytes(bytes);
        (map >> 37 == 0 && map.count_ones() >= 2).then_some(Self(map))
    }

    fn remap(self, unmapped: u8) -> u8 {
        let bit = 1 << unmapped;
        if self.0 & bit != 0 {
            return unmapped;
        }

        let mut used = self.0;
        let index = u32::from(unmapped) % used.count_ones();
        for _ in 0..index {
            used &= used - 1;
        }
        used.trailing_zeros() as u8
    }
}

#[derive(Clone, Copy, Debug)]
struct Timing {
    window_size: u8,
    window_offset: u16,
    interval: u16,
    timeout: u16,
}

impl Timing {
    fn parse(data: &[u8]) -> Option<Self> {
        let window_size = data[0];
        let window_offset = le16(&data[1..]);
        let interval = le16(&data[3..]);
        let latency = le16(&data[5..]);
        let timeout = le16(&data[7..]);
        (valid_timing(interval, latency, timeout)
            && (1..=8).contains(&window_size)
            && u16::from(window_size) < interval
            && window_offset <= interval)
            .then_some(Self {
                window_size,
                window_offset,
                interval,
                timeout,
            })
    }

    fn interval_slots(self) -> u32 {
        u32::from(self.interval) * 2
    }
}

#[derive(Clone, Copy, Debug)]
pub struct ConnectInd {
    pub access: u32,
    pub crc_init: u32,
    pub initiator: [u8; 7],
    timing: Timing,
    channels: ChannelMap,
    hop: u8,
    sca_ppm: u32,
}

impl ConnectInd {
    /// 接受目的地址为本机 public AdvA 的 legacy 连接请求。
    pub fn parse(pdu: &[u8], addr: &[u8; 6]) -> Option<Self> {
        if pdu.len() != 36
            || pdu[0] & 0x8f != PDU_CONNECT_IND
            || pdu[1] != 34
            || &pdu[8..14] != addr
        {
            return None;
        }
        let data = &pdu[14..];
        let access = u32::from_le_bytes(data[..4].try_into().ok()?);
        let crc_init = u32::from_le_bytes([data[4], data[5], data[6], 0]);
        let hop = data[21] & 31;
        if !(5..=16).contains(&hop) || !valid_access(access) {
            return None;
        }
        let mut initiator = [0; 7];
        initiator[0] = (pdu[0] >> 6) & 1;
        initiator[1..].copy_from_slice(&pdu[2..8]);
        Some(Self {
            access,
            crc_init,
            initiator,
            timing: Timing::parse(&data[7..16])?,
            channels: ChannelMap::parse(&data[16..21])?,
            hop,
            sca_ppm: [500, 250, 150, 100, 75, 50, 30, 20][usize::from(data[21] >> 5)],
        })
    }

    pub fn interval_slots(self) -> u32 {
        self.timing.interval_slots()
    }
}

fn valid_access(access: u32) -> bool {
    if (access ^ ACCESS_ADDRESS).count_ones() < 2
        || access
            .to_le_bytes()
            .iter()
            .all(|&byte| byte == access as u8)
    {
        return false;
    }
    let transitions = access ^ (access >> 1);
    if (transitions & 0x7fff_ffff).count_ones() > 24 || (transitions & 0x7c00_0000).count_ones() < 2
    {
        return false;
    }
    let mut run = 1;
    for bit in 0..31 {
        run = if transitions & (1 << bit) == 0 {
            run + 1
        } else {
            1
        };
        if run > 6 {
            return false;
        }
    }
    true
}

#[derive(Clone, Copy, Debug)]
pub struct Window {
    pub start: Instant,
    pub end: Instant,
    pub channel: u8,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Stats {
    pub events: u32,
    pub missed: u32,
    pub crc_errors: u32,
    pub received: u32,
    pub duplicates: u32,
    pub retransmits: u32,
}

/// L2CAP 和 LL 之间的片段队列，回调在 T_IFS 应答路径中执行。
pub trait DataChannel {
    /// 缓冲已满时返回 false，让对端保持原 SN 并重发。
    fn receive(&mut self, llid: u8, bytes: &[u8]) -> bool;
    /// 返回起始或续帧 LLID 以及最多 MAX_PAYLOAD 字节的数据。
    fn transmit(&mut self) -> Option<(u8, &[u8])>;
    fn has_pending(&self) -> bool;

    /// 在 T_IFS 内锁存密文，返回是否推进 NESN。
    fn capture(&mut self, _header: u8, _bytes: &[u8]) -> Option<bool> {
        None
    }

    fn sealed_rx(&self) -> bool {
        false
    }

    fn defers_control(&self) -> bool {
        false
    }

    fn features(&self) -> u8 {
        0
    }
}

#[cfg(test)]
impl DataChannel for () {
    fn receive(&mut self, _: u8, _: &[u8]) -> bool {
        true
    }

    fn transmit(&mut self) -> Option<(u8, &[u8])> {
        None
    }

    fn has_pending(&self) -> bool {
        false
    }
}

struct Payload {
    llid: u8,
    bytes: [u8; MAX_WIRE_PAYLOAD],
    len: u8,
}

impl Payload {
    fn new(llid: u8, bytes: &[u8]) -> Self {
        let mut payload = Self {
            llid,
            bytes: [0; MAX_WIRE_PAYLOAD],
            len: bytes.len() as u8,
        };
        payload.bytes[..bytes.len()].copy_from_slice(bytes);
        payload
    }
}

pub struct Connection {
    params: ConnectInd,
    expected: Instant,
    last_anchor: Instant,
    first_window: bool,
    packet_seen: bool,
    last_valid: Instant,
    counter: u16,
    unmapped: u8,
    got_packet: bool,
    map_update: Option<(u16, ChannelMap)>,
    timing_update: Option<(u16, Timing)>,
    tx_sn: bool,
    rx_sn: bool,
    tx_pending: bool,
    tx_payload: Option<Payload>,
    queued_control: Option<Payload>,
    version_sent: bool,
    pub terminated: bool,
    pub stats: Stats,
}

impl Connection {
    pub fn new(params: ConnectInd, request_end: Instant) -> Self {
        Self {
            params,
            expected: request_end.after_slots(2 * (1 + u32::from(params.timing.window_offset))),
            last_anchor: request_end,
            first_window: true,
            packet_seen: false,
            last_valid: request_end,
            counter: 0,
            unmapped: 0,
            got_packet: false,
            map_update: None,
            timing_update: None,
            tx_sn: false,
            rx_sn: false,
            tx_pending: false,
            tx_payload: None,
            queued_control: None,
            version_sent: false,
            terminated: false,
            stats: Stats::default(),
        }
    }

    pub fn supervision_deadline(&self) -> Instant {
        self.last_valid
            .after_slots(u32::from(self.params.timing.timeout) * 16)
    }

    pub fn timed_out(&self, now: Instant) -> bool {
        (!self.packet_seen && self.stats.events >= 6) || now.reached(self.supervision_deadline())
    }

    pub fn open_event(&mut self) -> Window {
        if let Some((instant, map)) = self.map_update {
            if self.counter == instant {
                self.params.channels = map;
                self.map_update = None;
            }
        }
        if let Some((instant, timing)) = self.timing_update {
            if self.counter == instant {
                self.expected = self
                    .expected
                    .after_slots(2 * u32::from(timing.window_offset));
                self.first_window = true;
                self.params.timing = timing;
                self.timing_update = None;
            }
        }
        self.unmapped = (self.unmapped + self.params.hop) % 37;
        // SCA 加本地保守时钟预算。额外预留 RF 调谐和 ISR 的固定开销。
        let slots = self.expected.elapsed_ticks(self.last_anchor) / SLOT_TICKS;
        let drift = slots * (self.params.sca_ppm + 50) / 1600;
        let guard = (drift + 200).min(u32::from(self.params.timing.interval) * 625 - 400);
        let span = if self.first_window {
            2 * u32::from(self.params.timing.window_size)
        } else {
            0
        };
        Window {
            start: self.expected.before_us(guard),
            end: self.expected.after_slots(span).after_us(guard + 296),
            channel: self.params.channels.remap(self.unmapped),
        }
    }

    /// 仅连接事件的首个接入地址命中用于校正锚点。
    pub fn on_air_packet(&mut self, start: Instant, crc_ok: bool) {
        if !self.got_packet {
            self.expected = start;
            self.last_anchor = start;
            self.first_window = false;
            self.got_packet = true;
            self.packet_seen = true;
        }
        if crc_ok {
            self.last_valid = start;
            self.stats.received += 1;
        } else {
            self.stats.crc_errors += 1;
        }
    }

    pub fn close_event(&mut self) {
        self.stats.events += 1;
        self.stats.missed += u32::from(!self.got_packet);
        self.counter = self.counter.wrapping_add(1);
        self.got_packet = false;
        self.expected = self
            .expected
            .after_slots(self.params.timing.interval_slots());
    }

    pub fn next_anchor(&self) -> Instant {
        self.expected
            .after_slots(self.params.timing.interval_slots())
    }

    /// 处理已通过 CRC 的 PDU，填入应答并保留重传内容直到对端确认。
    pub fn reply(
        &mut self,
        pdu: &[u8],
        out: &mut [u8; MAX_PDU],
        data: &mut impl DataChannel,
    ) -> Option<usize> {
        let [header, len, payload @ ..] = pdu else {
            return None;
        };
        let llid = header & 3;
        let limit = if data.sealed_rx() {
            MAX_WIRE_PAYLOAD
        } else {
            MAX_PAYLOAD
        };
        if usize::from(*len) != payload.len()
            || payload.len() > limit
            || llid == 0
            || (payload.is_empty() && llid != CONTINUATION)
        {
            return None;
        }
        if self.tx_pending && (header & NESN != 0) != self.tx_sn {
            self.tx_sn = !self.tx_sn;
            self.tx_pending = false;
            self.tx_payload = None;
        }

        if (header & SN != 0) != self.rx_sn {
            self.stats.duplicates += 1;
        } else {
            let accepted = if payload.is_empty() {
                true
            } else if let Some(accepted) = data.capture(*header, payload) {
                accepted
            } else if llid == CONTROL {
                self.accept_control(payload, data.features())
            } else {
                data.receive(llid, payload)
            };
            if accepted {
                self.rx_sn = !self.rx_sn;
            }
        }

        let defer_control = data.defers_control();
        if self.tx_pending {
            self.stats.retransmits += 1;
        } else if self.tx_payload.is_none() {
            let control = if defer_control {
                None
            } else {
                self.queued_control.take()
            };
            self.tx_payload =
                control.or_else(|| data.transmit().map(|(id, bytes)| Payload::new(id, bytes)));
        }
        let (llid, len) = if let Some(payload) = &self.tx_payload {
            let len = usize::from(payload.len);
            out[2..2 + len].copy_from_slice(&payload.bytes[..len]);
            (payload.llid, payload.len)
        } else {
            (CONTINUATION, 0)
        };
        out[0] = llid
            | u8::from(self.tx_sn) * SN
            | u8::from(self.rx_sn) * NESN
            | u8::from((!defer_control && self.queued_control.is_some()) || data.has_pending())
                * MD;
        out[1] = len;
        Some(2 + usize::from(len))
    }

    pub fn sent(&mut self) {
        self.tx_pending = true;
    }

    pub(crate) fn accept_control(&mut self, payload: &[u8], features: u8) -> bool {
        if self.queued_control.is_some() {
            return false;
        }
        self.queued_control = self.control(payload, features);
        true
    }

    #[cfg(feature = "pairing")]
    pub(crate) fn take_control(&mut self, out: &mut [u8]) -> Option<usize> {
        let packet = self.queued_control.take()?;
        let len = usize::from(packet.len);
        out[..len].copy_from_slice(&packet.bytes[..len]);
        Some(len)
    }

    fn control(&mut self, payload: &[u8], features: u8) -> Option<Payload> {
        match payload {
            [0x00, data @ ..] if data.len() == 11 => {
                if let Some(timing) = Timing::parse(data) {
                    self.timing_update = Some((le16(&data[9..]), timing));
                }
            }
            [0x01, data @ ..] if data.len() == 7 => {
                if let Some(map) = ChannelMap::parse(&data[..5]) {
                    self.map_update = Some((le16(&data[5..]), map));
                }
            }
            [0x02, _] => self.terminated = true,
            [0x08 | 0x0e, data @ ..] if data.len() == 8 => {
                return Some(Payload::new(
                    CONTROL,
                    &[0x09, features & data[0], 0, 0, 0, 0, 0, 0, 0],
                ));
            }
            [0x0c, _, _, _, _, _] if !self.version_sent => {
                self.version_sent = true;
                // Core 4.0，Company Identifier 0xffff（内部测试）。
                return Some(Payload::new(CONTROL, &[0x0c, 0x06, 0xff, 0xff, 0, 0]));
            }
            [0x0c, _, _, _, _, _] | [0x07, _] | [0x0d, _] | [0x11, _, _] => {}
            [opcode, ..] => return Some(Payload::new(CONTROL, &[0x07, *opcode])),
            [] => {}
        }
        None
    }
}
