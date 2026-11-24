//! 複数物体の追跡。
//! 等速モデルのカルマンフィルタで位置と速度を推定し、ハンガリアン法で検出と対応付ける。

pub const MAX_TRACKS: usize = 64;
/// 軌跡として残す点の数（2 スキャンに 1 点）
pub const TRAIL: usize = 40;

/// 加速度のゆらぎ [m/s^2]
const SIGMA_ACC: f32 = 1.6;
/// 検出位置の誤差 [m]
const SIGMA_MEAS: f32 = 0.10;
/// 対応付けを認めるマハラノビス距離の二乗（自由度 2 のカイ二乗分布の 99.9 %）
const GATE: f32 = 13.8;
/// 対応付けを認める距離の上限 [m]
const GATE_DIST: f32 = 2.0;
const NO_MATCH: f32 = 1.0e6;

#[derive(Clone, Copy)]
pub struct Detection {
    pub x: f32,
    pub z: f32,
    pub width: f32,
    pub top: f32,
    /// 元になったクラスタの番号
    pub cluster: usize,
}

/// 1 軸ぶんのカルマンフィルタ（状態 = 位置と速度）
#[derive(Clone, Copy)]
struct Axis {
    p: f32,
    v: f32,
    ppp: f32,
    ppv: f32,
    pvv: f32,
}

impl Axis {
    fn new(p: f32) -> Self {
        Axis { p, v: 0.0, ppp: SIGMA_MEAS * SIGMA_MEAS, ppv: 0.0, pvv: 4.0 }
    }

    fn predict(&mut self, dt: f32) {
        let q = SIGMA_ACC * SIGMA_ACC;
        self.p += self.v * dt;
        // P = F P F^T + Q
        let ppp = self.ppp + 2.0 * dt * self.ppv + dt * dt * self.pvv + q * dt.powi(4) / 4.0;
        let ppv = self.ppv + dt * self.pvv + q * dt.powi(3) / 2.0;
        let pvv = self.pvv + q * dt * dt;
        (self.ppp, self.ppv, self.pvv) = (ppp, ppv, pvv);
    }

    /// 観測の予測誤差の分散
    fn innovation_var(&self) -> f32 {
        self.ppp + SIGMA_MEAS * SIGMA_MEAS
    }

    fn update(&mut self, meas: f32) {
        let s = self.innovation_var();
        let (kp, kv) = (self.ppp / s, self.ppv / s);
        let y = meas - self.p;
        self.p += kp * y;
        self.v += kv * y;
        let (ppp, ppv, pvv) = (self.ppp, self.ppv, self.pvv);
        self.ppp = (1.0 - kp) * ppp;
        self.ppv = (1.0 - kp) * ppv;
        self.pvv = pvv - kv * ppv;
    }
}

#[derive(Clone)]
pub struct Track {
    /// 画面に出す番号。動いていると判断したときに振る（それまでは 0）
    pub id: u32,
    x: Axis,
    z: Axis,
    /// 対応付いた回数 / 連続で見失っている回数 / 生まれてからのスキャン数
    pub hits: u32,
    pub misses: u32,
    pub age: u32,
    pub confirmed: bool,
    /// 生まれた位置から動いたか（静止物の誤検出を人として表示しないため）
    pub moving: bool,
    origin: [f32; 2],
    /// ほぼ止まっているスキャンが続いた回数
    still: u32,
    /// 表示用にならした速さ [m/s]
    pub speed_avg: f32,
    pub width: f32,
    pub top: f32,
    /// このスキャンで対応付いたクラスタ（なければ usize::MAX）
    pub cluster: usize,
    trail: [[f32; 2]; TRAIL],
    trail_head: usize,
    pub trail_len: usize,
}

impl Track {
    pub fn pos(&self) -> (f32, f32) {
        (self.x.p, self.z.p)
    }

    pub fn vel(&self) -> (f32, f32) {
        (self.x.v, self.z.v)
    }

    pub fn speed(&self) -> f32 {
        self.x.v.hypot(self.z.v)
    }

