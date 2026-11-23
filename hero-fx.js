// =========================================================
// ヒーローの演出
//   1. ブラウザ内の物体検出デモ（MediaPipe / EfficientDet-Lite0）
//      - ボタンを押したときだけモデルを読み込む。カメラも押したときだけ起動する
//      - 映像はブラウザ内で処理し、どこにも送信・保存しない
//   2. LiDAR 風の点群シーン（three.js）
//      - 点群はコード内で生成した疑似データ（実在のデータセットは使っていない）
//      - 歩行者を追跡している様子（3D の枠・ID・軌跡）を重ねる
// =========================================================

const $ = (sel) => document.querySelector(sel);
// app.js の翻訳関数（言語切り替え後も data-i18n で追従する）
const tr = (key) => (typeof t === 'function' ? t(key) : key);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------------------------------------------------------
// 1. 物体検出デモ
// ---------------------------------------------------------
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite';

const setupDetection = () => {
  const box = $('.detect');
  const img = $('.detect-img');
  const video = $('.detect-video');
  const canvas = $('.detect-overlay');
  const btnRun = $('#fx-run');
  const btnCam = $('#fx-camera');
  const btnStop = $('#fx-stop');
  const btnEnd = $('#fx-end');
  if (!box || !canvas || !btnRun) return;

  const ctx = canvas.getContext('2d');
  const hudSrc = $('.hud-src');
  const hudFps = $('.hud-fps');
  let detector = null;
  let mode = 'IMAGE';
  let stream = null;
  let raf = 0;

  const setStatus = (key) => {
    const s = $('#fx-status');
    s.dataset.i18n = key;
    s.innerHTML = tr(key);
  };

  // 表示中の要素（画像 / 動画）の位置に合わせて枠を描く
  const draw = (detections, el, mirror) => {
    const area = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = area.width * dpr;
    canvas.height = area.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, area.width, area.height);

    const sx = r.width / (el.naturalWidth || el.videoWidth);
    const sy = r.height / (el.naturalHeight || el.videoHeight);
    const ox = r.left - area.left;
    const oy = r.top - area.top;
    const colPerson = cssVar('--accent');
    const colOther = cssVar('--accent-2');
    const ink = cssVar('--accent-ink');

    for (const d of detections) {
      const c = d.categories[0];
      const b = d.boundingBox;
      const w = b.width * sx;
      const h = b.height * sy;
      const x = mirror ? ox + r.width - b.originX * sx - w : ox + b.originX * sx;
      const y = oy + b.originY * sy;
      const col = c.categoryName === 'person' ? colPerson : colOther;

      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);

      const label = `${c.categoryName} ${c.score.toFixed(2)}`;
      ctx.font = '500 11px "IBM Plex Mono", monospace';
      const tw = ctx.measureText(label).width + 12;
      const ly = Math.max(0, y - 19);
      ctx.fillStyle = col;
      ctx.fillRect(x - 0.75, ly, tw, 19);
      ctx.fillStyle = ink;
      ctx.fillText(label, x + 5, ly + 13);
    }
  };

  const loadDetector = async () => {
    if (detector) return detector;
    setStatus('fx.loading');
    const { ObjectDetector, FilesetResolver } = await import(`${MP}/vision_bundle.mjs`);
    const vision = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
    detector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL },
      scoreThreshold: 0.4,
      maxResults: 6,
      runningMode: 'IMAGE',
    });
    setStatus('fx.ready');
    return detector;
  };

  const runImage = async () => {
    if (mode !== 'IMAGE') {
      await detector.setOptions({ runningMode: 'IMAGE' });
      mode = 'IMAGE';
    }
    const t0 = performance.now();
    const res = detector.detect(img);
    // 単位をカメラ使用時と揃え、1 回の推論時間を FPS に換算して表示する
    hudFps.textContent = `${(1000 / Math.max(1, performance.now() - t0)).toFixed(1)} FPS`;
    draw(res.detections, img, false);
  };

  // カメラだけを止め、写真での検出表示に戻る
  const releaseCamera = () => {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    video.hidden = true;
    img.hidden = false;
    hudSrc.textContent = 'CAM_FRONT';
  };

  const stopCamera = () => {
    releaseCamera();
    btnCam.hidden = false;
    btnStop.hidden = true;
    runImage();
  };

  // 検出を終了: カメラを止め、枠を消し、モデルを解放して最初の状態に戻す
  const endDetection = () => {
    releaseCamera();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    detector?.close();
    detector = null;
    mode = 'IMAGE';
    box.classList.remove('ran');
    hudFps.textContent = '30 FPS';
    const status = $('#fx-status');
    delete status.dataset.i18n;
    status.textContent = '';
    $('#fx-privacy').hidden = true;
    $('#fx-hint').hidden = false;
    btnCam.hidden = true;
    btnStop.hidden = true;
    btnEnd.hidden = true;
    btnRun.hidden = false;
    btnRun.disabled = false;
  };

  const startCamera = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    } catch (e) {
      setStatus('fx.noCamera');
      return;
    }
    video.srcObject = stream;
    await video.play();
    img.hidden = true;
    video.hidden = false;
    hudSrc.textContent = 'WEBCAM';
    btnCam.hidden = true;
    btnStop.hidden = false;
    await detector.setOptions({ runningMode: 'VIDEO' });
    mode = 'VIDEO';

    let last = performance.now();
    const loop = () => {
      if (!stream) return;
      const now = performance.now();
      const res = detector.detectForVideo(video, now);
      hudFps.textContent = `${Math.round(1000 / Math.max(1, now - last))} FPS`;
      last = now;
      draw(res.detections, video, true);
      raf = requestAnimationFrame(loop);
    };
    loop();
  };

  btnRun.addEventListener('click', async () => {
    btnRun.disabled = true;
    try {
      await loadDetector();
      await runImage();
      box.classList.add('ran');
      btnRun.hidden = true;
      btnCam.hidden = false;
      btnEnd.hidden = false;
      $('#fx-hint').hidden = true;
      $('#fx-privacy').hidden = false;
      $('#fx-privacy').innerHTML = tr('fx.privacy');
    } catch (e) {
      console.error(e);
      setStatus('fx.error');
      btnRun.disabled = false;
    }
  });
  btnCam.addEventListener('click', startCamera);
  btnStop.addEventListener('click', stopCamera);
  btnEnd.addEventListener('click', endDetection);

  // 別のタブに移ったらカメラを止める
  document.addEventListener('visibilitychange', () => document.hidden && stream && stopCamera());
  window.addEventListener('resize', () => detector && !stream && runImage());
};

