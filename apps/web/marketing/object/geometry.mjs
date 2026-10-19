// The InfraForge system as a 3D anatomy object: DNS, a load balancer, two app
// servers and a database, free-standing in the order traffic flows (left to
// right) and joined by segmented cables. Each module rides its own fly-in group,
// so the film can bring the parts in from the dark and assemble them; every
// module is a hollow shell with its real insides.
//
// Units are millimetres. X is the viewer's right at yaw 0 (the kit's x is the
// object's own right, hence vx), y is the front, z is up.
import * as G from "../kit/lathe.mjs";
const TAU = Math.PI * 2;
const unit = G.unit3;
const add = G.add3;
const mul = G.mul3;
const sub = G.sub3;
const dot = G.dot3;
const cross = G.cross3;
export const frame = (o, a, u) => {
  const A = unit(a);
  const U = unit(sub(u, mul(A, dot(u, A))));
  return { o, a: A, u: U, v: cross(A, U) };
};
const AX = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const NX = [-1, 0, 0];
const NY = [0, -1, 0];
const NZ = [0, 0, -1];
const vx = (X) => -X;
const FONT = "'Geist Mono', ui-monospace, Menlo, monospace";

// ---- the site plan ----
export const Z0 = 0;                         // the ground the modules stand on
const PORT_Z = Z0 + 20;                       // every cable runs level at this height
export const PLAN = {
  dns: { X: -282, y: 0 },
  lb: { X: [-192, -120], y: [-52, 52], h: 50 },
  "app-1": { X: [-20, 72], y: [-124, -52], h: 62 },
  "app-2": { X: [-20, 72], y: [52, 124], h: 62 },
  db: { X: 262, y: 0, r: 48 },
};
// where each module flies in from (the kit's own axes: +x is the viewer's left), and how far
export const FLY = {
  dns: { dir: [1, 0.2, 0.55], travel: 760 },
  lb: { dir: [0.25, -1, 0.75], travel: 760 },
  "app-1": { dir: [-0.1, -1, 0.85], travel: 760 },
  "app-2": { dir: [0.1, 1, 0.7], travel: 760 },
  db: { dir: [-1, -0.15, 0.6], travel: 760 },
};
// palettes: body per module, lid, trim (ports, gauges, crowns) and the database's two platter tones
export const PALETTES = {
  atelier: { body: { dns: "bone", lb: "graphite", "app-1": "bone", "app-2": "bone", db: "sand" }, lid: "porcelain", trim: "gold", floor: "gold", platter: ["bone", "sand"], column: "porcelain" },
  noir: { body: { dns: "graphite", lb: "espresso", "app-1": "graphite", "app-2": "graphite", db: "espresso" }, lid: "graphite", trim: "gold", floor: "bronze", platter: ["espresso", "gold"], column: "graphite" },
  cognac: { body: { dns: "cognac", lb: "espresso", "app-1": "cognac", "app-2": "cognac", db: "cognac" }, lid: "bone", trim: "bronze", floor: "bronze", platter: ["cognac", "bone"], column: "bone" },
};
export const PAL = PALETTES[(typeof process !== "undefined" && process.env.PALETTE) || "atelier"];
const ENAMEL = PAL.body;
export const CABLES = [
  { a: "dns", b: "lb", kind: "resolve", from: [-246, 0], to: [-200, 0] },
  { a: "lb", b: "app-1", kind: "ingress", from: [-112, -28], to: [-28, -88] },
  { a: "lb", b: "app-2", kind: "ingress", from: [-112, 28], to: [-28, 88] },
  { a: "app-1", b: "db", kind: "query", from: [80, -88], to: [192, -22] },
  { a: "app-2", b: "db", kind: "query", from: [80, 88], to: [192, 22] },
];
const SEG = { len: 9, gap: 1.6, r: 4.4 };

