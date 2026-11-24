// =========================================================
// ヒーローの演出
//   1. ブラウザ内の物体検出デモ（MediaPipe / EfficientDet-Lite0）
//      - ボタンを押したときだけモデルを読み込む。カメラも押したときだけ起動する
//      - 映像はブラウザ内で処理し、どこにも送信・保存しない
//   2. LiDAR の点群シーン（three.js + WebAssembly）
//      - 点群はシミュレーションで作る（実在のデータセットは使っていない）
//      - その点群から、地面の推定・クラスタリング・追跡・経路計画までを
//        ブラウザ内で実行する。処理は Rust で書いてある（perception/）
//      - 3D の枠・ID・軌跡は、その追跡の結果をそのまま描いたもの
// =========================================================

const $ = (sel) => document.querySelector(sel);
// app.js の翻訳関数（言語切り替え後も data-i18n で追従する）
const tr = (key) => (typeof t === 'function' ? t(key) : key);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
// 翻訳が関数（数値を埋め込む文）の項目用
const trf = (key, ...args) => {
  const f = tr(key);
  return typeof f === 'function' ? f(...args) : '';
};

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
// 2. LiDAR の点群シーン
//    点群の生成（LiDAR のシミュレーション）と、点群からの認識・追跡・経路計画は
//    Rust で書いて WebAssembly にしてある（ソースは perception/）。
//    ここでは、その結果を three.js で描くことと、操作の受け付けだけを行う。
// ---------------------------------------------------------
const WASM_URL = 'perception.wasm?v=1'; // 出力の並びを変えたら、古いキャッシュを使わないよう番号を上げる
const SEED = 20261124;
// perception/src/lib.rs の出力の並びに合わせる
const POINT_STRIDE = 5; // x, y, z, 種類, 色分け用の番号
const TRACK_STRIDE = 12; // 番号, 予測中か, x, z, vx, vz, 幅, 高さ, 見失った回数, 経過, 軌跡の長さ, 速さ
const MAX_TRACKS = 32;
const TRAIL = 40;
const MAX_PATH = 256;
const STATE_LEN = 32;
const S = { X: 0, Z: 1, YAW: 2, NAV: 4, GX: 5, GZ: 6, HAS_GOAL: 7, RAYS: 8, POINTS: 9, GROUND: 10, CLUSTERS: 11, TRACKS: 13, REMAIN: 14, MS: 16, AGE: 24, PATH_N: 25 };

