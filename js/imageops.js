// imageops.js
// Pure image-analysis functions for "Seeing like a brain".
// No DOM access, so the same code runs in the browser and under `node --test`.
//
// Conventions
//   rgba    Uint8ClampedArray, length w*h*4, sRGB, row-major
//   plane   Float32Array, length w*h
//   Lab     CIELAB, D65, planes L (0..100), A and B (roughly -128..127)

// ---------------------------------------------------------------------------
// Foveal acuity model (Geisler & Perry 1998)
// ---------------------------------------------------------------------------
// Contrast threshold CT(f, e) = CT0 * exp(alpha * f * (e + e2) / e2).
// The highest visible spatial frequency (threshold = 1) falls off with
// eccentricity e (degrees). We turn that cutoff into the sigma of a Gaussian
// blur whose response is 0.5 at the cutoff frequency.

export const GP = Object.freeze({ alpha: 0.106, e2: 2.3, ct0: 1 / 64 });
const HALF_AMPLITUDE = Math.sqrt(Math.LN2 / 2) / Math.PI; // sigma*f for 50% response

/** Highest visible spatial frequency (cycles/degree) at eccentricity `ecc` (degrees). */
export function cutoffCpd(ecc, p = GP) {
  return (p.e2 * Math.log(1 / p.ct0)) / (p.alpha * (ecc + p.e2));
}

/** Gaussian blur sigma (degrees of visual angle) that matches the acuity cutoff. */
export function sigmaDeg(ecc, p = GP) {
  return HALF_AMPLITUDE / cutoffCpd(ecc, p);
}

/**
 * Blur sigma in pixels at eccentricity `ecc`, given pixels-per-degree.
 * k = 1 is the psychophysical estimate. k > 1 makes the blur grow k times faster with
 * eccentricity (equivalent to dividing e2 by k) while leaving the fovea untouched.
 */
export function sigmaPx(ecc, ppd, k = 1, p = GP) {
  return sigmaDeg(0, p) * ppd * (1 + (k * ecc) / p.e2);
}

/** Viewing distance (m) at which central vision blurs a painting by `sigma` image pixels. */
export function equivalentDistanceM(sigma, imgWidthPx, paintingWidthCm) {
  if (!(sigma > 0) || !(paintingWidthCm > 0)) return null;
  const ppd = sigma / sigmaDeg(0);
  const thetaDeg = imgWidthPx / ppd;
  const half = (thetaDeg * Math.PI) / 360;
  if (half >= Math.PI / 2) return null;
  return paintingWidthCm / 100 / 2 / Math.tan(half);
}

// ---------------------------------------------------------------------------
// Gaussian blur (three box passes, edge-clamped, O(n) in the radius)
// ---------------------------------------------------------------------------

function boxesForGauss(sigma, n) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}

function boxLine(src, dst, base, stride, n, r) {
  const inv = 1 / (2 * r + 1);
  const first = src[base];
  const last = src[base + (n - 1) * stride];
  let acc = first * (r + 1);
  for (let k = 1; k <= r; k++) acc += src[base + Math.min(k, n - 1) * stride];
  for (let i = 0; i < n; i++) {
    dst[base + i * stride] = acc * inv;
    const iAdd = i + r + 1;
    const iSub = i - r;
    acc += (iAdd < n ? src[base + iAdd * stride] : last) - (iSub >= 0 ? src[base + iSub * stride] : first);
  }
}

function boxPass(src, dst, w, h, r, horizontal) {
  if (horizontal) for (let y = 0; y < h; y++) boxLine(src, dst, y * w, 1, w, r);
  else for (let x = 0; x < w; x++) boxLine(src, dst, x, w, h, r);
}

function kernelPass(src, dst, w, h, kernel, horizontal) {
  const r = (kernel.length - 1) / 2;
  const n = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const stride = horizontal ? 1 : w;
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * w : line;
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const j = i + k < 0 ? 0 : i + k >= n ? n - 1 : i + k;
        acc += kernel[k + r] * src[base + j * stride];
      }
      dst[base + i * stride] = acc;
    }
  }
}

