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

  // Unified top-left key-light shadow vector
  const L_DX = 0.58;
  const L_DY = 0.81;

  // Theme-harmonized Celestial Titanium & Cryo-Champagne holographic palettes
  const PALETTES = Object.freeze({
    mono:     { accent: '136,214,255', deep: '58,108,176',  gold: '243,211,140', prism: '164,148,255' },
    emerald:  { accent: '108,236,196', deep: '32,126,98',   gold: '243,211,140', prism: '126,204,255' },
    midnight: { accent: '142,178,255', deep: '72,88,214',   gold: '243,211,140', prism: '188,144,255' },
    rose:     { accent: '242,162,202', deep: '154,52,102',  gold: '246,216,150', prism: '166,184,255' },
    amber:    { accent: '248,208,128', deep: '162,104,34',  gold: '255,232,174', prism: '140,206,255' },
    ocean:    { accent: '112,222,255', deep: '28,118,168',  gold: '243,211,140', prism: '146,162,255' }
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

  function drawPerimeterComet(g, m, headU, span, rgb, width, alpha, steps = 18) {
    if (!m || alpha <= 0.01) return;
    g.save();
    g.lineCap = 'round';
    let prev = null;
    for (let i = 0; i <= steps; i += 1) {
      const k = i / steps;
      const p = samplePath(m, headU - span * (1 - k));
      if (prev) {
        g.strokeStyle = `rgba(${rgb},${(alpha * k * k * 0.92).toFixed(3)})`;
        g.lineWidth = Math.max(0.55, width * (0.28 + 0.72 * k));
        g.beginPath();
        g.moveTo(prev[0], prev[1]);
        g.lineTo(p[0], p[1]);
        g.stroke();
      }
      prev = p;
    }
    const head = samplePath(m, headU);
    glow(g, head[0], head[1], width * 5.0, rgb, alpha * 0.76);
    g.fillStyle = `rgba(255,253,246,${clamp(alpha).toFixed(3)})`;
    g.beginPath();
    g.arc(head[0], head[1], Math.max(1.0, width * 0.7), 0, TAU);
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

    const bannerEl = host.querySelector('.effects-banner, .msg-pop-cover');
    if (bannerEl && typeof bannerEl.getBoundingClientRect === 'function') {
      const br = bannerEl.getBoundingClientRect();
      if (br.height > 16) fallback.bannerH = clamp(br.height, 40, H * 0.5);
    }

    const badgeEl = host.querySelector('.verified-badges-inline, .effects-card-name, .msg-pop-title strong');
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

    const grpEl = host.querySelector('.effects-card-groups, .msg-pop-groups, .msg-pop-actions');
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
  // Renders the 2 full-screen cinematics ('awakening' & 'entrance') across
  // the entire viewport (including Top-Layer <dialog>s), anchored to the
  // profile's exact screen coordinates, with pointer-events: none and strict
  // automatic fade-out + zero-leak teardown.
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
    const dur = kind === 'entrance' ? 5.4 : 5.0;
    let elapsed = 0;
    let alive = true;

    // Pre-seeded deterministic particle & ribbon pools for smooth dt-integrated full-screen motion
    const isAwakening = kind === 'awakening';
    const awakeningRibbons = isAwakening ? Array.from({ length: 18 }, (_, i) => ({
      baseAng: (i / 18) * TAU + seed(i, 307) * 0.24,
      curve: (i % 2 ? 1 : -1) * (0.45 + seed(i, 311) * 0.55),
      speed: 0.72 + seed(i, 313) * 0.45,
      delay: seed(i, 317) * 0.16,
      width: 1.6 + seed(i, 331) * 2.4,
      hue: i % 3 === 0 ? 'gold' : i % 4 === 0 ? 'prism' : 'accent'
    })) : [];

    const awakeningMotes = isAwakening ? Array.from({ length: 120 }, (_, i) => {
      const ang = seed(i, 337) * TAU;
      const depth = 0.35 + seed(i, 347) * 0.65;
      return {
        ang,
        rad: 18 + seed(i, 349) * 32,
        vRad: (120 + seed(i, 353) * (diag * 0.22)) * depth,
        vAng: (i % 2 ? 1 : -1) * (0.35 + seed(i, 359) * 0.85),
        size: (1.2 + seed(i, 367) * 2.8) * depth,
        delay: 0.12 + seed(i, 373) * 0.26,
        hue: i % 4 === 0 ? 'gold' : i % 6 === 0 ? 'prism' : i % 3 === 0 ? 'white' : 'accent'
      };
    }) : [];

    const entranceMeteors = !isAwakening ? Array.from({ length: 12 }, (_, i) => {
      const corner = i % 4;
      const sx = corner === 0 || corner === 3 ? -40 : vw + 40;
      const sy = corner < 2 ? -40 : vh + 40;
      return {
        sx: sx + (seed(i, 379) - 0.5) * vw * 0.35,
        sy: sy + (seed(i, 383) - 0.5) * vh * 0.35,
        ctrlOff: (i % 2 ? 1 : -1) * (90 + seed(i, 389) * 160),
        delay: seed(i, 397) * 0.16,
        width: 1.8 + seed(i, 401) * 1.8,
        hue: i % 2 === 0 ? 'gold' : 'accent'
      };
    }) : [];

    const entranceShards = !isAwakening ? Array.from({ length: 132 }, (_, i) => {
      const depth = 0.3 + seed(i, 409) * 0.7;
      return {
        x: seed(i, 419) * vw,
        y: -20 - seed(i, 421) * vh * 0.35,
        vx: (seed(i, 431) - 0.5) * 68 * depth,
        vy: (110 + seed(i, 433) * 220) * depth,
        rot: seed(i, 439) * TAU,
        spin: (i % 2 ? 1 : -1) * (1.8 + seed(i, 443) * 3.8),
        size: (1.6 + seed(i, 449) * 3.6) * depth,
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
      const maxR = Math.hypot(Math.max(ox, curW - ox), Math.max(oy, curH - oy)) * 1.15;
      const envIn = smooth(u / 0.14);
      const envOut = 1 - smooth((u - 0.74) / 0.26);
      const masterA = envIn * envOut;

      // Subtle atmospheric peripheral depth vignette (never blocks profile readability)
      const vig = g.createRadialGradient(ox, oy, Math.min(curW, curH) * 0.16, ox, oy, maxR);
      vig.addColorStop(0, 'rgba(4,8,16,0)');
      vig.addColorStop(0.55, `rgba(4,10,22,${(0.14 * masterA).toFixed(3)})`);
      vig.addColorStop(1, `rgba(2,6,14,${(0.42 * masterA).toFixed(3)})`);
      g.fillStyle = vig;
      g.fillRect(0, 0, curW, curH);

      if (isAwakening) {
        // ===================================================================
        // FULL-SCREEN CINEMATIC A — ENERGY AWAKENING
        // ===================================================================
        // 1. Inward swirling cosmic pull ribbons (0.0 -> 0.28)
        if (u < 0.34) {
          const pull = smooth(u / 0.24);
          const pullVis = Math.sin(clamp(u / 0.34) * Math.PI);
          g.save();
          g.lineCap = 'round';
          for (let i = 0; i < 10; i += 1) {
            const ang = (i / 10) * TAU + elapsed * 0.65;
            const r0 = lerp(maxR * 0.85, 36, easeInOutQuint(pull));
            const r1 = lerp(maxR * 0.52, 18, easeInOutQuint(pull));
            const x0 = ox + Math.cos(ang) * r0;
            const y0 = oy + Math.sin(ang) * r0;
            const cpx = ox + Math.cos(ang + 0.45) * ((r0 + r1) * 0.55);
            const cpy = oy + Math.sin(ang + 0.45) * ((r0 + r1) * 0.55);
            const x1 = ox + Math.cos(ang + 0.2) * r1;
            const y1 = oy + Math.sin(ang + 0.2) * r1;
            const rgb = i % 2 === 0 ? pal.accent : pal.gold;
            g.strokeStyle = `rgba(${rgb},${(pullVis * 0.55).toFixed(3)})`;
            g.lineWidth = 2.0;
            g.beginPath();
            g.moveTo(x0, y0);
            g.quadraticCurveTo(cpx, cpy, x1, y1);
            g.stroke();
          }
          g.restore();
        }

        // 2. Four Colossal Expanding Full-Screen Atmospheric Shockwaves
        const waves = [
          { start: 0.18, span: 0.58, rgb: pal.accent, w: 3.2, a: 0.72 },
          { start: 0.26, span: 0.56, rgb: pal.gold,   w: 2.6, a: 0.68 },
          { start: 0.36, span: 0.54, rgb: pal.prism,  w: 2.0, a: 0.56 },
          { start: 0.45, span: 0.50, rgb: pal.accent, w: 1.6, a: 0.46 }
        ];
        g.save();
        for (const wv of waves) {
          const ku = clamp((u - wv.start) / wv.span);
          if (ku <= 0 || ku >= 1) continue;
          const r = lerp(28, maxR * 1.05, easeOutCubic(ku));
          const al = Math.sin(ku * Math.PI) * wv.a * envOut;
          g.strokeStyle = `rgba(${wv.rgb},${(al * 0.28).toFixed(3)})`;
          g.lineWidth = wv.w * 5.2;
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

        // 3. 18 Sweeping Full-Screen Aurora Energy Trails flowing edge-to-edge
        for (let i = 0; i < awakeningRibbons.length; i += 1) {
          const rb = awakeningRibbons[i];
          const ru = clamp((u - (0.16 + rb.delay)) / 0.66);
          if (ru <= 0 || ru >= 1) continue;
          const headR = lerp(30, maxR * 1.08, easeOutExpo(ru));
          const tailR = lerp(18, maxR * 0.72, easeOutCubic(Math.max(0, ru - 0.18)));
          const al = Math.sin(ru * Math.PI) * 0.74 * envOut;
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
            rg.addColorStop(0.75, `rgba(${rgb},${(al * 0.72).toFixed(3)})`);
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
            glow(g, x1, y1, rb.width * 5.2, rgb, al * 0.55);
          }
        }

        // 4. 120 dt-Integrated Orbital Atmospheric Glowing Particles across full screen
        for (let i = 0; i < awakeningMotes.length; i += 1) {
          const m = awakeningMotes[i];
          if (u < m.delay) continue;
          const mu = clamp((u - m.delay) / (0.85 - m.delay * 0.5));
          const speedEase = Math.max(0.18, 1 - mu * 0.72);
          m.rad += safeDt * m.vRad * speedEase;
          m.ang += safeDt * m.vAng * speedEase;
          const px = ox + Math.cos(m.ang) * m.rad;
          const py = oy + Math.sin(m.ang) * m.rad;
          const al = Math.sin(clamp(mu) * Math.PI) * 0.88 * envOut;
          if (al <= 0.015) continue;
          const rgb = pickRgb(m.hue, pal);
          glow(g, px, py, m.size * 3.8, rgb, al * 0.5);
          g.fillStyle = `rgba(255,253,248,${al.toFixed(3)})`;
          g.beginPath();
          g.arc(px, py, Math.max(0.7, m.size * 0.65), 0, TAU);
          g.fill();
        }
      } else {
        // ===================================================================
        // FULL-SCREEN CINEMATIC B — LEGENDARY ENTRANCE
        // ===================================================================
        ringSpin += safeDt * (0.28 + Math.sin(u * Math.PI) * 0.55);

        // 1. Twin Diagonal Volumetric Celestial Light Pillars (God-Rays) from upper corners
        const pillarVis = Math.sin(clamp(u / 0.82) * Math.PI) * envOut;
        if (pillarVis > 0.01) {
          g.save();
          for (const side of [-1, 1]) {
            const topX = side === -1 ? curW * 0.14 : curW * 0.86;
            const beamG = g.createLinearGradient(topX, 0, ox, oy + curH * 0.25);
            beamG.addColorStop(0, `rgba(${side === -1 ? pal.accent : pal.gold},${(0.24 * pillarVis).toFixed(3)})`);
            beamG.addColorStop(0.55, `rgba(${pal.gold},${(0.09 * pillarVis).toFixed(3)})`);
            beamG.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = beamG;
            g.beginPath();
            g.moveTo(topX - curW * 0.09, 0);
            g.lineTo(topX + curW * 0.09, 0);
            g.lineTo(ox + side * 120, curH);
            g.lineTo(ox - side * 180, curH);
            g.closePath();
            g.fill();
          }
          g.restore();
        }

        // 2. Giant Rotating Celestial Astrolabe Orbital Rings spanning wide across the viewport
        const ringAlpha = smooth(u / 0.24) * (1 - smooth((u - 0.68) / 0.32));
        if (ringAlpha > 0.01) {
          const baseRad = Math.min(curW, curH) * lerp(0.56, 0.34, easeOutExpo(clamp(u / 0.35)));
          g.save();
          g.lineCap = 'round';
          // Outer golden segmented meridian
          for (let i = 0; i < 4; i += 1) {
            const a0 = ringSpin + (i * TAU) / 4;
            g.strokeStyle = `rgba(${pal.gold},${(ringAlpha * 0.44).toFixed(3)})`;
            g.lineWidth = 2.0;
            g.beginPath();
            g.arc(ox, oy, Math.max(12, baseRad * 1.18), a0, a0 + 1.05);
            g.stroke();
          }
          // Counter-rotating sapphire reticle with compass ticks
          g.strokeStyle = `rgba(${pal.accent},${(ringAlpha * 0.36).toFixed(3)})`;
          g.lineWidth = 1.25;
          g.beginPath();
          g.arc(ox, oy, Math.max(10, baseRad * 0.88), -ringSpin * 1.3, -ringSpin * 1.3 + TAU * 0.82);
          g.stroke();
          for (let i = 0; i < 36; i += 1) {
            const a = -ringSpin * 0.8 + (i / 36) * TAU;
            const maj = i % 9 === 0;
            const r0 = baseRad * (maj ? 0.82 : 0.86);
            const r1 = baseRad * (maj ? 0.94 : 0.9);
            g.strokeStyle = `rgba(${maj ? pal.gold : pal.accent},${(ringAlpha * (maj ? 0.58 : 0.25)).toFixed(3)})`;
            g.lineWidth = maj ? 1.6 : 0.9;
            g.beginPath();
            g.moveTo(ox + Math.cos(a) * r0, oy + Math.sin(a) * r0);
            g.lineTo(ox + Math.cos(a) * r1, oy + Math.sin(a) * r1);
            g.stroke();
          }
          g.restore();
        }

        // 3. 12 Hyperbolic Corner Comets converging on the Profile Reveal Peak (0.04 -> 0.34)
        for (let i = 0; i < entranceMeteors.length; i += 1) {
          const mt = entranceMeteors[i];
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
          const al = Math.sin(mu * Math.PI) * 0.9;
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
            glow(g, x1, y1, mt.width * 4.5, rgb, al * 0.65);
          }
        }

        // 4. Grand Anamorphic Horizon Lens-Flare Reveal (peak at u ~ 0.30 -> graceful taper)
        const flareU = clamp((u - 0.25) / 0.48);
        if (flareU > 0 && flareU < 1) {
          const flA = Math.sin(flareU * Math.PI) * envOut;
          const halfSpan = curW * lerp(0.18, 0.72, easeOutExpo(flareU));
          const fg = g.createLinearGradient(ox - halfSpan, oy, ox + halfSpan, oy);
          fg.addColorStop(0, `rgba(${pal.accent},0)`);
          fg.addColorStop(0.28, `rgba(${pal.accent},${(0.42 * flA).toFixed(3)})`);
          fg.addColorStop(0.5, `rgba(255,252,240,${(0.9 * flA).toFixed(3)})`);
          fg.addColorStop(0.72, `rgba(${pal.gold},${(0.48 * flA).toFixed(3)})`);
          fg.addColorStop(1, `rgba(${pal.gold},0)`);

          // Soft anamorphic ribbon glow
          g.save();
          g.fillStyle = fg;
          g.globalAlpha = 0.55 * flA;
          g.fillRect(ox - halfSpan, oy - 7 * flA, halfSpan * 2, 14 * flA);
          // Razor optical horizon line
          g.globalAlpha = 1;
          g.strokeStyle = fg;
          g.lineWidth = 2.2;
          g.beginPath();
          g.moveTo(ox - halfSpan, oy);
          g.lineTo(ox + halfSpan, oy);
          g.stroke();
          g.restore();

          glow(g, ox, oy, 110 * flA, pal.gold, 0.52 * flA);
          drawStarGlint(g, ox, oy, 42 * flA, '#fffdf5', 0.85 * flA);
        }

        // 5. 132 dt-Integrated 3-Layer Parallax Golden Prism Shards & Celestial Star Rain
        if (u > 0.24) {
          const rainA = smooth((u - 0.24) / 0.14) * envOut;
          for (let i = 0; i < entranceShards.length; i += 1) {
            const sh = entranceShards[i];
            sh.x += safeDt * sh.vx;
            sh.y += safeDt * sh.vy;
            sh.rot += safeDt * sh.spin;
            if (sh.y > curH + 24) sh.y = -20;
            if (sh.x < -20) sh.x = curW + 20;
            if (sh.x > curW + 20) sh.x = -20;
            const edgeFade = smooth(sh.y / 60) * (1 - smooth((sh.y - (curH - 70)) / 70));
            const al = rainA * edgeFade * 0.86;
            if (al <= 0.02) continue;
            const rgb = pickRgb(sh.hue, pal);
            if (sh.star) {
              glow(g, sh.x, sh.y, sh.size * 2.8, rgb, al * 0.52);
              drawStarGlint(g, sh.x, sh.y, sh.size * 1.45, '#fffdf4', al);
            } else {
              g.save();
              g.translate(sh.x, sh.y);
              g.rotate(sh.rot);
              g.globalAlpha = al;
              g.fillStyle = `rgba(${rgb},0.92)`;
              g.beginPath();
              g.moveTo(0, -sh.size);
              g.lineTo(sh.size * 0.62, 0);
              g.lineTo(0, sh.size * 0.85);
              g.lineTo(-sh.size * 0.52, 0);
              g.closePath();
              g.fill();
              g.restore();
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
  // =========================================================================
  api.registerEffect(
    'creator_astral_sovereign',
    'Astral Sovereign',
    'Creator',
    'Exclusive founder-only hologram with 360° top/bottom/side cosmic fields, zero-teleport dt-integrated physics, 3 card animations + 2 full-screen cinematics, and Hollywood SFX.',
    3,
    (S) => {
      const { W, H, cx, cy, ra, s, full, b, f, host, onTrigger, onCleanup } = S;
      const zones = measureHostZones(host, W, H, cx, cy, ra);
      const frameM = full ? buildRoundedFrame(W, H, 3.5 * s, 18 * s) : null;
      const groupsM = full ? buildRoundedFrame(zones.groupsRect.w, zones.groupsRect.h, 0.75 * s, 13 * s) : null;

      // =====================================================================
      // 100% dt-INTEGRATED CONTINUOUS AMBIENT POOLS (SIDES + TOP + BOTTOM)
      // Zero time-dilation teleporting: every particle owns its continuous
      // coordinate and advances monotonically via safeDt * velocity * speedMul!
      // =====================================================================

      // --- LEFT & RIGHT BILATERAL FLANKS ---
      const flankOrbCount = full ? 68 : 26;
      const flankOrbs = Array.from({ length: flankOrbCount }, (_, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const edgeFrac = 0.018 + Math.pow(seed(i, 3), 1.35) * 0.145;
        const depth = 0.28 + seed(i, 7) * 0.72;
        return {
          side,
          xBase: side === -1 ? W * edgeFrac : W * (1 - edgeFrac),
          y: seed(i, 11),
          speed: (0.022 + seed(i, 13) * 0.044) * (0.65 + depth * 0.6),
          driftAmp: (3.2 + seed(i, 17) * 8.2) * s * depth,
          phase: seed(i, 19) * TAU,
          depth,
          size: (0.65 + seed(i, 23) * 1.65) * s * (0.6 + depth * 0.55),
          hue: i % 5 === 0 ? 'gold' : i % 7 === 0 ? 'prism' : i % 4 === 0 ? 'white' : 'accent'
        };
      });

      const flankSparkleCount = full ? 24 : 10;
      const flankSparkles = Array.from({ length: flankSparkleCount }, (_, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const edgeFrac = 0.022 + seed(i, 29) * 0.125;
        return {
          xBase: side === -1 ? W * edgeFrac : W * (1 - edgeFrac),
          y: 0.05 + seed(i, 31) * 0.9,
          speed: 0.012 + seed(i, 37) * 0.022,
          phase: seed(i, 41) * TAU,
          rate: 1.6 + seed(i, 43) * 2.2,
          size: (2.2 + seed(i, 47) * 3.0) * s,
          gold: i % 2 === 0
        };
      });

      const flankShardCount = full ? 18 : 8;
      const flankShards = Array.from({ length: flankShardCount }, (_, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const edgeFrac = 0.025 + seed(i, 53) * 0.12;
        return {
          xBase: side === -1 ? W * edgeFrac : W * (1 - edgeFrac),
          y: seed(i, 59),
          speed: 0.017 + seed(i, 61) * 0.03,
          phase: seed(i, 67) * TAU,
          rot: seed(i, 68) * TAU,
          spin: side * (0.45 + seed(i, 71) * 0.9),
          size: (1.9 + seed(i, 73) * 2.4) * s,
          chevron: i % 3 === 0,
          hue: i % 3 === 0 ? 'gold' : i % 5 === 0 ? 'prism' : 'accent'
        };
      });

      const flankStreakCount = full ? 10 : 4;
      const flankStreaks = Array.from({ length: flankStreakCount }, (_, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const edgeFrac = 0.02 + seed(i, 79) * 0.085;
        return {
          xBase: side === -1 ? W * edgeFrac : W * (1 - edgeFrac),
          p: seed(i, 83),
          rate: 0.17 + seed(i, 89) * 0.15,
          len: (24 + seed(i, 97) * 38) * s,
          width: (0.95 + seed(i, 101) * 1.0) * s,
          gold: i % 2 === 1
        };
      });

      // --- TOP CROWN ZONE (0%..25% H across full width) ---
      const topOrbCount = full ? 28 : 10;
      const topOrbs = Array.from({ length: topOrbCount }, (_, i) => {
        const depth = 0.3 + seed(i, 503) * 0.7;
        return {
          x: 0.04 + seed(i, 509) * 0.92,
          yBase: 0.025 + seed(i, 521) * 0.21,
          vx: (i % 2 ? 1 : -1) * (0.014 + seed(i, 523) * 0.028) * depth,
          bobAmp: (2.2 + seed(i, 541) * 5.2) * s * depth,
          phase: seed(i, 547) * TAU,
          size: (0.7 + seed(i, 557) * 1.55) * s * (0.6 + depth * 0.5),
          depth,
          hue: i % 3 === 0 ? 'gold' : i % 5 === 0 ? 'prism' : 'accent'
        };
      });

      const topSparkleCount = full ? 12 : 4;
      const topSparkles = Array.from({ length: topSparkleCount }, (_, i) => ({
        x: 0.07 + seed(i, 563) * 0.86,
        y: 0.03 + seed(i, 569) * 0.19,
        vx: (i % 2 ? 1 : -1) * (0.008 + seed(i, 571) * 0.014),
        phase: seed(i, 577) * TAU,
        rate: 1.5 + seed(i, 587) * 2.1,
        size: (2.1 + seed(i, 593) * 2.8) * s,
        gold: i % 2 === 0
      }));

      const topStreamCount = full ? 6 : 2;
      const topStreams = Array.from({ length: topStreamCount }, (_, i) => ({
        dir: i % 2 === 0 ? 1 : -1,
        p: seed(i, 599),
        y: (8 + seed(i, 601) * Math.max(24, zones.bannerH * 0.72)),
        rate: 0.16 + seed(i, 607) * 0.14,
        len: (28 + seed(i, 613) * 44) * s,
        width: (0.95 + seed(i, 617) * 0.9) * s,
        gold: i % 2 === 1
      }));

      // --- BOTTOM HORIZON ZONE (76%..100% H across full width) ---
      const bottomEmberCount = full ? 30 : 10;
      const bottomEmbers = Array.from({ length: bottomEmberCount }, (_, i) => {
        const depth = 0.32 + seed(i, 619) * 0.68;
        return {
          xBase: 0.05 + seed(i, 631) * 0.9,
          p: seed(i, 641),
          speed: (0.14 + seed(i, 643) * 0.2) * (0.7 + depth * 0.5),
          riseH: (34 + seed(i, 647) * 58) * s,
          swayAmp: (4 + seed(i, 653) * 9) * s,
          phase: seed(i, 659) * TAU,
          size: (0.75 + seed(i, 661) * 1.65) * s,
          depth,
          hue: i % 2 === 0 ? 'gold' : i % 5 === 0 ? 'prism' : 'accent'
        };
      });

      const bottomSparkleCount = full ? 12 : 4;
      const bottomSparkles = Array.from({ length: bottomSparkleCount }, (_, i) => ({
        x: 0.08 + seed(i, 673) * 0.84,
        y: 0.8 + seed(i, 677) * 0.16,
        vx: (i % 2 ? 1 : -1) * (0.008 + seed(i, 683) * 0.015),
        phase: seed(i, 691) * TAU,
        rate: 1.6 + seed(i, 701) * 2.2,
        size: (2.0 + seed(i, 709) * 2.9) * s,
        gold: i % 2 === 1
      }));

      const bottomStreamCount = full ? 6 : 2;
      const bottomStreams = Array.from({ length: bottomStreamCount }, (_, i) => ({
        dir: i % 2 === 0 ? -1 : 1,
        p: seed(i, 719),
        y: H - (7 + seed(i, 727) * 28) * s,
        rate: 0.15 + seed(i, 733) * 0.14,
        len: (28 + seed(i, 739) * 46) * s,
        width: (0.95 + seed(i, 743) * 0.95) * s,
        gold: i % 2 === 0
      }));

      // =====================================================================
      // LIVE PHYSICS PARTICLE QUEUE — NEVER TELEPORTS OR ABRUPTLY DISAPPEARS
      // Every burst comet, spinning shard, shear spark & ring completes its
      // natural [0..1] curve smoothly even across animation transitions!
      // =====================================================================
      const liveParticles = [];
      const liveRings = [];

      const emitSpark = (x, y, vx, vy, sz, lifeDur, hue, isStar = true) => {
        if (liveParticles.length > 260) liveParticles.shift();
        liveParticles.push({ kind: isStar ? 'star' : 'orb', x, y, vx, vy, sz, age: 0, dur: lifeDur, hue, drag: 1.6 });
      };

      const emitShard = (x, y, vx, vy, sz, rot, spin, lifeDur, hue) => {
        if (liveParticles.length > 260) liveParticles.shift();
        liveParticles.push({ kind: 'shard', x, y, vx, vy, sz, rot, spin, age: 0, dur: lifeDur, hue, drag: 1.35 });
      };

      const emitComet = (x, y, vx, vy, width, lifeDur, hue) => {
        if (liveParticles.length > 260) liveParticles.shift();
        liveParticles.push({ kind: 'comet', x, y, px: x, py: y, vx, vy, width, age: 0, dur: lifeDur, hue, drag: 1.5 });
      };

      const emitRing = (x, y, rStart, rEnd, width, dur, hue, alpha = 0.72) => {
        if (liveRings.length > 24) liveRings.shift();
        liveRings.push({ x, y, rStart, rEnd, width, age: 0, dur, hue, alpha });
      };

      const spawnShakeEmitter = () => {
        emitRing(cx, cy, ra * 1.05, Math.hypot(W, H) * 0.72, 1.9 * s, 1.35, 'accent', 0.62);
        emitRing(cx, cy, ra * 0.95, Math.hypot(W, H) * 0.56, 1.15 * s, 1.1, 'gold', 0.54);
        for (let i = 0; i < (full ? 32 : 10); i += 1) {
          const fromSide = full && i >= 12;
          const side = i % 2 === 0 ? -1 : 1;
          const a = (i / 12) * TAU + seed(i, 809) * 0.4;
          const x = fromSide ? (side === -1 ? 8 * s : W - 8 * s) : cx + Math.cos(a) * ra * 1.12;
          const y = fromSide ? H * (0.1 + seed(i, 811) * 0.8) : cy + Math.sin(a) * ra * 1.12;
          const vx = fromSide ? side * (-42 - seed(i, 821) * 58) * s : Math.cos(a) * (62 + seed(i, 823) * 84) * s;
          const vy = fromSide ? (seed(i, 827) - 0.5) * 60 * s : Math.sin(a) * (54 + seed(i, 829) * 76) * s;
          emitSpark(x, y, vx, vy, (1.3 + seed(i, 839) * 1.9) * s, 0.85 + seed(i, 853) * 0.55, i % 3 === 0 ? 'gold' : 'accent', true);
        }
      };

      const spawnPulseEmitter = () => {
        emitRing(cx, cy, ra * 0.95, Math.hypot(W, H) * 0.92, 2.3 * s, 1.85, 'gold', 0.78);
        emitRing(cx, cy, ra * 0.9, Math.hypot(W, H) * 0.88, 1.8 * s, 2.15, 'accent', 0.68);
        emitRing(cx, cy, ra * 0.85, Math.hypot(W, H) * 0.84, 1.3 * s, 2.45, 'prism', 0.54);
        if (full) {
          emitRing(zones.badgeX, zones.badgeY, 5 * s, 38 * s, 1.4 * s, 1.35, 'gold', 0.72);
        }
        for (let i = 0; i < (full ? 24 : 8); i += 1) {
          const x = full ? (i % 2 === 0 ? W * (0.04 + seed(i, 857) * 0.14) : W * (0.82 + seed(i, 859) * 0.14)) : cx;
          const y = H * (0.2 + seed(i, 863) * 0.72);
          emitSpark(x, y, (seed(i, 877) - 0.5) * 18 * s, (-32 - seed(i, 881) * 44) * s, (1.2 + seed(i, 883) * 1.7) * s, 1.5 + seed(i, 887) * 0.8, i % 2 === 0 ? 'gold' : 'accent', false);
        }
      };

      const spawnBurstEmitter = () => {
        emitRing(cx, cy, ra * 0.8, Math.hypot(W, H) * 0.94, 2.6 * s, 1.55, 'gold', 0.85);
        emitRing(cx, cy, ra * 0.8, Math.hypot(W, H) * 0.78, 1.7 * s, 1.3, 'accent', 0.72);
        // 24 Tapered High-Velocity Light Comets (core + flanks + top/bottom)
        for (let i = 0; i < (full ? 24 : 10); i += 1) {
          const a = (i / (full ? 24 : 10)) * TAU + seed(i, 907) * 0.28;
          const spd = (125 + seed(i, 911) * 155) * s;
          emitComet(cx, cy, Math.cos(a) * spd, Math.sin(a) * spd, (1.1 + seed(i, 919) * 1.2) * s, 1.15 + seed(i, 929) * 0.65, i % 3 === 0 ? 'gold' : i % 5 === 0 ? 'prism' : 'accent');
        }
        // 34 Spinning Holographic Diamond Shards
        for (let i = 0; i < (full ? 34 : 12); i += 1) {
          const a = (i / (full ? 34 : 12)) * TAU + seed(i, 937) * 0.35;
          const spd = (85 + seed(i, 941) * 145) * s;
          emitShard(cx, cy, Math.cos(a) * spd, Math.sin(a) * spd, (1.8 + seed(i, 947) * 2.4) * s, seed(i, 953) * TAU, (i % 2 ? 1 : -1) * (3.5 + seed(i, 967) * 4.2), 1.45 + seed(i, 971) * 0.75, i % 3 === 0 ? 'gold' : i % 4 === 0 ? 'prism' : 'accent');
        }
        // 40 Zero-G Cascading Sparks across top, bottom & sides
        for (let i = 0; i < (full ? 40 : 12); i += 1) {
          const a = seed(i, 977) * TAU;
          const spd = (55 + seed(i, 983) * 120) * s;
          emitSpark(cx, cy, Math.cos(a) * spd, Math.sin(a) * spd, (1.0 + seed(i, 991) * 1.7) * s, 1.55 + seed(i, 997) * 0.85, i % 2 === 0 ? 'gold' : 'accent', true);
        }
      };

      // Continuous monotonic state variables (ZERO sudden snaps!)
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
        // Current active choreographed act
        act: null, // { kind, elapsed, dur, emitted }
        autoTimer: 0,
        autoStep: 0,
        cinema: null
      };

      const ACT_DURS = { shake: 2.5, pulse: 3.4, burst: 4.0, awakening: 5.0, entrance: 5.4 };
      const AUTO_ORDER = ['shake', 'pulse', 'burst'];

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
            st.autoTimer = 1.6;
            startAct('pulse', { playSfx: !opts.silent });
            return;
          }
          startAct(kind, { playSfx: !opts.silent });
        });
      }

      // ---------------------------------------------------------------------
      // DRAW 3D SCULPTED CHRONO-ASTROLABE AVATAR GIMBAL
      // ---------------------------------------------------------------------
      const drawAvatarGimbal = (energy, pal) => {
        const expand = 1 + energy * 0.035;
        const rOuter = Math.max(4, ra * 1.24 * expand);
        const rMid = Math.max(3, ra * 1.12 * expand);
        const rInner = Math.max(2, ra * 1.02 * expand);

        glow(b, cx, cy, ra * (2.25 + energy * 0.4), pal.accent, 0.24 + energy * 0.14);
        glow(b, cx - ra * 0.28, cy - ra * 0.32, ra * 1.48, pal.gold, 0.16 + energy * 0.12);

        b.save();
        b.globalAlpha = 0.48;
        b.strokeStyle = 'rgba(2,5,12,0.72)';
        b.lineWidth = Math.max(1.2, 4.0 * s);
        b.beginPath();
        b.arc(cx + L_DX * 2.1 * s, cy + L_DY * 2.1 * s, rOuter, 0, TAU);
        b.stroke();
        b.restore();

        f.save();
        const gradTi = f.createLinearGradient(cx - rOuter, cy - rOuter, cx + rOuter, cy + rOuter);
        gradTi.addColorStop(0, '#ffffff');
        gradTi.addColorStop(0.28, '#c5d6e8');
        gradTi.addColorStop(0.58, '#4e637d');
        gradTi.addColorStop(0.82, '#dbe6f4');
        gradTi.addColorStop(1, '#2c394b');

        f.lineCap = 'round';
        for (let i = 0; i < 3; i += 1) {
          const a0 = st.rotA + (i * TAU) / 3;
          const a1 = a0 + 1.48;
          f.strokeStyle = 'rgba(2,5,11,0.54)';
          f.lineWidth = Math.max(1.1, 2.9 * s);
          f.beginPath();
          f.arc(cx + L_DX * 1.25 * s, cy + L_DY * 1.25 * s, rOuter, a0, a1);
          f.stroke();

          f.strokeStyle = gradTi;
          f.lineWidth = Math.max(0.95, 1.95 * s);
          f.beginPath();
          f.arc(cx, cy, rOuter, a0, a1);
          f.stroke();

          f.strokeStyle = 'rgba(255,253,245,0.6)';
          f.lineWidth = Math.max(0.45, 0.74 * s);
          f.beginPath();
          f.arc(cx, cy, rOuter + 0.85 * s, a0 + 0.12, a0 + 0.72);
          f.stroke();
        }

        f.strokeStyle = `rgba(${pal.accent},0.46)`;
        f.lineWidth = Math.max(0.5, 0.84 * s);
        const tickTotal = full ? 24 : 18;
        for (let i = 0; i < tickTotal; i += 1) {
          const a = st.rotB + (i / tickTotal) * TAU;
          const major = i % 6 === 0;
          const r0 = rMid - (major ? 2.4 : 1.05) * s;
          const r1 = rMid + (major ? 2.4 : 1.05) * s;
          f.beginPath();
          f.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          f.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
          f.stroke();
        }

        const rGold = rInner + 2.3 * s;
        f.strokeStyle = `rgba(${pal.gold},0.8)`;
        f.lineWidth = Math.max(0.75, 1.3 * s);
        f.beginPath();
        f.arc(cx, cy, rGold, st.goldA - 0.9, st.goldA);
        f.stroke();

        const nx = cx + Math.cos(st.goldA) * rGold;
        const ny = cy + Math.sin(st.goldA) * rGold;
        glow(f, nx, ny, 7.6 * s, pal.gold, 0.88);
        f.fillStyle = 'rgba(255,252,238,0.96)';
        f.beginPath();
        f.arc(nx, ny, Math.max(1.0, 1.8 * s), 0, TAU);
        f.fill();

        const bx = cx + Math.cos(st.blueA) * rOuter;
        const by = cy + Math.sin(st.blueA) * rOuter;
        glow(f, bx, by, 6.2 * s, pal.accent, 0.72);
        f.fillStyle = 'rgba(235,249,255,0.94)';
        f.beginPath();
        f.arc(bx, by, Math.max(0.85, 1.35 * s), 0, TAU);
        f.fill();
        f.restore();
      };

      // ---------------------------------------------------------------------
      // DRAW 360° COHESIVE AMBIENT FIELD (LEFT + RIGHT + TOP CROWN + BOTTOM)
      // Strictly dt-integrated: ZERO teleporting, ZERO sudden jumps!
      // ---------------------------------------------------------------------
      const updateAndDraw360Field = (t, safeDt, surge, pal) => {
        const boost = 1 + surge * 0.65;
        const sp = st.speedMul;

        // 1. Atmospheric glow balancing Left, Right, Top Crown & Bottom Base Emitter
        glow(b, W * 0.05, H * (0.28 + 0.08 * Math.sin(t * 0.35)), W * 0.28, pal.deep, 0.24 + surge * 0.14);
        glow(b, W * 0.95, H * (0.34 + 0.08 * Math.cos(t * 0.31)), W * 0.28, pal.deep, 0.24 + surge * 0.14);
        glow(b, W * 0.5, H * 0.05, W * 0.52, pal.accent, 0.16 + surge * 0.12);
        glow(b, W * 0.5, H * 0.97, W * 0.56, pal.gold, 0.18 + surge * 0.14);
        glow(b, W * 0.04, H * 0.78, W * 0.26, pal.accent, 0.14 + surge * 0.12);
        glow(b, W * 0.96, H * 0.74, W * 0.26, pal.gold, 0.13 + surge * 0.12);

        // 2. TOP CROWN: Dual luminous horizon arcs across upper banner sky
        b.save();
        const topArcG = b.createLinearGradient(0, 8, W, zones.bannerH);
        topArcG.addColorStop(0, `rgba(${pal.accent},0)`);
        topArcG.addColorStop(0.28, `rgba(${pal.accent},${(0.56 * (0.6 + surge * 0.4)).toFixed(3)})`);
        topArcG.addColorStop(0.68, `rgba(${pal.gold},${(0.48 * (0.6 + surge * 0.4)).toFixed(3)})`);
        topArcG.addColorStop(1, `rgba(${pal.accent},0)`);
        b.strokeStyle = topArcG;
        b.lineWidth = Math.max(0.8, 1.2 * s);
        b.beginPath();
        b.moveTo(0, zones.bannerH * 0.82);
        b.quadraticCurveTo(W * 0.52, zones.bannerH * 0.22 + Math.sin(st.wavePhase * 0.5) * 3 * s, W, zones.bannerH * 0.64);
        b.stroke();

        b.strokeStyle = `rgba(${pal.gold},${(0.28 + surge * 0.22).toFixed(3)})`;
        b.lineWidth = 0.85 * s;
        b.beginPath();
        b.moveTo(W * 0.08, 8 * s);
        b.quadraticCurveTo(W * 0.5, 22 * s + Math.cos(st.wavePhase * 0.65) * 2.5 * s, W * 0.92, 8 * s);
        b.stroke();
        b.restore();

        // 3. TOP CROWN: Floating stardust, celestial sparkles & flowing horizontal streams
        for (let i = 0; i < topOrbs.length; i += 1) {
          const o = topOrbs[i];
          o.x += safeDt * o.vx * sp;
          if (o.x > 1.04) o.x -= 1.08;
          else if (o.x < -0.04) o.x += 1.08;
          const px = o.x * W;
          const py = o.yBase * H + Math.sin(st.wavePhase * 0.9 + o.phase) * o.bobAmp;
          const edgeA = smooth(o.x / 0.1) * (1 - smooth((o.x - 0.9) / 0.1));
          const tw = 0.45 + 0.55 * Math.pow(Math.sin(t * 2.1 + o.phase), 2);
          const al = clamp(edgeA * tw * (0.35 + 0.55 * o.depth + surge * 0.24));
          if (al <= 0.015) continue;
          const rgb = pickRgb(o.hue, pal);
          glow(f, px, py, o.size * 3.5, rgb, al * 0.48);
          f.fillStyle = `rgba(255,253,248,${al.toFixed(3)})`;
          f.beginPath();
          f.arc(px, py, Math.max(0.45, o.size), 0, TAU);
          f.fill();
        }

        for (let i = 0; i < topSparkles.length; i += 1) {
          const k = topSparkles[i];
          k.x += safeDt * k.vx * sp;
          if (k.x > 0.96) k.x = 0.05;
          else if (k.x < 0.04) k.x = 0.95;
          const tw = Math.pow(0.5 + 0.5 * Math.sin(t * k.rate + k.phase), 2.3);
          const al = clamp((0.16 + tw * 0.82) * (0.8 + surge * 0.35));
          const rgb = k.gold ? pal.gold : pal.accent;
          const px = k.x * W;
          const py = k.y * H;
          glow(f, px, py, k.size * 2.3, rgb, al * 0.48);
          drawStarGlint(f, px, py, k.size * (0.55 + tw * 0.6), k.gold ? '#fff7dc' : '#e8f8ff', al);
        }

        for (let i = 0; i < topStreams.length; i += 1) {
          const ts = topStreams[i];
          ts.p += safeDt * ts.rate * sp;
          if (ts.p > 1) ts.p -= 1;
          const xHead = ts.dir > 0 ? lerp(-ts.len, W + ts.len, ts.p) : lerp(W + ts.len, -ts.len, ts.p);
          const xTail = xHead - ts.dir * ts.len;
          const y = ts.y + Math.sin(st.wavePhase + i * 1.7) * 2.5 * s;
          const al = Math.sin(ts.p * Math.PI) * (0.54 + surge * 0.36);
          if (al <= 0.02) continue;
          const rgb = ts.gold ? pal.gold : pal.accent;
          const sg = f.createLinearGradient(xTail, y, xHead, y);
          sg.addColorStop(0, `rgba(${rgb},0)`);
          sg.addColorStop(0.7, `rgba(${rgb},${(al * 0.68).toFixed(3)})`);
          sg.addColorStop(1, `rgba(255,253,245,${clamp(al).toFixed(3)})`);
          f.save();
          f.strokeStyle = sg;
          f.lineWidth = ts.width;
          f.lineCap = 'round';
          f.beginPath();
          f.moveTo(xTail, y);
          f.lineTo(xHead, y);
          f.stroke();
          f.restore();
          glow(f, xHead, y, ts.width * 3.8, rgb, al * 0.55);
        }

        // 4. BOTTOM HORIZON: Holographic base emitter waves, rising embers, sparkles & lower streams
        if (full) {
          const baseGrad = b.createLinearGradient(0, H - 56 * s, 0, H);
          baseGrad.addColorStop(0, 'rgba(0,0,0,0)');
          baseGrad.addColorStop(0.65, `rgba(${pal.accent},${(0.08 + surge * 0.08).toFixed(3)})`);
          baseGrad.addColorStop(1, `rgba(${pal.gold},${(0.18 + surge * 0.14).toFixed(3)})`);
          b.fillStyle = baseGrad;
          b.fillRect(0, H - 56 * s, W, 56 * s);

          // Twin flowing sine-harmonic lower energy waves along bottom edge
          f.save();
          for (let wIdx = 0; wIdx < 2; wIdx += 1) {
            const wRgb = wIdx === 0 ? pal.accent : pal.gold;
            const wg = f.createLinearGradient(12 * s, 0, W - 12 * s, 0);
            wg.addColorStop(0, `rgba(${wRgb},0)`);
            wg.addColorStop(0.25, `rgba(${wRgb},${((0.36 + surge * 0.26) * (wIdx === 0 ? 1 : 0.85)).toFixed(3)})`);
            wg.addColorStop(0.75, `rgba(${wRgb},${((0.36 + surge * 0.26) * (wIdx === 0 ? 1 : 0.85)).toFixed(3)})`);
            wg.addColorStop(1, `rgba(${wRgb},0)`);
            f.strokeStyle = wg;
            f.lineWidth = (wIdx === 0 ? 1.2 : 0.95) * s;
            f.beginPath();
            const segs = 28;
            for (let j = 0; j <= segs; j += 1) {
              const k = j / segs;
              const x = lerp(12 * s, W - 12 * s, k);
              const y = H - (9 + wIdx * 5.5) * s + Math.sin(k * 10 + st.wavePhase * (wIdx === 0 ? 1.3 : -1.05) + wIdx * 1.6) * (2.6 + surge * 1.8) * s * Math.sin(k * Math.PI);
              if (j === 0) f.moveTo(x, y);
              else f.lineTo(x, y);
            }
            f.stroke();
          }
          f.restore();
        }

        for (let i = 0; i < bottomEmbers.length; i += 1) {
          const em = bottomEmbers[i];
          em.p += safeDt * em.speed * sp;
          if (em.p > 1) em.p -= 1;
          const px = em.xBase * W + Math.sin(st.wavePhase * 1.1 + em.phase) * em.swayAmp;
          const py = H - 4 * s - em.p * em.riseH;
          const al = clamp(Math.sin(em.p * Math.PI) * (0.36 + 0.54 * em.depth + surge * 0.24));
          if (al <= 0.015) continue;
          const rgb = pickRgb(em.hue, pal);
          const target = em.depth > 0.6 ? f : b;
          glow(target, px, py, em.size * 3.4, rgb, al * 0.5);
          target.fillStyle = `rgba(255,252,244,${al.toFixed(3)})`;
          target.beginPath();
          target.arc(px, py, Math.max(0.45, em.size * (1 - em.p * 0.35)), 0, TAU);
          target.fill();
        }

        for (let i = 0; i < bottomSparkles.length; i += 1) {
          const k = bottomSparkles[i];
          k.x += safeDt * k.vx * sp;
          if (k.x > 0.94) k.x = 0.06;
          else if (k.x < 0.06) k.x = 0.94;
          const tw = Math.pow(0.5 + 0.5 * Math.sin(t * k.rate + k.phase), 2.3);
          const al = clamp((0.15 + tw * 0.82) * (0.8 + surge * 0.35));
          const rgb = k.gold ? pal.gold : pal.accent;
          const px = k.x * W;
          const py = k.y * H;
          glow(f, px, py, k.size * 2.4, rgb, al * 0.5);
          drawStarGlint(f, px, py, k.size * (0.55 + tw * 0.62), k.gold ? '#fff7dc' : '#e8f8ff', al);
        }

        for (let i = 0; i < bottomStreams.length; i += 1) {
          const bs = bottomStreams[i];
          bs.p += safeDt * bs.rate * sp;
          if (bs.p > 1) bs.p -= 1;
          const xHead = bs.dir > 0 ? lerp(-bs.len, W + bs.len, bs.p) : lerp(W + bs.len, -bs.len, bs.p);
          const xTail = xHead - bs.dir * bs.len;
          const y = bs.y + Math.cos(st.wavePhase + i * 2.1) * 2.0 * s;
          const al = Math.sin(bs.p * Math.PI) * (0.56 + surge * 0.36);
          if (al <= 0.02) continue;
          const rgb = bs.gold ? pal.gold : pal.accent;
          const sg = f.createLinearGradient(xTail, y, xHead, y);
          sg.addColorStop(0, `rgba(${rgb},0)`);
          sg.addColorStop(0.7, `rgba(${rgb},${(al * 0.68).toFixed(3)})`);
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
          glow(f, xHead, y, bs.width * 3.8, rgb, al * 0.55);
        }

        // 5. LEFT & RIGHT BILATERAL FLANKS: Conduits, vernier ticks, brackets & harmonic bars
        if (full) {
          const yTop = 26 * s;
          const yBot = H - 24 * s;
          for (const side of [-1, 1]) {
            const xRail = side === -1 ? 6.5 * s : W - 6.5 * s;
            const railGrad = f.createLinearGradient(xRail, yTop, xRail, yBot);
            railGrad.addColorStop(0, `rgba(${pal.accent},0)`);
            railGrad.addColorStop(0.16, `rgba(${pal.accent},${clamp(0.34 * boost).toFixed(3)})`);
            railGrad.addColorStop(0.5, `rgba(${pal.gold},${clamp(0.44 * boost).toFixed(3)})`);
            railGrad.addColorStop(0.84, `rgba(${pal.accent},${clamp(0.34 * boost).toFixed(3)})`);
            railGrad.addColorStop(1, `rgba(${pal.accent},0)`);

            b.save();
            b.strokeStyle = railGrad;
            b.lineWidth = (2.8 + surge * 1.4) * s;
            b.beginPath();
            b.moveTo(xRail, yTop);
            b.lineTo(xRail, yBot);
            b.stroke();
            b.restore();

            f.save();
            f.strokeStyle = railGrad;
            f.lineWidth = 0.9 * s;
            f.beginPath();
            f.moveTo(xRail, yTop);
            f.lineTo(xRail, yBot);
            f.stroke();

            for (const fracY of [0.22, 0.48, 0.74]) {
              const ny = lerp(yTop, yBot, fracY);
              const nPulse = 0.55 + 0.45 * Math.sin(t * 2.2 + fracY * 7 + (side > 0 ? 1.4 : 0));
              const al = clamp(0.48 + nPulse * 0.34 + surge * 0.25);
              glow(f, xRail, ny, (4.5 + surge * 3.5) * s, pal.gold, al * 0.55);
              f.fillStyle = `rgba(255,250,234,${al.toFixed(3)})`;
              const sz = (1.75 + surge * 0.65) * s;
              f.beginPath();
              f.moveTo(xRail, ny - sz);
              f.lineTo(xRail + sz * 0.72, ny);
              f.lineTo(xRail, ny + sz);
              f.lineTo(xRail - sz * 0.72, ny);
              f.closePath();
              f.fill();
            }
            f.restore();
          }

          // Travelling vernier micro-ticks (strictly dt-integrated st.vernierPos)
          f.save();
          const tickCount = 18;
          const tTop = zones.bannerH + 6 * s;
          const tSpan = Math.max(40, H - tTop - 22 * s);
          for (let i = 0; i < tickCount; i += 1) {
            const k = i / (tickCount - 1);
            const y = tTop + k * tSpan;
            const major = i % 3 === 0;
            const distWave = Math.min(Math.abs(k - st.vernierPos), 1 - Math.abs(k - st.vernierPos));
            const glowWave = Math.max(0, 1 - distWave * 6.5);
            const len = ((major ? 8.2 : 4.2) + glowWave * 2.8 + surge * 1.8) * s;
            const al = clamp((major ? 0.36 : 0.18) + glowWave * 0.44 + surge * 0.22);
            f.strokeStyle = (major || glowWave > 0.45)
              ? `rgba(${pal.gold},${al.toFixed(3)})`
              : `rgba(${pal.accent},${al.toFixed(3)})`;
            f.lineWidth = (major ? 1.05 : 0.78) * s;
            f.beginPath(); f.moveTo(3.5 * s, y); f.lineTo(3.5 * s + len, y); f.stroke();
            f.beginPath(); f.moveTo(W - 3.5 * s, y); f.lineTo(W - 3.5 * s - len, y); f.stroke();
          }

          // Four chamfered titanium-gold corner brackets
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
            f.strokeStyle = 'rgba(2,5,11,0.52)';
            f.lineWidth = 2.4 * s;
            f.beginPath();
            f.moveTo(x0 + sx * cLen + s, y0 + 1.1 * s);
            f.lineTo(x0 + sx * ch + s, y0 + 1.1 * s);
            f.lineTo(x0 + s, y0 + sy * ch + 1.1 * s);
            f.lineTo(x0 + s, y0 + sy * cLen + 1.1 * s);
            f.stroke();

            f.strokeStyle = `rgba(${pal.gold},0.72)`;
            f.lineWidth = 1.25 * s;
            f.beginPath();
            f.moveTo(x0 + sx * cLen, y0);
            f.lineTo(x0 + sx * ch, y0);
            f.lineTo(x0, y0 + sy * ch);
            f.lineTo(x0, y0 + sy * cLen);
            f.stroke();
          }

          // Live bottom-right harmonic telemetry bars
          const bars = 6;
          const bw = 2.2 * s;
          const gap = 2.2 * s;
          const baseX = W - 18 * s - bars * (bw + gap);
          const baseY = H - 8.5 * s;
          const barEnergy = 0.65 + surge * 0.55;
          for (let i = 0; i < bars; i += 1) {
            const bh = (2.6 + (0.5 + 0.5 * Math.sin(t * (2.8 + i * 0.52) + i * 1.1)) * 7.6 * barEnergy) * s;
            const bx = baseX + i * (bw + gap);
            const bg = f.createLinearGradient(bx, baseY - bh, bx, baseY);
            bg.addColorStop(0, `rgba(${pal.gold},0.92)`);
            bg.addColorStop(1, `rgba(${pal.accent},0.82)`);
            f.fillStyle = bg;
            f.fillRect(bx, baseY - bh, bw, bh);
          }
          f.restore();
        }

        // 6. LEFT & RIGHT: 10 dt-Integrated Vertical Rising Light Streaks
        for (let i = 0; i < flankStreaks.length; i += 1) {
          const fl = flankStreaks[i];
          fl.p += safeDt * fl.rate * sp;
          if (fl.p > 1) fl.p -= 1;
          const yHead = lerp(H * 1.04, -H * 0.08, fl.p);
          const yTail = yHead + fl.len * (0.78 + surge * 0.48);
          const x = fl.xBase + Math.sin(st.wavePhase * 1.2 + i * 2.1) * 2.4 * s;
          const al = Math.sin(fl.p * Math.PI) * (0.58 + surge * 0.35);
          if (al <= 0.015) continue;
          const rgb = fl.gold ? pal.gold : pal.accent;
          const sg = f.createLinearGradient(x, yTail, x, yHead);
          sg.addColorStop(0, `rgba(${rgb},0)`);
          sg.addColorStop(0.68, `rgba(${rgb},${(al * 0.65).toFixed(3)})`);
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
          glow(f, x, yHead, fl.width * 4.2, rgb, al * 0.58);
        }

        // 7. LEFT & RIGHT: 68 dt-Integrated Multi-Depth Flank Orbs
        for (let i = 0; i < flankOrbs.length; i += 1) {
          const o = flankOrbs[i];
          o.y -= safeDt * o.speed * sp;
          if (o.y < -0.04) o.y += 1.08;
          const x = o.xBase + Math.sin(st.wavePhase * 0.9 + o.phase) * o.driftAmp;
          const y = H * o.y;
          const edgeFade = smooth((o.y + 0.02) / 0.12) * (1 - smooth((o.y - 0.9) / 0.12));
          const twinkle = 0.45 + 0.55 * Math.pow(Math.sin(t * 2.3 + o.phase * 2.1), 2);
          const a = clamp(edgeFade * twinkle * (0.36 + 0.54 * o.depth + surge * 0.24));
          if (a <= 0.015) continue;
          const rgb = pickRgb(o.hue, pal);
          const target = o.depth > 0.62 ? f : b;
          glow(target, x, y, o.size * 3.6, rgb, a * 0.52);
          target.fillStyle = `rgba(252,254,255,${clamp(a * 0.96).toFixed(3)})`;
          target.beginPath();
          target.arc(x, y, Math.max(0.45, o.size), 0, TAU);
          target.fill();
        }

        // 8. LEFT & RIGHT: 18 dt-Integrated Tumbling Holographic Shards
        for (let i = 0; i < flankShards.length; i += 1) {
          const sh = flankShards[i];
          sh.y -= safeDt * sh.speed * sp;
          if (sh.y < -0.04) sh.y += 1.08;
          sh.rot += safeDt * sh.spin * sp;
          const x = sh.xBase + Math.cos(st.wavePhase * 0.8 + sh.phase) * 5.0 * s;
          const y = H * sh.y;
          const edgeFade = smooth((sh.y + 0.02) / 0.12) * (1 - smooth((sh.y - 0.9) / 0.12));
          const a = clamp(edgeFade * (0.5 + surge * 0.36));
          if (a <= 0.015) continue;
          const rgb = pickRgb(sh.hue, pal);
          f.save();
          f.translate(x, y);
          f.rotate(sh.rot);
          f.globalAlpha = a;
          const sz = sh.size * (1 + surge * 0.2);
          if (sh.chevron) {
            f.strokeStyle = `rgba(${rgb},0.94)`;
            f.lineWidth = Math.max(0.75, 1.05 * s);
            f.lineCap = 'round';
            f.beginPath();
            f.moveTo(-sz * 0.65, sz * 0.45);
            f.lineTo(0, -sz * 0.65);
            f.lineTo(sz * 0.65, sz * 0.45);
            f.stroke();
          } else {
            f.fillStyle = `rgba(${rgb},0.88)`;
            f.beginPath();
            f.moveTo(0, -sz);
            f.lineTo(sz * 0.62, 0);
            f.lineTo(0, sz);
            f.lineTo(-sz * 0.62, 0);
            f.closePath();
            f.fill();
            f.strokeStyle = 'rgba(255,253,245,0.65)';
            f.lineWidth = 0.55 * s;
            f.stroke();
          }
          f.restore();
        }

        // 9. LEFT & RIGHT: 24 dt-Integrated Twinkling 4-Point Prismatic Sparkles
        for (let i = 0; i < flankSparkles.length; i += 1) {
          const spk = flankSparkles[i];
          spk.y -= safeDt * spk.speed * sp;
          if (spk.y < 0.02) spk.y += 0.96;
          const x = spk.xBase + Math.sin(st.wavePhase * 0.7 + spk.phase) * 3.6 * s;
          const y = H * spk.y;
          const edgeFade = smooth(spk.y / 0.1) * (1 - smooth((spk.y - 0.9) / 0.1));
          const tw = Math.pow(0.5 + 0.5 * Math.sin(t * spk.rate + spk.phase), 2.3);
          const a = clamp(edgeFade * (0.15 + tw * 0.85) * (0.82 + surge * 0.35));
          if (a <= 0.025) continue;
          const rgb = spk.gold ? pal.gold : pal.accent;
          const r = spk.size * (0.55 + tw * 0.65);
          glow(f, x, y, r * 2.4, rgb, a * 0.5);
          drawStarGlint(f, x, y, r, spk.gold ? '#fff7dc' : '#e8f8ff', a);
        }

        // 10. Twin dt-Integrated Counter-Flowing Perimeter Comets & Groups Filament
        if (full) {
          drawPerimeterComet(f, frameM, st.comet1, 0.16, pal.accent, 1.38 * s, 0.76 + surge * 0.2, 18);
          drawPerimeterComet(f, frameM, st.comet2, 0.12, pal.gold, 1.2 * s, 0.68 + surge * 0.22, 16);
          if (groupsM) {
            f.save();
            f.translate(zones.groupsRect.x, zones.groupsRect.y);
            drawPerimeterComet(f, groupsM, st.groupComet, 0.18, pal.gold, 1.1 * s, 0.58 + surge * 0.24, 15);
            f.restore();
          }
        }
      };

      // ---------------------------------------------------------------------
      // UPDATE & RENDER PERSISTENT LIVE PHYSICS PARTICLES & SHOCKWAVE RINGS
      // ---------------------------------------------------------------------
      const updateAndDrawLiveEntities = (safeDt, pal) => {
        // Shockwave rings
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
          f.strokeStyle = `rgba(${rgb},${(al * 0.32).toFixed(3)})`;
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

        // Live physics particles (stars, orbs, spinning shards, tapered comets)
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
          p.vx *= dragFac;
          p.vy *= dragFac;
          p.x += p.vx * safeDt;
          p.y += p.vy * safeDt;
          const al = Math.sin(u * Math.PI) * 0.94;
          const rgb = pickRgb(p.hue, pal);

          if (p.kind === 'comet') {
            const tx = p.x - p.vx * 0.085;
            const ty = p.y - p.vy * 0.085;
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
            glow(f, p.x, p.y, p.width * 3.8, rgb, al * 0.62);
            f.fillStyle = `rgba(255,253,246,${al.toFixed(3)})`;
            f.beginPath();
            f.arc(p.x, p.y, Math.max(0.7, p.width * 0.7), 0, TAU);
            f.fill();
          } else if (p.kind === 'shard') {
            p.rot += p.spin * safeDt;
            f.save();
            f.translate(p.x, p.y);
            f.rotate(p.rot);
            f.globalAlpha = al;
            f.fillStyle = `rgba(${rgb},0.94)`;
            const sz = Math.max(0.7, p.sz * (0.55 + Math.sin(u * Math.PI) * 0.6));
            f.beginPath();
            f.moveTo(0, -sz);
            f.lineTo(sz * 0.68, 0);
            f.lineTo(0, sz * 0.88);
            f.lineTo(-sz * 0.56, 0);
            f.closePath();
            f.fill();
            f.restore();
          } else if (p.kind === 'star') {
            glow(f, p.x, p.y, p.sz * 3.2, rgb, al * 0.52);
            drawStarGlint(f, p.x, p.y, p.sz * 1.35, '#fffdf5', al);
          } else {
            glow(f, p.x, p.y, p.sz * 3.2, rgb, al * 0.52);
            f.fillStyle = `rgba(255,253,248,${al.toFixed(3)})`;
            f.beginPath();
            f.arc(p.x, p.y, Math.max(0.55, p.sz * 0.85), 0, TAU);
            f.fill();
          }
        }
      };

      // =====================================================================
      // MAIN RENDER LOOP (SEAMLESS CONTINUOUS STATE MACHINE)
      // =====================================================================
      return (t, dt) => {
        const pal = getPalette(host);
        const isStill = dt === 0;
        const safeDt = isStill ? 0.016 : Math.min(0.05, Math.max(0.001, dt));

        // Compact gallery tile & reduced-motion still frame
        if (!full || isStill) {
          if (!isStill) {
            st.rotA += safeDt * 0.24;
            st.rotB -= safeDt * 0.16;
            st.goldA += safeDt * 0.52;
            st.blueA -= safeDt * 0.36;
            st.wavePhase += safeDt * 1.1;
          }
          updateAndDraw360Field(isStill ? 6.4 : t, isStill ? 0 : safeDt, 0.28, pal);
          drawAvatarGimbal(0.55, pal);
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

        // Determine targets from currently playing act (smoothly damped into live CSS vars!)
        let tgtShakeX = 0;
        let tgtShakeY = 0;
        let tgtShakeRot = 0;
        let tgtScale = 1;
        let tgtChroma = 0;
        let tgtSurge = 0.18 + 0.12 * Math.sin(t * 1.1);
        let tgtPulseGlow = 0;
        let tgtSpeedMul = 1;
        let sheenActive = false;

        // Auto scheduler when no act is currently playing
        const mode = typeof api.getCreatorAnimMode === 'function' ? api.getCreatorAnimMode() : 'auto';
        if (!st.act) {
          st.autoTimer += safeDt;
          if (mode === 'auto') {
            if (st.autoTimer >= 2.2) {
              st.autoTimer = 0;
              const nextKind = AUTO_ORDER[st.autoStep % AUTO_ORDER.length];
              st.autoStep += 1;
              startAct(nextKind, { playSfx: false });
            }
          } else if (mode === 'shake' || mode === 'pulse' || mode === 'burst') {
            if (st.autoTimer >= 2.4) {
              st.autoTimer = 0;
              startAct(mode, { playSfx: false });
            }
          }
          // Note: full-screen modes ('awakening', 'entrance') play on selection / card tap without endlessly spamming full-screen loops
        }

        if (st.act) {
          st.act.elapsed += safeDt;
          const u = clamp(st.act.elapsed / st.act.dur);
          const kind = st.act.kind;

          if (kind === 'shake') {
            const windUp = smooth(u / 0.14) * (1 - smooth((u - 0.14) / 0.08));
            const activeK = clamp((u - 0.14) / 0.56);
            const activeEnv = u >= 0.14 && u <= 0.78
              ? Math.sin(clamp((u - 0.14) / 0.11) * Math.PI * 0.5) * Math.exp(-3.2 * activeK) * (1 - smooth((u - 0.66) / 0.12))
              : 0;
            if (u >= 0.14 && !st.act.emitted) {
              st.act.emitted = true;
              spawnShakeEmitter();
            }
            const osc = activeK * TAU * 4.2;
            tgtShakeX = Math.sin(osc) * 5.0 * activeEnv;
            tgtShakeY = Math.cos(osc * 1.45) * 2.4 * activeEnv;
            tgtShakeRot = Math.sin(osc + 0.45) * 0.95 * activeEnv;
            tgtScale = 1 - windUp * 0.014 + activeEnv * 0.008;
            tgtChroma = activeEnv * 2.5;
            tgtSurge = 0.25 + windUp * 0.5 + activeEnv * 1.15;
            tgtPulseGlow = activeEnv * 0.85;
            tgtSpeedMul = 1 + activeEnv * 0.85;

            // Crackling plasma arcs racing along left, right, top & bottom conduits during impact
            if (activeEnv > 0.02) {
              f.save();
              for (const side of [-1, 1]) {
                const xBase = side === -1 ? 8 * s : W - 8 * s;
                f.strokeStyle = `rgba(${pal.accent},${(activeEnv * 0.86).toFixed(3)})`;
                f.lineWidth = 1.4 * s;
                f.beginPath();
                for (let j = 0; j <= 14; j += 1) {
                  const k = j / 14;
                  const y = lerp(22 * s, H - 22 * s, k);
                  const jit = Math.sin(k * 19 + t * 34 + side * 2) * (5.8 * s * activeEnv) * Math.sin(k * Math.PI);
                  const px = xBase + side * (-Math.abs(jit));
                  if (j === 0) f.moveTo(px, y);
                  else f.lineTo(px, y);
                }
                f.stroke();
              }
              f.restore();
            }
            const setU = clamp((u - 0.68) / 0.3);
            if (setU > 0 && setU < 1) {
              sheenActive = true;
              st.sheenPos = lerp(-35, 145, easeInOutQuint(setU));
              st.sheenAlpha = Math.sin(setU * Math.PI) * 0.78;
            }
          } else if (kind === 'pulse') {
            if (u >= 0.06 && !st.act.emitted) {
              st.act.emitted = true;
              spawnPulseEmitter();
            }
            const swell = Math.sin(smooth(u / 0.82) * Math.PI);
            tgtScale = 1 + swell * 0.016;
            tgtPulseGlow = swell * 1.05;
            tgtSurge = 0.25 + swell * 0.95;
            tgtSpeedMul = 1 + swell * 0.55;
            glow(b, cx, cy, ra * (2.6 + swell * 1.5), pal.gold, swell * 0.34);
            glow(b, cx, cy, ra * (3.3 + swell * 1.8), pal.accent, swell * 0.26);
            const shU = clamp((u - 0.4) / 0.46);
            if (shU > 0 && shU < 1) {
              sheenActive = true;
              st.sheenPos = lerp(-35, 145, easeInOutQuint(shU));
              st.sheenAlpha = Math.sin(shU * Math.PI) * 0.64;
            }
          } else if (kind === 'burst') {
            const pullU = clamp(u / 0.16);
            const flash = u >= 0.15 && u <= 0.36 ? Math.sin(clamp((u - 0.15) / 0.21) * Math.PI) : 0;
            if (u >= 0.15 && !st.act.emitted) {
              st.act.emitted = true;
              spawnBurstEmitter();
            }
            tgtScale = 1 - Math.sin(pullU * Math.PI) * 0.015 + flash * 0.018;
            tgtPulseGlow = flash * 1.25;
            tgtChroma = flash * 2.6;
            tgtSurge = 0.25 + pullU * 0.55 + flash * 1.35;
            tgtSpeedMul = 1 + flash * 1.05;

            if (u < 0.19) {
              const aIn = Math.sin(pullU * Math.PI);
              f.save();
              f.lineCap = 'round';
              for (let i = 0; i < 14; i += 1) {
                const ang = (i / 14) * TAU + t * 0.7;
                const rOut = lerp(ra * 2.9, ra * 0.75, easeInOutQuint(pullU));
                const rIn = lerp(ra * 2.2, ra * 0.45, easeInOutQuint(pullU));
                f.strokeStyle = `rgba(${i % 2 === 0 ? pal.gold : pal.accent},${(aIn * 0.78).toFixed(3)})`;
                f.lineWidth = 1.35 * s;
                f.beginPath();
                f.moveTo(cx + Math.cos(ang) * rOut, cy + Math.sin(ang) * rOut);
                f.lineTo(cx + Math.cos(ang + 0.14) * rIn, cy + Math.sin(ang + 0.14) * rIn);
                f.stroke();
              }
              f.restore();
              glow(f, cx, cy, ra * (1.3 + aIn * 1.1), pal.gold, aIn * 0.58);
            }
            if (flash > 0.01) {
              glow(f, cx, cy, ra * (2.3 + flash * 2.6), pal.gold, flash * 0.74);
              drawStarGlint(f, cx, cy, ra * 1.15 * flash, '#fffdf5', flash * 0.88);
            }
            const sweep = clamp((u - 0.34) / 0.42);
            if (sweep > 0 && sweep < 1) {
              const sy = lerp(-18 * s, H + 18 * s, easeInOutQuint(sweep));
              const sa = Math.sin(sweep * Math.PI) * 0.88;
              const lg = f.createLinearGradient(0, sy - 20 * s, W, sy + 20 * s);
              lg.addColorStop(0, `rgba(${pal.accent},0)`);
              lg.addColorStop(0.28, `rgba(${pal.accent},${(0.75 * sa).toFixed(3)})`);
              lg.addColorStop(0.55, `rgba(255,252,240,${(0.95 * sa).toFixed(3)})`);
              lg.addColorStop(0.8, `rgba(${pal.gold},${(0.78 * sa).toFixed(3)})`);
              lg.addColorStop(1, `rgba(${pal.prism},0)`);
              f.save();
              f.strokeStyle = lg;
              f.lineWidth = 1.9 * s;
              f.beginPath();
              f.moveTo(0, sy - 20 * s);
              f.lineTo(W, sy + 20 * s);
              f.stroke();
              f.restore();
            }
            const finU = clamp((u - 0.66) / 0.32);
            if (finU > 0 && finU < 1) {
              sheenActive = true;
              st.sheenPos = lerp(-35, 145, easeInOutQuint(finU));
              st.sheenAlpha = Math.sin(finU * Math.PI) * 0.9;
            }
          } else {
            // Card-level synchronization during Full-Screen Cinematics ('awakening' & 'entrance')
            const env = Math.sin(u * Math.PI);
            const climax = kind === 'entrance'
              ? Math.sin(clamp((u - 0.24) / 0.36) * Math.PI)
              : Math.sin(clamp((u - 0.18) / 0.44) * Math.PI);
            tgtScale = 1 + env * 0.014 + climax * 0.008;
            tgtPulseGlow = env * 0.9 + climax * 0.55;
            tgtChroma = climax * 1.8;
            tgtSurge = 0.4 + env * 1.15;
            tgtSpeedMul = 1 + env * 0.85;
            if (u >= 0.28 && !st.act.emitted) {
              st.act.emitted = true;
              spawnBurstEmitter();
            }
            const shU = clamp((u - 0.26) / 0.44);
            if (shU > 0 && shU < 1) {
              sheenActive = true;
              st.sheenPos = lerp(-35, 145, easeInOutQuint(shU));
              st.sheenAlpha = Math.sin(shU * Math.PI) * 0.95;
            }
          }

          if (u >= 1) {
            st.act = null;
          }
        } else {
          // Gentle periodic ambient sheen during serene cruise
          const ambSheen = frac(t / 8.2);
          if (ambSheen < 0.22) {
            const k = ambSheen / 0.22;
            sheenActive = true;
            st.sheenPos = lerp(-35, 145, easeInOutQuint(k));
            st.sheenAlpha = Math.sin(k * Math.PI) * 0.42;
          }
        }

        // Smoothly damp all continuous physics & CSS values (ZERO jumps or snaps!)
        st.speedMul = damp(st.speedMul, tgtSpeedMul, 6, safeDt);
        st.smoothSurge = damp(st.smoothSurge, tgtSurge, 7, safeDt);
        st.shakeX = damp(st.shakeX, tgtShakeX, 24, safeDt);
        st.shakeY = damp(st.shakeY, tgtShakeY, 24, safeDt);
        st.shakeRot = damp(st.shakeRot, tgtShakeRot, 24, safeDt);
        st.scale = damp(st.scale, tgtScale, 12, safeDt);
        st.chroma = damp(st.chroma, tgtChroma, 14, safeDt);
        st.pulseGlow = damp(st.pulseGlow, tgtPulseGlow, 9, safeDt);
        st.frameGlow = damp(st.frameGlow, 0.45 + st.smoothSurge * 0.55, 8, safeDt);
        if (!sheenActive) st.sheenAlpha = damp(st.sheenAlpha, 0, 12, safeDt);

        // Monotonically advance orbital angles, wave phases & perimeter comets via dt
        st.rotA += safeDt * (0.24 + st.smoothSurge * 0.45);
        st.rotB -= safeDt * (0.16 + st.smoothSurge * 0.3);
        st.goldA += safeDt * (0.52 + st.smoothSurge * 0.65);
        st.blueA -= safeDt * (0.36 + st.smoothSurge * 0.42);
        st.comet1 = frac(st.comet1 + safeDt * 0.072 * st.speedMul);
        st.comet2 = frac(st.comet2 + safeDt * 0.072 * st.speedMul);
        st.groupComet = frac(st.groupComet + safeDt * 0.115 * st.speedMul);
        st.vernierPos = frac(st.vernierPos + safeDt * 0.24 * st.speedMul);
        st.wavePhase += safeDt * (1.15 * st.speedMul);

        // Write smoothly damped CSS vars (NO mask-image ever, so DP is 100% unclipped!)
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

        // Paint cohesive 360° field + live physics entities + 3D avatar gimbal
        updateAndDraw360Field(t, safeDt, st.smoothSurge, pal);
        updateAndDrawLiveEntities(safeDt, pal);
        drawAvatarGimbal(st.smoothSurge, pal);
      };
    },
    { fullCard: true }
  );
})();
