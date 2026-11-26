//! SMP bearer 和 LL 加密启动。T_IFS 路径仅收存或取出帧。

use crate::att::Server;
use crate::crypto::{Cipher, MIC_LEN};
use crate::l2cap::AttChannel;
use crate::ll::{Connection, DataChannel, CONTROL, MAX_WIRE_PAYLOAD};
use crate::schedule::Instant;
use crate::sm::{Address, Bond, Ephemeral, Pairing};
use rand_chacha::ChaCha20Rng;
use rand_core::RngCore;
#[cfg(target_arch = "riscv32")]
use rand_core::SeedableRng;
use zeroize::Zeroize;
#[cfg(target_arch = "riscv32")]
use zeroize::Zeroizing;

const ENC_REQ: u8 = 0x03;
const ENC_RSP: u8 = 0x04;
const START_REQ: u8 = 0x05;
const START_RSP: u8 = 0x06;
const REJECT: u8 = 0x0d;

#[cfg(target_arch = "riscv32")]
#[no_mangle]
static mut M19_ENTROPY: [u32; 9] = [0; 9];

/// 接受宿主经调试探针写入的一次性种子，约定最后一字为就绪标志。
#[cfg(target_arch = "riscv32")]
pub fn provision() -> ChaCha20Rng {
    const READY: u32 = 0x4d31_3944;
    let mailbox = core::ptr::addr_of_mut!(M19_ENTROPY).cast::<u32>();
    loop {
        let mut seed = Zeroizing::new([0u8; 32]);
        unsafe {
            while mailbox.add(8).read_volatile() != READY {
                core::hint::spin_loop();
            }
            mailbox.add(8).write_volatile(0);
            for (i, chunk) in seed.chunks_exact_mut(4).enumerate() {
                chunk.copy_from_slice(&mailbox.add(i).read_volatile().to_le_bytes());
                mailbox.add(i).write_volatile(0);
            }
        }
        if seed.iter().any(|&x| x != 0) {
            return ChaCha20Rng::from_seed(*seed);
        }
    }
}

struct Frame {
    header: u8,
    bytes: [u8; MAX_WIRE_PAYLOAD],
    len: usize,
}

impl Frame {
    fn new(header: u8, data: &[u8]) -> Self {
        let mut bytes = [0; MAX_WIRE_PAYLOAD];
        bytes[..data.len()].copy_from_slice(data);
        Self {
            header,
            bytes,
            len: data.len(),
        }
    }

    fn payload(&self) -> &[u8] {
        &self.bytes[..self.len]
    }
}

impl Drop for Frame {
    fn drop(&mut self) {
        self.bytes.zeroize();
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Clear,
    Starting,
    Rejecting,
    AwaitPeerStart,
    Encrypted,
}

pub struct PeripheralSecurity {
    rng: ChaCha20Rng,
    ephemeral: Option<Ephemeral>,
    bond: Option<Bond>,
    local: Address,
}

impl PeripheralSecurity {
    pub fn new(rng: ChaCha20Rng, public_address: [u8; 6]) -> Self {
        let mut local = [0; 7];
        local[1..].copy_from_slice(&public_address);
        Self {
            rng,
            ephemeral: None,
            bond: None,
            local,
        }
    }

    pub fn prepare(&mut self) {
        if !cfg!(feature = "legacy-only") && self.ephemeral.is_none() {
            self.ephemeral = Some(Ephemeral::generate(&mut self.rng));
        }
    }

    pub fn connect(&mut self, peer: Address) -> SecureChannel {
        SecureChannel {
            channel: AttChannel::new(),
            pairing: Pairing::new(peer, self.local),
            phase: Phase::Clear,
            cipher: None,
            rx: None,
            rx_opened: None,
            tx: None,
            tx_second: None,
            emitted: None,
            rx_counter: 0,
            tx_counter: 0,
            confirmed_start: false,
            encrypted_with_bond: false,
            pairing_deadline: None,
            event: None,
            failed: false,
        }
    }
}

pub struct SecureChannel {
    channel: AttChannel,
    pairing: Pairing,
    phase: Phase,
    cipher: Option<Cipher>,
    rx: Option<Frame>,
    rx_opened: Option<Frame>,
    tx: Option<Frame>,
    tx_second: Option<Frame>,
    emitted: Option<Frame>,
    rx_counter: u64,
    tx_counter: u64,
    confirmed_start: bool,
    encrypted_with_bond: bool,
    pairing_deadline: Option<Instant>,
    event: Option<&'static str>,
    failed: bool,
}

impl SecureChannel {
    pub fn work_step(&mut self) -> bool {
        self.phase == Phase::Clear && self.pairing.work_step()
    }

    pub fn event(&self) -> Option<&'static str> {
        self.event
    }

    pub fn failed(&self) -> bool {
        self.failed
    }

