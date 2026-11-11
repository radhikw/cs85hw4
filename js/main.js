// main.js: state, loading, the four lenses, and the interface.

import {
  buildPyramid, rgbaToLab, luminanceOnlyRGBA, chromaOnlyRGBA, isoluminance, isoOverlayRGBA,
  meanLabInDisc, compareColors, saliency, simulateScanpath, detectFixations, nss, dwellMap,
  cutoffCpd, equivalentDistanceM, GP,
} from './imageops.js';
import { Viewer, MODE } from './viewer.js';
import { CASES, REFS, CITES, LENS_NOTES, GENERIC_TASKS } from './content.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const WORK_MAX = 1100;               // longest side of the working image, px
const ANALYSIS_MAX = 560;            // longest side for lightness/color analysis
const SALIENCY_MAX = 192;            // longest side for the saliency model
const SIGMAS = [0, 1.5, 3, 6, 12, 24, 48];
const LUM_LAYER = SIGMAS.length;     // lightness-only layer
const CHROMA_LAYER = SIGMAS.length + 1;
const REC_SECONDS = 30;
const REC_FOV = 16;                  // degrees across the longer side while recording
const REC_FALLOFF = 8;
const RUN_COLORS = ['#ffd23f', '#ff6a3d', '#42e0b4', '#7fb0ff', '#f08cff'];

// ---------------------------------------------------------------- state

const S = {
  lens: 'fovea',
  fov: 20, falloff: 4, colorFade: false, ring: true,
  lumView: 'lum', split: 0.5, iso: false, isoThr: 4, probe: false, probes: [],
  freqMode: 'blur', sigma: 6,
  task: 0, showPath: true, showHeat: false, showSal: false, showModel: false,
  fix: [0, 0],
};

const el = {};
let catalog = [];
let viewer = null;
let current = null;    // catalogue entry in view
let img = null;        // { w, h, canvas, widthCm, analysis, iso, sal }
let runs = [];         // recordings for the current painting
let rec = null;        // active recording
const shares = new Map();   // `${id}@${thr}` -> isoluminant share
let drawQueued = false;
let loadToken = 0;

// ---------------------------------------------------------------- loading

function loadImageEl(src, cors = true) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    if (cors) im.crossOrigin = 'anonymous';
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`Could not load ${src}`));
    im.src = src;
  });
}

async function fetchSource(p) {
  if (p.objectUrl) return { image: await loadImageEl(p.objectUrl, false), local: true };
  try {
    return { image: await loadImageEl(`assets/paintings/${p.file}`), local: true };
  } catch {
    return { image: await loadImageEl(p.remote), local: false };
  }
}

