// character — the Glyphh alien cat, in 3D: a wide head with two pointed ears
// (the left one tall and leaning out), one big oval eye with an off-center
// pupil, and the R-shaped body (a loop with a hole through it), two legs and a
// curled tail. It is a signed distance field of smoothly blended shapes,
// meshed with surface nets; every proportion is a slider, so variations are
// presets and anyone can make their own. No model files.

export const PARAMS = {
  head:   { label: "Head", min: 0.8, max: 1.25, step: 0.01 },
  headW:  { label: "Head width", min: 0.8, max: 1.25, step: 0.01 },
  earL:   { label: "Left ear", min: 0.5, max: 1.5, step: 0.01 },
  earR:   { label: "Right ear", min: 0.5, max: 1.5, step: 0.01 },
  earOut: { label: "Ear lean", min: 0.4, max: 1.6, step: 0.01 },
  eye:    { label: "Eye", min: 0.7, max: 1.3, step: 0.01 },
  pupil:  { label: "Pupil", min: 0.6, max: 1.6, step: 0.01 },
  body:   { label: "Body", min: 0.7, max: 1.3, step: 0.01 },
  loop:   { label: "Loop", min: 0, max: 1.4, step: 0.01 },
  legs:   { label: "Legs", min: 0.6, max: 1.4, step: 0.01 },
  tail:   { label: "Tail", min: 0, max: 1.5, step: 0.01 },
};
export const HAIR = []; // the cat has none; kept so the editor can hide the control
export const STYLES = { contour: "Contour lines", grid: "Wire grid", points: "Points", hologram: "Hologram" };

const base = Object.fromEntries(Object.keys(PARAMS).map((k) => [k, 1]));
export const PRESETS = {
  glyphh: { name: "Glyphh", ...base, style: "contour", color: "#ad5df8" },
};

// ── SDF primitives ────────────────────────────────────────────────────
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
function ell(px, py, pz, cx, cy, cz, rx, ry, rz) {
  const x = (px - cx) / rx, y = (py - cy) / ry, z = (pz - cz) / rz;
  const k0 = len3(x, y, z), k1 = len3(x / rx, y / ry, z / rz);
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}
function cap(px, py, pz, ax, ay, az, bx, by, bz, r) {
  const pax = px - ax, pay = py - ay, paz = pz - az, bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  return len3(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}
/** A capsule whose radius tapers from ra at a to rb at b: an ear, a horn, a claw. */
function cone(px, py, pz, ax, ay, az, bx, by, bz, ra, rb) {
  const pax = px - ax, pay = py - ay, paz = pz - az, bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  return len3(pax - bax * h, pay - bay * h, paz - baz * h) - (ra + (rb - ra) * h);
}
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);

/** The cat for a set of parameters: its distance field and where its eye goes. */
export function figure(c) {
  const q = { ...base, ...c };
  const hs = q.head, hw = q.headW * hs, bs = q.body, eo = q.earOut;
  const head = { x: 0.08, y: 0.42, z: 0 };
  // the eye is most of the face: a wide oval set toward the right
  const eye = { x: head.x + 0.2 * hw, y: head.y - 0.04, rx: 0.6 * q.eye * hw, ry: 0.42 * q.eye * hs };

  function sdf(x, y, z) {
    // head: a wide rounded triangle, broad on top, heavier on the eye side
    let d = ell(x, y, z, head.x, head.y + 0.05, head.z, 1.08 * hw, 0.72 * hs, 0.66 * hs);
    d = smin(d, ell(x, y, z, head.x + 0.32 * hw, head.y - 0.12, 0.06, 0.78 * hw, 0.62 * hs, 0.6 * hs), 0.25);
    // ears grow out of the head's top corners: the left one tall, broad and leaning out, the right one shorter
    d = smin(d, cone(x, y, z, head.x - 0.62 * hw, head.y + 0.36 * hs, -0.06, head.x - 0.62 * hw - 0.34 * eo, head.y + 0.36 * hs + 1.05 * q.earL, -0.1, 0.4 * hs, 0.025), 0.2);
    d = smin(d, cone(x, y, z, head.x + 0.66 * hw, head.y + 0.34 * hs, -0.06, head.x + 0.66 * hw + 0.34 * eo, head.y + 0.34 * hs + 0.7 * q.earR, -0.1, 0.32 * hs, 0.025), 0.18);
    // the eye sits in a shallow oval socket
    d = smax(d, -ell(x, y, z, eye.x, eye.y, 0.68 * hs, eye.rx * 0.92, eye.ry * 0.92, 0.14), 0.05);
    // body: the bowl of the R, with its left edge running straight down from the head
    const bx = -0.3;
    d = smin(d, ell(x, y, z, bx, -0.62 * bs, 0, 0.64 * bs, 0.7 * bs, 0.46 * bs), 0.32);
    if (q.loop > 0) d = smax(d, -cap(x, y, z, bx + 0.02, -0.66 * bs, -1, bx + 0.02, -0.66 * bs, 1, 0.24 * q.loop), 0.05);
    const lg = q.legs, footY = -0.62 * bs - 0.6 - 0.55 * lg;
    d = smin(d, cap(x, y, z, bx - 0.4, -0.9 * bs, 0.02, bx - 0.42, footY, 0.05, 0.16), 0.14);       // the straight leg
    d = smin(d, cap(x, y, z, bx + 0.42, -1.0 * bs, 0.02, bx + 0.9, footY, 0.05, 0.15), 0.12);       // the R's diagonal leg
    d = smin(d, ell(x, y, z, bx - 0.4, footY, 0.1, 0.22, 0.08, 0.22), 0.06);                        // feet
    d = smin(d, ell(x, y, z, bx + 0.95, footY, 0.1, 0.22, 0.08, 0.22), 0.06);
    if (q.tail > 0) { // a smooth curl off the back, up and to the right
      const t = q.tail, ox = bx + 0.75, oy = footY + 0.45;
      let px = ox, py = oy;
      for (let i = 1; i <= 8; i++) {
        const a = -0.35 + (i / 8) * 2.2, r = 0.55 * t;
        const nx2 = ox + Math.sin(a) * r * 1.2 + r * 0.25, ny2 = oy - 0.15 + (1 - Math.cos(a)) * r * 0.9;
        d = smin(d, cap(x, y, z, px, py, -0.12, nx2, ny2, -0.12, 0.08 - i * 0.005), 0.06);
        px = nx2; py = ny2;
      }
    }
    return d;
  }
  return { sdf, eye };
}