// ---------------------------------------------------------
// 2. LiDAR 風の点群シーン
//    歩行空間を走る移動ロボットの周囲を想定した架空の配置。
// ---------------------------------------------------------
const SENSOR_H = 1.9; // センサーの高さ [m]
const MAX_RANGE = 46; // 計測範囲 [m]

// 静止物。wall: x がこの値より小さい側が壁 / box: 直方体 / cyl: 円柱（y0 を指定すると宙に浮く）
const STATIC = [
  { type: 'wall', x: -17, h: 8 }, // 建物の壁
  { type: 'box', x: 10, z: -9, w: 7, d: 1.4, h: 0.8 }, // 植栽の縁
  { type: 'box', x: 14, z: 9, w: 2.6, d: 2.6, h: 3 }, // 売店
  { type: 'box', x: -8, z: 12, w: 1.2, d: 3.6, h: 0.9 }, // ベンチ
  { type: 'box', x: -11, z: -10, w: 3, d: 1.6, h: 2.2 }, // 設備
  { type: 'cyl', x: 6, z: 4, r: 0.2, h: 5 }, // 街灯
  { type: 'cyl', x: 6, z: -15, r: 0.2, h: 5 },
  { type: 'cyl', x: -3, z: 19, r: 0.2, h: 5 },
  { type: 'cyl', x: -5, z: -4, r: 0.3, h: 3.2 }, // 樹木（幹と樹冠）
  { type: 'cyl', x: -5, z: -4, r: 2.2, y0: 3.2, h: 6.4 },
  { type: 'cyl', x: 19, z: -2, r: 0.3, h: 3.2 },
  { type: 'cyl', x: 19, z: -2, r: 2.4, y0: 3.2, h: 6.8 },
  { type: 'cyl', x: 2, z: -22, r: 0.3, h: 3.2 },
  { type: 'cyl', x: 2, z: -22, r: 2.2, y0: 3.2, h: 6.2 },
];

// 追跡対象（歩行者）。折れ線の上を一定の速さで往復する
const TRACKS = [
  { id: 3, path: [[4, 10], [11, 3], [15, -5]], speed: 1.3 },
  { id: 7, path: [[-3, 7], [2, 1], [3, -8], [-2, -14]], speed: 1.1 },
  { id: 12, path: [[-13, 4], [-9, -2], [-13, -6]], speed: 0.9 },
  { id: 15, path: [[9, 15], [1, 13], [-6, 17]], speed: 1.5 },
  { id: 21, path: [[17, 3], [10, 6], [8, 12]], speed: 1.2 },
];

