/* ============================================================
   息壤 · app.js
   Choreography, narrative, attention, sound, memory.
   ============================================================ */
(function () {
  'use strict';

  const XR = (window.XR = window.XR || {});
  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  const clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  const pad = function (n, len) { return String(n).padStart(len || 2, '0'); };
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const query = new URLSearchParams(location.search);
  const debugMode = query.has('debug');
  const stillPose = query.get('pose') || '';
  const TAU = Math.PI * 2;
  const BASE_TITLE = document.title;
  const SLEEP_TITLE = '息壤 · 它正在做梦';

  const SEEDS_KEY = 'xirang.seeds.v1';
  const LAST_KEY = 'xirang.lastVisit.v1';

  function graphemes(str) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      try {
        const seg = new Intl.Segmenter('zh', { granularity: 'grapheme' });
        return Array.from(seg.segment(str), function (s) { return s.segment; }).filter(function (s) { return s.trim().length; });
      } catch (e) { /* fall through */ }
    }
    return Array.from(str).filter(function (s) { return s.trim().length; });
  }

  function readSeeds() {
    try {
      const raw = JSON.parse(localStorage.getItem(SEEDS_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw.filter(function (s) {
        return s && typeof s.c === 'string' && s.c.length && typeof s.t === 'number';
      }).slice(-12);
    } catch (e) { return []; }
  }

  function readLastVisit() {
    try {
      const n = Number(localStorage.getItem(LAST_KEY));
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch (e) { return 0; }
  }

  function saveLastVisit() {
    try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch (e) { /* private mode */ }
  }

  function saveSeeds(seeds) {
    try { localStorage.setItem(SEEDS_KEY, JSON.stringify(seeds)); } catch (e) { /* private mode */ }
  }

  function makeHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }

  function formatDate(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function formatSpan(hours) {
    const days = Math.floor(hours / 24);
    const hrs = Math.floor(hours % 24);
    const mins = Math.max(1, Math.floor((hours % 1) * 60));
    if (days > 0) return days + ' 天 ' + hrs + ' 小时';
    if (hrs > 0) return hrs + ' 小时 ' + mins + ' 分钟';
    return mins + ' 分钟';
  }

  const els = {
    body: document.body,
    boot: $('#boot'),
    bootSkip: $('#bootSkip'),
    overtureSkip: $('#overtureSkip'),
    bootCopy: $('.boot-copy'),
    overture: $('#overture'),
    hudStatus: $('#hudStatus'),
    statusCn: $('#statusCn'),
    statusEn: $('#statusEn'),
    soundBtn: $('#soundBtn'),
    soundLabel: $('#soundLabel'),
    cursor: $('#cursor'),
    cursorLabel: $('#cursorLabel'),
    vitalSym: $('#vitalSym'),
    vitalMyc: $('#vitalMyc'),
    vitalBreath: $('#vitalBreath'),
    vitalSeeds: $('#vitalSeeds'),
    breatheBpm: $('#breatheBpm'),
    breatheSym: $('#breatheSym'),
    breathBtn: $('#breathBtn'),
    ringValue: $('#ringValue'),
    ringCn: $('#ringCn'),
    holdState: $('#holdState'),
    holdPct: $('#holdPct'),
    holdCaption: $('#holdCaption'),
    seedCount: $('#seedCount'),
    returnedCount: $('#returnedCount'),
    sowBtn: $('#sowBtn'),
    sleepText: $('#sleepText'),
    dreamLine: $('#dreamLine'),
    returnNote: $('#returnNote'),
    footRemember: $('#footRemember'),
    seedForm: $('#seedForm'),
    seedInput: $('#seedInput'),
    plantBtn: $('#plantBtn'),
    seedError: $('#seedError'),
    seedLedger: $('#seedLedger'),
    ledgerCount: $('#ledgerCount'),
    ledgerGlyphs: $('#ledgerGlyphs'),
    finaleDim: $('#finaleDim'),
    finale: $('#finale'),
    finaleId: $('#finaleId'),
    finaleIndex: $('#finaleIndex'),
    finaleHash: $('#finaleHash'),
    finaleTitle: $('#finaleTitle'),
    finaleMeta: $('#finaleMeta'),
    sigil: $('#sigil'),
    sigilTicks: $('#sigilTicks'),
    plantAgain: $('#plantAgain'),
    closeFinale: $('#closeFinale'),
    whisper: $('#whisper'),
    siteFoot: $('#siteFoot'),
    debug: $('#debug'),
    debugFps: $('#debugFps'),
    debugBranches: $('#debugBranches'),
    debugMode: $('#debugMode'),
    heroReveals: $$('.chapter--hero .reveal')
  };

  const sections = $$('.chapter');
  const heroSection = $('#top');
  const breathSection = $('#breath');
  const returnSection = $('#return');
  const sleepSection = $('#sleep');
  const growSection = $('#grow');

  const storedSeeds = readSeeds();
  const lastVisit = readLastVisit();
  const awayHours = lastVisit ? Math.max(0, (Date.now() - lastVisit) / 3600000) : 0;
  let returnBonus = 0;
  if (lastVisit) {
    returnBonus = Math.min(34, Math.floor(awayHours * 2));
    if (returnBonus < 1 && awayHours > 0.018) returnBonus = 1;
  }

  const state = {
    time: 0,
    booted: false,
    chapter: 0,
    scroll: 0,
    pointer: { x: window.innerWidth * 0.5, y: window.innerHeight * 0.55, vx: 0, vy: 0, active: false, down: false },
    rootX: parseFloat(heroSection.dataset.root) || 0.685,
    zoom: parseFloat(heroSection.dataset.zoom) || 1,
    tilt: parseFloat(heroSection.dataset.tilt) || 0.02,
    mood: 0.32,
    hold: 0,
    sleep: 0,
    sleeping: false,
    attention: 0.28,
    reduced: reducedMotion,
    finaleOpen: false,
    interacted: false,
    lastActivity: performance.now(),
    soundOn: false
  };

  let bg = null;
  let life = null;
  let glyph = null;
  let audio = XR.Audio || null;
  let seeds = storedSeeds.slice();
  let sessionSeeds = 0;
  let bootTimers = [];
  let bootShown = false;
  let holdActive = false;
  let holdCharge = 0;
  let holdReleasedAt = 0;
  let lastSurge = 0;
  let lastWhisper = '';
  let lastWhisperAt = 0;
  let whisperTimer = 0;
  let cursorTarget = { x: state.pointer.x, y: state.pointer.y };
  let cursorRing = { x: state.pointer.x, y: state.pointer.y };
  let cursorVisible = false;
  let hadPointer = false;
  let lastPointerMove = 0;
  let lastHudAt = 0;
  let lastAudioAt = 0;
  let lastProgressAt = 0;
  let lastSleepCheck = 0;
  let sectionCache = [];
  let finalFallback = null;
  let lastFocused = null;
  let activeChar = '';
  let rafId = 0;
  let frameLast = performance.now();
  let fpsAccum = 0;
  let fpsFrames = 0;
  let fpsValue = 60;
  let debugAt = 0;
  let holdUiLast = '';
  let audioErrorShown = false;
  let bgAccum = 0;
  let lifePrefilled = false;
  let gpuName = '';
  let fullBloomFired = false;
  let lastHoldBloom = 0;

  function init() {
    // Every visit begins at the surface: the overture is not a deep link.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    if (location.hash) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    }
    window.scrollTo(0, 0);

    // Optional WebGL / particle / life layers.
    try {
      if (XR.SoilBackground) {
        bg = new XR.SoilBackground($('#bg'));
        if (bg) gpuName = bg.renderer || '';
      }
    } catch (e) { bg = null; }
    try {
      if (XR.GlyphField) glyph = new XR.GlyphField($('#glyph'));
    } catch (e) { glyph = null; }
    try {
      if (XR.Life) {
        life = new XR.Life($('#life'));
        life.rootXRatio = 0.58;
        if (typeof life.setReturnBonus === 'function' && returnBonus) {
          // Growth is prepared after startGrowth so it can branch from real tips.
        }
      }
    } catch (e) { life = null; }

    state.reduced = reducedMotion;
    if (state.reduced) document.documentElement.classList.add('reduced-motion');

    setupReturnStory();
    setupLedger();
    setupReveals();
    setupObservers();
    bindEvents();
    buildSigilTicks();
    cacheSections();

    if (audio && typeof audio.init === 'function') {
      try { audio.init(); } catch (e) { /* the first gesture still retries */ }
    }
    reflectSound();

    if (debugMode) {
      els.debug.hidden = false;
      if (gpuName) {
        const s = document.createElement('span');
        s.textContent = gpuName.replace(/^ANGLE \(/, '').replace(/\)$/, '').slice(0, 44);
        s.style.color = 'rgba(143,245,202,.55)';
        els.debug.appendChild(s);
      }
      setInterval(updateDebug, 500);
    }

    if (state.reduced) {
      startReduced();
    } else {
      beginBoot();
      frameLast = performance.now();
      rafId = requestAnimationFrame(loop);
    }

    updateHUD(true);
  }

  function setupReturnStory() {
    if (lastVisit) {
      els.bootCopy.innerHTML = '它记得你 <span>/</span> WELCOME BACK';
    }
    if (returnBonus > 0) {
      els.returnNote.hidden = false;
      els.returnNote.innerHTML = '你不在的 <b>' + formatSpan(awayHours) + '</b> 里，' +
        '它悄悄长出了 <b>' + returnBonus + '</b> 条新菌丝。';
    }
    if (els.returnedCount) {
      const wrap = els.returnedCount.parentElement;
      if (wrap) wrap.hidden = returnBonus <= 0;
      els.returnedCount.textContent = pad(returnBonus);
    }
  }

  function setupLedger() {
    if (els.footRemember) {
      if (seeds.length) {
        els.footRemember.hidden = false;
        els.footRemember.textContent = '此土记得「' + seeds[seeds.length - 1].c + '」 · 共 ' + pad(seeds.length) + ' 个字';
      } else {
        els.footRemember.hidden = true;
      }
    }
    if (!els.seedLedger) return;
    if (!seeds.length) {
      els.seedLedger.hidden = true;
      els.ledgerCount.textContent = '00';
      return;
    }
    els.seedLedger.hidden = false;
    els.ledgerCount.textContent = pad(seeds.length);
    els.ledgerGlyphs.innerHTML = '';
    seeds.slice(-12).forEach(function (seed) {
      const span = document.createElement('span');
      span.className = 'ledger-glyph';
      span.textContent = seed.c;
      span.title = formatDate(seed.t);
      els.ledgerGlyphs.appendChild(span);
    });
  }

  function setupReveals() {
    $$('.reveal').forEach(function (el) {
      const delay = parseFloat(el.getAttribute('data-delay') || '0');
      if (delay) el.style.transitionDelay = (delay * 0.12 + 0.05).toFixed(2) + 's';
      if (el.closest('.chapter--hero')) return;
      const io = new IntersectionObserver(function (entries, observer) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
      io.observe(el);
      el._io = io;
    });
  }

  function setupObservers() {
    const sectionIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) entry.target.classList.add('is-in');
      });
    }, { threshold: 0.08 });
    sections.forEach(function (section) { sectionIO.observe(section); });
  }

  function cacheSections() {
    sectionCache = sections.map(function (section) {
      return {
        el: section,
        top: section.offsetTop,
        height: section.offsetHeight,
        root: parseFloat(section.dataset.root) || 0.66,
        zoom: parseFloat(section.dataset.zoom) || 1,
        tilt: parseFloat(section.dataset.tilt) || 0.02
      };
    });
  }

  /* ---------------- boot ---------------- */

  function beginBoot() {
    state.booted = false;
    document.body.classList.add('is-booting', 'is-locked');
    if (reducedMotion) { endBoot(true); return; }

    bootTimers.push(setTimeout(function () {
      els.boot.classList.add('is-leaving');
      els.bootSkip.classList.add('is-visible');
    }, 720));

    bootTimers.push(setTimeout(function () {
      if (els.overture) els.overture.classList.add('is-on');
    }, 1380));

    bootTimers.push(setTimeout(function () {
      showOpeningGlyph();
    }, 900));

    if (stillPose === 'intro') return;

    bootTimers.push(setTimeout(function () {
      if (glyph && glyph.isActive()) {
        glyph.disperse({
          dir: 'fall',
          x: (life ? life.rootXRatio : 0.685) * window.innerWidth,
          y: (life ? life.rootYRatio : 0.94) * window.innerHeight
        });
      }
    }, 2980));

    bootTimers.push(setTimeout(function () {
      endBoot(false);
    }, 3170));
  }

  function showOpeningGlyph() {
    if (!glyph || bootShown) return;
    bootShown = true;
    const W = window.innerWidth, H = window.innerHeight;
    const mobile = W < 700;
    glyph.show('息壤', {
      x: W * 0.5,
      y: H * 0.47,
      fontPx: Math.min(W * 0.355, H * 0.46),
      maxWidth: W * 0.82,
      maxHeight: H * 0.5,
      maxCount: mobile ? 2300 : 3900
    });
  }

  function endBoot(skipped) {
    if (state.booted) return;
    bootTimers.forEach(clearTimeout);
    bootTimers = [];
    state.booted = true;
    if (skipped && glyph) glyph.hide();
    els.boot.classList.add('is-done');
    els.bootSkip.classList.remove('is-visible');
    if (els.overture) {
      els.overture.classList.remove('is-on');
      els.overture.classList.add('is-off');
      window.setTimeout(function () { if (els.overture) els.overture.hidden = true; }, 1400);
    }
    document.body.classList.remove('is-booting', 'is-locked');
    document.body.classList.add('is-ready');
    els.heroReveals.forEach(function (el) { el.classList.add('is-in'); });
    if (life) {
      life.startGrowth();
      if (returnBonus && !life.returnedBranches) life.setReturnBonus(returnBonus);
      if (!lifePrefilled) {
        lifePrefilled = true;
        const warmup = window.innerWidth < 700 ? 16 : 12;
        life.prefill(warmup, { mood: 0.56, hold: 0, rootX: state.rootX, zoom: state.zoom, tilt: state.tilt });
      }
    }
    state.lastActivity = performance.now();
    updateStatus();
    cacheSections();
    handleScroll();
    updateHUD(true);
    if (skipped) {
      showWhisper('土壤已苏醒。', 2300);
    }
    if (lastVisit && returnBonus > 0) {
      if (els.statusCn && els.statusEn) {
        els.statusCn.textContent = '土壤记得你';
        els.statusEn.textContent = 'SOIL REMEMBERS';
        window.setTimeout(updateStatus, 5200);
      }
      window.setTimeout(function () {
        showWhisper('你不在的 ' + formatSpan(awayHours) + ' 里，它长出了 ' + returnBonus + ' 条新菌丝。', 5200);
      }, skipped ? 1600 : 900);
    }
  }

  function startReduced() {
    // A still, complete composition for visitors who prefer less motion.
    document.body.classList.remove('is-booting', 'is-locked');
    document.body.classList.add('is-ready');
    if (els.boot) {
      els.boot.classList.add('is-done');
      els.bootSkip.classList.remove('is-visible');
    }
    if (els.overture) els.overture.hidden = true;
    els.heroReveals.forEach(function (el) { el.classList.add('is-in'); });
    sections.forEach(function (section) { section.classList.add('is-in'); });
    state.booted = true;
    if (life) {
      life.startGrowth();
      if (returnBonus) life.setReturnBonus(returnBonus);
      if (typeof life.prefill === 'function') {
        state.mood = 0.6;
        life.prefill(window.innerWidth < 700 ? 16 : 12, { mood: 0.6, hold: 0, rootX: state.rootX, zoom: state.zoom, tilt: state.tilt });
        lifePrefilled = true;
      }
    }
    if (bg) {
      bg.resize();
      bg.setRoot(life ? life.rootXRatio : state.rootX, life ? life.rootYRatio : 0.94);
      bg.render(state);
    }
    if (glyph) glyph.hide();
    updateStatus();
    updateHUD(true);
  }

  /* ---------------- scroll / chapters ---------------- */

  let scrollTicking = false;
  function onScroll() {
    markActivity();
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(function () {
      handleScroll();
      scrollTicking = false;
    });
  }

  function handleScroll() {
    const y = window.scrollY || window.pageYOffset;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    state.scroll = clamp(y / max, 0, 1);

    if (!sectionCache.length) cacheSections();
    const marker = y + window.innerHeight * 0.46;
    let active = 0;
    for (let i = 0; i < sectionCache.length; i++) {
      if (marker >= sectionCache[i].top) active = i;
    }
    const info = sectionCache[active];
    if (info) {
      state.rootX = info.root;
      state.zoom = info.zoom;
      state.tilt = info.tilt;
    }
    if (active !== state.chapter) {
      state.chapter = active;
      setRail(active);
      if (state.booted) {
        const now = performance.now();
        if (now - lastSurge > 2200) {
          lastSurge = now;
          if (life) life.pulse('surge');
          if (state.soundOn && audio) {
            try { audio.event('transition'); } catch (e) { /* ignore */ }
          }
        }
      }
    }
    if (state.reduced) {
      if (life) {
        life.rootXRatio = state.rootX;
        life.zoom = state.zoom;
        life.tilt = state.tilt;
        life.render();
      }
      if (bg) {
        bg.setRoot(state.rootX, life ? life.rootYRatio : 0.94);
        bg.render(state);
      }
    }
    if (state.soundOn && audio && performance.now() - lastProgressAt > 450) {
      lastProgressAt = performance.now();
      try { audio.setProgress(state.scroll); } catch (e) { /* ignore */ }
    }
  }

  function setRail(index) {
    $$('.chapter-rail a').forEach(function (a, i) {
      const active = i === index;
      a.classList.toggle('is-active', active);
      if (active) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
    document.body.classList.toggle('scrim-right', index === 2);
  }

  /* ---------------- events ---------------- */

  function bindEvents() {
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave, { passive: true });
    document.addEventListener('wheel', markActivity, { passive: true });
    document.addEventListener('touchstart', markActivity, { passive: true });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('mouseleave', function () { setCursorVisible(false); });

    window.addEventListener('pagehide', saveLastVisit);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) saveLastVisit();
    });

    if (els.soundBtn) els.soundBtn.addEventListener('click', toggleSound);
    if (els.bootSkip) els.bootSkip.addEventListener('click', function (e) {
      e.preventDefault();
      endBoot(true);
    });
    if (els.overtureSkip) els.overtureSkip.addEventListener('click', function (e) {
      e.preventDefault();
      endBoot(true);
    });

    setupHold();
    setupCursorTargets();

    if (els.sowBtn) els.sowBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!state.booted || state.finaleOpen) return;
      const target = sowPoint();
      plantAt(target.x, target.y, true);
    });

    if (els.seedForm) els.seedForm.addEventListener('submit', onSubmitSeed);
    if (els.seedInput) {
      els.seedInput.addEventListener('input', function () {
        els.seedError.textContent = '';
        markActivity();
        if (state.soundOn && audio) { try { audio.event('ui'); } catch (e) { /* ignore */ } }
      });
      els.seedInput.addEventListener('mouseenter', function () { /* no-op */ });
    }
    if (els.plantAgain) els.plantAgain.addEventListener('click', function () { closeFinale('again'); });
    if (els.closeFinale) els.closeFinale.addEventListener('click', function () { closeFinale('footer'); });
    if (els.finaleDim) els.finaleDim.addEventListener('click', function () { if (state.finaleOpen) closeFinale('footer'); });

    // Touch-friendly copy.
    if (!finePointer) {
      const hint = $$('.hints li');
      const descs = ['轻触唤醒', '按住同息', '滑动生长'];
      hint.forEach(function (li, i) {
        const d = li.querySelector('.hint-desc');
        if (d) d.textContent = descs[i] || d.textContent;
      });
      const cap = els.holdCaption;
      if (cap) cap.textContent = '按住 · 感受它吸气';
    }
  }

  function onPointerMove(e) {
    if (e.pointerType === 'touch' && state.sleeping) return;
    const now = performance.now();
    const dt = Math.max(8, now - (lastPointerMove || now - 16));
    const nx = e.clientX;
    const ny = e.clientY;
    state.pointer.vx = (nx - state.pointer.x) / dt * 1000;
    state.pointer.vy = (ny - state.pointer.y) / dt * 1000;
    state.pointer.x = nx;
    state.pointer.y = ny;
    state.pointer.active = true;
    lastPointerMove = now;
    cursorTarget.x = nx;
    cursorTarget.y = ny;
    if (!hadPointer) {
      hadPointer = true;
      if (finePointer && !state.reduced) {
        document.body.classList.add('has-cursor');
        if (els.cursor) els.cursor.style.opacity = '1';
      }
    }
    setCursorVisible(true);
    if (state.reduced) return;
    if (state.sleeping) {
      wakeUp();
    } else {
      markActivity();
    }
    // small bursts of attention while moving
    state.attention = clamp(state.attention + Math.min(0.0018, Math.hypot(state.pointer.vx, state.pointer.vy) * 0.0000035), 0, 1);
  }

  function onPointerDown(e) {
    state.pointer.down = true;
    if (els.cursor) els.cursor.classList.add('is-down');
    markActivity();
    if (!state.booted || state.finaleOpen) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target;
    if (target.closest('[data-cursor]') || target.closest('.finale') || target.closest('.sound-btn')) return;
    // The soil responds immediately to touch. Actual sowing happens on click.
    if (bg && finePointer) {
      try { bg.emitRipple(e.clientX, e.clientY); } catch (err) { /* ignore */ }
    }
  }

  function onPointerUp() {
    state.pointer.down = false;
    if (els.cursor) els.cursor.classList.remove('is-down');
    stopHold();
  }

  function onPointerLeave() {
    state.pointer.active = false;
    setCursorVisible(false);
    stopHold();
  }

  function markActivity() {
    state.lastActivity = performance.now();
    if (state.booted) state.interacted = true;
    if (state.sleeping && state.booted && !state.finaleOpen) wakeUp();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && state.finaleOpen) { closeFinale('none'); return; }
    if (!state.booted) {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { endBoot(true); e.preventDefault(); }
      return;
    }
    if (state.finaleOpen && e.key === 'Tab') {
      const focusables = [els.plantAgain, els.closeFinale].filter(Boolean);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus({ preventScroll: true }); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus({ preventScroll: true }); }
      return;
    }
    markActivity();
  }

  function onDocumentClick(e) {
    if (!state.booted || state.finaleOpen) return;
    if (e.target.closest('a,button,input,textarea,select,label,form,[data-cursor],.finale,.finale-dim')) return;
    if (window.getSelection && String(window.getSelection()).length > 2) return;
    if (e.clientX == null) return;
    // Only after the visitor has met the breath chapter, anything can be pollen.
    if (state.chapter < 1) return;
    plantAt(e.clientX, e.clientY, false);
  }

  function setupHold() {
    if (!els.breathBtn) return;
    els.breathBtn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      startHold();
      markActivity();
    });
    window.addEventListener('pointerup', function () { stopHold(); }, { passive: true });
    window.addEventListener('pointercancel', function () { stopHold(); }, { passive: true });
    els.breathBtn.addEventListener('keydown', function (e) {
      if (e.key === ' ' || e.key === 'Enter') {
        if (e.repeat) return;
        e.preventDefault();
        startHold();
      }
    });
    els.breathBtn.addEventListener('keyup', function (e) {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        stopHold();
      }
    });
    els.breathBtn.addEventListener('blur', stopHold);
  }

  function startHold() {
    if (!state.booted || state.finaleOpen || holdActive) return;
    holdActive = true;
    state.pointer.down = true;
    if (els.breathBtn) {
      els.breathBtn.classList.add('is-holding');
      els.breathBtn.setAttribute('aria-pressed', 'true');
    }
    if (els.ringCn) els.ringCn.textContent = '吸气';
    state.lastActivity = performance.now();
    if (state.sleeping) wakeUp();
    if (state.soundOn && audio) { try { audio.event('ui'); } catch (e) { /* ignore */ } }
  }

  function stopHold() {
    if (!holdActive) return;
    holdActive = false;
    state.pointer.down = false;
    holdReleasedAt = performance.now();
    if (els.breathBtn) {
      els.breathBtn.classList.remove('is-holding');
      els.breathBtn.setAttribute('aria-pressed', 'false');
    }
    if (els.ringCn) els.ringCn.textContent = '呼';
    if (life && typeof life.breathRelease === 'function') life.breathRelease(state.pointer.x, state.pointer.y);
    if (bg && typeof bg.emitRipple === 'function') {
      try { bg.emitRipple(state.pointer.x, state.pointer.y); } catch (e) { /* ignore */ }
    }
    state.lastActivity = performance.now();
    setTimeout(function () {
      if (!holdActive && performance.now() - holdReleasedAt > 900) {
        if (els.ringCn) els.ringCn.textContent = '按住';
      }
    }, 980);
  }

  function setupCursorTargets() {
    if (!finePointer) return;
    $$('[data-cursor]').forEach(function (el) {
      el.addEventListener('pointerenter', function () {
        if (!els.cursor) return;
        els.cursor.classList.add('is-active');
        if (els.cursorLabel) els.cursorLabel.textContent = el.getAttribute('data-cursor') || '';
      });
      el.addEventListener('pointerleave', function () {
        if (!els.cursor) return;
        els.cursor.classList.remove('is-active');
      });
    });
  }

  function setCursorVisible(v) {
    if (!finePointer || state.reduced || !els.cursor) return;
    if (v) {
      if (cursorVisible) return;
      cursorVisible = true;
      els.cursor.style.opacity = '1';
    } else {
      if (!cursorVisible) return;
      cursorVisible = false;
      els.cursor.style.opacity = '0';
    }
  }

  /* ---------------- sowing ---------------- */

  function sowPoint() {
    // A place inside the organism, opposite the copy.
    const x = window.innerWidth * (state.chapter === 2 ? 0.33 : 0.55) + (Math.random() - 0.5) * window.innerWidth * 0.12;
    const y = window.innerHeight * (0.42 + Math.random() * 0.2);
    return { x: clamp(x, 24, window.innerWidth - 24), y };
  }

  function plantAt(x, y, explicit) {
    if (!life) return;
    if (!finePointer && explicit) {
      // Touch has no hover; use a visual, reachable point.
      if (x == null) { x = window.innerWidth * 0.5; y = window.innerHeight * 0.5; }
    }
    sessionSeeds++;
    state.attention = clamp(state.attention + 0.12, 0, 1);
    state.lastActivity = performance.now();
    try { life.plantSeed(x, y); } catch (e) { /* ignore */ }
    if (bg) { try { bg.emitRipple(x, y); } catch (e) { /* ignore */ } }
    if (state.soundOn && audio) {
      try {
        audio.chime(sessionSeeds % 8);
        audio.event('seed');
      } catch (e) { /* ignore */ }
    }
    if (sessionSeeds === 1) showWhisper('它记住了这束光。', 2600);
    updateHUD(true);
    if (state.reduced && life) life.render();
  }

  /* ---------------- sound ---------------- */

  async function toggleSound() {
    if (!audio || typeof audio.enable !== 'function') {
      showWhisper('这台设备暂时听不见。', 2600);
      return;
    }
    try {
      if (typeof audio.init === 'function') audio.init();
      if (!state.soundOn) {
        const ok = await audio.enable();
        state.soundOn = ok === false ? false : (typeof audio.isEnabled === 'function' ? !!audio.isEnabled() : true);
        if (!state.soundOn) throw new Error('audio did not start');
        if (typeof audio.setMood === 'function') audio.setMood(Math.max(0.35, state.mood));
        if (typeof audio.setProgress === 'function') audio.setProgress(state.scroll);
        if (typeof audio.event === 'function') audio.event('ui');
        if (typeof audio.chime === 'function') audio.chime(2);
        showWhisper('土壤开始发声。', 2800);
      } else {
        if (typeof audio.disable === 'function') audio.disable();
        state.soundOn = false;
      }
    } catch (e) {
      state.soundOn = false;
      if (!audioErrorShown) {
        audioErrorShown = true;
        showWhisper('声音暂时没有醒来。请再试一次。', 2800);
      }
    }
    reflectSound();
  }

  function reflectSound() {
    if (els.soundBtn) els.soundBtn.setAttribute('aria-pressed', state.soundOn ? 'true' : 'false');
    if (els.soundLabel) els.soundLabel.textContent = state.soundOn ? '聆听中' : '聆听';
    document.body.classList.toggle('sound-on', state.soundOn);
    if (els.soundBtn) els.soundBtn.setAttribute('data-cursor', state.soundOn ? '静音' : '聆听');
  }

  /* ---------------- sleep / wake ---------------- */

  function setSleeping() {
    if (state.sleeping || state.finaleOpen) return;
    state.sleeping = true;
    state.lastActivity = performance.now();
    document.title = SLEEP_TITLE;
    document.body.classList.add('is-sleeping');
    if (els.hudStatus) els.hudStatus.classList.add('is-sleeping');
    if (els.dreamLine) els.dreamLine.textContent = '它梦见，你还在。';
    updateStatus();
    if (state.soundOn && audio) { try { audio.event('sleep'); } catch (e) { /* ignore */ } }
    showWhisper('它睡着了。动一动，唤醒它。', 6200);
  }

  function wakeUp() {
    if (!state.sleeping) return;
    state.sleeping = false;
    state.lastActivity = performance.now();
    state.attention = clamp(state.attention + 0.08, 0, 1);
    document.body.classList.remove('is-sleeping');
    if (els.hudStatus) els.hudStatus.classList.remove('is-sleeping');
    document.title = BASE_TITLE;
    if (els.dreamLine) els.dreamLine.textContent = '它梦见的，也许是雨落得很慢的地方。';
    if (life) life.pulse('wake');
    if (bg) { try { bg.flashWake(0.8); } catch (e) { /* ignore */ } }
    if (state.soundOn && audio) { try { audio.event('wake'); } catch (e) { /* ignore */ } }
    updateStatus();
    showWhisper('你回来了。', 2800);
  }

  function updateStatus() {
    if (!els.statusCn) return;
    els.statusCn.textContent = state.sleeping ? '土壤入梦' : '土壤苏醒';
    els.statusEn.textContent = state.sleeping ? 'SOIL DREAMING' : 'SOIL AWAKE';
    if (els.hudStatus) els.hudStatus.classList.toggle('is-sleeping', state.sleeping);
  }

  /* ---------------- finale ---------------- */

  function onSubmitSeed(e) {
    e.preventDefault();
    if (state.finaleOpen || !state.booted) return;
    const raw = (els.seedInput.value || '').trim();
    const chars = graphemes(raw);
    if (!raw) {
      els.seedError.textContent = '土还空着。写一个字吧。';
      els.seedInput.focus();
      return;
    }
    if (chars.length > 1) {
      els.seedError.textContent = '只要一个字。它会用尽全力，只长这一个。';
      els.seedInput.focus();
      return;
    }
    els.seedError.textContent = '';
    openFinale(chars[0]);
  }

  function openFinale(char) {
    activeChar = char;
    state.finaleOpen = true;
    state.sleeping = false;
    document.title = '息壤 · 已种下「' + char + '」';
    document.body.classList.remove('is-sleeping');
    document.body.classList.add('is-finale', 'is-locked');
    if (els.hudStatus) els.hudStatus.classList.remove('is-sleeping');
    lastFocused = document.activeElement;
    setBackgroundInert(true);

    const id = makeHash(char + Date.now() + Math.random().toString(36));
    const now = Date.now();
    const seed = { c: char, t: now, id: id };
    seeds.push(seed);
    if (seeds.length > 12) seeds = seeds.slice(-12);
    saveSeeds(seeds);
    setupLedger();
    sessionSeeds = sessionSeeds;
    const index = seeds.length;

    if (els.finaleId) els.finaleId.textContent = '№ ' + pad(index, 3);
    if (els.finaleIndex) els.finaleIndex.textContent = '第 ' + pad(index) + ' 粒种子';
    if (els.finaleHash) els.finaleHash.textContent = 'SEED 0x' + id.slice(0, 4);
    if (els.finaleTitle) els.finaleTitle.textContent = '「' + char + '」已种下。';
    if (els.finaleMeta) els.finaleMeta.textContent = 'SEED 0x' + id.slice(0, 4) + ' · ' + formatDate(now) + ' · 仅存于此设备';

    if (els.finaleDim) els.finaleDim.hidden = false;
    if (els.finale) els.finale.hidden = false;
    if (els.finale && !els.finale.contains(document.activeElement)) {
      // Defer focus until after the opening transition.
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (els.finaleDim) els.finaleDim.classList.add('is-open');
        if (els.finale) els.finale.classList.add('is-open');
        if (state.reduced) {
          showFinalFallback(char);
        } else if (glyph) {
          window.setTimeout(function () { placeFinaleGlyph(char); }, 420);
        }
      });
    });

    if (state.soundOn && audio) {
      try {
        if (typeof audio.event === 'function') audio.event('seed');
        if (typeof audio.chime === 'function') audio.chime(0);
      } catch (e) { /* ignore */ }
    }

    window.setTimeout(function () {
      if (els.closeFinale) els.closeFinale.focus({ preventScroll: true });
    }, 650);

    updateHUD(true);
    markActivity();
  }

  function placeFinaleGlyph(char) {
    if (!glyph || !els.sigil) return;
    const rect = els.sigil.getBoundingClientRect();
    if (!rect.width) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const fontPx = Math.min(rect.width * 0.46, window.innerHeight * 0.32);
    glyph.show(char, {
      x: cx,
      y: cy,
      fontPx: fontPx,
      maxWidth: rect.width * 0.72,
      maxHeight: rect.height * 0.64,
      maxCount: window.innerWidth < 700 ? 2200 : 3300,
      alphaScale: 0.72,
      from: 'scatter',
      maxGlyphs: 1
    });
  }

  function showFinalFallback(char) {
    if (!els.finale || !els.sigil) return;
    if (finalFallback) finalFallback.remove();
    const rect = els.sigil.getBoundingClientRect();
    finalFallback = document.createElement('div');
    finalFallback.className = 'finale-fallback-char';
    finalFallback.textContent = char;
    finalFallback.setAttribute('aria-hidden', 'true');
    finalFallback.style.left = (rect.left + rect.width / 2) + 'px';
    finalFallback.style.top = (rect.top + rect.height / 2) + 'px';
    finalFallback.style.fontSize = Math.min(rect.width * 0.44, window.innerHeight * 0.3) + 'px';
    els.finale.insertBefore(finalFallback, els.finale.querySelector('.finale-copy'));
  }

  function closeFinale(destination) {
    if (!state.finaleOpen) return;
    state.finaleOpen = false;
    document.title = BASE_TITLE;
    if (els.finale) els.finale.classList.remove('is-open');
    if (els.finaleDim) els.finaleDim.classList.remove('is-open');
    if (glyph && glyph.isActive()) {
      try { glyph.disperse({ dir: 'rise', strength: 0.9 }); } catch (e) { /* ignore */ }
    }
    if (finalFallback) { finalFallback.remove(); finalFallback = null; }

    window.setTimeout(function () {
      if (els.finale) els.finale.hidden = true;
      if (els.finaleDim) els.finaleDim.hidden = true;
      document.body.classList.remove('is-finale', 'is-locked');
      setBackgroundInert(false);
      if (glyph) glyph.hide();
      if (lastFocused && typeof lastFocused.focus === 'function') {
        try { lastFocused.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      }
      if (destination === 'again') {
        if (returnSection) returnSection.scrollIntoView({ behavior: state.reduced ? 'auto' : 'smooth', block: 'center' });
        if (els.seedInput) {
          els.seedInput.value = '';
          window.setTimeout(function () { els.seedInput.focus({ preventScroll: true }); }, 450);
        }
      } else if (destination === 'footer') {
        if (els.siteFoot) els.siteFoot.scrollIntoView({ behavior: state.reduced ? 'auto' : 'smooth', block: 'start' });
      }
      updateHUD(true);
    }, 900);
  }

  let modalBackground = null;
  function setBackgroundInert(on) {
    if (!modalBackground) {
      modalBackground = [
        document.getElementById('main'),
        document.querySelector('.hud'),
        document.querySelector('.chapter-rail'),
        document.getElementById('siteFoot'),
        document.querySelector('.skip-link')
      ].filter(Boolean);
    }
    modalBackground.forEach(function (el) {
      if (on) {
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('inert', '');
      } else {
        el.removeAttribute('aria-hidden');
        el.removeAttribute('inert');
      }
    });
  }

  function buildSigilTicks() {
    if (!els.sigilTicks) return;
    const NS = 'http://www.w3.org/2000/svg';
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 72; i++) {
      const angle = (i / 72) * TAU;
      const major = i % 6 === 0;
      const r1 = major ? 272 : 280;
      const r2 = 288;
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', String(300 + Math.cos(angle) * r1));
      line.setAttribute('y1', String(300 + Math.sin(angle) * r1));
      line.setAttribute('x2', String(300 + Math.cos(angle) * r2));
      line.setAttribute('y2', String(300 + Math.sin(angle) * r2));
      if (major) line.setAttribute('class', 'major');
      frag.appendChild(line);
    }
    els.sigilTicks.appendChild(frag);
  }

  /* ---------------- HUD / loop ---------------- */

  function updateHUD(force) {
    if (!state.booted) return;
    const now = performance.now();
    if (!force && now - lastHudAt < 150) return;
    lastHudAt = now;
    const metrics = life ? life.getMetrics() : { branches: 0, mycelium: 0, seeds: 0 };
    const sym = clamp(Math.round(state.mood * 100), 0, 99);
    const bpm = state.sleeping ? 3.6 : (5.8 + state.mood * 1.6 + state.hold * 3.8);
    const totalSeedCount = seeds.length + sessionSeeds;
    if (els.vitalSym) els.vitalSym.textContent = pad(sym);
    if (els.vitalMyc) els.vitalMyc.textContent = String(metrics.mycelium).padStart(4, '0');
    if (els.vitalBreath) els.vitalBreath.textContent = (bpm < 10 ? '0' : '') + bpm.toFixed(1);
    if (els.vitalSeeds) els.vitalSeeds.textContent = pad(totalSeedCount);
    if (els.breatheBpm) els.breatheBpm.textContent = (bpm < 10 ? '0' : '') + bpm.toFixed(1);
    if (els.breatheSym) els.breatheSym.textContent = pad(sym);
    if (els.seedCount) els.seedCount.textContent = pad(sessionSeeds);
    if (els.returnedCount) els.returnedCount.textContent = pad(returnBonus);
    if (els.sleepText) {
      const idle = Math.max(0, Math.floor((now - state.lastActivity) / 1000));
      const label = state.sleeping ? '入梦 ' : '静息 ';
      els.sleepText.textContent = label + pad(Math.floor(idle / 60)) + ':' + pad(idle % 60);
    }
    // ring UI
    if (els.ringValue) {
      els.ringValue.style.strokeDashoffset = (590.6 * (1 - clamp(holdCharge, 0, 1))).toFixed(1);
    }
    if (els.holdPct) els.holdPct.textContent = pad(Math.round(holdCharge * 100)) + '%';
    if (holdActive) {
      els.holdState.textContent = '吸气';
      els.holdCaption.textContent = holdCharge > 0.99 ? '满息 · 光已经住进来了。' : '吸气 · 它的菌丝正在发亮。';
    } else if (holdCharge > 0.02 && now - holdReleasedAt < 1200) {
      els.holdState.textContent = '呼气';
      els.holdCaption.textContent = '呼气 · 它把光还给你。';
    } else if (!holdActive) {
      els.holdState.textContent = '静息';
      els.holdCaption.textContent = finePointer ? '按住 · 直到它呼出一片光' : '按住 · 感受它吸气';
    }
    if (els.debug && !els.debug.hidden) {
      els.debugBranches.textContent = metrics.branches + ' branches';
      els.debugMode.textContent = state.sleeping ? 'dream' : (state.soundOn ? 'sound on' : 'sound off');
    }
  }

  function updateDebug() {
    if (!debugMode) return;
    els.debugFps.textContent = Math.round(fpsValue) + ' FPS';
  }

  function updateCursor(dt) {
    if (!finePointer || !els.cursor || state.reduced) return;
    const k = 1 - Math.exp(-dt * 15);
    cursorRing.x += (cursorTarget.x - cursorRing.x) * k;
    cursorRing.y += (cursorTarget.y - cursorRing.y) * k;
    els.cursor.style.transform = 'translate3d(' + cursorTarget.x + 'px,' + cursorTarget.y + 'px,0)';
    const ring = els.cursor.querySelector('.cursor-ring');
    if (ring) {
      const dx = cursorRing.x - cursorTarget.x;
      const dy = cursorRing.y - cursorTarget.y;
      ring.style.transform = 'translate(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px) translate(-50%,-50%)';
    }
  }

  function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (document.hidden) { frameLast = now; return; }
    const dt = Math.min(0.05, Math.max(0.001, (now - frameLast) / 1000));
    frameLast = now;
    state.time = now / 1000;

    if (state.booted) {
      // attention slowly evaporates; presence charges it.
      const idleMs = now - state.lastActivity;
      if (idleMs > 1400) state.attention = clamp(state.attention - dt * 0.012, 0, 1);
      if (state.pointer.down) state.attention = clamp(state.attention + dt * 0.06, 0, 1);
      if (holdActive) {
        holdCharge = Math.min(1, holdCharge + dt * 0.33);
        state.attention = clamp(state.attention + dt * 0.045, 0, 1);
        if (holdCharge > 0.995) {
          if (!fullBloomFired) {
            fullBloomFired = true;
            if (life) life.fullBloom();
            if (state.soundOn && audio) {
              try { audio.chime(0); } catch (e) { /* ignore */ }
            }
          }
          if (now - lastHoldBloom > 2100) {
            lastHoldBloom = now;
            if (life) life.tipBloom(4);
          }
        }
      } else {
        fullBloomFired = false;
        holdCharge = Math.max(0, holdCharge - dt * 0.42);
      }
      state.hold += ((holdActive ? 1 : 0) - state.hold) * Math.min(1, dt * (holdActive ? 3.4 : 2.2));
      state.sleep += ((state.sleeping ? 1 : 0) - state.sleep) * Math.min(1, dt * 1.25);
      state.mood = clamp(0.23 + state.attention * 0.63 + state.hold * 0.2 - state.sleep * 0.1, 0.13, 1);

      if (state.interacted && !state.sleeping && !state.finaleOpen && !state.pointer.down && !document.hidden) {
        if (now - lastSleepCheck > 500) {
          lastSleepCheck = now;
          if (idleMs > 12000) setSleeping();
        }
      }

      if (now - lastAudioAt > 110 && state.soundOn && audio) {
        lastAudioAt = now;
        try {
          if (typeof audio.setMood === 'function') audio.setMood(state.mood * (1 - state.sleep * 0.65));
          if (typeof audio.setBreath === 'function') audio.setBreath(state.hold);
        } catch (e) { /* ignore */ }
      }
    } else {
      // Boot breathing: attention is low, the soil is still waking.
      state.mood = 0.3 + Math.sin(now / 2400) * 0.03;
      state.hold *= 0.96;
    }

    // The soil breathes slowly; 30fps for the shader is plenty.
    if (bg && bg.ok) {
      bgAccum += dt;
      if (bgAccum >= 1 / 30) {
        bgAccum = 0;
        bg.setRoot(life ? life.rootXRatio : state.rootX, life ? life.rootYRatio : 0.94);
        bg.render(state);
      }
    }
    if (life) life.step(dt, state);
    if (glyph) glyph.update(dt, state);
    updateCursor(dt);
    updateHUD(false);

    // FPS sampling
    fpsFrames++;
    fpsAccum += dt;
    if (fpsAccum > 1) {
      fpsValue = fpsFrames / fpsAccum;
      fpsAccum = 0;
      fpsFrames = 0;
    }
  }

  function showWhisper(msg, duration) {
    if (!els.whisper) return;
    if (msg === lastWhisper && performance.now() - lastWhisperAt < 1500) return;
    lastWhisper = msg;
    lastWhisperAt = performance.now();
    els.whisper.textContent = msg;
    els.whisper.classList.add('is-show');
    clearTimeout(whisperTimer);
    whisperTimer = setTimeout(function () {
      els.whisper.classList.remove('is-show');
    }, duration || 2600);
  }

  function onResize() {
    clearTimeout(onResize._timer);
    onResize._timer = setTimeout(function () {
      cacheSections();
      if (bg) bg.resize();
      if (life) life.resize();
      if (glyph && glyph.isActive()) {
        if (state.finaleOpen) placeFinaleGlyph(activeChar);
        else glyph.resize();
      }
      handleScroll();
      if (state.reduced) {
        if (life) life.render();
        if (bg) bg.render(state);
      }
    }, 160);
  }

  function onVisibility() {
    if (document.hidden) {
      saveLastVisit();
    } else {
      frameLast = performance.now();
      if (state.reduced && bg) bg.render(state);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