/** Surface nets: a clean, quad-dominant mesh of the cat, plus where to draw its eye. */
export function mesh(c, N = 84) {
  const { sdf, eye } = figure(c);
  const B = { x0: -1.7, x1: 1.9, y0: -2.25, y1: 2.35, z0: -1.0, z1: 1.0 };
  const nx = N, ny = Math.round(N * (B.y1 - B.y0) / (B.x1 - B.x0)), nz = Math.round(N * (B.z1 - B.z0) / (B.x1 - B.x0));
  const sx = (B.x1 - B.x0) / nx, sy = (B.y1 - B.y0) / ny, sz = (B.z1 - B.z0) / nz;
  const field = new Float32Array((nx + 1) * (ny + 1) * (nz + 1));
  const I = (i, j, k) => i + (nx + 1) * (j + (ny + 1) * k);
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++)
    field[I(i, j, k)] = sdf(B.x0 + i * sx, B.y0 + j * sy, B.z0 + k * sz);

  const vidx = new Int32Array(nx * ny * nz).fill(-1);
  const C = (i, j, k) => i + nx * (j + ny * k);
  const pos = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float32Array(8);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let inside = 0;
    for (let n = 0; n < 8; n++) { const [a, b, cc] = corners[n]; v[n] = field[I(i + a, j + b, k + cc)]; if (v[n] < 0) inside++; }
    if (inside === 0 || inside === 8) continue;
    let px = 0, py = 0, pz = 0, cnt = 0;
    for (const [e0, e1] of edges) {
      if ((v[e0] < 0) === (v[e1] < 0)) continue;
      const t = v[e0] / (v[e0] - v[e1]);
      const [a0, b0, c0] = corners[e0], [a1, b1, c1] = corners[e1];
      px += a0 + (a1 - a0) * t; py += b0 + (b1 - b0) * t; pz += c0 + (c1 - c0) * t; cnt++;
    }
    vidx[C(i, j, k)] = pos.length / 3;
    pos.push(B.x0 + (i + px / cnt) * sx, B.y0 + (j + py / cnt) * sy, B.z0 + (k + pz / cnt) * sz);
  }
  const idx = [];
  const quad = (a, b, c2, d) => { if (a >= 0 && b >= 0 && c2 >= 0 && d >= 0) idx.push(a, b, c2, a, c2, d); };
  for (let k = 1; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 1; i < nx; i++) {
    const inside = field[I(i, j, k)] < 0;
    if (inside !== (field[I(i + 1, j, k)] < 0)) quad(vidx[C(i, j - 1, k - 1)], vidx[C(i, j, k - 1)], vidx[C(i, j, k)], vidx[C(i, j - 1, k)]);
    if (inside !== (field[I(i, j + 1, k)] < 0)) quad(vidx[C(i - 1, j, k - 1)], vidx[C(i - 1, j, k)], vidx[C(i, j, k)], vidx[C(i, j, k - 1)]);
    if (inside !== (field[I(i, j, k + 1)] < 0)) quad(vidx[C(i - 1, j - 1, k)], vidx[C(i, j - 1, k)], vidx[C(i, j, k)], vidx[C(i - 1, j, k)]);
  }
  const n = new Float32Array(pos.length), e = 0.01;
  for (let p = 0; p < pos.length; p += 3) {
    const [x, y, z] = [pos[p], pos[p + 1], pos[p + 2]];
    const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1; n[p] = gx / l; n[p + 1] = gy / l; n[p + 2] = gz / l;
  }
  // the eye sits on the surface: march in from the front to find it
  let ez = 1.2; for (let s = 0; s < 80; s++) { const dd = sdf(eye.x, eye.y, ez); if (dd < 0.002) break; ez -= Math.max(dd, 0.005); }
  return {
    positions: new Float32Array(pos), normals: n,
    index: pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx),
    eye: { ...eye, z: ez + 0.02, pupil: { ...base, ...c }.pupil },
  };
}
