//! シミュレーターの正解と見比べて、認識・追跡・経路計画が働いているかを確かめる。
//! 数値は `cargo test --release -- --nocapture` で表示される。

use perception::grid;
use perception::ground::GroundFilter;
use perception::rng::Rng;
use perception::track::{Detection, Hungarian, Tracker};
use perception::Sim;

/// 全通りを試して最小コストを求める（ハンガリアン法の答え合わせ用）
fn brute(cost: &[f32], rows: usize, cols: usize, r: usize, used: &mut Vec<bool>) -> f32 {
    if r == rows {
        return 0.0;
    }
    let mut best = f32::INFINITY;
    for c in 0..cols {
        if !used[c] {
            used[c] = true;
            best = best.min(cost[r * cols + c] + brute(cost, rows, cols, r + 1, used));
            used[c] = false;
        }
    }
    best
}

#[test]
fn hungarian_matches_brute_force() {
    let mut rng = Rng::new(7);
    let mut h = Hungarian::default();
    let mut assign = Vec::new();
    for case in 0..300 {
        let rows = 1 + case % 5;
        let cols = rows + case % 3;
        let cost: Vec<f32> = (0..rows * cols).map(|_| rng.range(0.0, 10.0)).collect();
        h.solve(&cost, rows, cols, &mut assign);
        let total: f32 = (0..rows).map(|r| cost[r * cols + assign[r]]).sum();
        let mut seen = vec![false; cols];
        for &c in &assign {
            assert!(!seen[c], "column used twice");
            seen[c] = true;
        }
        let want = brute(&cost, rows, cols, 0, &mut vec![false; cols]);
        assert!((total - want).abs() < 1e-3, "case {case}: {total} vs {want}");
    }
    // 行のほうが多い場合
    let cost = [1.0, 9.0, 9.0, 2.0, 0.5, 9.0];
    h.solve(&cost, 3, 2, &mut assign);
    assert_eq!(assign.iter().filter(|&&c| c != usize::MAX).count(), 2);
}

#[test]
fn ground_plane_is_recovered() {
    let mut rng = Rng::new(3);
    let mut xyz = Vec::new();
    // 傾いた地面（6 割）と、その上の物体（4 割）
    for i in 0..5000 {
        let (x, z) = (rng.range(-30.0, 30.0), rng.range(-30.0, 30.0));
        let ground = 0.03 * x - 0.02 * z + 0.1;
        let y = if i % 5 < 3 { ground + 0.02 * rng.noise() } else { ground + rng.range(0.3, 4.0) };
        xyz.extend_from_slice(&[x, y, z]);
    }
    let mut height = vec![0.0; 5000];
    let mut filter = GroundFilter::new();
    filter.run(&xyz, 5000, &mut rng, &mut height);
    let p = filter.plane;
    assert!((p.a - 0.03).abs() < 0.003 && (p.b + 0.02).abs() < 0.003 && (p.c - 0.1).abs() < 0.03, "{} {} {}", p.a, p.b, p.c);
    assert!((filter.ground_points as i32 - 3000).abs() < 60, "{}", filter.ground_points);
}

#[test]
fn kalman_follows_two_crossing_targets() {
    let mut tracker = Tracker::new();
    let mut rng = Rng::new(11);
    for k in 0..120 {
        let t = k as f32 * 0.1;
        // 2 人が直角に交差する（同時に同じ場所は通らない）
        let a = (-6.0 + 1.2 * t, 0.4);
        let b = (1.5, -8.0 + 1.0 * t);
        let dets: Vec<Detection> = [a, b]
            .iter()
            .enumerate()
            .map(|(i, p)| Detection { x: p.0 + 0.05 * rng.noise(), z: p.1 + 0.05 * rng.noise(), width: 0.5, top: 1.7, cluster: i })
            .collect();
        tracker.step(&dets, 0.1, (0.0, 0.0), 46.0);
    }
    let moving: Vec<_> = tracker.tracks.iter().filter(|t| t.confirmed && t.moving).collect();
    assert_eq!(moving.len(), 2);
    let ids: Vec<u32> = moving.iter().map(|t| t.id).collect();
    assert!(ids.contains(&1) && ids.contains(&2), "ids changed: {ids:?}");
    for t in moving {
        let (vx, vz) = t.vel();
        let ok = ((vx - 1.2).abs() < 0.15 && vz.abs() < 0.15) || (vx.abs() < 0.15 && (vz - 1.0).abs() < 0.15);
        assert!(ok, "velocity {vx} {vz}");
    }
}