// センサーから出たビーム 1 本が最初に当たる点を求める。
// (cx, cz): 水平方向の単位ベクトル / slope: 水平距離 1 m あたりの上下の変化
const castRay = (cx, cz, slope) => {
  let best = slope < 0 ? SENSOR_H / -slope : Infinity; // 地面
  let kind = 0;
  for (const o of STATIC) {
    let rin;
    let rout;
    if (o.type === 'wall') {
      if (cx >= 0) continue;
      rin = o.x / cx;
      rout = Infinity;
    } else if (o.type === 'box') {
      // 水平面でのスラブ法
      rin = 0;
      rout = Infinity;
      const slabs = [
        [o.x - o.w / 2, o.x + o.w / 2, cx],
        [o.z - o.d / 2, o.z + o.d / 2, cz],
      ];
      let miss = false;
      for (const [lo, hi, dir] of slabs) {
        if (Math.abs(dir) < 1e-9) {
          if (lo > 0 || hi < 0) miss = true;
          continue;
        }
        const a = lo / dir;
        const b = hi / dir;
        rin = Math.max(rin, Math.min(a, b));
        rout = Math.min(rout, Math.max(a, b));
      }
      if (miss || rout < rin) continue;
    } else {
      const b = cx * o.x + cz * o.z;
      const disc = b * b - (o.x * o.x + o.z * o.z - o.r * o.r);
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      rout = b + sq;
      if (rout < 0) continue;
      rin = Math.max(0, b - sq);
    }

    const y0 = o.y0 || 0;
    const yin = SENSOR_H + slope * rin;
    let r = Infinity;
    if (yin >= y0 && yin <= o.h) r = rin; // 側面
    else if (yin > o.h && slope < 0) r = (o.h - SENSOR_H) / slope; // 上面
    else if (yin < y0 && slope > 0) r = (y0 - SENSOR_H) / slope; // 下面
    if (r < rin || r > rout) continue;
    if (r < best) {
      best = r;
      kind = o.type === 'wall' ? 2 : 1;
    }
  }
  if (best > MAX_RANGE) return null;
  return [cx * best, Math.max(0, SENSOR_H + slope * best), cz * best, kind];
};

// 全周を走査した 1 回分の点群を作る: [x, y, z, kind, ...]
const generatePoints = (beams, steps) => {
  const out = [];
  for (let b = 0; b < beams; b++) {
    const slope = Math.tan(((-25 + (b / (beams - 1)) * 37) * Math.PI) / 180);
    for (let i = 0; i < steps; i++) {
      const ang = ((i + (b % 2) * 0.5) / steps) * Math.PI * 2;
      const hit = castRay(Math.cos(ang), Math.sin(ang), slope);
      if (hit) out.push(...hit);
    }
  }
  return out;
};

// 折れ線上の位置と進行方向を返す
const makeWalker = (track, index) => {
  const pts = track.path;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  const phase = (index * 0.37 * total) % total;
  return (time) => {
    let s = (phase + track.speed * time) % (2 * total);
    if (s < 0) s += 2 * total;
    const back = s > total;
    if (back) s = 2 * total - s;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / (cum[i] - cum[i - 1]);
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const sign = back ? -1 : 1;
    const len = Math.hypot(bx - ax, bz - az);
    return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, dx: ((bx - ax) / len) * sign, dz: ((bz - az) / len) * sign };
  };
};

