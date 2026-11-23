(() => {
  'use strict';

  const api = (typeof window !== 'undefined' && window.IponProfileEffects)
    || (typeof globalThis !== 'undefined' && globalThis.IponProfileEffects);
  if (!api || typeof api.registerEffect !== 'function' || !api._H) return;

  const { TAU, frac, glow, star4, pathMetrics, samplePath } = api._H;

  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (x) => { const t = clamp(x); return t * t * (3 - 2 * t); };
  const easeOutCubic = (x) => { const t = clamp(x); return 1 - Math.pow(1 - t, 3); };
  const easeOutExpo = (x) => { const t = clamp(x); return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); };
  const easeInOutQuint = (x) => {
    const t = clamp(x);
    return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
  };
  const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * Math.max(0.001, dt)));
  const seed = (i, salt) => frac(Math.sin(i * 127.1 + salt * 311.7) * 43758.5453123);

  // Unified studio top-left key-light shadow vector (matching Manifestation & Vanish & Reform)
  const L_DX = 0.58;
  const L_DY = 0.81;

  // Theme-harmonized Celestial Titanium & Cryo-Champagne holographic palettes
  const PALETTES = Object.freeze({
    mono:     { accent: '136,214,255', deep: '52,102,168',  gold: '243,211,140', prism: '164,148,255', shade: '16,28,48' },
    emerald:  { accent: '108,236,196', deep: '28,118,92',   gold: '243,211,140', prism: '126,204,255', shade: '12,34,28' },
    midnight: { accent: '142,178,255', deep: '64,82,204',   gold: '243,211,140', prism: '188,144,255', shade: '16,20,52' },
    rose:     { accent: '242,162,202', deep: '146,48,96',   gold: '246,216,150', prism: '166,184,255', shade: '44,16,32' },
    amber:    { accent: '248,208,128', deep: '154,96,30',   gold: '255,232,174', prism: '140,206,255', shade: '42,26,12' },
    ocean:    { accent: '112,222,255', deep: '24,110,160',  gold: '243,211,140', prism: '146,162,255', shade: '12,30,46' }
  });

  function getPalette(host) {
    const key = String(host?.dataset?.theme || host?.dataset?.cardTheme || 'mono').trim().toLowerCase();
    return PALETTES[key] || PALETTES.mono;
  }

  function pickRgb(hue, pal) {
    return hue === 'gold' ? pal.gold
      : hue === 'prism' ? pal.prism
        : hue === 'white' ? '242,248,255'
          : pal.accent;
  }

  function setVar(host, name, value) {
    if (host?.style && typeof host.style.setProperty === 'function') {
      host.style.setProperty(name, value);
    }
  }

  // Smooth C1 lifecycle envelope: guaranteed 0 at p=0 and p=1 (zero wrap pops!)
  function loopEnvelope(p, margin = 0.16) {
    const u = clamp(p);
    return smooth(u / margin) * (1 - smooth((u - (1 - margin)) / margin));
  }

  function buildRoundedFrame(W, H, inset, rad) {
    const x0 = inset;
    const y0 = inset;
    const x1 = Math.max(x0 + 8, W - inset);
    const y1 = Math.max(y0 + 8, H - inset);
    const r = Math.max(3, Math.min(rad, (x1 - x0) * 0.2, (y1 - y0) * 0.2));
    const pts = [];
    const arc = (cx0, cy0, a0, a1) => {
      for (let i = 0; i <= 5; i += 1) {
        const a = a0 + (i / 5) * (a1 - a0);
        pts.push([cx0 + Math.cos(a) * r, cy0 + Math.sin(a) * r]);
      }
    };
    arc(x1 - r, y0 + r, -Math.PI / 2, 0);
    arc(x1 - r, y1 - r, 0, Math.PI / 2);
    arc(x0 + r, y1 - r, Math.PI / 2, Math.PI);
    arc(x0 + r, y0 + r, Math.PI, Math.PI * 1.5);
    return pathMetrics(pts, true);
  }

  function drawPerimeterComet(g, m, headU, span, rgb, width, alpha, steps = 20) {
    if (!m || alpha <= 0.01) return;
    g.save();
    g.lineCap = 'round';
    let prev = null;
    for (let i = 0; i <= steps; i += 1) {
      const k = i / steps;
      const p = samplePath(m, headU - span * (1 - k));
      if (prev) {
        g.strokeStyle = `rgba(${rgb},${(alpha * k * k * 0.9).toFixed(3)})`;
        g.lineWidth = Math.max(0.55, width * (0.25 + 0.75 * k));
        g.beginPath();
        g.moveTo(prev[0], prev[1]);
        g.lineTo(p[0], p[1]);
        g.stroke();
      }
      prev = p;
    }
    const head = samplePath(m, headU);
    glow(g, head[0], head[1], width * 4.8, rgb, alpha * 0.72);
    g.fillStyle = `rgba(255,253,246,${clamp(alpha).toFixed(3)})`;
    g.beginPath();
    g.arc(head[0], head[1], Math.max(0.95, width * 0.68), 0, TAU);
    g.fill();
    g.restore();
  }

  function drawStarGlint(g, x, y, r, fill, alpha) {
    if (r <= 0.25 || alpha <= 0.01) return;
    g.save();
    g.globalAlpha = clamp(alpha);
    g.fillStyle = fill;
    star4(g, x, y, r);
    g.restore();
  }

  // =========================================================================
  // DIMENSIONAL 3D LIGHTING & SHADOW PRIMITIVES
  // Cast soft directional shadows along (L_DX, L_DY), render two-plane lit
  // vs. shaded metallic faces, and crisp top-left specular catchlights.
  // =========================================================================
  function drawFacetedCrystal(g, x, y, sz, rot, rgb, pal, alpha, depth, s) {
    if (sz <= 0.4 || alpha <= 0.015) return;
    const w = sz * 0.62;
    const h = sz * 1.08;
    const shOff = (1.6 + depth * 1.9) * s;

    // 1. Directional soft cast shadow following crystal position & rotation
    g.save();
    g.translate(x + L_DX * shOff, y + L_DY * shOff);
    g.rotate(rot);
    g.globalAlpha = clamp(alpha * 0.44);
    g.fillStyle = 'rgba(2,6,14,0.88)';
    g.beginPath();
    g.moveTo(0, -h * 1.04);
    g.lineTo(w * 1.04, 0);
    g.lineTo(0, h * 0.94);
    g.lineTo(-w * 1.04, 0);
    g.closePath();
    g.fill();
    g.restore();

    // 2. Sculpted 2-plane metallic crystal (lit key facet + shadowed underside + specular crest)
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.globalAlpha = clamp(alpha);

    const litG = g.createLinearGradient(-w, -h, w * 0.2, h * 0.4);
    litG.addColorStop(0, 'rgba(255,253,246,0.96)');
    litG.addColorStop(0.55, `rgba(${rgb},0.88)`);
    litG.addColorStop(1, `rgba(${pal.deep},0.82)`);
    g.fillStyle = litG;
    g.beginPath();
    g.moveTo(0, -h);
    g.lineTo(0, h * 0.9);
    g.lineTo(-w, 0);
    g.closePath();
    g.fill();

    const shadeG = g.createLinearGradient(0, -h, w, h);
    shadeG.addColorStop(0, `rgba(${rgb},0.62)`);
    shadeG.addColorStop(0.55, `rgba(${pal.shade},0.88)`);
    shadeG.addColorStop(1, 'rgba(6,11,22,0.92)');
    g.fillStyle = shadeG;
    g.beginPath();
    g.moveTo(0, -h);
    g.lineTo(w, 0);
    g.lineTo(0, h * 0.9);
    g.closePath();
    g.fill();

    // Specular ridge catchlight along upper-left bevel & spine
    g.strokeStyle = 'rgba(255,254,248,0.78)';
    g.lineWidth = Math.max(0.45, 0.62 * s);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-w * 0.85, -h * 0.08);
    g.lineTo(0, -h);
    g.lineTo(0, h * 0.35);
    g.stroke();
    g.restore();
  }

  // 3D-foreshortened miniature orbital astrolabe glyph with cast shadow & satellite bead
  function drawTiltingGlyph(g, x, y, r, rot, tilt, orbAng, rgb, goldRgb, alpha, s) {
    if (r <= 1 || alpha <= 0.015) return;
    const ry = Math.max(1.2, r * clamp(tilt, 0.34, 0.88));
    const shOff = 1.6 * s;

    // Soft cast shadow ellipse
    g.save();
    g.translate(x + L_DX * shOff, y + L_DY * shOff);
    g.rotate(rot);
    g.strokeStyle = `rgba(2,6,14,${(alpha * 0.42).toFixed(3)})`;
    g.lineWidth = Math.max(1.0, 1.8 * s);
    g.beginPath();
    g.ellipse(0, 0, r, ry, 0, 0, TAU);
    g.stroke();
    g.restore();

    // Brushed metallic orbital ellipse + subtle highlight arc
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    const rg = g.createLinearGradient(-r, -ry, r, ry);
    rg.addColorStop(0, `rgba(255,253,246,${(alpha * 0.86).toFixed(3)})`);
    rg.addColorStop(0.45, `rgba(${rgb},${(alpha * 0.54).toFixed(3)})`);
    rg.addColorStop(1, `rgba(${goldRgb},${(alpha * 0.38).toFixed(3)})`);
    g.strokeStyle = rg;
    g.lineWidth = Math.max(0.65, 0.92 * s);
    g.beginPath();
    g.ellipse(0, 0, r, ry, 0, 0, TAU);
    g.stroke();

    // Tiny orbital satellite node riding the tilted ellipse
    const bx = Math.cos(orbAng) * r;
    const by = Math.sin(orbAng) * ry;
    g.fillStyle = `rgba(255,252,240,${clamp(alpha * 0.95).toFixed(3)})`;
    g.beginPath();
    g.arc(bx, by, Math.max(0.75, 1.15 * s), 0, TAU);
    g.fill();
    g.restore();

    // Subtle soft bloom around satellite in world space
    const cR = Math.cos(rot);
    const sR = Math.sin(rot);
    const lx = Math.cos(orbAng) * r;
    const ly = Math.sin(orbAng) * ry;
    glow(g, x + lx * cR - ly * sR, y + lx * sR + ly * cR, 3.8 * s, goldRgb, alpha * 0.55);
  }

  // Manifestation-inspired volumetric holographic optical scan curtain + micro-grid wake
  function drawVolumetricScanCurtain(b, f, W, H, scanY, curtainH, vis, pal, s) {
    if (vis <= 0.01) return;
    const cg = f.createLinearGradient(0, scanY - curtainH, 0, scanY + 6 * s);
    cg.addColorStop(0, `rgba(${pal.accent},0)`);
    cg.addColorStop(0.72, `rgba(${pal.accent},${(0.11 * vis).toFixed(3)})`);
    cg.addColorStop(0.94, `rgba(${pal.gold},${(0.22 * vis).toFixed(3)})`);
    cg.addColorStop(1, 'rgba(255,253,245,0)');
    f.save();
    f.fillStyle = cg;
    f.fillRect(4 * s, scanY - curtainH, Math.max(0, W - 8 * s), curtainH + 6 * s);

    // Fine optical scan filament with subtle shadow line behind it
    f.strokeStyle = `rgba(2,6,14,${(0.35 * vis).toFixed(3)})`;
    f.lineWidth = 2.6 * s;
    f.beginPath();
    f.moveTo(7 * s, scanY + 1.2 * s);
    f.lineTo(W - 7 * s, scanY + 1.2 * s);
    f.stroke();

    const lg = f.createLinearGradient(6 * s, scanY, W - 6 * s, scanY);
    lg.addColorStop(0, `rgba(${pal.accent},0)`);
    lg.addColorStop(0.18, `rgba(${pal.accent},${(0.82 * vis).toFixed(3)})`);
    lg.addColorStop(0.5, `rgba(255,252,240,${(0.95 * vis).toFixed(3)})`);
    lg.addColorStop(0.82, `rgba(${pal.gold},${(0.8 * vis).toFixed(3)})`);
    lg.addColorStop(1, `rgba(${pal.accent},0)`);
    f.strokeStyle = lg;
    f.lineWidth = 1.65 * s;
    f.beginPath();
    f.moveTo(6 * s, scanY);
    f.lineTo(W - 6 * s, scanY);
    f.stroke();
    f.restore();

    // Subtle horizontal optical refraction mesh revealed ONLY inside the trailing curtain
    b.save();
    b.strokeStyle = `rgba(${pal.accent},${(0.08 * vis).toFixed(3)})`;
    b.lineWidth = 0.7 * s;
    const step = Math.max(8, Math.round(10 * s));
    const yStart = Math.max(8 * s, Math.floor((scanY - curtainH * 0.85) / step) * step);
    const yEnd = Math.min(H - 8 * s, scanY);
    for (let gy = yStart; gy < yEnd; gy += step) {
      b.beginPath();
      b.moveTo(10 * s, gy);
      b.lineTo(W - 10 * s, gy);
      b.stroke();
    }
    b.restore();
  }

  // Vanish & Reform-inspired diagonal quantum phase optical front line
  function drawDiagonalPhaseFront(f, W, H, progress, alpha, pal, s) {
    if (alpha <= 0.015) return;
    const lineY = lerp(H + 22 * s, -22 * s, progress);
    const tilt = 36 * s;
    const lg = f.createLinearGradient(0, lineY + tilt, W, lineY - tilt);
    lg.addColorStop(0, `rgba(${pal.accent},0)`);
    lg.addColorStop(0.24, `rgba(${pal.accent},${(0.74 * alpha).toFixed(3)})`);
    lg.addColorStop(0.54, `rgba(255,251,238,${(0.94 * alpha).toFixed(3)})`);
    lg.addColorStop(0.8, `rgba(${pal.gold},${(0.76 * alpha).toFixed(3)})`);
    lg.addColorStop(1, `rgba(${pal.prism},0)`);

    f.save();
    // Soft trailing ribbon bloom
    f.strokeStyle = `rgba(${pal.accent},${(0.16 * alpha).toFixed(3)})`;
    f.lineWidth = 9.0 * s;
    f.beginPath();
    f.moveTo(0, lineY + tilt);
    f.lineTo(W, lineY - tilt);
    f.stroke();

    // Razor optical phase filament
    f.strokeStyle = lg;
    f.lineWidth = 1.75 * s;
    f.beginPath();
    f.moveTo(0, lineY + tilt);
    f.lineTo(W, lineY - tilt);
    f.stroke();

    // Subtle secondary echo filament
    f.strokeStyle = `rgba(${pal.prism},${(0.32 * alpha).toFixed(3)})`;
    f.lineWidth = 0.8 * s;
    f.beginPath();
    f.moveTo(0, lineY + tilt + 6 * s);
    f.lineTo(W, lineY - tilt + 6 * s);
    f.stroke();
    f.restore();
  }

  function measureHostZones(host, W, H, cx, cy, ra) {
    const fallback = {
      bannerH: Math.min(108, H * 0.28),
      badgeX: Math.min(W - 34, cx + ra * 4.6),
      badgeY: Math.min(H * 0.56, cy + ra * 1.48),
      groupsRect: {
        x: Math.max(14, W * 0.065),
        y: Math.max(cy + ra * 2.4, H - 84),
        w: Math.max(60, W * 0.87),
        h: Math.min(62, Math.max(40, H * 0.16))
      }
    };
    if (!host || typeof host.getBoundingClientRect !== 'function' || typeof host.querySelector !== 'function') {
      return fallback;
    }
    const hr = host.getBoundingClientRect();
    if (!hr || !hr.width || !hr.height) return fallback;

    const bannerEl = host.querySelector('.effects-banner');
    if (bannerEl && typeof bannerEl.getBoundingClientRect === 'function') {
      const br = bannerEl.getBoundingClientRect();
      if (br.height > 16) fallback.bannerH = clamp(br.height, 40, H * 0.5);
    }

    const badgeEl = host.querySelector('.verified-badges-inline, .effects-card-name');
    if (badgeEl && typeof badgeEl.getBoundingClientRect === 'function') {
      const br = badgeEl.getBoundingClientRect();
      if (br.width > 4 && br.height > 4) {
        const isInlineBadge = badgeEl.classList?.contains?.('verified-badges-inline');
        fallback.badgeX = clamp(
          isInlineBadge ? (br.left - hr.left + br.width * 0.5) : (br.right - hr.left - 14),
          20,
          W - 18
        );
        fallback.badgeY = clamp(br.top - hr.top + br.height * 0.5, 24, H - 24);
      }
    }

    const grpEl = host.querySelector('.effects-card-groups');
    if (grpEl && typeof grpEl.getBoundingClientRect === 'function') {
      const gr = grpEl.getBoundingClientRect();
      if (gr.width > 30 && gr.height > 20) {
        fallback.groupsRect = {
          x: clamp(gr.left - hr.left, 6, W - 36),
          y: clamp(gr.top - hr.top, 40, H - 24),
          w: clamp(gr.width, 30, W - 12),
          h: clamp(gr.height, 20, H * 0.45)
        };
      }
    }
    return fallback;
  }

  // =========================================================================
  // FULL-SCREEN VIEWPORT CINEMATIC OVERLAY ENGINE
  // Renders the 2 full-screen cinematics ('awakening' & 'entrance') with
  // curated, dimensional lighting, shadows, sculpted 3D facets, and graceful
  // fade-to-zero auto-unmount (zero permanent obstruction or leaks).
  // =========================================================================
  function createFullscreenCinema(host, kind, pal) {
    if (typeof document === 'undefined') return null;
    const vw = Math.max(320, (typeof window !== 'undefined' && window.innerWidth) || 1280);
    const vh = Math.max(320, (typeof window !== 'undefined' && window.innerHeight) || 720);
    const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);

    const canvas = document.createElement('canvas');
    canvas.className = 'pfx-cinema-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    const g = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!g) return null;

    const mountRoot = (host && typeof host.closest === 'function' && host.closest('dialog[open]'))
      || document.body;
    if (mountRoot && typeof mountRoot.appendChild === 'function') {
      mountRoot.appendChild(canvas);
    }

    const getOrigin = () => {
      if (host && typeof host.getBoundingClientRect === 'function') {
        const av = typeof host.querySelector === 'function'
          ? host.querySelector('.effects-card-avatar, .avatar-circle, .avatar')
          : null;
        const rect = (av && typeof av.getBoundingClientRect === 'function' && av.getBoundingClientRect().width > 0)
          ? av.getBoundingClientRect()
          : host.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
        }
      }
      return { x: vw * 0.5, y: vh * 0.42 };
    };

    const diag = Math.hypot(vw, vh);
    const dur = kind === 'entrance' ? 5.6 : 5.2;
    let elapsed = 0;
    let alive = true;
    const isAwakening = kind === 'awakening';

    // Curated, varied full-screen pools (quality over cluttered quantity)
    const awakeningRibbons = isAwakening ? Array.from({ length: 12 }, (_, i) => ({
      baseAng: (i / 12) * TAU + seed(i, 307) * 0.22,
      curve: (i % 2 ? 1 : -1) * (0.42 + seed(i, 311) * 0.48),
      delay: seed(i, 317) * 0.14,
      width: 1.5 + seed(i, 331) * 2.1,
      hue: i % 3 === 0 ? 'gold' : i % 4 === 0 ? 'prism' : 'accent'
    })) : [];

    const awakeningArtifacts = isAwakening ? Array.from({ length: 56 }, (_, i) => {
      const ang = seed(i, 337) * TAU;
      const depth = 0.35 + seed(i, 347) * 0.65;
      return {
        ang,
        rad: 22 + seed(i, 349) * 34,
        vRad: (110 + seed(i, 353) * (diag * 0.2)) * depth,
        vAng: (i % 2 ? 1 : -1) * (0.28 + seed(i, 359) * 0.65),
        rot: seed(i, 361) * TAU,
        spin: (i % 2 ? 1 : -1) * (1.2 + seed(i, 365) * 2.4),
        size: (1.8 + seed(i, 367) * 3.4) * depth,
        depth,
        crystal: i % 3 === 0,
        delay: 0.12 + seed(i, 373) * 0.24,
        hue: i % 4 === 0 ? 'gold' : i % 6 === 0 ? 'prism' : i % 3 === 0 ? 'white' : 'accent'
      };
    }) : [];

    const entranceComets = !isAwakening ? Array.from({ length: 8 }, (_, i) => {
      const corner = i % 4;
      const sx = corner === 0 || corner === 3 ? -40 : vw + 40;
      const sy = corner < 2 ? -40 : vh + 40;
      return {
        sx: sx + (seed(i, 379) - 0.5) * vw * 0.28,
        sy: sy + (seed(i, 383) - 0.5) * vh * 0.28,
        ctrlOff: (i % 2 ? 1 : -1) * (95 + seed(i, 389) * 145),
        delay: seed(i, 397) * 0.14,
        width: 1.7 + seed(i, 401) * 1.6,
        hue: i % 2 === 0 ? 'gold' : 'accent'
      };
    }) : [];

    const entranceCrystals = !isAwakening ? Array.from({ length: 64 }, (_, i) => {
      const depth = 0.32 + seed(i, 409) * 0.68;
      return {
        x: seed(i, 419) * vw,
        p: seed(i, 421),
        vx: (seed(i, 431) - 0.5) * 44 * depth,
        speed: (0.14 + seed(i, 433) * 0.22) * depth,
        rot: seed(i, 439) * TAU,
        spin: (i % 2 ? 1 : -1) * (1.2 + seed(i, 443) * 2.6),
        size: (2.2 + seed(i, 449) * 3.8) * depth,
        depth,
        star: i % 4 === 0,
        hue: i % 2 === 0 ? 'gold' : i % 5 === 0 ? 'prism' : 'accent'
      };
    }) : [];

    let ringSpin = 0;

    function step(dt) {
      if (!alive) return false;
      const safeDt = Math.min(0.05, Math.max(0.001, dt));
      elapsed += safeDt;
      const u = clamp(elapsed / dur);
      if (u >= 1) {
        destroy();
        return false;
      }

      const curW = Math.max(320, (typeof window !== 'undefined' && window.innerWidth) || vw);
      const curH = Math.max(320, (typeof window !== 'undefined' && window.innerHeight) || vh);
      if (Math.abs(canvas.width - Math.round(curW * dpr)) > 2 || Math.abs(canvas.height - Math.round(curH * dpr)) > 2) {
        canvas.width = Math.round(curW * dpr);
        canvas.height = Math.round(curH * dpr);
      }

      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, curW, curH);

      const { x: ox, y: oy } = getOrigin();
      const maxR = Math.hypot(Math.max(ox, curW - ox), Math.max(oy, curH - oy)) * 1.12;
      const envIn = smooth(u / 0.14);
      const envOut = 1 - smooth((u - 0.72) / 0.28);
      const masterA = envIn * envOut;

      // Refined peripheral atmospheric depth vignette (keeps profile crisp & luminous)
      const vig = g.createRadialGradient(ox, oy, Math.min(curW, curH) * 0.18, ox, oy, maxR);
      vig.addColorStop(0, 'rgba(4,8,16,0)');
      vig.addColorStop(0.56, `rgba(4,10,22,${(0.12 * masterA).toFixed(3)})`);
      vig.addColorStop(1, `rgba(2,5,13,${(0.38 * masterA).toFixed(3)})`);
      g.fillStyle = vig;
      g.fillRect(0, 0, curW, curH);

      ringSpin += safeDt * (0.24 + Math.sin(u * Math.PI) * 0.42);

      if (isAwakening) {
        // ===================================================================
        // FULL-SCREEN CINEMATIC A — ENERGY AWAKENING
        // ===================================================================
        // 1. Curved magnetic intake filaments converging smoothly into profile (0.0 -> 0.30)
        if (u < 0.32) {
          const pull = smooth(u / 0.24);
          const pullVis = Math.sin(clamp(u / 0.32) * Math.PI);
          g.save();
          g.lineCap = 'round';
          for (let i = 0; i < 8; i += 1) {
            const ang = (i / 8) * TAU + ringSpin * 0.9;
            const r0 = lerp(maxR * 0.78, 38, easeInOutQuint(pull));
            const r1 = lerp(maxR * 0.46, 20, easeInOutQuint(pull));
            const x0 = ox + Math.cos(ang) * r0;
            const y0 = oy + Math.sin(ang) * r0;
            const cpx = ox + Math.cos(ang + 0.42) * ((r0 + r1) * 0.54);
            const cpy = oy + Math.sin(ang + 0.42) * ((r0 + r1) * 0.54);
            const x1 = ox + Math.cos(ang + 0.18) * r1;
            const y1 = oy + Math.sin(ang + 0.18) * r1;
            const rgb = i % 2 === 0 ? pal.accent : pal.gold;
            const lg = g.createLinearGradient(x0, y0, x1, y1);
            lg.addColorStop(0, `rgba(${rgb},0)`);
            lg.addColorStop(1, `rgba(${rgb},${(pullVis * 0.62).toFixed(3)})`);
            g.strokeStyle = lg;
            g.lineWidth = 1.9;
            g.beginPath();
            g.moveTo(x0, y0);
            g.quadraticCurveTo(cpx, cpy, x1, y1);
            g.stroke();
          }
          g.restore();
        }

        // 2. Dimensional 3D Astrolabe Meridians + 3 Layered Refraction Shockwaves
        const waves = [
          { start: 0.18, span: 0.56, rgb: pal.accent, w: 2.6, a: 0.68 },
          { start: 0.28, span: 0.54, rgb: pal.gold,   w: 2.0, a: 0.62 },
          { start: 0.39, span: 0.50, rgb: pal.prism,  w: 1.5, a: 0.48 }
        ];
        g.save();
        for (const wv of waves) {
          const ku = clamp((u - wv.start) / wv.span);
          if (ku <= 0 || ku >= 1) continue;
          const r = lerp(30, maxR * 0.98, easeOutCubic(ku));
          const al = Math.sin(ku * Math.PI) * wv.a * envOut;
          // Recessed shadow halo + crisp specular crest
          g.strokeStyle = `rgba(2,6,14,${(al * 0.36).toFixed(3)})`;
          g.lineWidth = wv.w * 3.8;
          g.beginPath();
          g.arc(ox + L_DX * 2.5, oy + L_DY * 2.5, Math.max(4, r), 0, TAU);
          g.stroke();
          g.strokeStyle = `rgba(${wv.rgb},${(al * 0.24).toFixed(3)})`;
          g.lineWidth = wv.w * 4.5;
          g.beginPath();
          g.arc(ox, oy, Math.max(4, r), 0, TAU);
          g.stroke();
          g.strokeStyle = `rgba(${wv.rgb},${al.toFixed(3)})`;
          g.lineWidth = wv.w;
          g.beginPath();
          g.arc(ox, oy, Math.max(4, r), 0, TAU);
          g.stroke();
        }
        g.restore();

        // 3. 12 Curated Sweeping Aurora Silk Trails (tapered gradients + soft luminous heads)
        for (let i = 0; i < awakeningRibbons.length; i += 1) {
          const rb = awakeningRibbons[i];
          const ru = clamp((u - (0.17 + rb.delay)) / 0.64);
          if (ru <= 0 || ru >= 1) continue;
          const headR = lerp(32, maxR * 1.02, easeOutExpo(ru));
          const tailR = lerp(20, maxR * 0.68, easeOutCubic(Math.max(0, ru - 0.18)));
          const al = Math.sin(ru * Math.PI) * 0.7 * envOut;
          const angHead = rb.baseAng + rb.curve * ru;
          const angMid = rb.baseAng + rb.curve * ru * 0.55;
          const angTail = rb.baseAng + rb.curve * Math.max(0, ru - 0.18);
          const x0 = ox + Math.cos(angTail) * tailR;
          const y0 = oy + Math.sin(angTail) * tailR;
          const cxp = ox + Math.cos(angMid) * ((headR + tailR) * 0.52);
          const cyp = oy + Math.sin(angMid) * ((headR + tailR) * 0.52);
          const x1 = ox + Math.cos(angHead) * headR;
          const y1 = oy + Math.sin(angHead) * headR;
          const rgb = pickRgb(rb.hue, pal);
          if (Math.hypot(x1 - x0, y1 - y0) > 1) {
            const rg = g.createLinearGradient(x0, y0, x1, y1);
            rg.addColorStop(0, `rgba(${rgb},0)`);
            rg.addColorStop(0.74, `rgba(${rgb},${(al * 0.7).toFixed(3)})`);
            rg.addColorStop(1, `rgba(255,253,245,${al.toFixed(3)})`);
            g.save();
            g.strokeStyle = rg;
            g.lineWidth = rb.width;
            g.lineCap = 'round';
            g.beginPath();
            g.moveTo(x0, y0);
            g.quadraticCurveTo(cxp, cyp, x1, y1);
            g.stroke();
            g.restore();
            glow(g, x1, y1, rb.width * 4.8, rgb, al * 0.5);
          }
        }

        // 4. 56 Varied-Depth Sculpted 3D Prism Crystals & Bokeh Motes
        for (let i = 0; i < awakeningArtifacts.length; i += 1) {
          const m = awakeningArtifacts[i];
          if (u < m.delay) continue;
          const mu = clamp((u - m.delay) / (0.84 - m.delay * 0.45));
          const speedEase = Math.max(0.16, 1 - mu * 0.74);
          m.rad += safeDt * m.vRad * speedEase;
          m.ang += safeDt * m.vAng * speedEase;
          m.rot += safeDt * m.spin * speedEase;
          const px = ox + Math.cos(m.ang) * m.rad;
          const py = oy + Math.sin(m.ang) * m.rad;
          const al = Math.sin(clamp(mu) * Math.PI) * 0.88 * envOut;
          if (al <= 0.015) continue;
          const rgb = pickRgb(m.hue, pal);
          if (m.crystal) {
            drawFacetedCrystal(g, px, py, m.size * 1.2, m.rot, rgb, pal, al, m.depth, 1.15);
          } else {
            glow(g, px, py, m.size * 3.4, rgb, al * 0.46);
            g.fillStyle = `rgba(255,253,248,${al.toFixed(3)})`;
            g.beginPath();
            g.arc(px, py, Math.max(0.7, m.size * 0.55), 0, TAU);
            g.fill();
          }
        }
      } else {
        // ===================================================================
        // FULL-SCREEN CINEMATIC B — LEGENDARY ENTRANCE
        // ===================================================================
        // 1. Twin Soft Volumetric Celestial Light Pillars (God-Rays)
        const pillarVis = Math.sin(clamp(u / 0.82) * Math.PI) * envOut;
        if (pillarVis > 0.01) {
          g.save();
          for (const side of [-1, 1]) {
            const topX = side === -1 ? curW * 0.16 : curW * 0.84;
            const beamG = g.createLinearGradient(topX, 0, ox, oy + curH * 0.25);
            beamG.addColorStop(0, `rgba(${side === -1 ? pal.accent : pal.gold},${(0.2 * pillarVis).toFixed(3)})`);
            beamG.addColorStop(0.55, `rgba(${pal.gold},${(0.07 * pillarVis).toFixed(3)})`);
            beamG.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = beamG;
            g.beginPath();
            g.moveTo(topX - curW * 0.08, 0);
            g.lineTo(topX + curW * 0.08, 0);
            g.lineTo(ox + side * 110, curH);
            g.lineTo(ox - side * 165, curH);
            g.closePath();
            g.fill();
          }
          g.restore();
        }

        // 2. Sculpted 3D Brushed-Titanium Celestial Astrolabe Reticle with Cast Shadow
        const ringAlpha = smooth(u / 0.22) * (1 - smooth((u - 0.66) / 0.34));
        if (ringAlpha > 0.01) {
          const baseRad = Math.min(curW, curH) * lerp(0.54, 0.33, easeOutExpo(clamp(u / 0.36)));
          g.save();
          g.lineCap = 'round';
          const gradTi = g.createLinearGradient(ox - baseRad, oy - baseRad, ox + baseRad, oy + baseRad);
          gradTi.addColorStop(0, `rgba(255,254,248,${(ringAlpha * 0.68).toFixed(3)})`);
          gradTi.addColorStop(0.42, `rgba(${pal.gold},${(ringAlpha * 0.44).toFixed(3)})`);
          gradTi.addColorStop(0.76, `rgba(${pal.accent},${(ringAlpha * 0.38).toFixed(3)})`);
          gradTi.addColorStop(1, `rgba(24,38,60,${(ringAlpha * 0.4).toFixed(3)})`);

          for (let i = 0; i < 4; i += 1) {
            const a0 = ringSpin + (i * TAU) / 4;
            g.strokeStyle = `rgba(2,6,14,${(ringAlpha * 0.38).toFixed(3)})`;
            g.lineWidth = 3.4;
            g.beginPath();
            g.arc(ox + L_DX * 2.2, oy + L_DY * 2.2, Math.max(12, baseRad * 1.16), a0, a0 + 1.02);
            g.stroke();

            g.strokeStyle = gradTi;
            g.lineWidth = 1.9;
            g.beginPath();
            g.arc(ox, oy, Math.max(12, baseRad * 1.16), a0, a0 + 1.02);
            g.stroke();
          }

          // Counter-rotating sapphire meridian & precision compass vernier ticks
          g.strokeStyle = `rgba(${pal.accent},${(ringAlpha * 0.34).toFixed(3)})`;
          g.lineWidth = 1.15;
          g.beginPath();
          g.arc(ox, oy, Math.max(10, baseRad * 0.88), -ringSpin * 1.25, -ringSpin * 1.25 + TAU * 0.82);
          g.stroke();
          for (let i = 0; i < 32; i += 1) {
            const a = -ringSpin * 0.75 + (i / 32) * TAU;
            const maj = i % 8 === 0;
            const r0 = baseRad * (maj ? 0.82 : 0.86);
            const r1 = baseRad * (maj ? 0.94 : 0.9);
            g.strokeStyle = `rgba(${maj ? pal.gold : pal.accent},${(ringAlpha * (maj ? 0.54 : 0.22)).toFixed(3)})`;
            g.lineWidth = maj ? 1.5 : 0.85;
            g.beginPath();
            g.moveTo(ox + Math.cos(a) * r0, oy + Math.sin(a) * r0);
            g.lineTo(ox + Math.cos(a) * r1, oy + Math.sin(a) * r1);
            g.stroke();
          }
          g.restore();
        }

        // 3. 8 Curated Hyperbolic Corner Comets converging cleanly on the Reveal Peak
        for (let i = 0; i < entranceComets.length; i += 1) {
          const mt = entranceComets[i];
          const mu = clamp((u - (0.04 + mt.delay)) / 0.28);
          if (mu <= 0 || mu >= 1) continue;
          const k = easeInOutQuint(mu);
          const kPrev = easeInOutQuint(Math.max(0, mu - 0.18));
          const cpx = (mt.sx + ox) * 0.5 + mt.ctrlOff;
          const cpy = (mt.sy + oy) * 0.5 - mt.ctrlOff * 0.4;
          const evalQ = (tVal) => {
            const inv = 1 - tVal;
            return [
              inv * inv * mt.sx + 2 * inv * tVal * cpx + tVal * tVal * ox,
              inv * inv * mt.sy + 2 * inv * tVal * cpy + tVal * tVal * oy
            ];
          };
          const [x1, y1] = evalQ(k);
          const [x0, y0] = evalQ(kPrev);
          const al = Math.sin(mu * Math.PI) * 0.86;
          const rgb = pickRgb(mt.hue, pal);
          if (Math.hypot(x1 - x0, y1 - y0) > 1) {
            const mg = g.createLinearGradient(x0, y0, x1, y1);
            mg.addColorStop(0, `rgba(${rgb},0)`);
            mg.addColorStop(1, `rgba(255,252,240,${al.toFixed(3)})`);
            g.save();
            g.strokeStyle = mg;
            g.lineWidth = mt.width;
            g.lineCap = 'round';
            g.beginPath();
            g.moveTo(x0, y0);
            g.lineTo(x1, y1);
            g.stroke();
            g.restore();
            glow(g, x1, y1, mt.width * 4.2, rgb, al * 0.6);
          }
        }

        // 4. Refined Champagne-Gold Anamorphic Optical Horizon Flare
        const flareU = clamp((u - 0.25) / 0.46);
        if (flareU > 0 && flareU < 1) {
          const flA = Math.sin(flareU * Math.PI) * envOut;
          const halfSpan = curW * lerp(0.16, 0.66, easeOutExpo(flareU));
          const fg = g.createLinearGradient(ox - halfSpan, oy, ox + halfSpan, oy);
          fg.addColorStop(0, `rgba(${pal.accent},0)`);
          fg.addColorStop(0.28, `rgba(${pal.accent},${(0.4 * flA).toFixed(3)})`);
          fg.addColorStop(0.5, `rgba(255,252,240,${(0.88 * flA).toFixed(3)})`);
          fg.addColorStop(0.72, `rgba(${pal.gold},${(0.46 * flA).toFixed(3)})`);
          fg.addColorStop(1, `rgba(${pal.gold},0)`);

          g.save();
          g.fillStyle = fg;
          g.globalAlpha = 0.46 * flA;
          g.fillRect(ox - halfSpan, oy - 6 * flA, halfSpan * 2, 12 * flA);
          g.globalAlpha = 1;
          g.strokeStyle = fg;
          g.lineWidth = 2.0;
          g.beginPath();
          g.moveTo(ox - halfSpan, oy);
          g.lineTo(ox + halfSpan, oy);
          g.stroke();
          g.restore();

          glow(g, ox, oy, 98 * flA, pal.gold, 0.48 * flA);
          drawStarGlint(g, ox, oy, 36 * flA, '#fffdf5', 0.82 * flA);
        }

        // 5. 64 Varied-Depth Descending 3D Faceted Crystals & Starlight Glints (smooth loopEnvelope, zero pop!)
        if (u > 0.22) {
          const rainA = smooth((u - 0.22) / 0.14) * envOut;
          for (let i = 0; i < entranceCrystals.length; i += 1) {
            const sh = entranceCrystals[i];
            sh.p = frac(sh.p + safeDt * sh.speed);
            sh.x += safeDt * sh.vx;
            if (sh.x < -20) sh.x += curW + 40;
            else if (sh.x > curW + 20) sh.x -= curW + 40;
            sh.rot += safeDt * sh.spin;
            const py = lerp(-18, curH + 18, sh.p);
            const al = rainA * loopEnvelope(sh.p, 0.14) * 0.86;
            if (al <= 0.015) continue;
            const rgb = pickRgb(sh.hue, pal);
            if (sh.star) {
              glow(g, sh.x, py, sh.size * 2.5, rgb, al * 0.46);
              drawStarGlint(g, sh.x, py, sh.size * 1.35, '#fffdf4', al);
            } else {
              drawFacetedCrystal(g, sh.x, py, sh.size, sh.rot, rgb, pal, al, sh.depth, 1.15);
            }
          }
        }
      }
      return true;
    }

    function destroy() {
      if (!alive) return;
      alive = false;
      try { canvas.remove(); } catch { }
    }

    return { kind, step, destroy };
  }

  // =========================================================================
  // ASTRAL SOVEREIGN — CREATOR-EXCLUSIVE SCI-FI HOLOGRAPHIC PROTOCOL
  // Reserved exclusively for breadspanish231@gmail.com.
  // Designed with the architectural refinement, layered lighting & shadows,
  // curated breathing room, and seamless continuity of Manifestation &
  // Vanish & Reform.
  // =========================================================================
  api.registerEffect(
    'creator_astral_sovereign',
    'Astral Sovereign',
    'Creator',
    'Exclusive founder-only hologram inspired by Manifestation and Vanish & Reform — sculpted 3D lighting & shadows, curated 360° atmosphere, seamless loops, full-screen cinematics, and Hollywood SFX.',
    3,
    (S) => {
      const { W, H, s, full, b, f, host, onTrigger, onCleanup } = S;
      let { cx, cy, ra } = S;

      const syncLiveAvatar = () => {
        if (!full || !host?.querySelector) return;
        const av = host.querySelector('.effects-card-avatar, .avatar-circle, .avatar, .mav, .effect-hero-avatar');
        const cv = f?.canvas || host.querySelector('canvas.fxf') || host.querySelector('canvas.fxb');
        if (!av || !cv || typeof av.getBoundingClientRect !== 'function' || typeof cv.getBoundingClientRect !== 'function') return;
        const cr = cv.getBoundingClientRect();
        const ar = av.getBoundingClientRect();
        if (cr.width > 0 && cr.height > 0 && ar.width > 0 && ar.height > 0) {
          const sx = W / cr.width;
          const sy = H / cr.height;
          cx = (ar.left - cr.left + ar.width * 0.5) * sx;
          cy = (ar.top - cr.top + ar.height * 0.5) * sy;
          ra = Math.max(12, Math.min(ar.width * sx, ar.height * sy) * 0.5);
        }
      };
      syncLiveAvatar();

      const zones = measureHostZones(host, W, H, cx, cy, ra);
      const frameM = full ? buildRoundedFrame(W, H, 3.5 * s, 18 * s) : null;
      const groupsM = full ? buildRoundedFrame(zones.groupsRect.w, zones.groupsRect.h, 0.75 * s, 13 * s) : null;

      // =====================================================================
      // CURATED, VARIED, ZERO-TELEPORT AMBIENT POOLS (QUALITY OVER QUANTITY)
      // Every looping particle uses a normalized [0..1) phase `p` with a
      // smooth C1 `loopEnvelope(p)` (alpha = 0 at both endpoints) advanced
      // strictly via `safeDt * speed * speedMul` — ZERO pops, ZERO teleports.
      // =====================================================================

      // --- 1. LEFT & RIGHT FLANKS (Curated 28 varied elements total — balanced, uncrowded!) ---
      const flankMoteCount = full ? 12 : 6;
      const flankMotes = Array.from({ length: flankMoteCount }, (_, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const edgeFrac = 0.032 + Math.pow(seed(i, 3), 1.15) * 0.115;
        const depth = 0.34 + seed(i, 7) * 0.66;
        return {
          side,
          xBase: side === -1 ? W * edgeFrac : W * (1 - edgeFrac),
          p: seed(i, 11),
          speed: (0.024 + seed(i, 13) * 0.028) * (0.7 + depth * 0.45),
          driftAmp: (3.2 + seed(i, 17) * 6.4) * s * depth,
          phase: seed(i, 19) * TAU,
          depth,
          size: (0.7 + seed(i, 23) * 1.45) * s * (0.65 + depth * 0.5),
          star: i % 4 === 0,
          hue: i % 4 === 0 ? 'gold' : i % 6 === 0 ? 'prism' : i % 3 === 0 ? 'white' : 'accent'
        };
      });

      const flankCrystalCount = full ? 8 : 4;
      const flankCrystals = Array.from({ length: flankCrystalCount }, (_, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const edgeFrac = 0.038 + seed(i, 53) * 0.1;
        const depth = 0.45 + seed(i, 57) * 0.55;
        return {
          side,
          xBase: side === -1 ? W * edgeFrac : W * (1 - edgeFrac),
          p: (i / flankCrystalCount + seed(i, 59) * 0.08) % 1,
          speed: 0.018 + seed(i, 61) * 0.018,
          phase: seed(i, 67) * TAU,
          rot: seed(i, 68) * TAU,
          spin: side * (0.38 + seed(i, 71) * 0.55),
          size: (2.2 + seed(i, 73) * 2.2) * s * depth,
          depth,
          hue: i % 3 === 0 ? 'gold' : i % 4 === 0 ? 'prism' : 'accent'
        };
      });

      // 4 Sculpted 3D Tilting Micro-Astrolabe Glyphs (2 left, 2 right — asymmetrically balanced)
      const flankGlyphCount = full ? 4 : 2;
      const flankGlyphs = Array.from({ length: flankGlyphCount }, (_, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const ySlots = full ? [0.34, 0.24, 0.72, 0.64] : [0.35, 0.65];
        return {
          xBase: side === -1 ? W * (0.075 + (i > 1 ? 0.025 : 0)) : W * (0.925 - (i > 1 ? 0.025 : 0)),
          yBase: H * ySlots[i],
          r: (5.2 + seed(i, 131) * 3.4) * s,
          rot: (side * 0.42) + (seed(i, 137) - 0.5) * 0.5,
          tiltPhase: seed(i, 139) * TAU,
          orbAng: seed(i, 149) * TAU,
          orbSpeed: side * (0.72 + seed(i, 151) * 0.45),
          bobAmp: (3.0 + seed(i, 157) * 3.2) * s,
          hue: i % 2 === 0 ? 'accent' : 'gold'
        };
      });

      const flankFilamentCount = full ? 4 : 2;
      const flankFilaments = Array.from({ length: flankFilamentCount }, (_, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        return {
          xBase: side === -1 ? 6.5 * s : W - 6.5 * s,
          p: (i / flankFilamentCount + 0.12) % 1,
          rate: 0.13 + seed(i, 89) * 0.08,
          len: (26 + seed(i, 97) * 24) * s,
          width: (0.95 + seed(i, 101) * 0.6) * s,
          gold: i % 2 === 1
        };
      });

      // --- 2. TOP CROWN (Curated 10 refined elements — celestial sky & subtle motes) ---
      const topMoteCount = full ? 8 : 4;
      const topMotes = Array.from({ length: topMoteCount }, (_, i) => {
        const depth = 0.35 + seed(i, 503) * 0.65;
        return {
          dir: i % 2 === 0 ? 1 : -1,
          p: (i / topMoteCount + seed(i, 509) * 0.09) % 1,
          yBase: 0.035 + seed(i, 521) * 0.19,
          speed: (0.026 + seed(i, 523) * 0.024) * (0.7 + depth * 0.4),
          bobAmp: (2.0 + seed(i, 541) * 4.0) * s * depth,
          phase: seed(i, 547) * TAU,
          size: (0.85 + seed(i, 557) * 1.6) * s * (0.7 + depth * 0.45),
          depth,
          star: i % 3 === 0,
          hue: i % 3 === 0 ? 'gold' : i % 5 === 0 ? 'prism' : 'accent'
        };
      });

      const topFilamentCount = full ? 2 : 1;
      const topFilaments = Array.from({ length: topFilamentCount }, (_, i) => ({
        dir: i % 2 === 0 ? 1 : -1,
        p: (i * 0.5 + 0.15) % 1,
        y: (12 + seed(i, 601) * Math.max(22, zones.bannerH * 0.56)),
        rate: 0.11 + seed(i, 607) * 0.06,
        len: (34 + seed(i, 613) * 28) * s,
        width: (1.0 + seed(i, 617) * 0.55) * s,
        gold: i % 2 === 1
      }));

      // --- 3. BOTTOM HORIZON (Curated 11 refined elements — projector plinth & weightless embers) ---
      const bottomEmberCount = full ? 9 : 4;
      const bottomEmbers = Array.from({ length: bottomEmberCount }, (_, i) => {
        const depth = 0.35 + seed(i, 619) * 0.65;
        return {
          xBase: 0.08 + ((i + 0.5) / bottomEmberCount) * 0.84 + (seed(i, 631) - 0.5) * 0.04,
          p: (i / bottomEmberCount + seed(i, 641) * 0.1) % 1,
          speed: (0.095 + seed(i, 643) * 0.085) * (0.75 + depth * 0.4),
          riseH: (28 + seed(i, 647) * 34) * s,
          swayAmp: (3.2 + seed(i, 653) * 5.8) * s,
          phase: seed(i, 659) * TAU,
          rot: seed(i, 660) * TAU,
          spin: (i % 2 ? 1 : -1) * (0.55 + seed(i, 662) * 0.7),
          size: (0.85 + seed(i, 661) * 1.45) * s,
          depth,
          crystal: i % 3 === 0,
          hue: i % 2 === 0 ? 'gold' : i % 5 === 0 ? 'prism' : 'accent'
        };
      });

      const bottomFilamentCount = full ? 2 : 1;
      const bottomFilaments = Array.from({ length: bottomFilamentCount }, (_, i) => ({
        dir: i % 2 === 0 ? -1 : 1,
        p: (i * 0.5 + 0.35) % 1,
        y: H - (10 + i * 7.5) * s,
        rate: 0.1 + seed(i, 733) * 0.05,
        len: (34 + seed(i, 739) * 26) * s,
        width: (0.95 + seed(i, 743) * 0.5) * s,
        gold: i % 2 === 0
      }));

      // =====================================================================
      // PERSISTENT LIVE PHYSICS QUEUE (CURVED MAGNETIC TRAILS, 3D CRYSTALS,
      // REFRACTION RINGS) — NEVER TELEPORTS OR ABRUPTLY CUTS OFF
      // =====================================================================
      const liveParticles = [];
      const liveRings = [];

      const emitSpark = (x, y, vx, vy, sz, lifeDur, hue, isStar = true) => {
        if (liveParticles.length > 180) liveParticles.shift();
        liveParticles.push({ kind: isStar ? 'star' : 'orb', x, y, vx, vy, sz, curl: (Math.random() - 0.5) * 16, age: 0, dur: lifeDur, hue, drag: 1.75 });
      };

      const emitCrystal = (x, y, vx, vy, sz, rot, spin, lifeDur, hue, depth = 0.8) => {
        if (liveParticles.length > 180) liveParticles.shift();
        liveParticles.push({ kind: 'crystal', x, y, vx, vy, sz, rot, spin, depth, age: 0, dur: lifeDur, hue, drag: 1.45 });
      };

      const emitRibbonComet = (x, y, vx, vy, width, lifeDur, hue, curl = 0) => {
        if (liveParticles.length > 180) liveParticles.shift();
        liveParticles.push({ kind: 'comet', x, y, px: x, py: y, vx, vy, width, curl, age: 0, dur: lifeDur, hue, drag: 1.55 });
      };

      const emitRing = (x, y, rStart, rEnd, width, dur, hue, alpha = 0.68) => {
        if (liveRings.length > 18) liveRings.shift();
        liveRings.push({ x, y, rStart, rEnd, width, age: 0, dur, hue, alpha });
      };

      const spawnShakeEmitter = () => {
        emitRing(cx, cy, ra * 1.08, Math.hypot(W, H) * 0.7, 1.8 * s, 1.45, 'accent', 0.58);
        emitRing(cx, cy, ra * 1.0, Math.hypot(W, H) * 0.54, 1.15 * s, 1.2, 'gold', 0.5);
        // Curated sculpted shards & crisp glints detaching organically from flanks + avatar
        const count = full ? 18 : 8;
        for (let i = 0; i < count; i += 1) {
          const fromSide = full && i >= 8;
          const side = i % 2 === 0 ? -1 : 1;
          const a = (i / 8) * TAU + seed(i, 809) * 0.35;
          const x = fromSide ? (side === -1 ? 9 * s : W - 9 * s) : cx + Math.cos(a) * (ra + 4);
          const y = fromSide ? H * (0.14 + seed(i, 811) * 0.72) : cy + Math.sin(a) * (ra + 4);
          const vx = fromSide ? side * (-34 - seed(i, 821) * 42) * s : Math.cos(a) * (54 + seed(i, 823) * 66) * s;
          const vy = fromSide ? (seed(i, 827) - 0.5) * 44 * s : Math.sin(a) * (48 + seed(i, 829) * 60) * s;
          if (i % 2 === 0) {
            emitCrystal(x, y, vx, vy, (2.0 + seed(i, 839) * 1.8) * s, a, side * 3.2, 1.05 + seed(i, 853) * 0.45, i % 4 === 0 ? 'gold' : 'accent', 0.85);
          } else {
            emitSpark(x, y, vx * 0.9, vy * 0.9, (1.4 + seed(i, 839) * 1.6) * s, 0.95 + seed(i, 853) * 0.45, i % 3 === 0 ? 'gold' : 'accent', true);
          }
        }
      };

      const spawnPulseEmitter = () => {
        emitRing(cx, cy, ra * 1.02, Math.hypot(W, H) * 0.88, 2.0 * s, 1.95, 'gold', 0.72);
        emitRing(cx, cy, ra * 0.98, Math.hypot(W, H) * 0.82, 1.5 * s, 2.25, 'accent', 0.6);
        emitRing(cx, cy, ra * 0.94, Math.hypot(W, H) * 0.76, 1.05 * s, 2.55, 'prism', 0.46);
        if (full) {
          emitRing(zones.badgeX, zones.badgeY, 5 * s, 32 * s, 1.3 * s, 1.4, 'gold', 0.72);
        }
        // Restrained rising luminance motes along the optical scan wake
        for (let i = 0; i < (full ? 12 : 5); i += 1) {
          const x = full ? (i % 2 === 0 ? W * (0.06 + seed(i, 857) * 0.14) : W * (0.8 + seed(i, 859) * 0.14)) : cx;
          const y = H * (0.24 + seed(i, 863) * 0.62);
          emitSpark(x, y, (seed(i, 877) - 0.5) * 14 * s, (-26 - seed(i, 881) * 34) * s, (1.3 + seed(i, 883) * 1.4) * s, 1.6 + seed(i, 887) * 0.7, i % 2 === 0 ? 'gold' : 'accent', i % 3 === 0);
        }
      };

      const spawnBurstEmitter = () => {
        emitRing(cx, cy, ra * 0.92, Math.hypot(W, H) * 0.9, 2.2 * s, 1.65, 'gold', 0.78);
        emitRing(cx, cy, ra * 0.9, Math.hypot(W, H) * 0.74, 1.5 * s, 1.4, 'accent', 0.66);
        // 14 Curved Magnetic Light Ribbons (inspired by Vanish & Reform's curved trails)
        const cometN = full ? 14 : 6;
        for (let i = 0; i < cometN; i += 1) {
          const a = (i / cometN) * TAU + seed(i, 907) * 0.24;
          const spd = (108 + seed(i, 911) * 124) * s;
          const curl = (i % 2 ? 1 : -1) * (1.2 + seed(i, 913) * 1.1);
          emitRibbonComet(cx, cy, Math.cos(a) * spd, Math.sin(a) * spd, (1.1 + seed(i, 919) * 0.95) * s, 1.3 + seed(i, 929) * 0.65, i % 3 === 0 ? 'gold' : i % 5 === 0 ? 'prism' : 'accent', curl);
        }
        // 18 Sculpted 3D Tumbling Faceted Metallic Crystals with Directional Shadows
        const crysN = full ? 18 : 8;
        for (let i = 0; i < crysN; i += 1) {
          const a = (i / crysN) * TAU + seed(i, 937) * 0.3;
          const spd = (72 + seed(i, 941) * 112) * s;
          emitCrystal(cx, cy, Math.cos(a) * spd, Math.sin(a) * spd, (2.2 + seed(i, 947) * 2.2) * s, seed(i, 953) * TAU, (i % 2 ? 1 : -1) * (2.6 + seed(i, 967) * 3.2), 1.55 + seed(i, 971) * 0.75, i % 3 === 0 ? 'gold' : i % 4 === 0 ? 'prism' : 'accent', 0.55 + seed(i, 973) * 0.45);
        }
        // 16 Weightless Starlight Glints settling into zero-G suspension
        const spkN = full ? 16 : 6;
        for (let i = 0; i < spkN; i += 1) {
          const a = seed(i, 977) * TAU;
          const spd = (48 + seed(i, 983) * 92) * s;
          emitSpark(cx, cy, Math.cos(a) * spd, Math.sin(a) * spd, (1.1 + seed(i, 991) * 1.4) * s, 1.65 + seed(i, 997) * 0.8, i % 2 === 0 ? 'gold' : 'accent', true);
        }
      };

      // Continuous monotonic state variables (100% C1 smooth — ZERO snaps or resets!)
      const st = {
        rotA: 0,
        rotB: 0,
        goldA: -Math.PI * 0.5,
        blueA: Math.PI * 0.35,
        comet1: 0,
        comet2: 0.5,
        groupComet: 0.22,
        vernierPos: 0,
        wavePhase: 0,
        twinklePhase: 0,
        sheenCycle: 0.35,
        barPhase: 0,
        speedMul: 1,
        smoothSurge: 0,
        shakeX: 0,
        shakeY: 0,
        shakeRot: 0,
        scale: 1,
        chroma: 0,
        frameGlow: 0.45,
        pulseGlow: 0,
        sheenPos: -140,
        sheenAlpha: 0,
        act: null, // { kind, elapsed, dur, emitted }
        autoTimer: 0,
        autoStep: 0,
        cinema: null
      };

      const ACT_DURS = { shake: 2.8, pulse: 3.6, burst: 4.4, awakening: 5.2, entrance: 5.6 };
      const AUTO_ORDER = ['pulse', 'burst', 'shake'];

      const destroyCinema = () => {
        if (st.cinema) {
          st.cinema.destroy();
          st.cinema = null;
        }
      };

      if (typeof onCleanup === 'function') {
        onCleanup(() => {
          destroyCinema();
          api.stopEffectSfx?.();
        });
      }

      const startAct = (kind, { playSfx = false } = {}) => {
        const dur = ACT_DURS[kind];
        if (!dur) return;
        st.act = { kind, elapsed: 0, dur, emitted: false };
        st.sheenCycle = 0; // Reset ambient sheen phase cleanly so handoff after act never jumps!
        if (kind === 'awakening' || kind === 'entrance') {
          destroyCinema();
          if (full) {
            st.cinema = createFullscreenCinema(host, kind, getPalette(host));
          }
          spawnPulseEmitter();
        }
        if (playSfx && full) {
          api.playEffectSfx?.(`pfx-${kind}`, { retryOnGestureEl: host });
        }
      };

      if (typeof onTrigger === 'function') {
        onTrigger((kind, opts = {}) => {
          if (kind === 'auto') {
            destroyCinema();
            st.autoTimer = 2.4;
            startAct('pulse', { playSfx: !opts.silent });
            return;
          }
          startAct(kind, { playSfx: !opts.silent });
        });
      }

      // ---------------------------------------------------------------------
      // DRAW 3D SCULPTED CHRONO-ASTROLABE AVATAR GIMBAL (CONCENTRIC ON DP!)
      // Multi-stop brushed titanium lighting, recessed depth ring, horology
      // tick scale, and sweeping specular catchlight — locked dead-center.
      // ---------------------------------------------------------------------
      const drawAvatarGimbal = (energy, pal) => {
        const expand = 1 + energy * 0.03;
        const baseR = full ? ra + 3.5 : ra;
        const rOuter = Math.max(4, baseR * 1.21 * expand);
        const rMid = Math.max(3, baseR * 1.11 * expand);
        const rInner = Math.max(2, baseR * 1.02 * expand);

        // Layered studio key-light + ambient halo behind the DP
        glow(b, cx, cy, baseR * (2.25 + energy * 0.35), pal.accent, 0.22 + energy * 0.12);
        glow(b, cx - baseR * 0.24, cy - baseR * 0.26, baseR * 1.45, pal.gold, 0.15 + energy * 0.1);

        // Symmetric recessed metallic shadow bed right behind rOuter (depth without off-center bias)
        b.save();
        b.globalAlpha = 0.46;
        b.strokeStyle = 'rgba(2,5,12,0.78)';
        b.lineWidth = Math.max(1.2, 3.6 * s);
        b.beginPath();
        b.arc(cx, cy, rOuter, 0, TAU);
        b.stroke();
        b.restore();

        f.save();
        // 5-stop brushed celestial titanium studio lighting gradient
        const gradTi = f.createLinearGradient(cx - rOuter, cy - rOuter, cx + rOuter, cy + rOuter);
        gradTi.addColorStop(0, '#ffffff');
        gradTi.addColorStop(0.28, '#c8d9ec');
        gradTi.addColorStop(0.56, '#485d78');
        gradTi.addColorStop(0.82, '#dfe9f6');
        gradTi.addColorStop(1, '#263446');

        f.lineCap = 'round';
        for (let i = 0; i < 3; i += 1) {
          const a0 = st.rotA + (i * TAU) / 3;
          const a1 = a0 + 1.48;
          // Recessed contact bezel
          f.strokeStyle = 'rgba(2,5,11,0.56)';
          f.lineWidth = Math.max(1.1, 2.9 * s);
          f.beginPath();
          f.arc(cx, cy, rOuter, a0, a1);
          f.stroke();

          // Sculpted brushed titanium body
          f.strokeStyle = gradTi;
          f.lineWidth = Math.max(0.95, 1.95 * s);
          f.beginPath();
          f.arc(cx, cy, rOuter, a0, a1);
          f.stroke();

          // Fine rotating specular catchlight rim
          f.strokeStyle = 'rgba(255,254,246,0.66)';
          f.lineWidth = Math.max(0.45, 0.72 * s);
          f.beginPath();
          f.arc(cx, cy, rOuter + 0.85 * s, a0 + 0.14, a0 + 0.74);
          f.stroke();
        }

        // Precision etched horology tick marks (cardinal ticks accented in champagne gold)
        const tickTotal = full ? 24 : 18;
        for (let i = 0; i < tickTotal; i += 1) {
          const a = st.rotB + (i / tickTotal) * TAU;
          const major = i % 6 === 0;
          const r0 = rMid - (major ? 2.4 : 1.0) * s;
          const r1 = rMid + (major ? 2.4 : 1.0) * s;
          f.strokeStyle = major ? `rgba(${pal.gold},0.62)` : `rgba(${pal.accent},0.42)`;
          f.lineWidth = Math.max(0.5, (major ? 0.98 : 0.76) * s);
          f.beginPath();
          f.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          f.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
          f.stroke();
        }

        // Sovereign champagne-gold inner bevel arc + luminous precision node
        const rGold = rInner + 1.8 * s;
        f.strokeStyle = `rgba(${pal.gold},0.82)`;
        f.lineWidth = Math.max(0.75, 1.28 * s);
        f.beginPath();
        f.arc(cx, cy, rGold, st.goldA - 0.88, st.goldA);
        f.stroke();

        const nx = cx + Math.cos(st.goldA) * rGold;
        const ny = cy + Math.sin(st.goldA) * rGold;
        glow(f, nx, ny, 7.2 * s, pal.gold, 0.86);
        f.fillStyle = 'rgba(255,252,238,0.96)';
        f.beginPath();
        f.arc(nx, ny, Math.max(1.0, 1.75 * s), 0, TAU);
        f.fill();

        // Opposing cryo-sapphire precision counter-node
        const bx = cx + Math.cos(st.blueA) * rOuter;
        const by = cy + Math.sin(st.blueA) * rOuter;
        glow(f, bx, by, 5.8 * s, pal.accent, 0.7);
        f.fillStyle = 'rgba(235,249,255,0.94)';
        f.beginPath();
        f.arc(bx, by, Math.max(0.85, 1.3 * s), 0, TAU);
        f.fill();
        f.restore();
      };

      // ---------------------------------------------------------------------
      // DRAW CURATED 360° ARCHITECTURAL ATMOSPHERE (SIDES + TOP + BOTTOM)
      // Inspired by Manifestation & Vanish & Reform: layered shadows, studio
      // lighting, breathing room, text-zone readability, zero wrap teleports!
      // ---------------------------------------------------------------------
      const updateAndDrawAtmosphere = (safeDt, surge, pal) => {
        const boost = 1 + surge * 0.55;
        const sp = st.speedMul;

        // 1. Volumetric Deep-Space Lighting & Soft Recessed Edge Ambient Shadow (Plane 0)
        glow(b, W * (0.18 + 0.06 * Math.sin(st.wavePhase * 0.28)), H * 0.2, W * 0.42, pal.deep, 0.22 + surge * 0.1);
        glow(b, W * (0.84 - 0.06 * Math.cos(st.wavePhase * 0.24)), H * 0.82, W * 0.4, pal.accent, 0.11 + surge * 0.08);
        glow(b, W * 0.5, H * 0.04, W * 0.44, pal.accent, 0.11 + surge * 0.08);
        glow(b, W * 0.5, H * 0.98, W * 0.48, pal.gold, 0.14 + surge * 0.1);

        // Subtle recessed perimeter vignette shadows grounding the holographic stage
        if (full) {
          const topVig = b.createLinearGradient(0, 0, 0, 26 * s);
          topVig.addColorStop(0, 'rgba(2,5,12,0.34)');
          topVig.addColorStop(1, 'rgba(2,5,12,0)');
          b.fillStyle = topVig;
          b.fillRect(0, 0, W, 26 * s);
        }

        // 2. TOP CROWN: Sculpted Celestial Orbital Horizon Arcs + Curated Sky Motes & Silk Filaments
        b.save();
        // Soft shadow offset under main orbital meridian
        b.strokeStyle = 'rgba(2,6,14,0.36)';
        b.lineWidth = Math.max(1.2, 2.2 * s);
        b.beginPath();
        b.moveTo(0, zones.bannerH * 0.82 + 1.4 * s);
        b.quadraticCurveTo(W * 0.52, zones.bannerH * 0.24 + Math.sin(st.wavePhase * 0.45) * 2.8 * s + 1.4 * s, W, zones.bannerH * 0.65 + 1.4 * s);
        b.stroke();

        const topArcG = b.createLinearGradient(0, 10, W, zones.bannerH);
        topArcG.addColorStop(0, `rgba(${pal.accent},0)`);
        topArcG.addColorStop(0.32, `rgba(${pal.accent},${(0.46 + surge * 0.28).toFixed(3)})`);
        topArcG.addColorStop(0.68, `rgba(${pal.gold},${(0.4 + surge * 0.24).toFixed(3)})`);
        topArcG.addColorStop(1, `rgba(${pal.accent},0)`);
        b.strokeStyle = topArcG;
        b.lineWidth = Math.max(0.8, 1.15 * s);
        b.beginPath();
        b.moveTo(0, zones.bannerH * 0.82);
        b.quadraticCurveTo(W * 0.52, zones.bannerH * 0.24 + Math.sin(st.wavePhase * 0.45) * 2.8 * s, W, zones.bannerH * 0.65);
        b.stroke();

        b.strokeStyle = `rgba(${pal.gold},${(0.24 + surge * 0.18).toFixed(3)})`;
        b.lineWidth = 0.8 * s;
        b.beginPath();
        b.moveTo(W * 0.1, 9 * s);
        b.quadraticCurveTo(W * 0.5, 20 * s + Math.cos(st.wavePhase * 0.55) * 2.2 * s, W * 0.9, 9 * s);
        b.stroke();
        b.restore();

        for (let i = 0; i < topMotes.length; i += 1) {
          const o = topMotes[i];
          o.p = frac(o.p + safeDt * o.speed * sp);
          const xNorm = o.dir > 0 ? lerp(0.05, 0.95, o.p) : lerp(0.95, 0.05, o.p);
          const px = xNorm * W;
          const py = o.yBase * H + Math.sin(st.wavePhase * 0.75 + o.phase) * o.bobAmp;
          const env = loopEnvelope(o.p, 0.18);
          const tw = 0.48 + 0.52 * Math.pow(Math.sin(st.twinklePhase * 1.8 + o.phase), 2);
          const al = clamp(env * tw * (0.34 + 0.52 * o.depth + surge * 0.2));
          if (al <= 0.015) continue;
          const rgb = pickRgb(o.hue, pal);
          const target = o.depth > 0.64 ? f : b;
          glow(target, px, py, o.size * 3.2, rgb, al * 0.42);
          if (o.star) {
            drawStarGlint(target, px, py, o.size * (0.95 + tw * 0.55), o.hue === 'gold' ? '#fff7dc' : '#eef8ff', al);
          } else {
            target.fillStyle = `rgba(255,253,248,${(al * 0.92).toFixed(3)})`;
            target.beginPath();
            target.arc(px, py, Math.max(0.45, o.size * 0.85), 0, TAU);
            target.fill();
          }
        }

        for (let i = 0; i < topFilaments.length; i += 1) {
          const ts = topFilaments[i];
          ts.p = frac(ts.p + safeDt * ts.rate * sp);
          const xHead = ts.dir > 0 ? lerp(-ts.len, W + ts.len, ts.p) : lerp(W + ts.len, -ts.len, ts.p);
          const xTail = xHead - ts.dir * ts.len;
          const yMid = ts.y + Math.sin(st.wavePhase * 0.8 + i * 2.1) * 2.2 * s;
          const al = Math.sin(ts.p * Math.PI) * (0.48 + surge * 0.3);
          if (al <= 0.02) continue;
          const rgb = ts.gold ? pal.gold : pal.accent;
          const sg = f.createLinearGradient(xTail, yMid, xHead, yMid);
          sg.addColorStop(0, `rgba(${rgb},0)`);
          sg.addColorStop(0.72, `rgba(${rgb},${(al * 0.62).toFixed(3)})`);
          sg.addColorStop(1, `rgba(255,253,245,${clamp(al).toFixed(3)})`);
          f.save();
          f.strokeStyle = sg;
          f.lineWidth = ts.width;
          f.lineCap = 'round';
          f.beginPath();
          f.moveTo(xTail, yMid + 1.8 * s);
          f.quadraticCurveTo((xTail + xHead) * 0.5, yMid - 2.6 * s, xHead, yMid);
          f.stroke();
          f.restore();
          glow(f, xHead, yMid, ts.width * 3.4, rgb, al * 0.48);
        }

        // 3. BOTTOM HORIZON: Sculpted Holographic Projector Plinth, Horizon Wave & Weightless Embers
        if (full) {
          const baseGrad = b.createLinearGradient(0, H - 50 * s, 0, H);
          baseGrad.addColorStop(0, 'rgba(0,0,0,0)');
          baseGrad.addColorStop(0.62, `rgba(${pal.accent},${(0.06 + surge * 0.06).toFixed(3)})`);
          baseGrad.addColorStop(1, `rgba(${pal.gold},${(0.15 + surge * 0.11).toFixed(3)})`);
          b.fillStyle = baseGrad;
          b.fillRect(0, H - 50 * s, W, 50 * s);

          // Single sculpted harmonic horizon filament with recessed dark underside shadow
          f.save();
          const segs = 28;
          const traceHorizonWave = (yOff, ampMul, phaseSign) => {
            f.beginPath();
            for (let j = 0; j <= segs; j += 1) {
              const k = j / segs;
              const x = lerp(14 * s, W - 14 * s, k);
              const y = H - yOff + Math.sin(k * 9 + st.wavePhase * phaseSign) * (2.2 + surge * 1.4) * s * ampMul * Math.sin(k * Math.PI);
              if (j === 0) f.moveTo(x, y);
              else f.lineTo(x, y);
            }
            f.stroke();
          };
          f.strokeStyle = 'rgba(2,6,14,0.44)';
          f.lineWidth = 2.4 * s;
          traceHorizonWave(8.2 * s, 1, 1.15);

          const wg = f.createLinearGradient(14 * s, 0, W - 14 * s, 0);
          wg.addColorStop(0, `rgba(${pal.accent},0)`);
          wg.addColorStop(0.28, `rgba(${pal.accent},${(0.36 + surge * 0.24).toFixed(3)})`);
          wg.addColorStop(0.55, `rgba(${pal.gold},${(0.42 + surge * 0.26).toFixed(3)})`);
          wg.addColorStop(0.82, `rgba(${pal.accent},${(0.32 + surge * 0.22).toFixed(3)})`);
          wg.addColorStop(1, `rgba(${pal.accent},0)`);
          f.strokeStyle = wg;
          f.lineWidth = 1.15 * s;
          traceHorizonWave(9.5 * s, 1, 1.15);
          f.restore();
        }

        for (let i = 0; i < bottomEmbers.length; i += 1) {
          const em = bottomEmbers[i];
          em.p = frac(em.p + safeDt * em.speed * sp);
          em.rot += safeDt * em.spin * sp;
          const px = em.xBase * W + Math.sin(st.wavePhase * 0.9 + em.phase) * em.swayAmp;
          const py = H - 5 * s - easeOutCubic(em.p) * em.riseH;
          const al = clamp(loopEnvelope(em.p, 0.2) * (0.36 + 0.52 * em.depth + surge * 0.2));
          if (al <= 0.015) continue;
          const rgb = pickRgb(em.hue, pal);
          const target = em.depth > 0.62 ? f : b;
          if (em.crystal) {
            drawFacetedCrystal(target, px, py, em.size * 1.45, em.rot, rgb, pal, al, em.depth, s);
          } else {
            glow(target, px, py, em.size * 3.2, rgb, al * 0.44);
            target.fillStyle = `rgba(255,252,244,${al.toFixed(3)})`;
            target.beginPath();
            target.arc(px, py, Math.max(0.45, em.size * (1 - em.p * 0.3)), 0, TAU);
            target.fill();
          }
        }

        for (let i = 0; i < bottomFilaments.length; i += 1) {
          const bs = bottomFilaments[i];
          bs.p = frac(bs.p + safeDt * bs.rate * sp);
          const xHead = bs.dir > 0 ? lerp(-bs.len, W + bs.len, bs.p) : lerp(W + bs.len, -bs.len, bs.p);
          const xTail = xHead - bs.dir * bs.len;
          const y = bs.y + Math.cos(st.wavePhase * 0.8 + i * 2.1) * 1.6 * s;
          const al = Math.sin(bs.p * Math.PI) * (0.48 + surge * 0.3);
          if (al <= 0.02) continue;
          const rgb = bs.gold ? pal.gold : pal.accent;
          const sg = f.createLinearGradient(xTail, y, xHead, y);
          sg.addColorStop(0, `rgba(${rgb},0)`);
          sg.addColorStop(0.72, `rgba(${rgb},${(al * 0.62).toFixed(3)})`);
          sg.addColorStop(1, `rgba(255,253,245,${clamp(al).toFixed(3)})`);
          f.save();
          f.strokeStyle = sg;
          f.lineWidth = bs.width;
          f.lineCap = 'round';
          f.beginPath();
          f.moveTo(xTail, y);
          f.lineTo(xHead, y);
          f.stroke();
          f.restore();
          glow(f, xHead, y, bs.width * 3.4, rgb, al * 0.48);
        }

        // 4. ARCHITECTURAL FRAME: Hairline Conduits, Recessed Shadows, Vernier Ticks, Brackets & Telemetry
        if (full) {
          const yTop = 26 * s;
          const yBot = H - 24 * s;
          for (const side of [-1, 1]) {
            const xRail = side === -1 ? 6.5 * s : W - 6.5 * s;
            const railGrad = f.createLinearGradient(xRail, yTop, xRail, yBot);
            railGrad.addColorStop(0, `rgba(${pal.accent},0)`);
            railGrad.addColorStop(0.18, `rgba(${pal.accent},${clamp(0.28 * boost).toFixed(3)})`);
            railGrad.addColorStop(0.5, `rgba(${pal.gold},${clamp(0.38 * boost).toFixed(3)})`);
            railGrad.addColorStop(0.82, `rgba(${pal.accent},${clamp(0.28 * boost).toFixed(3)})`);
            railGrad.addColorStop(1, `rgba(${pal.accent},0)`);

            // Recessed shadow groove behind conduit
            b.save();
            b.strokeStyle = 'rgba(2,5,12,0.52)';
            b.lineWidth = 3.0 * s;
            b.beginPath();
            b.moveTo(xRail + L_DX * 0.9 * s, yTop);
            b.lineTo(xRail + L_DX * 0.9 * s, yBot);
            b.stroke();
            b.restore();

            f.save();
            f.strokeStyle = railGrad;
            f.lineWidth = 0.85 * s;
            f.beginPath();
            f.moveTo(xRail, yTop);
            f.lineTo(xRail, yBot);
            f.stroke();

            // 2 sculpted faceted anchor nodes per rail (clean, intentional — never cluttered)
            for (const fracY of [0.32, 0.72]) {
              const ny = lerp(yTop, yBot, fracY);
              const nPulse = 0.52 + 0.48 * Math.sin(st.twinklePhase * 1.9 + fracY * 7 + (side > 0 ? 1.5 : 0));
              const al = clamp(0.45 + nPulse * 0.36 + surge * 0.2);
              glow(f, xRail, ny, (4.2 + surge * 2.8) * s, pal.gold, al * 0.45);
              drawFacetedCrystal(f, xRail, ny, (2.1 + surge * 0.5) * s, 0, pal.gold, pal, al, 0.65, s);
            }
            f.restore();
          }

          // Precision horology micro-vernier scale ticks (14 clean ticks per side with smooth wave)
          f.save();
          const tickCount = 14;
          const tTop = zones.bannerH + 8 * s;
          const tSpan = Math.max(40, H - tTop - 24 * s);
          for (let i = 0; i < tickCount; i += 1) {
            const k = i / (tickCount - 1);
            const y = tTop + k * tSpan;
            const major = i % 3 === 0;
            const distWave = Math.min(Math.abs(k - st.vernierPos), 1 - Math.abs(k - st.vernierPos));
            const glowWave = Math.max(0, 1 - distWave * 6.0);
            const len = ((major ? 7.4 : 3.8) + glowWave * 2.4 + surge * 1.4) * s;
            const al = clamp((major ? 0.34 : 0.16) + glowWave * 0.4 + surge * 0.18);
            f.strokeStyle = (major || glowWave > 0.45)
              ? `rgba(${pal.gold},${al.toFixed(3)})`
              : `rgba(${pal.accent},${al.toFixed(3)})`;
            f.lineWidth = (major ? 1.0 : 0.75) * s;
            f.beginPath(); f.moveTo(3.5 * s, y); f.lineTo(3.5 * s + len, y); f.stroke();
            f.beginPath(); f.moveTo(W - 3.5 * s, y); f.lineTo(W - 3.5 * s - len, y); f.stroke();
          }

          // Four sculpted chamfered titanium-gold corner brackets with realistic cast drop shadows
          const cLen = 17.5 * s;
          const ch = 4.8 * s;
          const inset = 5 * s;
          const corners = [
            [inset, inset, 1, 1],
            [W - inset, inset, -1, 1],
            [W - inset, H - inset, -1, -1],
            [inset, H - inset, 1, -1]
          ];
          f.lineCap = 'round';
          for (const [x0, y0, sx, sy] of corners) {
            // Cast contact shadow along key-light direction
            f.strokeStyle = 'rgba(2,5,11,0.58)';
            f.lineWidth = 2.6 * s;
            f.beginPath();
            f.moveTo(x0 + sx * cLen + L_DX * 1.6 * s, y0 + L_DY * 1.6 * s);
            f.lineTo(x0 + sx * ch + L_DX * 1.6 * s, y0 + L_DY * 1.6 * s);
            f.lineTo(x0 + L_DX * 1.6 * s, y0 + sy * ch + L_DY * 1.6 * s);
            f.lineTo(x0 + L_DX * 1.6 * s, y0 + sy * cLen + L_DY * 1.6 * s);
            f.stroke();

            // Satin champagne-gold bracket body
            f.strokeStyle = `rgba(${pal.gold},0.72)`;
            f.lineWidth = 1.25 * s;
            f.beginPath();
            f.moveTo(x0 + sx * cLen, y0);
            f.lineTo(x0 + sx * ch, y0);
            f.lineTo(x0, y0 + sy * ch);
            f.lineTo(x0, y0 + sy * cLen);
            f.stroke();

            // Fine bright specular bevel on chamfer bend
            f.strokeStyle = 'rgba(255,253,245,0.68)';
            f.lineWidth = 0.65 * s;
            f.beginPath();
            f.moveTo(x0 + sx * (ch + 3.2 * s), y0);
            f.lineTo(x0 + sx * ch, y0);
            f.lineTo(x0, y0 + sy * ch);
            f.stroke();
          }

          // Live bottom-right harmonic telemetry bars with subtle recessed shadow
          const bars = 6;
          const bw = 2.2 * s;
          const gap = 2.2 * s;
          const baseX = W - 18 * s - bars * (bw + gap);
          const baseY = H - 8.5 * s;
          const barEnergy = 0.62 + surge * 0.5;
          for (let i = 0; i < bars; i += 1) {
            const bh = (2.6 + (0.5 + 0.5 * Math.sin(st.barPhase * (2.5 + i * 0.45) + i * 1.1)) * 7.2 * barEnergy) * s;
            const bx = baseX + i * (bw + gap);
            f.fillStyle = 'rgba(2,5,12,0.5)';
            f.fillRect(bx + 0.8 * s, baseY - bh + 0.8 * s, bw, bh);
            const bg = f.createLinearGradient(bx, baseY - bh, bx, baseY);
            bg.addColorStop(0, `rgba(${pal.gold},0.92)`);
            bg.addColorStop(1, `rgba(${pal.accent},0.82)`);
            f.fillStyle = bg;
            f.fillRect(bx, baseY - bh, bw, bh);
          }
          f.restore();
        }

        // 5. LEFT & RIGHT: 4 Slow Optical Conduit Filaments (strictly smooth sin(p * PI) fade)
        for (let i = 0; i < flankFilaments.length; i += 1) {
          const fl = flankFilaments[i];
          fl.p = frac(fl.p + safeDt * fl.rate * sp);
          const yHead = lerp(H * 0.94, H * 0.08, fl.p);
          const yTail = yHead + fl.len * (0.8 + surge * 0.35);
          const x = fl.xBase;
          const al = Math.sin(fl.p * Math.PI) * (0.5 + surge * 0.3);
          if (al <= 0.015) continue;
          const rgb = fl.gold ? pal.gold : pal.accent;
          const sg = f.createLinearGradient(x, yTail, x, yHead);
          sg.addColorStop(0, `rgba(${rgb},0)`);
          sg.addColorStop(0.7, `rgba(${rgb},${(al * 0.65).toFixed(3)})`);
          sg.addColorStop(1, `rgba(255,253,245,${clamp(al).toFixed(3)})`);
          f.save();
          f.strokeStyle = sg;
          f.lineWidth = fl.width;
          f.lineCap = 'round';
          f.beginPath();
          f.moveTo(x, yTail);
          f.lineTo(x, yHead);
          f.stroke();
          f.restore();
          glow(f, x, yHead, fl.width * 3.8, rgb, al * 0.5);
        }

        // 6. LEFT & RIGHT: 4 Sculpted 3D Tilting Micro-Astrolabe Glyphs (infinite smooth Lissajous loop)
        for (let i = 0; i < flankGlyphs.length; i += 1) {
          const gl = flankGlyphs[i];
          gl.orbAng += safeDt * gl.orbSpeed * sp;
          const gx = gl.xBase + Math.cos(st.wavePhase * 0.55 + gl.tiltPhase) * 2.6 * s;
          const gy = gl.yBase + Math.sin(st.wavePhase * 0.72 + gl.tiltPhase) * gl.bobAmp;
          const tilt = 0.52 + 0.24 * Math.sin(st.wavePhase * 0.6 + gl.tiltPhase);
          const al = clamp(0.42 + 0.24 * Math.sin(st.twinklePhase * 1.1 + gl.tiltPhase) + surge * 0.24);
          const rgb = gl.hue === 'gold' ? pal.gold : pal.accent;
          drawTiltingGlyph(f, gx, gy, gl.r, gl.rot + Math.sin(st.wavePhase * 0.4 + i) * 0.15, tilt, gl.orbAng, rgb, pal.gold, al, s);
        }

        // 7. LEFT & RIGHT: 12 Curated Multi-Depth Flank Motes + Subtle Constellation Micro-Links
        const moteCoords = [];
        for (let i = 0; i < flankMotes.length; i += 1) {
          const o = flankMotes[i];
          o.p = frac(o.p + safeDt * o.speed * sp);
          const x = o.xBase + Math.sin(st.wavePhase * 0.75 + o.phase) * o.driftAmp;
          const y = H * lerp(0.96, 0.04, o.p);
          const inTextZone = full && y > zones.bannerH + 12 * s && y < zones.groupsRect.y - 8 * s && x > W * 0.14 && x < W * 0.86;
          const zoneDim = inTextZone ? 0.24 : 1;
          const env = loopEnvelope(o.p, 0.16);
          const tw = 0.48 + 0.52 * Math.pow(Math.sin(st.twinklePhase * 1.9 + o.phase * 2.0), 2);
          const a = clamp(env * tw * zoneDim * (0.34 + 0.54 * o.depth + surge * 0.2));
          moteCoords.push({ x, y, a, side: o.side });
          if (a <= 0.015) continue;
          const rgb = pickRgb(o.hue, pal);
          const target = o.depth > 0.64 ? f : b;
          glow(target, x, y, o.size * 3.4, rgb, a * 0.44);
          if (o.star) {
            drawStarGlint(target, x, y, o.size * (1.1 + tw * 0.6), o.hue === 'gold' ? '#fff7dc' : '#eef8ff', a);
          } else {
            target.fillStyle = `rgba(252,254,255,${clamp(a * 0.94).toFixed(3)})`;
            target.beginPath();
            target.arc(x, y, Math.max(0.45, o.size * 0.88), 0, TAU);
            target.fill();
          }
        }

        // Delicate constellation hairline threads softly connecting nearby same-flank motes
        if (full) {
          const linkDist = 48 * s;
          b.save();
          b.lineWidth = 0.65 * s;
          for (let i = 0; i < moteCoords.length; i += 1) {
            const m1 = moteCoords[i];
            if (m1.a <= 0.08) continue;
            for (let j = i + 1; j < moteCoords.length; j += 1) {
              const m2 = moteCoords[j];
              if (m1.side !== m2.side || m2.a <= 0.08) continue;
              const d = Math.hypot(m2.x - m1.x, m2.y - m1.y);
              if (d < linkDist) {
                const la = (1 - d / linkDist) * Math.min(m1.a, m2.a) * 0.24;
                b.strokeStyle = `rgba(${pal.accent},${la.toFixed(3)})`;
                b.beginPath();
                b.moveTo(m1.x, m1.y);
                b.lineTo(m2.x, m2.y);
                b.stroke();
              }
            }
          }
          b.restore();
        }

        // 8. LEFT & RIGHT: 8 Sculpted 3D Faceted Metallic Prism Crystals (with directional cast shadows!)
        for (let i = 0; i < flankCrystals.length; i += 1) {
          const sh = flankCrystals[i];
          sh.p = frac(sh.p + safeDt * sh.speed * sp);
          sh.rot += safeDt * sh.spin * sp;
          const x = sh.xBase + Math.cos(st.wavePhase * 0.65 + sh.phase) * 4.2 * s;
          const y = H * lerp(0.95, 0.05, sh.p);
          const a = clamp(loopEnvelope(sh.p, 0.16) * (0.56 + surge * 0.28));
          if (a <= 0.015) continue;
          const rgb = pickRgb(sh.hue, pal);
          drawFacetedCrystal(f, x, y, sh.size * (1 + surge * 0.14), sh.rot, rgb, pal, a, sh.depth, s);
        }

        // 9. Twin Counter-Flowing Perimeter Comets & Groups Card Specular Filament
        if (full) {
          drawPerimeterComet(f, frameM, st.comet1, 0.14, pal.accent, 1.3 * s, 0.72 + surge * 0.2, 18);
          drawPerimeterComet(f, frameM, st.comet2, 0.11, pal.gold, 1.15 * s, 0.64 + surge * 0.22, 16);
          if (groupsM) {
            f.save();
            f.translate(zones.groupsRect.x, zones.groupsRect.y);
            drawPerimeterComet(f, groupsM, st.groupComet, 0.16, pal.gold, 1.05 * s, 0.56 + surge * 0.22, 15);
            f.restore();
          }
        }
      };

      // ---------------------------------------------------------------------
      // UPDATE & RENDER PERSISTENT LIVE PHYSICS ENTITIES (SMOOTH TO ALPHA=0)
      // ---------------------------------------------------------------------
      const updateAndDrawLiveEntities = (safeDt, pal) => {
        // Layered refraction shockwave rings (shadow halo + specular crest)
        f.save();
        for (let i = liveRings.length - 1; i >= 0; i -= 1) {
          const rg = liveRings[i];
          rg.age += safeDt;
          const u = rg.age / rg.dur;
          if (u >= 1) {
            liveRings.splice(i, 1);
            continue;
          }
          const r = lerp(rg.rStart, rg.rEnd, easeOutCubic(u));
          const al = Math.sin(u * Math.PI) * rg.alpha;
          const rgb = pickRgb(rg.hue, pal);
          f.strokeStyle = `rgba(2,6,14,${(al * 0.3).toFixed(3)})`;
          f.lineWidth = rg.width * 2.8;
          f.beginPath();
          f.arc(rg.x, rg.y, Math.max(2, r), 0, TAU);
          f.stroke();
          f.strokeStyle = `rgba(${rgb},${(al * 0.26).toFixed(3)})`;
          f.lineWidth = rg.width * 3.2;
          f.beginPath();
          f.arc(rg.x, rg.y, Math.max(2, r), 0, TAU);
          f.stroke();
          f.strokeStyle = `rgba(${rgb},${al.toFixed(3)})`;
          f.lineWidth = rg.width;
          f.beginPath();
          f.arc(rg.x, rg.y, Math.max(2, r), 0, TAU);
          f.stroke();
        }
        f.restore();

        // Live physics particles (curved magnetic comets, 3D faceted crystals, starlight glints)
        for (let i = liveParticles.length - 1; i >= 0; i -= 1) {
          const p = liveParticles[i];
          p.age += safeDt;
          const u = p.age / p.dur;
          if (u >= 1) {
            liveParticles.splice(i, 1);
            continue;
          }
          const dragFac = Math.exp(-p.drag * safeDt);
          p.px = p.x;
          p.py = p.y;
          // Gentle magnetic curl force perpendicular to velocity for organic curved trajectories
          if (p.curl) {
            const angTurn = p.curl * safeDt;
            const cA = Math.cos(angTurn);
            const sA = Math.sin(angTurn);
            const nvx = p.vx * cA - p.vy * sA;
            const nvy = p.vx * sA + p.vy * cA;
            p.vx = nvx;
            p.vy = nvy;
          }
          p.vx *= dragFac;
          p.vy *= dragFac;
          p.x += p.vx * safeDt;
          p.y += p.vy * safeDt;
          const al = Math.sin(u * Math.PI) * 0.92;
          const rgb = pickRgb(p.hue, pal);

          if (p.kind === 'comet') {
            const tx = p.x - p.vx * 0.095;
            const ty = p.y - p.vy * 0.095;
            if (Math.hypot(p.x - tx, p.y - ty) > 0.4) {
              const tg = f.createLinearGradient(tx, ty, p.x, p.y);
              tg.addColorStop(0, `rgba(${rgb},0)`);
              tg.addColorStop(1, `rgba(${rgb},${al.toFixed(3)})`);
              f.save();
              f.strokeStyle = tg;
              f.lineWidth = p.width;
              f.lineCap = 'round';
              f.beginPath();
              f.moveTo(tx, ty);
              f.lineTo(p.x, p.y);
              f.stroke();
              f.restore();
            }
            glow(f, p.x, p.y, p.width * 3.6, rgb, al * 0.56);
            f.fillStyle = `rgba(255,253,246,${al.toFixed(3)})`;
            f.beginPath();
            f.arc(p.x, p.y, Math.max(0.7, p.width * 0.66), 0, TAU);
            f.fill();
          } else if (p.kind === 'crystal') {
            p.rot += p.spin * safeDt;
            const sz = Math.max(0.8, p.sz * (0.62 + Math.sin(u * Math.PI) * 0.52));
            drawFacetedCrystal(f, p.x, p.y, sz, p.rot, rgb, pal, al, p.depth || 0.75, s);
          } else if (p.kind === 'star') {
            glow(f, p.x, p.y, p.sz * 3.0, rgb, al * 0.48);
            drawStarGlint(f, p.x, p.y, p.sz * 1.32, '#fffdf5', al);
          } else {
            glow(f, p.x, p.y, p.sz * 3.0, rgb, al * 0.46);
            f.fillStyle = `rgba(255,253,248,${al.toFixed(3)})`;
            f.beginPath();
            f.arc(p.x, p.y, Math.max(0.55, p.sz * 0.8), 0, TAU);
            f.fill();
          }
        }
      };

      // =====================================================================
      // MAIN RENDER LOOP (SEAMLESS C1-CONTINUOUS CHOREOGRAPHY ENGINE)
      // =====================================================================
      return (t, dt) => {
        const pal = getPalette(host);
        const isStill = dt === 0;
        const safeDt = isStill ? 0.016 : Math.min(0.05, Math.max(0.001, dt));
        syncLiveAvatar();

        // Compact gallery tile & reduced-motion still frame
        if (!full || isStill) {
          if (!isStill) {
            st.rotA += safeDt * 0.22;
            st.rotB -= safeDt * 0.14;
            st.goldA += safeDt * 0.48;
            st.blueA -= safeDt * 0.34;
            st.wavePhase += safeDt * 0.95;
            st.twinklePhase += safeDt * 1.1;
            st.barPhase += safeDt * 1.0;
          }
          updateAndDrawAtmosphere(isStill ? 0 : safeDt, 0.22, pal);
          drawAvatarGimbal(0.48, pal);
          if (full && host) {
            setVar(host, '--holo-shake-x', '0px');
            setVar(host, '--holo-shake-y', '0px');
            setVar(host, '--holo-shake-rot', '0deg');
            setVar(host, '--holo-pulse-scale', '1');
            setVar(host, '--holo-pulse-glow', '0');
            setVar(host, '--holo-chroma', '0px');
            setVar(host, '--holo-sheen-alpha', '0');
          }
          return;
        }

        // Advance active full-screen cinema overlay if running
        if (st.cinema) {
          st.cinema.step(safeDt);
        }

        // Targets smoothly damped into CSS vars (ZERO jumps when starting, switching, or ending!)
        let tgtShakeX = 0;
        let tgtShakeY = 0;
        let tgtShakeRot = 0;
        let tgtScale = 1;
        let tgtChroma = 0;
        let tgtSurge = 0.14 + 0.09 * Math.sin(st.wavePhase * 0.9);
        let tgtPulseGlow = 0;
        let tgtSpeedMul = 1;
        let sheenActive = false;

        // Auto scheduler with dignified serene cruise breathing room between acts
        const mode = typeof api.getCreatorAnimMode === 'function' ? api.getCreatorAnimMode() : 'auto';
        if (!st.act) {
          st.autoTimer += safeDt;
          if (mode === 'auto') {
            if (st.autoTimer >= 3.2) {
              st.autoTimer = 0;
              const nextKind = AUTO_ORDER[st.autoStep % AUTO_ORDER.length];
              st.autoStep += 1;
              startAct(nextKind, { playSfx: false });
            }
          } else if (mode === 'shake' || mode === 'pulse' || mode === 'burst') {
            if (st.autoTimer >= 2.8) {
              st.autoTimer = 0;
              startAct(mode, { playSfx: false });
            }
          }
        }

        if (st.act) {
          st.act.elapsed += safeDt;
          const u = clamp(st.act.elapsed / st.act.dur);
          const kind = st.act.kind;

          if (kind === 'shake') {
            // ACT: KINETIC RESONANCE (Anticipation -> Damped Dual-Axis Resonance + Refractive Wave -> Specular Settle)
            const windUp = smooth(u / 0.14) * (1 - smooth((u - 0.14) / 0.08));
            const activeK = clamp((u - 0.15) / 0.55);
            const activeEnv = u >= 0.15 && u <= 0.78
              ? Math.sin(clamp((u - 0.15) / 0.1) * Math.PI * 0.5) * Math.exp(-3.1 * activeK) * (1 - smooth((u - 0.66) / 0.12))
              : 0;
            if (u >= 0.15 && !st.act.emitted) {
              st.act.emitted = true;
              spawnShakeEmitter();
            }
            const osc = activeK * TAU * 4.0;
            tgtShakeX = Math.sin(osc) * 4.6 * activeEnv;
            tgtShakeY = Math.cos(osc * 1.45) * 2.1 * activeEnv;
            tgtShakeRot = Math.sin(osc + 0.45) * 0.82 * activeEnv;
            tgtScale = 1 - windUp * 0.012 + activeEnv * 0.007;
            tgtChroma = activeEnv * 2.2;
            tgtSurge = 0.22 + windUp * 0.42 + activeEnv * 0.98;
            tgtPulseGlow = activeEnv * 0.78;
            tgtSpeedMul = 1 + activeEnv * 0.65;

            // Anticipation horizontal optical tension ignition flare (inspired by Manifestation ignition!)
            if (windUp > 0.02) {
              const halfW = W * 0.46 * easeOutExpo(clamp(u / 0.15));
              const lg = f.createLinearGradient(cx - halfW, cy, cx + halfW, cy);
              lg.addColorStop(0, `rgba(${pal.accent},0)`);
              lg.addColorStop(0.5, `rgba(255,252,240,${(0.86 * windUp).toFixed(3)})`);
              lg.addColorStop(1, `rgba(${pal.gold},0)`);
              f.save();
              f.strokeStyle = lg;
              f.lineWidth = 1.6 * s;
              f.beginPath();
              f.moveTo(Math.max(8 * s, cx - halfW), cy);
              f.lineTo(Math.min(W - 8 * s, cx + halfW), cy);
              f.stroke();
              f.restore();
            }

            // Clean diagonal harmonic refraction wave sweeping smoothly during resonance
            const echoU = clamp((u - 0.16) / 0.46);
            if (echoU > 0 && echoU < 1) {
              drawDiagonalPhaseFront(f, W, H, easeInOutQuint(echoU), Math.sin(echoU * Math.PI) * 0.72, pal, s);
            }

            const setU = clamp((u - 0.68) / 0.3);
            if (setU > 0 && setU < 1) {
              sheenActive = true;
              st.sheenPos = lerp(-35, 145, easeInOutQuint(setU));
              st.sheenAlpha = Math.sin(setU * Math.PI) * 0.76;
            }
          } else if (kind === 'pulse') {
            // ACT: DYNAMIC SOVEREIGN PULSE (Inspired directly by Manifestation's Volumetric Scan Beam!)
            if (u >= 0.08 && !st.act.emitted) {
              st.act.emitted = true;
              spawnPulseEmitter();
            }
            const swell = Math.sin(smooth(u / 0.84) * Math.PI);
            tgtScale = 1 + swell * 0.015;
            tgtPulseGlow = swell * 0.96;
            tgtChroma = swell * 0.85;
            tgtSurge = 0.2 + swell * 0.82;
            tgtSpeedMul = 1 + swell * 0.45;

            glow(b, cx, cy, (ra + 3.5) * (2.5 + swell * 1.3), pal.gold, swell * 0.3);
            glow(b, cx, cy, (ra + 3.5) * (3.2 + swell * 1.5), pal.accent, swell * 0.22);

            // Descending Manifestation volumetric optical scan curtain + micro-grid wake (0.12 -> 0.72)
            const scanU = clamp((u - 0.12) / 0.6);
            if (scanU > 0 && scanU < 1) {
              const scanY = lerp(-14 * s, H + 22 * s, easeInOutQuint(scanU));
              const scanVis = smooth(scanU / 0.14) * (1 - smooth((scanU - 0.82) / 0.18));
              drawVolumetricScanCurtain(b, f, W, H, scanY, 64 * s, scanVis * 0.9, pal, s);
            }

            // Creator Badge Lock-On Harmonic Glint (0.34 -> 0.62)
            const badgePing = clamp((u - 0.34) / 0.28);
            if (badgePing > 0 && badgePing < 1) {
              const ba = Math.sin(badgePing * Math.PI) * 0.74;
              drawStarGlint(f, zones.badgeX, zones.badgeY, 7.2 * s * Math.sin(badgePing * Math.PI), '#fff7dd', ba);
            }

            const shU = clamp((u - 0.66) / 0.32);
            if (shU > 0 && shU < 1) {
              sheenActive = true;
              st.sheenPos = lerp(-35, 145, easeInOutQuint(shU));
              st.sheenAlpha = Math.sin(shU * Math.PI) * 0.72;
            }
          } else if (kind === 'burst') {
            // ACT: QUANTUM SUPERNOVA / PHASE REFORM (Inspired by Vanish & Reform's Curved Magnetic Field!)
            const pullU = clamp(u / 0.18);
            const flash = u >= 0.17 && u <= 0.38 ? Math.sin(clamp((u - 0.17) / 0.21) * Math.PI) : 0;
            if (u >= 0.17 && !st.act.emitted) {
              st.act.emitted = true;
              spawnBurstEmitter();
            }
            tgtScale = 1 - Math.sin(pullU * Math.PI) * 0.013 + flash * 0.016;
            tgtPulseGlow = flash * 1.15;
            tgtChroma = flash * 2.3;
            tgtSurge = 0.22 + pullU * 0.48 + flash * 1.15;
            tgtSpeedMul = 1 + flash * 0.85;

            // Curved magnetic field intake arcs converging smoothly into the avatar core
            if (u < 0.2) {
              const aIn = Math.sin(pullU * Math.PI);
              f.save();
              f.lineCap = 'round';
              for (let i = 0; i < 10; i += 1) {
                const ang = (i / 10) * TAU + st.rotA * 1.6;
                const rOut = lerp((ra + 3.5) * 2.6, (ra + 3.5) * 0.92, easeInOutQuint(pullU));
                const rIn = lerp((ra + 3.5) * 1.9, (ra + 3.5) * 0.72, easeInOutQuint(pullU));
                const x0 = cx + Math.cos(ang) * rOut;
                const y0 = cy + Math.sin(ang) * rOut;
                const cpx = cx + Math.cos(ang + 0.28) * ((rOut + rIn) * 0.54);
                const cpy = cy + Math.sin(ang + 0.28) * ((rOut + rIn) * 0.54);
                const x1 = cx + Math.cos(ang + 0.14) * rIn;
                const y1 = cy + Math.sin(ang + 0.14) * rIn;
                f.strokeStyle = `rgba(${i % 2 === 0 ? pal.gold : pal.accent},${(aIn * 0.74).toFixed(3)})`;
                f.lineWidth = 1.3 * s;
                f.beginPath();
                f.moveTo(x0, y0);
                f.quadraticCurveTo(cpx, cpy, x1, y1);
                f.stroke();
              }
              f.restore();
              glow(f, cx, cy, (ra + 3.5) * (1.25 + aIn * 0.95), pal.gold, aIn * 0.5);
            }

            if (flash > 0.01) {
              glow(f, cx, cy, (ra + 3.5) * (2.1 + flash * 2.1), pal.gold, flash * 0.64);
              drawStarGlint(f, cx, cy, (ra + 3.5) * 0.92 * flash, '#fffdf5', flash * 0.8);
            }

            // Diagonal Vanish & Reform optical reformation front sweeping gracefully across card
            const sweep = clamp((u - 0.36) / 0.4);
            if (sweep > 0 && sweep < 1) {
              drawDiagonalPhaseFront(f, W, H, 1 - easeInOutQuint(sweep), Math.sin(sweep * Math.PI) * 0.86, pal, s);
            }

            const finU = clamp((u - 0.72) / 0.26);
            if (finU > 0 && finU < 1) {
              sheenActive = true;
              st.sheenPos = lerp(-35, 145, easeInOutQuint(finU));
              st.sheenAlpha = Math.sin(finU * Math.PI) * 0.86;
            }
          } else {
            // Card-level synchronization during Full-Screen Cinematics ('awakening' & 'entrance')
            const env = Math.sin(u * Math.PI);
            const climax = kind === 'entrance'
              ? Math.sin(clamp((u - 0.24) / 0.36) * Math.PI)
              : Math.sin(clamp((u - 0.18) / 0.44) * Math.PI);
            tgtScale = 1 + env * 0.013 + climax * 0.007;
            tgtPulseGlow = env * 0.84 + climax * 0.48;
            tgtChroma = climax * 1.6;
            tgtSurge = 0.35 + env * 0.95;
            tgtSpeedMul = 1 + env * 0.65;
            if (u >= 0.28 && !st.act.emitted) {
              st.act.emitted = true;
              spawnBurstEmitter();
            }
            const scanU = clamp((u - 0.16) / 0.56);
            if (scanU > 0 && scanU < 1) {
              const scanY = lerp(-12 * s, H + 18 * s, easeInOutQuint(scanU));
              const scanVis = smooth(scanU / 0.15) * (1 - smooth((scanU - 0.8) / 0.2));
              drawVolumetricScanCurtain(b, f, W, H, scanY, 56 * s, scanVis * 0.75, pal, s);
            }
            const shU = clamp((u - 0.28) / 0.42);
            if (shU > 0 && shU < 1) {
              sheenActive = true;
              st.sheenPos = lerp(-35, 145, easeInOutQuint(shU));
              st.sheenAlpha = Math.sin(shU * Math.PI) * 0.9;
            }
          }

          if (u >= 1) {
            st.act = null;
          }
        } else {
          // Continuous dt-integrated ambient platinum sheen (ZERO sudden mid-sweep jumps!)
          st.sheenCycle = frac(st.sheenCycle + safeDt / 8.8);
          if (st.sheenCycle < 0.22) {
            const k = st.sheenCycle / 0.22;
            sheenActive = true;
            st.sheenPos = lerp(-35, 145, easeInOutQuint(k));
            st.sheenAlpha = Math.sin(k * Math.PI) * 0.38;
          }
        }

        // Exponentially damp every CSS motion & lighting value (silky acceleration & deceleration)
        st.speedMul = damp(st.speedMul, tgtSpeedMul, 5.5, safeDt);
        st.smoothSurge = damp(st.smoothSurge, tgtSurge, 6.5, safeDt);
        st.shakeX = damp(st.shakeX, tgtShakeX, 22, safeDt);
        st.shakeY = damp(st.shakeY, tgtShakeY, 22, safeDt);
        st.shakeRot = damp(st.shakeRot, tgtShakeRot, 22, safeDt);
        st.scale = damp(st.scale, tgtScale, 11, safeDt);
        st.chroma = damp(st.chroma, tgtChroma, 13, safeDt);
        st.pulseGlow = damp(st.pulseGlow, tgtPulseGlow, 8.5, safeDt);
        st.frameGlow = damp(st.frameGlow, 0.42 + st.smoothSurge * 0.52, 7.5, safeDt);
        if (!sheenActive) st.sheenAlpha = damp(st.sheenAlpha, 0, 11, safeDt);

        // Monotonically integrate ALL orbital, wave, twinkle & comet phases via dt
        st.rotA += safeDt * (0.22 + st.smoothSurge * 0.38);
        st.rotB -= safeDt * (0.14 + st.smoothSurge * 0.26);
        st.goldA += safeDt * (0.48 + st.smoothSurge * 0.56);
        st.blueA -= safeDt * (0.34 + st.smoothSurge * 0.36);
        st.comet1 = frac(st.comet1 + safeDt * 0.068 * st.speedMul);
        st.comet2 = frac(st.comet2 + safeDt * 0.068 * st.speedMul);
        st.groupComet = frac(st.groupComet + safeDt * 0.108 * st.speedMul);
        st.vernierPos = frac(st.vernierPos + safeDt * 0.2 * st.speedMul);
        st.wavePhase += safeDt * (1.0 * st.speedMul);
        st.twinklePhase += safeDt * (1.05 * st.speedMul);
        st.barPhase += safeDt * (1.0 + st.smoothSurge * 0.45);

        // Write smoothly damped CSS vars (NO mask-image -> DP stays 100% unclipped!)
        if (host) {
          setVar(host, '--holo-shake-x', `${st.shakeX.toFixed(2)}px`);
          setVar(host, '--holo-shake-y', `${st.shakeY.toFixed(2)}px`);
          setVar(host, '--holo-shake-rot', `${st.shakeRot.toFixed(2)}deg`);
          setVar(host, '--holo-pulse-scale', st.scale.toFixed(4));
          setVar(host, '--holo-chroma', `${st.chroma.toFixed(2)}px`);
          setVar(host, '--holo-frame-glow', st.frameGlow.toFixed(3));
          setVar(host, '--holo-pulse-glow', st.pulseGlow.toFixed(3));
          setVar(host, '--holo-sheen-pos', `${st.sheenPos.toFixed(1)}%`);
          setVar(host, '--holo-sheen-alpha', st.sheenAlpha.toFixed(3));
        }

        // Re-sync live avatar rect after transforms so gimbal stays dead-center to 0.00px
        syncLiveAvatar();
        updateAndDrawAtmosphere(safeDt, st.smoothSurge, pal);
        updateAndDrawLiveEntities(safeDt, pal);
        drawAvatarGimbal(st.smoothSurge, pal);
      };
    },
    { fullCard: true }
  );
})();
