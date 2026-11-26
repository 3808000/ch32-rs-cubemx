//! LE Peripheral 的 Just Works SMP 和单对端 RAM 绑定。

use crate::crypto::{c1, f4, f5, f6, reversed, s1, Key};
use p256::{
    elliptic_curve::{group::Group, point::AffineCoordinates, sec1::ToEncodedPoint},
    ProjectivePoint, PublicKey, SecretKey,
};
use rand_core::{CryptoRng, RngCore};
use subtle::{Choice, ConditionallySelectable, ConstantTimeEq};
use zeroize::{Zeroize, Zeroizing};

pub(crate) const SMP_CID: u16 = 0x0006;
pub(crate) const MAX_SMP: usize = 65;
pub(crate) type Address = [u8; 7]; // 类型 + 6 字节小端地址

const AUTH_BOND: u8 = 0x01;
const AUTH_SC: u8 = 0x08;
const KEY_SIZE: u8 = 16;
const INVALID_PARAMS: u8 = 0x0a;
const CONFIRM_FAILED: u8 = 0x04;
const DH_CHECK_FAILED: u8 = 0x0b;

// 每步做一次完整点运算。选择及运算数量与私钥位无关。
struct SharedSecretWork {
    scalar: Zeroizing<[u8; 32]>,
    peer: ProjectivePoint,
    point: ProjectivePoint,
    doubled: Option<ProjectivePoint>,
    bit: usize,
}

impl SharedSecretWork {
    fn new(private: &SecretKey, peer: &PublicKey) -> Self {
        Self {
            scalar: Zeroizing::new(private.to_bytes().into()),
            peer: ProjectivePoint::from(*peer.as_affine()),
            point: ProjectivePoint::IDENTITY,
            doubled: None,
            bit: 0,
        }
    }

    fn step(&mut self) -> Option<Zeroizing<[u8; 32]>> {
        if self.bit == 256 {
            return Some(Zeroizing::new(self.point.to_affine().x().into()));
        }
        if let Some(doubled) = self.doubled.take() {
            let sum = doubled + self.peer;
            let bit = (self.scalar[self.bit / 8] >> (7 - self.bit % 8)) & 1;
            self.point = ProjectivePoint::conditional_select(&doubled, &sum, Choice::from(bit));
            self.bit += 1;
        } else {
            self.doubled = Some(self.point.double());
        }
        None
    }
}

impl Drop for SharedSecretWork {
    fn drop(&mut self) {
        unsafe {
            core::ptr::write_volatile(&mut self.point, ProjectivePoint::IDENTITY);
            core::ptr::write_volatile(&mut self.doubled, None);
        }
    }
}

pub(crate) struct Ephemeral {
    private: SecretKey,
    public: [u8; 64], // X、Y 各自为大端。
}

impl Ephemeral {
    pub(crate) fn generate(rng: &mut (impl CryptoRng + RngCore)) -> Self {
        let private = SecretKey::random(rng);
        let encoded = private.public_key().to_encoded_point(false);
        let mut public = [0; 64];
        public.copy_from_slice(&encoded.as_bytes()[1..]);
        Self { private, public }
    }
}

pub(crate) struct Bond {
    peer: Address,
    key: Key,
    rand_ediv: [u8; 10],
    pub(crate) subscribed: bool,
}

impl Drop for Bond {
    fn drop(&mut self) {
        self.key.zeroize();
    }
}

impl Bond {
    pub(crate) fn owns(&self, peer: &Address) -> bool {
        self.peer == *peer
    }

    pub(crate) fn key(&self, peer: &Address, rand_ediv: &[u8; 10]) -> Option<&Key> {
        (self.owns(peer) && self.rand_ediv == *rand_ediv).then_some(&self.key)
    }
}

struct Message {
    bytes: [u8; MAX_SMP],
    len: usize,
}

impl Message {
    fn new(op: u8, args: &[u8]) -> Self {
        let mut bytes = [0; MAX_SMP];
        bytes[0] = op;
        bytes[1..1 + args.len()].copy_from_slice(args);
        Self {
            bytes,
            len: 1 + args.len(),
        }
    }
}

impl Drop for Message {
    fn drop(&mut self) {
        self.bytes.zeroize();
    }
}

enum Step {
    Idle,
    LegacyConfirm,
    LegacyRandom(Key),
    ScPublic,
    ScRandom,
    ScDerive(Key),
    ScCheck {
        check: Key,
        response: Key,
        key: Zeroizing<Key>,
    },
    Encrypt(Zeroizing<Key>),
}

pub(crate) struct Pairing {
    pub(crate) peer: Address,
    local: Address,
    request: [u8; 7],
    response: [u8; 7],
    nonce: Zeroizing<Key>,
    step: Step,
    work: Option<SharedSecretWork>,
    shared: Option<Zeroizing<[u8; 32]>>,
    out: [Option<Message>; 2],
    pub(crate) completed: Option<bool>, // true 为 Secure Connections
}

