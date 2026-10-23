/* ============================================================
   息壤 · life.js
   The organism. A three-dimensional mycelial field drawn in 2D
   canvas with additive light, growing toward attention, leaning
   toward the cursor, breathing, sleeping, and remembering seeds.
   ============================================================ */
(function () {
  'use strict';

  const XR = (window.XR = window.XR || {});
  const TAU = Math.PI * 2;
  const clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  const lerp = function (a, b, t) { return a + (b - a) * t; };

  function rand(a, b) { return a + Math.random() * (b - a); }
  function rgba(r, g, b, a) { return 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + a + ')'; }

  function makeGlow(r, g, b, hard) {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, 'rgba(255,255,250,' + (hard ? 0.95 : 0.7) + ')');
    grd.addColorStop(0.08, rgba(r, g, b, 0.9));
    grd.addColorStop(0.28, rgba(r, g, b, 0.24));
    grd.addColorStop(0.6, rgba(r, g, b, 0.05));
    grd.addColorStop(1, rgba(r, g, b, 0));
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);
    return c;
  }

  class Life {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = 1;
      this.W = 1;
      this.H = 1;
      this.time = 0;
      this.started = false;
      this.rootXRatio = 0.685;
      this.rootTarget = 0.685;
      this.zoom = 1;
      this.zoomTarget = 1;
      this.tilt = 0.02;
      this.tiltTarget = 0.02;
      this.mood = 0.35;
      this.sleep = 0;
      this.pointer = { x: 0, y: 0, vx: 0, vy: 0, active: false, down: false };
      this.branches = [];
      this.spores = [];
      this.dust = [];
      this.pollens = [];
      this.waves = [];
      this.blooms = [];
      this.threads = [];
      this.seeds = [];
      this.returnedBranches = 0;
      this.trailClock = 0;
      this.holdWaveClock = 0;
      this.flash = 0;
      this.metric = 0;
      this.metricClock = 0;
      this.growthPulse = 0;
      this.lastPointer = { x: 0, y: 0 };
      this.sprites = {
        jade: makeGlow(116, 240, 192),
        jadeSoft: makeGlow(80, 200, 160, false),
        gold: makeGlow(236, 186, 108),
        bone: makeGlow(245, 238, 218),
        blue: makeGlow(146, 190, 196)
      };
      this.resize();
      this._makeSpores();
      this._makeDust();
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
      this.dpr = dpr;
      this.W = window.innerWidth;
      this.H = window.innerHeight;
      this.canvas.width = Math.max(2, Math.round(this.W * dpr));
      this.canvas.height = Math.max(2, Math.round(this.H * dpr));
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const mobile = this.W < 700;
      this.rootYRatio = mobile ? 0.95 : 0.92;
      this.baseUnit = mobile
        ? Math.min(this.H * 0.55, this.W * 1.16)
        : Math.min(this.H * 0.64, this.W * 0.8);
      this.maxBranches = mobile ? 50 : (this.W < 1200 ? 70 : 84);
    }

    _makeSpores() {
      const n = this.W < 700 ? 130 : 235;
      this.spores = [];
      for (let i = 0; i < n; i++) {
        this.spores.push({
          x: rand(-1.25, 1.25),
          y: rand(-0.08, 1.22),
          z: rand(-0.5, 0.5),
          vx: rand(-0.008, 0.008),
          vy: rand(0.005, 0.026),
          phase: rand(0, TAU),
          size: rand(0.5, 2.2),
          kind: Math.random() < 0.12 ? 'gold' : (Math.random() < 0.2 ? 'bone' : 'jade'),
          alpha: rand(0.18, 0.72),
          bokeh: Math.random() < 0.06
        });
      }
    }

    _makeDust() {
      const n = this.W < 700 ? 26 : 54;
      this.dust = [];
      for (let i = 0; i < n; i++) {
        this.dust.push({
          x: Math.random(),
          y: Math.random(),
          vx: rand(-0.006, 0.006),
          vy: rand(-0.009, -0.002),
          phase: rand(0, TAU),
          size: rand(0.5, 2.0),
          alpha: rand(0.05, 0.34)
        });
      }
    }

    startGrowth() {
      if (this.started) return;
      this.started = true;
      const count = 6;
      for (let i = 0; i < count; i++) {
        const angle = Math.PI / 2 + rand(-0.98, 0.98);
        const b = this._newBranch(rand(-0.04, 0.04), rand(-0.025, 0.025), 0, angle, 0, false);
        b.progress = rand(0, 0.06);
        b.speed = rand(0.15, 0.26);
        this.branches.push(b);
      }
    }

    setReturnBonus(count) {
      this.returnedBranches = count;
      if (!count) return;
      if (!this.started) this.startGrowth();
      const n = Math.min(count, this.maxBranches - this.branches.length);
      for (let i = 0; i < n; i++) {
        let startX = 0, startY = 0, startZ = 0, baseAngle = Math.PI / 2 + rand(-1.15, 1.15);
        if (this.branches.length && Math.random() < 0.62) {
          const parent = this.branches[(Math.random() * this.branches.length) | 0];
          const idx = Math.max(1, Math.min(parent.pts.length - 1, (parent.pts.length * rand(0.25, 0.9)) | 0));
          const p = parent.pts[idx];
          const q = parent.pts[idx - 1];
          startX = p.x; startY = p.y; startZ = p.z;
          baseAngle = Math.atan2(p.y - q.y, p.x - q.x) + rand(-0.9, 0.9);
        }
        const b = this._newBranch(startX, startY, startZ, baseAngle, parentDepth(), false);
        b.progress = rand(0.35, 0.98);
        b.speed = rand(0.08, 0.16);
        this.branches.push(b);
      }
      function parentDepth() { return Math.random() < 0.55 ? 1 : 2; }
    }

    _newBranch(x, y, z, angle, depth, gold) {
      const n = depth > 2 ? ((rand(9, 15)) | 0) : (depth === 0 ? ((rand(20, 30)) | 0) : ((rand(14, 23)) | 0));
      const step = depth === 0 ? rand(0.03, 0.046) : rand(0.02, 0.038);
      const pts = [{ x: x, y: y, z: z }];
      let px = x, py = y, pz = z;
      let a = angle;
      const curl = rand(-0.014, 0.014);
      const phase = rand(0, TAU);
      const maxY = Math.min(1.16, Math.max(y + 0.16, rand(0.48, 1.04) + (depth === 0 ? 0.08 : 0)));
      const maxR = rand(0.78, 1.18);
      for (let i = 1; i < n; i++) {
        a += rand(-0.2, 0.2) + curl + Math.sin(i * 0.52 + phase) * 0.075 + (Math.PI / 2 - a) * 0.026;
        const stride = step * rand(0.8, 1.2);
        px += Math.cos(a) * stride;
        py += Math.sin(a) * stride;
        pz += rand(-0.009, 0.009);
        pts.push({ x: px, y: py, z: pz });
        // Stop at a soft canopy rather than curling back into loops.
        if (py > maxY || Math.abs(px) > 1.22 || Math.hypot(px, py) > maxR) break;
      }
      return {
        pts: pts,
        progress: 0,
        speed: rand(0.14, 0.27),
        depth: depth,
        gold: gold || (depth > 0 && Math.random() < 0.018),
        width: Math.max(0.38, 1.95 * Math.pow(0.73, depth)),
        branchAt: rand(0.34, 0.58),
        midBranch: false,
        endBranch: false,
        phase: phase,
        flicker: rand(0.4, 1.1),
        life: 1
      };
    }

    _spawnChild(parent, atProgress, angleOffset) {
      if (this.branches.length >= this.maxBranches) return;
      if (parent.depth >= 4) return;
      const pts = parent.pts;
      const idx = clamp(Math.round((pts.length - 1) * atProgress), 1, pts.length - 1);
      const p = pts[idx];
      const q = pts[idx - 1];
      let angle = Math.atan2(p.y - q.y, p.x - q.x) + angleOffset;
      // sometimes the new shoot turns toward one of the visitor's seeds
      if (this.seeds.length && Math.random() < 0.45) {
        const s = this.seeds[(Math.random() * this.seeds.length) | 0];
        const sAngle = Math.atan2(s.y - p.y, s.x - p.x);
        angle = lerp(angle, sAngle, rand(0.25, 0.65));
      }
      const b = this._newBranch(p.x, p.y, p.z, angle, parent.depth + 1, Math.random() < 0.025);
      b.progress = 0;
      b.speed = parent.speed * rand(0.7, 1.15);
      this.branches.push(b);
    }

    _grow(dt, state) {
      if (!this.started) return;
      const energy = 0.5 + (state.mood || 0.35) * 0.8 + (state.hold || 0) * 1.6;
      const sleepFactor = 1 - this.sleep * 0.62;
      const rate = energy * sleepFactor;
      let added = 0;
      const before = this.branches.length;
      for (let i = 0; i < this.branches.length; i++) {
        const b = this.branches[i];
        if (b.progress < 1) {
          b.progress = Math.min(1, b.progress + b.speed * rate * dt);
        }
        if (!b.midBranch && b.progress > b.branchAt) {
          b.midBranch = true;
          if (b.depth < 4 && Math.random() < 0.94) {
            this._spawnChild(b, b.branchAt, (Math.random() < 0.5 ? -1 : 1) * rand(0.3, 0.86));
          }
        }
        if (!b.endBranch && b.progress >= 0.985) {
          b.endBranch = true;
          if (b.depth < 4 && Math.random() < 0.78) {
            this._spawnChild(b, 1, (Math.random() < 0.5 ? -1 : 1) * rand(0.16, 0.56));
          }
        }
      }
      added = this.branches.length - before;
      if (added > 0) this.growthPulse = Math.min(1, this.growthPulse + 0.28);
    }

    _project(x, y, z, cam, sway, frac) {
      const ct = cam.cosT, st = cam.sinT;
      const rx = x * ct - z * st;
      const rz = x * st + z * ct;
      const persp = 1 / (1 + rz * 0.17);
      let sx = cam.cx + rx * cam.unit * persp;
      let sy = cam.cy - y * cam.unit * persp;
      if (sway) {
        sx += Math.sin(this.time * 0.52 + sway.phase + frac * 2.7) * (0.7 + frac * 4.8) * sway.amount;
        sy += Math.cos(this.time * 0.41 + sway.phase * 1.6 + frac * 2.1) * (0.4 + frac * 2.2) * sway.amount;
      }
      if (this.pointer.active) {
        const dx = this.pointer.x - sx;
        const dy = this.pointer.y - sy;
        const d2 = dx * dx + dy * dy;
        const fall = 1 / (1 + d2 / 72000);
        const amount = sway ? sway.amount : 0.45;
        const pull = fall * fall * (0.8 + (this.pointer.down ? 2.2 : 0)) * frac * frac * amount;
        sx += dx * 0.011 * pull;
        sy += dy * 0.011 * pull;
      }
      return { x: sx, y: sy, z: rz, persp: persp };
    }

    _pointAtProgress(b, progress) {
      const idx = clamp(Math.ceil((b.pts.length - 1) * progress), 1, b.pts.length - 1);
      return { idx: idx, p: b.pts[idx], q: b.pts[idx - 1] };
    }

    plantSeed(sx, sy) {
      const cam = this._cam();
      const wx = (sx - cam.cx) / cam.unit;
      const wy = (cam.cy - sy) / cam.unit;
      const seed = { x: clamp(wx, -1.4, 1.4), y: clamp(wy, -0.15, 1.3), z: 0, born: this.time };
      this.seeds.push(seed);
      if (this.seeds.length > 18) this.seeds.shift();
      this._bloom(sx, sy);
      this._wave(sx, sy, 'click');
      this._burst(sx, sy, 36);
      this._connect(sx, sy);
      return this.seeds.length;
    }

    _connect(sx, sy) {
      // A seed is not a separate thing: light immediately reaches out
      // and ties it into the nearest living tip.
      const cam = this._cam();
      let best = null;
      let bestDist = 680 * 680;
      for (let i = 0; i < this.branches.length; i++) {
        const b = this.branches[i];
        if (b.progress < 0.14) continue;
        const at = this._pointAtProgress(b, Math.min(1, b.progress));
        const p = this._project(at.p.x, at.p.y, at.p.z, cam, null, 0.8);
        const dx = p.x - sx;
        const dy = p.y - sy;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          best = { x: p.x, y: p.y };
        }
      }
      if (!best) return;
      this.threads.push({
        x1: sx, y1: sy, x2: best.x, y2: best.y,
        born: this.time,
        dur: rand(1.3, 1.9),
        bend: rand(-0.28, 0.28)
      });
    }

    _bloom(x, y) {
      this.blooms.push({
        x: x, y: y, born: this.time,
        dur: rand(1.8, 2.4),
        size: rand(44, 92),
        rot: rand(0, TAU),
        gold: Math.random() < 0.28
      });
    }

    _wave(x, y, kind) {
      const count = kind === 'wake' ? 2 : 2;
      for (let i = 0; i < count; i++) {
        this.waves.push({
          x: x, y: y,
          born: this.time + i * 0.13,
          dur: kind === 'wake' ? 2.6 : rand(1.2, 1.9),
          max: kind === 'wake' ? Math.max(this.W, this.H) * 0.5 : rand(110, 240),
          gold: Math.random() < 0.16,
          width: kind === 'wake' ? 1.1 : 0.7
        });
      }
    }

    _burst(x, y, n) {
      const count = Math.min(n, 70);
      for (let i = 0; i < count; i++) {
        const a = rand(0, TAU);
        const sp = rand(16, 110);
        this.pollens.push({
          x: x + Math.cos(a) * rand(0, 14),
          y: y + Math.sin(a) * rand(0, 14),
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - rand(0, 24),
          life: 0,
          dur: rand(0.9, 2.1),
          size: rand(0.6, 2.1),
          kind: Math.random() < 0.12 ? 'gold' : (Math.random() < 0.3 ? 'bone' : 'jade')
        });
      }
    }

    _cam() {
      const cx = this.rootXRatio * this.W;
      const cy = this.rootYRatio * this.H;
      const breath = 1 + Math.sin(this.time * 0.62) * 0.007 * (0.4 + this.mood);
      const unit = this.baseUnit * this.zoom * breath * (1 + (this.holdValue || 0) * 0.032);
      const tilt = this.tilt + Math.sin(this.time * 0.07) * 0.035;
      return { cx: cx, cy: cy, unit: unit, cosT: Math.cos(tilt), sinT: Math.sin(tilt) };
    }

    breathRelease(x, y) {
      const px = x == null ? this.pointer.x : x;
      const py = y == null ? this.pointer.y : y;
      this._wave(px, py, 'hold');
      this._burst(px, py, 18);
      if (this.pointer.down) this.pointer.down = false;
    }

    tipBloom(count) {
      const cam = this._cam();
      const tips = [];
      for (let i = 0; i < this.branches.length; i++) {
        const b = this.branches[i];
        if (b.progress < 0.42) continue;
        const at = this._pointAtProgress(b, Math.min(1, b.progress));
        const p = this._project(at.p.x, at.p.y, at.p.z, cam, null, 0.9);
        tips.push({ x: p.x, y: p.y });
      }
      if (!tips.length) return;
      for (let i = tips.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const tmp = tips[i]; tips[i] = tips[j]; tips[j] = tmp;
      }
      const n = Math.min(count || 4, tips.length);
      for (let i = 0; i < n; i++) this._bloom(tips[i].x, tips[i].y);
    }

    fullBloom() {
      this.tipBloom(14);
      this.growthPulse = 1;
      const cam = this._cam();
      this._wave(cam.cx, cam.cy - 80, 'wake');
      this._burst(this.pointer.x || cam.cx, this.pointer.y || cam.cy - 100, 26);
    }

    prefill(seconds, state) {
      // Advance a little life without animating, for reduced-motion visitors.
      this.mood = state.mood == null ? 0.6 : state.mood;
      this.pointer.active = false;
      this.rootXRatio = state.rootX == null ? this.rootXRatio : state.rootX;
      this.zoom = state.zoom == null ? 1 : state.zoom;
      this.tilt = state.tilt == null ? 0.02 : state.tilt;
      const steps = Math.min(360, Math.max(1, Math.round(seconds / 0.03)));
      for (let i = 0; i < steps; i++) {
        this.time += 0.03;
        this._grow(0.03, state);
        this._updateSpores(0.03, state);
        this._updateDust(0.03);
        this._updateMetric();
      }
      this.render(state);
    }

    pulse(kind) {
      const cam = this._cam();
      if (kind === 'wake') {
        this.flash = 1;
        this._wave(cam.cx, cam.cy - 60, 'wake');
        this._burst(this.pointer.x || cam.cx, this.pointer.y || cam.cy - 100, 30);
      } else if (kind === 'surge') {
        this._wave(cam.cx, cam.cy - 80, 'wake');
        this.growthPulse = 1;
        for (let i = 0; i < 3; i++) {
          const tip = this.branches[(Math.random() * this.branches.length) | 0];
          if (tip) {
            const at = this._pointAtProgress(tip, tip.progress);
            const p = this._project(at.p.x, at.p.y, at.p.z, cam, null, 0.8);
            this._burst(p.x, p.y, 9);
          }
        }
      }
    }

    step(dt, state) {
      dt = Math.min(0.05, Math.max(0.001, dt));
      this.time += dt;
      this.mood = state.mood == null ? 0.4 : state.mood;
      this.sleep = state.sleep || 0;
      this.holdValue = state.hold || 0;
      this.scroll = state.scroll || 0;
      this.pointer = state.pointer || this.pointer;
      this.rootTarget = state.rootX == null ? 0.685 : state.rootX;
      this.zoomTarget = state.zoom == null ? 1 : state.zoom;
      this.tiltTarget = state.tilt == null ? 0.02 : state.tilt;

      const ease = 1 - Math.exp(-dt * 1.6);
      this.rootXRatio = lerp(this.rootXRatio, this.rootTarget, ease);
      this.zoom = lerp(this.zoom, this.zoomTarget, ease);
      this.tilt = lerp(this.tilt, this.tiltTarget, ease);
      if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 0.7);
      this.growthPulse = Math.max(0, this.growthPulse - dt * 0.9);

      this._grow(dt, state);
      this._updateParticles(dt, state);
      this._updateSpores(dt, state);
      this._updateDust(dt);
      this._updateWaves();
      this._updateBlooms();
      for (let i = this.threads.length - 1; i >= 0; i--) {
        if (this.time > this.threads[i].born + this.threads[i].dur) this.threads.splice(i, 1);
      }
      this._emitTrail(dt, state);

      if (this.pointer.down && this.started) {
        this.holdWaveClock -= dt;
        if (this.holdWaveClock <= 0) {
          this.holdWaveClock = 1.15;
          this._wave(this.pointer.x, this.pointer.y, 'hold');
        }
      } else {
        this.holdWaveClock = 0;
      }

      this.metricClock -= dt;
      if (this.metricClock <= 0) {
        this.metricClock = 0.2;
        this._updateMetric();
      }

      this.render(state);
    }

    _updateMetric() {
      let pts = 0;
      for (let i = 0; i < this.branches.length; i++) {
        const b = this.branches[i];
        pts += Math.max(0, Math.ceil((b.pts.length - 1) * b.progress));
      }
      this.metric = Math.round(pts * 8.6 + this.seeds.length * 32);
    }

    getMetrics() {
      return {
        branches: this.branches.length,
        mycelium: this.metric,
        seeds: this.seeds.length
      };
    }

    _updateWaves() {
      for (let i = this.waves.length - 1; i >= 0; i--) {
        if (this.time > this.waves[i].born + this.waves[i].dur) this.waves.splice(i, 1);
      }
    }

    _updateBlooms() {
      for (let i = this.blooms.length - 1; i >= 0; i--) {
        if (this.time - this.blooms[i].born > this.blooms[i].dur) this.blooms.splice(i, 1);
      }
    }

    _updateParticles(dt) {
      for (let i = this.pollens.length - 1; i >= 0; i--) {
        const p = this.pollens[i];
        p.life += dt;
        if (p.life > p.dur) { this.pollens.splice(i, 1); continue; }
        p.vx += Math.sin(this.time * 0.7 + p.y * 0.01) * 7 * dt;
        p.vy += Math.cos(this.time * 0.45 + p.x * 0.01) * 5 * dt - 2 * dt;
        p.vx *= Math.exp(-dt * 1.4);
        p.vy *= Math.exp(-dt * 1.4);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      if (this.pollens.length > 240) this.pollens.splice(0, this.pollens.length - 240);
    }

    _updateSpores(dt, state) {
      const hold = state.hold || 0;
      const sleep = this.sleep;
      for (let i = 0; i < this.spores.length; i++) {
        const s = this.spores[i];
        const n = Math.sin(s.y * 6.2 + this.time * 0.24 + s.phase);
        s.x += (s.vx + n * 0.0035) * dt * (1 - sleep * 0.55);
        s.y += (s.vy + Math.cos(s.phase + this.time * 0.18) * 0.004) * dt * (1 - sleep * 0.62);
        if (this.pointer.active) {
          const dx = this.pointer.x / this.W - 0.5 - s.x * 0.2;
          const dy = 0.5 - this.pointer.y / this.H - s.y * 0.2;
          s.x += dx * 0.006 * dt * (0.5 + hold);
          s.y += dy * 0.004 * dt;
        }
        if (s.y > 1.3) { s.y = -0.05; s.x = rand(-1.25, 1.25); }
        if (s.y < -0.08) { s.y = 1.28; s.x = rand(-1.25, 1.25); }
        if (s.x > 1.35) s.x = -1.3;
        if (s.x < -1.35) s.x = 1.3;
      }
    }

    _updateDust(dt) {
      for (let i = 0; i < this.dust.length; i++) {
        const d = this.dust[i];
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.y < -0.05) { d.y = 1.05; d.x = Math.random(); }
        if (d.x < -0.05) d.x = 1.05;
        if (d.x > 1.05) d.x = -0.05;
      }
    }

    _emitTrail(dt, state) {
      if (!this.pointer.active || !state || !this.pointer) return;
      const speed = Math.hypot(this.pointer.vx || 0, this.pointer.vy || 0);
      const holding = this.pointer.down;
      this.trailClock -= dt;
      const interval = holding ? 0.018 : 0.035;
      if (this.trailClock > 0) return;
      if (speed < 22 && !holding) return;
      this.trailClock = interval;
      const n = holding ? 3 : (speed > 500 ? 3 : 1);
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU);
        const spread = holding ? rand(8, 34) : rand(2, 15);
        this.pollens.push({
          x: this.pointer.x + Math.cos(a) * spread,
          y: this.pointer.y + Math.sin(a) * spread,
          vx: -(this.pointer.vx || 0) * 0.035 + Math.cos(a) * rand(4, 22),
          vy: -(this.pointer.vy || 0) * 0.035 + Math.sin(a) * rand(4, 22) - 4,
          life: 0,
          dur: rand(0.65, 1.6),
          size: rand(0.45, 1.5),
          kind: Math.random() < 0.18 ? 'gold' : (Math.random() < 0.4 ? 'bone' : 'jade')
        });
      }
      if (this.pollens.length > 240) this.pollens.splice(0, this.pollens.length - 240);
    }

    /* ---------------- rendering ---------------- */

    render() {
      const ctx = this.ctx;
      const W = this.W, H = this.H;
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      const cam = this._cam();
      const mood = this.mood;
      const sleep = this.sleep;
      const awake = 1 - sleep * 0.52;

      this._drawRoot(cam);

      // a pollen cloud gathered around the organism
      const auraSize = (this.baseUnit || this.H * 0.6) * 1.7;
      ctx.globalAlpha = 0.035 + mood * 0.025;
      ctx.drawImage(this.sprites.jadeSoft, cam.cx - auraSize / 2, cam.cy - auraSize * 0.72, auraSize, auraSize);
      ctx.globalAlpha = 1;

      if (this.flash > 0.001) {
        const f = this.flash;
        ctx.globalAlpha = Math.pow(f, 1.6) * 0.6;
        const s = Math.min(W, H) * (1.1 + (1 - f) * 0.6);
        ctx.drawImage(this.sprites.jadeSoft, cam.cx - s / 2, cam.cy - H * 0.3, s, s);
        ctx.globalAlpha = 1;
      }

      this._drawWaves();
      this._drawBranches(cam, mood, sleep);
      this._drawThreads();
      this._drawSeeds(cam);
      this._drawBlooms();
      this._drawSpores(cam, mood, sleep);
      this._drawDust(cam);
      this._drawPollens();

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    _drawRoot(cam) {
      const ctx = this.ctx;
      const mood = this.mood;
      const s = Math.min(this.W, this.H) * (0.9 + mood * 0.22);
      ctx.globalAlpha = 0.25 + mood * 0.16;
      ctx.drawImage(this.sprites.jadeSoft, cam.cx - s * 0.5, cam.cy - s * 0.42, s, s * 0.84);
      ctx.globalAlpha = 0.26 + mood * 0.2;
      const s2 = s * 0.33;
      ctx.drawImage(this.sprites.jade, cam.cx - s2 / 2, cam.cy - s2 * 0.36, s2, s2);
      // a low horizon of soil light
      const g = ctx.createLinearGradient(0, cam.cy - 26, 0, cam.cy + 40);
      g.addColorStop(0, 'rgba(90,210,160,0)');
      g.addColorStop(0.7, 'rgba(90,210,160,' + (0.022 + mood * 0.02) + ')');
      g.addColorStop(1, 'rgba(90,210,160,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cam.cx - this.W * 0.28, cam.cy - 26, this.W * 0.56, 66);

      // a bright heart at the root: where attention enters the soil
      const beat = 0.5 + 0.5 * Math.sin(this.time * 0.72);
      const heart = 92 + beat * 58;
      ctx.globalAlpha = 0.42 + mood * 0.2;
      ctx.drawImage(this.sprites.jadeSoft, cam.cx - heart * 0.7, cam.cy - heart * 0.9, heart * 1.4, heart * 1.1);
      ctx.globalAlpha = 0.66 + mood * 0.2;
      ctx.drawImage(this.sprites.jade, cam.cx - heart / 2, cam.cy - heart * 0.56, heart, heart);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = 'rgba(236,255,246,.92)';
      ctx.beginPath();
      ctx.arc(cam.cx, cam.cy - 5, 2.4 + beat * 1.6, 0, TAU);
      ctx.fill();
      const pulseT = (this.time % 5.2) / 5.2;
      if (pulseT < 0.55) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(143,245,202,' + (0.22 * (1 - pulseT)) + ')';
        ctx.lineWidth = 0.8;
        ctx.arc(cam.cx, cam.cy - 5, 10 + pulseT * 190, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    _drawBranches(cam, mood, sleep) {
      const ctx = this.ctx;
      const swayAmount = (0.55 + mood * 0.8) * (1 - sleep * 0.6) * (this.W < 700 ? 0.85 : 1);
      const pointer = this.pointer;
      const projScratch = [];
      for (let i = 0; i < this.branches.length; i++) {
        const b = this.branches[i];
        if (b.progress <= 0.01) continue;
        const visible = Math.max(2, Math.ceil((b.pts.length - 1) * b.progress) + 1);
        projScratch.length = 0;
        let tipX = 0, tipY = 0;
        for (let j = 0; j < visible; j++) {
          const p = b.pts[j];
          const frac = j / (b.pts.length - 1);
          const sp = this._project(p.x, p.y, p.z, cam, { phase: b.phase, amount: swayAmount }, frac);
          projScratch.push(sp);
          tipX = sp.x; tipY = sp.y;
        }
        if (projScratch.length < 2) continue;

        const prox = pointer.active ? Math.exp(-((tipX - pointer.x) * (tipX - pointer.x) + (tipY - pointer.y) * (tipY - pointer.y)) / 46000) : 0;
        const twinkle = 0.72 + 0.28 * Math.sin(this.time * 0.6 * b.flicker + b.phase);
        const breathe = 0.82 + mood * 0.28 + this.growthPulse * 0.18;
        const distToRoot = Math.hypot(tipX - cam.cx, tipY - cam.cy);
        const depthFade = clamp(1.08 - distToRoot / Math.max(1, this.H) * 0.42, 0.54, 1);
        let fade = (1 - sleep * 0.5) * twinkle * breathe * depthFade;
        if (b.depth >= 3) fade *= 0.86;
        const flow = 1 + Math.sin(this.time * 1.45 - b.depth * 0.9 + b.phase) * (this.pointer.down ? 0.18 : 0.09);
        fade *= flow;
        const gold = b.gold;
        const cr = gold ? 255 : 174;
        const cg = gold ? 232 : 248;
        const cb = gold ? 184 : 218;
        const gr = gold ? 238 : 86;
        const gg = gold ? 186 : 226;
        const gb = gold ? 112 : 172;

        // soft bloom
        ctx.beginPath();
        this._trace(ctx, projScratch);
        ctx.strokeStyle = rgba(gr, gg, gb, (0.07 + prox * 0.11) * fade);
        ctx.lineWidth = (7 + b.width * 4.2) * (0.85 + prox * 0.5);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        // tapered body: a strand thick at its base, dissolving at the tip
        const baseW = (b.width * 2.25 + (b.depth === 0 ? 1.9 : 0.8)) * (0.8 + prox * 0.5);
        this._taper(ctx, projScratch, baseW, 0.26);
        ctx.fillStyle = rgba(gold ? 250 : 92, gold ? 204 : 238, gold ? 138 : 188, (0.28 + prox * 0.12) * fade);
        ctx.fill();
        // a thread of light through the body
        ctx.beginPath();
        this._trace(ctx, projScratch);
        ctx.strokeStyle = rgba(cr, cg, cb, (0.56 + prox * 0.35) * fade);
        ctx.lineWidth = Math.max(0.42, b.width * (0.52 + prox * 0.25));
        ctx.stroke();

        // fine cilia: the fuzz of a living hypha
        if (b.depth > 0 && projScratch.length > 4) {
          ctx.beginPath();
          const hairAlpha = (0.09 + prox * 0.12) * fade;
          for (let j = 2; j < projScratch.length - 1; j += 3) {
            const q = projScratch[j];
            const n1 = (j % 2 ? 1 : -1);
            const dx = 1.5 + (j % 4) * 1.2;
            const dy = n1 * (2.2 + (j % 3) * 1.5);
            ctx.moveTo(q.x, q.y);
            ctx.lineTo(q.x + dx, q.y + dy);
          }
          ctx.strokeStyle = rgba(gold ? 230 : 168, gold ? 190 : 252, gold ? 120 : 210, hairAlpha);
          ctx.lineWidth = 0.55;
          ctx.stroke();
        }

        // nodes / buds along the hypha
        if (b.depth > 0) {
          ctx.fillStyle = rgba(232, 255, 244, 0.5 * fade);
          for (let j = 2; j < projScratch.length - 1; j += 4) {
            const q = projScratch[j];
            const r = 0.6 + q.persp * 0.55;
            ctx.fillRect(q.x - r * 0.5, q.y - r * 0.5, r, r);
          }
          for (let j = 3; j < projScratch.length - 1; j += 6) {
            const q = projScratch[j];
            const bs = (5.5 + b.width * 5) * (0.7 + prox * 0.7);
            ctx.globalAlpha = Math.min(1, (0.1 + prox * 0.22) * fade);
            ctx.drawImage(gold ? this.sprites.gold : this.sprites.jadeSoft, q.x - bs, q.y - bs, bs * 2, bs * 2);
          }
          ctx.globalAlpha = 1;
        }

        // luminous tip
        if (b.progress > 0.1) {
          const s = (9 + b.width * 8) * (0.65 + prox * 1.1) * (0.8 + mood * 0.3);
          const sprite = gold ? this.sprites.gold : this.sprites.jade;
          ctx.globalAlpha = Math.min(1, (0.34 + prox * 0.45) * fade);
          ctx.drawImage(sprite, tipX - s, tipY - s, s * 2, s * 2);
          ctx.globalAlpha = 1;

          // fully grown tips open into tiny pollen stars
          if (b.progress > 0.95 && b.depth >= 1) {
            const bloom = 0.55 + 0.45 * Math.sin(this.time * 1.1 + b.phase * 2.0);
            const reach = (3.5 + b.width * 3.5) * (0.55 + bloom * 0.55);
            ctx.strokeStyle = gold
              ? 'rgba(238,196,126,' + (0.30 * fade) + ')'
              : 'rgba(186,255,228,' + (0.26 * fade) + ')';
            ctx.lineWidth = 0.55;
            ctx.beginPath();
            ctx.moveTo(tipX - reach, tipY);
            ctx.lineTo(tipX + reach, tipY);
            ctx.moveTo(tipX, tipY - reach);
            ctx.lineTo(tipX, tipY + reach);
            ctx.stroke();
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = gold ? 'rgba(255,232,182,.9)' : 'rgba(230,255,244,.85)';
            ctx.fillRect(tipX - 0.7, tipY - 0.7, 1.4, 1.4);
            ctx.globalAlpha = 1;
          }
        }
      }
    }

    _trace(ctx, pts) {
      ctx.moveTo(pts[0].x, pts[0].y);
      if (pts.length === 2) {
        ctx.lineTo(pts[1].x, pts[1].y);
        return;
      }
      for (let i = 1; i < pts.length - 1; i++) {
        const xc = (pts[i].x + pts[i + 1].x) / 2;
        const yc = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last.x, last.y);
    }

    _taper(ctx, pts, w0, w1) {
      const n = pts.length;
      if (n < 2) return;
      const left = [], right = [];
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(n - 1, i + 1)];
        let tx = b.x - a.x;
        let ty = b.y - a.y;
        const len = Math.hypot(tx, ty) || 1;
        tx /= len; ty /= len;
        const w = (w0 + (w1 - w0) * (i / (n - 1))) * 0.5;
        left.push(p.x - ty * w, p.y + tx * w);
        right.push(p.x + ty * w, p.y - tx * w);
      }
      ctx.beginPath();
      ctx.moveTo(left[0], left[1]);
      for (let i = 1; i < n; i++) ctx.lineTo(left[i * 2], left[i * 2 + 1]);
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i * 2], right[i * 2 + 1]);
      ctx.closePath();
    }

    _drawThreads() {
      const ctx = this.ctx;
      for (let i = 0; i < this.threads.length; i++) {
        const t = (this.time - this.threads[i].born) / this.threads[i].dur;
        if (t < 0 || t > 1) continue;
        const th = this.threads[i];
        const mx = (th.x1 + th.x2) / 2;
        const my = (th.y1 + th.y2) / 2;
        const dx = th.x2 - th.x1;
        const dy = th.y2 - th.y1;
        const cx = mx - dy * th.bend;
        const cy = my + dx * th.bend;
        const fade = Math.sin(Math.PI * Math.min(1, t * 1.05)) * 0.34;
        ctx.beginPath();
        ctx.moveTo(th.x1, th.y1);
        ctx.quadraticCurveTo(cx, cy, th.x2, th.y2);
        ctx.strokeStyle = 'rgba(143,245,202,' + (fade * 0.28) + ')';
        ctx.lineWidth = 3.2;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(220,255,240,' + fade + ')';
        ctx.lineWidth = 0.7;
        ctx.stroke();
        // a spark travels from the visitor's hand to the living tip
        for (let k = 0; k < 2; k++) {
          const u = (t * 1.8 + k * 0.26) % 1;
          const iu = 1 - u;
          const px = iu * iu * th.x1 + 2 * iu * u * cx + u * u * th.x2;
          const py = iu * iu * th.y1 + 2 * iu * u * cy + u * u * th.y2;
          const s = (5 + k * 2) * (0.8 + 0.2 * Math.sin(this.time * 5 + i));
          ctx.globalAlpha = fade * (1.4 - k * 0.5);
          ctx.drawImage(this.sprites.jade, px - s, py - s, s * 2, s * 2);
        }
        ctx.globalAlpha = 1;
      }
    }

    _drawSeeds(cam) {
      const ctx = this.ctx;
      for (let i = 0; i < this.seeds.length; i++) {
        const s = this.seeds[i];
        const p = this._project(s.x, s.y, s.z, cam, null, 0.45);
        const age = this.time - s.born;
        const pulse = 0.5 + 0.5 * Math.sin(age * 2.1);
        const size = 28 + pulse * 28;
        ctx.globalAlpha = 0.52 + pulse * 0.22;
        ctx.drawImage(this.sprites.gold, p.x - size / 2, p.y - size / 2, size, size);
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = 'rgba(255,232,185,.9)';
        ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
        // slow memorial rings
        const t = (age % 4.2) / 4.2;
        if (t < 0.8) {
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(230,186,118,' + (0.24 * (1 - t)) + ')';
          ctx.lineWidth = 0.6;
          ctx.arc(p.x, p.y, 8 + t * 34, 0, TAU);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }

    _drawWaves() {
      const ctx = this.ctx;
      for (let i = 0; i < this.waves.length; i++) {
        const w = this.waves[i];
        const t = (this.time - w.born) / w.dur;
        if (t < 0 || t > 1) continue;
        const e = 1 - Math.pow(1 - t, 2.4);
        const r = w.max * e;
        const alpha = Math.sin(Math.PI * Math.min(1, t * 1.12)) * 0.3;
        ctx.beginPath();
        ctx.arc(w.x, w.y, r, 0, TAU);
        ctx.strokeStyle = w.gold ? 'rgba(230,190,120,' + alpha + ')' : 'rgba(143,245,202,' + alpha + ')';
        ctx.lineWidth = w.width;
        ctx.stroke();
        if (t < 0.7) {
          ctx.beginPath();
          ctx.arc(w.x, w.y, r * 0.7, 0, TAU);
          ctx.strokeStyle = 'rgba(143,245,202,' + (alpha * 0.25) + ')';
          ctx.stroke();
        }
      }
    }

    _drawBlooms() {
      const ctx = this.ctx;
      for (let i = 0; i < this.blooms.length; i++) {
        const b = this.blooms[i];
        const t = (this.time - b.born) / b.dur;
        if (t < 0 || t > 1) continue;
        const e = 1 - Math.pow(1 - t, 3);
        const alpha = Math.pow(1 - t, 1.7) * 0.5;
        const r = b.size * e;
        const petals = 12;
        const cr = b.gold ? 236 : 154;
        const cg = b.gold ? 190 : 250;
        const cb = b.gold ? 115 : 205;
        ctx.globalAlpha = 1;
        ctx.lineWidth = 0.7;
        for (let k = 0; k < petals; k++) {
          const a = b.rot + k / petals * TAU + t * 0.5;
          const rr = r * (0.62 + 0.38 * Math.sin(k * 2.3 + 1.1));
          const mx = b.x + Math.cos(a + 0.34) * rr * 0.64;
          const my = b.y + Math.sin(a + 0.34) * rr * 0.64;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.quadraticCurveTo(mx, my, b.x + Math.cos(a) * rr, b.y + Math.sin(a) * rr);
          ctx.strokeStyle = rgba(cr, cg, cb, alpha * (0.38 + 0.3 * Math.sin(k * 1.7)));
          ctx.stroke();
        }
        const s = r * 1.3;
        ctx.globalAlpha = alpha * 0.6;
        ctx.drawImage(b.gold ? this.sprites.gold : this.sprites.jade, b.x - s / 2, b.y - s / 2, s, s);
        ctx.globalAlpha = 1;
        ctx.fillStyle = rgba(cr, cg, cb, alpha * 0.85);
        ctx.fillRect(b.x - 1, b.y - 1, 2, 2);
      }
    }

    _drawSpores(cam, mood, sleep) {
      const ctx = this.ctx;
      for (let i = 0; i < this.spores.length; i++) {
        const s = this.spores[i];
        const p = this._project(s.x, s.y, s.z, cam, null, 0.35);
        if (p.x < -30 || p.x > this.W + 30 || p.y < -30 || p.y > this.H + 30) continue;
        const tw = 0.55 + 0.45 * Math.sin(this.time * 0.8 + s.phase);
        const alpha = s.alpha * tw * (0.71 + mood * 0.42) * (1 - sleep * 0.4);
        const sprite = this.sprites[s.kind];
        const size = s.size * (s.bokeh ? 19 : 8.2) * p.persp;
        ctx.globalAlpha = s.bokeh ? alpha * 0.22 : alpha;
        ctx.drawImage(sprite, p.x - size / 2, p.y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    }

    _drawDust(cam) {
      const ctx = this.ctx;
      const scrollOff = (this.scroll || 0) * 0.06;
      for (let i = 0; i < this.dust.length; i++) {
        const d = this.dust[i];
        const x = d.x * this.W;
        const y = (d.y + scrollOff) % 1.05 * this.H;
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.time * 0.5 + d.phase));
        const size = d.size * 7;
        ctx.globalAlpha = d.alpha * tw * 0.55;
        ctx.drawImage(this.sprites.bone, x - size / 2, y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    }

    _drawPollens() {
      const ctx = this.ctx;
      const max = this.pollens.length;
      for (let i = 0; i < max; i++) {
        const p = this.pollens[i];
        const t = p.life / p.dur;
        const alpha = Math.sin(Math.PI * Math.min(1, t)) * 0.55;
        const sprite = this.sprites[p.kind] || this.sprites.jade;
        const size = p.size * (2.8 + t * 3.6);
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite, p.x - size / 2, p.y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    }
  }

  XR.Life = Life;
})();
