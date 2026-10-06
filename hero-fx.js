// =========================================================
// ヒーローの演出
//   1. ブラウザ内の物体検出デモ（MediaPipe / EfficientDet-Lite0）
//      - ボタンを押したときだけモデルを読み込む。カメラも押したときだけ起動する
//      - 映像はブラウザ内で処理し、どこにも送信・保存しない
//   2. LiDAR 風の点群背景（three.js）
//      - 点群はコード内で生成した疑似データ（実在のデータセットは使っていない）
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
    const colPerson = cssVar('--accent-2');
    const colOther = cssVar('--accent');
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
      ctx.shadowColor = col;
      ctx.shadowBlur = 12;
      ctx.strokeRect(x, y, w, h);
      ctx.shadowBlur = 0;

      const label = `${c.categoryName} ${c.score.toFixed(2)}`;
      ctx.font = '500 11px "JetBrains Mono", monospace';
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
    hudFps.textContent = `${Math.round(performance.now() - t0)} ms`;
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
// 2. LiDAR 風の点群背景
// ---------------------------------------------------------
const OBJECTS = [
  { type: 'box', x: 7, z: -4, w: 1.9, d: 4.3, h: 1.5 }, // 車
  { type: 'box', x: -6, z: 9, w: 2.0, d: 4.6, h: 1.6 },
  { type: 'box', x: 12, z: 10, w: 2.4, d: 6.0, h: 2.6 }, // トラック
  { type: 'cyl', x: 3, z: 6, r: 0.35, h: 1.75 }, // 歩行者
  { type: 'cyl', x: 4.2, z: 6.6, r: 0.33, h: 1.65 },
  { type: 'cyl', x: -9, z: -7, r: 0.35, h: 1.8 },
  { type: 'wall', x: -16 }, // 建物の壁
];

// センサーから放射状にビームを出し、最初に当たった地面・物体の位置に点を置く
const generatePoints = (rings, perRing) => {
  const hit = (x, z) => {
    for (const o of OBJECTS) {
      if (o.type === 'box' && Math.abs(x - o.x) < o.w / 2 && Math.abs(z - o.z) < o.d / 2) return o;
      if (o.type === 'cyl' && Math.hypot(x - o.x, z - o.z) < o.r) return o;
      if (o.type === 'wall' && x < o.x) return o;
    }
    return null;
  };
  const out = [];
  const sensorH = 1.9;
  for (let ring = 0; ring < rings; ring++) {
    const slope = Math.tan(-0.42 + (ring / rings) * 0.5);
    for (let i = 0; i < perRing; i++) {
      const ang = (i / perRing) * Math.PI * 2;
      const cx = Math.cos(ang);
      const cz = Math.sin(ang);
      for (let r = 1; r < 38; r += 0.08) {
        const y = sensorH + slope * r;
        if (y <= 0) {
          out.push(cx * r, 0, cz * r, 0);
          break;
        }
        const o = hit(cx * r, cz * r);
        if (o && y <= (o.type === 'wall' ? 9 : o.h)) {
          out.push(cx * r, y, cz * r, o.type === 'wall' ? 2 : 1);
          break;
        }
        if (y > 12) break;
      }
    }
  }
  return out;
};

const setupLidar = async () => {
  const canvas = $('.lidar');
  const hero = $('.hero');
  if (!canvas || !hero) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = window.innerWidth < 760;

  let THREE;
  let renderer;
  try {
    THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !small, alpha: true });
  } catch (e) {
    return; // WebGL が使えない環境では背景なし（グリッドだけ）
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.25 : 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);

  // スマホでは点の数を減らす
  const raw = generatePoints(small ? 18 : 32, small ? 480 : 900);
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

  // 回転するビームが通過した直後の点を明るくし、時間とともに暗くする
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uSweep: { value: 0 },
      uPix: { value: renderer.getPixelRatio() },
      uGround: { value: new THREE.Color() },
      uObj: { value: new THREE.Color() },
      uWall: { value: new THREE.Color() },
      uBase: { value: 1 },
    },
    vertexShader: `
      attribute float kind; attribute float ang;
      uniform float uSweep; uniform float uPix;
      varying float vGlow; varying float vKind;
      void main() {
        float d = mod(uSweep - ang + 6.28318, 6.28318);
        vGlow = exp(-d * 1.6);
        vKind = kind;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (1.4 + vGlow * 1.8) * uPix * (22.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uGround; uniform vec3 uObj; uniform vec3 uWall; uniform float uBase;
      varying float vGlow; varying float vKind;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        if (dot(c, c) > 0.25) discard;
        vec3 col = vKind > 1.5 ? uWall : (vKind > 0.5 ? uObj : uGround);
        float base = vKind > 0.5 ? 0.35 : 0.12;
        gl_FragColor = vec4(col, (base + vGlow * 0.85) * uBase);
      }`,
  });
  scene.add(new THREE.Points(geo, mat));

  // 物体を囲む 3D バウンディングボックス（検出結果のイメージ）
  const boxMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55 });
  for (const o of OBJECTS) {
    if (o.type === 'wall') continue;
    const w = o.type === 'box' ? o.w : o.r * 2.4;
    const d = o.type === 'box' ? o.d : o.r * 2.4;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, o.h, d)), boxMat);
    edges.position.set(o.x, o.h / 2, o.z);
    scene.add(edges);
  }

  // テーマ（ダーク / ライト）に合わせて色と重ね方を切り替える
  const applyTheme = () => {
    const light = getComputedStyle(document.documentElement).colorScheme.includes('light');
    mat.uniforms.uGround.value.set(cssVar('--accent'));
    mat.uniforms.uObj.value.set(cssVar('--accent-2'));
    mat.uniforms.uWall.value.set(cssVar('--muted'));
    mat.uniforms.uBase.value = light ? 0.75 : 1;
    mat.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    mat.needsUpdate = true;
    boxMat.color.set(cssVar('--accent-2'));
    boxMat.opacity = light ? 0.45 : 0.55;
  };
  applyTheme();
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };

  const clock = new THREE.Clock();
  const render = (time) => {
    mat.uniforms.uSweep.value = (time * 2.2) % (Math.PI * 2);
    const a = 0.6 + time * 0.05;
    camera.position.set(Math.cos(a) * 26, 13, Math.sin(a) * 26);
    camera.lookAt(-9, 0, 2);
    renderer.render(scene, camera);
  };

  resize();
  window.addEventListener('resize', () => {
    resize();
    if (reduce) render(6);
  });

  // 動きを減らす設定では静止画を1枚だけ描く
  if (reduce) {
    render(6);
    new MutationObserver(() => render(6)).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return;
  }

  // ヒーローが画面に見えている間だけ描画する
  let visible = true;
  let raf = 0;
  const loop = () => {
    render(clock.getElapsedTime());
    raf = requestAnimationFrame(loop);
  };
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    cancelAnimationFrame(raf);
    if (visible) loop();
  }).observe(hero);
};

setupDetection();
// 背景は本文の表示を優先して、ブラウザが空いたときに読み込む
(window.requestIdleCallback || ((fn) => setTimeout(fn, 300)))(() => setupLidar());
