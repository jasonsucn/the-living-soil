/* 《息壤 / XĪRǍNG》程序化环境声
 * 纯 Web Audio：无音频文件、无网络请求。经典脚本，挂载 window.XR.Audio。
 * 总线：各层 -> mix -> compressor -> master(-8dB) -> destination
 * 混响：mix -> send(26%) -> HP -> 程序化 convolver -> LP -> compressor
 */
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : null;
  if (!W) return;

  var C = {
    masterDb: -8, chimeDb: -18, glintDb: -38, controlMs: 90, reverb: 0.26
  };
  // D 小调五声：D F G A C，跨 D3–A4
  var SCALE = [146.83, 174.61, 196.00, 220.00, 261.63, 293.66, 349.23, 392.00, 440.00];
  // 微光：高音区 D7–C8
  var GLINT = [2093.00, 2349.32, 2793.83, 3136.00, 3520.00, 4186.01];
  // 事件纹理配置：[n=噪声(类型,起频,止频,时长), t=正弦(起频,止频,时长), peak=包络峰值dB]
  var EVENTS = {
    wake:       { peak: -28, n: ['bp', 200, 720, 0.55], t: [47, 90, 0.50] },
    sleep:      { peak: -32, n: ['lp', 680, 130, 0.60], t: [84, 41, 0.55] },
    seed:       { peak: -26, n: ['bp', 850, 240, 0.14], t: [260, 120, 0.16] },
    transition: { peak: -34, n: ['bp', 420, 1200, 0.30] },
    ui:         { peak: -32, n: ['bp', 1400, 900, 0.055], t: [1046, 900, 0.06] }
  };

  var ctx = null, G = null, started = false, enabled = false, hidden = false;
  var mood = 0.35, breath = 0, progress = 0;
  var last = {}, token = 0, noop = function () {};
  var ctrlTimer = 0, glintTimer = 0, suspendTimer = 0, lastCtrl = 0, lastEventAt = -1000;
  var voices = [], chimeVoices = 0, visHandler = null;

  function clamp01(v) { v = Number(v); return isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0; }
  function db(v) { return Math.pow(10, v / 20); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function nowMs() { return W.performance && W.performance.now ? W.performance.now() : Date.now(); }
  function clearT(id) { if (id) clearTimeout(id); return 0; }
  function canPlay() { return !!(ctx && G && enabled && !hidden && ctx.state === 'running'); }

  function gainNode(v) { var n = ctx.createGain(); n.gain.value = v; return n; }
  function filterNode(type, f, q) {
    var n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n;
  }
  function panNode(v) {
    if (!ctx.createStereoPanner) return gainNode(1);
    var n = ctx.createStereoPanner(); n.pan.value = v; return n;
  }

  // 8 秒立体声粉噪，首尾极短淡入淡出以保证无缝循环
  function makeNoise() {
    var rate = ctx.sampleRate, len = Math.floor(rate * 8), fade = Math.max(8, Math.floor(rate * 0.012));
    var buf = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), peak = 0;
      var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, i;
      for (i = 0; i < len; i++) {
        var w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
        if (Math.abs(d[i]) > peak) peak = Math.abs(d[i]);
      }
      var nrm = peak > 0 ? 0.82 / peak : 1;
      for (i = 0; i < len; i++) d[i] *= nrm;
      for (i = 0; i < fade; i++) { var k = i / fade; d[i] *= k; d[len - 1 - i] *= k; }
    }
    return buf;
  }

  // 程序化 impulse response：20ms 预延迟 + 阻尼指数衰减噪声，能量归一可预期湿声比
  function makeIR() {
    var rate = ctx.sampleRate, pre = Math.floor(rate * 0.02), len = Math.floor(rate * 2.8);
    var buf = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lp = 0, energy = 0, i;
      for (i = pre; i < len; i++) {
        var x = (i - pre) / (len - pre), w = Math.random() * 2 - 1;
        lp += (w - lp) * (0.42 * (1 - x) + 0.06);
        var env = Math.exp(-x * 4.5) * Math.min(1, (1 - x) / 0.06) * Math.min(1, (i - pre) / (rate * 0.012));
        d[i] = lp * env;
      }
      for (i = 0; i < len; i++) energy += d[i] * d[i];
      var nrm = energy > 0 ? Math.sqrt(0.85 / energy) : 0;
      for (i = 0; i < len; i++) d[i] *= nrm;
    }
    return buf;
  }

  function buildGraph() {
    G = {};
    G.master = gainNode(0);
    G.comp = ctx.createDynamicsCompressor();
    G.comp.threshold.value = -22; G.comp.knee.value = 16; G.comp.ratio.value = 2.2;
    G.comp.attack.value = 0.012; G.comp.release.value = 0.35;
    G.mix = gainNode(1);
    G.mix.connect(G.comp); G.comp.connect(G.master); G.master.connect(ctx.destination);

    // 并行卷积混响（湿声进入压缩器，避免反馈）
    G.send = gainNode(C.reverb);
    G.revHP = filterNode('highpass', 180, 0.55);
    G.revLP = filterNode('lowpass', 5200, 0.3);
    G.conv = ctx.createConvolver();
    G.conv.normalize = false; G.conv.buffer = makeIR();
    G.mix.connect(G.send); G.send.connect(G.revHP); G.revHP.connect(G.conv);
    G.conv.connect(G.revLP); G.revLP.connect(G.comp);

    // 土壤层：42Hz + 63Hz，轻三角泛音，缓慢 moving lowpass
    G.droneLP = filterNode('lowpass', 120, 0.6);
    G.droneGain = gainNode(0);
    G.droneLP.connect(G.droneGain); G.droneGain.connect(G.mix);
    G.droneOscs = []; G.detunes = [-4, 7, 2];
    var spec = [['sine', 42, 0.55], ['triangle', 42, 0.16], ['sine', 63, 0.32]];
    for (var i = 0; i < spec.length; i++) {
      var osc = ctx.createOscillator(), g = gainNode(spec[i][2]);
      osc.type = spec[i][0]; osc.frequency.value = spec[i][1]; osc.detune.value = G.detunes[i];
      osc.connect(g); g.connect(G.droneLP); G.droneOscs.push(osc);
    }
    G.lfo = ctx.createOscillator(); G.lfo.type = 'sine'; G.lfo.frequency.value = 0.037;
    var lfoAmp = gainNode(0.0032), lfoCut = gainNode(18);
    G.lfo.connect(lfoAmp); lfoAmp.connect(G.droneGain.gain);
    G.lfo.connect(lfoCut); lfoCut.connect(G.droneLP.frequency);

    // 地气层：带通粉噪 + 柔化低通，第二个慢 LFO 制造远处呼吸
    G.noise = ctx.createBufferSource();
    G.noise.buffer = makeNoise(); G.noise.loop = true;
    G.trim = gainNode(12);
    G.airBP = filterNode('bandpass', 330, 0.8);
    G.airLP = filterNode('lowpass', 2400, 0.3);
    G.airGain = gainNode(0);
    G.noise.connect(G.trim); G.trim.connect(G.airBP); G.airBP.connect(G.airLP);
    G.airLP.connect(G.airGain); G.airGain.connect(G.mix);
    G.lfo2 = ctx.createOscillator(); G.lfo2.type = 'sine'; G.lfo2.frequency.value = 0.061;
    var airCut = gainNode(75), airAmp = gainNode(0.0035);
    G.lfo2.connect(airCut); airCut.connect(G.airBP.frequency);
    G.lfo2.connect(airAmp); airAmp.connect(G.airGain.gain);
  }

  function startSources() {
    if (!G || started) return;
    started = true;
    try {
      var t = ctx.currentTime, i;
      for (i = 0; i < G.droneOscs.length; i++) G.droneOscs[i].start(t);
      G.lfo.start(t); G.lfo2.start(t);
      G.noise.start(t, Math.random() * Math.max(0, G.noise.buffer.duration - 1));
    } catch (e) {}
  }

  // 参数平滑：优先 cancelAndHold，保证连续更新不产生跳变
  function hold(param) {
    var t = ctx.currentTime;
    try {
      if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
      else { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); }
    } catch (e) {}
    return t;
  }
  function steer(param, value, tau) {
    try {
      var t = hold(param);
      param.setTargetAtTime(value, t, Math.max(0.01, tau || 0.3));
    } catch (e) {}
  }
  function fadeMaster(value, seconds) {
    if (!G) return;
    try { G.master.gain.linearRampToValueAtTime(value, hold(G.master.gain) + Math.max(0.02, seconds)); }
    catch (e) {}
  }
  function masterLevel() { return enabled && !hidden ? db(C.masterDb) : 0; }
  function put(key, param, value, tau, eps) {
    if (last[key] !== undefined && Math.abs(last[key] - value) <= eps) return;
    last[key] = value; steer(param, value, tau);
  }

  // 仅做廉价参数目标设定；连续 API 更新被节流，绝不创建节点
  function applyControls() {
    if (!G || !ctx) return;
    var m = Math.pow(clamp01(mood), 0.82), b = clamp01(breath), p = clamp01(progress);
    put('dg', G.droneGain.gain, db(-35 + 8 * m + 0.7 * b), 0.50, 0.00002);
    put('df', G.droneLP.frequency, 92 + 112 * m + 24 * b + 18 * p, 0.45, 0.4);
    put('af', G.airBP.frequency, 250 + 250 * m + 330 * b + 55 * p, 0.30, 1);
    put('ag', G.airGain.gain, db(-31 + 1.5 * m + 3.6 * b + 0.6 * p), 0.30, 0.00002);
    var cents = 1.2 * m + 5 * p;
    if (last.cents === undefined || Math.abs(last.cents - cents) > 0.03) {
      last.cents = cents;
      for (var i = 0; i < G.droneOscs.length; i++) steer(G.droneOscs[i].detune, G.detunes[i] + cents, 0.9);
    }
  }

  function scheduleControl() {
    if (!ctx || !G || !enabled || hidden) return;
    var gap = nowMs() - lastCtrl;
    if (gap >= C.controlMs) { lastCtrl = nowMs(); applyControls(); }
    else if (!ctrlTimer) {
      ctrlTimer = setTimeout(function () {
        ctrlTimer = 0;
        if (canPlay()) { lastCtrl = nowMs(); applyControls(); }
      }, C.controlMs - gap);
    }
  }

  // 一次性声部的生命周期管理；disable 时统一清除，避免 suspend 后旧尾音复活
  function trackVoice(out, sources, isChime) {
    var v = { out: out, sources: sources, chime: !!isChime, done: false, timer: 0 };
    function finish() {
      if (v.done) return;
      v.done = true;
      if (v.timer) { clearTimeout(v.timer); v.timer = 0; }
      try { out.disconnect(); } catch (e) {}
      for (var i = 0; i < sources.length; i++) { try { sources[i].stop(); } catch (e) {} }
      var k = voices.indexOf(v); if (k >= 0) voices.splice(k, 1);
      if (v.chime && chimeVoices > 0) chimeVoices--;
    }
    v.finish = finish;
    if (isChime) chimeVoices++;
    if (sources.length) sources[sources.length - 1].onended = finish;
    v.timer = setTimeout(finish, isChime ? 5200 : 1800);
    voices.push(v);
    if (voices.length > 24) voices[0].finish();
    return v;
  }
  function killVoices() {
    var list = voices.slice();
    for (var i = 0; i < list.length; i++) list[i].finish();
  }

  // 微光：极小的高频正弦, mood 越高越密
  function playGlint() {
    if (!canPlay()) return;
    try {
      var t = ctx.currentTime + 0.01, f = GLINT[randInt(0, GLINT.length - 1)] * rnd(0.997, 1.003);
      var osc = ctx.createOscillator(), harm = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = f;
      harm.type = 'sine'; harm.frequency.value = f * 2.01;
      var hg = gainNode(0.1), env = gainNode(0), pan = panNode(rnd(-0.55, 0.55));
      osc.connect(env); harm.connect(hg); hg.connect(env); env.connect(pan); pan.connect(G.mix);
      var peak = db(C.glintDb) * (0.75 + 0.45 * clamp01(mood));
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(peak, t + 0.008);
      env.gain.setTargetAtTime(0.0001, t + 0.012, 0.17);
      osc.start(t); harm.start(t); osc.stop(t + 0.9); harm.stop(t + 0.9);
      trackVoice(pan, [osc, harm], false);
    } catch (e) {}
  }
  function scheduleGlint() {
    glintTimer = clearT(glintTimer);
    if (!ctx || !enabled || hidden) return;
    var m = clamp01(mood), min = 3 + (1 - m) * 9, span = 3.5 + (1 - m) * 8.5;
    glintTimer = setTimeout(function () {
      glintTimer = 0;
      if (!ctx || !enabled || hidden) return;
      playGlint(); scheduleGlint();
    }, (min + Math.random() * span) * 1000);
  }

  // 矿物钟声：D 小调五声，四正弦泛音，长衰减；峰值约 -18 dB
  function chime(step) {
    if (!canPlay() || chimeVoices >= 4) return;
    try {
      var idx;
      if (step === undefined || step === null || !isFinite(Number(step))) idx = randInt(0, SCALE.length - 1);
      else idx = Math.max(0, Math.min(SCALE.length - 1, Math.round(Number(step))));
      var t = ctx.currentTime + 0.015, freq = SCALE[idx] * (1 + rnd(-0.0015, 0.0015));
      var env = gainNode(0), pan = panNode(rnd(-0.3, 0.3)), oscs = [];
      env.connect(pan); pan.connect(G.mix);
      var ratios = [1, 2, 2.76, 4.08], vols = [0.6, 0.18, 0.07, 0.03];
      for (var i = 0; i < ratios.length; i++) {
        var o = ctx.createOscillator(), pg = gainNode(vols[i]);
        o.type = 'sine'; o.frequency.value = freq * ratios[i];
        o.detune.value = i ? rnd(-1.5, 1.5) : rnd(-2.5, 2.5);
        o.connect(pg); pg.connect(env); o.start(t); o.stop(t + 4.2); oscs.push(o);
      }
      var peak = db(C.chimeDb) * rnd(0.9, 1);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(peak, t + 0.008);
      env.gain.setTargetAtTime(0.0001, t + 0.02, 0.75);
      trackVoice(pan, oscs, true);
    } catch (e) {}
  }

  // 极短纹理事件；限频以防事件风暴堆积节点
  function event(name) {
    if (!canPlay() || voices.length > 22) return;
    if (!Object.prototype.hasOwnProperty.call(EVENTS, name)) return;
    var cfg = EVENTS[name];
    var stamp = nowMs();
    if (stamp - lastEventAt < 35) return;
    lastEventAt = stamp;
    try {
      var t = ctx.currentTime + 0.008, maxDur = 0.06;
      if (cfg.n && cfg.n[3] > maxDur) maxDur = cfg.n[3];
      if (cfg.t && cfg.t[2] > maxDur) maxDur = cfg.t[2];
      var env = gainNode(0), pan = panNode(rnd(-0.25, 0.25)), sources = [];
      env.connect(pan); pan.connect(G.mix);
      if (cfg.n) {
        var n = cfg.n, src = ctx.createBufferSource(), nf = filterNode(n[0] === 'lp' ? 'lowpass' : 'bandpass', n[1], n[0] === 'lp' ? 0.7 : 1.1);
        src.buffer = G.noise.buffer; src.loop = false;
        nf.frequency.setValueAtTime(n[1], t);
        nf.frequency.linearRampToValueAtTime(n[2], t + n[3]);
        var ng = gainNode(2.5);
        src.connect(nf); nf.connect(ng); ng.connect(env);
        src.start(t, rnd(0, 5.5), maxDur + 0.15); sources.push(src);
      }
      if (cfg.t) {
        var o = ctx.createOscillator(), tg = gainNode(0.4);
        o.type = 'sine'; o.frequency.setValueAtTime(cfg.t[0], t);
        o.frequency.linearRampToValueAtTime(cfg.t[1], t + cfg.t[2]);
        o.connect(tg); tg.connect(env); o.start(t); o.stop(t + maxDur + 0.15); sources.push(o);
      }
      var attack = Math.max(0.003, Math.min(0.04, maxDur * 0.18)), tau = Math.max(0.012, maxDur * 0.22);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(db(cfg.peak), t + attack);
      env.gain.setTargetAtTime(0.0001, t + attack, tau);
      if (sources.length) trackVoice(pan, sources, false);
      else try { pan.disconnect(); } catch (e) {}
    } catch (e) {}
  }

  function onVisibility() {
    if (!ctx) return;
    hidden = !!(W.document && W.document.hidden);
    if (hidden) {
      glintTimer = clearT(glintTimer); ctrlTimer = clearT(ctrlTimer);
      if (enabled) fadeMaster(0, 0.35);
      return;
    }
    if (!enabled) return;
    if (ctx.state === 'suspended') {
      try { var p = ctx.resume(); if (p && p.catch) p.catch(noop); } catch (e) {}
    }
    fadeMaster(masterLevel(), 0.9);
    lastCtrl = nowMs(); applyControls(); scheduleGlint();
  }

  function init() {
    try {
      if (ctx) return;
      var AC = W.AudioContext || W.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      started = false; enabled = false; last = {};
      buildGraph();
      hidden = !!(W.document && W.document.hidden);
      if (W.document && !visHandler) {
        visHandler = onVisibility;
        W.document.addEventListener('visibilitychange', visHandler);
      }
    } catch (e) {
      try { if (ctx && ctx.close) { var p = ctx.close(); if (p && p.catch) p.catch(noop); } } catch (e2) {}
      ctx = null; G = null; started = false;
    }
  }

  async function enable() {
    var mine = ++token;
    suspendTimer = clearT(suspendTimer);
    try {
      if (!ctx) init();
      if (!ctx || !G) return false;
      var c = ctx;
      if (c.state === 'closed') return false;
      if (c.state !== 'running') {
        var r = c.resume();
        if (r && r.then) await r;
      }
      if (mine !== token || c !== ctx) return false;
      if (c.state !== 'running') return false;
      enabled = true;
      hidden = !!(W.document && W.document.hidden);
      startSources();
      lastCtrl = nowMs(); applyControls();
      fadeMaster(masterLevel(), 1.2);
      scheduleGlint();
      return true;
    } catch (e) {
      if (mine === token) enabled = false;
      return false;
    }
  }

  function disable() {
    ++token;
    try {
      enabled = false;
      glintTimer = clearT(glintTimer); ctrlTimer = clearT(ctrlTimer);
      if (!ctx || !G) return;
      fadeMaster(0, 0.45);
      if (!suspendTimer) {
        suspendTimer = setTimeout(function () {
          suspendTimer = 0;
          if (enabled || !ctx) return;
          killVoices();
          if (ctx.state === 'running') {
            try { var p = ctx.suspend(); if (p && p.catch) p.catch(noop); } catch (e) {}
          }
        }, 560);
      }
    } catch (e) {}
  }

  async function toggle() {
    if (enabled) { disable(); return false; }
    return await enable();
  }

  function setMood(v) { try { mood = clamp01(v); scheduleControl(); } catch (e) {} }
  function setBreath(v) { try { breath = clamp01(v); scheduleControl(); } catch (e) {} }
  function setProgress(v) { try { progress = clamp01(v); scheduleControl(); } catch (e) {} }
  function isEnabled() { return !!(ctx && enabled); }

  function dispose() {
    try {
      ++token; enabled = false; hidden = false;
      glintTimer = clearT(glintTimer); ctrlTimer = clearT(ctrlTimer); suspendTimer = clearT(suspendTimer);
      if (visHandler && W.document) W.document.removeEventListener('visibilitychange', visHandler);
      visHandler = null;
      killVoices();
      var c = ctx;
      ctx = null; G = null; started = false; last = {}; chimeVoices = 0;
      if (c && c.state !== 'closed') {
        try { var p = c.close(); if (p && p.catch) p.catch(noop); } catch (e) {}
      }
    } catch (e) {}
  }

  W.XR = W.XR || {};
  W.XR.Audio = {
    init: init, enable: enable, disable: disable, isEnabled: isEnabled, toggle: toggle,
    setMood: setMood, setBreath: setBreath, chime: chime, event: event,
    setProgress: setProgress, dispose: dispose
  };
})();
