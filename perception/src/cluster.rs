//! クラスタリング。地面より上の点を上から見たグリッドに落とし、隣り合うセルをつないで物体ごとに分ける。

/// センサー中心のグリッド。±48 m を 0.25 m のセルで覆う
const CN: usize = 384;
const CCELL: f32 = 0.25;
const HALF: f32 = CN as f32 * CCELL * 0.5;
/// 物体としてまとめる高さの範囲 [m]。頭上の樹冠などは別扱いにする
pub const BAND_LO: f32 = 0.15;
pub const BAND_HI: f32 = 2.2;
const UNASSIGNED: u16 = u16::MAX;
const MAX_CLUSTERS: usize = 4000;

#[derive(Clone, Copy, Default)]
pub struct Cluster {
    pub points: u32,
    /// 推定した中心 [m]
    pub x: f32,
    pub z: f32,
    /// センサーから見た横幅と奥行き [m]
    pub width: f32,
    pub depth: f32,
    /// 最も高い点の高さ [m]
    pub top: f32,
    /// 頭上に離れて張り出している物（樹冠など）があるか
    pub overhang: bool,
    /// 大きさが人に近いか
    pub person_like: bool,
    // 以下は集計の途中で使う
    sx: f32,
    sz: f32,
    /// 範囲内で最も高い点と、範囲より上で最も低い点・最も高い点
    band_top: f32,
    above_lo: f32,
    above_hi: f32,
    ux: f32,
    uz: f32,
    rmin: f32,
    rmax: f32,
    tmin: f32,
    tmax: f32,
}

pub struct Clusterer {
    /// ビームの上下方向の間隔 [rad]
    beam_gap: f32,
    cells: Vec<u16>,
    used: Vec<u32>,
    stack: Vec<u32>,
    pub clusters: Vec<Cluster>,
    /// 点ごとのクラスタ番号（0 = なし、k = clusters[k - 1]）
    pub labels: Vec<u16>,
}

impl Clusterer {
    pub fn new(max_points: usize, beam_gap: f32) -> Self {
        Clusterer {
            beam_gap,
            cells: vec![0; CN * CN],
            used: Vec::with_capacity(8192),
            stack: Vec::with_capacity(1024),
            clusters: Vec::with_capacity(256),
            labels: vec![0; max_points],
        }
    }

    #[inline]
    fn cell(x: f32, z: f32, ex: f32, ez: f32) -> Option<usize> {
        let ix = ((x - ex + HALF) / CCELL).floor();
        let iz = ((z - ez + HALF) / CCELL).floor();
        if ix < 1.0 || iz < 1.0 || ix >= (CN - 1) as f32 || iz >= (CN - 1) as f32 {
            return None;
        }
        Some(iz as usize * CN + ix as usize)
    }