    /// 连接事件结束后处理密文、SMP 和 ATT 并准备下一帧。
    pub fn process(
        &mut self,
        controller: &mut PeripheralSecurity,
        link: &mut Connection,
        server: &mut Server,
        now: Instant,
    ) {
        self.emitted = None;
        if self
            .pairing_deadline
            .is_some_and(|deadline| now.reached(deadline))
        {
            self.event = Some("pairing timeout");
            self.failed = true;
        }
        if self.failed {
            link.terminated = true;
            return;
        }
        self.open_received(controller, server);
        if self.failed {
            self.event = Some("MIC or start sequence rejected");
            link.terminated = true;
            return;
        }

        self.route_received(link);
        if let Some(smp) = self.channel.smp() {
            if self.phase == Phase::Clear && !link.terminated {
                if smp.first() == Some(&0x01)
                    && controller
                        .bond
                        .as_ref()
                        .is_some_and(|bond| !bond.owns(&self.pairing.peer))
                {
                    self.pairing.fail(0x05);
                } else {
                    self.pairing.receive(
                        smp,
                        &mut controller.rng,
                        &mut controller.ephemeral,
                        !cfg!(feature = "legacy-only"),
                    );
                }
                self.pairing_deadline = self
                    .pairing
                    .pending_pairing()
                    .then(|| now.after_slots(48_000));
            }
            self.channel.pop_smp();
        }
        if matches!(self.phase, Phase::Clear | Phase::Encrypted) {
            if !self.channel.has_pending() {
                if let Some(smp) = self.pairing.pending() {
                    self.channel.queue_smp(smp);
                    self.pairing.consumed();
                }
            }
            self.channel.process(server);
            if self.phase == Phase::Encrypted && self.encrypted_with_bond {
                if let Some(bond) = controller.bond.as_mut() {
                    bond.subscribed = server.subscribed();
                }
            }
        }
        if self.phase == Phase::Encrypted && self.tx.is_none() {
            let frame = if self.confirmed_start {
                self.confirmed_start = false;
                Some(Frame::new(CONTROL, &[START_RSP]))
            } else {
                let mut bytes = [0; MAX_WIRE_PAYLOAD];
                if let Some(len) = link.take_control(&mut bytes) {
                    Some(Frame::new(CONTROL, &bytes[..len]))
                } else {
                    self.channel
                        .transmit()
                        .map(|(id, data)| Frame::new(id, data))
                }
            };
            if let Some(mut frame) = frame {
                let Some(tag) = self.cipher.as_ref().unwrap().seal(
                    frame.header,
                    self.tx_counter,
                    &mut frame.bytes[..frame.len],
                ) else {
                    link.terminated = true;
                    return;
                };
                frame.bytes[frame.len..frame.len + MIC_LEN].copy_from_slice(&tag);
                frame.len += MIC_LEN;
                self.tx_counter += 1;
                self.tx = Some(frame);
            }
        }
    }

    fn open_received(&mut self, controller: &mut PeripheralSecurity, server: &mut Server) {
        let Some(mut frame) = self.rx.take() else {
            return;
        };
        if self.rx_opened.is_some() {
            self.rx = Some(frame);
            return;
        }
        if self.phase == Phase::Clear {
            self.start(frame.payload(), controller);
            return;
        }

        let Some(len) = frame.len.checked_sub(MIC_LEN).filter(|&len| len > 0) else {
            self.failed = true;
            return;
        };
        let mic: [u8; MIC_LEN] = frame.bytes[len..frame.len].try_into().unwrap();
        if !self.cipher.as_ref().unwrap().open(
            frame.header,
            self.rx_counter,
            &mut frame.bytes[..len],
            &mic,
        ) {
            self.failed = true;
            return;
        }
        frame.len = len;
        self.rx_counter += 1;
        if self.phase == Phase::AwaitPeerStart {
            if frame.header & 3 != CONTROL || frame.payload() != [START_RSP] {
                self.failed = true;
                return;
            }
            self.phase = Phase::Encrypted;
            self.confirmed_start = true;
            server.lock(false);
            self.pairing_deadline = None;
            if let Some(bond) = self.pairing.encrypted(&mut controller.rng) {
                controller.bond = Some(bond);
                self.encrypted_with_bond = true;
            }
            if self.encrypted_with_bond {
                if let Some(bond) = controller.bond.as_ref() {
                    server.restore_subscription(bond.subscribed);
                }
            }
            self.event = Some(match self.pairing.completed {
                Some(true) => "LE Secure Connections",
                Some(false) => "legacy pairing",
                None if self.encrypted_with_bond => "bond reconnect",
                None => "link encrypted",
            });
        } else {
            self.rx_opened = Some(frame);
        }
    }

