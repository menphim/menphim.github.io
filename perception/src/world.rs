//! シミュレーターの世界（正解データ）。
//! 静止物・歩行者・ロボットの動きを作る。認識側（ground / cluster / track / plan）は
//! ここの正解を直接は見ず、LiDAR の点群だけを入力にする。

use crate::grid::{self, AStar, LETHAL, N};
use crate::rng::Rng;

/// 水平断面の形
#[derive(Clone, Copy)]
pub enum Shape {
    /// x がこの値より小さい側が壁
    Wall { x: f32 },
    /// 軸に平行な直方体（中心と半幅）
    Box { x: f32, z: f32, hw: f32, hd: f32 },
    /// 円柱
    Cyl { x: f32, z: f32, r: f32 },
}

/// 高さ y0〜y1 の柱状の物体
#[derive(Clone, Copy)]
pub struct Prim {
    pub shape: Shape,
    pub y0: f32,
    pub y1: f32,
    /// 0 = 静止物、k = k 番目の歩行者（評価用。認識側は使わない）
    pub tag: u8,
}

const fn boxp(x: f32, z: f32, w: f32, d: f32, h: f32) -> Prim {
    Prim { shape: Shape::Box { x, z, hw: w * 0.5, hd: d * 0.5 }, y0: 0.0, y1: h, tag: 0 }
}

const fn cyl(x: f32, z: f32, r: f32, y0: f32, y1: f32) -> Prim {
    Prim { shape: Shape::Cyl { x, z, r }, y0, y1, tag: 0 }
}

/// 歩行空間を想定した架空の配置
const STATIC: [Prim; 14] = [
    Prim { shape: Shape::Wall { x: -17.0 }, y0: 0.0, y1: 8.0, tag: 0 }, // 建物の壁
    boxp(10.0, -9.0, 7.0, 1.4, 0.8),                                    // 植栽の縁
    boxp(14.0, 9.0, 2.6, 2.6, 3.0),                                     // 売店
    boxp(-8.0, 12.0, 1.2, 3.6, 0.9),                                    // ベンチ
    boxp(-11.0, -10.0, 3.0, 1.6, 2.6),                                  // 設備
    cyl(6.0, 4.0, 0.2, 0.0, 5.0),                                       // 街灯
    cyl(6.0, -15.0, 0.2, 0.0, 5.0),
    cyl(-3.0, 19.0, 0.2, 0.0, 5.0),
    cyl(-5.0, -4.0, 0.3, 0.0, 3.2), // 樹木（幹と樹冠）
    cyl(-5.0, -4.0, 2.2, 3.2, 6.4),
    cyl(19.0, -2.0, 0.3, 0.0, 3.2),
    cyl(19.0, -2.0, 2.4, 3.2, 6.8),
    cyl(2.0, -22.0, 0.3, 0.0, 3.2),
    cyl(2.0, -22.0, 2.2, 3.2, 6.2),
];

/// 歩行者の初期位置と歩く速さ
const WALKERS: [(f32, f32, f32); 5] =
    [(9.0, 5.0, 1.3), (1.0, 3.0, 1.1), (-11.0, 1.0, 0.9), (2.0, 13.0, 1.5), (13.0, 5.0, 1.2)];

pub const MAX_WALKERS: usize = 12;
pub const MAX_USER_BOXES: usize = 12;
/// 歩行者の体（胴と頭の 2 段の円柱）
pub const BODY_R: f32 = 0.24;
pub const BODY_H: f32 = 1.42;
pub const HEAD_R: f32 = 0.12;
pub const HEAD_H: f32 = 1.72;
/// ロボットの外形を円で近似したときの半径 [m]
pub const ROBOT_R: f32 = 0.42;
/// 歩行者が動き回る範囲（原点からの半径）[m]
const ROAM_R: f32 = 16.0;

pub struct Walker {
    pub x: f32,
    pub z: f32,
    pub vx: f32,
    pub vz: f32,
    pub speed: f32,
    goal: [f32; 2],
    path: Vec<[f32; 2]>,
    seg: usize,
    /// 進まなくなったことの検出用
    mark: [f32; 2],
    mark_t: f32,
    /// 経路を探し直すまでの待ち時間 [s]
    wait: f32,
}

