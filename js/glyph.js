/* ============================================================
   息壤 · glyph.js
   Particle calligraphy. A line of text is sampled from a canvas,
   then several thousand points gather into it, breathe, and fall
   back into the soil. Used for the overture and the final seal.
   ============================================================ */
(function () {
  'use strict';

  const XR = (window.XR = window.XR || {});
  const TAU = Math.PI * 2;

  const TINTS = [
    { r: 247, g: 243, b: 232, weight: 42 },  // bone
    { r: 204, g: 255, b: 238, weight: 36 },  // jade white
    { r: 143, g: 245, b: 202, weight: 16 },  // jade
    { r: 216, g: 181, b: 125, weight: 6 }    // gold
  ];

  const FONT_STACK = '"Noto Serif SC Medium","Noto Serif SC","Songti SC","STSong","SimSun",serif';

  function graphemes(str) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      try {
        const seg = new Intl.Segmenter('zh', { granularity: 'grapheme' });
        return Array.from(seg.segment(str), function (s) { return s.segment; });
      } catch (e) { /* fall through */ }
    }
    return Array.from(str);
  }

  function makeSprite(tint) {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,252,1)');
    g.addColorStop(0.12, 'rgba(' + tint.r + ',' + tint.g + ',' + tint.b + ',.98)');
    g.addColorStop(0.3, 'rgba(' + tint.r + ',' + tint.g + ',' + tint.b + ',.42)');
    g.addColorStop(0.62, 'rgba(' + tint.r + ',' + tint.g + ',' + tint.b + ',.09)');
    g.addColorStop(1, 'rgba(' + tint.r + ',' + tint.g + ',' + tint.b + ',0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return c;
  }

  class GlyphField {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = 1;
      this.w = 0;
      this.h = 0;
      this.particles = [];
      this.active = false;
      this.mode = 'idle';
      this.age = 0;
      this.time = 0;
      this.text = '';
      this.opts = null;
      this.onDone = null;
      this.sprites = TINTS.map(makeSprite);
      this.resize();
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      this.dpr = dpr;
      this.w = window.innerWidth;
      this.h = window.innerHeight;
      this.canvas.width = Math.max(2, Math.round(this.w * dpr));
      this.canvas.height = Math.max(2, Math.round(this.h * dpr));
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (this.active && this.mode !== 'disperse' && this.text) {
        // Rebuild in place after a viewport change; positions settle again quickly.
        this.show(this.text, Object.assign({}, this.opts, { silent: true }));
      }
    }

    isActive() { return this.active; }

    show(text, opts) {
      opts = opts || {};
      this.text = text;
      this.opts = opts;
      this.active = true;
      this.mode = 'forming';
      this.age = 0;
      this._doneAt = 0;
      this.canvas.classList.add('is-on');

      const glyphs = graphemes(text).slice(0, opts.maxGlyphs || 2);
      if (!glyphs.length) { this.hide(); return; }

      const W = this.w, H = this.h;
      const cx = opts.x == null ? W * 0.5 : opts.x;
      const cy = opts.y == null ? H * 0.46 : opts.y;
      const maxW = opts.maxWidth || W * 0.78;
      const maxH = opts.maxHeight || H * 0.56;
      let fontPx = opts.fontPx || Math.min(maxW * 0.46, maxH);
      if (glyphs.length > 1) fontPx = Math.min(fontPx, maxW * 0.43);
      fontPx = Math.max(72, fontPx);
      let font = '500 ' + fontPx + 'px ' + FONT_STACK;

      // Sampling surface (CSS pixel space, 1:1).
      const off = document.createElement('canvas');
      off.width = Math.max(2, Math.round(W));
      off.height = Math.max(2, Math.round(H));
      const octx = off.getContext('2d', { willReadFrequently: true });
      octx.clearRect(0, 0, off.width, off.height);
      octx.font = font;
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';
      octx.fillStyle = '#fff';
      const gap = fontPx * 0.055;
      // Measure and fit.
      const advances = glyphs.map(function (g) { return octx.measureText(g).width; });
      let total = advances.reduce(function (a, b) { return a + b; }, 0) + gap * (glyphs.length - 1);
      if (total > maxW) {
        fontPx = fontPx * (maxW / total);
        font = '500 ' + fontPx + 'px ' + FONT_STACK;
        octx.font = font;
        const adv2 = glyphs.map(function (g) { return octx.measureText(g).width; });
        advances.length = 0;
        advances.push.apply(advances, adv2);
        total = advances.reduce(function (a, b) { return a + b; }, 0) + fontPx * 0.055 * (glyphs.length - 1);
      }
      const drawAt = [];
      let cursor = cx - total / 2;
      for (let i = 0; i < glyphs.length; i++) {
        const gx = cursor + advances[i] / 2;
        octx.fillText(glyphs[i], gx, cy);
        drawAt.push({ text: glyphs[i], x: gx, y: cy });
        cursor += advances[i] + fontPx * 0.055;
      }

      const data = octx.getImageData(0, 0, off.width, off.height).data;
      const step = Math.max(2, Math.round(fontPx / 138));
      const raw = [];
      const limit = Math.min(off.width, W);
      for (let y = 0; y < Math.min(off.height, H); y += step) {
        const row = y * off.width;
        for (let x = 0; x < limit; x += step) {
          if (data[(row + x) * 4 + 3] > 46) {
            raw.push(x + (Math.random() - 0.5) * 1.6, y + (Math.random() - 0.5) * 1.6);
          }
        }
      }

      const mobile = W < 700;
      const maxCount = opts.maxCount || (mobile ? 2000 : 3800);
      const alphaScale = opts.alphaScale == null ? 1 : opts.alphaScale;
      const stride = Math.max(1, Math.ceil((raw.length / 2) / maxCount));
      const chosen = [];
      for (let i = 0; i < raw.length / 2; i += stride) {
        chosen.push(raw[i * 2], raw[i * 2 + 1]);
      }
      // A pinch of drifting motes around the calligraphy.
      const extra = Math.floor(chosen.length / 2 * 0.06);
      for (let i = 0; i < extra; i++) {
        const idx = Math.floor(Math.random() * (chosen.length / 2));
        chosen.push(chosen[idx * 2] + (Math.random() - 0.5) * 34, chosen[idx * 2 + 1] + (Math.random() - 0.5) * 34);
      }

      const particles = [];
      const count = chosen.length / 2;
      const total2 = count;
      for (let i = 0; i < total2; i++) {
        const tx = chosen[i * 2];
        const ty = chosen[i * 2 + 1];
        let sx, sy, vx, vy;
        if (opts.from === 'soil') {
          const a = Math.random() * TAU;
          const r = Math.random() * Math.min(W, H) * 0.12;
          sx = cx + Math.cos(a) * r;
          sy = H * 0.9 + Math.random() * 40;
          vx = (Math.random() - 0.5) * 70;
          vy = -60 - Math.random() * 180;
        } else if (opts.from === 'scatter') {
          sx = Math.random() * W;
          sy = Math.random() * H;
          vx = (Math.random() - 0.5) * 80;
          vy = (Math.random() - 0.5) * 80;
        } else {
          const a = Math.random() * TAU;
          const r = Math.random() * Math.min(W, H) * (0.16 + Math.random() * 0.24);
          sx = cx + Math.cos(a) * r;
          sy = cy + Math.sin(a) * r * 0.7;
          vx = Math.cos(a) * (70 + Math.random() * 230);
          vy = Math.sin(a) * (70 + Math.random() * 230);
        }
        const tintIndex = pickTintIndex();
        const sparkle = Math.random() < 0.075;
        particles.push({
          x: sx, y: sy, px: sx, py: sy,
          vx: vx, vy: vy,
          tx: tx, ty: ty,
          phase: Math.random() * TAU,
          speed: 0.6 + Math.random() * 1.2,
          size: sparkle ? 2.0 + Math.random() * 2.3 : 0.7 + Math.random() * 1.15,
          alpha: 0,
          maxAlpha: (sparkle ? 0.2 + Math.random() * 0.2 : 0.38 + Math.random() * 0.4) * alphaScale,
          tint: tintIndex,
          delay: (ty - (cy - maxH * 0.5)) / maxH * 0.32 + Math.random() * 0.16,
          sparkle: sparkle
        });
      }

      this.particles = particles;
      this.fontPx = fontPx;
      this.center = { x: cx, y: cy };
      this.targetBox = { w: total, h: fontPx };
      this._startedAt = this.time;
      this.glyphs = glyphs;
      this.startedAt = performance.now() / 1000;
      this.layout = { drawAt: drawAt, font: font, fontPx: fontPx, cx: cx, cy: cy, total: total };
    }

    disperse(opts) {
      if (!this.active || this.mode === 'disperse') return;
      opts = opts || {};
      this.mode = 'disperse';
      this.disperseAge = 0;
      this.disperseDir = opts.dir || 'fall';
      this.disperseTarget = { x: opts.x == null ? this.center.x : opts.x, y: opts.y == null ? this.h * 0.92 : opts.y };
      const strength = opts.strength == null ? 1 : opts.strength;
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        p.delay = Math.random() * 0.34;
        p.alpha = p.alpha || p.maxAlpha;
        const a = Math.random() * TAU;
        const r = 25 + Math.random() * 150;
        if (this.disperseDir === 'rise') {
          p.vx += Math.cos(a) * r * strength * 0.5;
          p.vy += Math.sin(a) * r * strength * 0.5 - 60 * strength;
        } else {
          p.vx += Math.cos(a) * r * strength;
          p.vy += Math.sin(a) * r * strength - 30 * strength;
        }
      }
    }

    hide() {
      this.active = false;
      this.mode = 'idle';
      this.particles = [];
      this.ctx.clearRect(0, 0, this.w, this.h);
      this.canvas.classList.remove('is-on');
    }

    update(dt, state) {
      this.time += dt;
      if (!this.active) return;
      this.age += dt;
      const W = this.w, H = this.h, ctx = this.ctx;
      const time = this.time;
      const cx = this.center.x, cy = this.center.y;

      // mode timings
      if (this.mode === 'forming' && this.age > 0.95) {
        // remain forming; the springs do the work
      }

      const isDisperse = this.mode === 'disperse';
      if (isDisperse) this.disperseAge += dt;

      // physics
      const damp = isDisperse ? 1.25 : 6.4;
      const drag = Math.exp(-damp * dt);
      const spring = isDisperse ? 0.6 : 30;
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        if (this.age < p.delay) continue;
        p.alpha += ((isDisperse ? 0 : p.maxAlpha) - p.alpha) * Math.min(1, dt * 4.5);

        if (isDisperse) {
          const fall = this.disperseDir !== 'rise';
          if (fall) {
            p.vx += (this.disperseTarget.x - p.x) * 0.22 * dt + Math.sin(time * 0.9 + p.phase) * 5 * dt;
            p.vy += (fall ? 260 : -100) * dt;
          } else {
            p.vx += Math.cos(time * 0.4 + p.phase) * 14 * dt;
            p.vy -= 55 * dt;
          }
          p.vx *= drag;
          p.vy *= drag;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          const fadeStart = 0.25 + p.delay;
          if (this.disperseAge > fadeStart) {
            const k = Math.max(0, 1 - (this.disperseAge - fadeStart) / 1.35);
            p.alpha = p.maxAlpha * k * k;
          }
          continue;
        }

        const nx = Math.sin(p.y * 0.012 + time * 0.55 + p.phase) * 9 +
                   Math.sin(p.x * 0.007 - time * 0.4 + p.phase * 1.7) * 5;
        const ny = Math.cos(p.x * 0.011 + time * 0.48 + p.phase) * 9 +
                   Math.cos(p.y * 0.006 - time * 0.33 + p.phase * 1.3) * 5;
        const wobble = this.age < 1 ? 1 : 0.22;
        p.vx += ((p.tx - p.x) * spring + nx * wobble) * dt;
        p.vy += ((p.ty - p.y) * spring + ny * wobble) * dt;
        p.vx *= drag;
        p.vy *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }

      // render
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';

      // A whisper of ink beneath the particles, so the glyph reads even
      // when a turn of the spring scatters a few hundred points.
      const lay = this.layout;
      if (lay && this.mode !== 'disperse' && this.age > 0.7) {
        const ua = Math.min(1, Math.max(0, (this.age - 0.7) / 1.15)) * 0.085;
        if (ua > 0.002) {
          ctx.save();
          ctx.font = lay.font;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(170,244,214,' + ua.toFixed(4) + ')';
          ctx.shadowColor = 'rgba(114,240,192,.55)';
          ctx.shadowBlur = Math.max(8, lay.fontPx * 0.055);
          for (let i = 0; i < lay.drawAt.length; i++) {
            ctx.fillText(lay.drawAt[i].text, lay.drawAt[i].x, lay.drawAt[i].y);
          }
          ctx.restore();
        }
      }

      // ambient aura behind the characters
      const auraR = Math.max(this.targetBox.w * 0.58, this.fontPx * 0.85);
      const aura = ctx.createRadialGradient(cx, cy, 0, cx, cy, auraR);
      const auraA = 0.055 + 0.022 * Math.sin(time * 0.7);
      aura.addColorStop(0, 'rgba(118,238,191,' + auraA + ')');
      aura.addColorStop(0.55, 'rgba(70,170,132,' + auraA * 0.32 + ')');
      aura.addColorStop(1, 'rgba(40,100,80,0)');
      ctx.fillStyle = aura;
      ctx.fillRect(cx - auraR, cy - auraR, auraR * 2, auraR * 2);

      // expansion ring as the word arrives
      if (this.mode !== 'disperse') {
        const t = Math.min(1, Math.max(0, (this.age - 0.2) / 1.5));
        if (t > 0 && t < 1) {
          const r = this.fontPx * (0.22 + t * 1.05);
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(143,245,202,' + (0.16 * (1 - t)) + ')';
          ctx.lineWidth = 0.8;
          ctx.arc(cx, cy, r, 0, TAU);
          ctx.stroke();
        }
      }

      // breathe the whole mark
      const breath = 1 + Math.sin(time * 0.74) * (this.mode === 'disperse' ? 0 : 0.006);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.sin(time * 0.23) * 0.0025);
      ctx.scale(breath, breath);
      ctx.translate(-cx, -cy);

      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        if (p.alpha <= 0.005) continue;
        const tw = 0.76 + 0.24 * Math.sin(time * 1.7 + p.phase * 5.0);
        const a = p.alpha * tw;
        if (a <= 0.005) continue;
        const sprite = this.sprites[p.tint];
        const s = p.size * (p.sparkle ? 8.5 : 5.2);
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(sprite, p.x - s / 2, p.y - s / 2, s, s);
        if (p.size > 1.25 && !p.sparkle) {
          ctx.globalAlpha = Math.min(1, a * 0.9);
          ctx.fillStyle = 'rgba(235,255,246,.85)';
          ctx.fillRect(p.x - 0.55, p.y - 0.55, 1.1, 1.1);
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      if (isDisperse && this.disperseAge > 1.8) {
        const cb = this.onDone;
        this.hide();
        if (typeof cb === 'function') cb();
      }
    }
  }

  function pickTintIndex() {
    let roll = Math.random() * 100;
    for (let i = 0; i < TINTS.length; i++) {
      roll -= TINTS[i].weight;
      if (roll <= 0) return i;
    }
    return 0;
  }

  XR.GlyphField = GlyphField;
})();