function gaussKernel(sigma) {
  const r = Math.ceil(sigma * 3);
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/** Gaussian blur of one float plane. Returns a new plane. Exact kernel for small sigma, box passes for large. */
export function gaussBlurPlane(src, w, h, sigma) {
  if (!(sigma >= 0.35)) return Float32Array.from(src);
  if (sigma < 4.5) {
    const kernel = gaussKernel(sigma);
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    kernelPass(src, tmp, w, h, kernel, true);
    kernelPass(tmp, out, w, h, kernel, false);
    return out;
  }
  const sizes = boxesForGauss(sigma, 3);
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  for (const size of sizes) {
    const r = (size - 1) / 2;
    boxPass(a, b, w, h, r, true);
    boxPass(b, a, w, h, r, false);
  }
  return a;
}

/** Gaussian blur of an RGBA image (alpha forced to 255). */
export function gaussBlurRGBA(rgba, w, h, sigma) {
  const n = w * h;
  const out = new Uint8ClampedArray(n * 4);
  for (let c = 0; c < 3; c++) {
    const plane = new Float32Array(n);
    for (let i = 0; i < n; i++) plane[i] = rgba[i * 4 + c];
    const blurred = gaussBlurPlane(plane, w, h, sigma);
    for (let i = 0; i < n; i++) out[i * 4 + c] = blurred[i];
  }
  for (let i = 0; i < n; i++) out[i * 4 + 3] = 255;
  return out;
}

/**
 * Gaussian pyramid as full-resolution RGBA levels, one per sigma.
 * sigmas[0] is normally 0 (the original). `tick` lets the UI repaint between levels.
 */
export async function buildPyramid(rgba, w, h, sigmas, tick) {
  const levels = [];
  for (let i = 0; i < sigmas.length; i++) {
    levels.push(sigmas[i] > 0 ? gaussBlurRGBA(rgba, w, h, sigmas[i]) : rgba);
    if (tick) await tick(i, sigmas.length);
  }
  return levels;
}

// ---------------------------------------------------------------------------
// Color: sRGB <-> CIELAB (D65)
// ---------------------------------------------------------------------------

const SRGB_TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;
const XN = 0.95047;
const ZN = 1.08883;

const labF = (t) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
const labFinv = (t) => {
  const t3 = t * t * t;
  return t3 > EPS ? t3 : (116 * t - 16) / KAPPA;
};
const encodeSrgb = (v) => {
  const c = v <= 0 ? 0 : v >= 1 ? 1 : v;
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
};

export function rgbToLab(r, g, b) {
  const lr = SRGB_TO_LIN[r], lg = SRGB_TO_LIN[g], lb = SRGB_TO_LIN[b];
  const X = 0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb;
  const Y = 0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb;
  const Z = 0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb;
  const fx = labF(X / XN), fy = labF(Y), fz = labF(Z / ZN);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToLinear(L, a, b) {
  const fy = (L + 16) / 116;
  const X = labFinv(fy + a / 500) * XN;
  const Y = labFinv(fy);
  const Z = labFinv(fy - b / 200) * ZN;
  return [
    3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    -0.969266 * X + 1.8760108 * Y + 0.041556 * Z,
    0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  ];
}

const inGamut = (v) => v[0] >= -1e-4 && v[0] <= 1.0001 && v[1] >= -1e-4 && v[1] <= 1.0001 && v[2] >= -1e-4 && v[2] <= 1.0001;

/** Lab -> sRGB bytes, reducing chroma (not lightness) when the color is out of gamut. */
export function labToRgb(L, a, b) {
  let lin = labToLinear(L, a, b);
  if (!inGamut(lin)) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(labToLinear(L, a * mid, b * mid))) lo = mid;
      else hi = mid;
    }
    lin = labToLinear(L, a * lo, b * lo);
  }
  return [encodeSrgb(lin[0]), encodeSrgb(lin[1]), encodeSrgb(lin[2])];
}

/** RGBA -> three Lab planes. */
export function rgbaToLab(rgba, w, h) {
  const n = w * h;
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const lab = rgbToLab(rgba[o], rgba[o + 1], rgba[o + 2]);
    L[i] = lab[0]; A[i] = lab[1]; B[i] = lab[2];
  }
  return { L, A, B, w, h };
}

