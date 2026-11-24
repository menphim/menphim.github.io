//! 回転式 LiDAR のシミュレーション。
//! センサーから出たビームが最初に当たる点を、柱状の物体（world::Prim）と地面に対して解析的に求める。

use crate::rng::Rng;
use crate::world::{Prim, Shape};

pub struct Lidar {
    pub beams: usize,
    pub steps: usize,
    /// センサーの高さ [m]
    pub height: f32,
    /// 計測範囲（水平距離）[m]
    pub max_range: f32,
    /// 距離のノイズ（標準偏差）[m]
    pub sigma: f32,
    /// 反射が返らない割合
    pub dropout: f32,
    /// ビームごとの傾き（水平距離 1 m あたりの上下の変化）と、その仰角の余弦
    slopes: Vec<(f32, f32)>,
    /// 方位ごとの単位ベクトル。偶数番のビームと奇数番のビームは半ステップずらす
    dirs: Vec<(f32, f32)>,
}

/// 1 回転ぶんの点群
pub struct Scan {
    /// x, y, z の並び
    pub xyz: Vec<f32>,
    /// 当たった物体（0 = 地面か静止物、k = k 番目の歩行者）。評価用で、認識側は使わない
    pub tag: Vec<u8>,
    pub n: usize,
}

impl Scan {
    pub fn with_capacity(points: usize) -> Self {
        Scan { xyz: vec![0.0; points * 3], tag: vec![0; points], n: 0 }
    }
}

#[derive(Clone, Copy)]
struct Span {
    rin: f32,
    rout: f32,
    y0: f32,
    y1: f32,
    tag: u8,
}

impl Lidar {
    pub fn new(beams: usize, steps: usize) -> Self {
        let slopes = (0..beams)
            .map(|b| {
                let elev = (-25.0 + b as f32 / (beams - 1) as f32 * 37.0).to_radians();
                (elev.tan(), elev.cos())
            })
            .collect();
        let dirs = (0..steps * 2)
            .map(|j| {
                let a = j as f32 * 0.5 / steps as f32 * core::f32::consts::TAU;
                (a.cos(), a.sin())
            })
            .collect();
        Lidar { beams, steps, height: 1.9, max_range: 46.0, sigma: 0.02, dropout: 0.01, slopes, dirs }
    }

    pub fn rays(&self) -> usize {
        self.beams * self.steps
    }

    /// (ox, oz) にあるセンサー（向き yaw）から全周を 1 回走査する
    pub fn scan(&self, prims: &[Prim], ox: f32, oz: f32, yaw: f32, rng: &mut Rng, out: &mut Scan) {
        let (cy, sy) = (yaw.cos(), yaw.sin());
        let h = self.height;
        let drop_below = (self.dropout * 4_294_967_296.0) as u32;
        let mut n = 0;
        let mut spans = [Span { rin: 0.0, rout: 0.0, y0: 0.0, y1: 0.0, tag: 0 }; 24];

        for (j, &(c0, s0)) in self.dirs.iter().enumerate() {
            let (cx, cz) = (c0 * cy - s0 * sy, s0 * cy + c0 * sy);

            // この方位で水平方向に交わる物体と、その区間 [rin, rout] を先に求める。
            // 同じ方位のビームは傾きだけが違うので、区間は共通で使える。
            let mut m = 0;
            for p in prims {
                let (rin, rout) = match p.shape {
                    Shape::Wall { x } => {
                        if ox <= x {
                            (0.0, f32::INFINITY)
                        } else if cx < -1e-6 {
                            ((x - ox) / cx, f32::INFINITY)
                        } else {
                            continue;
                        }
                    }
                    Shape::Box { x, z, hw, hd } => {
                        let (mut rin, mut rout) = (0.0f32, f32::INFINITY);
                        let mut miss = false;
                        for (lo, hi, dir) in [(x - hw - ox, x + hw - ox, cx), (z - hd - oz, z + hd - oz, cz)] {
                            if dir.abs() < 1e-9 {
                                miss |= lo > 0.0 || hi < 0.0;
                                continue;
                            }
                            let (a, b) = (lo / dir, hi / dir);
                            rin = rin.max(a.min(b));
                            rout = rout.min(a.max(b));
                        }
                        if miss || rout < rin {
                            continue;
                        }
                        (rin, rout)
                    }
                    Shape::Cyl { x, z, r } => {
                        let (px, pz) = (x - ox, z - oz);
                        let b = cx * px + cz * pz;
                        let disc = b * b - (px * px + pz * pz - r * r);
                        if disc < 0.0 {
                            continue;
                        }
                        let sq = disc.sqrt();
                        if b + sq < 0.0 {
                            continue;
                        }
                        ((b - sq).max(0.0), b + sq)
                    }
                };
                if rin > self.max_range {
                    continue;
                }
                if m < spans.len() {
                    spans[m] = Span { rin, rout, y0: p.y0, y1: p.y1, tag: p.tag };
                    m += 1;
                }
            }

            let mut b = j & 1;
            while b < self.beams {
                let (slope, cos_el) = self.slopes[b];
                b += 2;
                let mut best = if slope < 0.0 { h / -slope } else { f32::INFINITY };
                let mut tag = 0;
                for s in &spans[..m] {
                    let yin = h + slope * s.rin;
                    let r = if yin >= s.y0 && yin <= s.y1 {
                        s.rin // 側面
                    } else if yin > s.y1 && slope < 0.0 {
                        (s.y1 - h) / slope // 上面
                    } else if yin < s.y0 && slope > 0.0 {
                        (s.y0 - h) / slope // 下面
                    } else {
                        continue;
                    };
                    if r < s.rin || r > s.rout {
                        continue;
                    }
                    if r < best {
                        best = r;
                        tag = s.tag;
                    }
                }
                if best > self.max_range {
                    continue;
                }
                let u = rng.next_u32();
                if u < drop_below {
                    continue;
                }
                let r = best + self.sigma * cos_el * rng.noise();
                out.xyz[n * 3] = ox + cx * r;
                out.xyz[n * 3 + 1] = h + slope * r;
                out.xyz[n * 3 + 2] = oz + cz * r;
                out.tag[n] = tag;
                n += 1;
            }
        }
        out.n = n;
    }
}
