//! menphim.github.io のヒーロー画面で動かしている、認識・追跡・経路計画の処理。
//!
//! 入力はシミュレーションした LiDAR の点群（world.rs と lidar.rs）。そこから先は、
//! 点群だけを見て次の順に処理する。
//!
//!   1. ground.rs  : 地面の推定（RANSAC による平面の当てはめ）
//!   2. cluster.rs : クラスタリング（上から見たグリッドの連結成分）
//!   3. track.rs   : 追跡（カルマンフィルタ + ハンガリアン法）
//!   4. plan.rs    : 経路計画と障害物回避（コストマップ + A*）
//!
//! WebAssembly にして、ブラウザの JavaScript（hero-fx.js）から呼び出す。
//! 説明用に書いたもので、実機で使うための作り込み（センサーの較正、自己位置推定、
//! 学習済みの検出器など）は入っていない。

pub mod cluster;
pub mod grid;
pub mod ground;
pub mod lidar;
pub mod plan;
pub mod rng;
pub mod track;
pub mod world;

use cluster::Clusterer;
use ground::{GroundFilter, GROUND_TOL};
use lidar::{Lidar, Scan};
use plan::Planner;
use rng::Rng;
use track::{Detection, Tracker, TRAIL};
use world::{Prim, World};

/// LiDAR の周期 [s]（10 Hz）
pub const SCAN_DT: f32 = 0.1;
/// 点 1 個ぶんの出力: x, y, z, 種類, 色分け用の番号
pub const POINT_STRIDE: usize = 5;
/// 追跡 1 個ぶんの出力
pub const TRACK_STRIDE: usize = 12;
pub const MAX_OUT_TRACKS: usize = 32;
pub const MAX_PATH: usize = 256;
pub const STATE_LEN: usize = 32;

/// 点の種類
pub const CLASS_GROUND: f32 = 0.0;
pub const CLASS_STATIC: f32 = 1.0;
pub const CLASS_PERSON_LIKE: f32 = 2.0;
pub const CLASS_MOVING: f32 = 3.0;

pub struct Sim {
    pub world: World,
    pub lidar: Lidar,
    pub scan: Scan,
    pub height: Vec<f32>,
    pub ground: GroundFilter,
    pub clusterer: Clusterer,
    pub tracker: Tracker,
    pub planner: Planner,
    prims: Vec<Prim>,
    dets: Vec<Detection>,
    cluster_moving: Vec<bool>,
    rng: Rng,
    acc: f32,
    pub scan_index: u32,
    /// 最後のスキャンからの経過時間 [s]
    pub scan_age: f32,
    /// 各処理の所要時間 [ms]（移動平均）: LiDAR, 地面, クラスタ, 追跡, 経路, 合計
    pub ms: [f32; 6],
    params: (u32, usize, usize, usize),
    out_points: Vec<f32>,
    out_tracks: Vec<f32>,
    out_tracks_n: usize,
    out_trails: Vec<f32>,
    out_path: Vec<f32>,
    out_path_n: usize,
    out_state: [f32; STATE_LEN],
}

impl Sim {
    pub fn new(seed: u32, beams: usize, steps: usize, walkers: usize) -> Self {
        let beams = beams.clamp(8, 128);
        let steps = steps.clamp(90, 2400);
        let lidar = Lidar::new(beams, steps);
        let max_points = lidar.rays();
        Sim {
            world: World::new(seed, walkers),
            lidar,
            scan: Scan::with_capacity(max_points),
            height: vec![0.0; max_points],
            ground: GroundFilter::new(),
            clusterer: Clusterer::new(max_points, 37.0f32.to_radians() / (beams - 1) as f32),
            tracker: Tracker::new(),
            planner: Planner::new(),
            prims: Vec::with_capacity(64),
            dets: Vec::with_capacity(64),
            cluster_moving: Vec::with_capacity(256),
            rng: Rng::new(seed ^ 0x5EED_1234),
            acc: 0.0,
            scan_index: 0,
            scan_age: 0.0,
            ms: [0.0; 6],
            params: (seed, beams, steps, walkers),
            out_points: vec![0.0; max_points * POINT_STRIDE],
            out_tracks: vec![0.0; MAX_OUT_TRACKS * TRACK_STRIDE],
            out_tracks_n: 0,
            out_trails: vec![0.0; MAX_OUT_TRACKS * TRAIL * 2],
            out_path: vec![0.0; MAX_PATH * 2],
            out_path_n: 0,
            out_state: [0.0; STATE_LEN],
        }
    }

    /// dt 秒進める。新しいスキャンを処理したら true
    pub fn tick(&mut self, dt: f32) -> bool {
        let dt = dt.clamp(0.0, 0.05);
        self.planner.control(&mut self.world.ego, &self.tracker.tracks, dt, self.scan_age);
        self.world.step(dt);
        self.acc += dt;
        self.scan_age += dt;
        let scanned = self.acc >= SCAN_DT;
        if scanned {
            self.acc = (self.acc - SCAN_DT).min(SCAN_DT);
            self.run_scan();
        }
        self.write_state();
        scanned
    }