const setupLidar = async () => {
  const canvas = $('.lidar');
  const hero = $('.hero');
  const labelLayer = $('.lidar-labels');
  if (!canvas || !hero) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = window.innerWidth < 920;

  let THREE;
  let renderer;
  try {
    THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js');
    // CSS の色をそのまま使う（色空間の変換をしない）
    THREE.ColorManagement.enabled = false;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !small, alpha: true });
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  } catch (e) {
    hero.classList.add('no-gl'); // WebGL が使えない環境では、CSS の同心円だけを表示する
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.25 : 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 300);

  // ----- 点群（スマホでは点の数を減らす） -----
  const beams = small ? 30 : 56;
  const raw = generatePoints(beams, small ? 640 : 1300);
  const n = raw.length / 4;
  const pos = new Float32Array(n * 3);
  const kind = new Float32Array(n);
  const ang = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = raw[i * 4];
    pos[i * 3 + 1] = raw[i * 4 + 1];
    pos[i * 3 + 2] = raw[i * 4 + 2];
    kind[i] = raw[i * 4 + 3];
    ang[i] = (Math.atan2(raw[i * 4 + 2], raw[i * 4]) + Math.PI * 2) % (Math.PI * 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('kind', new THREE.BufferAttribute(kind, 1));
  geo.setAttribute('ang', new THREE.BufferAttribute(ang, 1));

  // 高さで色を変える。回転するビームが通過した直後の点を明るくし、時間とともに暗くする
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uSweep: { value: 0 },
      uPix: { value: renderer.getPixelRatio() },
      uScale: { value: 40 },
      uC0: { value: new THREE.Color() },
      uC1: { value: new THREE.Color() },
      uC2: { value: new THREE.Color() },
      uC3: { value: new THREE.Color() },
      uBase: { value: 1 },
    },
    vertexShader: `
      attribute float kind; attribute float ang;
      uniform float uSweep; uniform float uPix; uniform float uScale;
      varying float vGlow; varying float vKind; varying float vT; varying float vFade;
      void main() {
        float d = mod(uSweep - ang + 6.28318, 6.28318);
        vGlow = exp(-d * 1.5);
        vKind = kind;
        vT = clamp(position.y / 5.5, 0.0, 1.0);
        vFade = 1.0 - smoothstep(18.0, 46.0, length(position.xz)) * 0.7;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(1.0, (1.0 + vGlow * 1.2) * uPix * uScale / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform float uBase;
      varying float vGlow; varying float vKind; varying float vT; varying float vFade;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        if (dot(c, c) > 0.25) discard;
        vec3 ramp = mix(mix(uC1, uC2, smoothstep(0.0, 0.45, vT)), uC3, smoothstep(0.45, 1.0, vT));
        vec3 col = vKind < 0.5 ? uC0 : ramp;
        float base = vKind < 0.5 ? 0.2 : 0.55;
        gl_FragColor = vec4(col, (base + vGlow * 0.8) * vFade * uBase);
      }`,
  });
  scene.add(new THREE.Points(geo, mat));

  // ----- 自車の位置と距離の目安（10 m ごとの円） -----
  const guideMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.3 });
  for (const radius of [10, 20, 30]) {
    const ring = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      ring.push(new THREE.Vector3(Math.cos(a) * radius, 0.02, Math.sin(a) * radius));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), guideMat));
  }
  const trackMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95 });
  const ego = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.1, 0.5, 0.7)), trackMat);
  ego.position.y = 0.25;
  scene.add(ego);

  // ----- 追跡対象: 点のかたまり・3D の枠・進行方向・軌跡・ラベル -----
  const TRAIL = 36;
  const bodyGeo = (() => {
    // センサーに向いた半周だけに点が付く
    const p = [];
    for (let row = 0; row < 11; row++) {
      for (let col = 0; col < 7; col++) {
        const phi = ((col - 3) / 3) * 1.25 + (row % 2) * 0.12;
        p.push(Math.cos(phi) * 0.27, 0.16 + row * 0.15, Math.sin(phi) * 0.27);
      }
    }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  })();
  const bodyMat = new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0.95, depthWrite: false });
  const trailMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  const boxGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.72, 1.76, 0.72));
  const headGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.03, 0), new THREE.Vector3(1.3, 0.03, 0)]);

  const walkers = (small ? TRACKS.slice(0, 3) : TRACKS).map((track, i) => {
    const at = makeWalker(track, i);
    const body = new THREE.Points(bodyGeo, bodyMat);
    const box = new THREE.LineSegments(boxGeo, trackMat);
    box.position.y = 0.88;
    const heading = new THREE.Line(headGeo, trackMat);
    const group = new THREE.Group();
    group.add(box, heading);

    const trailPos = new Float32Array(TRAIL * 3);
    const trailCol = new Float32Array(TRAIL * 4);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 4));
    const trail = new THREE.Line(trailGeo, trailMat);
    trail.frustumCulled = false;
    scene.add(body, group, trail);

    const label = document.createElement('span');
    label.className = 'trk';
    label.innerHTML = `ID ${String(track.id).padStart(2, '0')}<span>person ${track.speed.toFixed(1)} m/s</span>`;
    labelLayer?.append(label);
    return { track, at, body, group, trail, trailPos, trailCol, label };
  });

  const v = new THREE.Vector3();
  const placeWalkers = (time) => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    for (const k of walkers) {
      const p = k.at(time);
      k.group.position.set(p.x, 0, p.z);
      k.group.rotation.y = Math.atan2(-p.dz, p.dx);
      k.body.position.set(p.x, 0, p.z);
      k.body.rotation.y = Math.atan2(p.z, -p.x);

      // 軌跡: 0.25 秒おきの過去の位置をつなぐ
      for (let i = 0; i < TRAIL; i++) {
        const q = k.at(time - i * 0.25);
        k.trailPos[i * 3] = q.x;
        k.trailPos[i * 3 + 1] = 0.03;
        k.trailPos[i * 3 + 2] = q.z;
      }
      k.trail.geometry.attributes.position.needsUpdate = true;

      // ラベルを枠の上端に合わせる
      v.set(p.x, 1.9, p.z).project(camera);
      // 画面の外と、見出しの文字に重なる位置（広い画面の左側）では隠す
      const overText = w >= 920 && v.x * 0.5 + 0.5 < 0.5;
      const visible = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && !overText;
      k.label.style.opacity = visible ? '' : '0';
      k.label.style.transform = `translate(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -130%)`;
    }
  };

  // テーマ（ダーク / ライト）に合わせて色と重ね方を切り替える
  const applyTheme = () => {
    const light = getComputedStyle(document.documentElement).colorScheme.includes('light');
    mat.uniforms.uC0.value.set(cssVar('--pc-ground'));
    mat.uniforms.uC1.value.set(cssVar('--pc-low'));
    mat.uniforms.uC2.value.set(cssVar('--pc-mid'));
    mat.uniforms.uC3.value.set(cssVar('--pc-high'));
    mat.uniforms.uBase.value = light ? 1.25 : 1;
    mat.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    mat.needsUpdate = true;
    guideMat.color.set(cssVar('--pc-ground'));
    const line = new THREE.Color(cssVar('--accent-text'));
    trackMat.color.copy(line);
    bodyMat.color.copy(line);
    for (const k of walkers) {
      for (let i = 0; i < TRAIL; i++) {
        k.trailCol.set([line.r, line.g, line.b, 0.75 * (1 - i / (TRAIL - 1)) ** 1.5], i * 4);
      }
      k.trail.geometry.attributes.color.needsUpdate = true;
    }
  };
  applyTheme();

  // 文字が左にあるので、広い画面ではシーンの中心を右に寄せる
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    if (w >= 920) camera.setViewOffset(w, h, -w * 0.17, h * 0.03, w, h);
    else camera.setViewOffset(w, h, 0, -h * 0.12, w, h);
    camera.updateProjectionMatrix();
    mat.uniforms.uScale.value = Math.min(h, 980) * 0.055;
  };

  // マウスの位置で少しだけ視点が動く
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  if (!reduce) {
    hero.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const r = hero.getBoundingClientRect();
      pointer.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.ty = ((e.clientY - r.top) / r.height) * 2 - 1;
    });
    hero.addEventListener('pointerleave', () => {
      pointer.tx = 0;
      pointer.ty = 0;
    });
  }

  const render = (time) => {
    pointer.x += (pointer.tx - pointer.x) * 0.045;
    pointer.y += (pointer.ty - pointer.y) * 0.045;
    mat.uniforms.uSweep.value = (time * 1.9) % (Math.PI * 2);
    // 壁の裏に回り込まないよう、開けた側で左右に振る
    const az = 0.42 + Math.sin(time * 0.05) * 0.5 + pointer.x * 0.22;
    const el = 0.47 - pointer.y * 0.06;
    const dist = small ? 40 : 33;
    camera.position.set(Math.cos(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.sin(az) * Math.cos(el) * dist);
    camera.lookAt(0, 0.8, 0);
    camera.updateMatrixWorld();
    placeWalkers(time);
    renderer.render(scene, camera);
  };

  $('.hud-beams') && ($('.hud-beams').textContent = `${beams} beams`);
  $('.hud-pts') && ($('.hud-pts').textContent = `${n.toLocaleString('en-US')} pts`);
  $('.hud-tracks') && ($('.hud-tracks').textContent = `${walkers.length} tracks`);

  resize();

  // 動きを減らす設定では静止画を 1 枚だけ描く
  const STILL = 8;
  const onTheme = () => {
    applyTheme();
    if (reduce) render(STILL);
  };
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', onTheme);
  window.addEventListener('resize', () => {
    resize();
    if (reduce) render(STILL);
  });
  if (reduce) {
    render(STILL);
    return;
  }

  // ヒーローが画面に見えている間だけ描画する
  const clock = new THREE.Clock();
  let raf = 0;
  const loop = () => {
    render(clock.getElapsedTime() + STILL);
    raf = requestAnimationFrame(loop);
  };
  new IntersectionObserver(([entry]) => {
    cancelAnimationFrame(raf);
    if (entry.isIntersecting) loop();
  }).observe(hero);
};

setupDetection();
// 背景は本文の表示を優先して、ブラウザが空いたときに読み込む
(window.requestIdleCallback || ((fn) => setTimeout(fn, 300)))(() => setupLidar());
