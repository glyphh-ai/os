// character — the Glyphh alien cat in 3D, built from the mascot's own outline
// (design/brand/cats): the leaning head with its big right ear, the small left
// ear, the ringed eye, the body with the gap between the legs, and the tail.
// The flat mark is extruded into a solid with rounded edges (a signed distance
// field, meshed with surface nets), so it is the mark, not a likeness of it.
// The bot variants are parts: heads (spiky, tall, folded, round), tails, eyes
// and extras, mixed freely and saved as your own characters. No model files.

export const PARAMS = {
  depth: { label: "Depth", min: 0.4, max: 2, step: 0.01 },
  bevel: { label: "Roundness", min: 0, max: 1.6, step: 0.01 },
  eye:   { label: "Eye", min: 0.8, max: 1.2, step: 0.01 },
  pupil: { label: "Pupil", min: 0.6, max: 1.5, step: 0.01 },
};
export const STYLES = { contour: "Contour lines", grid: "Wire grid", points: "Points", hologram: "Hologram" };

// the mark's parts, in its own 165×200 drawing units
const HEADS = {
  classic: { name: "Classic", top: "L135 13 L123 57", ear: "M28 15 L62 42 L39 54 Z" },
  spiky:   { name: "Spiky", top: "L99 10 L111 34 L135 13 L123 57", ear: "M28 15 L62 42 L39 54 Z" },
  tall:    { name: "Tall ears", top: "L138 9 L123 57", ear: "M22 9 L62 42 L39 54 Z" },
  folded:  { name: "Folded ear", top: "L110 26 L138 26 L123 57", ear: "M28 15 L62 42 L39 54 Z" },
  round:   { name: "Round ears", top: "C106 14 142 6 123 57", ear: "M36 20 C26 32 32 50 39 54 L62 42 C56 30 48 18 36 20 Z" },
};
const TAILS = {
  spike: { name: "Spike", d: "L112 150 C126 152 136 151 145 149 C137 158 130 164 124 169" },
  bolt:  { name: "Bolt", d: "L112 148 L136 140 L128 152 L152 146 L126 168" },
  curl:  { name: "Curl", d: "L112 150 C132 150 150 140 146 126 C143 138 132 158 124 169" },
  long:  { name: "Long", d: "L112 150 C130 152 150 150 160 140 C150 160 134 166 124 169" },
};
const RING = "M45 104 C43 89 70 66 96 64 C116 62 124 80 121 97 C118 116 100 126 86 122 C70 118 47 112 45 104 Z";
const EYES = {
  dot:    { name: "Classic", ring: RING, pupil: { c: [92, 94, 12] }, dot: [96.2, 89.8, 3.6] },
  side:   { name: "Side-eye", ring: RING, pupil: { c: [68, 97, 12] }, dot: [72.2, 92.8, 3.6] },
  big:    { name: "Big eye", ring: RING, pupil: { c: [88, 94, 19] }, dot: [94.65, 87.35, 5.7] },
  sleepy: { name: "Sleepy", ring: "M45 104 C60 96 100 90 121 97 C118 116 100 126 86 122 C70 118 47 112 45 104 Z", pupil: { c: [92, 107, 9] } },
  heart:  { name: "Heart", ring: RING, pupil: { d: "M92 108 C79 99 74 92 76 86.5 C78 80 87 79 92 86 C97 79 106 80 108 86.5 C110 92 105 99 92 108 Z" },
            lashes: "M84 65 Q81 58 78 52 M100 61 Q101 54 104 47 M114 63 Q119 56 125 51 M122 74 Q129 70 136 69",
            sparkle: "M68 70 L70 75.5 L75.5 77.5 L70 79.5 L68 85 L66 79.5 L60.5 77.5 L66 75.5 Z" },
  star:   { name: "Star", ring: RING, pupil: { d: "M93 77 L97.8 87.6 L109 88.3 L100.4 95.6 L103 106.8 L93 100.8 L83 106.8 L85.6 95.6 L77 88.3 L88.2 87.6 Z" } },
};
const EXTRAS = { none: { name: "None" }, antenna: { name: "Antenna" }, cape: { name: "Cape" }, bolt: { name: "Bolt mark" } };
const GAP = "M61 138 L99 150 L100 172 L51 171 Z";
const BOLT = "M74 142 L88 142 L82 152 L94 152 L72 170 L78 157 L68 157 Z";
const CAPE = "M46 128 C30 140 16 162 10 182 L44 181 Z";

export const PARTS = {
  head: { label: "Head", options: HEADS },
  tail: { label: "Tail", options: TAILS },
  look: { label: "Eye", options: EYES },
  extra: { label: "Extra", options: EXTRAS },
};