/** Luminance-only rendering: every pixel becomes the grey with the same L*. */
export function luminanceOnlyRGBA(lab) {
  const n = lab.w * lab.h;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    // neutral grey: linear luminance Y follows directly from L*
    const g = encodeSrgb(labFinv((lab.L[i] + 16) / 116));
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = g;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Color-only rendering: hue and chroma kept, lightness fixed at L0 (the image's mean L* by default). */
export function chromaOnlyRGBA(lab, L0) {
  const n = lab.w * lab.h;
  if (L0 === undefined) {
    let s = 0;
    for (let i = 0; i < n; i++) s += lab.L[i];
    L0 = s / n;
  }
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const rgb = labToRgb(L0, lab.A[i], lab.B[i]);
    out[i * 4] = rgb[0]; out[i * 4 + 1] = rgb[1]; out[i * 4 + 2] = rgb[2]; out[i * 4 + 3] = 255;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Isoluminance: edges where color changes but lightness barely does
// ---------------------------------------------------------------------------

function gradientMagnitude(plane, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym = Math.max(y - 1, 0), yp = Math.min(y + 1, h - 1);
    for (let x = 0; x < w; x++) {
      const xm = Math.max(x - 1, 0), xp = Math.min(x + 1, w - 1);
      const gx = (plane[y * w + xp] - plane[y * w + xm]) / (xp - xm);
      const gy = (plane[yp * w + x] - plane[ym * w + x]) / (yp - ym);
      out[y * w + x] = Math.hypot(gx, gy);
    }
  }
  return out;
}

function gradientComponents(plane, w, h) {
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym = Math.max(y - 1, 0), yp = Math.min(y + 1, h - 1);
    for (let x = 0; x < w; x++) {
      const xm = Math.max(x - 1, 0), xp = Math.min(x + 1, w - 1);
      gx[y * w + x] = (plane[y * w + xp] - plane[y * w + xm]) / (xp - xm);
      gy[y * w + x] = (plane[yp * w + x] - plane[ym * w + x]) / (yp - ym);
    }
  }
  return { gx, gy };
}

/**
 * For every pixel compare the strength of the lightness edge (|grad L*|) with the
 * strength of the color edge (|grad (a*, b*)|).
 *   index = gC / (gC + gL)   0 = pure lightness edge, 1 = pure color edge
 * A pixel counts as an isoluminant edge when the color edge is strong enough to
 * matter (gC >= minColorEdge) and at least `ratio` times stronger than the lightness edge.
 * `share` is the fraction of strong color-edge pixels that are isoluminant.
 */
export function isoluminance(lab, { sigma = 1.2, minColorEdge = 2, ratio = 3 } = {}) {
  const { w, h } = lab;
  const L = gaussBlurPlane(lab.L, w, h, sigma);
  const A = gaussBlurPlane(lab.A, w, h, sigma);
  const B = gaussBlurPlane(lab.B, w, h, sigma);
  const gL = gradientMagnitude(L, w, h);
  const ga = gradientMagnitude(A, w, h);
  const gb = gradientMagnitude(B, w, h);
  const n = w * h;
  const gC = new Float32Array(n), index = new Float32Array(n), mask = new Uint8Array(n);
  let strong = 0, iso = 0;
  for (let i = 0; i < n; i++) {
    gC[i] = Math.hypot(ga[i], gb[i]);
    index[i] = gC[i] / (gC[i] + gL[i] + 1e-6);
    if (gC[i] >= minColorEdge) {
      strong++;
      if (gC[i] >= ratio * gL[i]) { mask[i] = 1; iso++; }
    }
  }
  return { w, h, gL, gC, index, mask, strong, iso, share: strong ? iso / strong : 0, params: { sigma, minColorEdge, ratio } };
}

/** RGBA overlay for an isoluminance result: opaque where the edge is isoluminant. */
export function isoOverlayRGBA(res, color = [24, 214, 224], minColorEdge = res.params.minColorEdge) {
  const n = res.w * res.h;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    if (!res.mask[i]) continue;
    const a = Math.min(1, res.gC[i] / (minColorEdge * 4)) * Math.min(1, 0.35 + res.index[i]);
    out[i * 4] = color[0]; out[i * 4 + 1] = color[1]; out[i * 4 + 2] = color[2];
    out[i * 4 + 3] = Math.round(255 * a);
  }
  return out;
}