    fn run_scan(&mut self) {
        let (ex, ez, yaw) = (self.world.ego.x, self.world.ego.z, self.world.ego.yaw);
        let t0 = clock();

        // LiDAR の計測
        self.world.collect_prims(&mut self.prims);
        self.lidar.scan(&self.prims, ex, ez, yaw, &mut self.rng, &mut self.scan);
        let n = self.scan.n;
        let t1 = clock();

        // 1. 地面の推定
        self.ground.run(&self.scan.xyz, n, &mut self.rng, &mut self.height);
        let t2 = clock();

        // 2. クラスタリング
        self.clusterer.run(&self.scan.xyz, &self.height, n, ex, ez);
        let t3 = clock();

        // 3. 追跡（人に近い大きさのクラスタだけを検出として渡す）
        self.dets.clear();
        for (i, c) in self.clusterer.clusters.iter().enumerate() {
            if c.person_like {
                self.dets.push(Detection { x: c.x, z: c.z, width: c.width, top: c.top, cluster: i });
            }
        }
        self.tracker.step(&self.dets, SCAN_DT, (ex, ez), self.lidar.max_range);
        let t4 = clock();

        // 4. 地図の更新と経路計画
        self.cluster_moving.clear();
        self.cluster_moving.resize(self.clusterer.clusters.len(), false);
        for t in &self.tracker.tracks {
            if t.confirmed && t.moving && t.cluster != usize::MAX {
                self.cluster_moving[t.cluster] = true;
            }
        }
        self.planner.observe(
            &self.scan.xyz,
            &self.height,
            &self.clusterer.labels,
            &self.cluster_moving,
            n,
            &self.world.ego,
            self.scan_index,
        );
        self.planner.update(&self.world.ego, &self.tracker.tracks);
        let t5 = clock();

        let stages = [t1 - t0, t2 - t1, t3 - t2, t4 - t3, t5 - t4, t5 - t0];
        for (avg, &now) in self.ms.iter_mut().zip(&stages) {
            let now = now as f32;
            *avg = if self.scan_index == 0 { now } else { *avg + (now - *avg) * 0.05 };
        }

        self.scan_index += 1;
        self.scan_age = 0.0;
        self.write_scan();
    }

    /// 描画用に、点群・追跡・経路を書き出す
    fn write_scan(&mut self) {
        let n = self.scan.n;
        for i in 0..n {
            let o = i * POINT_STRIDE;
            self.out_points[o..o + 3].copy_from_slice(&self.scan.xyz[i * 3..i * 3 + 3]);
            let label = self.clusterer.labels[i] as usize;
            let (class, key) = if self.height[i] < GROUND_TOL {
                (CLASS_GROUND, 0.0)
            } else if label == 0 {
                (CLASS_STATIC, 0.0)
            } else {
                let c = &self.clusterer.clusters[label - 1];
                // 色分け用の番号。スキャンごとに色が変わらないよう、位置から決める
                let (qx, qz) = ((c.x / 1.5).round() as i32, (c.z / 1.5).round() as i32);
                let key = ((qx.wrapping_mul(73_856_093) ^ qz.wrapping_mul(19_349_663)) & 0x3FF) as f32 + 1.0;
                if self.cluster_moving[label - 1] {
                    (CLASS_MOVING, key)
                } else if c.person_like {
                    (CLASS_PERSON_LIKE, key)
                } else {
                    (CLASS_STATIC, key)
                }
            };
            self.out_points[o + 3] = class;
            self.out_points[o + 4] = key;
        }

        let mut k = 0;
        for t in &self.tracker.tracks {
            if !(t.confirmed && t.moving) || k >= MAX_OUT_TRACKS {
                continue;
            }
            let (x, z) = t.pos();
            let (vx, vz) = t.vel();
            let o = k * TRACK_STRIDE;
            self.out_tracks[o..o + TRACK_STRIDE].copy_from_slice(&[
                t.id as f32,
                if t.misses > 0 { 1.0 } else { 0.0 },
                x,
                z,
                vx,
                vz,
                t.width,
                t.top,
                t.misses as f32,
                t.age as f32,
                t.trail_len as f32,
                t.speed_avg,
            ]);
            for j in 0..TRAIL {
                let p = t.trail_at(j.min(t.trail_len.saturating_sub(1)));
                let q = (k * TRAIL + j) * 2;
                self.out_trails[q] = p[0];
                self.out_trails[q + 1] = p[1];
            }
            k += 1;
        }
        self.out_tracks_n = k;

        // 経路は長いときに間引く
        let path = &self.planner.path;
        let step = (path.len() / MAX_PATH + 1).max(1);
        let mut m = 0;
        let mut i = 0;
        while i < path.len() && m < MAX_PATH - 1 {
            self.out_path[m * 2] = path[i][0];
            self.out_path[m * 2 + 1] = path[i][1];
            m += 1;
            i += step;
        }
        if let (Some(last), true) = (path.last(), path.len() > 1) {
            self.out_path[(m - 1) * 2] = last[0];
            self.out_path[(m - 1) * 2 + 1] = last[1];
        }
        self.out_path_n = if path.len() > 1 { m } else { 0 };
    }