pub struct Ego {
    pub x: f32,
    pub z: f32,
    pub yaw: f32,
    pub v: f32,
    pub w: f32,
}

pub struct World {
    pub statics: Vec<Prim>,
    pub walkers: Vec<Walker>,
    pub ego: Ego,
    pub time: f32,
    /// ロボットが静止物にぶつかった回数（評価用）
    pub collisions: u32,
    user_boxes: usize,
    rng: Rng,
    /// 静止物までの距離 [m]（正解の地図）
    gt_dist: Vec<f32>,
    /// 歩行者用のコスト
    gt_cost: Vec<u8>,
    astar: AStar,
    cells: Vec<usize>,
    occ: Vec<bool>,
}

impl World {
    pub fn new(seed: u32, walkers: usize) -> Self {
        let mut w = World {
            statics: STATIC.to_vec(),
            walkers: Vec::with_capacity(MAX_WALKERS),
            ego: Ego { x: 0.0, z: 0.0, yaw: 0.6, v: 0.0, w: 0.0 },
            time: 0.0,
            collisions: 0,
            user_boxes: 0,
            rng: Rng::new(seed),
            gt_dist: vec![0.0; N * N],
            gt_cost: vec![0; N * N],
            astar: AStar::new(),
            cells: Vec::new(),
            occ: vec![false; N * N],
        };
        w.rebuild_map();
        for &(x, z, speed) in WALKERS.iter().take(walkers.min(WALKERS.len())) {
            w.spawn(x, z, speed);
        }
        w
    }

    /// 静止物を地図に描き込み、距離とコストを作り直す
    fn rebuild_map(&mut self) {
        for i in 0..N * N {
            let (x, z) = grid::center_of(i);
            let mut hit = false;
            for p in &self.statics {
                if p.y0 > 1.8 {
                    continue; // 樹冠など、頭上にあるものは通行の邪魔にならない
                }
                hit |= match p.shape {
                    Shape::Wall { x: wx } => x < wx,
                    Shape::Box { x: bx, z: bz, hw, hd } => (x - bx).abs() <= hw && (z - bz).abs() <= hd,
                    Shape::Cyl { x: cx, z: cz, r } => (x - cx) * (x - cx) + (z - cz) * (z - cz) <= r * r,
                };
            }
            self.occ[i] = hit;
        }
        grid::distance_transform(&self.occ, &mut self.gt_dist, 4.0);
        for i in 0..N * N {
            let d = self.gt_dist[i];
            self.gt_cost[i] = if d < 0.45 {
                LETHAL
            } else if d < 1.2 {
                (160.0 * (1.2 - d) / 0.75) as u8
            } else {
                0
            };
        }
    }

    /// 静止物までの距離 [m]。地図の外は 0。
    pub fn clearance(&self, x: f32, z: f32) -> f32 {
        grid::cell_of(x, z).map_or(0.0, |c| self.gt_dist[c])
    }

    fn spawn(&mut self, x: f32, z: f32, speed: f32) {
        self.walkers.push(Walker {
            x,
            z,
            vx: 0.0,
            vz: 0.0,
            speed,
            goal: [x, z],
            path: Vec::new(),
            seg: 0,
            mark: [x, z],
            mark_t: 0.0,
            wait: 0.0,
        });
    }

    /// 歩行者を追加する。置けない場所なら false。
    pub fn add_walker(&mut self, x: f32, z: f32) -> bool {
        if self.walkers.len() >= MAX_WALKERS || self.clearance(x, z) < 0.5 || (x * x + z * z).sqrt() > 22.0 {
            return false;
        }
        if (x - self.ego.x).hypot(z - self.ego.z) < 0.9 {
            return false;
        }
        let speed = self.rng.range(0.9, 1.5);
        self.spawn(x, z, speed);
        true
    }