#[test]
fn astar_goes_around_a_wall() {
    let mut cost = vec![0u8; grid::N * grid::N];
    // x = 0 に、z = -5..5 の壁
    for c in 0..grid::N * grid::N {
        let (x, z) = grid::center_of(c);
        if x.abs() < 0.3 && z.abs() < 5.0 {
            cost[c] = grid::LETHAL;
        }
    }
    let mut astar = grid::AStar::new();
    let mut cells = Vec::new();
    let (s, g) = (grid::cell_of(-4.0, 0.0).unwrap(), grid::cell_of(4.0, 0.0).unwrap());
    assert!(astar.search(&cost, s, g, &mut cells));
    assert!(cells.iter().all(|&c| cost[c] != grid::LETHAL));
    let len: f32 = cells.windows(2).map(|w| {
        let (a, b) = (grid::center_of(w[0]), grid::center_of(w[1]));
        (a.0 - b.0).hypot(a.1 - b.1)
    }).sum();
    // 最短は 壁の端を回る 2 * sqrt(4^2 + 5^2) ≒ 12.8 m。8 方向移動なので少し長くなる
    assert!(len > 12.5 && len < 14.5, "{len}");
}

struct Score {
    frames: u32,
    visible: u32,
    matched: u32,
    false_tracks: u32,
    /// 歩行者どうしが最も近づいたときの距離
    closest_pair: f32,
    sq_err: f64,
    ids: std::collections::BTreeSet<u32>,
    switches: u32,
}

/// 正解の歩行者と、追跡の出力を 1 スキャンぶん見比べる
fn score_scan(sim: &Sim, last_id: &mut Vec<u32>, s: &mut Score) {
    let verbose = std::env::var("VERBOSE").is_ok();
    let tracks: Vec<_> = sim.tracker.tracks.iter().filter(|t| t.confirmed && t.moving).collect();
    let mut points = vec![0u32; sim.world.walkers.len() + 1];
    for i in 0..sim.scan.n {
        points[sim.scan.tag[i] as usize] += 1;
    }
    s.frames += 1;
    last_id.resize(sim.world.walkers.len(), 0);
    for (i, a) in sim.world.walkers.iter().enumerate() {
        for b in &sim.world.walkers[i + 1..] {
            s.closest_pair = s.closest_pair.min((a.x - b.x).hypot(a.z - b.z));
        }
    }
    for (wi, w) in sim.world.walkers.iter().enumerate() {
        if points[wi + 1] < 8 {
            continue; // 物陰に入っていて、ほとんど点が当たっていない
        }
        s.visible += 1;
        let best = tracks.iter().map(|t| {
            let (x, z) = t.pos();
            ((x - w.x).hypot(z - w.z), t.id)
        }).min_by(|a, b| a.0.total_cmp(&b.0));
        if let Some((d, id)) = best {
            if d < 0.5 {
                s.matched += 1;
                s.sq_err += (d * d) as f64;
                if last_id[wi] != 0 && last_id[wi] != id {
                    s.switches += 1;
                    if verbose {
                        let other = sim.world.walkers.iter().enumerate().filter(|(j, _)| *j != wi).map(|(_, o)| (o.x - w.x).hypot(o.z - w.z)).fold(f32::INFINITY, f32::min);
                        println!(
                            "  t={:.1} walker {wi} id {} -> {id}: nearest walker {:.2} m, static {:.2} m, robot {:.2} m, {} pts",
                            sim.world.time, last_id[wi], other, sim.world.clearance(w.x, w.z), (w.x - sim.world.ego.x).hypot(w.z - sim.world.ego.z), points[wi + 1]
                        );
                    }
                }
                last_id[wi] = id;
            }
        }
    }
    for t in &tracks {
        s.ids.insert(t.id);
        let (x, z) = t.pos();
        if t.misses == 0 && !sim.world.walkers.iter().any(|w| (x - w.x).hypot(z - w.z) < 1.0) {
            s.false_tracks += 1;
        }
    }
}

