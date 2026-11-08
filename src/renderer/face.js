// face — the holographic character at the center of the OS: a human bust
// (character.js) drawn as contour lines, a wire grid, points or a hologram
// shell, with glowing eyes and HUD rings. The jaw opens with the loudness of
// the voice that is playing; the head turns toward the pointer and breathes.
import * as THREE from "three";
import { mesh as buildMesh, PRESETS } from "./character.js";

const LISTEN = new THREE.Color("#7fd4ff");
const STYLE_ID = { contour: 0, grid: 1, hologram: 2, points: 3 };

const vert = `
  uniform float uOpen; uniform float uTime;
  varying vec3 vN; varying vec3 vV; varying vec3 vL;
  void main() {
    vec3 p = position;
    // the ears twitch a little while it talks
    float ear = smoothstep(0.95, 1.6, p.y);
    p.x += ear * (p.x < 0.0 ? -1.0 : 1.0) * uOpen * 0.06 * sin(uTime * 18.0);
    vL = p;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const frag = `
  uniform vec3 uColor; uniform float uTime; uniform float uGlow; uniform int uStyle; uniform float uDensity;
  varying vec3 vN; varying vec3 vV; varying vec3 vL;
  float line(float g) { float w = fwidth(g); return 1.0 - smoothstep(0.0, 1.4 * w, abs(fract(g - 0.5) - 0.5)); }
  void main() {
    float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
    float fade = 1.0;
    float sweep = smoothstep(0.06, 0.0, abs(fract(vL.y * 0.22 - uTime * 0.18) - 0.5) - 0.44);
    float a; vec3 col = uColor;
    if (uStyle == 0) {          // contour lines
      float l = line(vL.y * uDensity);
      a = l * (0.45 + 0.75 * f) + f * 0.18;
    } else if (uStyle == 1) {   // wire grid: latitude + longitude
      float lon = atan(vL.x, vL.z) / 6.2831853 * uDensity * 3.2;
      float l = max(line(vL.y * uDensity), line(lon));
      a = l * (0.4 + 0.7 * f) + f * 0.12;
    } else {                    // hologram shell
      float scan = 0.6 + 0.4 * sin(vL.y * 140.0 - uTime * 4.0);
      a = (f * 0.95 + 0.05) * scan;
    }
    a = (a + sweep * 0.35 * (0.3 + f)) * uGlow * fade;
    gl_FragColor = vec4(col * (0.75 + f * 0.9), a);
  }`;

function dotTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.3, "rgba(255,255,255,0.6)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function createFace(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const target = new THREE.Vector3(0.05, 0.05, 0);

  const bust = new THREE.Group(); scene.add(bust);
  const head = new THREE.Group(); bust.add(head);
  const color = new THREE.Color("#ad5df8");
  const baseColor = new THREE.Color("#ad5df8");
  const dot = dotTexture();

  const uniforms = { uColor: { value: color }, uTime: { value: 0 }, uGlow: { value: 1 }, uOpen: { value: 0 }, uStyle: { value: 0 }, uDensity: { value: 22 } };
  const lineMat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, transparent: true, depthWrite: false, depthFunc: THREE.LessEqualDepth, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  // a depth-only copy first, so lines on the far side of the head stay hidden: reads as a solid wireframe
  const occluder = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: "void main(){ gl_FragColor = vec4(0.0); }", uniforms, colorWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const pointMat = new THREE.PointsMaterial({ size: 0.016, map: dot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color, opacity: 0.6 });

  let geo = null, occMesh = null, lineMesh = null, points = null;
  // the one big eye: a bright oval ring, and a pupil off to the right that dilates as it talks
  const eye = new THREE.Group(); head.add(eye);
  // the eye draws over the body (it sits in a socket the body would otherwise hide)
  const glowMat = (o) => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 128), glowMat(0.9));
  const ringGlow = new THREE.Mesh(new THREE.RingGeometry(0.72, 1.2, 128), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
  const pupil = new THREE.Mesh(new THREE.CircleGeometry(1, 48), glowMat(0.95));
  const pupilGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false }));
  eye.add(ringGlow, ring, pupil, pupilGlow);
  for (const o of eye.children) o.renderOrder = 5;
  let eyeSpec = { rx: 0.5, ry: 0.34, pupil: 1 };

  let character = PRESETS.glyphh;
  function setCharacter(c, quick) {
    character = c;
    const m = buildMesh(c, quick ? 56 : 84);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
    g.setIndex(new THREE.BufferAttribute(m.index, 1));
    g.computeBoundingSphere();
    geo?.dispose(); geo = g;
    for (const o of [occMesh, lineMesh, points]) if (o) head.remove(o);
    occMesh = new THREE.Mesh(g, occluder); occMesh.renderOrder = 0;
    lineMesh = new THREE.Mesh(g, lineMat); lineMesh.renderOrder = 1;
    points = new THREE.Points(g, pointMat);
    const style = STYLE_ID[c.style] ?? 0;
    uniforms.uStyle.value = Math.min(style, 2);
    head.add(occMesh);
    if (style === 3) head.add(points); else head.add(lineMesh);
    eyeSpec = m.eye;
    eye.position.set(m.eye.x, m.eye.y, m.eye.z);
    ring.scale.set(m.eye.rx, m.eye.ry, 1); ringGlow.scale.copy(ring.scale);
    baseColor.set(c.color || "#ad5df8");
    uniforms.uDensity.value = c.density || 22;
  }

  // HUD rings around the bust
  const hud = new THREE.Group(); scene.add(hud);
  const rings = [];
  const ringMat = (o) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const addRing = (r, w, arc, tilt, o, speed, y = 0) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(r, r + w, 180, 1, 0, arc), ringMat(o));
    m.rotation.x = tilt; m.position.y = y; hud.add(m); rings.push({ m, speed });
  };
  addRing(1.7, 0.008, Math.PI * 2, Math.PI / 2.1, 0.3, 0.1, -2.05);
  addRing(1.78, 0.03, Math.PI * 1.1, Math.PI / 2.1, 0.22, -0.25, -2.05);
  addRing(1.95, 0.006, Math.PI * 0.45, Math.PI / 2.1, 0.55, 0.6, -2.05);
  addRing(1.75, 0.005, Math.PI * 1.7, Math.PI / 2.05, 0.16, -0.4, 0.4);
  addRing(2.0, 0.012, Math.PI * 0.3, 0.12, 0.3, 0.7, 0.1);

  // drifting motes
  const N = 420, motes = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const r = 1.9 + Math.random() * 1.8, a = Math.random() * Math.PI * 2; motes.set([Math.cos(a) * r, -2 + Math.random() * 3.6, Math.sin(a) * r], i * 3); }
  const mg = new THREE.BufferGeometry(); mg.setAttribute("position", new THREE.BufferAttribute(motes, 3));
  const moteCloud = new THREE.Points(mg, new THREE.PointsMaterial({ size: 0.018, map: dot, color, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(moteCloud);

  let state = "idle", mouth = 0, mouthTarget = 0, mic = 0, mx = 0, my = 0, blink = 0, nextBlink = 2;
  const spin = { idle: 1, listening: 1.6, thinking: 4.5, speaking: 1.4 };
  window.addEventListener("pointermove", (e) => { mx = (e.clientX / innerWidth - 0.5) * 2; my = (e.clientY / innerHeight - 0.5) * 2; });

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    const dist = 10.5 * Math.max(1, 0.85 / (w / h));
    camera.position.set(0.05, 0.3, dist); camera.lookAt(target);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas); resize();

  let last = performance.now(), t = 0;
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    if (document.hidden || !canvas.clientWidth) return;
    uniforms.uTime.value = t;
    mouth += (mouthTarget - mouth) * Math.min(1, dt * 18);
    uniforms.uOpen.value = Math.min(1, mouth * 1.4);
    color.lerp(state === "listening" ? LISTEN : baseColor, dt * 3);
    uniforms.uGlow.value = 0.9 + 0.1 * Math.sin(t * 1.3) + (state === "listening" ? mic * 1.2 : 0) + uniforms.uOpen.value * 0.3;
    // it turns toward the pointer, breathes, and bobs as it talks
    const open = uniforms.uOpen.value;
    head.rotation.y += ((mx * 0.5 + Math.sin(t * 0.25) * 0.2) - head.rotation.y) * dt * 2.5;
    head.rotation.x += ((my * 0.12 + (state === "thinking" ? Math.sin(t * 2) * 0.05 : 0)) - head.rotation.x) * dt * 2.5;
    head.rotation.z = Math.sin(t * 0.7) * 0.03 + open * 0.04 * Math.sin(t * 9);
    bust.position.y = Math.sin(t * 0.9) * 0.03 + open * 0.04;
    nextBlink -= dt; if (nextBlink < 0) { blink = 1; nextBlink = 2.5 + Math.random() * 4; }
    blink = Math.max(0, blink - dt * 6);
    const lid = 1 - Math.sin(blink * Math.PI) * 0.92;
    eye.scale.set(1, lid, 1);
    // the pupil looks toward the pointer, sits right of center like the mark, and dilates with the voice
    const pr = eyeSpec.ry * 0.26 * eyeSpec.pupil * (1 + open * 0.45 + (state === "listening" ? mic * 0.4 : 0));
    pupil.scale.set(pr, pr, 1);
    pupil.position.set(eyeSpec.rx * (0.3 + mx * 0.1), eyeSpec.ry * (0.05 - my * 0.12), 0.01);
    pupilGlow.position.copy(pupil.position); pupilGlow.scale.set(pr * 3.2, pr * 3.2, 1);
    ringGlow.material.opacity = 0.25 + open * 0.5 + (state === "listening" ? 0.2 : 0);
    ringGlow.material.color.copy(color); pupilGlow.material.color.copy(color);
    for (const r of rings) r.m.rotation.z += r.speed * dt * spin[state];
    moteCloud.rotation.y += dt * 0.03 * spin[state];
    renderer.render(scene, camera);
  }
  setCharacter(PRESETS.glyphh);
  frame();

  return {
    setState(s) { state = spin[s] ? s : "idle"; },
    setMouth(level) { mouthTarget = level; },
    setMic(level) { mic = level; },
    setCharacter,
    get character() { return character; },
  };
}
