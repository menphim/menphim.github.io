//! 経路計画用の 2 次元グリッド（世界座標に固定）と、その上の A*。

use std::cmp::Reverse;
use std::collections::BinaryHeap;

/// 1 辺のセル数
pub const N: usize = 192;
/// セルの大きさ [m]
pub const CELL: f32 = 0.25;
/// グリッドの左下の世界座標 [m]（x, z 共通）
pub const ORIGIN: f32 = -24.0;
/// 通れないセルのコスト
pub const LETHAL: u8 = 255;

#[inline]
pub fn cell_of(x: f32, z: f32) -> Option<usize> {
    let ix = ((x - ORIGIN) / CELL).floor();
    let iz = ((z - ORIGIN) / CELL).floor();
    if ix < 0.0 || iz < 0.0 || ix >= N as f32 || iz >= N as f32 {
        return None;
    }
    Some(iz as usize * N + ix as usize)
}

#[inline]
pub fn center_of(idx: usize) -> (f32, f32) {
    let ix = idx % N;
    let iz = idx / N;
    (ORIGIN + (ix as f32 + 0.5) * CELL, ORIGIN + (iz as f32 + 0.5) * CELL)
}

/// 占有セルまでの距離 [m] を 2 回の走査で求める（チャンファー距離）。
/// `cap` より遠いセルは `cap` になる。
pub fn distance_transform(occupied: &[bool], dist: &mut [f32], cap: f32) {
    const D1: f32 = CELL;
    const D2: f32 = CELL * 1.414_213_5;
    for i in 0..N * N {
        dist[i] = if occupied[i] { 0.0 } else { cap };
    }
    for iz in 0..N {
        for ix in 0..N {
            let i = iz * N + ix;
            let mut d = dist[i];
            if ix > 0 {
                d = d.min(dist[i - 1] + D1);
            }
            if iz > 0 {
                d = d.min(dist[i - N] + D1);
                if ix > 0 {
                    d = d.min(dist[i - N - 1] + D2);
                }
                if ix + 1 < N {
                    d = d.min(dist[i - N + 1] + D2);
                }
            }
            dist[i] = d;
        }
    }
    for iz in (0..N).rev() {
        for ix in (0..N).rev() {
            let i = iz * N + ix;
            let mut d = dist[i];
            if ix + 1 < N {
                d = d.min(dist[i + 1] + D1);
            }
            if iz + 1 < N {
                d = d.min(dist[i + N] + D1);
                if ix + 1 < N {
                    d = d.min(dist[i + N + 1] + D2);
                }
                if ix > 0 {
                    d = d.min(dist[i + N - 1] + D2);
                }
            }
            dist[i] = d;
        }
    }
}

/// 経路探索の結果
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Found {
    /// goal までの経路が見つかった
    Goal,
    /// goal には届かないので、届く範囲で最も近いセルまでの経路を返した
    Partial,
    None,
}

/// A* の作業領域。呼び出しのたびに確保し直さないよう使い回す。
pub struct AStar {
    g: Vec<u32>,
    parent: Vec<u32>,
    stamp: Vec<u32>,
    closed: Vec<u32>,
    gen: u32,
    heap: BinaryHeap<Reverse<(u32, u32)>>,
}

impl Default for AStar {
    fn default() -> Self {
        Self::new()
    }
}

impl AStar {
    pub fn new() -> Self {
        AStar {
            g: vec![0; N * N],
            parent: vec![0; N * N],
            stamp: vec![0; N * N],
            closed: vec![0; N * N],
            gen: 0,
            heap: BinaryHeap::new(),
        }
    }

    /// `cost` が LETHAL のセルを避けて start から goal までのセル列を返す。
    /// 8 近傍。コストの高いセルほど通りにくい。
    pub fn search(&mut self, cost: &[u8], start: usize, goal: usize, out: &mut Vec<usize>) -> bool {
        self.search_near(cost, start, goal, false, out) == Found::Goal
    }

