import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cutoffCpd, sigmaDeg, sigmaPx, equivalentDistanceM,
  gaussBlurPlane, rgbToLab, labToRgb, rgbaToLab, luminanceOnlyRGBA, chromaOnlyRGBA,
  isoluminance, compareColors, meanLabInDisc, saliency, simulateScanpath,
  detectFixations, nss, dwellMap,
} from '../js/imageops.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

function makeRGBA(w, h, fn) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = fn(x, y);
    const o = (y * w + x) * 4;
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
  }
  return out;
}

test('acuity model matches Geisler & Perry cutoffs', () => {
  close(cutoffCpd(0), 39.2, 0.1, 'fovea');
  close(cutoffCpd(10), 7.34, 0.05, '10 degrees');
  // blur sigma grows linearly with (1 + e / e2)
  close(sigmaDeg(4.6) / sigmaDeg(0), 3, 1e-9, 'linear growth');
  close(sigmaPx(0, 40, 3), sigmaDeg(0) * 40, 1e-12, 'fovea is not exaggerated');
  close(sigmaPx(4.6, 40, 1), 3 * sigmaDeg(0) * 40, 1e-9, 'k = 1 matches the physical model');
  close(sigmaPx(4.6, 40, 4), 9 * sigmaDeg(0) * 40, 1e-9, 'k scales the growth with eccentricity');
});

test('equivalent viewing distance rises with blur', () => {
  const near = equivalentDistanceM(1, 1000, 100);
  const far = equivalentDistanceM(4, 1000, 100);
  assert.ok(far > near && near > 0);
  assert.equal(equivalentDistanceM(0, 1000, 100), null);
});

test('gaussian blur spreads a point with the requested variance', () => {
  const w = 129, h = 129;
  for (const sigma of [2, 5, 9]) {
    const p = new Float32Array(w * h);
    p[64 * w + 64] = 1;
    const b = gaussBlurPlane(p, w, h, sigma);
    let total = 0, varX = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = b[y * w + x]; total += v; varX += v * (x - 64) ** 2; }
    close(total, 1, 1e-3, 'mass preserved');
    close(Math.sqrt(varX / total), sigma, sigma * 0.08, `sigma ${sigma}`);
  }
});

test('blur preserves a constant image at the borders', () => {
  const w = 40, h = 30;
  const p = new Float32Array(w * h).fill(7);
  const b = gaussBlurPlane(p, w, h, 6);
  for (const v of b) close(v, 7, 1e-4);
});

test('sRGB to Lab reference values', () => {
  const white = rgbToLab(255, 255, 255);
  close(white[0], 100, 0.05); close(white[1], 0, 0.1); close(white[2], 0, 0.1);
  const black = rgbToLab(0, 0, 0);
  close(black[0], 0, 0.01);
  const red = rgbToLab(255, 0, 0);
  close(red[0], 53.24, 0.1); close(red[1], 80.09, 0.2); close(red[2], 67.2, 0.2);
  const grey = rgbToLab(128, 128, 128);
  close(grey[0], 53.59, 0.1);
});

test('Lab round trip', () => {
  for (const c of [[200, 80, 40], [12, 99, 180], [250, 250, 20], [90, 90, 90]]) {
    const lab = rgbToLab(...c);
    const back = labToRgb(...lab);
    for (let i = 0; i < 3; i++) close(back[i], c[i], 1, `channel ${i} of ${c}`);
  }
});

test('luminance-only keeps L*, chroma-only keeps hue at constant L*', () => {
  const w = 4, h = 1;
  const img = makeRGBA(w, h, (x) => [[255, 0, 0], [0, 128, 0], [30, 30, 200], [240, 240, 240]][x]);
  const lab = rgbaToLab(img, w, h);
  const lum = luminanceOnlyRGBA(lab);
  for (let i = 0; i < w; i++) {
    const back = rgbToLab(lum[i * 4], lum[i * 4 + 1], lum[i * 4 + 2]);
    close(back[0], lab.L[i], 0.8, `L* of pixel ${i}`);
    close(Math.hypot(back[1], back[2]), 0, 1.5, 'grey');
  }
  const chroma = chromaOnlyRGBA(lab, 60);
  for (let i = 0; i < w; i++) {
    const back = rgbToLab(chroma[i * 4], chroma[i * 4 + 1], chroma[i * 4 + 2]);
    close(back[0], 60, 1.5, `constant L* of pixel ${i}`);
  }
});

// A grey left half and a colored right half with (nearly) the same L*.
function equalLuminanceEdge(w, h) {
  const grey = [150, 150, 150];
  const L = rgbToLab(...grey)[0];
  // find a saturated orange-ish color at that L* by reducing red/green until L* matches
  let best = null, bestErr = 1e9;
  for (let r = 150; r <= 255; r += 1) for (let g = 40; g <= 200; g += 2) for (const b of [0, 20, 40, 60]) {
    const err = Math.abs(rgbToLab(r, g, b)[0] - L) + (g > 130 ? 100 : 0);
    if (err < bestErr) { bestErr = err; best = [r, g, b]; }
  }
  return { img: makeRGBA(w, h, (x) => (x < w / 2 ? grey : best)), colored: best };
}

