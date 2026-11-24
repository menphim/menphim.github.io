//! 経路計画と障害物回避。
//! 点群から作った地図（静止物）と、追跡中の歩行者の予測位置からコストマップを作り、
//! A* で経路を引いて、その経路をなぞるようにロボットを動かす。
//! ロボット自身の位置と向きは分かっているものとする（自己位置推定は扱わない）。

use crate::cluster::BAND_LO;
use crate::grid::{self, AStar, Found, LETHAL, N};
use crate::ground::GROUND_TOL;
use crate::track::Track;
use crate::world::Ego;

pub const IDLE: u8 = 0;
pub const DRIVING: u8 = 1;
/// 歩行者が通り過ぎるのを待っている
pub const YIELDING: u8 = 2;
/// 経路が見つからない
pub const BLOCKED: u8 = 3;

const V_MAX: f32 = 1.4;
const W_MAX: f32 = 1.8;
const ACC: f32 = 1.2;
const DEC: f32 = 2.0;
/// これより障害物に近いセルは通らない [m]（ロボットの半径 + 余裕）
const HARD_R: f32 = 0.6;
/// これより近いセルはコストを上げて、できるだけ離れて通る [m]
const SOFT_R: f32 = 1.7;
/// 地図の「占有の確からしさ」。点が当たるたびに上げ、地面が見えたら下げる
const OCC_ON: u8 = 10;
const OCC_MAX: u8 = 40;
/// 経路計画の対象にする範囲（原点からの半径）[m]
const ARENA_R: f32 = 23.0;
/// 経路を引き直す間隔（スキャン数）
const REPLAN_EVERY: u32 = 3;
/// 進行方向のこの幅・この距離までに点があれば減速する [m]
const FRONT_HALF_WIDTH: f32 = 0.5;
const FRONT_RANGE: f32 = 2.5;
/// 前方の点に対して、ロボットの中心からこの距離を空けて止まる [m]
const FRONT_STOP: f32 = 0.8;

pub struct Planner {
    evidence: Vec<u8>,
    seen: Vec<u8>,
    occupied: Vec<bool>,
    dist: Vec<f32>,
    pub cost: Vec<u8>,
    astar: AStar,
    cells: Vec<usize>,
    pub path: Vec<[f32; 2]>,
    pub goal: Option<[f32; 2]>,
    pub state: u8,
    seg: usize,
    since_plan: u32,
    /// 進行方向にある最も近い点までの距離 [m]（最新のスキャンから）
    front_clear: f32,
    /// 目的地まで届かず、行けるところまでの経路になっているか
    partial: bool,
    /// コストマップを表示用に毎回作るか
    pub always_build: bool,
}

impl Default for Planner {
    fn default() -> Self {
        Self::new()
    }
}

fn active(t: &Track) -> bool {
    t.confirmed && t.moving && t.misses <= 10
}

impl Planner {
    pub fn new() -> Self {
        Planner {
            evidence: vec![0; N * N],
            seen: vec![0; N * N],
            occupied: vec![false; N * N],
            dist: vec![0.0; N * N],
            cost: vec![0; N * N],
            astar: AStar::new(),
            cells: Vec::new(),
            path: Vec::new(),
            goal: None,
            state: IDLE,
            seg: 0,
            since_plan: REPLAN_EVERY,
            front_clear: FRONT_RANGE,
            partial: false,
            always_build: false,
        }
    }

    pub fn set_goal(&mut self, x: f32, z: f32) -> bool {
        if x.hypot(z) > ARENA_R - 0.5 {
            return false;
        }
        self.goal = Some([x, z]);
        self.since_plan = REPLAN_EVERY; // 次のスキャンですぐに経路を引く
        self.state = DRIVING;
        true
    }

    pub fn clear_goal(&mut self) {
        self.goal = None;
        self.path.clear();
        self.state = IDLE;
    }

    /// 残りの経路の長さ [m]
    pub fn remaining(&self, ego: &Ego) -> f32 {
        if self.path.len() < 2 {
            return 0.0;
        }
        let mut prev = [ego.x, ego.z];
        let mut sum = 0.0;
        for p in &self.path[(self.seg + 1).min(self.path.len() - 1)..] {
            sum += (p[0] - prev[0]).hypot(p[1] - prev[1]);
            prev = *p;
        }
        sum
    }

