//! 地面の推定。RANSAC で平面 y = a x + b z + c を当てはめ、各点の地面からの高さを求める。

use crate::rng::Rng;

#[derive(Clone, Copy, Default)]
pub struct Plane {
    pub a: f32,
    pub b: f32,
    pub c: f32,
}

impl Plane {
    #[inline]
    pub fn height(&self, x: f32, y: f32, z: f32) -> f32 {
        y - (self.a * x + self.b * z + self.c)
    }
}

/// この高さ未満の点を地面とみなす [m]
pub const GROUND_TOL: f32 = 0.12;
/// 平面の傾きの上限（約 12 度）。壁のような垂直面を地面と間違えないため
const MAX_SLOPE: f32 = 0.21;
const SAMPLES: usize = 1500;
const ITERS: usize = 24;
/// 前回の平面からこの高さ以内の点を、平面の候補にする [m]
const CANDIDATE_BAND: f32 = 0.6;
/// 候補がこれより少ないときは、前回の平面をそのまま使う
const MIN_CANDIDATES: usize = 60;

pub struct GroundFilter {
    sample: Vec<[f32; 3]>,
    pub plane: Plane,
    pub ground_points: usize,
}

impl Default for GroundFilter {
    fn default() -> Self {
        Self::new()
    }
}

impl GroundFilter {
    pub fn new() -> Self {
        GroundFilter { sample: Vec::with_capacity(SAMPLES + 8), plane: Plane::default(), ground_points: 0 }
    }

    /// `height[i]` に地面からの高さを書き込む
    pub fn run(&mut self, xyz: &[f32], n: usize, rng: &mut Rng, height: &mut [f32]) {
        self.sample.clear();
        if n < 3 {
            self.ground_points = 0;
            return;
        }
        // 候補は、前回の推定（最初はセンサーの取り付け高さから決まる y = 0）の近くにある点だけにする。
        // 壁のすぐ横などで地面の点が少ないときに、地面でない点から平面を作ってしまうのを防ぐ
        let prior = self.plane;
        let stride = (n / SAMPLES).max(1);
        let mut i = rng.below(stride);
        while i < n {
            let p = [xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]];
            if prior.height(p[0], p[1], p[2]).abs() < CANDIDATE_BAND {
                self.sample.push(p);
            }
            i += stride;
        }
        let m = self.sample.len();
        let inliers = |plane: &Plane, sample: &[[f32; 3]]| sample.iter().filter(|s| plane.height(s[0], s[1], s[2]).abs() < GROUND_TOL).count();

        // 前回の平面を出発点にして、3 点から作った平面のうち近い点が最も多いものを残す
        let mut best = prior;
        if m >= MIN_CANDIDATES {
            let mut best_count = inliers(&prior, &self.sample);
            for _ in 0..ITERS {
                let (p, q, r) = (self.sample[rng.below(m)], self.sample[rng.below(m)], self.sample[rng.below(m)]);
                let Some(plane) = through(p, q, r) else { continue };
                if plane.a.abs() > MAX_SLOPE || plane.b.abs() > MAX_SLOPE {
                    continue;
                }
                let count = inliers(&plane, &self.sample);
                if count > best_count {
                    best_count = count;
                    best = plane;
                }
            }

            // 近い点だけで最小二乗をやり直して、平面を整える
            if let Some(refined) = least_squares(self.sample.iter().filter(|s| best.height(s[0], s[1], s[2]).abs() < GROUND_TOL)) {
                if refined.a.abs() <= MAX_SLOPE && refined.b.abs() <= MAX_SLOPE && inliers(&refined, &self.sample) >= best_count {
                    best = refined;
                }
            }
        }
        self.plane = best;

        let mut ground = 0;
        for i in 0..n {
            let h = best.height(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]);
            height[i] = h;
            if h < GROUND_TOL {
                ground += 1;
            }
        }
        self.ground_points = ground;
    }
}

/// 3 点を通る平面。3 点がほぼ一直線なら None
fn through(p: [f32; 3], q: [f32; 3], r: [f32; 3]) -> Option<Plane> {
    let (ux, uy, uz) = (q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    let (vx, vy, vz) = (r[0] - p[0], r[1] - p[1], r[2] - p[2]);
    // 法線 = u × v
    let (nx, ny, nz) = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if ny.abs() < 1.0 {
        return None; // 水平面への射影の面積が小さい（点が近すぎるか、垂直に近い）
    }
    let (a, b) = (-nx / ny, -nz / ny);
    Some(Plane { a, b, c: p[1] - a * p[0] - b * p[2] })
}

/// y = a x + b z + c の最小二乗（正規方程式をクラメルの公式で解く）
fn least_squares<'a>(points: impl Iterator<Item = &'a [f32; 3]>) -> Option<Plane> {
    let (mut sxx, mut sxz, mut szz, mut sx, mut sz, mut sxy, mut szy, mut sy, mut n) =
        (0f64, 0f64, 0f64, 0f64, 0f64, 0f64, 0f64, 0f64, 0f64);
    for p in points {
        let (x, y, z) = (p[0] as f64, p[1] as f64, p[2] as f64);
        sxx += x * x;
        sxz += x * z;
        szz += z * z;
        sx += x;
        sz += z;
        sxy += x * y;
        szy += z * y;
        sy += y;
        n += 1.0;
    }
    let det = sxx * (szz * n - sz * sz) - sxz * (sxz * n - sz * sx) + sx * (sxz * sz - szz * sx);
    if det.abs() < 1e-6 {
        return None;
    }
    let a = (sxy * (szz * n - sz * sz) - sxz * (szy * n - sz * sy) + sx * (szy * sz - szz * sy)) / det;
    let b = (sxx * (szy * n - sz * sy) - sxy * (sxz * n - sz * sx) + sx * (sxz * sy - szy * sx)) / det;
    let c = (sxx * (szz * sy - sz * szy) - sxz * (sxz * sy - szy * sx) + sxy * (sxz * sz - szz * sx)) / det;
    Some(Plane { a: a as f32, b: b as f32, c: c as f32 })
}
