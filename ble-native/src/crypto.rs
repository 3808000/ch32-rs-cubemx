//! BLE 的字节序转换和 RustCrypto 算法封装。

use aes::Aes128;
use ccm::{
    aead::{AeadInPlace, KeyInit},
    consts::{U13, U4},
    Ccm,
};
use cmac::{Cmac, Mac};
use zeroize::Zeroizing;

pub(crate) type Key = [u8; 16];
pub(crate) const MIC_LEN: usize = 4;
pub(crate) const COUNTER_LIMIT: u64 = 1 << 39;

pub(crate) fn reversed<const N: usize>(mut bytes: [u8; N]) -> [u8; N] {
    bytes.reverse();
    bytes
}

/// Vol 3 Part H 的 e()，收发参数按 BLE 小端语义表示。
pub(crate) fn e(key: &Key, input: Key) -> Key {
    use aes::cipher::BlockEncrypt;
    let key = Zeroizing::new(reversed(*key));
    let mut block = reversed(input).into();
    let cipher = Aes128::new((&*key).into());
    cipher.encrypt_block(&mut block);
    reversed(block.into())
}

pub(crate) fn c1(
    random: Key,
    request: &[u8; 7],
    response: &[u8; 7],
    initiator: &[u8; 7],
    responder: &[u8; 7],
) -> Key {
    let mut p1 = [0; 16];
    p1[0] = initiator[0];
    p1[1] = responder[0];
    p1[2..9].copy_from_slice(request);
    p1[9..].copy_from_slice(response);
    let mut p2 = [0; 16];
    p2[..6].copy_from_slice(&responder[1..]);
    p2[6..12].copy_from_slice(&initiator[1..]);
    let tk = [0; 16]; // Just Works
    let x = e(&tk, core::array::from_fn(|i| random[i] ^ p1[i]));
    e(&tk, core::array::from_fn(|i| x[i] ^ p2[i]))
}

pub(crate) fn s1(initiator_random: &Key, responder_random: &Key) -> Key {
    let mut r = [0; 16];
    r[..8].copy_from_slice(&initiator_random[..8]);
    r[8..].copy_from_slice(&responder_random[..8]);
    e(&[0; 16], r)
}

fn cmac(key: &Key, parts: &[&[u8]]) -> Key {
    let mut mac = <Cmac<Aes128> as Mac>::new(key.into());
    for part in parts {
        mac.update(part);
    }
    mac.finalize().into_bytes().into()
}

/// SC 函数的输入输出使用 Core 规范中的 MSO-first 表示。
pub(crate) fn f4(u: &[u8; 32], v: &[u8; 32], x: &Key) -> Key {
    cmac(x, &[u, v, &[0]])
}

pub(crate) fn f5(shared: &[u8; 32], na: &Key, nb: &Key, a: &[u8; 7], b: &[u8; 7]) -> (Key, Key) {
    const SALT: Key = 0x6c88_8391_aaf5_a538_6037_0bdb_5a60_83beu128.to_be_bytes();
    let t = Zeroizing::new(cmac(&SALT, &[shared]));
    let calculate = |counter| cmac(&t, &[&[counter], b"btle", na, nb, a, b, &[1, 0]]);
    (calculate(0), calculate(1))
}

pub(crate) fn f6(
    mac_key: &Key,
    n1: &Key,
    n2: &Key,
    io_cap: &[u8; 3],
    a: &[u8; 7],
    b: &[u8; 7],
) -> Key {
    cmac(mac_key, &[n1, n2, &[0; 16], io_cap, a, b])
}

pub(crate) struct Cipher {
    ccm: Ccm<Aes128, U4, U13>,
    iv: [u8; 8],
}

impl Cipher {
    pub(crate) fn new(ltk: &Key, skd: Key, iv: [u8; 8]) -> Self {
        let key = Zeroizing::new(reversed(e(ltk, skd)));
        Self {
            ccm: Ccm::new((&*key).into()),
            iv,
        }
    }

    fn nonce(&self, central: bool, counter: u64) -> [u8; 13] {
        let mut nonce = [0; 13];
        nonce[..5].copy_from_slice(&counter.to_le_bytes()[..5]);
        nonce[4] |= u8::from(central) << 7;
        nonce[5..].copy_from_slice(&self.iv);
        nonce
    }

    pub(crate) fn seal(
        &self,
        header: u8,
        counter: u64,
        payload: &mut [u8],
    ) -> Option<[u8; MIC_LEN]> {
        if counter >= COUNTER_LIMIT {
            return None;
        }
        let nonce = self.nonce(false, counter);
        self.ccm
            .encrypt_in_place_detached((&nonce).into(), &[header & 0xe3], payload)
            .ok()
            .map(Into::into)
    }

    pub(crate) fn open(
        &self,
        header: u8,
        counter: u64,
        payload: &mut [u8],
        mic: &[u8; MIC_LEN],
    ) -> bool {
        if counter >= COUNTER_LIMIT {
            return false;
        }
        let nonce = self.nonce(true, counter);
        self.ccm
            .decrypt_in_place_detached((&nonce).into(), &[header & 0xe3], payload, mic.into())
            .is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_legacy_pairing_vectors() {
        let random = 0x5783_d521_56ad_6f0e_6388_274e_c670_2ee0u128.to_le_bytes();
        let request = [0x01, 0x01, 0x00, 0x00, 0x10, 0x07, 0x07];
        let response = [0x02, 0x03, 0x00, 0x00, 0x08, 0x00, 0x05];
        let initiator = [1, 0xa6, 0xa5, 0xa4, 0xa3, 0xa2, 0xa1];
        let responder = [0, 0xb6, 0xb5, 0xb4, 0xb3, 0xb2, 0xb1];
        assert_eq!(
            c1(random, &request, &response, &initiator, &responder),
            0x1e1e_3fef_8789_88ea_d2a7_4dc5_bef1_3b86u128.to_le_bytes()
        );
        let rb = 0x000f_0e0d_0c0b_0a09_1122_3344_5566_7788u128.to_le_bytes();
        let ra = 0x0102_0304_0506_0708_99aa_bbcc_ddee_ff00u128.to_le_bytes();
        assert_eq!(
            s1(&ra, &rb),
            0x9a1f_e1f0_e8b0_f49b_5b42_16ae_796d_a062u128.to_le_bytes()
        );
    }

    #[test]
    fn core_ll_encryption_start_example() {
        let ltk = 0x4c68_3841_39f5_74d8_36bc_f34e_9dfb_01bfu128.to_le_bytes();
        let skd = 0x0213_2435_4657_6879_acbd_cedf_e0f1_0213u128.to_le_bytes();
        let iv = 0xdeaf_babe_badc_ab24u64.to_le_bytes();
        assert_eq!(
            e(&ltk, skd),
            0x99ad_1b52_26a3_7e3e_058e_3b8e_27c2_c666u128.to_le_bytes()
        );
        let cipher = Cipher::new(&ltk, skd, iv);

        let mut command = [0x9f];
        assert!(cipher.open(0x0f, 0, &mut command, &[0xcd, 0xa7, 0xf4, 0x48]));
        assert_eq!(command, [0x06]);
        let mic = cipher.seal(0x07, 0, &mut command).unwrap();
        assert_eq!(command, [0xa3]);
        assert_eq!(mic, [0x4c, 0x13, 0xa4, 0x15]);

        let mut wrong = [0x9f];
        assert!(!cipher.open(0x0f, 1, &mut wrong, &[0xcd, 0xa7, 0xf4, 0x48]));
        assert!(cipher.seal(0x07, COUNTER_LIMIT, &mut wrong).is_none());
    }
}