    /// 1 スキャンぶんの点群で地図を更新する。
    /// 動いていると判断したクラスタの点は、地図には入れない。
    pub fn observe(&mut self, xyz: &[f32], height: &[f32], labels: &[u16], moving: &[bool], n: usize, ego: &Ego, scan: u32) {
        self.seen.iter_mut().for_each(|s| *s = 0);
        let (hx, hz) = (ego.yaw.cos(), ego.yaw.sin());
        self.front_clear = FRONT_RANGE;
        for i in 0..n {
            let Some(c) = grid::cell_of(xyz[i * 3], xyz[i * 3 + 2]) else { continue };
            let h = height[i];
            if h < GROUND_TOL {
                self.seen[c] |= 2;
            } else if h > BAND_LO && h < 2.0 {
                // 進行方向のすぐ前にある点（地図に載る前でも、これを見て止まる）
                let (px, pz) = (xyz[i * 3] - ego.x, xyz[i * 3 + 2] - ego.z);
                let (fwd, side) = (px * hx + pz * hz, pz * hx - px * hz);
                if fwd > 0.0 && fwd < self.front_clear && side.abs() < FRONT_HALF_WIDTH {
                    self.front_clear = fwd;
                }
                let l = labels[i] as usize;
                if l != 0 && moving[l - 1] {
                    continue;
                }
                self.seen[c] |= 1;
            }
        }
        let fade = scan % 4 == 0;
        for c in 0..N * N {
            let e = self.evidence[c];
            if self.seen[c] & 1 != 0 {
                self.evidence[c] = (e + 2).min(OCC_MAX);
            } else if e == 0 {
                continue;
            } else if self.seen[c] & 2 != 0 {
                self.evidence[c] = e.saturating_sub(3); // 地面が見えた = そこには何もない
            } else if fade {
                // 見えていないセルはゆっくり忘れる。ただしロボットのすぐ近くは
                // センサーの死角なので、覚えたままにする
                let (x, z) = grid::center_of(c);
                if (x - ego.x).hypot(z - ego.z) > 4.5 {
                    self.evidence[c] = e - 1;
                }
            }
        }
        self.since_plan += 1;
    }

    /// 必要なら経路を引き直す。引き直したら true
    pub fn update(&mut self, ego: &Ego, tracks: &[Track]) -> bool {
        if self.since_plan < REPLAN_EVERY || (self.goal.is_none() && !self.always_build) {
            return false;
        }
        self.since_plan = 0;
        self.build_cost(tracks);
        if self.goal.is_some() {
            self.plan(ego);
        }
        true
    }

    fn build_cost(&mut self, tracks: &[Track]) {
        for c in 0..N * N {
            self.occupied[c] = self.evidence[c] >= OCC_ON;
        }
        grid::distance_transform(&self.occupied, &mut self.dist, 3.0);
        for c in 0..N * N {
            let d = self.dist[c];
            let (x, z) = grid::center_of(c);
            self.cost[c] = if d < HARD_R || x * x + z * z > ARENA_R * ARENA_R {
                LETHAL
            } else if d < SOFT_R {
                let t = (SOFT_R - d) / (SOFT_R - HARD_R);
                (200.0 * t * t) as u8
            } else {
                0
            };
        }

        // 歩行者: いまの位置は通れない。2 秒先までの予測位置にもコストを置き、進路を空けて通る
        for t in tracks.iter().filter(|t| active(t)) {
            let (px, pz) = t.pos();
            let (vx, vz) = t.vel();
            for k in 0..5 {
                let tau = 0.5 * k as f32;
                let core = if k == 0 { 0.7 } else { 0.0 };
                let soft = 1.35 - 0.12 * k as f32;
                let peak = 210.0 - 35.0 * k as f32;
                self.stamp(px + vx * tau, pz + vz * tau, core, soft, peak);
            }
        }
    }

    fn stamp(&mut self, x: f32, z: f32, core: f32, soft: f32, peak: f32) {
        let r = (soft / grid::CELL).ceil() as i32;
        let Some(c0) = grid::cell_of(x, z) else { return };
        let (cx, cz) = ((c0 % N) as i32, (c0 / N) as i32);
        for dz in -r..=r {
            for dx in -r..=r {
                let (ix, iz) = (cx + dx, cz + dz);
                if ix < 0 || iz < 0 || ix >= N as i32 || iz >= N as i32 {
                    continue;
                }
                let c = iz as usize * N + ix as usize;
                let (wx, wz) = grid::center_of(c);
                let d = (wx - x).hypot(wz - z);
                let v = if d < core {
                    LETHAL
                } else if d < soft {
                    (peak * (1.0 - (d - core) / (soft - core))) as u8
                } else {
                    continue;
                };
                if v > self.cost[c] {
                    self.cost[c] = v;
                }
            }
        }
    }