    /// `height` は地面からの高さ。(ex, ez) はセンサーの位置
    pub fn run(&mut self, xyz: &[f32], height: &[f32], n: usize, ex: f32, ez: f32) {
        for &c in &self.used {
            self.cells[c as usize] = 0;
        }
        self.used.clear();
        self.clusters.clear();

        // 1. 高さが範囲内の点があるセルに印を付ける
        for i in 0..n {
            self.labels[i] = 0;
            let h = height[i];
            if h <= BAND_LO || h >= BAND_HI {
                continue;
            }
            if let Some(c) = Self::cell(xyz[i * 3], xyz[i * 3 + 2], ex, ez) {
                if self.cells[c] == 0 {
                    self.cells[c] = UNASSIGNED;
                    self.used.push(c as u32);
                }
            }
        }

        // 2. 隣り合うセル（8 近傍）をひとまとまりにする
        for u in 0..self.used.len() {
            let seed = self.used[u] as usize;
            if self.cells[seed] != UNASSIGNED || self.clusters.len() >= MAX_CLUSTERS {
                continue;
            }
            self.clusters.push(Cluster {
                rmin: f32::MAX,
                rmax: f32::MIN,
                tmin: f32::MAX,
                tmax: f32::MIN,
                above_lo: f32::MAX,
                ..Cluster::default()
            });
            let id = self.clusters.len() as u16;
            self.cells[seed] = id;
            self.stack.push(seed as u32);
            while let Some(c) = self.stack.pop() {
                let c = c as usize;
                for nb in [c - CN - 1, c - CN, c - CN + 1, c - 1, c + 1, c + CN - 1, c + CN, c + CN + 1] {
                    if self.cells[nb] == UNASSIGNED {
                        self.cells[nb] = id;
                        self.stack.push(nb as u32);
                    }
                }
            }
        }

        // 3. 点にクラスタ番号を付け、重心と高さを集計する。
        //    範囲より高い点も、真下にクラスタがあれば仮にその一部として数える
        for i in 0..n {
            let h = height[i];
            if h <= BAND_LO {
                continue;
            }
            let Some(c) = Self::cell(xyz[i * 3], xyz[i * 3 + 2], ex, ez) else { continue };
            let id = self.cells[c];
            if id == 0 || id == UNASSIGNED {
                continue;
            }
            self.labels[i] = id;
            let k = &mut self.clusters[id as usize - 1];
            if h < BAND_HI {
                k.points += 1;
                k.sx += xyz[i * 3];
                k.sz += xyz[i * 3 + 2];
                k.band_top = k.band_top.max(h);
            } else {
                k.above_lo = k.above_lo.min(h);
                k.above_hi = k.above_hi.max(h);
            }
        }

        // 範囲より上の点が、下の点とつながっているかを見る。
        // つながっていれば背の高い物体（街灯・樹木の幹・壁）で、離れていれば
        // 頭上に張り出した別の物（樹冠の下を歩く人など）と判断する。
        // ビームの間隔は遠いほど開くので、そのぶんの隙間は許す
        for k in &mut self.clusters {
            let inv = 1.0 / k.points.max(1) as f32;
            let range = (k.sx * inv - ex).hypot(k.sz * inv - ez);
            let has_above = k.above_hi > 0.0;
            k.overhang = has_above && k.above_lo - k.band_top > 0.5 + 2.0 * self.beam_gap * range;
            k.top = if has_above && !k.overhang { k.above_hi } else { k.band_top };
        }
        for i in 0..n {
            let id = self.labels[i];
            if id != 0 && height[i] >= BAND_HI && self.clusters[id as usize - 1].overhang {
                self.labels[i] = 0;
            }
        }

        // 4. センサーから見た向き（重心の方向）に沿って、横幅と奥行きを測る
        for k in &mut self.clusters {
            let inv = 1.0 / k.points.max(1) as f32;
            let (dx, dz) = (k.sx * inv - ex, k.sz * inv - ez);
            let d = dx.hypot(dz).max(1e-3);
            k.ux = dx / d;
            k.uz = dz / d;
        }
        for i in 0..n {
            let id = self.labels[i];
            if id == 0 || height[i] >= BAND_HI {
                continue;
            }
            let k = &mut self.clusters[id as usize - 1];
            let (px, pz) = (xyz[i * 3] - ex, xyz[i * 3 + 2] - ez);
            let r = px * k.ux + pz * k.uz;
            let t = pz * k.ux - px * k.uz;
            k.rmin = k.rmin.min(r);
            k.rmax = k.rmax.max(r);
            k.tmin = k.tmin.min(t);
            k.tmax = k.tmax.max(t);
        }

        for k in &mut self.clusters {
            if k.points == 0 {
                continue;
            }
            let (ux, uz) = (k.ux, k.uz);
            k.width = k.tmax - k.tmin;
            k.depth = k.rmax - k.rmin;
            // 見えているのはセンサー側の面だけなので、重心ではなく
            // 「最も近い点 + 横幅の半分」を中心とする（丸い物体を仮定）
            let r = k.rmin + (k.width * 0.5).clamp(0.1, 0.35);
            let t = 0.5 * (k.tmin + k.tmax);
            k.x = ex + ux * r - uz * t;
            k.z = ez + uz * r + ux * t;
            // 人に近い大きさか。次のものは除く:
            //  - 横幅がほとんどないもの。面を斜めから見ると、縦 1 列の点だけが離れて
            //    クラスタになり、センサーが動くと面の上を滑って動く物体のように見える
            //  - 点が多いのに奥行きがないもの（壁や箱の面の一部）
            let size_ok = k.width >= 0.18 && k.width <= 0.95 && k.depth <= 0.95 && k.top >= 1.0 && k.top <= 1.95;
            let flat = k.points >= 40 && k.depth < 0.25 * k.width;
            k.person_like = k.points >= 5 && size_ok && !flat;
        }
    }
}