function drawSource({ image, local }, p, maxSide) {
  let sx = 0, sy = 0, sw = image.naturalWidth, sh = image.naturalHeight;
  if (!local && p.crop) {
    sx = Math.round(p.crop[0] * sw); sy = Math.round(p.crop[1] * sh);
    sw = Math.round((p.crop[2] - p.crop[0]) * image.naturalWidth);
    sh = Math.round((p.crop[3] - p.crop[1]) * image.naturalHeight);
  }
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(image, sx, sy, sw, sh, 0, 0, w, h);
  return { canvas, w, h, local };
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

function setLoading(text) {
  el.loading.textContent = text || '';
  el.loading.hidden = !text;
}

async function loadPainting(p) {
  const token = ++loadToken;
  stopRecording(false);
  current = p;
  setLoading('Preparing the painting');
  highlightShelf();
  renderPlate();
  renderCase();
  el.fallback.hidden = true;

  let source;
  try {
    source = await fetchSource(p);
  } catch (e) {
    setLoading('');
    el.fallback.hidden = false;
    el.fallback.textContent = 'The painting could not be loaded. Check your connection, or run scripts/fetch_paintings.py to store the images locally.';
    return;
  }
  if (token !== loadToken) return;
  if (!source.local || p.crop && !source.local) {
    el.fallback.hidden = false;
    el.fallback.textContent = 'Loaded from Wikimedia Commons. Run scripts/fetch_paintings.py to keep local copies.';
  }

  const drawn = drawSource(source, p, WORK_MAX);
  const data = drawn.canvas.getContext('2d').getImageData(0, 0, drawn.w, drawn.h).data;
  const regionWidthCm = p.widthCm * (p.crop ? p.crop[2] - p.crop[0] : 1);

  const layers = [];
  const pyramid = await buildPyramid(data, drawn.w, drawn.h, SIGMAS, async (i, n) => {
    setLoading(`Blurring: level ${i + 1} of ${n}`);
    await nextFrame();
  });
  if (token !== loadToken) return;
  setLoading('Separating lightness from color');
  await nextFrame();
  const lab = rgbaToLab(data, drawn.w, drawn.h);
  layers.push(...pyramid, luminanceOnlyRGBA(lab), chromaOnlyRGBA(lab));
  if (token !== loadToken) return;

  img = { w: drawn.w, h: drawn.h, canvas: drawn.canvas, widthCm: regionWidthCm, analysis: null, iso: null, sal: null };
  viewer.setImage(layers, drawn.w, drawn.h, SIGMAS);
  S.fix = [drawn.w / 2, drawn.h / 2];
  S.probes = [];
  runs = [];
  fitFrame();
  setLoading('');
  syncUI();
  requestDraw();
}

// ---------------------------------------------------------------- analysis (lazy)

function getAnalysis() {
  if (img.analysis) return img.analysis;
  const scale = Math.min(1, ANALYSIS_MAX / Math.max(img.w, img.h));
  const w = Math.round(img.w * scale), h = Math.round(img.h * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(img.canvas, 0, 0, w, h);
  const rgba = g.getImageData(0, 0, w, h).data;
  img.analysis = { w, h, scale: w / img.w, lab: rgbaToLab(rgba, w, h) };
  return img.analysis;
}

function getIso() {
  const thr = S.isoThr;
  if (img.iso && img.iso.thr === thr) return img.iso;
  const a = getAnalysis();
  const res = isoluminance(a.lab, { sigma: 1.2, minColorEdge: thr, ratio: 3 });
  const c = document.createElement('canvas');
  c.width = a.w; c.height = a.h;
  const g = c.getContext('2d');
  const id = g.createImageData(a.w, a.h);
  id.data.set(isoOverlayRGBA(res, [24, 200, 216], thr));
  g.putImageData(id, 0, 0);
  img.iso = { thr, res, canvas: c };
  shares.set(`${current.id}@${thr}`, res.share);
  return img.iso;
}

function getSaliency() {
  if (img.sal) return img.sal;
  const scale = Math.min(1, SALIENCY_MAX / Math.max(img.w, img.h));
  const w = Math.round(img.w * scale), h = Math.round(img.h * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(img.canvas, 0, 0, w, h);
  const lab = rgbaToLab(g.getImageData(0, 0, w, h).data, w, h);
  const map = saliency(lab);
  const path = simulateScanpath(map, w, h, { n: 10 });
  const oc = document.createElement('canvas');
  oc.width = w; oc.height = h;
  const og = oc.getContext('2d');
  const id = og.createImageData(w, h);
  for (let i = 0; i < map.length; i++) {
    const v = map[i];
    id.data[i * 4] = 40 + 90 * v; id.data[i * 4 + 1] = 90 + 150 * v; id.data[i * 4 + 2] = 255;
    id.data[i * 4 + 3] = Math.round(255 * Math.pow(v, 1.4) * 0.8);
  }
  og.putImageData(id, 0, 0);
  img.sal = { w, h, map, path, canvas: oc, scale: w / img.w };
  return img.sal;
}

function heatCanvas(map, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const id = g.createImageData(w, h);
  for (let i = 0; i < map.length; i++) {
    const v = map[i];
    id.data[i * 4] = 255; id.data[i * 4 + 1] = Math.round(210 - 150 * v); id.data[i * 4 + 2] = Math.round(60 - 40 * v);
    id.data[i * 4 + 3] = Math.round(255 * Math.pow(v, 1.2) * 0.8);
  }
  g.putImageData(id, 0, 0);
  return c;
}

// ---------------------------------------------------------------- rendering

function fitFrame() {
  if (!img) return;
  const wrap = el.canvasWrap;
  const cs = getComputedStyle(wrap);
  const availW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const s = Math.min(availW / img.w, availH / img.h);
  const w = Math.max(40, Math.floor(img.w * s)), h = Math.max(40, Math.floor(img.h * s));
  el.frame.style.width = `${w}px`;
  el.frame.style.height = `${h}px`;
  viewer.fit(w, h);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  el.overlay.width = Math.round(w * dpr);
  el.overlay.height = Math.round(h * dpr);
  requestDraw();
}

function renderParams() {
  const longSide = Math.max(img.w, img.h);
  if (rec && rec.active) return { mode: MODE.FOVEA, fix: S.fix, ppd: longSide / REC_FOV, k: REC_FALLOFF };
  switch (S.lens) {
    case 'fovea':
      return { mode: MODE.FOVEA, fix: S.fix, ppd: longSide / S.fov, k: S.falloff, colorFade: S.colorFade ? 22 : 0 };
    case 'luminance':
      if (S.lumView === 'color') return { mode: MODE.PLAIN };
      return { mode: MODE.SPLIT, split: S.split, layerB: S.lumView === 'lum' ? LUM_LAYER : CHROMA_LAYER };
    case 'distance':
      if (S.freqMode === 'blur') return { mode: MODE.BLUR, sigma: S.sigma };
      if (S.freqMode === 'detail') return { mode: MODE.DETAIL, sigma: S.sigma };
      return { mode: MODE.PLAIN };
    default:
      return { mode: MODE.PLAIN };
  }
}

function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    if (!img) return;
    viewer.render(renderParams());
    drawOverlay();
  });
}

