/* ============================================================
   息壤 · background.js
   A slow, breathing bed of soil. Pure WebGL fragment shader,
   no textures, no libraries. Rendered below the living organism.
   ============================================================ */
(function () {
  'use strict';

  const XR = (window.XR = window.XR || {});

  const VERT = `
    attribute vec2 aPos;
    void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
  `;

  const FRAG = `
    precision highp float;

    uniform vec2  uRes;
    uniform vec2  uRoot;
    uniform vec2  uPointer;
    uniform vec3  uRipples[2];
    uniform float uTime;
    uniform float uMood;
    uniform float uHold;
    uniform float uScroll;
    uniform float uWake;

    float hash(vec2 p){
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float noise(vec2 p){
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    float fbm(vec2 p){
      float v = 0.0;
      float a = 0.5;
      mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
      for(int i = 0; i < 4; i++){
        v += a * noise(p);
        p = rot * p * 2.03 + vec2(11.7, 7.3);
        a *= 0.5;
      }
      return v;
    }

    void main(){
      vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
      float t = uTime * 0.05;
      vec2 drift = vec2(t * 0.42, -t * 0.27);
      vec2 q = p + vec2(0.0, -uScroll * 0.11);

      float warp1 = fbm(q * 1.35 + drift);
      float warp2 = fbm(q * 1.8 - drift * 1.35 + vec2(3.2, 1.7));
      float cloud = fbm(q * 2.3 + warp1 * 1.05 + vec2(warp2 * 0.35));
      float fine  = fbm(q * 5.4 + warp2 * 1.5 + vec2(-t * 0.5, t * 0.24));

      vec3 col = vec3(0.009, 0.014, 0.011);
      col = mix(col, vec3(0.024, 0.061, 0.044), smoothstep(0.18, 0.92, cloud) * 0.82);
      col = mix(col, vec3(0.050, 0.038, 0.021), smoothstep(0.56, 0.98, fine) * 0.34);

      /* faint mineral strata */
      float strata = sin(q.y * 15.0 + cloud * 3.4 + t * 1.5) * 0.5 + 0.5;
      col += vec3(0.010, 0.013, 0.009) * strata * 0.55;

      /* luminous hyphae in the dark */
      float ridgeRaw = fbm(q * 2.7 + warp1 * 1.65 + drift * 2.2);
      float ridge = pow(clamp(1.0 - abs(ridgeRaw * 2.0 - 1.0), 0.0, 1.0), 16.0);
      col += vec3(0.10, 0.62, 0.44) * ridge * (0.16 + 0.30 * uMood + 0.10 * uHold);

      float glint = pow(clamp(1.0 - abs(fine * 2.0 - 1.0), 0.0, 1.0), 30.0);
      col += vec3(0.45, 0.85, 0.65) * glint * (0.03 + 0.07 * uMood);

      /* the living root casts light upward */
      vec2 rootDelta = p - uRoot;
      float rootDist = length(rootDelta * vec2(1.0, 1.12));
      float rootGlow = exp(-rootDist * rootDist * 5.5);
      col += vec3(0.09, 0.42, 0.28) * rootGlow * (0.10 + 0.12 * uMood + 0.07 * uHold);

      /* the visitor is a small light source too */
      vec2 pointerDelta = p - uPointer;
      float pointerDist = length(pointerDelta);
      col += vec3(0.13, 0.45, 0.31) * exp(-pointerDist * pointerDist * 20.0) * (0.035 + 0.055 * uMood);

      /* two expanding waves */
      for(int i = 0; i < 2; i++){
        vec3 r = uRipples[i];
        if(r.z > 0.0 && r.z < 3.6){
          float d = length(p - r.xy);
          float radius = r.z * 0.20;
          float wave = exp(-pow((d - radius) * 26.0, 2.0));
          float fade = smoothstep(3.6, 0.25, r.z);
          col += vec3(0.30, 0.92, 0.64) * wave * fade * 0.12;
          col += vec3(0.08, 0.34, 0.24) * exp(-d * 3.0) * fade * 0.035;
        }
      }

      /* breath */
      float breath = 0.5 + 0.5 * sin(uTime * 0.60) * (0.35 + 0.65 * uMood);
      col *= 0.80 + 0.20 * breath;

      /* vignette + top & bottom scrims */
      float vig = smoothstep(1.38, 0.30, length(p * vec2(0.84, 1.0)));
      col *= mix(0.42, 1.0, vig);
      col *= 1.0 - 0.24 * smoothstep(0.12, 0.88, p.y);
      col *= 1.0 - 0.30 * smoothstep(0.35, 1.05, -p.y);

      /* a small warm memory of the visitor waking it */
      col += vec3(0.28, 0.76, 0.52) * uWake * 0.030;

      /* film grain */
      float g = hash(gl_FragCoord.xy * 1.73 + fract(uTime) * 113.7);
      col += (g - 0.5) * 0.026;

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `;

  class SoilBackground {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = null;
      this.ok = false;
      this.ripples = [];
      this.lastTime = 0;
      this.wake = 0;
      this.pointer = { x: 0.5, y: 0.55 };
      this.rootCSS = { x: 0.68, y: 0.94 };
      this.scaleFactor = 0.62;
      this._init();
    }

    _init() {
      const canvas = this.canvas;
      let gl;
      try {
        gl = canvas.getContext('webgl', {
          alpha: false,
          antialias: false,
          depth: false,
          stencil: false,
          preserveDrawingBuffer: false,
          powerPreference: 'high-performance'
        }) || canvas.getContext('experimental-webgl');
      } catch (e) { gl = null; }
      if (!gl) return;
      this.gl = gl;
      try {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        this.renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      } catch (err) { this.renderer = ''; }

      const compile = (type, source) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, source);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          console.warn('[息壤] shader compile failed:', gl.getShaderInfoLog(sh));
          gl.deleteShader(sh);
          return null;
        }
        return sh;
      };
      const vs = compile(gl.VERTEX_SHADER, VERT);
      const fs = compile(gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return;
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn('[息壤] program link failed:', gl.getProgramInfoLog(prog));
        return;
      }
      this.prog = prog;
      gl.useProgram(prog);

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 3, -1, -1, 3
      ]), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      this.u = {
        uRes: gl.getUniformLocation(prog, 'uRes'),
        uRoot: gl.getUniformLocation(prog, 'uRoot'),
        uPointer: gl.getUniformLocation(prog, 'uPointer'),
        uRipples: gl.getUniformLocation(prog, 'uRipples'),
        uTime: gl.getUniformLocation(prog, 'uTime'),
        uMood: gl.getUniformLocation(prog, 'uMood'),
        uHold: gl.getUniformLocation(prog, 'uHold'),
        uScroll: gl.getUniformLocation(prog, 'uScroll'),
        uWake: gl.getUniformLocation(prog, 'uWake')
      };
      this.rippleData = new Float32Array(6);
      this.ok = true;
      this.resize();
    }

    resize() {
      if (!this.ok) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const mobile = w < 700;
      this.scaleFactor = mobile ? 0.68 : 0.58;
      const bw = Math.max(2, Math.round(w * this.scaleFactor));
      const bh = Math.max(2, Math.round(h * this.scaleFactor));
      if (this.canvas.width !== bw || this.canvas.height !== bh) {
        this.canvas.width = bw;
        this.canvas.height = bh;
      }
      this.gl.viewport(0, 0, bw, bh);
    }

    setQuality(level) {
      if (!this.ok) return;
      const w = window.innerWidth;
      this.scaleFactor = level === 'low' ? 0.45 : (w < 700 ? 0.72 : 0.62);
      this.resize();
    }

    setPointer(x, y) {
      this.pointer.x = x;
      this.pointer.y = y;
    }

    setRoot(xRatio, yRatio) {
      this.rootCSS.x = xRatio;
      this.rootCSS.y = yRatio;
    }

    emitRipple(x, y) {
      this.ripples.push({ x, y, start: this._now() });
      if (this.ripples.length > 2) this.ripples.shift();
    }

    flashWake(strength) {
      this.wake = Math.min(1, (this.wake || 0) + (strength || 0.7));
    }

    _now() {
      return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    }

    _toP(x, y) {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      return [(x - w / 2) / h, (h / 2 - y) / h];
    }

    render(state) {
      if (!this.ok) return;
      const gl = this.gl;
      const now = typeof state.time === 'number' ? state.time : this._now();
      const dt = this.lastTime ? Math.min(0.08, Math.max(0, now - this.lastTime)) : 0;
      this.lastTime = now;
      this.wake = Math.max(0, this.wake - dt * 0.55);

      while (this.ripples.length && now - this.ripples[0].start > 4) this.ripples.shift();
      this.rippleData.fill(-1);
      this.rippleData[2] = -1;
      this.rippleData[5] = -1;
      for (let i = 0; i < this.ripples.length; i++) {
        const r = this.ripples[i];
        const pp = this._toP(r.x, r.y);
        this.rippleData[i * 3] = pp[0];
        this.rippleData[i * 3 + 1] = pp[1];
        this.rippleData[i * 3 + 2] = Math.max(0.001, now - r.start);
      }

      const rootP = this._toP(
        (this.rootCSS.x) * window.innerWidth,
        (this.rootCSS.y) * window.innerHeight
      );
      const pointerP = this._toP(
        (state.pointer ? state.pointer.x : window.innerWidth * 0.5),
        (state.pointer ? state.pointer.y : window.innerHeight * 0.55)
      );

      gl.uniform2f(this.u.uRes, this.canvas.width, this.canvas.height);
      gl.uniform2f(this.u.uRoot, rootP[0], rootP[1]);
      gl.uniform2f(this.u.uPointer, pointerP[0], pointerP[1]);
      gl.uniform3fv(this.u.uRipples, this.rippleData);
      gl.uniform1f(this.u.uTime, now);
      gl.uniform1f(this.u.uMood, state.mood == null ? 0.4 : state.mood);
      gl.uniform1f(this.u.uHold, state.hold == null ? 0 : state.hold);
      gl.uniform1f(this.u.uScroll, state.scroll == null ? 0 : state.scroll);
      gl.uniform1f(this.u.uWake, this.wake);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  XR.SoilBackground = SoilBackground;
})();