/** Mean Lab inside a disc. Coordinates in pixels. */
export function meanLabInDisc(lab, cx, cy, r) {
  const { w, h } = lab;
  let n = 0, sl = 0, sa = 0, sb = 0;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = y * w + x;
      sl += lab.L[i]; sa += lab.A[i]; sb += lab.B[i]; n++;
    }
  }
  return n ? [sl / n, sa / n, sb / n] : [0, 0, 0];
}

/** Compare two Lab colors: lightness difference, color difference, and a plain-language verdict. */
export function compareColors(c1, c2) {
  const dL = c2[0] - c1[0];
  const dC = Math.hypot(c2[1] - c1[1], c2[2] - c1[2]);
  const dE = Math.hypot(dL, dC);
  let verdict = 'both';
  if (dE < 8) verdict = 'nearly identical';
  else if (Math.abs(dL) <= 6 && dC >= 15) verdict = 'isoluminant: color differs, lightness does not';
  else if (dC < 15 && Math.abs(dL) > 6) verdict = 'lightness edge';
  return { dL, dC, dE, verdict };
}

// ---------------------------------------------------------------------------
// Bottom-up saliency (a compact Itti-Koch-Niebur 1998 style model)
// ---------------------------------------------------------------------------

function normalizeItti(m) {
  let max = 0, sum = 0;
  for (let i = 0; i < m.length; i++) { if (m[i] > max) max = m[i]; sum += m[i]; }
  if (max < 1e-9) return m;
  const mean = sum / m.length;
  const gain = (1 - mean / max) ** 2 / max;
  const out = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = m[i] * gain;
  return out;
}

function addInto(dst, src, wt = 1) {
  for (let i = 0; i < dst.length; i++) dst[i] += src[i] * wt;
}

function centerSurround(planes, pairs) {
  const acc = new Float32Array(planes[0].length);
  for (const [c, s] of pairs) {
    const a = planes[c], b = planes[s];
    for (let i = 0; i < acc.length; i++) acc[i] += Math.abs(a[i] - b[i]);
  }
  return acc;
}

/**
 * Saliency map in [0, 1] for a Lab image. `weights` = {intensity, color, orientation}.
 * This is bottom-up only. It knows nothing about what the viewer is trying to find.
 */
export function saliency(lab, weights = { intensity: 1, color: 1, orientation: 1 }) {
  const { w, h } = lab;
  const sig = [1, 2, 4, 8, 16];
  const pairs = [[0, 2], [0, 3], [1, 3], [1, 4], [2, 4]];
  const pyr = (plane) => sig.map((s) => gaussBlurPlane(plane, w, h, s));

  const Ipl = pyr(Float32Array.from(lab.L, (v) => v / 100));
  const Apl = pyr(Float32Array.from(lab.A, (v) => v / 128));
  const Bpl = pyr(Float32Array.from(lab.B, (v) => v / 128));
  const cI = normalizeItti(centerSurround(Ipl, pairs));
  const cC = new Float32Array(w * h);
  addInto(cC, normalizeItti(centerSurround(Apl, pairs)));
  addInto(cC, normalizeItti(centerSurround(Bpl, pairs)));

  const smooth = gaussBlurPlane(lab.L, w, h, 1.5);
  const { gx, gy } = gradientComponents(smooth, w, h);
  const cO = new Float32Array(w * h);
  for (const th of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
    const c = Math.cos(th), s = Math.sin(th);
    const e = new Float32Array(w * h);
    for (let i = 0; i < e.length; i++) e[i] = Math.abs(gx[i] * c + gy[i] * s);
    addInto(cO, normalizeItti(centerSurround(pyr(e), pairs)));
  }

  const S = new Float32Array(w * h);
  addInto(S, normalizeItti(cI), weights.intensity ?? 1);
  addInto(S, normalizeItti(cC), weights.color ?? 1);
  addInto(S, normalizeItti(cO), weights.orientation ?? 1);
  const out = gaussBlurPlane(S, w, h, Math.max(2, Math.max(w, h) * 0.02));
  return normalizeUnit(out);
}