    fn route_received(&mut self, link: &mut Connection) {
        let Some(frame) = self.rx_opened.as_ref() else {
            return;
        };
        let id = frame.header & 3;
        let accepted = if id == CONTROL {
            link.accept_control(frame.payload(), self.features())
        } else {
            self.channel.receive(id, frame.payload())
        };
        if accepted {
            self.rx_opened = None;
        }
    }

    fn start(&mut self, request: &[u8], controller: &mut PeripheralSecurity) {
        let mut random = [0; 12];
        controller.rng.fill_bytes(&mut random);
        let ids: &[u8; 10] = request[1..11].try_into().unwrap();
        let bond = controller
            .bond
            .as_ref()
            .and_then(|bond| bond.key(&self.pairing.peer, ids));
        let key = if *ids == [0; 10] {
            self.pairing.temporary_key().or(bond)
        } else {
            bond
        };
        self.encrypted_with_bond =
            bond.is_some() && (*ids != [0; 10] || self.pairing.temporary_key().is_none());

        // 即使宿主没有匹配的密钥，Peripheral 仍先返回自己的 SKD 和 IV。
        let mut response = [ENC_RSP; 13];
        response[1..].copy_from_slice(&random);
        self.tx = Some(Frame::new(CONTROL, &response));
        if let Some(key) = key {
            let mut skd = [0; 16];
            skd[..8].copy_from_slice(&request[11..19]);
            skd[8..].copy_from_slice(&random[..8]);
            let mut iv = [0; 8];
            iv[..4].copy_from_slice(&request[19..23]);
            iv[4..].copy_from_slice(&random[8..]);
            self.cipher = Some(Cipher::new(key, skd, iv));
            self.tx_second = Some(Frame::new(CONTROL, &[START_REQ]));
            self.phase = Phase::Starting;
        } else {
            self.tx_second = Some(Frame::new(CONTROL, &[REJECT, 0x06]));
            self.phase = Phase::Rejecting;
        }
    }
}

impl DataChannel for SecureChannel {
    fn receive(&mut self, llid: u8, bytes: &[u8]) -> bool {
        self.channel.receive(llid, bytes)
    }

    fn transmit(&mut self) -> Option<(u8, &[u8])> {
        if let Some(frame) = self.tx.take() {
            if self.phase == Phase::Starting && frame.payload() == [START_REQ] {
                self.phase = Phase::AwaitPeerStart;
            } else if self.phase == Phase::Rejecting && frame.payload() == [REJECT, 0x06] {
                self.phase = Phase::Clear;
            }
            self.tx = self.tx_second.take();
            let frame = self.emitted.insert(frame);
            return Some((frame.header, frame.payload()));
        }
        if self.phase == Phase::Clear && self.rx.is_none() {
            return self.channel.transmit();
        }
        None
    }

    fn has_pending(&self) -> bool {
        self.tx.is_some()
            || (self.phase == Phase::Clear && self.rx.is_none() && self.channel.has_pending())
    }

    fn capture(&mut self, header: u8, bytes: &[u8]) -> Option<bool> {
        if self.phase == Phase::Clear {
            if header & 3 != CONTROL || bytes.first() != Some(&ENC_REQ) {
                return None;
            }
            if bytes.len() != 23 {
                self.failed = true;
                return Some(false);
            }
        } else if !self.sealed_rx() {
            self.failed = true;
            return Some(false);
        }
        if self.rx.is_some() || self.rx_opened.is_some() {
            return Some(false);
        }
        self.rx = Some(Frame::new(header, bytes));
        Some(true)
    }

    fn sealed_rx(&self) -> bool {
        matches!(self.phase, Phase::AwaitPeerStart | Phase::Encrypted)
    }

    fn defers_control(&self) -> bool {
        self.phase != Phase::Clear || self.rx.as_ref().is_some_and(|f| f.header & 3 == CONTROL)
    }

    fn features(&self) -> u8 {
        1
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand_core::SeedableRng;

    #[test]
    fn invalid_mic_cannot_unlock_att_or_enter_l2cap() {
        let rng = ChaCha20Rng::from_seed([0x77; 32]);
        let mut controller = PeripheralSecurity::new(rng, [1; 6]);
        let mut channel = controller.connect([0; 7]);
        channel.cipher = Some(Cipher::new(&[1; 16], [2; 16], [3; 8]));
        channel.phase = Phase::AwaitPeerStart;
        let mut server = Server::new();
        server.lock(true);
        assert_eq!(channel.capture(CONTROL, &[1, 0, 0, 0, 0]), Some(true));
        channel.open_received(&mut controller, &mut server);
        assert!(channel.failed);
        assert!(channel.rx_opened.is_none());
        assert!(controller.bond.is_none());
        let mut response = [0; crate::att::MAX_MTU];
        let len = server.request(&[0x0a, 8, 0], &mut response);
        assert_eq!(&response[..len], &[1, 0x0a, 8, 0, 0x0f]);
    }
}
