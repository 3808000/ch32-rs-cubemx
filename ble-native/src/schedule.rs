//! LLE 调度时基。连接与广播参数以 625 µs 为单位，射频边沿保留 0.5 µs 分辨率。

/// 625 µs 对应的 LLE 计数。
pub const SLOT_TICKS: u32 = 1_250;

/// LLE 单调时间戳，模 2³² 计数。比较的两个时刻必须相距不到半圈。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Instant(pub(crate) u32);

impl Instant {
    pub const fn after_slots(self, slots: u32) -> Self {
        self.after_ticks(slots * SLOT_TICKS)
    }

    pub const fn after_us(self, us: u32) -> Self {
        self.after_ticks(us * 2)
    }

    pub const fn after_ticks(self, ticks: u32) -> Self {
        Self(self.0.wrapping_add(ticks))
    }

    pub const fn before_us(self, us: u32) -> Self {
        Self(self.0.wrapping_sub(us * 2))
    }

    pub const fn elapsed_ticks(self, earlier: Self) -> u32 {
        self.0.wrapping_sub(earlier.0)
    }

    pub const fn reached(self, deadline: Self) -> bool {
        self.elapsed_ticks(deadline) < (1 << 31)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deadlines_across_wrap() {
        let start = Instant(u32::MAX - 500);
        let end = start.after_slots(1);
        assert_eq!(end.elapsed_ticks(start), 1250);
        assert!(!start.reached(end));
        assert!(!end.before_us(1).reached(end));
        assert!(end.reached(end));
        assert!(end.after_us(1).reached(end));
    }
}
