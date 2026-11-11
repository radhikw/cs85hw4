// viewer.js
// WebGL2 renderer. Holds the blurred versions of the painting as layers of one
// texture array and composites them per pixel according to the active lens.
//
// Layers
//   0..N-1   Gaussian pyramid, sigmas[0] = 0 (the original)
//   N        lightness only (grey with the same L*)
//   N+1      color only (hue and chroma at constant L*)

import { GP } from './imageops.js';

export const MODE = Object.freeze({ PLAIN: 0, FOVEA: 1, BLUR: 2, DETAIL: 3, SPLIT: 4 });

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const SIG0_DEG = (Math.sqrt(Math.LN2 / 2) / Math.PI) * GP.alpha / Math.log(1 / GP.ct0);

const FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform vec2 uImgSize;
uniform vec2 uFix;
uniform float uPpd;
uniform float uK;
uniform float uSig[8];
uniform int uLevels;
uniform int uMode;
uniform float uSigma;
uniform float uColorFade;
uniform float uSplit;
uniform float uLayerB;
uniform float uSig0Deg;
uniform float uE2;
in vec2 vUv;
out vec4 outColor;

vec3 level(vec2 uv, int i) { return texture(uTex, vec3(uv, float(i))).rgb; }

vec3 blurAt(vec2 uv, float s) {
  if (s <= uSig[0] + 1e-4) return level(uv, 0);
  for (int i = 0; i < 7; i++) {
    if (i + 1 >= uLevels) break;
    if (s <= uSig[i + 1]) {
      float t = (s - uSig[i]) / (uSig[i + 1] - uSig[i]);
      return mix(level(uv, i), level(uv, i + 1), t);
    }
  }
  return level(uv, uLevels - 1);
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec2 uv = vUv;
  vec3 c;
  if (uMode == 1) {
    vec2 p = uv * uImgSize;
    float ecc = distance(p, uFix) / uPpd;
    float s = uSig0Deg * uPpd * (1.0 + uK * ecc / uE2);
    c = blurAt(uv, s);
    if (uColorFade > 0.0) {
      float keep = 1.0 / (1.0 + pow(ecc / uColorFade, 2.0));
      c = mix(vec3(luma(c)), c, keep);
    }
  } else if (uMode == 2) {
    c = blurAt(uv, uSigma);
  } else if (uMode == 3) {
    vec3 a = level(uv, 0);
    vec3 b = blurAt(uv, uSigma);
    c = vec3(clamp(luma(a) - luma(b) + 0.5, 0.0, 1.0));
  } else if (uMode == 4) {
    c = uv.x < uSplit ? level(uv, 0) : texture(uTex, vec3(uv, uLayerB)).rgb;
    float d = abs(uv.x - uSplit) * uImgSize.x;
    if (d < 1.0) c = mix(c, vec3(1.0), 0.9);
  } else {
    c = level(uv, 0);
  }
  outColor = vec4(c, 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    gl.useProgram(prog);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.u = {};
    for (const n of ['uTex', 'uImgSize', 'uFix', 'uPpd', 'uK', 'uSig', 'uLevels', 'uMode', 'uSigma',
      'uColorFade', 'uSplit', 'uLayerB', 'uSig0Deg', 'uE2']) this.u[n] = gl.getUniformLocation(prog, n);
    this.tex = null;
    this.layers = 0;
    this.sigmas = [];
    this.imgW = 0;
    this.imgH = 0;
  }

  /** layers: array of Uint8ClampedArray RGBA, all w*h. nBlur: how many are pyramid levels. */
  setImage(layers, w, h, sigmas) {
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex);
    this.tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, w, h, layers.length);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    layers.forEach((data, i) => {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
    });
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.layers = layers.length;
    this.sigmas = sigmas;
    this.imgW = w;
    this.imgH = h;
  }

  /** Match the drawing buffer to the CSS size of the canvas. */
  fit(cssW, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /**
   * p: { mode, fix:[x,y] (image px), ppd, k, sigma, colorFade, split, layerB }
   */
  render(p) {
    const gl = this.gl;
    if (!this.tex) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    const u = this.u;
    const sig = new Float32Array(8);
    this.sigmas.forEach((s, i) => { if (i < 8) sig[i] = s; });
    gl.uniform1i(u.uTex, 0);
    gl.uniform2f(u.uImgSize, this.imgW, this.imgH);
    gl.uniform2f(u.uFix, p.fix?.[0] ?? this.imgW / 2, p.fix?.[1] ?? this.imgH / 2);
    gl.uniform1f(u.uPpd, p.ppd ?? 40);
    gl.uniform1f(u.uK, p.k ?? 1);
    gl.uniform1fv(u.uSig, sig);
    gl.uniform1i(u.uLevels, this.sigmas.length);
    gl.uniform1i(u.uMode, p.mode ?? 0);
    gl.uniform1f(u.uSigma, p.sigma ?? 0);
    gl.uniform1f(u.uColorFade, p.colorFade ?? 0);
    gl.uniform1f(u.uSplit, p.split ?? 0.5);
    gl.uniform1f(u.uLayerB, p.layerB ?? 0);
    gl.uniform1f(u.uSig0Deg, SIG0_DEG);
    gl.uniform1f(u.uE2, GP.e2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