const ring = (r, steps = 72) =>
  Array.from({ length: steps }, (_, j) => {
    const a = (TAU * j) / steps;
    return `${j ? "L" : "M"}${(r * Math.cos(a)).toFixed(3)} ${(r * Math.sin(a)).toFixed(3)}`;
  }).join("") + "Z";
const rrect = (x0, y0, x1, y1, r) =>
  `M${x0 + r} ${y0}H${x1 - r}A${r} ${r} 0 0 1 ${x1} ${y0 + r}V${y1 - r}A${r} ${r} 0 0 1 ${x1 - r} ${y1}H${x0 + r}A${r} ${r} 0 0 1 ${x0} ${y1 - r}V${y0 + r}A${r} ${r} 0 0 1 ${x0 + r} ${y0}Z`;
const text = (x, y, s, size, { tone = "hi", anchor = "middle", weight = 500 } = {}) =>
  `<text class="iso-face-text" data-tone="${tone}" font-size="${size}" text-anchor="${anchor}" font-weight="${weight}" style="font-family:${FONT};letter-spacing:.12em" transform="translate(${x.toFixed(3)} ${y.toFixed(3)})">${s}</text>`;
const line = (d, tone = "lo") => `<path class="iso-line" data-tone="${tone}" d="${d}"/>`;
function roundedRect(u0, v0, u1, v1, r, round = [1, 1, 1, 1], steps = 8) {
  const out = [];
  const corner = (cu, cv, a0) => { for (let j = 0; j <= steps; j++) { const a = a0 + (j / steps) * (Math.PI / 2); out.push([cu + r * Math.cos(a), cv + r * Math.sin(a)]); } };
  if (round[0]) corner(u0 + r, v0 + r, Math.PI); else out.push([u0, v0]);
  if (round[1]) corner(u1 - r, v0 + r, 1.5 * Math.PI); else out.push([u1, v0]);
  if (round[2]) corner(u1 - r, v1 - r, 0); else out.push([u1, v1]);
  if (round[3]) corner(u0 + r, v1 - r, 0.5 * Math.PI); else out.push([u0, v1]);
  return out;
}

// the cable route: a cubic S in plan with level tangents at both ports, as on the canvas
export function cableRoute(c, n = 160) {
  const [x0, y0] = c.from, [x1, y1] = c.to, h = (x1 - x0) * 0.5, pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push([u ** 3 * x0 + 3 * u * u * t * (x0 + h) + 3 * u * t * t * (x1 - h) + t ** 3 * x1, u ** 3 * y0 + 3 * u * u * t * y0 + 3 * u * t * t * y1 + t ** 3 * y1]);
  }
  const arc = [0];
  for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const at = (s) => { let j = 0; while (j < arc.length - 2 && arc[j + 1] < s) j++; const f = (s - arc[j]) / (arc[j + 1] - arc[j] || 1); return [pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f]; };
  return { at, len: arc[arc.length - 1] };
}
export function cableSegments(c) {
  const r = cableRoute(c), n = Math.max(2, Math.round((r.len + SEG.gap) / (SEG.len + SEG.gap)));
  const step = (r.len + SEG.gap) / n, len = step - SEG.gap, segs = [];
  for (let j = 0; j < n; j++) segs.push({ s0: j * step, s1: j * step + len, a: r.at(j * step), b: r.at(j * step + len) });
  return { segs, len: r.len };
}