test('isoluminance: an equal-lightness color edge is flagged, a lightness edge is not', () => {
  const w = 60, h = 20;
  const { img, colored } = equalLuminanceEdge(w, h);
  const lab = rgbaToLab(img, w, h);
  const dL = Math.abs(rgbToLab(150, 150, 150)[0] - rgbToLab(...colored)[0]);
  assert.ok(dL < 1.5, `test color should match lightness, dL = ${dL}`);
  const iso = isoluminance(lab, { sigma: 1, minColorEdge: 2 });
  assert.ok(iso.strong > 0, 'color edge detected');
  assert.ok(iso.share > 0.9, `share ${iso.share}`);

  const lightEdge = makeRGBA(w, h, (x) => (x < w / 2 ? [30, 30, 30] : [220, 220, 220]));
  const res2 = isoluminance(rgbaToLab(lightEdge, w, h), { sigma: 1, minColorEdge: 2 });
  assert.equal(res2.strong, 0, 'grey lightness edge has no color edge');
  assert.equal(res2.share, 0);
});

test('compareColors verdicts', () => {
  const grey = rgbToLab(150, 150, 150);
  const { colored } = equalLuminanceEdge(4, 4);
  assert.match(compareColors(grey, rgbToLab(...colored)).verdict, /isoluminant/);
  assert.match(compareColors(rgbToLab(20, 20, 20), rgbToLab(230, 230, 230)).verdict, /lightness edge/);
  assert.equal(compareColors(grey, grey).verdict, 'nearly identical');
});

test('meanLabInDisc averages inside the disc only', () => {
  const w = 40, h = 40;
  const img = makeRGBA(w, h, (x, y) => ((x - 20) ** 2 + (y - 20) ** 2 < 36 ? [255, 255, 255] : [0, 0, 0]));
  const lab = rgbaToLab(img, w, h);
  close(meanLabInDisc(lab, 20, 20, 4)[0], 100, 0.1);
  close(meanLabInDisc(lab, 3, 3, 2)[0], 0, 0.1);
});

test('saliency finds an odd-one-out and the simulated scanpath goes there first', () => {
  const w = 96, h = 72;
  const img = makeRGBA(w, h, (x, y) => ((x - 70) ** 2 + (y - 22) ** 2 < 25 ? [230, 20, 20] : [120, 120, 120]));
  const lab = rgbaToLab(img, w, h);
  const sal = saliency(lab);
  let bi = 0;
  for (let i = 1; i < sal.length; i++) if (sal[i] > sal[bi]) bi = i;
  close(bi % w, 70, 8, 'x of peak'); close((bi / w) | 0, 22, 8, 'y of peak');
  const path = simulateScanpath(sal, w, h, { n: 4, iorSigma: 8 });
  assert.equal(path.length, 4);
  close(path[0].x, 70, 10); close(path[0].y, 22, 10);
  const d01 = Math.hypot(path[1].x - path[0].x, path[1].y - path[0].y);
  assert.ok(d01 > 7, `inhibition of return moves the gaze elsewhere (moved ${d01.toFixed(1)}px)`);
});

test('fixation detection separates dwell from saccade', () => {
  const samples = [];
  let t = 0;
  const hold = (x, y, ms) => { for (let k = 0; k < ms / 16; k++) samples.push({ x: x + (k % 3), y: y + (k % 2), t: (t += 16) }); };
  hold(100, 100, 400);
  for (const [x, y] of [[160, 130], [260, 190], [330, 230]]) samples.push({ x, y, t: (t += 16) });
  hold(340, 240, 320);
  const fx = detectFixations(samples);
  assert.equal(fx.length, 2);
  close(fx[0].x, 101, 3); close(fx[1].x, 341, 3);
  assert.ok(fx[0].dur >= 350 && fx[1].dur >= 280);
});

test('NSS is positive on the peak, negative away from it, and the dwell map peaks at the fixation', () => {
  const w = 50, h = 40;
  const sal = new Float32Array(w * h);
  sal[20 * w + 25] = 1;
  const blurred = gaussBlurPlane(sal, w, h, 3);
  assert.ok(nss(blurred, w, h, [{ x: 25, y: 20 }]) > 2);
  assert.ok(nss(blurred, w, h, [{ x: 2, y: 2 }]) < 0.2);
  assert.ok(Number.isNaN(nss(blurred, w, h, [])));
  const dm = dwellMap([{ x: 10, y: 10, dur: 300 }, { x: 40, y: 30, dur: 900 }], w, h, 3);
  assert.ok(dm[30 * w + 40] > dm[10 * w + 10]);
});