fn run_tracking(beams: usize, steps: usize, walkers: usize, seconds: f32) -> Score {
    let mut sim = Sim::new(20261124, beams, steps, walkers);
    let mut s = Score { frames: 0, visible: 0, matched: 0, false_tracks: 0, closest_pair: f32::INFINITY, sq_err: 0.0, ids: Default::default(), switches: 0 };
    let mut last_id = Vec::new();
    for _ in 0..(seconds * 60.0) as usize {
        if sim.tick(1.0 / 60.0) {
            score_scan(&sim, &mut last_id, &mut s);
        }
    }
    let recall = s.matched as f32 / s.visible.max(1) as f32;
    let rmse = (s.sq_err / s.matched.max(1) as f64).sqrt();
    println!(
        "tracking {beams}x{steps}, {walkers} walkers, {seconds} s: recall {:.3} ({} / {}), rmse {:.3} m, false tracks {} in {} scans, ids used {}, id switches {}, closest pair {:.2} m, {} pts, ms {:?}",
        recall, s.matched, s.visible, rmse, s.false_tracks, s.frames, s.ids.len(), s.switches, s.closest_pair, sim.scan.n, sim.ms
    );
    s
}

#[test]
fn pedestrians_are_tracked_desktop() {
    let s = run_tracking(56, 1300, 5, 120.0);
    assert!(s.matched as f32 / s.visible as f32 > 0.9);
    assert!((s.sq_err / s.matched as f64).sqrt() < 0.2);
    assert!((s.false_tracks as f32) < 0.02 * s.frames as f32);
}

#[test]
fn pedestrians_are_tracked_mobile() {
    let s = run_tracking(30, 640, 3, 120.0);
    assert!(s.matched as f32 / s.visible as f32 > 0.85);
    assert!((s.false_tracks as f32) < 0.02 * s.frames as f32);
}

#[test]
fn robot_reaches_goals_without_collision() {
    let mut sim = Sim::new(20261124, 56, 1300, 5);
    let goals = [(12.0, -4.0), (-9.0, 6.0), (4.0, 16.0), (-12.0, -14.0), (16.0, 13.0), (0.0, 0.0)];
    let mut min_gap = f32::INFINITY;
    let mut min_clearance = f32::INFINITY;
    for (gx, gz) in goals {
        assert!(sim.planner.set_goal(gx, gz));
        let mut t = 0.0;
        while sim.planner.goal.is_some() && t < 90.0 {
            sim.tick(1.0 / 60.0);
            t += 1.0 / 60.0;
            let e = &sim.world.ego;
            for w in &sim.world.walkers {
                min_gap = min_gap.min((w.x - e.x).hypot(w.z - e.z));
            }
            min_clearance = min_clearance.min(sim.world.clearance(e.x, e.z));
        }
        let e = &sim.world.ego;
        println!("goal ({gx}, {gz}): {:.1} s, robot at ({:.2}, {:.2}), state {}", t, e.x, e.z, sim.planner.state);
        assert!(sim.planner.goal.is_none(), "did not reach ({gx}, {gz}) in time");
    }
    println!("min distance to a pedestrian {:.2} m, min clearance to static objects {:.2} m, collisions {}", min_gap, min_clearance, sim.world.collisions);
    assert_eq!(sim.world.collisions, 0);
    assert!(min_gap > 0.55, "robot got too close to a pedestrian: {min_gap}");
}

#[test]
fn robot_avoids_obstacles_added_later() {
    let mut sim = Sim::new(5, 56, 1300, 5);
    // 目的地までの直線上に、箱を並べてふさぐ（歩行者がいて置けないときは、通り過ぎるのを待つ）
    for z in [-2.4, -1.2, 0.0, 1.2, 2.4] {
        let mut tries = 0;
        while !sim.world.add_obstacle(6.0, z) {
            for _ in 0..30 {
                sim.tick(1.0 / 60.0);
            }
            tries += 1;
            assert!(tries < 100);
        }
    }
    assert!(sim.planner.set_goal(12.0, 0.0));
    let (mut t, mut widest) = (0.0, 0.0f32);
    while sim.planner.goal.is_some() && t < 90.0 {
        sim.tick(1.0 / 60.0);
        t += 1.0 / 60.0;
        widest = widest.max(sim.world.ego.z.abs());
    }
    println!("blocked route: reached in {:.1} s, went {:.1} m sideways, collisions {}", t, widest, sim.world.collisions);
    assert!(sim.planner.goal.is_none());
    assert!(widest > 3.0, "the robot should have gone around the boxes");
    assert_eq!(sim.world.collisions, 0);
}