    fn plan(&mut self, ego: &Ego) {
        let Some(goal) = self.goal else { return };
        let start = grid::cell_of(ego.x, ego.z).and_then(|c| grid::nearest_free(&self.cost, c, LETHAL, 8));
        let (Some(start), Some(target)) = (start, grid::cell_of(goal[0], goal[1])) else {
            self.path.clear();
            self.state = BLOCKED;
            return;
        };
        // 目的地が通れない場所や、囲まれて届かない場所なら、行けるところまでの経路にする
        let found = self.astar.search_near(&self.cost, start, target, true, &mut self.cells);
        if found == Found::None {
            self.path.clear();
            self.state = BLOCKED;
            return;
        }
        self.partial = found == Found::Partial;
        let end = if self.partial { grid::center_of(self.cells[self.cells.len() - 1]) } else { (goal[0], goal[1]) };
        grid::smooth(&self.cells, &self.cost, (ego.x, ego.z), end, &mut self.path);
        self.seg = 0;
        if self.state == BLOCKED {
            self.state = DRIVING;
        }
    }

    /// 経路をなぞる速度指令を作り、`ego` の速度に反映する。
    /// `scan_age` は最後のスキャンからの経過時間（追跡の位置をいまの時刻に進めるため）
    pub fn control(&mut self, ego: &mut Ego, tracks: &[Track], dt: f32, scan_age: f32) {
        let (mut v_des, mut w_des) = (0.0f32, 0.0f32);

        if let (Some(goal), true) = (self.goal, self.path.len() >= 2) {
            let end = self.path[self.path.len() - 1];
            let to_goal = (end[0] - ego.x).hypot(end[1] - ego.z);
            // 目的地に届かない経路の終点に着いたとき、目的地をふさいでいるのが歩行者だけなら
            // 通り過ぎるのを待つ。静止物なら、そこで終わりにする
            let goal_static = grid::cell_of(goal[0], goal[1]).map_or(true, |c| self.dist[c] < HARD_R + 0.3);
            let waiting = self.partial && !goal_static && (end[0] - goal[0]).hypot(end[1] - goal[1]) < 2.0;
            if to_goal < 0.3 && !waiting {
                self.clear_goal();
            } else if to_goal < 0.3 {
                self.state = YIELDING;
            } else {
                // 経路上で、ロボットから一定の距離だけ先の点を目標にする
                let look = 0.9 + 0.4 * ego.v.abs();
                let last = self.path.len() - 1;
                while self.seg + 1 < last && (self.path[self.seg + 1][0] - ego.x).hypot(self.path[self.seg + 1][1] - ego.z) < look {
                    self.seg += 1;
                }
                let target = self.path[self.seg + 1];
                let mut alpha = (target[1] - ego.z).atan2(target[0] - ego.x) - ego.yaw;
                while alpha > core::f32::consts::PI {
                    alpha -= core::f32::consts::TAU;
                }
                while alpha < -core::f32::consts::PI {
                    alpha += core::f32::consts::TAU;
                }

                if alpha.abs() > 1.0 {
                    w_des = alpha.signum() * W_MAX * 0.9; // 向きが大きくずれているときは、その場で回る
                } else {
                    v_des = V_MAX * (1.0 - 0.6 * alpha.abs());
                    w_des = (2.4 * alpha).clamp(-W_MAX, W_MAX);
                }
                v_des = v_des.min((2.0 * 0.8 * to_goal).sqrt()); // 目的地の手前で減速する
                if let Some(c) = grid::cell_of(ego.x, ego.z) {
                    v_des *= 1.0 - 0.5 * self.cost[c].min(254) as f32 / 254.0; // 障害物の近くではゆっくり
                }
                // すぐ前に点があれば、その手前で止まれる速さまで落とす
                v_des = v_des.min((2.0 * DEC * 0.6 * (self.front_clear - FRONT_STOP).max(0.0)).sqrt());

                // 歩行者とぶつかりそうなら、止まって通り過ぎるのを待つ
                self.state = DRIVING;
                let (hx, hz) = (ego.yaw.cos(), ego.yaw.sin());
                for t in tracks.iter().filter(|t| active(t)) {
                    let (tx, tz) = t.pos();
                    let (tvx, tvz) = t.vel();
                    let (px, pz) = (tx + tvx * scan_age - ego.x, tz + tvz * scan_age - ego.z);
                    let dist = px.hypot(pz);
                    if dist > 4.0 {
                        continue;
                    }
                    let (ux, uz) = (tvx - ego.v * hx, tvz - ego.v * hz);
                    let uu = ux * ux + uz * uz;
                    let tc = if uu > 1e-4 { (-(px * ux + pz * uz) / uu).clamp(0.0, 2.0) } else { 0.0 };
                    let closest = (px + ux * tc).hypot(pz + uz * tc);
                    let ahead = px * hx + pz * hz > -0.2;
                    if dist < 0.9 || (closest < 0.85 && ahead) {
                        v_des = 0.0;
                        self.state = YIELDING;
                    } else if closest < 1.3 && ahead {
                        v_des = v_des.min(0.5);
                    }
                }
            }
        }

        ego.v += (v_des - ego.v).clamp(-DEC * dt, ACC * dt);
        ego.w += (w_des - ego.w).clamp(-6.0 * dt, 6.0 * dt);
    }
}