    /// 障害物（箱）を置く。置けない場所なら false。
    pub fn add_obstacle(&mut self, x: f32, z: f32) -> bool {
        const HALF: f32 = 0.6;
        if self.user_boxes >= MAX_USER_BOXES || (x * x + z * z).sqrt() > 22.0 || x < -16.0 {
            return false;
        }
        if (x - self.ego.x).hypot(z - self.ego.z) < 1.6 {
            return false;
        }
        if self.walkers.iter().any(|w| (x - w.x).hypot(z - w.z) < 1.3) {
            return false;
        }
        // 人より背を高くしておく。人と同じくらいの高さだと、一部だけ見えたときに
        // 大きさでは人と区別できず、ロボットが動くと「動く物体」に見えてしまう
        self.statics.push(Prim { shape: Shape::Box { x, z, hw: HALF, hd: HALF }, y0: 0.0, y1: 2.6, tag: 0 });
        self.user_boxes += 1;
        self.rebuild_map();
        for w in &mut self.walkers {
            w.path.clear(); // 経路を引き直させる
            w.wait = 0.0;
        }
        true
    }

    /// LiDAR に渡す物体の一覧（静止物 + 歩行者の体）
    pub fn collect_prims(&self, out: &mut Vec<Prim>) {
        out.clear();
        out.extend_from_slice(&self.statics);
        for (i, w) in self.walkers.iter().enumerate() {
            let tag = (i + 1) as u8;
            out.push(Prim { shape: Shape::Cyl { x: w.x, z: w.z, r: BODY_R }, y0: 0.0, y1: BODY_H, tag });
            out.push(Prim { shape: Shape::Cyl { x: w.x, z: w.z, r: HEAD_R }, y0: BODY_H, y1: HEAD_H, tag });
        }
    }

    /// 歩行者の次の目的地を選んで経路を引く
    fn plan_walker(&mut self, i: usize, keep_goal: bool) {
        let (x, z) = (self.walkers[i].x, self.walkers[i].z);
        let Some(start) = grid::cell_of(x, z).and_then(|c| grid::nearest_free(&self.gt_cost, c, LETHAL, 8)) else {
            return;
        };
        for attempt in 0..12 {
            let goal = if keep_goal && attempt == 0 {
                self.walkers[i].goal
            } else {
                let r = ROAM_R * self.rng.uniform().sqrt();
                let a = self.rng.range(0.0, core::f32::consts::TAU);
                [r * a.cos(), r * a.sin()]
            };
            let far_enough = (goal[0] - x).hypot(goal[1] - z) > 6.0 || (keep_goal && attempt == 0);
            let Some(gc) = grid::cell_of(goal[0], goal[1]) else { continue };
            if !far_enough || self.gt_cost[gc] != 0 {
                continue;
            }
            if self.astar.search(&self.gt_cost, start, gc, &mut self.cells) {
                let w = &mut self.walkers[i];
                grid::smooth(&self.cells, &self.gt_cost, (x, z), (goal[0], goal[1]), &mut w.path);
                w.goal = goal;
                w.seg = 0;
                w.mark = [x, z];
                w.mark_t = 0.0;
                return;
            }
        }
    }

