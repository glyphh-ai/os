// face — the holographic head at the center of the OS. A sphere sculpted into
// a humanoid head in code (no model file), drawn as a fresnel shell, a cloud of
// points and a wire lattice, with HUD rings around it. The jaw opens with the
// loudness of the voice that is playing.
import * as THREE from "three";

const PURPLE = new THREE.Color("#ad5df8");
const LILAC = new THREE.Color("#d6b4ff");
const LISTEN = new THREE.Color("#7fd4ff");

const g = (x, s) => Math.exp(-(x * x) / (2 * s * s));
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Sculpt the unit sphere into a head; returns per-vertex jaw weights. */
function sculpt(geo) {
  const p = geo.attributes.position;
  const jaw = new Float32Array(p.count);
  const lip = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // skull proportions
    x *= 0.8; y *= 1.02; z *= 0.92;
    if (y > 0) { x *= 1 + 0.06 * Math.sin(y * Math.PI); y *= 0.94; }                 // a rounder crown
    if (y < 0) { const k = 1 - 0.3 * Math.pow(-y, 2.2); x *= k; z *= 1 - 0.12 * Math.pow(-y, 2); }
    if (y < -0.55) { x *= 1 - 0.35 * (-y - 0.55); }                                  // square the jaw into a chin
    if (z < 0) { z *= 1.04; y += 0.04 * -z; }                                         // the back of the skull
    if (Math.abs(x) > 0.55 && y > -0.2 && y < 0.35) x *= 0.97;                        // temples
    const front = smooth(0.1, 0.6, z / 0.88);
    if (front > 0) {
      // eye sockets, brow, nose, cheeks, lips, chin
      const sock = g(Math.abs(x) - 0.25, 0.09) * g(y - 0.13, 0.07);
      z -= 0.11 * sock * front;
      z += 0.045 * g(y - 0.27, 0.05) * g(Math.abs(x) - 0.22, 0.16) * front;
      const noseY = smooth(0.18, -0.16, y) * (y > -0.22 ? 1 : g(y + 0.22, 0.03));
      z += 0.2 * g(x, 0.055 + 0.04 * smooth(0.1, -0.2, y)) * noseY * front;
      z += 0.05 * g(Math.abs(x) - 0.4, 0.09) * g(y + 0.06, 0.1) * front;
      z -= 0.035 * g(Math.abs(x) - 0.33, 0.07) * g(y + 0.28, 0.08) * front; // cheek hollow
      const lips = g(x, 0.17);
      z += 0.035 * lips * (g(y + 0.35, 0.025) + g(y + 0.44, 0.03)) * front;
      z -= 0.025 * lips * g(y + 0.395, 0.012) * front; // the mouth line
      z += 0.06 * g(x, 0.14) * g(y + 0.74, 0.07) * front; // chin
      jaw[i] = smooth(-0.37, -0.45, y) * smooth(-0.4, 0.2, z);
      lip[i] = g(x, 0.2) * g(y + 0.35, 0.03) * front;
    }
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return { jaw, lip, base: Float32Array.from(p.array) };
}

function dotTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const x = c.getContext("2d");
  const grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.3, "rgba(214,180,255,0.7)"); grd.addColorStop(1, "rgba(173,93,248,0)");
  x.fillStyle = grd; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const shellVert = `
  varying vec3 vN; varying vec3 vV; varying vec3 vP;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vP = wp.xyz; vN = normalize(normalMatrix * normal);
    vec4 mv = viewMatrix * wp; vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const shellFrag = `
  uniform vec3 uColor; uniform float uTime; uniform float uGlow;
  varying vec3 vN; varying vec3 vV; varying vec3 vP;
  void main() {
    float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
    float scan = 0.55 + 0.45 * sin(vP.y * 90.0 - uTime * 3.0);
    float band = smoothstep(0.0, 0.02, abs(fract(vP.y * 0.6 - uTime * 0.12) - 0.5) - 0.47);
    float a = (f * 0.75) * scan * uGlow + (1.0 - band) * 0.12 * uGlow * f;
    gl_FragColor = vec4(uColor * (0.6 + f * 1.4), a);
  }`;

export function createFace(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0.05, 7);

  const head = new THREE.Group();
  scene.add(head);

  const geo = new THREE.SphereGeometry(1, 128, 96);
  const { jaw, lip, base } = sculpt(geo);
  const color = PURPLE.clone();

  const shellMat = new THREE.ShaderMaterial({
    vertexShader: shellVert, fragmentShader: shellFrag, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    uniforms: { uColor: { value: color }, uTime: { value: 0 }, uGlow: { value: 1 } },
  });
  head.add(new THREE.Mesh(geo, shellMat));

  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.013, map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: LILAC, opacity: 0.32,
  }));
  head.add(pts);

  const wireGeo = new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 36, 26));
  const wire = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: PURPLE, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending }));
  wire.scale.set(0.8, 1.1, 0.92);
  head.add(wire);

  // eyes
  const eyes = [];
  for (const sx of [-1, 1]) {
    const e = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), new THREE.MeshBasicMaterial({ color: LILAC }));
    core.scale.set(1.5, 0.75, 0.5);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color: PURPLE, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8 }));
    glow.scale.set(0.2, 0.14, 1);
    e.add(core, glow);
    e.position.set(sx * 0.21, 0.13, 0.69);
    head.add(e); eyes.push(e);
  }

  // HUD rings
  const hud = new THREE.Group();
  scene.add(hud);
  const ringMat = (o) => new THREE.MeshBasicMaterial({ color: PURPLE, transparent: true, opacity: o, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const rings = [];
  const addRing = (r, w, arc, tiltX, o, speed) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(r, r + w, 160, 1, 0, arc), ringMat(o));
    m.rotation.x = tiltX; hud.add(m); rings.push({ m, speed });
  };
  addRing(1.55, 0.008, Math.PI * 2, Math.PI / 2.15, 0.35, 0.1);
  addRing(1.62, 0.025, Math.PI * 1.2, Math.PI / 2.15, 0.25, -0.25);
  addRing(1.75, 0.006, Math.PI * 0.5, Math.PI / 2.15, 0.6, 0.6);
  addRing(1.9, 0.004, Math.PI * 2, Math.PI / 2.3, 0.12, 0.05);
  addRing(1.35, 0.012, Math.PI * 0.35, 0.2, 0.4, 0.8);
  addRing(1.42, 0.004, Math.PI * 1.6, -0.25, 0.2, -0.4);
  hud.position.y = -0.15;

  // drifting motes
  const N = 500, motes = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 1.8 + Math.random() * 1.8, a = Math.random() * Math.PI * 2, y = (Math.random() - 0.5) * 3.4;
    motes.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
  }
  const moteGeo = new THREE.BufferGeometry(); moteGeo.setAttribute("position", new THREE.BufferAttribute(motes, 3));
  const moteCloud = new THREE.Points(moteGeo, new THREE.PointsMaterial({ size: 0.02, map: dotTexture(), color: PURPLE, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(moteCloud);

  // state
  let state = "idle", mouth = 0, mouthTarget = 0, mic = 0, mx = 0, my = 0, blink = 0, nextBlink = 2;
  const spin = { idle: 1, listening: 1.6, thinking: 4.5, speaking: 1.4 };
  window.addEventListener("pointermove", (e) => { mx = (e.clientX / innerWidth - 0.5) * 2; my = (e.clientY / innerHeight - 0.5) * 2; });

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.z = w / h < 1 ? 7 / (w / h) * 0.8 : 7;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const pos = geo.attributes.position;
  const clock = new THREE.Clock();
  let visible = true;
  document.addEventListener("visibilitychange", () => { visible = !document.hidden; });

  function frame() {
    requestAnimationFrame(frame);
    if (!visible || !canvas.clientWidth) return;
    const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
    shellMat.uniforms.uTime.value = t;

    // jaw
    mouth += (mouthTarget - mouth) * Math.min(1, dt * 18);
    const open = Math.min(1, mouth * 1.4);
    for (let i = 0; i < pos.count; i++) {
      const w = jaw[i], l = lip[i];
      if (!w && !l) continue;
      const by = base[i * 3 + 1], bz = base[i * 3 + 2];
      pos.setY(i, by - open * 0.13 * w + open * 0.015 * l);
      pos.setZ(i, bz - open * 0.03 * w);
    }
    pos.needsUpdate = true;
    if (open > 0.01 || mouth > 0.001) geo.computeVertexNormals();

    // color by state
    const want = state === "listening" ? LISTEN : PURPLE;
    color.lerp(want, dt * 3);
    shellMat.uniforms.uGlow.value = 0.85 + 0.15 * Math.sin(t * 1.3) + (state === "listening" ? mic * 1.5 : 0) + open * 0.4;

    // head motion: breathe, look at the pointer, nod while thinking
    head.rotation.y += ((mx * 0.35 + Math.sin(t * 0.25) * 0.3) - head.rotation.y) * dt * 2.5;
    head.rotation.x += ((my * 0.18 + (state === "thinking" ? Math.sin(t * 2) * 0.04 : 0)) - head.rotation.x) * dt * 2.5;
    head.position.y = Math.sin(t * 0.9) * 0.025;

    // blink
    nextBlink -= dt;
    if (nextBlink < 0) { blink = 1; nextBlink = 2 + Math.random() * 4; }
    blink = Math.max(0, blink - dt * 7);
    for (const e of eyes) { e.scale.y = 1 - Math.sin(blink * Math.PI) * 0.9; e.children[1].material.color.copy(color); }

    for (const r of rings) r.m.rotation.z += r.speed * dt * spin[state];
    hud.rotation.y = head.rotation.y * 0.3;
    moteCloud.rotation.y += dt * 0.03 * spin[state];

    renderer.render(scene, camera);
  }
  frame();

  return {
    setState(s) { state = spin[s] ? s : "idle"; },
    setMouth(level) { mouthTarget = level; },
    setMic(level) { mic = level; },
  };
}