function drawOverlay() {
  const c = el.overlay, g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (!img) return;
  const k = c.width / img.w;                  // device px per image px
  const dpr = c.width / parseFloat(el.frame.style.width || c.width);
  g.imageSmoothingEnabled = true;

  if (S.lens === 'luminance' && S.iso) {
    g.globalAlpha = 0.95;
    g.drawImage(getIso().canvas, 0, 0, c.width, c.height);
    g.globalAlpha = 1;
  }

  if (S.lens === 'scanpath' && !(rec && rec.active)) {
    if (S.showSal) { g.globalAlpha = 0.85; g.drawImage(getSaliency().canvas, 0, 0, c.width, c.height); g.globalAlpha = 1; }
    if (S.showHeat) {
      runs.forEach((r) => { if (r.heat) { g.globalAlpha = 0.7; g.drawImage(r.heat, 0, 0, c.width, c.height); g.globalAlpha = 1; } });
    }
    if (S.showPath) runs.forEach((r) => drawFixations(g, r.fixations, r.color, k, dpr, false));
    if (S.showModel) {
      const sal = getSaliency();
      const pts = sal.path.map((p, i) => ({ x: p.x / sal.scale, y: p.y / sal.scale, dur: 300, i }));
      drawFixations(g, pts, '#ffffff', k, dpr, true);
    }
  }

  if (S.lens === 'luminance') {
    S.probes.forEach((p, i) => {
      const r = probeRadius() * k;
      g.lineWidth = 2 * dpr;
      g.strokeStyle = '#fff';
      g.beginPath(); g.arc(p.x * k, p.y * k, r, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = '#16181b'; g.lineWidth = 1 * dpr;
      g.beginPath(); g.arc(p.x * k, p.y * k, r + 2 * dpr, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#fff'; g.font = `700 ${13 * dpr}px Atkinson Hyperlegible, sans-serif`;
      g.textAlign = 'left'; g.textBaseline = 'bottom';
      g.fillText(i === 0 ? 'A' : 'B', p.x * k + r + 4 * dpr, p.y * k - r * 0.2);
    });
    if (S.lumView !== 'color') drawDivider(g, c, dpr);
  }

  const ringOn = (S.lens === 'fovea' && S.ring) || (rec && rec.active);
  if (ringOn) {
    const ppd = Math.max(img.w, img.h) / (rec && rec.active ? REC_FOV : S.fov);
    const r = Math.max(6 * dpr, ppd * 1.0 * k);       // the fovea is about 2 degrees across
    g.lineWidth = 2 * dpr;
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.beginPath(); g.arc(S.fix[0] * k, S.fix[1] * k, r, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(22,24,27,0.75)'; g.lineWidth = 1 * dpr;
    g.beginPath(); g.arc(S.fix[0] * k, S.fix[1] * k, r + 2 * dpr, 0, Math.PI * 2); g.stroke();
  }
}

function drawDivider(g, c, dpr) {
  const x = S.split * c.width, y = c.height / 2, r = 14 * dpr;
  g.fillStyle = '#edeff0'; g.strokeStyle = '#16181b'; g.lineWidth = 1.5 * dpr;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#16181b';
  const a = 5 * dpr;
  g.beginPath(); g.moveTo(x - 4 * dpr, y); g.lineTo(x - 4 * dpr - a, y - a); g.lineTo(x - 4 * dpr - a, y + a); g.fill();
  g.beginPath(); g.moveTo(x + 4 * dpr, y); g.lineTo(x + 4 * dpr + a, y - a); g.lineTo(x + 4 * dpr + a, y + a); g.fill();
}

function drawFixations(g, fx, color, k, dpr, dashed) {
  if (!fx.length) return;
  g.lineJoin = 'round';
  const trace = (w, style) => {
    g.lineWidth = w * dpr; g.strokeStyle = style;
    if (dashed) g.setLineDash([6 * dpr, 5 * dpr]); else g.setLineDash([]);
    g.beginPath();
    fx.forEach((f, i) => (i ? g.lineTo(f.x * k, f.y * k) : g.moveTo(f.x * k, f.y * k)));
    g.stroke(); g.setLineDash([]);
  };
  trace(4, 'rgba(22,24,27,0.75)');
  trace(2, color);
  fx.forEach((f, i) => {
    const r = Math.min(26, 7 + Math.sqrt(f.dur / 40)) * dpr;
    g.beginPath(); g.arc(f.x * k, f.y * k, r, 0, Math.PI * 2);
    g.fillStyle = dashed ? 'rgba(255,255,255,0.25)' : hexAlpha(color, 0.4); g.fill();
    g.lineWidth = 2 * dpr; g.strokeStyle = '#16181b'; g.stroke();
    g.lineWidth = 1.2 * dpr; g.strokeStyle = color; g.stroke();
    if (r > 9 * dpr) {
      g.fillStyle = '#fff'; g.font = `700 ${11 * dpr}px Atkinson Hyperlegible, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.strokeStyle = '#16181b'; g.lineWidth = 3 * dpr; g.strokeText(String(i + 1), f.x * k, f.y * k);
      g.fillText(String(i + 1), f.x * k, f.y * k);
    }
  });
}

function hexAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

const probeRadius = () => Math.max(6, img.w * 0.012);

// ---------------------------------------------------------------- pointer and keyboard

function pointerToImage(ev) {
  const r = el.gl.getBoundingClientRect();
  return [
    Math.min(img.w, Math.max(0, ((ev.clientX - r.left) / r.width) * img.w)),
    Math.min(img.h, Math.max(0, ((ev.clientY - r.top) / r.height) * img.h)),
  ];
}

let dragging = null;

function onPointerDown(ev) {
  if (!img) return;
  const p = pointerToImage(ev);
  if (S.lens === 'luminance') {
    const r = el.gl.getBoundingClientRect();
    const nearDivider = S.lumView !== 'color' && Math.abs(ev.clientX - (r.left + S.split * r.width)) < 22;
    if (S.probe && !nearDivider) { placeProbe(p); return; }
    if (nearDivider) { dragging = 'divider'; el.gl.setPointerCapture(ev.pointerId); return; }
  }
  if (S.lens === 'fovea' || (rec && rec.active)) { S.fix = p; requestDraw(); }
}

function onPointerMove(ev) {
  if (!img) return;
  el.intro.classList.add('gone');
  const p = pointerToImage(ev);
  if (dragging === 'divider') {
    S.split = Math.min(1, Math.max(0, p[0] / img.w));
    el.split.value = String(Math.round(S.split * 100));
    el.splitOut.textContent = `${Math.round(S.split * 100)}%`;
    requestDraw();
    return;
  }
  if (S.lens === 'fovea' || (rec && rec.active)) { S.fix = p; requestDraw(); }
  if (S.lens === 'luminance') {
    const r = el.gl.getBoundingClientRect();
    const near = S.lumView !== 'color' && Math.abs(ev.clientX - (r.left + S.split * r.width)) < 22;
    el.gl.style.cursor = near ? 'ew-resize' : S.probe ? 'crosshair' : 'default';
  }
}

function onPointerUp(ev) {
  if (dragging) { dragging = null; try { el.gl.releasePointerCapture(ev.pointerId); } catch { /* not captured */ } }
}

function onKey(ev) {
  if (!img) return;
  const step = (ev.shiftKey ? 0.08 : 0.025);
  const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
  if (!move) return;
  ev.preventDefault();
  el.intro.classList.add('gone');
  if (S.lens === 'luminance' && S.lumView !== 'color' && move[0]) {
    S.split = Math.min(1, Math.max(0, S.split + move[0] * step));
    el.split.value = String(Math.round(S.split * 100));
    el.splitOut.textContent = `${Math.round(S.split * 100)}%`;
  } else {
    S.fix = [Math.min(img.w, Math.max(0, S.fix[0] + move[0] * step * img.w)), Math.min(img.h, Math.max(0, S.fix[1] + move[1] * step * img.h))];
  }
  requestDraw();
}

// ---------------------------------------------------------------- lens: luminance

function placeProbe(p) {
  if (S.probes.length >= 2) S.probes = [];
  S.probes.push({ x: p[0], y: p[1] });
  updateProbeReadout();
  requestDraw();
}

function updateProbeReadout() {
  const out = el.probeReadout;
  if (!S.probe) { out.innerHTML = ''; return; }
  if (S.probes.length === 0) { out.textContent = 'Click the first spot.'; return; }
  if (S.probes.length === 1) { out.textContent = 'Click the second spot.'; return; }
  const a = getAnalysis();
  const labs = S.probes.map((p) => meanLabInDisc(a.lab, p.x * a.scale, p.y * a.scale, probeRadius() * a.scale));
  const c = compareColors(labs[0], labs[1]);
  const isIso = c.verdict.startsWith('isoluminant');
  out.innerHTML = `Lightness (L*) of A is <b>${labs[0][0].toFixed(0)}</b> and of B is <b>${labs[1][0].toFixed(0)}</b>, a difference of <b>${Math.abs(c.dL).toFixed(1)}</b>. ` +
    `The colors differ by <b>${c.dC.toFixed(0)}</b> in chroma. <span class="tag ${isIso ? 'iso' : ''}">${c.verdict}</span>`;
}

function updateIsoReadout() {
  const out = el.isoReadout;
  if (!img || !(S.iso || S.lens === 'luminance')) { out.textContent = ''; return; }
  const { res } = getIso();
  const pct = Math.round(res.share * 100);
  const total = res.w * res.h;
  out.innerHTML = res.strong
    ? `Of the pixels on strong color edges (<b>${(100 * res.strong / total).toFixed(1)}%</b> of the painting), <b>${pct}%</b> change in color far more than in lightness.`
    : 'No color edges are strong enough at this threshold. Lower it.';
}

async function runCompare() {
  const box = el.compare;
  box.hidden = false;
  const thr = S.isoThr;
    const label = (p) => p.short || p.title;
  for (let n = 0; n < catalog.length; n++) {
    const p = catalog[n];
    const key = `${p.id}@${thr}`;
    if (!shares.has(key)) {
      box.innerHTML = `<p>Measuring ${n + 1} of ${catalog.length}: ${label(p)}</p>`;
      await nextFrame();
      try {
        if (img && current && p.id === current.id) getIso();
        else {
          const drawn = drawSource(await fetchSource(p), p, ANALYSIS_MAX);
          const rgba = drawn.canvas.getContext('2d').getImageData(0, 0, drawn.w, drawn.h).data;
          shares.set(key, isoluminance(rgbaToLab(rgba, drawn.w, drawn.h), { sigma: 1.2, minColorEdge: thr, ratio: 3 }).share);
        }
      } catch { shares.set(key, NaN); }
    }
  }
  const rows = catalog.map((p) => ({ p, v: shares.get(`${p.id}@${thr}`) })).sort((a, b) => b.v - a.v);
  box.innerHTML = '<ol>' + rows.map(({ p, v }) =>
    `<li class="${current && p.id === current.id ? 'current' : ''}"><span class="name">${label(p)}</span><span class="track"><i style="width:${Number.isNaN(v) ? 0 : Math.round(v * 100)}%"></i></span><span class="val">${Number.isNaN(v) ? 'n/a' : Math.round(v * 100) + '%'}</span></li>`).join('') + '</ol>' +
    '<p>Share of strong color edges that are isoluminant, at the current threshold. Move the threshold and the order changes: low thresholds count brushwork and canvas texture as edges. Six reproductions are a prompt for questions, not a sample.</p>';
}

// ---------------------------------------------------------------- lens: distance

const sigmaFromSlider = (v) => 0.6 * Math.pow(60 / 0.6, v / 100);   // 0.6 px .. 60 px, log scale
const sliderFromSigma = (s) => Math.round(100 * Math.log(s / 0.6) / Math.log(60 / 0.6));

function updateDistReadout() {
  if (!img) return;
  const out = el.distReadout;
  if (S.freqMode === 'off') { out.textContent = ''; return; }
  const d = equivalentDistanceM(S.sigma, img.w, img.widthCm);
  const w = img.widthCm >= 100 ? `${(img.widthCm / 100).toFixed(1)} m` : `${Math.round(img.widthCm)} cm`;
  out.innerHTML = d
    ? `Central vision would blur this much only from about <b>${d < 10 ? d.toFixed(1) : Math.round(d)} m</b> away (the visible area is ${w} wide).`
    : '';
}

// ---------------------------------------------------------------- lens: fovea

function updateFoveaReadout() {
  if (!img) return;
  const half = Math.hypot(img.w, img.h) / 2 / (Math.max(img.w, img.h) / S.fov);
  const lab = (1 + half / GP.e2).toFixed(0);
  const mine = (1 + (S.falloff * half) / GP.e2).toFixed(0);
  el.foveaReadout.innerHTML = `At the far corner, about <b>${half.toFixed(0)}°</b> from the center, the finest detail you can see is roughly <b>${lab}×</b> coarser than at the fixation point. Your setting shows <b>${mine}×</b>.`;
}

// ---------------------------------------------------------------- lens: scanpath

function tasksFor(p) {
  return (CASES[p.id] && CASES[p.id].tasks) || GENERIC_TASKS;
}

function startRecording() {
  if (!img) return;
  el.intro.classList.add('gone');
  S.fix = [img.w / 2, img.h / 2];
  rec = { active: true, t0: performance.now(), samples: [], task: S.task, taskName: tasksFor(current)[S.task] };
  el.recBtn.dataset.state = 'recording';
  el.recBtn.textContent = 'Stop';
  el.scanReadout.textContent = 'Recording. Move the fovea, and hold still where you want to look closely.';
  const tick = () => {
    if (!rec || !rec.active) return;
    const t = performance.now() - rec.t0;
    rec.samples.push({ x: S.fix[0], y: S.fix[1], t });
    const left = Math.max(0, REC_SECONDS - t / 1000);
    el.timer.textContent = `${left.toFixed(0)} s left`;
    if (left <= 0) { stopRecording(true); return; }
    rec.raf = requestAnimationFrame(tick);
  };
  rec.raf = requestAnimationFrame(tick);
  requestDraw();
}

function stopRecording(save) {
  if (!rec) return;
  const r = rec;
  rec = null;
  cancelAnimationFrame(r.raf);
  r.active = false;
  el.recBtn.dataset.state = '';
  el.recBtn.textContent = `Start, ${REC_SECONDS} seconds`;
  el.timer.textContent = '';
  if (save && img) finishRun(r);
  else el.scanReadout.textContent = '';
  requestDraw();
}

function finishRun(r) {
  const fixations = detectFixations(r.samples, { maxDispersion: img.w * 0.03, minDuration: 120 });
  if (fixations.length < 2) {
    el.scanReadout.textContent = 'Too few fixations to analyze. Hold the cursor still on the things you want to inspect.';
    return;
  }
  const sal = getSaliency();
  const score = nss(sal.map, sal.w, sal.h, fixations.map((f) => ({ x: f.x * sal.scale, y: f.y * sal.scale })));
  const color = RUN_COLORS[runs.length % RUN_COLORS.length];
  const heatMap = dwellMap(fixations.map((f) => ({ x: f.x * sal.scale, y: f.y * sal.scale, dur: f.dur })), sal.w, sal.h);
  runs.push({
    task: r.taskName, color, fixations, nss: score, heat: heatCanvas(heatMap, sal.w, sal.h),
    meanDur: fixations.reduce((a, f) => a + f.dur, 0) / fixations.length,
  });
  S.showPath = true;
  el.showPath.checked = true;
  renderRuns();
}

function renderRuns() {
  el.runs.innerHTML = runs.map((r) =>
    `<li><i style="background:${r.color}"></i><span>${r.task}</span><span class="n">${r.fixations.length} fixations, NSS ${r.nss.toFixed(2)}</span></li>`).join('');
  el.clearRuns.hidden = runs.length === 0;
  el.scanReadout.innerHTML = runs.length
    ? 'NSS is the model’s average z-score at your fixations. Zero is chance. Higher means a bottom-up model, blind to your task, predicted where you looked. Compare tasks.'
    : '';
}

// ---------------------------------------------------------------- interface

function syncUI() {
  if (!current) return;
  $$('.tabs button').forEach((b) => { const on = b.dataset.lens === S.lens; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
  $$('.panel').forEach((p) => { p.hidden = p.id !== `panel-${S.lens}`; });

  el.fov.value = S.fov; el.fovOut.textContent = `${S.fov}°`;
  el.falloff.value = S.falloff; el.falloffOut.textContent = `×${S.falloff}`;
  el.colorFade.checked = S.colorFade; el.ring.checked = S.ring;

  $$('[data-lumview]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.lumview === S.lumView));
  el.split.value = Math.round(S.split * 100); el.splitOut.textContent = `${Math.round(S.split * 100)}%`;
  el.splitCtl.hidden = S.lumView === 'color';
  el.iso.checked = S.iso;
  el.thr.value = S.isoThr; el.thrOut.textContent = S.isoThr.toFixed(2).replace(/0$/, '');
  el.thrCtl.hidden = !S.iso;
  el.probeBtn.setAttribute('aria-pressed', S.probe);
  el.probeBtn.textContent = S.probe ? 'Stop measuring' : 'Measure two spots';

  $$('[data-freq]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.freq === S.freqMode));
  el.sigma.value = sliderFromSigma(S.sigma); el.sigma.disabled = S.freqMode === 'off';
  el.sigmaOut.textContent = `${S.sigma.toFixed(1)} px`;

  const tasks = tasksFor(current);
  if (el.task.dataset.painting !== current.id) {
    el.task.innerHTML = tasks.map((t, i) => `<option value="${i}">${t}</option>`).join('');
    el.task.dataset.painting = current.id;
    S.task = 0;
  }
  el.task.value = S.task;
  el.showPath.checked = S.showPath; el.showHeat.checked = S.showHeat; el.showSal.checked = S.showSal; el.showModel.checked = S.showModel;
  renderRuns();

  updateFoveaReadout();
  updateDistReadout();
  if (img) { if (S.lens === 'luminance') updateIsoReadout(); }
  updateProbeReadout();
  el.gl.style.cursor = S.lens === 'luminance' ? (S.probe ? 'crosshair' : 'default') : 'crosshair';
}

function setLens(name) {
  if (name !== S.lens && rec) stopRecording(false);
  S.lens = name;
  if (name !== 'luminance') { S.probe = false; }
  syncUI();
  requestDraw();
}

function scrollToControls() {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.plate.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
}

function applyPreset(preset) {
  const set = preset.set || {};
  if (preset.lens) S.lens = preset.lens;
  const { fixFrac, compare, probesFrac, ...rest } = set;
  Object.assign(S, rest);
  if (fixFrac && img) S.fix = [fixFrac[0] * img.w, fixFrac[1] * img.h];
  if ('probe' in set) S.probes = (probesFrac && img) ? probesFrac.map(([x, y]) => ({ x: x * img.w, y: y * img.h })) : [];
  syncUI();
  requestDraw();
  if (compare) runCompare();
  if (S.lens === 'luminance' && S.iso) getIso();
  scrollToControls();
}

function renderPlate() {
  const p = current;
  const dims = p.heightCm && p.widthCm ? `${fmtCm(p.heightCm)} × ${fmtCm(p.widthCm)} cm` : '';
  el.plate.innerHTML = `<p class="artist">${p.artist}</p><h1>${p.title}</h1><p class="meta">${[p.year, [p.medium, dims].filter(Boolean).join(', ')].filter(Boolean).join('. ')}.<br>${p.collection}.</p>`;
}
const fmtCm = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function renderCase() {
  const c = CASES[current.id];
  if (!c) { el.case.innerHTML = ''; return; }
  const tryIt = c.presets.length
    ? `<div class="try" role="group" aria-label="Try it">${c.presets.map((p, i) => `<button type="button" class="btn" data-preset="${i}">${p.label}</button>`).join('')}</div>`
    : '';
  const [first, ...rest] = c.body;
  const cites = c.sources.map((s) => CITES[s]).filter(Boolean).join('; ');
  el.case.innerHTML = `<h2>${c.headline}</h2>${first}${tryIt}${rest.join('')}` +
    (cites ? `<p class="small">Sources: ${cites}. Full references are listed below.</p>` : '');
}

function renderShelf() {
  el.shelf.innerHTML = catalog.map((p) =>
    `<button type="button" data-id="${p.id}" title="${p.artist}, ${p.title}" aria-label="${p.artist}, ${p.title}"><img alt="" loading="lazy" src="assets/paintings/${p.file}" data-fallback="${p.remoteThumb}"></button>`).join('');
  $$('img', el.shelf).forEach((im) => im.addEventListener('error', () => { im.src = im.dataset.fallback; }, { once: true }));
}

function highlightShelf() {
  $$('button', el.shelf).forEach((b) => b.setAttribute('aria-current', current && b.dataset.id === current.id));
}

function renderStatic() {
  $('#method').innerHTML = `
    <p><b>Fovea.</b> The blur at each pixel comes from the contrast-sensitivity model of Geisler and Perry (1998): the finest visible spatial frequency falls with distance from the fixation point, from about ${cutoffCpd(0).toFixed(0)} cycles per degree at the center to ${cutoffCpd(10).toFixed(0)} at 10°. The model is turned into a Gaussian blur whose width grows with eccentricity. “Falloff” multiplies that growth, and ×1 is the lab estimate. Color fading is an illustration, not a calibrated model. Crowding, which limits peripheral vision more than blur does, is not modeled.</p>
    <p><b>Luminance.</b> Colors are converted to CIELAB. Lightness is L*. Color is the pair a*, b*. For each pixel the lens compares the strength of the edge in L* with the strength of the edge in (a*, b*). A pixel is marked when it lies on a strong color edge that is at least three times stronger than its lightness edge. Reproductions differ in color calibration, so treat percentages as rough.</p>
    <p><b>Distance.</b> Blur is a Gaussian of the chosen width. The distance readout asks how far away the painting would have to be for the eye’s acuity limit to produce that blur, using the real size of the canvas.</p>
    <p><b>Scanpath.</b> Your cursor stands in for the fovea, which is how BubbleView-style studies approximate eye tracking. Fixations are found with a dispersion-threshold method (I-DT). The saliency model follows Itti, Koch and Niebur (1998) in simplified form, and the model’s path uses winner-take-all selection with inhibition of return. NSS scores how well the model predicts your fixations. The model knows nothing about your task.</p>
    <p><b>What this does not show.</b> A mouse is not an eye, thirty seconds is not three minutes, and one viewer is not a study. The point is to make the ideas inspectable, not to replace the experiments.</p>`;
  $('#refs').innerHTML = Object.values(REFS).sort().map((r) => `<li>${r}</li>`).join('');
  $('#credits').innerHTML = '<ul>' + catalog.map((p) => `<li>${p.artist}, <i>${p.title}</i>, ${p.year}. ${p.collection}. <a href="${p.creditUrl}" rel="noopener">Wikimedia Commons</a>. ${p.license}.</li>`).join('') + '</ul>';
  for (const k of Object.keys(LENS_NOTES)) $(`#note-${k}`).textContent = LENS_NOTES[k];
}

function bind() {
  const ids = ['canvasWrap', 'frame', 'gl', 'overlay', 'intro', 'loading', 'fallback', 'shelf', 'plate', 'case',
    'fov', 'fovOut', 'falloff', 'falloffOut', 'colorFade', 'ring', 'foveaReadout',
    'split', 'splitOut', 'splitCtl', 'iso', 'thr', 'thrOut', 'thrCtl', 'isoReadout', 'probeBtn', 'compareBtn', 'probeReadout', 'compare',
    'sigma', 'sigmaOut', 'distReadout',
    'task', 'recBtn', 'timer', 'showPath', 'showHeat', 'showSal', 'showModel', 'runs', 'scanReadout', 'clearRuns', 'upload'];
  ids.forEach((id) => { el[id] = document.getElementById(id); });

  $$('.tabs button').forEach((b) => b.addEventListener('click', () => setLens(b.dataset.lens)));
  $('#tabs').addEventListener('keydown', (e) => {
    const tabs = $$('.tabs button'); const i = tabs.findIndex((b) => b.dataset.lens === S.lens);
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    const n = tabs[(i + d + tabs.length) % tabs.length]; setLens(n.dataset.lens); n.focus();
  });

  el.gl.addEventListener('pointerdown', onPointerDown);
  el.gl.addEventListener('pointermove', onPointerMove);
  el.gl.addEventListener('pointerup', onPointerUp);
  el.gl.addEventListener('pointercancel', onPointerUp);
  el.gl.addEventListener('keydown', onKey);

  el.fov.addEventListener('input', () => { S.fov = +el.fov.value; el.fovOut.textContent = `${S.fov}°`; updateFoveaReadout(); requestDraw(); });
  el.falloff.addEventListener('input', () => { S.falloff = +el.falloff.value; el.falloffOut.textContent = `×${S.falloff}`; updateFoveaReadout(); requestDraw(); });
  el.colorFade.addEventListener('change', () => { S.colorFade = el.colorFade.checked; requestDraw(); });
  el.ring.addEventListener('change', () => { S.ring = el.ring.checked; requestDraw(); });

  $$('[data-lumview]').forEach((b) => b.addEventListener('click', () => { S.lumView = b.dataset.lumview; syncUI(); requestDraw(); }));
  el.split.addEventListener('input', () => { S.split = +el.split.value / 100; el.splitOut.textContent = `${el.split.value}%`; requestDraw(); });
  el.iso.addEventListener('change', () => { S.iso = el.iso.checked; syncUI(); requestDraw(); });
  let thrTimer = 0;
  el.thr.addEventListener('input', () => {
    S.isoThr = +el.thr.value; el.thrOut.textContent = S.isoThr.toFixed(2).replace(/0$/, '');
    clearTimeout(thrTimer); thrTimer = setTimeout(() => { updateIsoReadout(); requestDraw(); }, 120);
  });
  el.probeBtn.addEventListener('click', () => { S.probe = !S.probe; S.probes = []; syncUI(); requestDraw(); });
  el.compareBtn.addEventListener('click', runCompare);

  $$('[data-freq]').forEach((b) => b.addEventListener('click', () => { S.freqMode = b.dataset.freq; syncUI(); requestDraw(); }));
  el.sigma.addEventListener('input', () => { S.sigma = sigmaFromSlider(+el.sigma.value); el.sigmaOut.textContent = `${S.sigma.toFixed(1)} px`; updateDistReadout(); requestDraw(); });

  el.task.addEventListener('change', () => { S.task = +el.task.value; });
  el.recBtn.addEventListener('click', () => { if (rec) stopRecording(true); else startRecording(); });
  const showBox = (id, key) => el[id].addEventListener('change', () => { S[key] = el[id].checked; requestDraw(); });
  showBox('showPath', 'showPath'); showBox('showHeat', 'showHeat'); showBox('showSal', 'showSal'); showBox('showModel', 'showModel');
  el.clearRuns.addEventListener('click', () => { runs = []; renderRuns(); requestDraw(); });

  el.shelf.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    const p = catalog.find((x) => x.id === b.dataset.id);
    if (p && (!current || p.id !== current.id)) { S.probes = []; S.iso = false; loadPainting(p); }
  });
  el.case.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-preset]');
    if (!b) return;
    applyPreset(CASES[current.id].presets[+b.dataset.preset]);
  });

  el.upload.addEventListener('change', () => {
    const f = el.upload.files[0];
    if (!f) return;
    const p = { id: 'custom', title: f.name.replace(/\.[^.]+$/, ''), artist: 'Your photograph', year: '', medium: '', collection: 'Shown only in this browser', widthCm: 60, heightCm: 0, objectUrl: URL.createObjectURL(f) };
    S.iso = false; S.probes = [];
    loadPainting(p);
  });

  new ResizeObserver(() => fitFrame()).observe(el.canvasWrap);
}

async function init() {
  bind();
  try {
    viewer = new Viewer(el.gl);
  } catch (e) {
    setLoading('');
    el.fallback.hidden = false;
    el.fallback.textContent = 'This page needs WebGL 2. Try a current version of Chrome, Firefox, Edge or Safari.';
    return;
  }
  catalog = await (await fetch('data/paintings.json')).json();
  renderShelf();
  renderStatic();
  const wanted = new URLSearchParams(location.search).get('p');
  await loadPainting(catalog.find((p) => p.id === wanted) || catalog[0]);
  window.__lab = { S, get img() { return img; }, get runs() { return runs; }, getIso, getAnalysis, getSaliency, applyPreset, setLens, loadPainting, catalog, get rec() { return rec; } };
}

init();