export function buildObject(T, { layer }) {
  const parts = {}, groups = {}, explode = [], anchors = {}, features = [];
  const L = layer;
  const root = T.group("root", { free: { origin: [0, 0, 60] } });
  groups.root = root;
  const fly = {};
  for (const [id, f] of Object.entries(FLY)) fly[id] = groups[`fly.${id}`] = T.group(`fly.${id}`, { parent: root, slide: { direction: unit(f.dir), travel: f.travel } });
  const assembly = (name, dir, travel, delay = 0, parent = root) => {
    const g = T.group(name, { parent, slide: { direction: unit(dir), travel } });
    groups[name] = g;
    explode.push({ name, travel, delay });
    return g;
  };
  const hinge = (name, parent, point, axis, range) => { const g = T.group(name, { parent, hinge: { point, axis, range } }); groups[name] = g; return g; };
  const slider = (name, parent, dir, travel) => { const g = T.group(name, { parent, slide: { direction: unit(dir), travel } }); groups[name] = g; return g; };
  const part = (p) => (parts[p.name] = p);
  const prismOn = (axis, u) => (name, group, poly, s0, s1, o = {}) =>
    part(T.prism({ name, group, layer: L, F: frame([0, 0, 0], axis, u), polygon: poly, s0, s1, steps: 5, tone: o.tone ?? "hi", crease: o.crease ?? "lo", bevel: o.bevel ?? 0, material: o.material, lit: o.lit, details: o.details }));
  const prismY = prismOn(AX.y, AX.z);
  const prismZ = prismOn(AX.z, AX.x);
  const round = (name, group, F, s0, s1, r, o = {}) =>
    part(T.round({ name, group, layer: L, F, s0, s1, r, ends: o.ends, tone: o.tone ?? "hi", crease: o.crease ?? "lo", material: o.material, lit: o.lit, details: o.details }));
  const plane = (p, o, u, v, svg, normal, fade = [0.04, 0.3]) => T.plane({ part: p, o, u, v, svg, normal, fade });
  const box = (name, group, [X0, X1], [y0, y1], [z0, z1], o = {}) =>
    prismZ(name, group, o.r ? roundedRect(vx(X1), y0, vx(X0), y1, o.r, o.round, 8) : [[vx(X1), y0], [vx(X0), y0], [vx(X0), y1], [vx(X1), y1]], z0, z1, o);
  const up = (X, y) => frame([vx(X), y, 0], AX.z, AX.x);
  const alongX = (X, y, z) => frame([vx(X), y, z], NX, AX.z); // a round whose axis runs toward the viewer's right
  const FRONT = { u: [-1, 0, 0], v: [0, 0, -1] };
  const TOP = { u: [-1, 0, 0], v: [0, 1, 0] };
  const LEFT = { u: [0, 1, 0], v: [0, 0, -1] };
  const RIGHT = { u: [0, -1, 0], v: [0, 0, -1] };
  const BACK = { u: [1, 0, 0], v: [0, 0, -1] };
  // a panel's face finish: an inset seam, corner screws and (optionally) vent slots
  const finish = (w, h, { vents = 0, inset = 3.2 } = {}) => {
    const x0 = -w / 2 + inset, x1 = w / 2 - inset, y0 = -h / 2 + inset, y1 = h / 2 - inset;
    let svg = `<path class="iso-line" data-tone="faint" d="${rrect(x0, y0, x1, y1, 2)}"/>`;
    for (const [x, y] of [[x0 + 3, y0 + 3], [x1 - 3, y0 + 3], [x0 + 3, y1 - 3], [x1 - 3, y1 - 3]]) svg += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r=".75" style="fill:#7a766f"/>`;
    if (vents) { let d = ""; const vw = Math.min(w * 0.5, 40); for (let i = 0; i < vents; i++) { const y = -vents * 1.6 + i * 3.2; d += rrect(-vw / 2, y - 0.6, vw / 2, y + 0.6, 0.6); } svg += `<path class="iso-line" data-tone="lo" d="${d}"/>`; }
    return svg;
  };

  // a hollow module: floor, four walls and a lid, so its insides can be seen
  function shell(id, { X: [X0, X1], y: [y0, y1], h }, { wall = 4, lidTravel = 80, wallTravel = 40, delay = 0.18 } = {}) {
    const F = fly[id], E = ENAMEL[id];
    const top = Z0 + h;
    const g = {};
    g.floor = box(`${id}.floor`, F, [X0, X1], [y0, y1], [Z0, Z0 + wall], { material: PAL.floor, tone: "mid", r: 4 });
    const walls = {
      L: assembly(`${id}.wall.L`, AX.x, wallTravel, delay + 0.06, F),  // the kit's +x is the viewer's left
      R: assembly(`${id}.wall.R`, NX, wallTravel, delay + 0.06, F),
      B: assembly(`${id}.wall.B`, NY, wallTravel, delay + 0.04, F),
      F: assembly(`${id}.wall.F`, AX.y, wallTravel * 1.3, delay, F),
    };
    const zb = Z0 + wall, zt = top - wall;
    g.wallL = box(`${id}.wall.L`, walls.L, [X0, X0 + wall], [y0, y1], [zb, zt], { material: E, tone: "hi" });
    g.wallR = box(`${id}.wall.R`, walls.R, [X1 - wall, X1], [y0, y1], [zb, zt], { material: E, tone: "hi" });
    g.wallB = box(`${id}.wall.B`, walls.B, [X0 + wall + 0.5, X1 - wall - 0.5], [y0, y0 + wall], [zb, zt], { material: E, tone: "hi" });
    g.wallF = box(`${id}.wall.F`, walls.F, [X0 + wall + 0.5, X1 - wall - 0.5], [y1 - wall, y1], [zb, zt], { material: E, tone: "hi" });
    const lidG = assembly(`${id}.lid`, AX.z, lidTravel, delay - 0.08, F);
    g.lid = box(`${id}.lid`, lidG, [X0, X1], [y0, y1], [zt, top], { material: PAL.lid, tone: "hi", r: 4, bevel: 0.9 });
    // face finishes on the outside of every panel
    const wd = y1 - y0, hd = zt - zb, xm = (X0 + X1) / 2, ym = (y0 + y1) / 2, zm = (zb + zt) / 2;
    plane(g.wallL, [vx(X0) + 0.02, ym, zm], LEFT.u, LEFT.v, finish(wd, hd, { vents: 4 }), AX.x);
    plane(g.wallR, [vx(X1) - 0.02, ym, zm], RIGHT.u, RIGHT.v, finish(wd, hd, { vents: 4 }), NX);
    plane(g.wallB, [vx(xm), y0 - 0.02, zm], BACK.u, BACK.v, finish(X1 - X0 - 9, hd, { vents: 5 }), NY);
    return { g, walls, lidG, top, zb, zt };
  }
  // a port collar on an x wall: a short round along x, owned by that wall
  const port = (name, group, X, y, dir) => round(name, group, alongX(dir > 0 ? X : X - 8, y, PORT_Z), 0, 8, 8, { material: PAL.trim, tone: "hi", details: { seams: [3] } });
  const lamp = (name, group, X, y, z) => round(name, group, up(X, y), z, z + 2.4, 4.2, { material: "ok", tone: "hi" });
  function gauge(id, group, X, y, z, r) {
    const bezel = round(`${id}.gauge`, group, up(X, y), z, z + 4, r, { material: PAL.trim, tone: "hi", details: { seams: [z + 1.6] } });
    const rr = r - 3;
    const pt = (a, k) => [k * Math.sin(a), -k * Math.cos(a)];
    let ticks = "", major = "";
    for (let i = 0; i <= 20; i++) {
      const a = ((-135 + (270 * i) / 20) * Math.PI) / 180, [x0, y0] = pt(a, rr - (i % 5 ? 1.6 : 3)), [x1, y1] = pt(a, rr - 0.3);
      const seg = `M${x0.toFixed(2)} ${y0.toFixed(2)}L${x1.toFixed(2)} ${y1.toFixed(2)}`;
      if (i % 5) ticks += seg; else major += seg;
    }
    const a0 = ((-135 + 270 * 0.8) * Math.PI) / 180, a1 = (135 * Math.PI) / 180;
    const arc = Array.from({ length: 9 }, (_, j) => pt(a0 + ((a1 - a0) * j) / 8, rr - 0.9)).map(([x, y2], j) => `${j ? "L" : "M"}${x.toFixed(2)} ${y2.toFixed(2)}`).join("");
    plane(bezel, [vx(X), y, z + 4.02], TOP.u, TOP.v,
      `<circle r="${rr + 0.6}" style="fill:#f7f4ee"/><path d="${arc}" style="fill:none;stroke:#d4524f;stroke-width:1.4"/>` + `<path d="${ticks}" style="fill:none;stroke:#8f8a82;stroke-width:.3"/><path d="${major}" style="fill:none;stroke:#3d3a36;stroke-width:.55"/>` + text(0, rr * 0.55, "CPU", 2.2, { tone: "lo" }), AX.z, [0.02, 0.2]);
    const needle = hinge(`${id}.needle`, group, [vx(X), y, 0], NZ, [-5, 280]);
    const rest = (-135 * Math.PI) / 180;
    const pts = [[-2.4, -1.1], [-2.4, 1.1], [rr - 1.2, 0.3], [rr - 1.2, -0.3]].map(([along, side]) => [vx(X + along * Math.sin(rest) + side * Math.cos(rest)), y - along * Math.cos(rest) + side * Math.sin(rest)]);
    prismZ(`${id}.needle`, needle, pts, z + 4, z + 4.8, { material: "gunmetal", tone: "hi" });
    round(`${id}.pin`, needle, up(X, y), z + 4.8, z + 5.8, 1.4, { material: "chrome", tone: "hi" });
    anchors[`${id}.gauge`] = [vx(X), y, z + 5];
  }

  // ---------------- DNS: the beacon every request starts from ----------------
  {
    const { X, y } = PLAN.dns;
    const base = box("dns.base", fly.dns, [X - 26, X + 26], [y - 26, y + 26], [Z0, Z0 + 34], { material: ENAMEL.dns, tone: "hi", r: 5, bevel: 1 });
    plane(base, [vx(X), y + 26.02, Z0 + 17], FRONT.u, FRONT.v, finish(52, 34) + line(`M-14 -8H14M-14 -5H14M-14 -2H14`, "lo") + text(0, 9, "DNS", 4.2, { tone: "mid", weight: 600 }), AX.y);
    port("dns.port", fly.dns, X + 26, y, 1);
    lamp("dns.lamp", fly.dns, X - 15, y + 15, Z0 + 34);
    const mast = assembly("dns.mast", AX.z, 46, 0.12, fly.dns);
    round("dns.column", mast, up(X, y), Z0 + 34, Z0 + 118, 9, { material: PAL.column, tone: "hi", details: { seams: [Z0 + 60, Z0 + 92] } });
    const crown = assembly("dns.crown", AX.z, 96, 0.04, fly.dns);
    round("dns.collar", crown, up(X, y), Z0 + 118, Z0 + 124, 16, { material: "gold", tone: "hi" });
    round("dns.beacon", crown, up(X, y), Z0 + 124, Z0 + 140, 13, { material: "resolve", tone: "hi", details: { ribs: { s0: Z0 + 126, s1: Z0 + 138, count: 36, fade: [0.08, 0.55], seams: true, tone: "lo" } } });
    round("dns.cap", crown, up(X, y), Z0 + 140, Z0 + 145, 15, { material: "gold", tone: "hi" });
    round("dns.aerial", crown, up(X + 6, y), Z0 + 145, Z0 + 176, 1.2, { material: "gold", tone: "hi" });
    round("dns.tip", crown, up(X + 6, y), Z0 + 176, Z0 + 179, 2.4, { material: "dead", tone: "hi" });
    anchors["dns.beacon"] = [vx(X), y, Z0 + 132];
    anchors.dns = [vx(X), y, Z0 + 60];
  }

  // ---------------- LB: the hall that splits traffic ----------------
  {
    const P = PLAN.lb;
    const S = shell("lb", P, { delay: 0.2 });
    plane(S.g.wallF, [vx((P.X[0] + P.X[1]) / 2), P.y[1] + 0.02, Z0 + P.h / 2], FRONT.u, FRONT.v, line("M-24 -10H24M-24 -6H24M-24 -2H24", "faint") + text(-18, 12, "LB", 4.2, { tone: "mid", weight: 600, anchor: "start" }), AX.y);
    port("lb.port.in", S.walls.L, P.X[0], 0, -1);
    port("lb.port.1", S.walls.R, P.X[1], -28, 1);
    port("lb.port.2", S.walls.R, P.X[1], 28, 1);
    // inside: a diverter flap on a pivot; it swings shut on an outlet whose server is gone
    const cx = -158;
    round("lb.pivot", fly.lb, up(cx, 0), S.zb, S.zb + 30, 4, { material: "gold", tone: "hi" });
    const flap = hinge("lb.flap", fly.lb, [vx(cx), 0, 0], AX.z, [-30, 30]);
    box("lb.flap", flap, [cx + 5, cx + 30], [-1.4, 1.4], [S.zb + 3, S.zb + 27], { material: "ingress", tone: "hi" });
    const board = assembly("lb.board", AX.z, 22, 0.32, fly.lb);
    box("lb.board", board, [P.X[0] + 8, P.X[0] + 26], [-44, -16], [S.zb, S.zb + 2], { material: "pcb", tone: "hi" });
    box("lb.chip", board, [P.X[0] + 12, P.X[0] + 22], [-36, -26], [S.zb + 2, S.zb + 4], { material: "gunmetal", tone: "hi" });
    // on the lid: the two outlet shares, as sliders in their slots
    const lidTop = S.top;
    plane(S.g.lid, [vx((P.X[0] + P.X[1]) / 2), 0, lidTop + 0.02], TOP.u, TOP.v,
      `<path class="iso-line" data-tone="mid" d="${rrect(-20, -34, 20, -22, 3)}${rrect(-20, 22, 20, 34, 3)}"/>` + text(26, -26, "1", 3.6, { tone: "lo" }) + text(26, 30, "2", 3.6, { tone: "lo" }), AX.z);
    const cxm = (P.X[0] + P.X[1]) / 2;
    for (const [i, y] of [[1, -28], [2, 28]]) {
      const s = slider(`lb.share.${i}`, S.lidG, NX, 34);
      box(`lb.share.${i}`, s, [cxm - 18, cxm - 12], [y - 4, y + 4], [lidTop, lidTop + 2.4], { material: "ingress", tone: "hi" });
    }
    lamp("lb.lamp", S.lidG, P.X[0] + 9, P.y[1] - 9, lidTop);
    anchors.lb = [vx(cxm), 0, Z0 + P.h / 2];
    anchors["lb.flap"] = [vx(cx + 16), 0, S.zb + 14];
    anchors["lb.lid"] = [vx(cxm), 0, lidTop];
  }

  // ---------------- app servers ----------------
  for (const id of ["app-1", "app-2"]) {
    const P = PLAN[id], cy = (P.y[0] + P.y[1]) / 2, cxm = (P.X[0] + P.X[1]) / 2;
    const S = shell(id, P, { delay: 0.22 });
    // front face: four drive bays with handles and activity lights
    const fy = P.y[1];
    let bays = "";
    for (let i = 0; i < 4; i++) bays += `M-38 ${-20 + i * 10}H38`;
    plane(S.g.wallF, [vx(cxm), fy + 0.02, Z0 + P.h / 2], FRONT.u, FRONT.v, line(bays, "faint") + line("M-30 -15h16M-30 -5h16M-30 5h16M-30 15h16", "lo") + text(38, 26, id.toUpperCase(), 3.6, { tone: "mid", weight: 600, anchor: "end" }), AX.y);
    port(`${id}.port.in`, S.walls.L, P.X[0], cy, -1);
    port(`${id}.port.out`, S.walls.R, P.X[1], cy, 1);
    // inside: motherboard, CPU under its heatsink, memory, a fan and two drives
    const board = box(`${id}.board`, fly[id], [P.X[0] + 6, P.X[1] - 6], [P.y[0] + 6, P.y[1] - 6], [S.zb, S.zb + 1.6], { material: "pcb", tone: "hi" });
    plane(board, [vx(cxm), cy, S.zb + 1.62], TOP.u, TOP.v, line(Array.from({ length: 9 }, (_, i) => `M${-38 + i * 4} 22V8L${-30 + i * 4} 2H10`).join(""), "lo"), AX.z);
    const cpu = assembly(`${id}.cpu`, AX.z, 52, 0.36, fly[id]);
    const sink = box(`${id}.heatsink`, cpu, [cxm - 8, cxm + 16], [cy - 14, cy + 10], [S.zb + 1.6, S.zb + 22], { material: "gunmetal", tone: "hi" });
    plane(sink, [vx(cxm + 4), cy - 2, S.zb + 22.02], TOP.u, TOP.v, line(Array.from({ length: 10 }, (_, i) => `M${-11 + i * 2.4} -11V11`).join(""), "lo"), AX.z);
    const ram = assembly(`${id}.ram`, AX.z, 36, 0.4, fly[id]);
    for (const [i, X] of [[0, cxm - 22], [1, cxm - 16]]) box(`${id}.ram.${i}`, ram, [X, X + 2], [cy - 13, cy + 13], [S.zb + 1.6, S.zb + 18], { material: "pcb", tone: "hi" });
    const fan = assembly(`${id}.fan`, AX.z, 44, 0.38, fly[id]);
    const fb = round(`${id}.fan`, fan, up(cxm + 30, cy), S.zb + 1.6, S.zb + 12, 10, { material: "gunmetal", tone: "hi" });
    plane(fb, [vx(cxm + 30), cy, S.zb + 12.02], TOP.u, TOP.v, `<path class="iso-line" data-tone="lo" d="${ring(8.4, 40)}${ring(2.6, 20)}"/>` + line("M0 -8C3 -5 3 -3 0 -2.6M7 4C3 4 2 2 2.2 1.3M-7 4C-5 1 -3 1 -2.2 1.3", "mid"), AX.z);
    const drives = assembly(`${id}.drives`, AX.y, 46, 0.42, fly[id]);
    for (const [i, X] of [[0, P.X[0] + 8], [1, P.X[0] + 24]]) box(`${id}.drive.${i}`, drives, [X, X + 13], [P.y[1] - 22, P.y[1] - 6], [S.zb + 1.6, S.zb + 8], { material: "gold", tone: "hi" });
    // on the lid: CPU gauge, status lamp, name
    gauge(id, S.lidG, P.X[1] - 20, cy, S.top, 13);
    lamp(`${id}.lamp`, S.lidG, P.X[0] + 10, P.y[1] - 9, S.top);
    plane(S.g.lid, [vx(P.X[0] + 26), cy, S.top + 0.02], TOP.u, TOP.v, line(Array.from({ length: 7 }, (_, i) => `M${-12 + i * 4} -14V14`).join(""), "faint") + text(12, -18, id.toUpperCase(), 4, { tone: "hi", weight: 600 }), AX.z);
    anchors[id] = [vx(cxm), cy, Z0 + P.h / 2];
    anchors[`${id}.cpu`] = [vx(cxm + 4), cy, S.zb + 12];
  }

  // ---------------- DB: a stack of storage platters ----------------
  {
    const { X, y, r } = PLAN.db;
    round("db.base", fly.db, up(X, y), Z0, Z0 + 6, r + 4, { material: PAL.floor, tone: "mid" });
    // a manifold in front of the stack carries the two inlet ports
    const mf = box("db.manifold", fly.db, [X - r - 14, X - r - 6], [-36, 36], [Z0, Z0 + 36], { material: ENAMEL.db, tone: "hi", r: 2 });
    plane(mf, [vx(X - r - 14) + 0.02, 0, Z0 + 21], LEFT.u, LEFT.v, finish(72, 30), AX.x);
    for (const [i, yy] of [[1, -22], [2, 22]]) port(`db.port.${i}`, fly.db, X - r - 14, yy, -1);
    const H = [[6, 22], [22, 38], [38, 54], [54, 70]];
    H.forEach(([z0, z1], i) => {
      const g = assembly(`db.platter.${i}`, AX.z, 22 + i * 26, 0.24 - i * 0.03, fly.db);
      round(`db.platter.${i}`, g, up(X, y), Z0 + z0, Z0 + z1, r - (i % 2 ? 1.4 : 0), { material: PAL.platter[i % 2], tone: "hi", details: { seams: [Z0 + z0 + 3, Z0 + z1 - 3] } });
    });
    const capG = assembly("db.cap", AX.z, 150, 0.08, fly.db);
    const cap = round("db.cap", capG, up(X, y), Z0 + 70, Z0 + 76, r, { material: PAL.lid, tone: "hi" });
    plane(cap, [vx(X), y, Z0 + 76.02], TOP.u, TOP.v, `<path class="iso-line" data-tone="faint" d="${ring(r - 5, 80)}"/>` + text(-22, -16, "DB", 4.6, { tone: "hi", weight: 600 }), AX.z);
    gauge("db", capG, X + 12, y + 6, Z0 + 76, 17);
    lamp("db.lamp", capG, X - 24, y + 18, Z0 + 76);
    anchors.db = [vx(X), y, Z0 + 40];
    anchors["db.platters"] = [vx(X), y, Z0 + 40];
    void mf;
  }

  // ---------------- cables: segmented sleeves, level with the ports ----------------
  const cablesG = assembly("cables", AX.z, 64, 0);
  CABLES.forEach((c, ci) => {
    const { segs } = cableSegments(c);
    segs.forEach((sg, j) => {
      const a = [vx(sg.a[0]), sg.a[1], PORT_Z], b = [vx(sg.b[0]), sg.b[1], PORT_Z];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      round(`cable.${ci}.${j}`, cablesG, frame(a, sub(b, a), AX.z), 0, len, SEG.r, { material: c.kind, tone: "hi" });
    });
    anchors[`port.${ci}.from`] = [vx(c.from[0]), c.from[1], PORT_Z];
    anchors[`port.${ci}.to`] = [vx(c.to[0]), c.to[1], PORT_Z];
    const mid = segs[Math.floor(segs.length / 2)];
    anchors[`cable.${ci}`] = [vx(mid.a[0]), mid.a[1], PORT_Z];
  });

  // ground footprints, for shadows and halos drawn around the modules: centre, then half sizes (and 1 for round)
  const ground = { dns: [PLAN.dns.X, PLAN.dns.y, 30, 30, 0], lb: [-156, 0, 38, 54, 0], "app-1": [26, -88, 48, 38, 0], "app-2": [26, 88, 48, 38, 0], db: [PLAN.db.X, PLAN.db.y, 54, 54, 1] };
  for (const [id, [X, y, hw, hd, rnd]] of Object.entries(ground)) { anchors[`gnd.${id}`] = [vx(X), y, 0]; anchors[`fp.${id}`] = [hw, hd, rnd]; }
  anchors.body = [0, 0, 70];
  anchors.bench = [0, 0, Z0];
  // gauge, flap and slider poses the build must prove
  for (let i = 0; i <= 6; i++) features.push({ "app-1.needle": i * 45, "app-2.needle": i * 45, "db.needle": i * 45, "lb.flap": -30 + i * 10, "lb.share.1": i * 5.6, "lb.share.2": i * 5.6 });
  return { parts, groups, explode, root, anchors, features, counts: { modules: 5, cables: CABLES.length } };
}
export function explodeValues(explode, apart, { stretch = 0.55 } = {}) {
  const out = {};
  for (const { name, travel, delay } of explode) {
    const t = Math.max(0, Math.min(1, (apart - delay * stretch) / (1 - stretch)));
    out[name] = travel * t * t * (3 - 2 * t);
  }
  return out;
}