export function normalizeUnit(plane) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < plane.length; i++) { if (plane[i] < lo) lo = plane[i]; if (plane[i] > hi) hi = plane[i]; }
  const out = new Float32Array(plane.length);
  const span = hi - lo || 1;
  for (let i = 0; i < plane.length; i++) out[i] = (plane[i] - lo) / span;
  return out;
}

/**
 * Winner-take-all with inhibition of return. Returns fixation points in pixel coordinates.
 * The first fixation is drawn toward the image centre, as human first fixations are.
 */
export function simulateScanpath(sal, w, h, { n = 10, iorSigma = Math.max(w, h) * 0.08 } = {}) {
  const work = Float32Array.from(sal);
  const pts = [];
  const cx = w / 2, cy = h / 2, cs = Math.max(w, h) * 0.35;
  for (let k = 0; k < n; k++) {
    let best = -1, bi = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let v = work[i];
        if (k === 0) v *= Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * cs * cs));
        if (v > best) { best = v; bi = i; }
      }
    }
    const px = bi % w, py = (bi / w) | 0;
    pts.push({ x: px, y: py });
    const reach = iorSigma * 3;
    const x0 = Math.max(0, Math.floor(px - reach)), x1 = Math.min(w - 1, Math.ceil(px + reach));
    const y0 = Math.max(0, Math.floor(py - reach)), y1 = Math.min(h - 1, Math.ceil(py + reach));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d2 = (x - px) ** 2 + (y - py) ** 2;
        const q = d2 / (2 * iorSigma * iorSigma);
        work[y * w + x] *= 1 - Math.exp(-q * q);
      }
    }
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Gaze-like recordings: fixation detection and scoring
// ---------------------------------------------------------------------------

/**
 * Dispersion-threshold identification (I-DT, Salvucci & Goldberg 2000).
 * samples: [{x, y, t}] with t in ms, sorted by t.
 * Returns [{x, y, t0, dur}] where x, y is the centroid.
 */
export function detectFixations(samples, { maxDispersion = 28, minDuration = 120 } = {}) {
  const out = [];
  const n = samples.length;
  const disp = (i, j) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = i; k <= j; k++) {
      const s = samples[k];
      if (s.x < x0) x0 = s.x; if (s.x > x1) x1 = s.x;
      if (s.y < y0) y0 = s.y; if (s.y > y1) y1 = s.y;
    }
    return x1 - x0 + (y1 - y0);
  };
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && samples[j].t - samples[i].t < minDuration) j++;
    if (j >= n) break;
    if (disp(i, j) <= maxDispersion) {
      while (j + 1 < n && disp(i, j + 1) <= maxDispersion) j++;
      let sx = 0, sy = 0;
      for (let k = i; k <= j; k++) { sx += samples[k].x; sy += samples[k].y; }
      const cnt = j - i + 1;
      out.push({ x: sx / cnt, y: sy / cnt, t0: samples[i].t, dur: samples[j].t - samples[i].t });
      i = j + 1;
    } else i++;
  }
  return out;
}

/** Normalised scanpath saliency (Peters et al. 2005): mean z-scored saliency at the fixations. */
export function nss(sal, w, h, points) {
  if (!points.length) return NaN;
  let mean = 0;
  for (let i = 0; i < sal.length; i++) mean += sal[i];
  mean /= sal.length;
  let v = 0;
  for (let i = 0; i < sal.length; i++) v += (sal[i] - mean) ** 2;
  const sd = Math.sqrt(v / sal.length) || 1;
  let s = 0;
  for (const p of points) {
    const x = Math.min(w - 1, Math.max(0, Math.round(p.x)));
    const y = Math.min(h - 1, Math.max(0, Math.round(p.y)));
    s += (sal[y * w + x] - mean) / sd;
  }
  return s / points.length;
}

/** Dwell-time heat map: each fixation adds its duration, blurred, scaled to [0, 1]. */
export function dwellMap(fixations, w, h, sigma = Math.max(w, h) * 0.035) {
  const plane = new Float32Array(w * h);
  for (const f of fixations) {
    const x = Math.min(w - 1, Math.max(0, Math.round(f.x)));
    const y = Math.min(h - 1, Math.max(0, Math.round(f.y)));
    plane[y * w + x] += f.dur;
  }
  return normalizeUnit(gaussBlurPlane(plane, w, h, sigma));
}