const base = { depth: 1, bevel: 1, eye: 1, pupil: 1, head: "classic", tail: "spike", look: "dot", extra: "none" };
const cat = (name, o = {}) => ({ name, ...base, ...o, style: "contour", color: "#ad5df8" });
// the bot cats from the brand exploration
export const PRESETS = {
  glyphh: cat("Glyphh"),
  "side-eye": cat("Side-eye", { look: "side" }),
  "big-eye": cat("Big eye", { look: "big" }),
  sleepy: cat("Sleepy", { look: "sleepy" }),
  wink: cat("Wink", { look: "heart" }),
  "star-eye": cat("Star eye", { look: "star" }),
  "tall-ears": cat("Tall ears", { head: "tall" }),
  "folded-ear": cat("Folded ear", { head: "folded" }),
  spiky: cat("Spiky", { head: "spiky" }),
  "round-ears": cat("Round ears", { head: "round" }),
  "bolt-tail": cat("Bolt tail", { tail: "bolt" }),
  "curl-tail": cat("Curl tail", { tail: "curl" }),
  "long-tail": cat("Long tail", { tail: "long" }),
  antenna: cat("Antenna", { extra: "antenna" }),
  cape: cat("Cape", { extra: "cape" }),
  "bolt-mark": cat("Bolt mark", { extra: "bolt" }),
};

// ── the mark's paths, flattened into polygons in world units ───────────
const S = 42, OX = 85, OY = 100;
const W = (x, y) => [(x - OX) / S, (OY - y) / S];
/** Absolute M/L/C/Q/Z paths → a list of polylines (each a list of [x,y] in world units). */
function flatten(d) {
  const t = d.match(/[MLCQZ]|-?\d*\.?\d+/g), out = [];
  let cur = null, x = 0, y = 0, i = 0, sx = 0, sy = 0, cmd = "";
  const num = () => Number(t[i++]);
  while (i < t.length) {
    if (/[MLCQZ]/.test(t[i])) cmd = t[i++];
    if (cmd === "M") { x = num(); y = num(); sx = x; sy = y; cur = [W(x, y)]; out.push(cur); cmd = "L"; }
    else if (cmd === "L") { x = num(); y = num(); cur.push(W(x, y)); }
    else if (cmd === "C") {
      const a = num(), b = num(), c = num(), e = num(), f = num(), g = num();
      for (let k = 1; k <= 12; k++) { const s = k / 12, u = 1 - s;
        cur.push(W(u * u * u * x + 3 * u * u * s * a + 3 * u * s * s * c + s * s * s * f, u * u * u * y + 3 * u * u * s * b + 3 * u * s * s * e + s * s * s * g)); }
      x = f; y = g;
    } else if (cmd === "Q") {
      const a = num(), b = num(), f = num(), g = num();
      for (let k = 1; k <= 8; k++) { const s = k / 8, u = 1 - s;
        cur.push(W(u * u * x + 2 * u * s * a + s * s * f, u * u * y + 2 * u * s * b + s * s * g)); }
      x = f; y = g;
    } else if (cmd === "Z") { x = sx; y = sy; cur.push(W(x, y)); cmd = ""; }
    else i++;
  }
  // drop repeated points (a curve that ends where Z closes), which would break a band's direction
  return out.map((l) => l.filter((p, k) => !k || Math.hypot(p[0] - l[k - 1][0], p[1] - l[k - 1][1]) > 1e-4));
}
/** Signed distance to a closed polygon (negative inside). */
function polyD(p, x, y) {
  let d = (x - p[0][0]) ** 2 + (y - p[0][1]) ** 2, s = 1;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const ex = p[j][0] - p[i][0], ey = p[j][1] - p[i][1], wx = x - p[i][0], wy = y - p[i][1];
    const h = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
    const bx = wx - ex * h, by = wy - ey * h; d = Math.min(d, bx * bx + by * by);
    const c1 = y >= p[i][1], c2 = y < p[j][1], c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}
/** Distance to an open (or closed, if the ends meet) polyline. */
function lineD(p, x, y) {
  let d = Infinity;
  for (let i = 1; i < p.length; i++) {
    const ax = p[i - 1][0], ay = p[i - 1][1], ex = p[i][0] - ax, ey = p[i][1] - ay, wx = x - ax, wy = y - ay;
    const h = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
    d = Math.min(d, Math.hypot(wx - ex * h, wy - ey * h));
  }
  return d;
}
const extrude = (d2, z, h, r) => { const wx = d2 + r, wy = Math.abs(z) - (h - r); return Math.min(Math.max(wx, wy), 0) + Math.hypot(Math.max(wx, 0), Math.max(wy, 0)) - r; };
const scaleAbout = (pts, cx, cy, k) => pts.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
const centroid = (pts) => { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; };