#[test]
fn robot_stops_for_a_box_dropped_in_front() {
    let mut sim = Sim::new(9, 56, 1300, 0);
    assert!(sim.planner.set_goal(14.0, 0.0));
    // 走り出して速度が乗ったところで、すぐ前に箱を置く
    while sim.world.ego.v < 1.3 || sim.world.ego.x < 2.0 {
        sim.tick(1.0 / 60.0);
    }
    let e = &sim.world.ego;
    let (bx, bz) = (e.x + 1.7 * e.yaw.cos(), e.z + 1.7 * e.yaw.sin());
    assert!(sim.world.add_obstacle(bx, bz));
    let mut t = 0.0;
    while sim.planner.goal.is_some() && t < 60.0 {
        sim.tick(1.0 / 60.0);
        t += 1.0 / 60.0;
    }
    println!("box dropped 1.7 m ahead at 1.3 m/s: reached in {:.1} s, collisions {}", t, sim.world.collisions);
    assert!(sim.planner.goal.is_none());
    assert_eq!(sim.world.collisions, 0);
}

/// 操作モードを想定して、歩行者・障害物・目的地をでたらめに足し続ける。
/// 異常終了しないこと、ロボットが静止物にぶつからないこと、
/// 静止物を「動く物体」と誤って追跡し続けないことを確かめる。
#[test]
fn survives_random_use() {
    let mut total_false = 0;
    let mut total_scans = 0;
    let mut total_collisions = 0;
    let mut reached = 0;
    let mut goals = 0;
    for seed in 1..=12u32 {
        let (beams, steps) = if seed % 3 == 0 { (30, 640) } else { (56, 1300) };
        let mut sim = Sim::new(seed, beams, steps, 5);
        let mut rng = Rng::new(seed * 7919);
        let mut had_goal = false;
        for step in 0..(150 * 60) {
            if step % 90 == 0 {
                let (x, z) = (rng.range(-18.0, 20.0), rng.range(-20.0, 20.0));
                match rng.below(4) {
                    0 => {
                        sim.world.add_walker(x, z);
                    }
                    1 => {
                        sim.world.add_obstacle(x, z);
                    }
                    _ => {
                        if sim.planner.goal.is_none() && sim.planner.set_goal(x, z) {
                            goals += 1;
                            had_goal = true;
                        }
                    }
                }
            }
            let scanned = sim.tick(1.0 / 60.0);
            if had_goal && sim.planner.goal.is_none() {
                reached += 1;
                had_goal = false;
            }
            if scanned {
                total_scans += 1;
                for t in sim.tracker.tracks.iter().filter(|t| t.confirmed && t.moving && t.misses == 0) {
                    let (x, z) = t.pos();
                    if !sim.world.walkers.iter().any(|w| (x - w.x).hypot(z - w.z) < 1.0) {
                        total_false += 1;
                        if std::env::var("VERBOSE").is_ok() {
                            let c = &sim.clusterer.clusters[t.cluster];
                            println!(
                                "  seed {seed} t={:.1} id {} at ({x:.1}, {z:.1}) speed {:.2} age {} | cluster n={} w={:.2} d={:.2} top={:.2} | static {:.2} m, robot {:.1} m (v={:.2})",
                                sim.world.time, t.id, t.speed(), t.age, c.points, c.width, c.depth, c.top,
                                sim.world.clearance(x, z), (x - sim.world.ego.x).hypot(z - sim.world.ego.z), sim.world.ego.v
                            );
                        }
                    }
                }
            }
        }
        total_collisions += sim.world.collisions;
    }
    println!(
        "random use: {total_scans} scans, false moving tracks in {total_false} scans, goals reached {reached} / {goals}, collisions {total_collisions}"
    );
    assert_eq!(total_collisions, 0);
    assert!((total_false as f32) < 0.002 * total_scans as f32);
}