const loadPerception = async () => {
  const imports = { env: { now: () => performance.now() } };
  try {
    return (await WebAssembly.instantiateStreaming(fetch(WASM_URL), imports)).instance.exports;
  } catch (e) {
    // .wasm を application/wasm で返さないサーバーでは、全体を読み込んでから渡す
    const bytes = await (await fetch(WASM_URL)).arrayBuffer();
    return (await WebAssembly.instantiate(bytes, imports)).instance.exports;
  }
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
  let sim;
  try {
    [THREE, sim] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js'),
      loadPerception(),
    ]);
    // CSS の色をそのまま使う（色空間の変換をしない）
    THREE.ColorManagement.enabled = false;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !small, alpha: true });
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  } catch (e) {
    hero.classList.add('no-gl'); // WebGL か WebAssembly が使えない環境では、CSS の同心円だけを表示する
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.25 : 2));

  // ----- シミュレーションと認識（WebAssembly）。スマホではビームの数を減らす -----
  const beams = small ? 30 : 56;
  const steps = small ? 640 : 1300;
  const maxPoints = beams * steps;
  sim.init(SEED, beams, steps, small ? 3 : 5);
  const GRID = sim.costmap_size();

  // WebAssembly のメモリを直接読む。メモリが拡張されると作り直しが要る
  let buffer = null;
  let state;
  let tracks;
  let trails;
  let pathSrc;
  let pointsSrc;
  let costSrc;
  const refresh = (force) => {
    if (!force && buffer === sim.memory.buffer) return;
    buffer = sim.memory.buffer;
    state = new Float32Array(buffer, sim.state_ptr(), STATE_LEN);
    tracks = new Float32Array(buffer, sim.tracks_ptr(), MAX_TRACKS * TRACK_STRIDE);
    trails = new Float32Array(buffer, sim.trails_ptr(), MAX_TRACKS * TRAIL * 2);
    pathSrc = new Float32Array(buffer, sim.path_ptr(), MAX_PATH * 2);
    pointsSrc = new Float32Array(buffer, sim.points_ptr(), maxPoints * POINT_STRIDE);
    costSrc = new Uint8Array(buffer, sim.costmap_ptr(), GRID * GRID);
  };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 300);

  // ----- 点群 -----
  const pointData = new Float32Array(maxPoints * POINT_STRIDE);
  const pointBuf = new THREE.InterleavedBuffer(pointData, POINT_STRIDE);
  pointBuf.setUsage(THREE.DynamicDrawUsage);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.InterleavedBufferAttribute(pointBuf, 3, 0));
  geo.setAttribute('cls', new THREE.InterleavedBufferAttribute(pointBuf, 1, 3));
  geo.setAttribute('key', new THREE.InterleavedBufferAttribute(pointBuf, 1, 4));
  geo.setDrawRange(0, 0);

  // cls: 0 = 地面 / 1 = 静止物 / 2 = 人くらいの大きさの静止物 / 3 = 追跡中の動く物体
  // uMode: 0 = 高さで色分け / 1 = 地面・静止物・動く物体 / 2 = クラスタごと
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uPix: { value: renderer.getPixelRatio() },
      uScale: { value: 40 },
      uMode: { value: 0 },
      uEgo: { value: new THREE.Vector2() },
      uC0: { value: new THREE.Color() },
      uC1: { value: new THREE.Color() },
      uC2: { value: new THREE.Color() },
      uC3: { value: new THREE.Color() },
      uMove: { value: new THREE.Color() },
      uStatic: { value: new THREE.Color() },
      uBase: { value: 1 },
      uLight: { value: 0 },
    },
    vertexShader: `
      attribute float cls; attribute float key;
      uniform float uPix; uniform float uScale; uniform vec2 uEgo;
      varying float vCls; varying float vKey; varying float vT; varying float vFade;
      void main() {
        vCls = cls;
        vKey = key;
        vT = clamp(position.y / 5.5, 0.0, 1.0);
        // 遠い点ほど暗く、センサーに近い点ほど明るく描く
        float r = length(position.xz - uEgo);
        vFade = 1.0 - smoothstep(18.0, 46.0, r) * 0.7 + (1.0 - smoothstep(3.0, 15.0, r)) * 0.55;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(1.0, (cls > 2.5 ? 1.9 : 1.0) * uPix * uScale / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform vec3 uMove; uniform vec3 uStatic;
      uniform float uBase; uniform float uMode; uniform float uLight;
      varying float vCls; varying float vKey; varying float vT; varying float vFade;
      vec3 hue(float h) {
        vec3 c = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        return mix(vec3(1.0), c, 0.8) * mix(1.0, 0.62, uLight);
      }
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        if (dot(c, c) > 0.25) discard;
        vec3 col = uC0;
        float a = 0.27;
        if (vCls > 2.5) {
          col = uMove;
          a = 1.0;
        } else if (uMode < 0.5) {
          if (vCls > 0.5) {
            col = mix(mix(uC1, uC2, smoothstep(0.0, 0.45, vT)), uC3, smoothstep(0.45, 1.0, vT));
            a = 0.68;
          }
        } else if (uMode < 1.5) {
          if (vCls > 0.5) { col = uStatic; a = 0.72; }
        } else {
          a = 0.13;
          if (vCls > 0.5) {
            col = vKey > 0.5 ? hue(fract(vKey * 0.61803)) : uStatic;
            a = vKey > 0.5 ? 0.9 : 0.4;
          }
        }
        gl_FragColor = vec4(col, a * vFade * uBase);
      }`,
  });
  const cloud = new THREE.Points(geo, mat);
  cloud.frustumCulled = false;
  scene.add(cloud);

  // ----- コストマップ（経路計画が見ている地図。操作モードで表示できる） -----
  const costData = new Uint8Array(GRID * GRID * 4);
  const costTex = new THREE.DataTexture(costData, GRID, GRID, THREE.RGBAFormat, THREE.UnsignedByteType);
  costTex.magFilter = THREE.LinearFilter;
  costTex.minFilter = THREE.LinearFilter;
  const costMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uMap: { value: costTex }, uLow: { value: new THREE.Color() }, uHigh: { value: new THREE.Color() } },
    vertexShader: `
      varying vec2 vUv; varying vec2 vPos;
      void main() {
        vUv = uv;
        vPos = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform vec3 uLow; uniform vec3 uHigh;
      varying vec2 vUv; varying vec2 vPos;
      void main() {
        float c = texture2D(uMap, vUv).r;
        if (c < 0.01) discard;
        // 計画の対象外（半径 23 m より外）は描かない
        float inside = 1.0 - smoothstep(22.0, 23.0, length(vPos));
        gl_FragColor = vec4(mix(uLow, uHigh, smoothstep(0.1, 1.0, c)), (0.1 + 0.42 * c) * inside);
      }`,
  });
  const costGeo = new THREE.BufferGeometry();
  costGeo.setAttribute('position', new THREE.Float32BufferAttribute([-24, 0.01, -24, 24, 0.01, -24, 24, 0.01, 24, -24, 0.01, 24], 3));
  costGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  costGeo.setIndex([0, 2, 1, 0, 3, 2]);
  const costPlane = new THREE.Mesh(costGeo, costMat);
  costPlane.visible = false;
  costPlane.renderOrder = -1;
  scene.add(costPlane);

  // ----- ロボットの位置と距離の目安（10 m ごとの円） -----
  const circle = (radius, y, segments = 128) => {
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  };
  const guideMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.3 });
  const rings = new THREE.Group();
  for (const radius of [10, 20, 30]) rings.add(new THREE.Line(circle(radius, 0.02), guideMat));
  scene.add(rings);

  const trackMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95 });
  const coastMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.38 });
  const ego = new THREE.Group();
  const egoBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.1, 0.5, 0.7)), trackMat);
  egoBox.position.y = 0.25;
  // 進行方向を示す三角
  const egoNose = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.55, 0.5, -0.2), new THREE.Vector3(0.85, 0.5, 0), new THREE.Vector3(0.55, 0.5, 0.2)]),
    trackMat
  );
  ego.add(egoBox, egoNose);
  scene.add(ego);

  // ----- 経路と目的地 -----
  const navMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 });
  const pathPos = new Float32Array(MAX_PATH * 3);
  const pathGeo = new THREE.BufferGeometry();
  pathGeo.setAttribute('position', new THREE.BufferAttribute(pathPos, 3));
  const pathLine = new THREE.Line(pathGeo, navMat);
  pathLine.frustumCulled = false;
  pathLine.visible = false;
  const goalMark = new THREE.Group();
  goalMark.add(new THREE.Line(circle(0.45, 0.04, 40), navMat), new THREE.Line(circle(0.12, 0.04, 16), navMat));
  goalMark.visible = false;
  // クリックした場所に一瞬だけ出す円
  const pingMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0 });
  const ping = new THREE.Line(circle(1, 0.05, 48), pingMat);
  ping.visible = false;
  let pingT = 1;
  scene.add(pathLine, goalMark, ping);

  // ----- 追跡: 3D の枠・進む向き・軌跡・ラベル（追跡の数は変わるので、先に用意して使い回す） -----
  const trailMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  const unitBox = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const headGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.03, 0), new THREE.Vector3(1, 0.03, 0)]);
  const pool = Array.from({ length: small ? 12 : MAX_TRACKS }, () => {
    const box = new THREE.LineSegments(unitBox, trackMat);
    const heading = new THREE.Line(headGeo, trackMat);
    const group = new THREE.Group();
    group.add(box, heading);
    group.visible = false;

    const trailPos = new Float32Array(TRAIL * 3);
    const trailCol = new Float32Array(TRAIL * 4);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 4));
    const trail = new THREE.Line(trailGeo, trailMat);
    trail.frustumCulled = false;
    trail.visible = false;
    scene.add(group, trail);

    const label = document.createElement('span');
    label.className = 'trk';
    label.style.opacity = '0';
    labelLayer?.append(label);
    return { box, heading, group, trail, trailPos, trailCol, label, text: '' };
  });

  // ----- 操作モード（ロボットを動かす・歩行者や障害物を足す） -----
  const lab = $('#lab');
  let labOn = false;
  let tool = 'goal';
  let costOn = false;
  // ラベルを出さない領域（見出しの文字・操作パネル・数値の帯の上）
  let blocked = [];
  const measureBlocked = () => {
    const c = canvas.getBoundingClientRect();
    blocked = [labOn ? lab : $('.hero-copy'), $('.stats')]
      .map((el) => el?.getBoundingClientRect())
      .filter((r) => r && r.width)
      .map((r) => ({ l: r.left - c.left - 70, r: r.right - c.left + 70, t: r.top - c.top - 6, b: r.bottom - c.top + 34 }));
  };

  const v = new THREE.Vector3();
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const placeTracks = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const n = Math.min(state[S.TRACKS], pool.length);
    const age = state[S.AGE]; // 最後のスキャンからの経過時間。そのぶん等速で進めて描く
    for (let i = 0; i < pool.length; i++) {
      const k = pool[i];
      if (i >= n) {
        if (k.group.visible) {
          k.group.visible = false;
          k.trail.visible = false;
          k.label.style.opacity = '0';
        }
        continue;
      }
      const o = i * TRACK_STRIDE;
      const coast = tracks[o + 1] > 0;
      const vx = tracks[o + 4];
      const vz = tracks[o + 5];
      const x = tracks[o + 2] + vx * age;
      const z = tracks[o + 3] + vz * age;
      const bw = clamp(tracks[o + 6] + 0.24, 0.62, 0.9);
      const bh = clamp(tracks[o + 7] + 0.06, 1.2, 1.95);
      const speed = tracks[o + 11];

      k.group.visible = true;
      k.group.position.set(x, 0, z);
      k.group.rotation.y = Math.atan2(-vz, vx);
      k.box.scale.set(bw, bh, bw);
      k.box.position.y = bh / 2;
      k.box.material = coast ? coastMat : trackMat;
      // 線の長さ = 1.5 秒後までに進む距離
      k.heading.scale.x = Math.max(0.3, speed * 1.5);
      k.heading.material = k.box.material;

      k.trail.visible = true;
      const q = i * TRAIL * 2;
      for (let j = 0; j < TRAIL; j++) {
        k.trailPos[j * 3] = trails[q + j * 2];
        k.trailPos[j * 3 + 1] = 0.03;
        k.trailPos[j * 3 + 2] = trails[q + j * 2 + 1];
      }
      k.trailPos[0] = x;
      k.trailPos[2] = z;
      k.trail.geometry.attributes.position.needsUpdate = true;

      const id = String(tracks[o]).padStart(2, '0');
      const text = coast
        ? `ID ${id}<span>predicting ${(tracks[o + 8] * 0.1).toFixed(1)} s</span>`
        : `ID ${id}<span>person ${speed.toFixed(1)} m/s</span>`;
      if (text !== k.text) {
        k.text = text;
        k.label.innerHTML = text;
        k.label.classList.toggle('coast', coast);
      }
      // ラベルを枠の上端に合わせる。画面の外と、文字やパネルに重なる位置では隠す
      v.set(x, bh + 0.12, z).project(camera);
      const px = (v.x * 0.5 + 0.5) * w;
      const py = (-v.y * 0.5 + 0.5) * h;
      const over = blocked.some((b) => px > b.l && px < b.r && py > b.t && py < b.b);
      const visible = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && !over;
      k.label.style.opacity = visible ? '' : '0';
      k.label.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -130%)`;
    }
  };

  // テーマ（ダーク / ライト）に合わせて色と重ね方を切り替える
  const applyTheme = () => {
    const light = getComputedStyle(document.documentElement).colorScheme.includes('light');
    const u = mat.uniforms;
    u.uC0.value.set(cssVar('--pc-ground'));
    u.uC1.value.set(cssVar('--pc-low'));
    u.uC2.value.set(cssVar('--pc-mid'));
    u.uC3.value.set(cssVar('--pc-high'));
    u.uMove.value.set(cssVar('--accent-text'));
    u.uStatic.value.set(cssVar('--accent-2'));
    u.uBase.value = light ? 1.25 : 1;
    u.uLight.value = light ? 1 : 0;
    mat.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    mat.needsUpdate = true;
    guideMat.color.set(cssVar('--pc-ground'));
    const line = new THREE.Color(cssVar('--accent-text'));
    trackMat.color.copy(line);
    coastMat.color.copy(line);
    navMat.color.set(cssVar('--accent-2'));
    pingMat.color.set(cssVar('--accent-2'));
    costMat.uniforms.uLow.value.set(cssVar('--accent-2'));
    costMat.uniforms.uHigh.value.set(cssVar('--cost-high'));
    for (const k of pool) {
      for (let i = 0; i < TRAIL; i++) {
        k.trailCol.set([line.r, line.g, line.b, 0.75 * (1 - i / (TRAIL - 1)) ** 1.5], i * 4);
      }
      k.trail.geometry.attributes.color.needsUpdate = true;
    }
  };
  applyTheme();

  // 文字が左にあるので、広い画面ではシーンの中心を右に寄せる。
  // 狭い画面の操作モードでは、下にパネルが来るので上に寄せる
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    if (w >= 920) camera.setViewOffset(w, h, -w * 0.17, h * 0.03, w, h);
    else camera.setViewOffset(w, h, 0, labOn ? h * 0.2 : -h * 0.12, w, h);
    camera.updateProjectionMatrix();
    mat.uniforms.uScale.value = Math.min(h, 980) * 0.055;
    measureBlocked();
  };

  // ----- 視点。ふだんは自動でゆっくり動き、操作モードではドラッグで回す -----
  const view = { az: 0.42, el: 0.47, dist: small ? 40 : 33, x: 0, z: 0 }; // いま描いている視点
  const orbit = { az: 0.42, el: 0.47, dist: small ? 36 : 30 }; // 操作モードで指定された視点
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

  let time = 8;
  const render = () => {
    pointer.x += (pointer.tx - pointer.x) * 0.045;
    pointer.y += (pointer.ty - pointer.y) * 0.045;
    // 壁の裏に回り込まないよう、開けた側で左右に振る
    const want = labOn
      ? orbit
      : { az: 0.42 + Math.sin(time * 0.05) * 0.5 + pointer.x * 0.22, el: 0.47 - pointer.y * 0.06, dist: small ? 40 : 33 };
    const ease = labOn ? 0.2 : 0.06;
    view.az += (want.az - view.az) * ease;
    view.el += (want.el - view.el) * ease;
    view.dist += (want.dist - view.dist) * ease;
    const ex = state[S.X];
    const ez = state[S.Z];
    view.x += (ex - view.x) * 0.05;
    view.z += (ez - view.z) * 0.05;
    camera.position.set(
      view.x + Math.cos(view.az) * Math.cos(view.el) * view.dist,
      Math.sin(view.el) * view.dist,
      view.z + Math.sin(view.az) * Math.cos(view.el) * view.dist
    );
    camera.lookAt(view.x, 0.8, view.z);
    camera.updateMatrixWorld();

    ego.position.set(ex, 0, ez);
    ego.rotation.y = -state[S.YAW];
    rings.position.set(ex, 0, ez);
    mat.uniforms.uEgo.value.set(ex, ez);
    if (ping.visible) {
      pingT += 0.03;
      ping.scale.setScalar(0.3 + pingT * 1.2);
      pingMat.opacity = Math.max(0, 1 - pingT);
      ping.visible = pingT < 1;
    }
    placeTracks();
    renderer.render(scene, camera);
  };

  // ----- 新しいスキャンが出るたびに、点群・経路・コストマップを描画用に写す -----
  const fmt = (x) => Math.round(x).toLocaleString('en-US');
  const fmtMs = (x) => (x > 50 ? '–' : x < 0.01 ? '< 0.01 ms' : `${x.toFixed(2)} ms`);
  const setText = (sel, text) => {
    const el = $(sel);
    if (el && el.textContent !== text) el.textContent = text;
  };
  let hudAt = 0;
  const onScan = () => {
    const n = state[S.POINTS];
    pointData.set(pointsSrc.subarray(0, n * POINT_STRIDE));
    if (pointBuf.clearUpdateRanges) {
      pointBuf.clearUpdateRanges();
      pointBuf.addUpdateRange(0, n * POINT_STRIDE);
    }
    pointBuf.needsUpdate = true;
    geo.setDrawRange(0, n);

    const pn = state[S.PATH_N];
    pathLine.visible = pn > 1;
    if (pn > 1) {
      for (let i = 0; i < pn; i++) {
        pathPos[i * 3] = pathSrc[i * 2];
        pathPos[i * 3 + 1] = 0.04;
        pathPos[i * 3 + 2] = pathSrc[i * 2 + 1];
      }
      pathGeo.attributes.position.needsUpdate = true;
      pathGeo.setDrawRange(0, pn);
    }
    goalMark.visible = state[S.HAS_GOAL] > 0;
    goalMark.position.set(state[S.GX], 0, state[S.GZ]);

    if (costOn) {
      for (let i = 0; i < GRID * GRID; i++) costData[i * 4] = costSrc[i];
      costTex.needsUpdate = true;
    }

    // 数値の表示は 1 秒に 2 回だけ書き換える（毎回だと数字がちらつく）
    const now = performance.now();
    if (now - hudAt < 480) return;
    hudAt = now;
    setText('.hud-pts', `${fmt(n)} pts`);
    setText('.hud-tracks', `${fmt(state[S.TRACKS])} tracks`);
    setText('.hud-ms', `Rust/Wasm ${fmtMs(state[S.MS + 5])}`);
    if (!labOn) return;
    setText('#lab-v1', trf('lab.v1', fmt(state[S.RAYS]), fmt(n)));
    setText('#lab-v2', trf('lab.v2', fmt(state[S.GROUND])));
    setText('#lab-v3', trf('lab.v3', fmt(state[S.CLUSTERS])));
    setText('#lab-v4', trf('lab.v4', fmt(state[S.TRACKS])));
    setText('#lab-v5', trf('lab.v5', state[S.HAS_GOAL] > 0 ? state[S.NAV] : 0, state[S.REMAIN].toFixed(1)));
    for (let i = 0; i < 6; i++) setText(`#lab-t${i + 1}`, fmtMs(state[S.MS + i]));
    measureBlocked();
  };

  // ----- 描画ループ。ヒーローが画面に見えている間だけ動かす -----
  const clock = new THREE.Clock();
  let raf = 0;
  let onScreen = true;
  let failures = 0;
  const frame = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    time += dt;
    try {
      const scanned = sim.tick(dt);
      refresh(); // tick の中でメモリが拡張されることがあるので、読む前に確かめる
      if (scanned) onScan();
      render();
    } catch (e) {
      // 処理が異常終了したら最初の状態からやり直す。繰り返すようなら止める
      console.error(e);
      if (++failures > 2) return;
      sim.reset();
      refresh(true);
    }
    raf = requestAnimationFrame(frame);
  };
  // 動きを減らす設定では、操作モードのときだけ動かす
  const shouldRun = () => onScreen && (!reduce || labOn);
  const sync = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    if (shouldRun()) {
      clock.getDelta();
      raf = requestAnimationFrame(frame);
    } else if (onScreen) {
      render();
    }
  };

  // ----- 操作モードの UI -----
  const hint = $('#lab-hint');
  let hintTimer = 0;
  const flashHint = (key) => {
    if (!hint) return;
    hint.dataset.i18n = key;
    hint.innerHTML = tr(key);
    hint.classList.toggle('warn', key !== 'lab.hint');
    clearTimeout(hintTimer);
    if (key !== 'lab.hint') hintTimer = setTimeout(() => flashHint('lab.hint'), 2400);
  };
  const press = (buttons, active) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === active)));
  const setCost = (on) => {
    costOn = on;
    costPlane.visible = on;
    sim.show_costmap(on ? 1 : 0);
    $('#lab-cost')?.setAttribute('aria-pressed', String(on));
  };
  const setLab = (on) => {
    labOn = on;
    hero.classList.toggle('lab-on', on);
    $('#lab-open')?.setAttribute('aria-expanded', String(on));
    if (on) {
      orbit.az = view.az;
      orbit.el = view.el;
      hero.scrollIntoView({ block: 'start' });
    } else {
      // 閉じたら、表示を元に戻してロボットを最初の位置へ帰す
      mat.uniforms.uMode.value = 0;
      press([...document.querySelectorAll('[data-view]')], $('[data-view="0"]'));
      setCost(false);
      sim.set_goal(0, 0);
    }
    hudAt = 0;
    resize();
    sync();
  };
  if (lab) {
    $('#lab-open')?.addEventListener('click', () => setLab(!labOn));
    $('#lab-close')?.addEventListener('click', () => {
      setLab(false);
      $('#lab-open')?.focus();
    });
    hero.addEventListener('keydown', (e) => e.key === 'Escape' && labOn && setLab(false));
    const viewBtns = [...document.querySelectorAll('[data-view]')];
    viewBtns.forEach((b) =>
      b.addEventListener('click', () => {
        mat.uniforms.uMode.value = Number(b.dataset.view);
        press(viewBtns, b);
      })
    );
    const toolBtns = [...document.querySelectorAll('[data-tool]')];
    toolBtns.forEach((b) =>
      b.addEventListener('click', () => {
        tool = b.dataset.tool;
        press(toolBtns, b);
      })
    );
    $('#lab-cost')?.addEventListener('click', () => setCost(!costOn));
    $('#lab-zoom-in')?.addEventListener('click', () => (orbit.dist = clamp(orbit.dist * 0.8, 12, 60)));
    $('#lab-zoom-out')?.addEventListener('click', () => (orbit.dist = clamp(orbit.dist * 1.25, 12, 60)));
    $('#lab-reset')?.addEventListener('click', () => {
      sim.reset();
      sim.show_costmap(costOn ? 1 : 0);
      for (let i = 0; i < 40; i++) sim.tick(0.05);
      refresh(true);
      hudAt = 0;
      onScan();
    });

    // 地面のクリック位置を求める
    const caster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    const act = (e) => {
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      caster.setFromCamera(ndc, camera);
      if (!caster.ray.intersectPlane(ground, hit)) return;
      const ok =
        tool === 'goal' ? sim.set_goal(hit.x, hit.z) : tool === 'walker' ? sim.add_walker(hit.x, hit.z) : sim.add_obstacle(hit.x, hit.z);
      if (!ok) {
        flashHint(tool === 'goal' ? 'lab.no.goal' : 'lab.no.place');
        return;
      }
      ping.position.set(hit.x, 0, hit.z);
      ping.visible = true;
      pingT = 0;
    };

    // ドラッグで視点を回す。ほとんど動かさずに離したらクリックとして扱う。2 本指は拡大・縮小
    const touches = new Map();
    let moved = 0;
    let pinch = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (!labOn) return;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (err) {}
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = touches.size > 1 ? 99 : 0;
      pinch = 0;
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = touches.get(e.pointerId);
      if (!labOn || !p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) orbit.dist = clamp((orbit.dist * pinch) / d, 12, 60);
        pinch = d;
        return;
      }
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved < 6) return;
      orbit.az += dx * 0.006;
      orbit.el = clamp(orbit.el + dy * 0.005, 0.16, 1.4);
    });
    const release = (e) => {
      if (!touches.delete(e.pointerId) || !labOn) return;
      if (e.type === 'pointerup' && moved < 6) act(e);
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  $('.hud-beams') && ($('.hud-beams').textContent = `${beams} beams`);

  // 最初の画面から追跡が出ているよう、表示の前に 3 秒ぶん進めておく。
  // 一度に進めると画面が止まるので、数フレームに分ける
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 10; j++) sim.tick(0.05);
    if (!reduce && i < 5) await new Promise((done) => setTimeout(done, 16));
  }
  refresh(true);
  onScan();
  resize();
  hero.classList.add('lidar-on');

  const onTheme = () => {
    applyTheme();
    if (!raf) render();
  };
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', onTheme);
  new ResizeObserver(() => {
    resize();
    if (!raf) render();
  }).observe(canvas);
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    sync();
  }).observe(hero);
};

setupDetection();
// 背景は本文の表示を優先して、ブラウザが空いたときに読み込む
(window.requestIdleCallback || ((fn) => setTimeout(fn, 300)))(() => setupLidar());