    /// 軌跡の点。k = 0 が最新
    pub fn trail_at(&self, k: usize) -> [f32; 2] {
        self.trail[(self.trail_head + TRAIL - 1 - k) % TRAIL]
    }

    fn push_trail(&mut self) {
        self.trail[self.trail_head] = [self.x.p, self.z.p];
        self.trail_head = (self.trail_head + 1) % TRAIL;
        self.trail_len = (self.trail_len + 1).min(TRAIL);
    }
}

#[derive(Default)]
pub struct Tracker {
    pub tracks: Vec<Track>,
    next_id: u32,
    cost: Vec<f32>,
    assign: Vec<usize>,
    hungarian: Hungarian,
}

impl Tracker {
    pub fn new() -> Self {
        Tracker { tracks: Vec::with_capacity(MAX_TRACKS), next_id: 1, ..Default::default() }
    }

    /// 動いていると判断した追跡の数
    pub fn moving_count(&self) -> usize {
        self.tracks.iter().filter(|t| t.confirmed && t.moving).count()
    }

    pub fn step(&mut self, dets: &[Detection], dt: f32, ego: (f32, f32), max_range: f32) {
        // 1. 予測
        for t in &mut self.tracks {
            t.x.predict(dt);
            t.z.predict(dt);
            t.age += 1;
            t.cluster = usize::MAX;
        }

        // 2. 対応付け
        let (nt, nd) = (self.tracks.len(), dets.len());
        self.cost.clear();
        for t in &self.tracks {
            let (sx, sz) = (t.x.innovation_var(), t.z.innovation_var());
            for d in dets {
                let (dx, dz) = (d.x - t.x.p, d.z - t.z.p);
                let m = dx * dx / sx + dz * dz / sz;
                let ok = m < GATE && dx * dx + dz * dz < GATE_DIST * GATE_DIST;
                self.cost.push(if ok { m } else { NO_MATCH });
            }
        }
        self.hungarian.solve(&self.cost, nt, nd, &mut self.assign);

        // 3. 更新
        let mut used = vec![false; nd];
        for (ti, t) in self.tracks.iter_mut().enumerate() {
            let di = self.assign[ti];
            if di < nd && self.cost[ti * nd + di] < NO_MATCH {
                let d = &dets[di];
                used[di] = true;
                t.x.update(d.x);
                t.z.update(d.z);
                t.hits += 1;
                t.misses = 0;
                t.cluster = d.cluster;
                t.width += (d.width - t.width) * 0.2;
                t.top += (d.top.max(t.top) - t.top) * 0.3;
            } else {
                t.misses += 1;
            }
            if !t.confirmed && t.hits >= 4 {
                t.confirmed = true;
            }
            let (px, pz) = t.pos();
            if t.confirmed && !t.moving && (px - t.origin[0]).hypot(pz - t.origin[1]) > 0.7 && t.speed() > 0.3 {
                t.moving = true;
                if t.id == 0 {
                    t.id = self.next_id;
                    self.next_id += 1;
                }
            }
            t.speed_avg += (t.speed() - t.speed_avg) * 0.12;
            // 4 秒止まったままなら、動いている物体としては扱わない
            t.still = if t.speed() < 0.15 { t.still + 1 } else { 0 };
            if t.moving && t.still > 40 {
                t.moving = false;
                t.origin = [px, pz];
            }
            if t.age % 2 == 0 {
                t.push_trail();
            }
        }

        // 4. 見失ったものを消す。動いていた追跡は、物陰に入っても予測だけでしばらく残す
        self.tracks.retain(|t| {
            let limit = if !t.confirmed {
                1
            } else if t.moving {
                25
            } else {
                5
            };
            let (px, pz) = t.pos();
            t.misses <= limit && (px - ego.0).hypot(pz - ego.1) < max_range
        });

        // 5. 同じ物体に 2 つ付いた追跡は、古いほうを残す
        let mut i = 0;
        while i < self.tracks.len() {
            let (ax, az) = self.tracks[i].pos();
            let mut removed_self = false;
            let mut j = i + 1;
            while j < self.tracks.len() {
                let (bx, bz) = self.tracks[j].pos();
                if (ax - bx).hypot(az - bz) < 0.35 {
                    if self.tracks[j].hits > self.tracks[i].hits {
                        self.tracks.swap_remove(i);
                        removed_self = true;
                        break;
                    }
                    self.tracks.swap_remove(j);
                    continue;
                }
                j += 1;
            }
            if !removed_self {
                i += 1;
            }
        }

        // 6. 対応付かなかった検出から、新しい追跡を始める
        for (di, d) in dets.iter().enumerate() {
            if used[di] || self.tracks.len() >= MAX_TRACKS {
                continue;
            }
            self.tracks.push(Track {
                id: 0,
                x: Axis::new(d.x),
                z: Axis::new(d.z),
                hits: 1,
                misses: 0,
                age: 0,
                confirmed: false,
                moving: false,
                origin: [d.x, d.z],
                still: 0,
                speed_avg: 0.0,
                width: d.width,
                top: d.top,
                cluster: d.cluster,
                trail: [[d.x, d.z]; TRAIL],
                trail_head: 0,
                trail_len: 0,
            });
        }
    }
}

