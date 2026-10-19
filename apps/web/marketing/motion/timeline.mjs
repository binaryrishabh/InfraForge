const EASE = {
  lin: (x) => x,
  io: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  i: (x) => x * x * x,
  o: (x) => 1 - Math.pow(1 - x, 3),
  whip: (x) => (x < 0.5 ? 16 * Math.pow(x, 5) : 1 - Math.pow(-2 * x + 2, 5) / 2),
  so: (x) => 1 - Math.pow(1 - x, 2),
  si: (x) => x * x,
  back: (x) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2),
};
// 0-10: the assembly (plays by itself); 10-20: the recorded run, driven by scroll
export const BASE_DURATION = 20;
export const ASSEMBLY_END = 10;
// One continuous take. Each key also names the recorded second it shows (sec),
// so the run plays under the camera and slows through the crash at second 61.
// One continuous take. build (0..1) runs the assembly: modules fly in from the
// dark, cables grow port to port and spark as they join, and the last join
// sends a surge through everything and turns the world to light.
const BASE_KEYS = [
  { t: 0, yaw: -66, pitch: 32, roll: -6, zoom: 2.5, focus: "body", panX: 0, panY: 0, apart: 0, build: 0, sec: 40, glow: [0.5, 0.48, 0.66] },
  { t: 1.1, yaw: -58, pitch: 31, roll: -4, zoom: 2.65, build: 0.2, ease: "lin" },
  { t: 2.3, yaw: -48, pitch: 29, roll: -2, zoom: 2.85, build: 0.44, ease: "lin" },
  { t: 2.9, yaw: -44, pitch: 29, roll: 0, zoom: 2.95, build: 0.5, ease: "lin" },
  { t: 3.8, yaw: -30, pitch: 36, roll: 2, zoom: 5.4, focus: "port.1.to", build: 0.66, ease: "io" },
  { t: 4.8, yaw: -46, pitch: 30, roll: -2, zoom: 5.0, focus: "port.3.to", build: 0.84, ease: "io" },
  { t: 5.6, yaw: -36, pitch: 28, roll: 0, zoom: 3.0, focus: "body", build: 0.92, ease: "io" },
  { t: 6.4, yaw: -31, pitch: 27, zoom: 3.4, build: 1, ease: "lin" },
  { t: 10, yaw: -24, pitch: 24, roll: 0, zoom: 3.9, panX: -150, panY: 34, sec: 40, ease: "o" },
  // the recorded run: traffic splits, app-2 dies at second 61, the balancer re-routes, app-1 pins.
  // The subject sits in the right half so the words on the left stay clear.
  { t: 11.6, yaw: -18, pitch: 42, roll: 2, zoom: 4.9, focus: "lb.lid", panX: -170, panY: 40, sec: 56, ease: "io" },
  { t: 12.4, yaw: -22, pitch: 40, roll: 2, zoom: 5.1, focus: "lb.lid", sec: 59.5, ease: "lin" },
  { t: 13.4, yaw: -32, pitch: 34, roll: -2, zoom: 4.8, focus: "app-2.gauge", panX: -180, panY: 50, sec: 60.6, ease: "io" },
  { t: 15.0, yaw: -40, pitch: 31, roll: -3, zoom: 5.1, focus: "app-2.gauge", sec: 62.4, ease: "lin" },
  { t: 16.0, yaw: -18, pitch: 44, roll: 2, zoom: 4.9, focus: "lb.lid", panX: -170, panY: 40, sec: 64, ease: "io" },
  { t: 17.2, yaw: -34, pitch: 36, roll: -2, zoom: 4.6, focus: "app-1.gauge", panX: -215, panY: 80, sec: 72, ease: "io" },
  { t: 18.2, yaw: -30, pitch: 37, roll: -3, zoom: 4.8, focus: "app-1.gauge", sec: 80, ease: "lin" },
  { t: 20, yaw: -24, pitch: 24, roll: 0, zoom: 3.9, focus: "body", panX: -150, panY: 34, sec: 90, ease: "io" },
];
const BASE_LABELS = [
  { t: 0, hint: "Assembling the system", readout: "" },
  { t: 3.3, hint: "Wiring · every join is checked", readout: "" },
  { t: 5.8, hint: "Live · traffic at the recorded rate", readout: "" },
];
const REQUESTED = typeof DATA !== "undefined" && DATA.duration ? DATA.duration : BASE_DURATION;
function retimer(keys, duration) {
  const segments = [];
  let fixed = 0;
  for (let i = 1; i < keys.length; i++) {
    const whip = keys[i].ease === "whip";
    segments.push({ a: keys[i - 1].t, b: keys[i].t, whip });
    if (whip) fixed += keys[i].t - keys[i - 1].t;
  }
  const scale = Math.max(0.35, (duration - fixed) / (BASE_DURATION - fixed));
  return (t) => {
    let out = 0;
    for (const s of segments) {
      if (t <= s.a) break;
      const part = Math.min(t, s.b) - s.a;
      out += s.whip ? part : part * scale;
    }
    return out + Math.max(0, t - BASE_DURATION) * scale;
  };
}
const RETIME = retimer(BASE_KEYS, REQUESTED);
export const DURATION = RETIME(BASE_DURATION);
export const KEYS = BASE_KEYS.map((k) => ({ ...k, t: RETIME(k.t) }));
export const LABELS = BASE_LABELS.map((l) => ({ ...l, t: RETIME(l.t) }));
const CHANNELS = ["yaw", "pitch", "roll", "zoom", "panX", "panY", "apart", ...Object.keys(FEATURE_DEFAULTS)];
const DEFAULTS = { yaw: 0, pitch: 0, roll: 0, zoom: 1, panX: 0, panY: 0, apart: 0, ...FEATURE_DEFAULTS };
function track(name) {
  const list = KEYS.filter((k) => k[name] !== void 0).map((k) => ({ t: k.t, v: k[name], ease: k.ease ?? "io" }));
  if (!list.length || list[0].t > 0) list.unshift({ t: 0, v: list.length ? list[0].v : DEFAULTS[name], ease: "lin" });
  return list;
}
const TRACKS = Object.fromEntries(CHANNELS.map((c) => [c, track(c)]));
const FOCUS = KEYS.filter((k) => k.focus !== void 0).map((k) => ({ t: k.t, v: k.focus, ease: k.ease ?? "io" }));
const GLOW = KEYS.filter((k) => k.glow !== void 0).map((k) => ({ t: k.t, v: k.glow, ease: k.ease ?? "io" }));
function sample(list, t, log = false) {
  if (t <= list[0].t) return { a: list[0].v, b: list[0].v, e: 0 };
  for (let i = 1; i < list.length; i++) {
    if (t <= list[i].t) {
      const x = (t - list[i - 1].t) / (list[i].t - list[i - 1].t || 1);
      return { a: list[i - 1].v, b: list[i].v, e: EASE[list[i].ease](x), log };
    }
  }
  const last = list[list.length - 1].v;
  return { a: last, b: last, e: 0 };
}
const mix = (a, b, e) => a + (b - a) * e;
// read the frame on every call: the hero's frame follows live window resizes
function fitZoom(z) {
  const FRAME = typeof DATA !== "undefined" && DATA.W ? [DATA.W, DATA.H] : [540, 960];
  const WIDE_FIT = Math.min(1, FRAME[0] / 540, FRAME[1] / 760);
  const x = Math.max(0, Math.min(1, (z - 2.6) / 2));
  return z * Math.pow(WIDE_FIT, 1 - x * x * (3 - 2 * x));
}
export function at(t) {
  const out = {};
  for (const c of CHANNELS) {
    const { a, b, e } = sample(TRACKS[c], t);
    out[c] = c === "zoom" ? Math.exp(mix(Math.log(a), Math.log(b), e)) : mix(a, b, e);
  }
  out.zoom = fitZoom(out.zoom);
  const f = sample(FOCUS, t);
  out.focus = { a: f.a, b: f.b, e: f.e };
  const g = sample(GLOW, t);
  out.glow = g.a.map((v, i) => mix(v, g.b[i], g.e));
  let label = LABELS[0];
  for (const l of LABELS) if (t >= l.t) label = l;
  out.label = label;
  return out;
}