impl Pairing {
    pub(crate) fn new(peer: Address, local: Address) -> Self {
        Self {
            peer,
            local,
            request: [0; 7],
            response: [0; 7],
            nonce: Zeroizing::new([0; 16]),
            step: Step::Idle,
            work: None,
            shared: None,
            out: [None, None],
            completed: None,
        }
    }

    pub(crate) fn pending(&self) -> Option<&[u8]> {
        self.out[0]
            .as_ref()
            .map(|message| &message.bytes[..message.len])
    }

    pub(crate) fn consumed(&mut self) {
        self.out[0] = self.out[1].take();
    }

    fn send(&mut self, opcode: u8, payload: &[u8]) {
        let slot = usize::from(self.out[0].is_some());
        self.out[slot] = Some(Message::new(opcode, payload));
    }

    pub(crate) fn fail(&mut self, reason: u8) {
        self.reset();
        self.send(0x05, &[reason]);
    }

    fn reset(&mut self) {
        self.step = Step::Idle;
        self.work = None;
        self.shared = None;
        self.nonce.zeroize();
        self.out = [None, None];
    }

    pub(crate) fn work_step(&mut self) -> bool {
        if let Some(work) = &mut self.work {
            if let Some(shared) = work.step() {
                self.work = None;
                self.shared = Some(shared);
            }
            return true;
        }
        let Step::ScDerive(na) = self.step else {
            return false;
        };
        let Some(shared) = self.shared.take() else {
            return false;
        };
        self.derive_check(&shared, na);
        true
    }

    fn derive_check(&mut self, secret: &[u8; 32], na: Key) {
        let random = *self.nonce;
        let nb = reversed(random);
        let a = sm_address(self.peer);
        let b = sm_address(self.local);
        let (mac_key, key) = f5(secret, &na, &nb, &a, &b);
        let mac_key = Zeroizing::new(mac_key);
        let mut key = reversed(key);
        self.limit_key(&mut key);
        let initiator_io = [self.request[3], self.request[2], self.request[1]];
        let responder_io = [self.response[3], self.response[2], self.response[1]];
        self.send(0x04, &random);
        self.step = Step::ScCheck {
            check: reversed(f6(&mac_key, &na, &nb, &initiator_io, &a, &b)),
            response: reversed(f6(&mac_key, &nb, &na, &responder_io, &b, &a)),
            key: Zeroizing::new(key),
        };
    }

    pub(crate) fn receive(
        &mut self,
        pdu: &[u8],
        rng: &mut (impl CryptoRng + RngCore),
        ephemeral: &mut Option<Ephemeral>,
        secure_connections: bool,
    ) {
        let Some((&opcode, args)) = pdu.split_first() else {
            return;
        };
        if opcode == 0x05 {
            self.reset();
            return;
        }
        let step = core::mem::replace(&mut self.step, Step::Idle);
        let next = match (step, opcode, args) {
            (Step::Idle, 0x01, &[io, oob, auth, key_size, _, responder_keys])
                if io <= 4 && oob <= 1 && auth & 3 <= 1 =>
            {
                if !(7..=16).contains(&key_size) {
                    self.fail(0x06);
                    return;
                }
                let sc = secure_connections && auth & AUTH_SC != 0;
                let stable = self.peer[0] == 0 || self.peer[6] & 0xc0 == 0xc0;
                let bond = auth & AUTH_BOND != 0 && stable && (sc || responder_keys & 1 != 0);
                self.request.copy_from_slice(pdu);
                self.response = [
                    2,
                    3,
                    0,
                    u8::from(bond) * AUTH_BOND | u8::from(sc) * AUTH_SC,
                    KEY_SIZE,
                    0,
                    u8::from(bond && !sc),
                ];
                let response = self.response;
                self.send(0x02, &response[1..]);
                rng.fill_bytes(&mut *self.nonce);
                if sc {
                    Step::ScPublic
                } else {
                    Step::LegacyConfirm
                }
            }
            (Step::LegacyConfirm, 0x03, args) if args.len() == 16 => {
                let confirm = self.legacy_confirm(*self.nonce);
                self.send(0x03, &confirm);
                Step::LegacyRandom(args.try_into().unwrap())
            }
            (Step::LegacyRandom(confirm), 0x04, args) if args.len() == 16 => {
                let peer_random = args.try_into().unwrap();
                if !bool::from(self.legacy_confirm(peer_random).ct_eq(&confirm)) {
                    self.fail(CONFIRM_FAILED);
                    return;
                }
                let random = *self.nonce;
                let mut key = s1(&peer_random, &random);
                self.limit_key(&mut key);
                self.send(0x04, &random);
                Step::Encrypt(Zeroizing::new(key))
            }
            (Step::ScPublic, 0x0c, args) if args.len() == 64 => {
                let Some(keypair) = ephemeral.take() else {
                    self.fail(0x08);
                    return;
                };
                let mut encoded = [0; 65];
                encoded[0] = 4;
                encoded[1..33].copy_from_slice(&reversed::<32>(args[..32].try_into().unwrap()));
                encoded[33..].copy_from_slice(&reversed::<32>(args[32..].try_into().unwrap()));
                let Ok(peer) = PublicKey::from_sec1_bytes(&encoded) else {
                    self.fail(INVALID_PARAMS);
                    return;
                };
                let x: &[u8; 32] = keypair.public[..32].try_into().unwrap();
                let peer_x: &[u8; 32] = encoded[1..33].try_into().unwrap();
                // Core 允许调试密钥用于专用调试模式，本实现采用普通模式。
                const DEBUG_X: [u8; 32] = [
                    0x20, 0xb0, 0x03, 0xd2, 0xf2, 0x97, 0xbe, 0x2c, 0x5e, 0x2c, 0x83, 0xa7, 0xe9,
                    0xf9, 0xa5, 0xb9, 0xef, 0xf4, 0x91, 0x11, 0xac, 0xf4, 0xfd, 0xdb, 0xcc, 0x03,
                    0x01, 0x48, 0x0e, 0x35, 0x9d, 0xe6,
                ];
                if x == peer_x || *peer_x == DEBUG_X {
                    self.fail(DH_CHECK_FAILED);
                    return;
                }
                let mut wire = keypair.public;
                wire[..32].reverse();
                wire[32..].reverse();
                self.send(0x0c, &wire);
                let confirm = reversed(f4(x, peer_x, &reversed(*self.nonce)));
                self.send(0x03, &confirm);
                self.work = Some(SharedSecretWork::new(&keypair.private, &peer));
                Step::ScRandom
            }
            (Step::ScRandom, 0x04, args) if args.len() == 16 => {
                Step::ScDerive(reversed(args.try_into().unwrap()))
            }
            (
                Step::ScCheck {
                    check,
                    response,
                    key,
                },
                0x0d,
                args,
            ) if args.len() == 16 => {
                if !bool::from(check.as_slice().ct_eq(args)) {
                    self.fail(DH_CHECK_FAILED);
                    return;
                }
                self.send(0x0d, &response);
                Step::Encrypt(key)
            }
            (_, 0x01 | 0x03 | 0x04 | 0x0c | 0x0d, _) => {
                self.fail(INVALID_PARAMS);
                return;
            }
            _ => {
                self.fail(0x07);
                return;
            }
        };
        self.step = next;
    }