    /// `search` と同じだが、goal に届かないときは、届く範囲で goal に最も近いセルまでの
    /// 経路を返すことができる（`allow_partial`）。
    pub fn search_near(&mut self, cost: &[u8], start: usize, goal: usize, allow_partial: bool, out: &mut Vec<usize>) -> Found {
        out.clear();
        if cost[start] == LETHAL || (cost[goal] == LETHAL && !allow_partial) {
            return Found::None;
        }
        self.gen = self.gen.wrapping_add(1);
        if self.gen == 0 {
            self.stamp.iter_mut().for_each(|s| *s = 0);
            self.closed.iter_mut().for_each(|s| *s = 0);
            self.gen = 1;
        }
        let gen = self.gen;
        self.heap.clear();

        let (gx, gz) = ((goal % N) as i32, (goal / N) as i32);
        let h = |i: usize| -> u32 {
            let dx = ((i % N) as i32 - gx).unsigned_abs();
            let dz = ((i / N) as i32 - gz).unsigned_abs();
            10 * (dx + dz) - 6 * dx.min(dz)
        };

        self.g[start] = 0;
        self.parent[start] = start as u32;
        self.stamp[start] = gen;
        self.heap.push(Reverse((h(start), start as u32)));
        // 調べたセルのうち、goal に最も近いもの
        let mut nearest = (h(start), start);

        const DIRS: [(i32, i32, u32); 8] =
            [(1, 0, 10), (-1, 0, 10), (0, 1, 10), (0, -1, 10), (1, 1, 14), (1, -1, 14), (-1, 1, 14), (-1, -1, 14)];

        while let Some(Reverse((_, cur))) = self.heap.pop() {
            let cur = cur as usize;
            if self.closed[cur] == gen {
                continue;
            }
            self.closed[cur] = gen;
            if cur == goal {
                self.trace(start, goal, out);
                return Found::Goal;
            }
            if h(cur) < nearest.0 {
                nearest = (h(cur), cur);
            }
            let (cx, cz) = ((cur % N) as i32, (cur / N) as i32);
            let g0 = self.g[cur];
            for &(dx, dz, base) in &DIRS {
                let (nx, nz) = (cx + dx, cz + dz);
                if nx < 0 || nz < 0 || nx >= N as i32 || nz >= N as i32 {
                    continue;
                }
                let ni = nz as usize * N + nx as usize;
                let c = cost[ni];
                if c == LETHAL || self.closed[ni] == gen {
                    continue;
                }
                // 斜め移動で障害物の角をかすめない
                if dx != 0 && dz != 0 {
                    let a = cz as usize * N + nx as usize;
                    let b = nz as usize * N + cx as usize;
                    if cost[a] == LETHAL || cost[b] == LETHAL {
                        continue;
                    }
                }
                let ng = g0 + base * (16 + c as u32) / 16;
                if self.stamp[ni] != gen || ng < self.g[ni] {
                    self.stamp[ni] = gen;
                    self.g[ni] = ng;
                    self.parent[ni] = cur as u32;
                    self.heap.push(Reverse((ng + h(ni), ni as u32)));
                }
            }
        }
        if allow_partial && nearest.1 != start {
            self.trace(start, nearest.1, out);
            return Found::Partial;
        }
        Found::None
    }

    /// 親をたどって、start から end までのセル列を作る
    fn trace(&self, start: usize, end: usize, out: &mut Vec<usize>) {
        let mut i = end;
        out.push(i);
        while i != start {
            i = self.parent[i] as usize;
            out.push(i);
        }
        out.reverse();
    }
}

/// `from` から最も近い、コストが `limit` 未満のセルを幅優先で探す。
pub fn nearest_free(cost: &[u8], from: usize, limit: u8, max_cells: i32) -> Option<usize> {
    if cost[from] < limit {
        return Some(from);
    }
    let (fx, fz) = ((from % N) as i32, (from / N) as i32);
    let mut best: Option<(i32, usize)> = None;
    for dz in -max_cells..=max_cells {
        for dx in -max_cells..=max_cells {
            let (x, z) = (fx + dx, fz + dz);
            if x < 0 || z < 0 || x >= N as i32 || z >= N as i32 {
                continue;
            }
            let i = z as usize * N + x as usize;
            if cost[i] >= limit {
                continue;
            }
            let d = dx * dx + dz * dz;
            if d <= max_cells * max_cells && best.map_or(true, |(bd, _)| d < bd) {
                best = Some((d, i));
            }
        }
    }
    best.map(|(_, i)| i)
}

/// セル列を点列にして角を丸める。コストの高いセルには踏み込まない。
pub fn smooth(cells: &[usize], cost: &[u8], start: (f32, f32), goal: (f32, f32), out: &mut Vec<[f32; 2]>) {
    out.clear();
    if cells.is_empty() {
        return;
    }
    out.push([start.0, start.1]);
    if cells.len() > 2 {
        for &c in &cells[1..cells.len() - 1] {
            let (x, z) = center_of(c);
            out.push([x, z]);
        }
    }
    out.push([goal.0, goal.1]);
    let n = out.len();
    if n < 3 {
        return;
    }
    for _ in 0..60 {
        for i in 1..n - 1 {
            let (p, a, b) = (out[i], out[i - 1], out[i + 1]);
            let nx = p[0] + 0.5 * (0.5 * (a[0] + b[0]) - p[0]);
            let nz = p[1] + 0.5 * (0.5 * (a[1] + b[1]) - p[1]);
            let ok = match (cell_of(nx, nz), cell_of(p[0], p[1])) {
                (Some(nc), Some(oc)) => cost[nc] != LETHAL && cost[nc] <= cost[oc].max(40),
                _ => false,
            };
            if ok {
                out[i] = [nx, nz];
            }
        }
    }
}