/** The cat for a set of choices: its distance field and its eye. */
export function figure(c) {
  const q = { ...base, ...c };
  const head = HEADS[q.head] || HEADS.classic, tail = TAILS[q.tail] || TAILS.spike, look = EYES[q.look] || EYES.dot;
  const body = flatten(`M40 62 ${head.top} C140 70 144 104 128 121 L112 133 ${tail.d} L128 179 L35 180 L44 131 C18 118 20 80 40 62 Z`)[0];
  const ear = flatten(head.ear)[0], gap = flatten(GAP)[0], bolt = flatten(BOLT)[0], cape = flatten(CAPE)[0];
  const h = 0.3 * q.depth, r = Math.min(0.11 * q.bevel, h * 0.9), groove = 0.07;

  // the eye, scaled about the ring's middle
  let ring = flatten(look.ring)[0];
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2, k = q.eye;
  ring = scaleAbout(ring, cx, cy, k);
  const ringW = (8 / S) * 0.5 * k;
  const P = (x, y) => { const [wx, wy] = W(x, y); return [cx + (wx - cx) * k, cy + (wy - cy) * k]; };
  let pupil;
  if (look.pupil.c) { const [px, py, pr] = look.pupil.c; const [x, y] = P(px, py); pupil = { x, y, r: (pr / S) * k }; }
  else { const pts = scaleAbout(flatten(look.pupil.d)[0], cx, cy, k); const [x, y] = centroid(pts); pupil = { x, y, r: 1, shape: pts.map(([a, b]) => [a - x, b - y]) }; }
  const dot = look.dot ? (() => { const [x, y] = P(look.dot[0], look.dot[1]); return { x: x - pupil.x, y: y - pupil.y, r: (look.dot[2] / S) * k }; })() : null;
  const lashes = look.lashes ? flatten(look.lashes).map((l) => scaleAbout(l, cx, cy, k)) : [];
  const sparkle = look.sparkle ? scaleAbout(flatten(look.sparkle)[0], cx, cy, k) : null;

  const antenna = q.extra === "antenna";
  const [aax, aay] = W(86, 46), [abx, aby] = W(92, 18), [bx, by] = W(93, 14);
  function flat(x, y) { // the mark's solid, flat
    let d = Math.min(polyD(body, x, y), polyD(ear, x, y));
    if (antenna) {
      const ex = abx - aax, ey = aby - aay, wx = x - aax, wy = y - aay, t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
      d = Math.min(d, Math.hypot(wx - ex * t, wy - ey * t) - 0.07, Math.hypot(x - bx, y - by) - 7 / S);
    }
    let hole = polyD(gap, x, y);
    if (q.extra === "bolt") hole = Math.max(hole, -polyD(bolt, x, y));
    return Math.max(d, -hole);
  }
  const hasCape = q.extra === "cape";
  // the flat parts depend on x and y only: worked out once per column, then extruded along z
  const plan = (x, y) => [flat(x, y), lineD(ring, x, y), hasCape ? polyD(cape, x, y) : 1];
  function lift([fd, rd, cd], z) {
    let d = extrude(fd, z, h, r);
    if (hasCape) d = Math.min(d, extrude(cd, z + h * 0.7, h * 0.3, Math.min(r, h * 0.25)));
    // the eye's ring is cut into both faces, so it reads from any side
    return Math.max(d, -Math.max(rd - ringW, h - groove - Math.abs(z)));
  }
  const sdf = (x, y, z) => lift(plan(x, y), z);
  return { sdf, plan, lift, h, eye: { x: cx, y: cy, ring: ring.map(([a, b]) => [a - cx, b - cy]), ringW, pupil: { ...pupil, x: pupil.x - cx, y: pupil.y - cy }, dot, scale: q.pupil,
    lashes: lashes.map((l) => l.map(([a, b]) => [a - cx, b - cy])), sparkle: sparkle && sparkle.map(([a, b]) => [a - cx, b - cy]) } };
}

/** Surface nets: a clean, quad-dominant mesh of the cat, plus where to draw its eye. */
export function mesh(c, N = 96) {
  const { sdf, plan, lift, eye, h } = figure(c);
  const B = { x0: -2.05, x1: 2.05, y0: -2.05, y1: 2.45, z0: -0.75, z1: 0.75 };
  const nx = N, ny = Math.round(N * (B.y1 - B.y0) / (B.x1 - B.x0)), nz = Math.round(N * 0.9 * (B.z1 - B.z0) / (B.x1 - B.x0)) * 2;
  const sx = (B.x1 - B.x0) / nx, sy = (B.y1 - B.y0) / ny, sz = (B.z1 - B.z0) / nz;
  const field = new Float32Array((nx + 1) * (ny + 1) * (nz + 1));
  const I = (i, j, k) => i + (nx + 1) * (j + (ny + 1) * k);
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const col = plan(B.x0 + i * sx, B.y0 + j * sy);
    for (let k = 0; k <= nz; k++) field[I(i, j, k)] = lift(col, B.z0 + k * sz);
  }

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
  return {
    positions: new Float32Array(pos), normals: n,
    index: pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx),
    eye: { ...eye, z: h + 0.01 },
  };
}