    pub(crate) fn pending_pairing(&self) -> bool {
        !matches!(self.step, Step::Idle)
    }

    pub(crate) fn temporary_key(&self) -> Option<&Key> {
        match &self.step {
            Step::Encrypt(key) => Some(key),
            _ => None,
        }
    }

    pub(crate) fn encrypted(&mut self, rng: &mut impl RngCore) -> Option<Bond> {
        let Step::Encrypt(key) = core::mem::replace(&mut self.step, Step::Idle) else {
            return None; // 已绑定对端重连。
        };
        self.nonce.zeroize();
        let sc = self.response[3] & AUTH_SC != 0;
        self.completed = Some(sc);
        if self.response[3] & AUTH_BOND == 0 {
            return None;
        }
        let mut bond = Bond {
            peer: self.peer,
            key: *key,
            rand_ediv: [0; 10],
            subscribed: false,
        };
        if !sc {
            rng.fill_bytes(&mut bond.key);
            self.limit_key(&mut bond.key);
            // 零值专用于 STK 或 SC LTK 的查找。
            loop {
                rng.fill_bytes(&mut bond.rand_ediv);
                if bond.rand_ediv != [0; 10] {
                    break;
                }
            }
            self.send(0x06, &bond.key);
            let mut id = [0; 10];
            id[..2].copy_from_slice(&bond.rand_ediv[8..]);
            id[2..].copy_from_slice(&bond.rand_ediv[..8]);
            self.send(0x07, &id);
        }
        Some(bond)
    }

    fn limit_key(&self, key: &mut Key) {
        key[usize::from(self.request[4].min(self.response[4]))..].zeroize();
    }

    fn legacy_confirm(&self, random: Key) -> Key {
        c1(
            random,
            &self.request,
            &self.response,
            &self.peer,
            &self.local,
        )
    }
}

fn sm_address(mut address: Address) -> Address {
    address[1..].reverse();
    address
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scheduled_ecdh_matches_rustcrypto() {
        let private = SecretKey::from_slice(&[0x31; 32]).unwrap();
        let peer = SecretKey::from_slice(&[0x69; 32]).unwrap().public_key();
        let expected = p256::ecdh::diffie_hellman(private.to_nonzero_scalar(), peer.as_affine());
        let mut work = SharedSecretWork::new(&private, &peer);
        for _ in 0..512 {
            assert!(work.step().is_none());
        }
        assert_eq!(
            &*work.step().unwrap(),
            expected.raw_secret_bytes().as_slice()
        );
    }
}