    fn write_state(&mut self) {
        let e = &self.world.ego;
        let goal = self.planner.goal.unwrap_or([0.0, 0.0]);
        let s = &mut self.out_state;
        s[0] = e.x;
        s[1] = e.z;
        s[2] = e.yaw;
        s[3] = e.v;
        s[4] = self.planner.state as f32;
        s[5] = goal[0];
        s[6] = goal[1];
        s[7] = if self.planner.goal.is_some() { 1.0 } else { 0.0 };
        s[8] = self.lidar.rays() as f32;
        s[9] = self.scan.n as f32;
        s[10] = self.ground.ground_points as f32;
        s[11] = self.clusterer.clusters.len() as f32;
        s[12] = self.dets.len() as f32;
        s[13] = self.out_tracks_n as f32;
        s[14] = self.planner.remaining(e);
        s[15] = self.scan_index as f32;
        s[16..22].copy_from_slice(&self.ms);
        s[22] = self.world.time;
        s[23] = self.world.walkers.len() as f32;
        s[24] = self.scan_age;
        s[25] = self.out_path_n as f32;
        s[26] = self.world.collisions as f32;
    }
}

// ---------------------------------------------------------------------------
// 時計。処理ごとの所要時間を測るために使う（ブラウザでは performance.now()）
// ---------------------------------------------------------------------------
#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
extern "C" {
    fn now() -> f64;
}

#[cfg(target_arch = "wasm32")]
fn clock() -> f64 {
    unsafe { now() }
}

#[cfg(not(target_arch = "wasm32"))]
fn clock() -> f64 {
    use std::sync::OnceLock;
    use std::time::Instant;
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
}

// ---------------------------------------------------------------------------
// JavaScript から呼ぶ関数
// ---------------------------------------------------------------------------
struct Global(core::cell::UnsafeCell<Option<Sim>>);
// WebAssembly の中は単一スレッドで動く
unsafe impl Sync for Global {}
static SIM: Global = Global(core::cell::UnsafeCell::new(None));

fn sim() -> &'static mut Sim {
    unsafe { (*SIM.0.get()).get_or_insert_with(|| Sim::new(1, 56, 1300, 5)) }
}

#[no_mangle]
pub extern "C" fn init(seed: u32, beams: u32, steps: u32, walkers: u32) {
    unsafe { *SIM.0.get() = Some(Sim::new(seed, beams as usize, steps as usize, walkers as usize)) }
}

/// 最初の状態に戻す
#[no_mangle]
pub extern "C" fn reset() {
    let (seed, beams, steps, walkers) = sim().params;
    let viz = sim().planner.always_build;
    unsafe { *SIM.0.get() = Some(Sim::new(seed, beams, steps, walkers)) }
    sim().planner.always_build = viz;
}

#[no_mangle]
pub extern "C" fn tick(dt: f32) -> u32 {
    sim().tick(dt) as u32
}

#[no_mangle]
pub extern "C" fn set_goal(x: f32, z: f32) -> u32 {
    sim().planner.set_goal(x, z) as u32
}

#[no_mangle]
pub extern "C" fn clear_goal() {
    sim().planner.clear_goal()
}

#[no_mangle]
pub extern "C" fn add_walker(x: f32, z: f32) -> u32 {
    sim().world.add_walker(x, z) as u32
}

#[no_mangle]
pub extern "C" fn add_obstacle(x: f32, z: f32) -> u32 {
    sim().world.add_obstacle(x, z) as u32
}

/// コストマップを表示用に作り続けるか
#[no_mangle]
pub extern "C" fn show_costmap(on: u32) {
    sim().planner.always_build = on != 0;
}

#[no_mangle]
pub extern "C" fn points_ptr() -> *const f32 {
    sim().out_points.as_ptr()
}

#[no_mangle]
pub extern "C" fn point_count() -> u32 {
    sim().scan.n as u32
}

#[no_mangle]
pub extern "C" fn tracks_ptr() -> *const f32 {
    sim().out_tracks.as_ptr()
}

#[no_mangle]
pub extern "C" fn track_count() -> u32 {
    sim().out_tracks_n as u32
}

#[no_mangle]
pub extern "C" fn trails_ptr() -> *const f32 {
    sim().out_trails.as_ptr()
}

#[no_mangle]
pub extern "C" fn path_ptr() -> *const f32 {
    sim().out_path.as_ptr()
}

#[no_mangle]
pub extern "C" fn state_ptr() -> *const f32 {
    sim().out_state.as_ptr()
}

#[no_mangle]
pub extern "C" fn costmap_ptr() -> *const u8 {
    sim().planner.cost.as_ptr()
}

/// コストマップの 1 辺のセル数
#[no_mangle]
pub extern "C" fn costmap_size() -> u32 {
    grid::N as u32
}