    /// 歩行者を dt 秒進める
    fn step_walkers(&mut self, dt: f32) {
        for i in 0..self.walkers.len() {
            if self.walkers[i].path.len() < 2 {
                let w = &mut self.walkers[i];
                w.wait -= dt;
                if w.wait <= 0.0 {
                    // 経路だけが消されたとき（障害物が置かれたとき）は、同じ目的地へ引き直す
                    let keep = (w.goal[0] - w.x).hypot(w.goal[1] - w.z) > 1.0;
                    w.wait = 1.0; // 経路が見つからなかったときは、少し待ってから探し直す
                    self.plan_walker(i, keep);
                }
            }
            let (ex, ez) = (self.ego.x, self.ego.z);
            let others: Vec<(f32, f32)> =
                self.walkers.iter().enumerate().filter(|(j, _)| *j != i).map(|(_, o)| (o.x, o.z)).collect();
            let w = &mut self.walkers[i];
            if w.path.len() < 2 {
                w.vx *= 0.8;
                w.vz *= 0.8;
                continue;
            }

            // 経路上の少し先を目標にする
            while w.seg + 1 < w.path.len() - 1 && (w.path[w.seg + 1][0] - w.x).hypot(w.path[w.seg + 1][1] - w.z) < 0.9 {
                w.seg += 1;
            }
            let target = w.path[w.seg + 1];
            let (dx, dz) = (target[0] - w.x, target[1] - w.z);
            let d = dx.hypot(dz).max(1e-3);
            let mut wx = dx / d * w.speed;
            let mut wz = dz / d * w.speed;

            // ロボットや他の歩行者に近づきすぎたら離れる
            // 正面から向かい合うと止まってしまうので、横にずれる成分も足して回り込ませる
            let (hx, hz) = (dx / d, dz / d);
            let mut push = |ox: f32, oz: f32, reach: f32, gain: f32| {
                let (rx, rz) = (w.x - ox, w.z - oz);
                let r = rx.hypot(rz).max(1e-3);
                if r < reach {
                    let k = gain * (reach - r) / reach;
                    let (ux, uz) = (rx / r, rz / r);
                    let side = if ux * hz - uz * hx >= 0.0 { 1.0 } else { -1.0 };
                    wx += (ux - uz * side * 0.7) * k;
                    wz += (uz + ux * side * 0.7) * k;
                }
            };
            push(ex, ez, 1.9, 2.4);
            for (ox, oz) in others {
                push(ox, oz, 1.5, 2.0);
            }
            let s = wx.hypot(wz);
            let cap = w.speed * 1.25;
            if s > cap {
                wx *= cap / s;
                wz *= cap / s;
            }

            let k = (5.0 * dt).min(1.0);
            w.vx += (wx - w.vx) * k;
            w.vz += (wz - w.vz) * k;

            // 静止物にめり込まない（だめなら軸ごとに試す）
            let free = |x: f32, z: f32, dist: &Vec<f32>| grid::cell_of(x, z).map_or(false, |c| dist[c] >= 0.32);
            let (nx, nz) = (w.x + w.vx * dt, w.z + w.vz * dt);
            if free(nx, nz, &self.gt_dist) {
                w.x = nx;
                w.z = nz;
            } else if free(nx, w.z, &self.gt_dist) {
                w.x = nx;
                w.vz = 0.0;
            } else if free(w.x, nz, &self.gt_dist) {
                w.z = nz;
                w.vx = 0.0;
            } else {
                w.vx = 0.0;
                w.vz = 0.0;
            }

            // 到着したら次の目的地へ。進めなくなったときも選び直す
            w.mark_t += dt;
            let arrived = (w.goal[0] - w.x).hypot(w.goal[1] - w.z) < 0.7;
            let stuck = w.mark_t > 4.0 && (w.mark[0] - w.x).hypot(w.mark[1] - w.z) < 0.4;
            if w.mark_t > 4.0 {
                w.mark = [w.x, w.z];
                w.mark_t = 0.0;
            }
            if arrived || stuck {
                w.path.clear();
                w.goal = [w.x, w.z];
                w.wait = 0.0;
            }
        }
    }

    /// ロボットを速度指令 (v, w) で dt 秒進める
    fn step_ego(&mut self, dt: f32) {
        let e = &mut self.ego;
        e.yaw += e.w * dt;
        if e.yaw > core::f32::consts::PI {
            e.yaw -= core::f32::consts::TAU;
        } else if e.yaw < -core::f32::consts::PI {
            e.yaw += core::f32::consts::TAU;
        }
        let (nx, nz) = (e.x + e.v * e.yaw.cos() * dt, e.z + e.v * e.yaw.sin() * dt);
        let ok = grid::cell_of(nx, nz).map_or(false, |c| self.gt_dist[c] >= ROBOT_R);
        if ok {
            e.x = nx;
            e.z = nz;
        } else if e.v.abs() > 1e-3 {
            e.v = 0.0;
            self.collisions += 1;
        }
    }

    pub fn step(&mut self, dt: f32) {
        self.time += dt;
        self.step_walkers(dt);
        self.step_ego(dt);
    }
}
