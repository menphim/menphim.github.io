//! 再現性のための小さな疑似乱数（xorshift32）。

pub struct Rng(u32);

impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng(if seed == 0 { 0x9E37_79B9 } else { seed })
    }

    #[inline]
    pub fn next_u32(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x
    }

    /// [0, 1)
    #[inline]
    pub fn uniform(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 * (1.0 / 16_777_216.0)
    }

    #[inline]
    pub fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.uniform()
    }

    #[inline]
    pub fn below(&mut self, n: usize) -> usize {
        (self.next_u32() as u64 * n as u64 >> 32) as usize
    }

    /// 平均 0・分散 1 の近似（一様乱数 2 個の和 = 三角分布）。
    /// 計測ノイズ用で、裾の正確さは要らないので速さを優先する。
    #[inline]
    pub fn noise(&mut self) -> f32 {
        let u = self.next_u32();
        let a = (u & 0xFFFF) as f32;
        let b = (u >> 16) as f32;
        (a + b - 65_535.0) * (2.449_489_7 / 65_536.0)
    }
}