/// ハンガリアン法（割当問題）。行 = 追跡、列 = 検出。
#[derive(Default)]
pub struct Hungarian {
    u: Vec<f64>,
    v: Vec<f64>,
    p: Vec<usize>,
    way: Vec<usize>,
    minv: Vec<f64>,
    used: Vec<bool>,
    sq: Vec<f32>,
}

impl Hungarian {
    /// `cost[r * cols + c]` の合計が最小になる割り当てを求め、`assign[r]` に列番号を入れる。
    /// 割り当てのない行は usize::MAX。
    pub fn solve(&mut self, cost: &[f32], rows: usize, cols: usize, assign: &mut Vec<usize>) {
        assign.clear();
        assign.resize(rows, usize::MAX);
        if rows == 0 || cols == 0 {
            return;
        }
        // 正方行列にそろえる（足りないところは「対応なし」と同じコスト）
        let n = rows.max(cols);
        self.sq.clear();
        self.sq.resize(n * n, NO_MATCH);
        for r in 0..rows {
            self.sq[r * n..r * n + cols].copy_from_slice(&cost[r * cols..(r + 1) * cols]);
        }
        // 「対応なし」のコストが大きいので、誤差が出ないよう f64 で計算する
        let a = |r: usize, c: usize, sq: &Vec<f32>| sq[(r - 1) * n + (c - 1)] as f64;

        for buf in [&mut self.u, &mut self.v, &mut self.minv] {
            buf.clear();
            buf.resize(n + 1, 0.0);
        }
        for buf in [&mut self.p, &mut self.way] {
            buf.clear();
            buf.resize(n + 1, 0);
        }
        self.used.clear();
        self.used.resize(n + 1, false);

        for i in 1..=n {
            self.p[0] = i;
            let mut j0 = 0;
            self.minv.iter_mut().for_each(|m| *m = f64::INFINITY);
            self.used.iter_mut().for_each(|b| *b = false);
            loop {
                self.used[j0] = true;
                let i0 = self.p[j0];
                let mut delta = f64::INFINITY;
                let mut j1 = 0;
                for j in 1..=n {
                    if self.used[j] {
                        continue;
                    }
                    let cur = a(i0, j, &self.sq) - self.u[i0] - self.v[j];
                    if cur < self.minv[j] {
                        self.minv[j] = cur;
                        self.way[j] = j0;
                    }
                    if self.minv[j] < delta {
                        delta = self.minv[j];
                        j1 = j;
                    }
                }
                for j in 0..=n {
                    if self.used[j] {
                        self.u[self.p[j]] += delta;
                        self.v[j] -= delta;
                    } else {
                        self.minv[j] -= delta;
                    }
                }
                j0 = j1;
                if self.p[j0] == 0 {
                    break;
                }
            }
            loop {
                let j1 = self.way[j0];
                self.p[j0] = self.p[j1];
                j0 = j1;
                if j0 == 0 {
                    break;
                }
            }
        }
        for j in 1..=n {
            let r = self.p[j];
            if r >= 1 && r <= rows && j <= cols {
                assign[r - 1] = j - 1;
            }
        }
    }
}
