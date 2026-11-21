(() => {
  'use strict';

  const api = (typeof window !== 'undefined' && window.IponProfileEffects)
    || (typeof globalThis !== 'undefined' && globalThis.IponProfileEffects);
  if (!api || typeof api.registerEffect !== 'function' || !api._H) return;

  const {
    TAU, R, frac, glow, rr, sparkle, tracePoly, pathMetrics, traceComet
  } = api._H;

  // =========================================================================
  // UNIFIED STUDIO LIGHTING & PHYSICAL SHADING PIPELINE
  // Key light fixed at top-left (-0.58, -0.81) -> consistent down-right shadows.
  // Subtle cool/warm rim bounce on bottom-right bevels; zero plastic neon glow.
  // =========================================================================
  const L_DX = 0.58;
  const L_DY = 0.81;

  function sceneDirector(t, sceneDur, profile = 'grand', sceneCount = 4) {
    const idx = Math.floor(t / sceneDur);
    const scene = ((idx % sceneCount) + sceneCount) % sceneCount;
    const u = frac(t / sceneDur);
    let inEnd = 0.17;
    let holdEnd = 0.39;
    let outEnd = 0.61;
    if (profile === 'snap') { inEnd = 0.11; holdEnd = 0.35; outEnd = 0.53; }
    else if (profile === 'silk') { inEnd = 0.22; holdEnd = 0.45; outEnd = 0.69; }
    else if (profile === 'creep') { inEnd = 0.24; holdEnd = 0.43; outEnd = 0.63; }
    else if (profile === 'tick') { inEnd = 0.15; holdEnd = 0.41; outEnd = 0.59; }

    let surge = 0;
    let dissolve = 0;
    if (u < inEnd) {
      const k = u / inEnd;
      surge = profile === 'snap' ? 1 - Math.pow(1 - k, 4) : (1 - Math.cos(k * Math.PI)) * 0.5;
    } else if (u < holdEnd) {
      surge = 1;
    } else if (u < outEnd) {
      const k = (u - holdEnd) / (outEnd - holdEnd);
      dissolve = k;
      surge = profile === 'snap' ? Math.pow(1 - k, 2.2) : 0.5 * (1 + Math.cos(k * Math.PI));
    }
    const activeU = Math.min(1, u / outEnd);
    return { scene, u, activeU, surge, dissolve };
  }

  // Two-layer directional cast + soft ambient occlusion shadow (zero shadowBlur)
  function castShadow(g, elevation, alpha, drawShape) {
    if (alpha <= 0.015 || elevation <= 0) return;
    const dx = L_DX * elevation;
    const dy = L_DY * elevation;
    g.save();
    g.translate(dx * 1.4, dy * 1.4);
    drawShape(`rgba(4,6,11,${(alpha * 0.24).toFixed(3)})`, 1.18);
    g.restore();
    g.save();
    g.translate(dx * 0.68, dy * 0.68);
    drawShape(`rgba(2,4,8,${(alpha * 0.42).toFixed(3)})`, 1.0);
    g.restore();
  }

  // Sculpted 3D metallic ring bezel with contact occlusion, multi-stop satin body,
  // top-left key-light specular ridge, and subtle opposite bounce rim
  function drawBevelRing(g, cx, cy, r, lw, stops, al, s) {
    if (al <= 0.02) return;
    g.save();
    g.globalAlpha = Math.max(0, Math.min(1, al));
    // Cast contact shadow under bezel
    g.strokeStyle = 'rgba(2,4,8,.46)';
    g.lineWidth = lw + 1.4 * s;
    g.beginPath(); g.arc(cx + L_DX * 1.8 * s, cy + L_DY * 1.8 * s, r, 0, TAU); g.stroke();
    // Main brushed metallic body
    const gr = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    for (const [pos, col] of stops) gr.addColorStop(pos, col);
    g.strokeStyle = gr;
    g.lineWidth = lw;
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
    // Crisp top-left directional specular bevel ridge
    g.strokeStyle = 'rgba(255,253,246,.62)';
    g.lineWidth = Math.max(0.55 * s, lw * 0.26);
    g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy, r + lw * 0.22, -2.55, -0.78); g.stroke();
    // Subtle inner shadow occlusion lip
    g.strokeStyle = 'rgba(0,0,0,.38)';
    g.lineWidth = Math.max(0.5 * s, lw * 0.24);
    g.beginPath(); g.arc(cx, cy, r - lw * 0.34, 0.35, 2.35); g.stroke();
    g.restore();
  }

  // Tactile two-tone folded leaf/feather with directional lighting across central midrib
  function drawSculptedLeaf(g, x, y, len, wid, ang, litTop, litEdge, shadeBase, shadeEdge, ribCol, al, shadowElev = 0) {
    if (al <= 0.02 || len <= 1) return;
    if (shadowElev > 0) {
      g.save();
      g.globalAlpha = al * 0.34;
      g.translate(x + L_DX * shadowElev, y + L_DY * shadowElev);
      g.rotate(ang);
      g.fillStyle = '#03050a';
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(len * 0.44, -wid, len, 0);
      g.quadraticCurveTo(len * 0.44, wid, 0, 0);
      g.closePath();
      g.fill();
      g.restore();
    }
    g.save();
    g.globalAlpha = Math.max(0, Math.min(1, al));
    g.translate(x, y);
    g.rotate(ang);
    // Upper key-lit half-blade
    const grTop = g.createLinearGradient(0, -wid, len, 0);
    grTop.addColorStop(0, litTop);
    grTop.addColorStop(1, litEdge);
    g.fillStyle = grTop;
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(len * 0.45, -wid, len, 0);
    g.lineTo(0, 0);
    g.closePath();
    g.fill();
    // Lower shaded half-blade for 3D ridge fold
    const grBot = g.createLinearGradient(0, 0, len, wid);
    grBot.addColorStop(0, shadeBase);
    grBot.addColorStop(1, shadeEdge);
    g.fillStyle = grBot;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(len, 0);
    g.quadraticCurveTo(len * 0.45, wid, 0, 0);
    g.closePath();
    g.fill();
    // Fine catchlight midrib quill
    g.strokeStyle = ribCol;
    g.lineWidth = Math.max(0.5, wid * 0.14);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(len * 0.06, 0);
    g.lineTo(len * 0.88, 0);
    g.stroke();
    g.restore();
  }

  // Museum-grade struck 24K bullion coin with cast shadow, milled rim, recessed mint groove & embossed ₱
  function drawStruckCoin(g, x, y, r, spin, tilt, al, s) {
    if (al <= 0.02 || r <= 0.8) return;
    const c = Math.cos(spin);
    const sx = Math.max(0.18, Math.abs(c));
    const edge = (1 - sx) * r * 0.36 * (c >= 0 ? 1 : -1);
    g.save();
    g.globalAlpha = Math.max(0, Math.min(1, al));
    // Soft grounded directional shadow beneath coin
    g.fillStyle = 'rgba(3,5,9,.36)';
    g.beginPath();
    g.ellipse(x + L_DX * 5.2 * s, y + L_DY * 5.2 * s, r * sx * 1.04, r * 1.04, tilt, 0, TAU);
    g.fill();
    g.translate(x, y);
    g.rotate(tilt);
    // Extruded milled bronze-gold rim thickness
    const edgeGr = g.createLinearGradient(edge, -r, edge, r);
    edgeGr.addColorStop(0, '#f3d27d');
    edgeGr.addColorStop(0.45, '#9d6a1a');
    edgeGr.addColorStop(1, '#4f3208');
    g.fillStyle = edgeGr;
    g.beginPath();
    g.ellipse(edge, 0, r * sx, r, 0, 0, TAU);
    g.fill();
    // 5-stop anisotropic brushed 24K bullion face
    const specShift = Math.sin(spin) * 0.25;
    const faceGr = g.createLinearGradient(-r * sx, -r, r * sx, r);
    faceGr.addColorStop(0, '#fff7d6');
    faceGr.addColorStop(Math.max(0.12, Math.min(0.42, 0.28 + specShift)), '#f0c45c');
    faceGr.addColorStop(0.55, '#c48d28');
    faceGr.addColorStop(0.82, '#e8bc58');
    faceGr.addColorStop(1, '#7c5211');
    g.fillStyle = faceGr;
    g.beginPath();
    g.ellipse(0, 0, r * sx, r, 0, 0, TAU);
    g.fill();
    // Raised bevel rim: crisp top-left catchlight + dark bottom-right contact crease
    g.strokeStyle = 'rgba(255,250,228,.82)';
    g.lineWidth = Math.max(0.6, r * 0.09);
    g.beginPath(); g.ellipse(0, 0, r * sx, r, 0, -2.5, -0.65); g.stroke();
    g.strokeStyle = 'rgba(64,38,6,.62)';
    g.beginPath(); g.ellipse(0, 0, r * sx, r, 0, 0.45, 2.35); g.stroke();
    // Recessed struck mint ring + double-lit embossed ₱ mark
    if (sx > 0.34) {
      g.strokeStyle = 'rgba(84,52,10,.54)';
      g.lineWidth = Math.max(0.55, r * 0.075);
      g.beginPath(); g.ellipse(0, 0, r * 0.74 * sx, r * 0.74, 0, 0, TAU); g.stroke();
      g.strokeStyle = 'rgba(255,248,214,.42)';
      g.beginPath(); g.ellipse(0, 0, r * 0.69 * sx, r * 0.69, 0, 0.4, 2.5); g.stroke();
      g.save();
      g.scale(sx, 1);
      g.font = `700 ${Math.max(5, Math.round(r * 1.02))}px Georgia,serif`;
      g.fillStyle = 'rgba(255,248,216,.52)';
      g.fillText('₱', -r * 0.34 - 0.5 * s, r * 0.36 - 0.5 * s);
      g.fillStyle = 'rgba(88,54,8,.88)';
      g.fillText('₱', -r * 0.32, r * 0.38);
      g.restore();
    }
    g.restore();
  }

  // =========================================================================
  // 1. SOLAR PHOENIX — Articulated Burnished-Fire Wings, Magnetic Prominence
  //    Loops, Depth-Sorted 3D Cinder Whirlwind, Ash-to-Gold Ignition Wave
  // =========================================================================
  api.registerEffect('ex_phoenix', 'Solar Phoenix', 'Exclusive', 'Four studio-lit solar acts: articulated burnished-fire wings with cast shadows, magnetic prominence loops, 3D cinder whirlwind, and ash-to-gold ignition.', 3, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const gold = '246,198,108';
    const flame = '238,102,48';
    const ember = '232,144,68';
    const ash = Array.from({ length: full ? 34 : 18 }, (_, i) => ({
      x: ((i * 0.31 + 0.08) % 1) * W, y0: R(0, 1), v: R(0.036, 0.08),
      sz: R(2.0, 4.6), ph: R(0, TAU), a: (i / (full ? 34 : 18)) * TAU, sp: R(0.7, 1.35)
    }));
    const crestPts = Array.from({ length: 64 }, (_, i) => {
      const a = -Math.PI / 2 + (i / 64) * TAU;
      const r = ra * (1.2 + 0.085 * Math.pow(Math.abs(Math.sin(a * 4)), 1.6));
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    });
    const crestM = pathMetrics(crestPts, true);

    const drawBirdWing = (g, side, openK, al, t) => {
      const ox = cx + side * ra * (0.18 + openK * 0.72);
      const oy = cy + ra * 0.06;
      const span = ra * (1.44 + openK * 0.62);
      const lift = -ra * (0.62 + openK * 0.42);
      const bx1 = side * span * 0.45;
      const by1 = lift * 0.92 + Math.sin(t * 2.6) * 3 * s;
      const bx2 = side * span;
      const by2 = lift * 0.45 + Math.cos(t * 2.2) * 5 * s;
      const count = 9;
      // 1. Directional cast wing shadow projected down-right onto the profile card
      castShadow(g, 7.5 * s, al * 0.85, (shCol) => {
        g.save();
        g.translate(ox, oy);
        g.fillStyle = shCol;
        g.beginPath();
        g.moveTo(0, 0);
        g.quadraticCurveTo(bx1, by1, bx2, by2);
        g.quadraticCurveTo(bx1 * 0.9, ra * 0.78, 0, ra * 0.52);
        g.closePath();
        g.fill();
        g.restore();
      });
      // 2. Sculpted two-tone anatomical primary & secondary flight feathers
      for (let i = 0; i < count; i += 1) {
        const k = i / (count - 1);
        const mt = 1 - k;
        const fx = ox + 2 * mt * k * bx1 + k * k * bx2;
        const fy = oy + 2 * mt * k * by1 + k * k * by2;
        const baseAng = side === 1
          ? (0.28 + k * 0.62 + (1 - openK) * 1.12)
          : (Math.PI - (0.28 + k * 0.62 + (1 - openK) * 1.12));
        const sway = Math.sin(t * 2.9 - i * 0.46) * 0.065;
        const fLen = ra * (0.64 + Math.sin(k * Math.PI * 0.85) * 0.8);
        const fWid = ra * (0.145 + (1 - k) * 0.068);
        drawSculptedLeaf(
          g, fx, fy, fLen, fWid, baseAng + sway,
          i > 5 ? '#fff2c2' : '#f5a94c',
          i > 5 ? '#d96926' : '#a92c12',
          '#8e2a10', '#3d0f08',
          `rgba(255,244,204,${al * 0.72})`,
          al, 2.2 * s
        );
      }
      // 3. Burnished golden wing-bone ridge with specular catchlight
      g.save();
      g.globalAlpha = al;
      g.translate(ox, oy);
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(42,12,4,.58)'; g.lineWidth = 3.2 * s;
      g.beginPath(); g.moveTo(0, 1.4 * s); g.quadraticCurveTo(bx1, by1 + 1.4 * s, bx2, by2 + 1.4 * s); g.stroke();
      g.strokeStyle = '#e8aa4a'; g.lineWidth = 2.1 * s;
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(bx1, by1, bx2, by2); g.stroke();
      g.strokeStyle = 'rgba(255,248,220,.82)'; g.lineWidth = 0.8 * s;
      g.beginPath(); g.moveTo(0, -0.6 * s); g.quadraticCurveTo(bx1, by1 - 0.6 * s, bx2 * 0.88, by2 - 0.6 * s); g.stroke();
      g.restore();
    };

    return (t) => {
      const { scene, activeU, surge, dissolve } = sceneDirector(t, 6.2, 'grand', 4);
      // Bespoke Perimeter: Recessed filigree bronze-gold arches with subtle cast shadow
      if (full) {
        const ba = 0.34 + surge * 0.32;
        b.strokeStyle = `rgba(3,5,8,${ba * 0.55})`; b.lineWidth = 2.2 * s;
        b.beginPath();
        b.moveTo(15 * s, 27 * s); b.quadraticCurveTo(15 * s, 9 * s, 35 * s, 9 * s);
        b.lineTo(W - 33 * s, 9 * s); b.quadraticCurveTo(W - 13 * s, 9 * s, W - 13 * s, 27 * s);
        b.stroke();
        b.strokeStyle = `rgba(${gold},${ba})`; b.lineWidth = 1.15 * s;
        b.beginPath();
        b.moveTo(14 * s, 26 * s); b.quadraticCurveTo(14 * s, 8 * s, 34 * s, 8 * s);
        b.lineTo(W - 34 * s, 8 * s); b.quadraticCurveTo(W - 14 * s, 8 * s, W - 14 * s, 26 * s);
        b.moveTo(14 * s, H - 26 * s); b.quadraticCurveTo(14 * s, H - 8 * s, 34 * s, H - 8 * s);
        b.lineTo(W - 34 * s, H - 8 * s); b.quadraticCurveTo(W - 14 * s, H - 8 * s, W - 14 * s, H - 26 * s);
        b.stroke();
      }
      // Subtle floating charred-to-warm cinders
      for (let i = 0; i < Math.min(14, ash.length); i += 1) {
        const q = ash[i];
        const p = frac(q.y0 + t * q.v);
        const y = H * (1.04 - p * 1.1);
        const x = q.x + Math.sin(t * 1.05 + q.ph) * 10 * s;
        const dim = full && y > cy + ra * 1.35 && x > W * 0.18 && x < W * 0.82 ? 0.2 : 0.58;
        b.fillStyle = `rgba(${ember},${Math.sin(p * Math.PI) * dim})`;
        b.beginPath(); b.ellipse(x, y, q.sz * 0.52 * s, q.sz * 0.24 * s, t + q.ph, 0, TAU); b.fill();
      }
      // Sculpted burnished crest rim with dark contact shadow underneath
      f.strokeStyle = 'rgba(4,6,10,.52)'; f.lineWidth = 2.6 * s;
      f.save(); f.translate(L_DX * 1.6 * s, L_DY * 1.6 * s); tracePoly(f, crestPts, true); f.stroke(); f.restore();
      const cg = f.createLinearGradient(cx - ra, cy - ra * 1.3, cx + ra, cy + ra * 1.3);
      cg.addColorStop(0, '#fff4cf'); cg.addColorStop(0.45, '#e8a444'); cg.addColorStop(0.78, '#b23b16'); cg.addColorStop(1, '#f0b65c');
      f.strokeStyle = cg; f.lineWidth = 1.65 * s; tracePoly(f, crestPts, true); f.stroke();
      traceComet(f, crestM, frac(t * 0.16), 0.16, '255,244,210', 1.45 * s, 0.74, s, 14);

      if (surge > 0.02) {
        const al = Math.min(1, surge * 1.18) * (1 - dissolve * 0.84);
        if (scene === 0) {
          const openK = dissolve > 0 ? 0.38 + dissolve * 0.85 : Math.max(0, 1 - surge * 1.12);
          drawBirdWing(f, -1, openK, al, t);
          drawBirdWing(f, 1, openK, al, t);
        } else if (scene === 1) {
          // Magnetic solar prominence loops with dark heat-smoke occlusion behind incandescent core
          f.save(); f.lineCap = 'round';
          for (let i = 0; i < 6; i += 1) {
            const a0 = -Math.PI * 0.85 + i * 1.05 + t * 0.34;
            const a1 = a0 + 0.92;
            const reach = ra * (1.72 + (full ? 1.85 : 0.75) * Math.sin(activeU * Math.PI) + (i % 2) * 0.44);
            const sx = cx + Math.cos(a0) * ra * 0.9; const sy = cy + Math.sin(a0) * ra * 0.9;
            const ex = cx + Math.cos(a1) * ra * 0.9; const ey = cy + Math.sin(a1) * ra * 0.9;
            const midA = (a0 + a1) * 0.5;
            const cpx = cx + Math.cos(midA) * reach; const cpy = cy + Math.sin(midA) * reach;
            // Subtle cast shadow offset down-right
            f.strokeStyle = `rgba(10,4,2,${al * 0.34})`; f.lineWidth = 6.2 * s;
            f.beginPath(); f.moveTo(sx + 2 * s, sy + 3 * s); f.quadraticCurveTo(cpx + 3 * s, cpy + 4 * s, ex + 2 * s, ey + 3 * s); f.stroke();
            // Deep crimson magma jacket + incandescent champagne-white filament
            f.strokeStyle = `rgba(${flame},${al * 0.56})`; f.lineWidth = 4.4 * s;
            f.beginPath(); f.moveTo(sx, sy); f.quadraticCurveTo(cpx, cpy, ex, ey); f.stroke();
            f.strokeStyle = `rgba(255,244,206,${al * 0.92})`; f.lineWidth = 1.45 * s;
            f.beginPath(); f.moveTo(sx, sy); f.quadraticCurveTo(cpx, cpy, ex, ey); f.stroke();
            const bt = frac(activeU * 1.65 + i * 0.17);
            const mt = 1 - bt;
            const bx = mt * mt * sx + 2 * mt * bt * cpx + bt * bt * ex;
            const by = mt * mt * sy + 2 * mt * bt * cpy + bt * bt * ey;
            glow(f, bx, by, 6.2 * s, gold, al * 0.72);
            f.fillStyle = `rgba(255,250,232,${al * 0.95})`; f.beginPath(); f.arc(bx, by, 1.8 * s, 0, TAU); f.fill();
          }
          f.restore();
        } else if (scene === 2) {
          // Depth-sorted 3D Cinder Whirlwind: dark back-arcs drawn behind lit front-arcs for real volumetric depth!
          const xStart = full ? W * 0.14 : cx - ra * 1.1;
          const yStart = full ? H * 0.94 : cy + ra * 1.2;
          const xEnd = full ? W * 0.88 : cx + ra * 1.1;
          const yEnd = full ? H * 0.08 : cy - ra * 1.1;
          f.save(); f.lineCap = 'round';
          for (const pass of ['back', 'front']) {
            for (let ring = 0; ring < 14; ring += 1) {
              const k = ring / 13;
              const px = xStart + (xEnd - xStart) * k + Math.sin(k * Math.PI * 2 + t * 4.2) * 12 * s;
              const py = yStart + (yEnd - yStart) * k;
              const rx = (10 + k * (full ? 42 : 24)) * s * (0.4 + 0.6 * surge);
              const ry = rx * 0.34;
              const rot = -0.45 + Math.sin(t * 2 + k * 3) * 0.1;
              if (pass === 'back') {
                f.strokeStyle = `rgba(52,18,10,${al * (0.28 + k * 0.25)})`;
                f.lineWidth = (2.2 + k * 1.6) * s;
                f.beginPath(); f.ellipse(px + 2 * s, py + 3 * s, rx, ry, rot, Math.PI, TAU); f.stroke();
              } else {
                const startA = 0.1 + frac(t * 0.65 + k * 0.31) * 1.1;
                f.strokeStyle = `rgba(${ring % 2 ? gold : flame},${al * (0.42 + k * 0.5)})`;
                f.lineWidth = (1.35 + k * 1.35) * s;
                f.beginPath(); f.ellipse(px, py, rx, ry, rot, startA, startA + 1.45); f.stroke();
              }
            }
          }
          f.restore();
        } else {
          // Ash-to-Gold Ignition: charred shadowed flakes ignite along an incandescent scalloped burn-front
          const ignK = Math.max(0, Math.min(1, (activeU - 0.15) / 0.68));
          const flameFront = ignK * (full ? Math.hypot(W, H) * 0.72 : ra * 2.7);
          for (const q of ash) {
            const dist = Math.hypot(q.x - cx, q.y0 * H - cy);
            const lit = dist < flameFront;
            const fx = q.x + Math.cos(q.a + t * 2) * (lit ? 14 * s * dissolve : 4 * s);
            const fy = q.y0 * H - (lit ? 18 * s * dissolve : 0);
            if (lit) {
              drawSculptedLeaf(f, fx, fy, (8 + q.sz) * s, (2.6 + q.sz * 0.38) * s, q.a + t * 1.7, '#fff2c2', '#e88b38', '#a83414', '#4e1208', 'rgba(255,248,220,.7)', al * 0.94, 2.4 * s);
            } else {
              f.fillStyle = `rgba(4,5,8,${al * 0.36})`;
              f.beginPath(); f.ellipse(fx + 2 * s, fy + 2.8 * s, q.sz * 1.15 * s, q.sz * 0.6 * s, q.ph + t, 0, TAU); f.fill();
              f.fillStyle = `rgba(48,34,30,${al * 0.84})`;
              f.strokeStyle = `rgba(218,120,56,${al * 0.38})`; f.lineWidth = 0.6 * s;
              f.beginPath(); f.ellipse(fx, fy, q.sz * 1.15 * s, q.sz * 0.6 * s, q.ph + t, 0, TAU); f.fill(); f.stroke();
            }
          }
          if (ignK > 0.04 && ignK < 0.94) {
            const pts = [];
            for (let i = 0; i < 42; i += 1) {
              const a = (i / 42) * TAU;
              const j = 1 + 0.13 * Math.sin(a * 9 + t * 6.5) + 0.07 * Math.cos(a * 5 - t * 4.5);
              pts.push([cx + Math.cos(a) * flameFront * j, cy + Math.sin(a) * flameFront * j]);
            }
            f.strokeStyle = `rgba(18,6,2,${al * (1 - ignK) * 0.45})`; f.lineWidth = 4.2 * s; tracePoly(f, pts, true); f.stroke();
            f.strokeStyle = `rgba(${gold},${al * (1 - ignK) * 0.88})`; f.lineWidth = 1.9 * s; tracePoly(f, pts, true); f.stroke();
          }
        }
      }
    };
  }, { fullCard: true });

  // =========================================================================
  // 2. IMPERIAL JADE DRAGON — Sculpted Nephrite Dragon w/ Cast Depth Shadow,
  //    Dry-Brush Sumi-e Enso, Cloisonné Xiangyun Clouds, 3D Extruded Chop Seal
  // =========================================================================
  api.registerEffect('ex_dragon', 'Imperial Jade Dragon', 'Exclusive', 'Four sculpted imperial acts: celadon nephrite dragon with cast shadows, multi-bristle sumi-e enso calligraphy, cloisonné cloud scrolls, and an extruded vermilion chop seal.', 3, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const jade = '88,224,166';
    const gold = '238,198,112';
    const verm = '212,68,62';
    const octPts = Array.from({ length: 8 }, (_, i) => {
      const a = Math.PI / 8 + (i / 8) * TAU;
      return [cx + Math.cos(a) * ra * 1.24, cy + Math.sin(a) * ra * 1.24];
    });
    const octM = pathMetrics(octPts, true);

    const drawFretCorner = (g, x, y, sx, sy, al) => {
      const u = 5.5 * s;
      const trace = (ox, oy) => {
        g.beginPath();
        g.moveTo(x + ox, y + oy + sy * u * 3.2); g.lineTo(x + ox, y + oy); g.lineTo(x + ox + sx * u * 3.2, y + oy);
        g.lineTo(x + ox + sx * u * 3.2, y + oy + sy * u * 1.2); g.lineTo(x + ox + sx * u * 1.2, y + oy + sy * u * 1.2);
        g.lineTo(x + ox + sx * u * 1.2, y + oy + sy * u * 2.2); g.lineTo(x + ox + sx * u * 2.1, y + oy + sy * u * 2.2);
        g.stroke();
      };
      g.strokeStyle = `rgba(2,5,8,${al * 0.55})`; g.lineWidth = 2.0 * s; trace(1.2 * s, 1.6 * s);
      g.strokeStyle = `rgba(${gold},${al})`; g.lineWidth = 1.25 * s; trace(0, 0);
    };

    const drawCloudScroll = (g, x, y, sc, rgb, al) => {
      const path = () => {
        g.beginPath();
        g.moveTo(-26 * sc, 6 * sc);
        g.bezierCurveTo(-32 * sc, -6 * sc, -16 * sc, -14 * sc, -8 * sc, -6 * sc);
        g.bezierCurveTo(-4 * sc, -18 * sc, 14 * sc, -18 * sc, 16 * sc, -5 * sc);
        g.bezierCurveTo(28 * sc, -8 * sc, 34 * sc, 6 * sc, 20 * sc, 8 * sc);
        g.lineTo(-20 * sc, 8 * sc);
        g.closePath();
      };
      // Grounded cast shadow under cloisonné cloud
      g.save(); g.translate(x + L_DX * 4.5 * sc, y + L_DY * 4.5 * sc);
      g.fillStyle = `rgba(2,6,8,${al * 0.34})`; path(); g.fill(); g.restore();
      g.save(); g.translate(x, y);
      const gr = g.createLinearGradient(0, -16 * sc, 0, 8 * sc);
      gr.addColorStop(0, `rgba(232,250,240,${al * 0.34})`);
      gr.addColorStop(0.55, `rgba(${rgb},${al * 0.28})`);
      gr.addColorStop(1, `rgba(10,34,26,${al * 0.44})`);
      g.fillStyle = gr; path(); g.fill();
      g.strokeStyle = `rgba(${gold},${al * 0.82})`; g.lineWidth = 1.15 * s; g.stroke();
      g.restore();
    };

    const drawLungDragon = (g, pts, al, t) => {
      const n = pts.length;
      // 1. Floating directional shadow projected down-right onto the card surface!
      castShadow(g, 8.5 * s, al * 0.88, (shCol) => {
        g.lineCap = 'round';
        for (let i = n - 1; i >= 1; i -= 1) {
          const k = 1 - i / n;
          g.strokeStyle = shCol;
          g.lineWidth = (2.2 + Math.sin(k * Math.PI) * 10.2) * s;
          g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[i - 1][0], pts[i - 1][1]); g.stroke();
        }
      });
      g.save(); g.globalAlpha = al; g.lineCap = 'round';
      for (let i = n - 1; i >= 1; i -= 1) {
        const k = 1 - i / n;
        const w = (1.8 + Math.sin(k * Math.PI) * 9.8) * s;
        const dx = pts[i - 1][0] - pts[i][0]; const dy = pts[i - 1][1] - pts[i][1];
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len; const ny = dx / len;
        // Sculpted golden dorsal ridge fin
        if (i % 3 === 0 && i < n - 2) {
          g.strokeStyle = `rgba(${gold},${0.88 * k})`; g.lineWidth = 1.3 * s;
          g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[i][0] + nx * w * 0.94, pts[i][1] + ny * w * 0.94); g.stroke();
        }
        // Deep jade shadow core underbelly
        g.strokeStyle = `rgba(14,72,52,${0.72 + k * 0.25})`; g.lineWidth = w;
        g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[i - 1][0], pts[i - 1][1]); g.stroke();
        // Key-lit translucent celadon nephrite upper spine shifted toward top-left light
        g.strokeStyle = `rgba(${jade},${0.55 + k * 0.42})`; g.lineWidth = w * 0.62;
        g.beginPath(); g.moveTo(pts[i][0] - 1.1 * s, pts[i][1] - 1.4 * s); g.lineTo(pts[i - 1][0] - 1.1 * s, pts[i - 1][1] - 1.4 * s); g.stroke();
        // Overlapping embossed scale catchlight arc
        if (i % 2 === 0) {
          g.strokeStyle = `rgba(255,244,200,${0.74 * k})`; g.lineWidth = Math.max(0.75 * s, w * 0.16);
          g.beginPath(); g.arc(pts[i][0], pts[i][1], w * 0.34, -2.2, -0.5); g.stroke();
        }
      }
      const hx = pts[0][0]; const hy = pts[0][1];
      const ref = pts[Math.min(2, n - 1)];
      const ang = Math.atan2(hy - ref[1], hx - ref[0]);
      // 3D Lit Pearl of Wisdom (with key specular highlight & subtle underside shadow)
      const px = hx + Math.cos(ang) * 18 * s; const py = hy + Math.sin(ang) * 18 * s;
      const pGr = g.createRadialGradient(px - 1.8 * s, py - 2.0 * s, 0.5 * s, px, py, 4.4 * s);
      pGr.addColorStop(0, '#ffffff'); pGr.addColorStop(0.45, '#f6d882'); pGr.addColorStop(1, '#8c5a14');
      glow(g, px, py, 9 * s, gold, 0.46 * al);
      g.fillStyle = pGr; g.beginPath(); g.arc(px, py, 3.8 * s, 0, TAU); g.fill();
      // Sculpted horned dragon head
      g.translate(hx, hy); g.rotate(ang);
      const hGr = g.createLinearGradient(-6 * s, -6 * s, 10 * s, 6 * s);
      hGr.addColorStop(0, '#9bf5ce'); hGr.addColorStop(0.48, '#2cb880'); hGr.addColorStop(1, '#0d4732');
      g.fillStyle = hGr; g.strokeStyle = '#f2d080'; g.lineWidth = 1.15 * s;
      g.beginPath();
      g.moveTo(11.5 * s, 0); g.quadraticCurveTo(3.5 * s, -6.5 * s, -6 * s, -4.6 * s);
      g.lineTo(-3.6 * s, 0); g.lineTo(-6 * s, 4.6 * s); g.quadraticCurveTo(3.5 * s, 6.5 * s, 11.5 * s, 0);
      g.closePath(); g.fill(); g.stroke();
      for (const sd of [-1, 1]) {
        g.strokeStyle = '#f6dc96'; g.lineWidth = 1.15 * s;
        g.beginPath();
        g.moveTo(-2 * s, sd * 3.5 * s); g.quadraticCurveTo(-9 * s, sd * 9 * s, -15 * s, sd * 6 * s);
        g.moveTo(-7 * s, sd * 6.8 * s); g.lineTo(-11 * s, sd * 10.5 * s);
        g.moveTo(7 * s, sd * 2.2 * s); g.quadraticCurveTo(11 * s, sd * (8 + Math.sin(t * 6.5 + sd) * 2.1) * s, 2.5 * s, sd * 13 * s);
        g.stroke();
        g.fillStyle = '#fff5c4'; g.beginPath(); g.arc(2.8 * s, sd * 2.1 * s, 1.3 * s, 0, TAU); g.fill();
      }
      g.restore();
    };

    return (t) => {
      const { scene, activeU, surge, dissolve } = sceneDirector(t, 6.4, 'grand', 4);
      if (full) {
        const ca = 0.56 + surge * 0.34;
        drawFretCorner(f, 8 * s, 8 * s, 1, 1, ca);
        drawFretCorner(f, W - 8 * s, 8 * s, -1, 1, ca);
        drawFretCorner(f, 8 * s, H - 8 * s, 1, -1, ca);
        drawFretCorner(f, W - 8 * s, H - 8 * s, -1, -1, ca);
        for (let i = 0; i < 3; i += 1) {
          const cx0 = frac(t * 0.032 + i * 0.36) * (W + 80 * s) - 40 * s;
          drawCloudScroll(b, cx0, (i === 1 ? H - 24 * s : 24 * s + i * 14 * s), 0.52 * s, jade, 0.28);
        }
      }
      // Beveled imperial octagon frame with grounded shadow
      f.strokeStyle = 'rgba(2,6,8,.52)'; f.lineWidth = 2.4 * s;
      f.save(); f.translate(L_DX * 1.6 * s, L_DY * 1.6 * s); tracePoly(f, octPts, true); f.stroke(); f.restore();
      const og = f.createLinearGradient(cx - ra, cy - ra, cx + ra, cy + ra);
      og.addColorStop(0, '#fff4cf'); og.addColorStop(0.5, '#d8aa50'); og.addColorStop(1, '#7a5618');
      f.strokeStyle = og; f.lineWidth = 1.6 * s; tracePoly(f, octPts, true); f.stroke();
      traceComet(f, octM, frac(t * 0.14), 0.18, jade, 1.5 * s, 0.78, s, 14);

      if (surge > 0.02) {
        const al = Math.min(1, surge * 1.18) * (1 - dissolve * 0.84);
        if (scene === 0) {
          const headP = -0.15 + activeU * 1.48;
          const pts = [];
          for (let i = 0; i < 28; i += 1) {
            const p = headP - i * 0.03;
            const px = full ? W * (0.98 - p * 0.96) + Math.sin(p * Math.PI * 3.1 + t * 2.1) * W * 0.2 : cx + Math.cos(p * Math.PI * 2.5 + 0.4) * ra * 1.8;
            const py = full ? H * (0.92 - p * 0.84) + Math.cos(p * Math.PI * 2.4) * ra * 0.72 : cy + Math.sin(p * Math.PI * 3.0) * ra * 0.9;
            const pull = Math.exp(-Math.pow((p - 0.52) * 3.2, 2)) * 0.74;
            pts.push([px + (cx - px) * pull, py + (cy - py) * pull]);
          }
          drawLungDragon(f, pts, al, t);
        } else if (scene === 1) {
          // Layered Sumi-e Wet-Ink Enso Brushstroke with realistic ink bleed + dry-brush gold-leaf bristles
          const sweep = Math.min(1, activeU * 1.42);
          const segs = Math.floor(sweep * 44);
          const rBase = ra * (1.26 + dissolve * 0.5);
          f.save(); f.lineCap = 'round';
          for (let i = 1; i <= segs; i += 1) {
            const k0 = (i - 1) / 44; const k1 = i / 44;
            const a0 = -Math.PI * 0.75 + k0 * TAU * 0.94; const a1 = -Math.PI * 0.75 + k1 * TAU * 0.94;
            const r0 = rBase + Math.sin(k0 * 11) * 2.0 * s; const r1 = rBase + Math.sin(k1 * 11) * 2.0 * s;
            const thick = (9.6 * Math.sin(k1 * Math.PI * 0.85) + 1.4) * s * (1 - k1 * 0.34);
            // Soft dark-jade ink bleed shadow
            f.strokeStyle = `rgba(6,28,20,${al * (0.52 - k1 * 0.16)})`; f.lineWidth = thick * 1.24;
            f.beginPath(); f.moveTo(cx + Math.cos(a0) * r0 + 1.6 * s, cy + Math.sin(a0) * r0 + 2.2 * s); f.lineTo(cx + Math.cos(a1) * r1 + 1.6 * s, cy + Math.sin(a1) * r1 + 2.2 * s); f.stroke();
            // Rich mineral malachite-jade pigment body
            f.strokeStyle = `rgba(${jade},${al * (0.86 - k1 * 0.28)})`; f.lineWidth = thick;
            f.beginPath(); f.moveTo(cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0); f.lineTo(cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1); f.stroke();
            // Fine split dry-brush gold-leaf filaments
            if (i % 2 === 0) {
              f.strokeStyle = `rgba(${gold},${al * 0.78})`; f.lineWidth = thick * 0.22;
              f.beginPath(); f.moveTo(cx + Math.cos(a0) * (r0 + 2.2 * s), cy + Math.sin(a0) * (r0 + 2.2 * s)); f.lineTo(cx + Math.cos(a1) * (r1 + 2.2 * s), cy + Math.sin(a1) * (r1 + 2.2 * s)); f.stroke();
            }
          }
          f.restore();
        } else if (scene === 2) {
          const rows = full ? 5 : 3;
          for (let r = 0; r < rows; r += 1) {
            const dir = r % 2 === 0 ? 1 : -1;
            const py = full ? H * (0.14 + r * 0.19) : cy + (r - 1) * ra * 0.78;
            for (let c = 0; c < 3; c += 1) {
              const p = frac(activeU * 0.88 + c / 3 + r * 0.14);
              const px = dir === 1 ? (-40 * s + p * (W + 80 * s)) : (W + 40 * s - p * (W + 80 * s));
              drawCloudScroll(f, px, py, (0.94 + (r % 2) * 0.3) * s, r % 2 ? gold : jade, al * Math.sin(p * Math.PI));
            }
          }
        } else {
          // 3D Extruded Cinnabar-Lacquer & Jade Imperial Chop Seal with directional shadow & carved bevels
          const drop = Math.min(1, surge * 1.15);
          const side = ra * (1.26 - drop * 0.14 + dissolve * 0.5);
          const elev = (1 - drop) * 14 * s + 5 * s;
          f.save(); f.globalAlpha = al * 0.96; f.translate(cx, cy); f.rotate(dissolve * 0.2);
          // Grounded cast shadow shifting tighter as seal presses onto card!
          f.fillStyle = 'rgba(2,4,8,.46)';
          rr(f, -side + L_DX * elev, -side + L_DY * elev, side * 2, side * 2, 5 * s); f.fill();
          // Extruded 3D carved jade-lacquer block side wall
          f.fillStyle = '#5c1412';
          rr(f, -side + 2.2 * s, -side + 3.0 * s, side * 2, side * 2, 5 * s); f.fill();
          // Top lacquered seal face with directional sheen
          const sGr = f.createLinearGradient(-side, -side, side, side);
          sGr.addColorStop(0, 'rgba(30,66,52,.84)'); sGr.addColorStop(0.55, 'rgba(14,34,26,.88)'); sGr.addColorStop(1, 'rgba(6,16,12,.92)');
          f.fillStyle = sGr; f.strokeStyle = `rgba(${verm},.96)`; f.lineWidth = 2.6 * s;
          rr(f, -side, -side, side * 2, side * 2, 5 * s); f.fill(); f.stroke();
          // Top-left specular lacquer edge + inner engraved gold collar
          f.strokeStyle = 'rgba(255,234,210,.52)'; f.lineWidth = 0.9 * s;
          f.beginPath(); f.moveTo(-side + 4 * s, side - 4 * s); f.lineTo(-side + 4 * s, -side + 4 * s); f.lineTo(side - 4 * s, -side + 4 * s); f.stroke();
          // Recessed carved seal-script grooves (dark inner shadow + gilded ridge)
          const m = side * 0.6;
          const traceSeal = (ox, oy) => {
            f.beginPath();
            f.moveTo(-m + ox, -m + oy); f.lineTo(m + ox, -m + oy); f.moveTo(ox, -m + oy); f.lineTo(ox, m + oy);
            f.moveTo(-m + ox, oy); f.lineTo(m + ox, oy); f.moveTo(-m + ox, -m * 0.48 + oy); f.lineTo(-m + ox, m + oy);
            f.moveTo(m + ox, -m * 0.48 + oy); f.lineTo(m + ox, m + oy); f.moveTo(-m * 0.55 + ox, m + oy); f.lineTo(m * 0.55 + ox, m + oy);
            f.stroke();
          };
          f.strokeStyle = 'rgba(2,5,6,.72)'; f.lineWidth = 2.2 * s; traceSeal(1.1 * s, 1.4 * s);
          f.strokeStyle = `rgba(${gold},.94)`; f.lineWidth = 1.55 * s; traceSeal(0, 0);
          f.restore();
          for (let i = 0; i < 16; i += 1) {
            const a = (i / 16) * TAU + 0.35;
            const d = side * (1.15 + activeU * (full ? 2.4 : 1.1));
            f.fillStyle = `rgba(${i % 3 === 0 ? verm : i % 2 ? gold : jade},${al * (1 - activeU * 0.48)})`;
            f.beginPath(); f.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, (3.2 + (i % 3)) * s, 1.4 * s, a, 0, TAU); f.fill();
          }
        }
      }
    };
  }, { fullCard: true });

  // =========================================================================
  // 3. SOVEREIGN ECLIPSE — Realistic Lunar Occultation & Corona Streamers,
  //    Optical Einstein Lensing, Terminator-Shaded 8-Phase Moons, Pulsar Jets
  // =========================================================================
  api.registerEffect('ex_eclipse', 'Sovereign Eclipse', 'Exclusive', 'Four astronomical studio acts: cratered total lunar occultation with coronal streamers, gravitational Einstein lensing, shaded 8-phase lunar procession, and twin pulsar jets.', 3, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const gold = '246,204,126';
    const vio = '156,118,236';
    const white = '255,248,234';
    const stars = Array.from({ length: full ? 32 : 16 }, (_, i) => ({
      x: ((i * 0.37 + 0.09) % 1) * W, y: ((i * 0.61 + 0.05) % 1) * H, p: R(0, TAU), r: R(0.65, 1.5)
    }));

    return (t) => {
      const { scene, activeU, surge, dissolve } = sceneDirector(t, 6.4, 'grand', 4);
      if (full) {
        b.strokeStyle = `rgba(${gold},${0.22 + surge * 0.24})`; b.lineWidth = 0.85 * s;
        b.beginPath();
        for (let x = 22 * s; x < W - 18 * s; x += 22 * s) {
          const major = Math.round(x / (22 * s)) % 3 === 0;
          b.moveTo(x, 6 * s); b.lineTo(x, (major ? 14 : 10) * s);
          b.moveTo(x, H - 6 * s); b.lineTo(x, H - (major ? 14 : 10) * s);
        }
        b.stroke();
      }
      for (const st of stars) {
        const tw = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(t * 1.35 + st.p));
        b.fillStyle = `rgba(${white},${tw * 0.44})`;
        b.beginPath(); b.arc(st.x, st.y, st.r * s, 0, TAU); b.fill();
      }
      // Machined gilded astrometric bezel around DP
      drawBevelRing(f, cx, cy, ra * 1.24, 1.75 * s, [[0, '#fff5d6'], [0.42, '#dfb15c'], [0.78, '#72521e'], [1, '#b88cf0']], 0.92, s);
      f.strokeStyle = `rgba(${vio},.55)`; f.lineWidth = 0.85 * s;
      f.beginPath(); f.arc(cx, cy, ra * 1.34, t * 0.28, t * 0.28 + Math.PI * 1.35); f.stroke();

      if (surge > 0.02) {
        const al = Math.min(1, surge * 1.16) * (1 - dissolve * 0.84);
        if (scene === 0) {
          const slide = activeU < 0.34 ? -1.45 * (1 - activeU / 0.34) : dissolve * 1.75;
          const mx = cx + slide * ra * 1.22; const my = cy - slide * ra * 0.28;
          if (full) {
            // Soft radial twilight umbra darkening (not a harsh flat black rectangle!)
            const vig = b.createRadialGradient(cx, cy, ra * 0.6, cx, cy, Math.hypot(W, H) * 0.85);
            vig.addColorStop(0, `rgba(6,4,14,${al * 0.38})`);
            vig.addColorStop(1, `rgba(4,3,10,${al * 0.64})`);
            b.fillStyle = vig; b.fillRect(0, 0, W, H);
          }
          // Feathered polar K-corona & F-corona streamers
          f.save(); f.globalCompositeOperation = 'lighter';
          for (let i = 0; i < 8; i += 1) {
            const a = -0.35 + (i % 2 ? Math.PI : 0) + (Math.floor(i / 2) - 1.5) * 0.22;
            const len = ra * (2.5 + (full ? 2.2 : 0.7) * (i % 3 === 0 ? 1.15 : 0.72));
            const gr = f.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
            gr.addColorStop(0, `rgba(${i % 2 ? gold : vio},${al * 0.36})`);
            gr.addColorStop(0.45, `rgba(${vio},${al * 0.12})`);
            gr.addColorStop(1, 'rgba(156,118,236,0)');
            f.fillStyle = gr;
            f.beginPath(); f.moveTo(cx, cy); f.arc(cx, cy, len, a - 0.1, a + 0.1); f.closePath(); f.fill();
          }
          f.restore();
          // Sculpted cratered lunar sphere with directional earthshine & cast penumbra
          castShadow(f, 5.5 * s, al * 0.8, (shCol) => {
            f.fillStyle = shCol; f.beginPath(); f.arc(mx, my, ra * 1.06, 0, TAU); f.fill();
          });
          f.save(); f.globalAlpha = al * 0.98;
          const dg = f.createRadialGradient(mx + ra * 0.38, my - ra * 0.34, ra * 0.08, mx, my, ra * 1.08);
          dg.addColorStop(0, '#1e1836'); dg.addColorStop(0.58, '#0c091a'); dg.addColorStop(0.92, '#05030b'); dg.addColorStop(1, 'rgba(246,204,126,.85)');
          f.fillStyle = dg; f.beginPath(); f.arc(mx, my, ra * 1.05, 0, TAU); f.fill();
          // Subtle recessed lunar maria & sunlit rim highlights
          for (const [ox, oy, cr] of [[-0.28, -0.18, 0.26], [0.22, 0.24, 0.21], [-0.1, 0.34, 0.16], [0.26, -0.26, 0.14]]) {
            f.fillStyle = 'rgba(255,246,228,.045)';
            f.beginPath(); f.arc(mx + ox * ra, my + oy * ra, cr * ra, 0, TAU); f.fill();
            f.strokeStyle = 'rgba(255,244,220,.08)'; f.lineWidth = 0.7 * s;
            f.beginPath(); f.arc(mx + ox * ra, my + oy * ra, cr * ra, -1.6, 0.2); f.stroke();
          }
          f.strokeStyle = `rgba(${gold},.92)`; f.lineWidth = 1.65 * s;
          f.beginPath(); f.arc(mx, my, ra * 1.05, -1.5, 0.45); f.stroke();
          f.restore();
          const dx = cx + ra * 0.78; const dy = cy - ra * 0.72;
          glow(f, dx, dy, ra * (1.05 + surge * 0.6), gold, al * 0.76);
          sparkle(f, dx, dy, (7.5 + surge * 6.5) * s, white, al);
          for (const ba of [-0.55, -0.95, -0.32]) {
            glow(f, cx + Math.cos(ba) * ra * 1.06, cy + Math.sin(ba) * ra * 1.06, 4.2 * s, white, al * 0.78);
          }
        } else if (scene === 1) {
          // Gravitational Einstein Lensing with subtle optical chromatic rim separation
          f.save(); f.lineCap = 'round';
          for (let i = 0; i < 16; i += 1) {
            const band = i % 3;
            const rArc = ra * (0.95 + band * 0.52 + dissolve * 1.15);
            const a0 = (i / 16) * TAU + t * (band === 1 ? -0.88 : 1.12);
            const span = 0.28 + 0.34 * surge;
            f.strokeStyle = `rgba(${vio},${al * 0.42})`; f.lineWidth = (2.8 - band * 0.4) * s;
            f.beginPath(); f.arc(cx, cy, rArc - 1.0 * s, a0, a0 + span); f.stroke();
            f.strokeStyle = `rgba(${band === 0 ? white : gold},${al * (0.86 - band * 0.16)})`; f.lineWidth = (1.5 - band * 0.3) * s;
            f.beginPath(); f.arc(cx, cy, rArc, a0, a0 + span); f.stroke();
          }
          if (full) {
            b.strokeStyle = `rgba(${vio},${al * 0.22})`; b.lineWidth = 0.8 * s;
            for (let y = 36 * s; y < H; y += 44 * s) {
              const dy = y - cy;
              const bend = Math.exp(-(dy * dy) / (ra * ra * 5.2)) * (dy >= 0 ? 1 : -1) * 26 * s * surge;
              b.beginPath(); b.moveTo(8 * s, y); b.quadraticCurveTo(cx, y + bend, W - 8 * s, y); b.stroke();
            }
          }
          f.restore();
        } else if (scene === 2) {
          // 8-Phase Shaded Lunar Procession with soft terminator gradients & grounded drop shadows
          const count = 8;
          const x0 = 8 * s; const y0 = full ? H * 0.72 : cy + ra * 0.75;
          const x1 = cx + ra * 0.5; const y1 = cy - ra * 0.55;
          const x2 = W - 8 * s; const y2 = full ? H * 0.18 : cy - ra * 0.75;
          f.strokeStyle = `rgba(${gold},${al * 0.32})`; f.lineWidth = 0.85 * s;
          f.beginPath(); f.moveTo(x0, y0); f.quadraticCurveTo(x1, y1, x2, y2); f.stroke();
          for (let i = 0; i < count; i += 1) {
            const p = frac(activeU * 0.55 + i / count);
            const mt = 1 - p;
            const mx = mt * mt * x0 + 2 * mt * p * x1 + p * p * x2;
            const my = mt * mt * y0 + 2 * mt * p * y1 + p * p * y2;
            const mr = (6.4 + Math.sin(p * Math.PI) * 4.4) * s;
            const phaseAl = Math.sin(p * Math.PI) * al;
            f.save(); f.globalAlpha = phaseAl;
            // Subtle drop shadow under each floating moon sphere
            f.fillStyle = 'rgba(2,4,10,.42)'; f.beginPath(); f.arc(mx + 2.5 * s, my + 3.4 * s, mr * 1.02, 0, TAU); f.fill();
            // Soft directional spherical moon shading
            const lightShift = Math.cos((i / count) * TAU) * mr * 0.95;
            const mGr = f.createRadialGradient(mx - lightShift * 0.65 - mr * 0.2, my - mr * 0.25, mr * 0.1, mx + lightShift * 0.35, my + mr * 0.15, mr * 1.25);
            mGr.addColorStop(0, i === 4 ? '#fbe1a2' : '#fff8ea');
            mGr.addColorStop(0.55, i === 4 ? '#c48636' : '#9aa0b8');
            mGr.addColorStop(0.84, '#1b162e');
            mGr.addColorStop(1, '#090714');
            f.fillStyle = mGr; f.beginPath(); f.arc(mx, my, mr, 0, TAU); f.fill();
            f.strokeStyle = 'rgba(255,248,228,.24)'; f.lineWidth = 0.65 * s; f.stroke();
            f.restore();
          }
        } else {
          // Twin narrow relativistic pulsar jets with dark dust occlusion & refined muted nebula depth
          const jetAng = -0.58 + Math.sin(t * 1.35) * 0.12;
          const jLen = full ? Math.hypot(W, H) * 0.75 : ra * 3.0;
          f.save(); f.globalCompositeOperation = 'lighter';
          for (const dir of [-1, 1]) {
            const ex = cx + Math.cos(jetAng) * jLen * dir; const ey = cy + Math.sin(jetAng) * jLen * dir;
            const gr = f.createLinearGradient(cx, cy, ex, ey);
            gr.addColorStop(0, `rgba(${white},${al * 0.78})`); gr.addColorStop(0.28, `rgba(${vio},${al * 0.42})`); gr.addColorStop(1, 'rgba(246,204,126,0)');
            f.strokeStyle = gr; f.lineWidth = (6.8 - dissolve * 3.0) * s; f.lineCap = 'round';
            f.beginPath(); f.moveTo(cx, cy); f.lineTo(ex, ey); f.stroke();
            f.strokeStyle = `rgba(${white},${al * 0.85})`; f.lineWidth = 1.35 * s;
            f.beginPath(); f.moveTo(cx, cy); f.lineTo(cx + Math.cos(jetAng) * jLen * 0.55 * dir, cy + Math.sin(jetAng) * jLen * 0.55 * dir); f.stroke();
          }
          for (let i = 0; i < 6; i += 1) {
            glow(f, W * (0.15 + ((i * 0.31) % 0.75)), H * (0.18 + ((i * 0.27) % 0.68)), (26 + (i % 3) * 14) * s, i % 2 ? vio : gold, al * 0.18);
          }
          f.restore();
        }
      }
    };
  }, { fullCard: true });

  // =========================================================================
  // 4. VOLT OVERLORD — Machined Insulator Pylons, Recursive Forked Lightning,
  //    3D Cylindrical Jacob's Ladder Rods, Magnetic Flux Cage, Etched PCB Bus
  // =========================================================================
  api.registerEffect('ex_tempest', 'Volt Overlord', 'Exclusive', 'Four studio-lit high-voltage acts: recursive supercell lightning, 3D cylindrical Jacob’s ladder electrodes, dipole magnetic flux loops, and etched copper PCB capacitor discharge.', 3, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const cyan = '92,232,250';
    const volt = '156,124,248';
    const hexPts = Array.from({ length: 6 }, (_, i) => {
      const a = -Math.PI / 6 + (i / 6) * TAU;
      return [cx + Math.cos(a) * ra * 1.28, cy + Math.sin(a) * ra * 1.28];
    });

    const drawForkedBolt = (g, x1, y1, x2, y2, seed, jitter, rgb, width, al, segs = 9, branches = 2) => {
      if (al <= 0.02) return;
      const dx = x2 - x1; const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len; const ny = dx / len;
      const pts = [[x1, y1]];
      for (let i = 1; i < segs; i += 1) {
        const k = i / segs;
        const n = Math.sin(seed * 17.3 + i * 7.7) * 0.6 + Math.cos(seed * 29.1 + i * 11.3) * 0.4;
        pts.push([x1 + dx * k + nx * n * jitter * Math.sin(k * Math.PI), y1 + dy * k + ny * n * jitter * Math.sin(k * Math.PI)]);
      }
      pts.push([x2, y2]);
      g.lineCap = 'round';
      // Ionized dark-ozone atmospheric halo for rich contrast (prevents cheap flat neon look!)
      g.strokeStyle = `rgba(10,24,48,${al * 0.48})`; g.lineWidth = width * 4.2; tracePoly(g, pts, false); g.stroke();
      g.strokeStyle = `rgba(${rgb},${al * 0.46})`; g.lineWidth = width * 2.4; tracePoly(g, pts, false); g.stroke();
      g.strokeStyle = `rgba(248,254,255,${Math.min(1, al * 0.96)})`; g.lineWidth = width; tracePoly(g, pts, false); g.stroke();
      if (branches > 0 && pts.length > 4) {
        for (let bIdx = 0; bIdx < branches; bIdx += 1) {
          const p = pts[2 + ((bIdx * 3) % (pts.length - 3))];
          const ang = Math.atan2(dy, dx) + (bIdx % 2 ? 0.62 : -0.62);
          drawForkedBolt(g, p[0], p[1], p[0] + Math.cos(ang) * len * 0.34, p[1] + Math.sin(ang) * len * 0.34, seed + bIdx * 13, jitter * 0.5, rgb, width * 0.56, al * 0.72, 5, 0);
        }
      }
    };

    return (t) => {
      const { scene, activeU, surge, dissolve } = sceneDirector(t, 5.8, 'snap', 4);
      const stepSeed = Math.floor(t * 15);
      // Bespoke Perimeter: 4 Machined Ceramic-Titanium High-Voltage Insulator Pylons w/ cast shadows
      if (full) {
        const pylons = [[11 * s, 11 * s], [W - 11 * s, 11 * s], [W - 11 * s, H - 11 * s], [11 * s, H - 11 * s]];
        for (const [px, py] of pylons) {
          f.fillStyle = 'rgba(2,5,10,.55)'; f.beginPath(); f.arc(px + 2 * s, py + 2.8 * s, 6.2 * s, 0, TAU); f.fill();
          const pGr = f.createRadialGradient(px - 2 * s, py - 2 * s, 0.5 * s, px, py, 6.2 * s);
          pGr.addColorStop(0, '#eef7ff'); pGr.addColorStop(0.45, '#536b82'); pGr.addColorStop(1, '#1a2533');
          f.fillStyle = pGr; f.beginPath(); f.arc(px, py, 5.8 * s, 0, TAU); f.fill();
          f.strokeStyle = `rgba(${cyan},${0.55 + surge * 0.38})`; f.lineWidth = 0.9 * s; f.stroke();
          f.fillStyle = `rgba(${cyan},${0.75 + surge * 0.25})`; f.beginPath(); f.arc(px, py, 2.0 * s, 0, TAU); f.fill();
        }
        if (Math.sin(t * 3.4) > 0.64) {
          const idx = stepSeed % 4;
          const a = pylons[idx]; const bP = pylons[(idx + 1) % 4];
          drawForkedBolt(b, a[0], a[1], bP[0], bP[1], stepSeed + 2, 6 * s, cyan, 0.8 * s, 0.36, 7, 0);
        }
      }
      // Machined gunmetal-titanium hexagonal collar around DP with cast shadow & directional bevel
      f.strokeStyle = 'rgba(2,5,10,.56)'; f.lineWidth = 2.8 * s;
      f.save(); f.translate(L_DX * 1.8 * s, L_DY * 1.8 * s); tracePoly(f, hexPts, true); f.stroke(); f.restore();
      const hg = f.createLinearGradient(cx - ra, cy - ra, cx + ra, cy + ra);
      hg.addColorStop(0, '#e6f8ff'); hg.addColorStop(0.45, '#5cc8e6'); hg.addColorStop(0.8, '#284566'); hg.addColorStop(1, '#9c7cf4');
      f.strokeStyle = hg; f.lineWidth = 1.75 * s; tracePoly(f, hexPts, true); f.stroke();

      if (surge > 0.02) {
        const al = Math.min(1, surge * 1.2) * (1 - dissolve * 0.82);
        if (scene === 0) {
          drawForkedBolt(f, full ? W * 0.62 : cx + ra * 0.7, 2 * s, cx, cy, stepSeed, 17 * s, cyan, 1.8 * s, al, 10, 3);
          drawForkedBolt(f, cx, cy, full ? W * 0.25 : cx - ra * 1.1, H - 4 * s, stepSeed + 19, 13 * s, volt, 1.4 * s, al * 0.9, 8, 2);
          glow(f, cx, cy, ra * 1.5, cyan, al * 0.42);
        } else if (scene === 1) {
          // 3D Cylindrical Metallic Jacob's Ladder Electrodes with cast shadow + climbing plasma arcs
          const lx = full ? 16 * s : cx - ra * 1.55;
          const rx = full ? W - 16 * s : cx + ra * 1.55;
          for (const ex of [lx, rx]) {
            f.fillStyle = `rgba(2,5,10,${al * 0.48})`; f.fillRect(ex - 1 * s, 16 * s, 4.8 * s, H - 28 * s);
            const rGr = f.createLinearGradient(ex - 2.4 * s, 0, ex + 2.4 * s, 0);
            rGr.addColorStop(0, '#e2eef8'); rGr.addColorStop(0.42, '#69829b'); rGr.addColorStop(1, '#1e2c3c');
            f.fillStyle = rGr; f.fillRect(ex - 2.2 * s, 14 * s, 4.4 * s, H - 28 * s);
          }
          for (let i = 0; i < 4; i += 1) {
            const p = frac(activeU * 1.35 + i * 0.25);
            const ay = H * (0.94 - p * 0.86);
            const bow = -18 * s * Math.sin(p * Math.PI);
            const arcAl = al * Math.sin(p * Math.PI);
            drawForkedBolt(f, lx, ay, (lx + rx) * 0.5, ay + bow, stepSeed + i * 7, 9 * s, i % 2 ? volt : cyan, 1.2 * s, arcAl, 6, 0);
            drawForkedBolt(f, (lx + rx) * 0.5, ay + bow, rx, ay, stepSeed + i * 11, 9 * s, i % 2 ? cyan : volt, 1.2 * s, arcAl, 6, 0);
            glow(f, lx, ay, 5.5 * s, cyan, arcAl * 0.72);
            glow(f, rx, ay, 5.5 * s, cyan, arcAl * 0.72);
          }
        } else if (scene === 2) {
          const poleY = ra * 0.72;
          for (const sd of [-1, 1]) {
            for (let k = 1; k <= 4; k += 1) {
              const wx = ra * (0.9 + k * 0.52 + dissolve * 0.55);
              f.strokeStyle = `rgba(6,16,32,${al * 0.42})`; f.lineWidth = 2.6 * s;
              f.beginPath(); f.moveTo(cx, cy - poleY); f.bezierCurveTo(cx + sd * wx, cy - poleY * 1.45, cx + sd * wx, cy + poleY * 1.45, cx, cy + poleY); f.stroke();
              f.strokeStyle = `rgba(${k % 2 ? cyan : volt},${al * (0.78 - k * 0.12)})`; f.lineWidth = 1.2 * s;
              f.beginPath(); f.moveTo(cx, cy - poleY); f.bezierCurveTo(cx + sd * wx, cy - poleY * 1.45, cx + sd * wx, cy + poleY * 1.45, cx, cy + poleY); f.stroke();
              const u0 = frac(t * (1.2 + k * 0.22) + k * 0.21);
              const mt = 1 - u0;
              const px = 3 * mt * mt * u0 * (cx + sd * wx) + 3 * mt * u0 * u0 * (cx + sd * wx) + (mt * mt * mt + u0 * u0 * u0) * cx;
              const py = mt * mt * mt * (cy - poleY) + 3 * mt * mt * u0 * (cy - poleY * 1.45) + 3 * mt * u0 * u0 * (cy + poleY * 1.45) + u0 * u0 * u0 * (cy + poleY);
              glow(f, px, py, 5 * s, k % 2 ? cyan : volt, al * 0.8);
              f.fillStyle = `rgba(255,255,255,${al})`; f.beginPath(); f.arc(px, py, 1.3 * s, 0, TAU); f.fill();
            }
          }
        } else {
          // Etched Metallic PCB Bus Traces + 3D Ceramic-Gold SMD Capacitor Nodes
          const targets = full
            ? [[28 * s, 28 * s], [W - 28 * s, 28 * s], [W - 24 * s, H * 0.54], [W - 28 * s, H - 28 * s], [28 * s, H - 28 * s], [24 * s, H * 0.62]]
            : [[cx - ra * 1.6, cy - ra], [cx + ra * 1.6, cy - ra], [cx + ra * 1.7, cy + ra * 0.9], [cx - ra * 1.7, cy + ra * 0.9]];
          const reach = Math.min(1, activeU * 1.65);
          f.lineCap = 'round';
          for (let i = 0; i < targets.length; i += 1) {
            const [tx, ty] = targets[i];
            const mx = cx + (tx - cx) * 0.52;
            const col = i % 2 ? volt : cyan;
            const traceBus = (ox, oy) => {
              f.beginPath(); f.moveTo(cx + ox, cy + oy);
              if (reach < 0.5) {
                const p = reach * 2; f.lineTo(cx + ox + (mx - cx) * p, cy + oy + (ty - cy) * 0.5 * p);
              } else {
                const p = (reach - 0.5) * 2;
                f.lineTo(mx + ox, cy + oy + (ty - cy) * 0.5);
                f.lineTo(mx + ox + (tx - mx) * p, cy + oy + (ty - cy) * 0.5 + (ty - (cy + (ty - cy) * 0.5)) * p);
              }
              f.stroke();
            };
            f.strokeStyle = `rgba(2,8,16,${al * 0.55})`; f.lineWidth = 3.2 * s; traceBus(1.2 * s, 1.6 * s);
            f.strokeStyle = `rgba(${col},${al * 0.88})`; f.lineWidth = 1.55 * s; traceBus(0, 0);
            if (reach > 0.78) {
              // Beveled SMD capacitor pad
              f.fillStyle = `rgba(2,5,10,${al * 0.5})`; f.beginPath(); f.arc(tx + 1.5 * s, ty + 2 * s, 5.2 * s, 0, TAU); f.fill();
              f.fillStyle = '#1b2b3d'; f.strokeStyle = `rgba(${col},${al})`; f.lineWidth = 1.3 * s;
              f.beginPath(); f.arc(tx, ty, 4.6 * s, 0, TAU); f.fill(); f.stroke();
              sparkle(f, tx, ty, 5.2 * s, '246,252,255', al);
            }
          }
        }
      }
    };
  }, { fullCard: true });

  // =========================================================================
  // 5. CRIMSON TEMPEST — Velvet-Shaded Notched Petals w/ Drop Shadows,
  //    Iaijutsu Rift Cut, 3D Accordion-Pleated Sensu Fans, Satin Hagoromo Ribbons
  // =========================================================================
  api.registerEffect('ex_blossom', 'Crimson Tempest', 'Exclusive', 'Four artisanal crimson acts: velvet-shaded notched sakura squall, single-line iaijutsu cut, 3D accordion-pleated sensu folding fans, and satin hagoromo silk ribbons.', 3, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const crim = '234,82,118';
    const blush = '252,206,220';
    const gold = '242,204,132';
    const petals = Array.from({ length: full ? 36 : 20 }, (_, i) => ({
      x0: ((i * 0.29 + 0.05) % 1) * W, y0: R(0, 1), v: R(0.038, 0.08),
      sz: R(4.6, 8.0), rot: R(0, TAU), sp: R(0.9, 1.8), c: i % 3 === 0 ? crim : i % 3 === 1 ? blush : gold
    }));

    const drawNotchedPetal = (g, x, y, sz, rot, tilt, rgb, al, castElev = 0) => {
      const sy = 0.34 + 0.66 * Math.abs(Math.cos(tilt));
      const shape = () => {
        g.beginPath();
        g.moveTo(0, sz * 0.72);
        g.bezierCurveTo(-sz * 0.9, sz * 0.15, -sz * 0.75, -sz * 0.78, -sz * 0.14, -sz * 0.65);
        g.lineTo(0, -sz * 0.38);
        g.lineTo(sz * 0.14, -sz * 0.65);
        g.bezierCurveTo(sz * 0.75, -sz * 0.78, sz * 0.9, sz * 0.15, 0, sz * 0.72);
        g.closePath();
      };
      if (castElev > 0) {
        g.save(); g.globalAlpha = al * 0.32;
        g.translate(x + L_DX * castElev, y + L_DY * castElev); g.rotate(rot); g.scale(1, sy);
        g.fillStyle = '#060308'; shape(); g.fill(); g.restore();
      }
      g.save(); g.translate(x, y); g.rotate(rot); g.scale(1, sy);
      const gr = g.createLinearGradient(-sz * 0.4, -sz * 0.7, sz * 0.4, sz * 0.7);
      gr.addColorStop(0, `rgba(255,244,248,${al * 0.96})`);
      gr.addColorStop(0.52, `rgba(${rgb},${al * 0.92})`);
      gr.addColorStop(1, `rgba(112,20,44,${al * 0.88})`);
      g.fillStyle = gr; shape(); g.fill();
      g.strokeStyle = `rgba(255,248,250,${al * 0.42})`; g.lineWidth = 0.55 * s;
      g.beginPath(); g.moveTo(0, sz * 0.56); g.lineTo(0, -sz * 0.34); g.stroke();
      g.restore();
    };

    // 3D Accordion-Pleated Sensu Fan: alternating key-lit & shadowed paper pleats + brass rivet + cast shadow!
    const drawSensuFan = (g, ox, oy, baseAngle, openK, rFan, al) => {
      const span = 0.15 + openK * 1.72;
      const a0 = baseAngle - span * 0.5;
      const ribs = 10;
      // 1. Directional cast shadow under open fan
      castShadow(g, 7.5 * s, al * 0.85, (shCol) => {
        g.save(); g.translate(ox, oy);
        g.fillStyle = shCol;
        g.beginPath(); g.arc(0, 0, rFan, a0, a0 + span); g.arc(0, 0, rFan * 0.28, a0 + span, a0, true); g.closePath(); g.fill();
        g.restore();
      });
      g.save(); g.globalAlpha = al; g.translate(ox, oy);
      // 2. Individual alternating light/shadow accordion pleats!
      for (let i = 0; i < ribs; i += 1) {
        const ra0 = a0 + (i / ribs) * span;
        const ra1 = a0 + ((i + 1) / ribs) * span;
        const lit = i % 2 === 0;
        const gr = g.createRadialGradient(0, 0, rFan * 0.28, 0, 0, rFan);
        if (lit) {
          gr.addColorStop(0, '#5a1426'); gr.addColorStop(0.55, '#d63e66'); gr.addColorStop(0.9, '#f2c874'); gr.addColorStop(1, '#fff3cf');
        } else {
          gr.addColorStop(0, '#360b16'); gr.addColorStop(0.55, '#962242'); gr.addColorStop(0.9, '#c09242'); gr.addColorStop(1, '#e0bc78');
        }
        g.fillStyle = gr;
        g.beginPath(); g.arc(0, 0, rFan, ra0, ra1); g.arc(0, 0, rFan * 0.3, ra1, ra0, true); g.closePath(); g.fill();
      }
      // 3. Lacquered bamboo guard sticks & ribs + brushed brass pivot rivet
      for (let i = 0; i <= ribs; i += 1) {
        const a = a0 + (i / ribs) * span;
        g.strokeStyle = i === 0 || i === ribs ? 'rgba(255,238,186,.92)' : 'rgba(62,16,26,.55)';
        g.lineWidth = (i === 0 || i === ribs ? 1.8 : 0.8) * s;
        g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * rFan, Math.sin(a) * rFan); g.stroke();
      }
      const pGr = g.createRadialGradient(-1 * s, -1 * s, 0.4 * s, 0, 0, 3.6 * s);
      pGr.addColorStop(0, '#fff7dc'); pGr.addColorStop(0.6, '#d8a64c'); pGr.addColorStop(1, '#6a4612');
      g.fillStyle = pGr; g.beginPath(); g.arc(0, 0, 3.4 * s, 0, TAU); g.fill();
      g.restore();
    };

    return (t) => {
      const { scene, activeU, surge, dissolve } = sceneDirector(t, 6.2, 'silk', 4);
      // Bespoke Perimeter: Sculpted weeping cherry branch with cast shadow, bark rim highlight & shadowed blossoms
      if (full) {
        b.save(); b.lineCap = 'round';
        const traceBranch = (ox, oy) => {
          b.beginPath();
          b.moveTo(W + 2 * s + ox, 18 * s + oy); b.bezierCurveTo(W * 0.78 + ox, 12 * s + oy, W * 0.66 + ox, 36 * s + oy, W * 0.44 + ox, 24 * s + oy);
          b.moveTo(W * 0.76 + ox, 20 * s + oy); b.quadraticCurveTo(W * 0.86 + ox, 52 * s + oy, W * 0.92 + ox, 92 * s + oy);
          b.stroke();
        };
        b.strokeStyle = 'rgba(4,2,6,.48)'; b.lineWidth = 3.2 * s; traceBranch(1.8 * s, 2.8 * s);
        b.strokeStyle = '#5c2432'; b.lineWidth = 2.3 * s; traceBranch(0, 0);
        b.strokeStyle = 'rgba(218,140,162,.45)'; b.lineWidth = 0.75 * s; traceBranch(-0.5 * s, -0.7 * s);
        for (const [bx, by, br] of [[W * 0.72, 22 * s, 4.4], [W * 0.56, 26 * s, 3.8], [W * 0.86, 54 * s, 4.2], [W * 0.91, 84 * s, 3.6]]) {
          drawNotchedPetal(b, bx, by, br * s, Math.sin(t * 0.9 + bx) * 0.2, 0.2, blush, 0.84, 2.5 * s);
        }
        b.restore();
      }
      for (let i = 0; i < Math.min(11, petals.length); i += 1) {
        const p = petals[i];
        const pr = frac(p.y0 + t * p.v * 0.75);
        const y = -8 * s + pr * (H + 16 * s);
        const x = (p.x0 + Math.sin(t * 0.9 + p.rot) * 18 * s + t * 6 * s) % W;
        const dim = full && y > cy + ra * 1.4 && x > W * 0.16 && x < W * 0.84 ? 0.22 : 0.68;
        drawNotchedPetal(b, x, y, p.sz * 0.74 * s, p.rot + t * 0.9, t * p.sp, p.c, dim, 2.2 * s);
      }
      // Sculpted lacquered Torii gate arch crowning DP with cast shadow & gold inlay
      f.save(); f.lineCap = 'round';
      f.strokeStyle = 'rgba(4,2,6,.52)'; f.lineWidth = 3.0 * s;
      f.beginPath(); f.moveTo(cx - ra * 1.36 + 1.5 * s, cy - ra * 1.18 + 2.2 * s); f.quadraticCurveTo(cx + 1.5 * s, cy - ra * 0.95 + 2.2 * s, cx + ra * 1.36 + 1.5 * s, cy - ra * 1.18 + 2.2 * s); f.stroke();
      f.strokeStyle = `rgba(${crim},.86)`; f.lineWidth = 1.65 * s;
      f.beginPath(); f.arc(cx, cy, ra * 1.18, -0.15, Math.PI + 0.15); f.stroke();
      f.strokeStyle = '#df4c72'; f.lineWidth = 2.2 * s;
      f.beginPath(); f.moveTo(cx - ra * 1.36, cy - ra * 1.18); f.quadraticCurveTo(cx, cy - ra * 0.95, cx + ra * 1.36, cy - ra * 1.18); f.stroke();
      f.strokeStyle = 'rgba(255,232,238,.55)'; f.lineWidth = 0.7 * s;
      f.beginPath(); f.moveTo(cx - ra * 1.32, cy - ra * 1.2); f.quadraticCurveTo(cx, cy - ra * 0.98, cx + ra * 1.32, cy - ra * 1.2); f.stroke();
      f.strokeStyle = `rgba(${gold},.86)`; f.lineWidth = 1.1 * s;
      f.beginPath(); f.moveTo(cx - ra * 1.16, cy - ra * 1.02); f.quadraticCurveTo(cx, cy - ra * 0.88, cx + ra * 1.16, cy - ra * 1.02); f.stroke();
      f.restore();

      if (surge > 0.02) {
        const al = Math.min(1, surge * 1.18) * (1 - dissolve * 0.82);
        if (scene === 0) {
          for (let i = 0; i < petals.length; i += 1) {
            const p = petals[i];
            const k = frac(activeU * 1.32 + i / petals.length);
            const px = W * (1.12 - k * 1.28);
            const py = H * ((i * 0.41) % 1) + Math.sin(k * TAU * 1.8 + p.rot) * 20 * s;
            drawNotchedPetal(f, px, py, p.sz * s, t * 3.2 + p.rot, t * p.sp * 2.1, p.c, Math.sin(k * Math.PI) * al, 4.5 * s);
          }
        } else if (scene === 1) {
          const cutK = Math.min(1, Math.max(0, (activeU - 0.14) / 0.24));
          const x1 = 4 * s; const y1 = full ? H * 0.74 : cy + ra * 1.15;
          const x2 = W - 4 * s; const y2 = full ? H * 0.12 : cy - ra * 1.15;
          if (activeU < 0.18) sparkle(f, cx - ra * 0.7, cy + ra * 0.4, (11 * (activeU / 0.18)) * s, '255,250,242', al);
          if (cutK > 0.01) {
            const ex = x1 + (x2 - x1) * cutK; const ey = y1 + (y2 - y1) * cutK;
            f.lineCap = 'round';
            // Dark dimensional shadow cleft behind the razor cut
            f.strokeStyle = `rgba(12,2,6,${al * 0.72})`; f.lineWidth = (11 * (1 - dissolve * 0.5)) * s;
            f.beginPath(); f.moveTo(x1, y1 + 1.5 * s); f.lineTo(ex, ey + 1.5 * s); f.stroke();
            f.strokeStyle = `rgba(${crim},${al * 0.62})`; f.lineWidth = (6.4 * (1 - dissolve * 0.55)) * s;
            f.beginPath(); f.moveTo(x1, y1); f.lineTo(ex, ey); f.stroke();
            f.strokeStyle = `rgba(255,248,244,${al * 0.96})`; f.lineWidth = (1.8 * (1 - dissolve * 0.4)) * s;
            f.beginPath(); f.moveTo(x1, y1); f.lineTo(ex, ey); f.stroke();
            for (let i = 0; i < 12; i += 1) {
              const p = (i + 0.5) / 12;
              if (p > cutK) break;
              const sx = x1 + (x2 - x1) * p; const sy = y1 + (y2 - y1) * p - dissolve * (14 + (i % 4) * 9) * s;
              f.fillStyle = `rgba(${i % 2 ? gold : crim},${al * 0.9})`;
              f.beginPath(); f.arc(sx, sy, 1.9 * s, 0, TAU); f.fill();
            }
          }
        } else if (scene === 2) {
          const openK = Math.sin(Math.min(1, activeU * 1.15) * Math.PI);
          drawSensuFan(f, cx - ra * 0.32, cy + ra * 0.42, -Math.PI * 0.25, openK, ra * 1.48, al * 0.94);
          drawSensuFan(f, cx + ra * 0.32, cy - ra * 0.34, Math.PI * 0.75, openK, ra * 1.38, al * 0.9);
        } else {
          // 3D-Twisting Crimson Satin Hagoromo Ribbons with cast drop shadow + front/back fold shading + gold hem!
          for (let r = 0; r < 3; r += 1) {
            const baseY = full ? H * (0.2 + r * 0.28) : cy + (r - 1) * ra * 0.58;
            f.save(); f.lineCap = 'round';
            for (let i = 0; i < 28; i += 1) {
              const k0 = i / 28; const k1 = (i + 1) / 28;
              const x0 = -10 * s + k0 * (W + 20 * s); const x1 = -10 * s + k1 * (W + 20 * s);
              const y0 = baseY + Math.sin(k0 * TAU * 1.6 + t * 2.5 + r * 2.1) * 22 * s;
              const y1 = baseY + Math.sin(k1 * TAU * 1.6 + t * 2.5 + r * 2.1) * 22 * s;
              const cosTw = Math.cos(k0 * TAU * 1.4 + t * 2.0 + r);
              const twist = Math.abs(cosTw);
              const w = (2.2 + twist * 8.6) * s * surge;
              const segAl = al * Math.sin(k0 * Math.PI);
              // Floating shadow cast onto card beneath satin ribbon
              f.strokeStyle = `rgba(6,2,6,${segAl * 0.32})`; f.lineWidth = w * 1.1;
              f.beginPath(); f.moveTo(x0 + 3 * s, y0 + 5.5 * s); f.lineTo(x1 + 3 * s, y1 + 5.5 * s); f.stroke();
              // Front key-lit satin crimson vs back shadowed deep burgundy fold
              const col = r === 1 ? (cosTw >= 0 ? gold : '152,106,36') : (cosTw >= 0 ? crim : '128,22,48');
              f.strokeStyle = `rgba(${col},${segAl * (0.55 + twist * 0.42)})`; f.lineWidth = w;
              f.beginPath(); f.moveTo(x0, y0); f.lineTo(x1, y1); f.stroke();
              // Satin specular highlight thread along upper edge
              if (cosTw > 0.25) {
                f.strokeStyle = `rgba(255,244,238,${segAl * 0.45})`; f.lineWidth = Math.max(0.6 * s, w * 0.18);
                f.beginPath(); f.moveTo(x0, y0 - w * 0.26); f.lineTo(x1, y1 - w * 0.26); f.stroke();
              }
            }
            f.restore();
          }
        }
      }
    };
  }, { fullCard: true });

  // =========================================================================
  // 6. CRYSTALLINE SHATTER — Dual-Faceted Refractive Quartz Shards,
  //    Fluted Glacial Icicles, Etched Dendritic Frost Ferns, Silky Borealis
  // =========================================================================
  api.registerEffect('ex_frost', 'Crystalline Shatter', 'Exclusive', 'Four refractive glacial acts: dual-beveled quartz glass shatter, fluted translucent icicles, etched dendritic frost ferns, and atmospheric Arctic borealis curtains.', 3, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const ice = '148,224,248';
    const frost = '226,246,255';
    const sapph = '98,154,232';
    const mint = '112,232,206';
    const icePts = Array.from({ length: 16 }, (_, i) => {
      const a = -Math.PI / 2 + (i / 16) * TAU;
      return [cx + Math.cos(a) * ra * (i % 2 === 0 ? 1.32 : 1.14), cy + Math.sin(a) * ra * (i % 2 === 0 ? 1.32 : 1.14)];
    });
    const panes = Array.from({ length: full ? 26 : 16 }, (_, i) => ({
      a: (i / (full ? 26 : 16)) * TAU + R(-0.1, 0.1), sp: R(0.75, 1.5), r: R(5.8, 11.8),
      rot: R(0, TAU), rs: R(-2.6, 2.6), c: i % 2 ? ice : sapph
    }));

    const drawFernBranch = (g, x, y, ang, len, depth, rgb, al) => {
      if (depth <= 0 || len < 2.2 * s || al <= 0.02) return;
      const ex = x + Math.cos(ang) * len; const ey = y + Math.sin(ang) * len;
      if (depth >= 2) {
        g.strokeStyle = `rgba(4,12,24,${al * 0.42})`; g.lineWidth = (1.2 + depth * 0.45) * s;
        g.beginPath(); g.moveTo(x + 1 * s, y + 1.4 * s); g.lineTo(ex + 1 * s, ey + 1.4 * s); g.stroke();
      }
      g.strokeStyle = `rgba(${rgb},${al})`; g.lineWidth = (0.55 + depth * 0.42) * s;
      g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke();
      const mx = x + (ex - x) * 0.56; const my = y + (ey - y) * 0.56;
      drawFernBranch(g, mx, my, ang + 0.58, len * 0.52, depth - 1, rgb, al * 0.85);
      drawFernBranch(g, mx, my, ang - 0.58, len * 0.52, depth - 1, rgb, al * 0.85);
      drawFernBranch(g, ex, ey, ang, len * 0.52, depth - 1, rgb, al * 0.82);
    };

    // Dual-plane faceted crystal shard with internal ridge crease, refractive highlight & cast shadow!
    const drawQuartzShard = (g, x, y, r, rot, rgb, al) => {
      g.save();
      g.translate(x + L_DX * 5 * s, y + L_DY * 5 * s); g.rotate(rot);
      g.fillStyle = `rgba(4,10,22,${al * 0.34})`;
      g.beginPath(); g.moveTo(0, -r * 1.3); g.lineTo(r * 0.72, -r * 0.1); g.lineTo(r * 0.15, r * 1.15); g.lineTo(-r * 0.68, r * 0.25); g.closePath(); g.fill();
      g.restore();
      g.save(); g.translate(x, y); g.rotate(rot);
      // Key-lit left refractive facet
      const grL = g.createLinearGradient(-r, -r, 0, r);
      grL.addColorStop(0, `rgba(255,255,255,${al * 0.94})`); grL.addColorStop(1, `rgba(${rgb},${al * 0.62})`);
      g.fillStyle = grL;
      g.beginPath(); g.moveTo(0, -r * 1.3); g.lineTo(r * 0.15, r * 1.15); g.lineTo(-r * 0.68, r * 0.25); g.closePath(); g.fill();
      // Shaded right internal-refraction facet
      const grR = g.createLinearGradient(0, -r, r, r);
      grR.addColorStop(0, `rgba(${rgb},${al * 0.55})`); grR.addColorStop(1, `rgba(28,58,108,${al * 0.72})`);
      g.fillStyle = grR;
      g.beginPath(); g.moveTo(0, -r * 1.3); g.lineTo(r * 0.72, -r * 0.1); g.lineTo(r * 0.15, r * 1.15); g.closePath(); g.fill();
      // Razor top-left specular edge + internal ridge line
      g.strokeStyle = `rgba(255,255,255,${al * 0.86})`; g.lineWidth = 0.85 * s;
      g.beginPath(); g.moveTo(-r * 0.68, r * 0.25); g.lineTo(0, -r * 1.3); g.lineTo(r * 0.15, r * 1.15); g.stroke();
      g.restore();
    };

    return (t) => {
      const { scene, activeU, surge, dissolve } = sceneDirector(t, 6.2, 'creep', 4);
      if (full) {
        const fa = 0.42 + surge * 0.34;
        const fl = 28 * s;
        drawFernBranch(b, 4 * s, 4 * s, 0.78, fl, 2, frost, fa);
        drawFernBranch(b, W - 4 * s, 4 * s, Math.PI - 0.78, fl, 2, frost, fa);
        drawFernBranch(b, 4 * s, H - 4 * s, -0.78, fl, 2, ice, fa);
        drawFernBranch(b, W - 4 * s, H - 4 * s, -Math.PI + 0.78, fl, 2, ice, fa);
      }
      // Sculpted quartz-bezel crown around DP with contact shadow
      f.strokeStyle = 'rgba(4,12,24,.52)'; f.lineWidth = 2.4 * s;
      f.save(); f.translate(L_DX * 1.5 * s, L_DY * 1.5 * s); tracePoly(f, icePts, true); f.stroke(); f.restore();
      const ig = f.createLinearGradient(cx - ra, cy - ra, cx + ra, cy + ra);
      ig.addColorStop(0, '#ffffff'); ig.addColorStop(0.5, '#9ce2fa'); ig.addColorStop(1, '#4c7cc4');
      f.strokeStyle = ig; f.lineWidth = 1.5 * s; tracePoly(f, icePts, true); f.stroke();

      if (surge > 0.02) {
        const al = Math.min(1, surge * 1.18) * (1 - dissolve * 0.84);
        if (scene === 0) {
          const crackK = Math.min(1, activeU / 0.38);
          const breakK = activeU > 0.42 ? (activeU - 0.42) / 0.58 : 0;
          if (breakK <= 0.02) {
            const fg = f.createRadialGradient(cx - ra * 0.25, cy - ra * 0.25, 0, cx, cy, ra * 1.32);
            fg.addColorStop(0, `rgba(232,250,255,${crackK * 0.52})`); fg.addColorStop(0.7, `rgba(116,184,238,${crackK * 0.36})`); fg.addColorStop(1, 'rgba(72,124,200,0)');
            f.fillStyle = fg; f.beginPath(); f.arc(cx, cy, ra * 1.28 * crackK, 0, TAU); f.fill();
            for (let i = 0; i < 8; i += 1) {
              const a = (i / 8) * TAU + 0.15;
              const r1 = ra * 0.55 * crackK; const r2 = ra * 1.28 * crackK;
              const mx = cx + Math.cos(a + 0.08) * r1; const my = cy + Math.sin(a + 0.08) * r1;
              const ex = cx + Math.cos(a) * r2; const ey = cy + Math.sin(a) * r2;
              f.strokeStyle = `rgba(10,24,48,${crackK * 0.52})`; f.lineWidth = 1.8 * s;
              f.beginPath(); f.moveTo(cx + 0.8 * s, cy + 1.1 * s); f.lineTo(mx + 0.8 * s, my + 1.1 * s); f.lineTo(ex + 0.8 * s, ey + 1.1 * s); f.stroke();
              f.strokeStyle = `rgba(255,255,255,${crackK * 0.92})`; f.lineWidth = 0.95 * s;
              f.beginPath(); f.moveTo(cx, cy); f.lineTo(mx, my); f.lineTo(ex, ey); f.stroke();
            }
          } else {
            const shAl = 1 - breakK;
            for (const q of panes) {
              const ease = 1 - Math.pow(1 - breakK, 2.1);
              const dist = ra * (0.25 + ease * (full ? 3.5 : 2.1) * q.sp);
              drawQuartzShard(f, cx + Math.cos(q.a) * dist, cy + Math.sin(q.a) * dist + ease * ease * 34 * s, q.r * s, q.rot + breakK * q.rs * 2.4, q.c, shAl * 0.95);
            }
          }
        } else if (scene === 1) {
          // Fluted Glacial Icicle Stalactites with cast shadow, bright left facet & deep indigo right shadow core!
          const count = full ? 15 : 9;
          const grow = Math.sin(Math.min(1, activeU * 1.1) * Math.PI);
          for (let i = 0; i < count; i += 1) {
            const ix = (W / (count + 1)) * (i + 1);
            const iLen = (full ? H * (0.22 + ((i * 37) % 10) * 0.048) : ra * (0.9 + (i % 3) * 0.45)) * grow;
            const iW = (4.8 + (i % 3) * 2.5) * s;
            // Cast shadow behind icicle
            f.fillStyle = `rgba(4,10,22,${al * 0.32})`;
            f.beginPath(); f.moveTo(ix - iW + 2.5 * s, 0); f.lineTo(ix + iW + 2.5 * s, 0); f.lineTo(ix + 3 * s, iLen + 3 * s); f.closePath(); f.fill();
            // Left lit crystalline flute
            const grL = f.createLinearGradient(ix - iW, 0, ix, iLen);
            grL.addColorStop(0, `rgba(255,255,255,${al * 0.92})`); grL.addColorStop(0.6, `rgba(${ice},${al * 0.68})`); grL.addColorStop(1, `rgba(${ice},${al * 0.16})`);
            f.fillStyle = grL;
            f.beginPath(); f.moveTo(ix - iW, 0); f.lineTo(ix, 0); f.lineTo(ix, iLen); f.closePath(); f.fill();
            // Right deep refractive shadow flute
            const grR = f.createLinearGradient(ix, 0, ix + iW, iLen);
            grR.addColorStop(0, `rgba(${sapph},${al * 0.64})`); grR.addColorStop(0.6, `rgba(28,58,112,${al * 0.54})`); grR.addColorStop(1, `rgba(20,42,84,${al * 0.14})`);
            f.fillStyle = grR;
            f.beginPath(); f.moveTo(ix, 0); f.lineTo(ix + iW, 0); f.lineTo(ix, iLen); f.closePath(); f.fill();
            // Specular central ridge highlight
            f.strokeStyle = `rgba(255,255,255,${al * 0.85})`; f.lineWidth = 0.75 * s;
            f.beginPath(); f.moveTo(ix - iW * 0.25, 2 * s); f.lineTo(ix, iLen * 0.9); f.stroke();
          }
        } else if (scene === 2) {
          const growLen = ra * (0.35 + surge * (full ? 2.05 : 1.25));
          for (let i = 0; i < 6; i += 1) drawFernBranch(f, cx, cy, (i / 6) * TAU + t * 0.16, growLen, 3, i % 2 ? frost : ice, al * 0.92);
        } else {
          const cols = full ? 26 : 16;
          f.save(); f.globalCompositeOperation = 'lighter';
          for (let i = 0; i < cols; i += 1) {
            const k = i / (cols - 1); const x = k * W;
            const waveY = (full ? H * 0.24 : cy - ra * 0.4) + Math.sin(k * TAU * 1.4 + t * 1.4) * 24 * s;
            const colH = (full ? H * 0.62 : ra * 1.9) * (0.65 + 0.35 * Math.sin(k * 9 - t * 2.0));
            const gr = f.createLinearGradient(x, waveY - 12 * s, x, waveY + colH);
            gr.addColorStop(0, 'rgba(112,232,206,0)'); gr.addColorStop(0.24, `rgba(${i % 2 ? mint : ice},${al * 0.28})`);
            gr.addColorStop(0.65, `rgba(${sapph},${al * 0.18})`); gr.addColorStop(1, 'rgba(98,154,232,0)');
            f.fillStyle = gr; f.fillRect(x - (W / cols) * 0.62, waveY - 12 * s, (W / cols) * 1.25, colH + 12 * s);
          }
          f.restore();
        }
      }
    };
  }, { fullCard: true });

  // =========================================================================
  // 7. myIPON SOVEREIGN — Intaglio Banknote Guilloché, Struck 24K ₱ Fountain,
  //    Heavy Beveled Bank-Vault Wheel, Sculpted Emerald Bonsai, 3D Bullion Ingots
  // =========================================================================
  api.registerEffect('ex_sovereign', 'myIPON Sovereign', 'Exclusive', 'Flagship myIPON 4-act masterwork: studio-lit 24K peso bullion fountain, heavy beveled bank-vault tumbler wheel, sculpted emerald bonsai vines, and minted 3D gold ingots.', 3, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const gold = '242,204,116';
    const emer = '72,216,154';
    const white = '255,248,224';
    const coins = Array.from({ length: full ? 22 : 13 }, (_, i) => ({
      vx: R(-1, 1), vy: R(0.75, 1.35), r: R(5.8, 9.0), ph: R(0, TAU), delay: (i / (full ? 22 : 13)) * 0.45
    }));
    const sovPts = Array.from({ length: 72 }, (_, i) => {
      const a = -Math.PI / 2 + (i / 72) * TAU;
      const r = ra * (1.23 + 0.055 * Math.cos(8 * (a + Math.PI / 2)));
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    });
    const sovM = pathMetrics(sovPts, true);

    return (t) => {
      const { scene, activeU, surge, dissolve } = sceneDirector(t, 6.4, 'grand', 4);
      // Bespoke Perimeter: Intaglio engraved banknote guilloché double ribbon (with recessed micro-shadow!)
      if (full) {
        const ga = 0.34 + surge * 0.32;
        for (const edgeY of [10 * s, H - 10 * s]) {
          for (const ph of [0, Math.PI]) {
            const drawWave = (oy) => {
              b.beginPath();
              for (let x = 14 * s; x <= W - 14 * s; x += 6 * s) {
                const y = edgeY + oy + Math.sin(x * 0.14 + ph + t * 0.55) * 3.2 * s;
                if (x === 14 * s) b.moveTo(x, y); else b.lineTo(x, y);
              }
              b.stroke();
            };
            b.strokeStyle = `rgba(2,6,6,${ga * 0.7})`; b.lineWidth = 1.45 * s; drawWave(1.0 * s);
            b.strokeStyle = `rgba(${ph ? emer : gold},${ga})`; b.lineWidth = 0.9 * s; drawWave(0);
          }
        }
        // Faceted emerald corner lozenges with bezel shadow
        for (const [gx, gy] of [[10 * s, 10 * s], [W - 10 * s, 10 * s], [W - 10 * s, H - 10 * s], [10 * s, H - 10 * s]]) {
          f.fillStyle = 'rgba(2,6,6,.55)';
          f.beginPath(); f.moveTo(gx + 1 * s, gy - 3.5 * s); f.lineTo(gx + 5.5 * s, gy + 1 * s); f.lineTo(gx + 1 * s, gy + 5.5 * s); f.lineTo(gx - 3.5 * s, gy + 1 * s); f.closePath(); f.fill();
          const eGr = f.createLinearGradient(gx - 4 * s, gy - 4 * s, gx + 4 * s, gy + 4 * s);
          eGr.addColorStop(0, '#9bf5cc'); eGr.addColorStop(0.5, '#2fa872'); eGr.addColorStop(1, '#0d4a30');
          f.fillStyle = eGr; f.strokeStyle = `rgba(${gold},.92)`; f.lineWidth = 0.95 * s;
          f.beginPath(); f.moveTo(gx, gy - 4.5 * s); f.lineTo(gx + 4.5 * s, gy); f.lineTo(gx, gy + 4.5 * s); f.lineTo(gx - 4.5 * s, gy); f.closePath(); f.fill(); f.stroke();
        }
      }
      // Sculpted bullion-emerald medallion bezel around DP
      f.strokeStyle = 'rgba(2,5,6,.56)'; f.lineWidth = 2.8 * s;
      f.save(); f.translate(L_DX * 1.7 * s, L_DY * 1.7 * s); tracePoly(f, sovPts, true); f.stroke(); f.restore();
      const sg = f.createLinearGradient(cx - ra, cy - ra, cx + ra, cy + ra);
      sg.addColorStop(0, '#fff5d2'); sg.addColorStop(0.38, '#e8b954'); sg.addColorStop(0.72, '#825a14'); sg.addColorStop(1, '#54dca0');
      f.strokeStyle = sg; f.lineWidth = 1.8 * s; tracePoly(f, sovPts, true); f.stroke();
      traceComet(f, sovM, frac(t * 0.14), 0.18, white, 1.55 * s, 0.78, s, 14);

      if (surge > 0.02) {
        const al = Math.min(1, surge * 1.18) * (1 - dissolve * 0.84);
        if (scene === 0) {
          for (const c of coins) {
            const p = frac(activeU * 1.32 + c.delay);
            const sx = full ? W * 0.5 : cx; const sy = H + 8 * s;
            const x = sx + c.vx * (full ? W * 0.46 : ra * 1.7) * p;
            const y = sy - (4 * p * (1 - p)) * (full ? H * 0.92 : ra * 2.6) * c.vy;
            drawStruckCoin(f, x, y, c.r * s, t * 4.5 + c.ph, c.vx * 0.32, Math.sin(p * Math.PI) * al, s);
          }
        } else if (scene === 1) {
          // Heavy 3D Machined Brushed-Gold Bank-Vault Tumbler Wheel w/ cast shadow & sliding steel bolts!
          const unlock = Math.min(1, activeU * 1.4);
          const wheelR = ra * (1.14 + dissolve * 0.34);
          const rot = unlock * Math.PI * 1.25;
          castShadow(f, 7 * s, al * 0.9, (shCol) => {
            f.strokeStyle = shCol; f.lineWidth = 5.4 * s;
            f.beginPath(); f.arc(cx, cy, wheelR, 0, TAU); f.stroke();
          });
          // Heavy beveled outer vault wheel ring
          drawBevelRing(f, cx, cy, wheelR, 4.2 * s, [[0, '#fff5d2'], [0.35, '#e8bc58'], [0.68, '#8a5d18'], [1, '#d8ac4c']], al * 0.96, s);
          drawBevelRing(f, cx, cy, wheelR * 0.72, 1.6 * s, [[0, '#a6f4d0'], [0.5, '#34a874'], [1, '#124c32']], al * 0.9, s);
          f.save(); f.globalAlpha = al * 0.96; f.lineCap = 'round';
          for (let i = 0; i < 6; i += 1) {
            const a = rot + (i / 6) * TAU;
            const ca = Math.cos(a); const sa = Math.sin(a);
            // Spoke cast shadow + cylindrical brass spoke + highlight line
            f.strokeStyle = 'rgba(2,5,8,.55)'; f.lineWidth = 3.4 * s;
            f.beginPath(); f.moveTo(cx + ca * wheelR * 0.22 + 1.5 * s, cy + sa * wheelR * 0.22 + 2 * s); f.lineTo(cx + ca * wheelR + 1.5 * s, cy + sa * wheelR + 2 * s); f.stroke();
            f.strokeStyle = '#d4a242'; f.lineWidth = 2.6 * s;
            f.beginPath(); f.moveTo(cx + ca * wheelR * 0.22, cy + sa * wheelR * 0.22); f.lineTo(cx + ca * wheelR, cy + sa * wheelR); f.stroke();
            f.strokeStyle = 'rgba(255,248,218,.78)'; f.lineWidth = 0.85 * s;
            f.beginPath(); f.moveTo(cx + ca * wheelR * 0.26, cy + sa * wheelR * 0.26); f.lineTo(cx + ca * wheelR * 0.94, cy + sa * wheelR * 0.94); f.stroke();
            // Heavy chamfered brushed-steel locking bolts retracting smoothly
            const b0 = wheelR * (1.28 - unlock * 0.36); const b1 = b0 + 10.5 * s;
            f.strokeStyle = 'rgba(2,5,8,.58)'; f.lineWidth = 5.4 * s;
            f.beginPath(); f.moveTo(cx + ca * b0 + 1.5 * s, cy + sa * b0 + 2 * s); f.lineTo(cx + ca * b1 + 1.5 * s, cy + sa * b1 + 2 * s); f.stroke();
            f.strokeStyle = '#c8d6e0'; f.lineWidth = 4.2 * s;
            f.beginPath(); f.moveTo(cx + ca * b0, cy + sa * b0); f.lineTo(cx + ca * b1, cy + sa * b1); f.stroke();
            f.strokeStyle = 'rgba(255,255,255,.78)'; f.lineWidth = 1.1 * s;
            f.beginPath(); f.moveTo(cx + ca * b0, cy + sa * b0); f.lineTo(cx + ca * b1, cy + sa * b1); f.stroke();
          }
          // Central brushed-gold vault hub cap
          const hGr = f.createRadialGradient(cx - 2.5 * s, cy - 3 * s, 1 * s, cx, cy, wheelR * 0.24);
          hGr.addColorStop(0, '#fff7d6'); hGr.addColorStop(0.55, '#d8a440'); hGr.addColorStop(1, '#5c3a0c');
          f.fillStyle = hGr; f.beginPath(); f.arc(cx, cy, wheelR * 0.23, 0, TAU); f.fill();
          f.restore();
        } else if (scene === 2) {
          // Sculpted Living Emerald-Gold Bonsai Vines with cast shadows & two-tone folded leaves
          const grow = Math.min(1, surge * 1.15);
          for (const sd of [-1, 1]) {
            const x0 = full ? (sd === -1 ? 16 * s : W - 16 * s) : cx + sd * ra * 1.5;
            const y0 = H - 8 * s; const cpx = cx + sd * ra * 1.45; const cpy = cy + ra * 0.9;
            const x2 = cx + sd * ra * 0.28; const y2 = cy - ra * 0.95;
            const steps = Math.floor(grow * 20);
            const traceStem = (ox, oy) => {
              f.beginPath();
              for (let i = 0; i <= steps; i += 1) {
                const k = i / 20; const mt = 1 - k;
                const px = mt * mt * x0 + 2 * mt * k * cpx + k * k * x2 + ox;
                const py = mt * mt * y0 + 2 * mt * k * cpy + k * k * y2 + oy;
                if (i === 0) f.moveTo(px, py); else f.lineTo(px, py);
              }
              f.stroke();
            };
            f.lineCap = 'round';
            f.strokeStyle = `rgba(2,8,6,${al * 0.5})`; f.lineWidth = 3.2 * s; traceStem(2 * s, 3 * s);
            f.strokeStyle = `rgba(${gold},${al * 0.92})`; f.lineWidth = 2.0 * s; traceStem(0, 0);
            for (let i = 3; i <= steps; i += 3) {
              const k = i / 20; const mt = 1 - k;
              const px = mt * mt * x0 + 2 * mt * k * cpx + k * k * x2;
              const py = mt * mt * y0 + 2 * mt * k * cpy + k * k * y2;
              drawSculptedLeaf(f, px, py, 14 * s * grow, 5.2 * s * grow, (i % 2 ? -0.6 : 0.6) * sd - 0.72, '#9cf5a4', '#269454', '#18683a', '#0a331d', 'rgba(244,220,148,.75)', al * 0.95, 3.2 * s);
            }
          }
        } else {
          // 3D Beveled Minted 24K Bullion Ingots (top face + bright left chamfer + dark right/bottom chamfer + cast shadow!)
          const cnt = full ? 7 : 4;
          for (let i = 0; i < cnt; i += 1) {
            const p = frac(activeU * 1.15 + i / cnt);
            const ix = -28 * s + p * (W + 56 * s);
            const iy = H * (0.14 + (i / cnt) * 0.74) - p * 26 * s;
            const ial = Math.sin(p * Math.PI) * al;
            f.save(); f.globalAlpha = ial; f.translate(ix, iy); f.rotate(-0.22);
            // Cast shadow beneath ingot
            f.fillStyle = 'rgba(2,5,8,.42)';
            f.beginPath(); f.moveTo(-14 * s, -2 * s); f.lineTo(18 * s, -2 * s); f.lineTo(22 * s, 11 * s); f.lineTo(-12 * s, 11 * s); f.closePath(); f.fill();
            // Bottom-right shaded sloped chamfer wall
            f.fillStyle = '#6c460c';
            f.beginPath(); f.moveTo(-17 * s, 7 * s); f.lineTo(17 * s, 7 * s); f.lineTo(13 * s, -6.5 * s); f.lineTo(-13 * s, -6.5 * s); f.closePath(); f.fill();
            // Left bright lit chamfer bevel
            f.fillStyle = '#fff5cf';
            f.beginPath(); f.moveTo(-17 * s, 7 * s); f.lineTo(-13 * s, -6.5 * s); f.lineTo(-10 * s, -3.5 * s); f.lineTo(-12.5 * s, 3.5 * s); f.closePath(); f.fill();
            // Brushed top struck bullion crown face
            const gr = f.createLinearGradient(-12 * s, -4 * s, 12 * s, 4 * s);
            gr.addColorStop(0, '#fff4be'); gr.addColorStop(0.45, '#e8b642'); gr.addColorStop(1, '#a67418');
            f.fillStyle = gr;
            f.beginPath(); f.moveTo(-10 * s, -3.5 * s); f.lineTo(10 * s, -3.5 * s); f.lineTo(12.5 * s, 3.5 * s); f.lineTo(-12.5 * s, 3.5 * s); f.closePath(); f.fill();
            f.strokeStyle = 'rgba(255,250,224,.75)'; f.lineWidth = 0.7 * s; f.stroke();
            f.restore();
          }
          // Recessed + gilded mathematical rose-curve guilloché over DP
          const traceRose = (ox, oy) => {
            f.beginPath();
            for (let i = 0; i <= 72; i += 1) {
              const th = (i / 72) * TAU;
              const r = ra * (0.85 + 0.36 * Math.cos(5 * th + t * 2.0) + dissolve * 0.4);
              const px = cx + ox + Math.cos(th) * r; const py = cy + oy + Math.sin(th) * r;
              if (i === 0) f.moveTo(px, py); else f.lineTo(px, py);
            }
            f.closePath(); f.stroke();
          };
          f.strokeStyle = `rgba(3,6,8,${al * 0.48})`; f.lineWidth = 2.0 * s; traceRose(1.2 * s, 1.6 * s);
          f.strokeStyle = `rgba(${gold},${al * 0.86})`; f.lineWidth = 1.05 * s; traceRose(0, 0);
        }
      }
    };
  }, { fullCard: true });

  // =========================================================================
  // 8. MECHA OVERRIDE — Machined Gunmetal Iris w/ Inter-Blade Contact Shadows &
  //    Ruby Glass Lens, LiDAR Elevation Mesh, Beveled Hex Armor, Hydraulic Clamps
  // =========================================================================
  api.registerEffect('ex_cybermech', 'Mecha Override', 'Exclusive', 'Four precision mecha acts: brushed-titanium 6-blade iris with ruby lens, LiDAR 3D topographic scan, beveled hexagonal armor matrix, and hydraulic corner rail clamps.', 3, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const cyan = '76,228,246';
    const red = '238,76,102';
    const steel = '180,206,228';
    const armorL = [
      [cx - ra * 0.36, cy - ra * 1.3], [cx - ra * 1.08, cy - ra * 1.18], [cx - ra * 1.36, cy - ra * 0.42],
      [cx - ra * 1.36, cy + ra * 0.42], [cx - ra * 1.08, cy + ra * 1.18], [cx - ra * 0.36, cy + ra * 1.3]
    ];
    const armorR = armorL.map(([x, y]) => [cx - (x - cx), y]);

    return (t) => {
      const { scene, activeU, surge, dissolve } = sceneDirector(t, 6.0, 'snap', 4);
      if (full) {
        b.strokeStyle = `rgba(${steel},.26)`; b.lineWidth = 1.0 * s;
        b.beginPath();
        for (let y = 26 * s; y < H - 26 * s; y += 16 * s) {
          const major = Math.round(y / (16 * s)) % 3 === 0;
          b.moveTo(6 * s, y); b.lineTo((major ? 16 : 11) * s, y);
          b.moveTo(W - 6 * s, y); b.lineTo(W - (major ? 16 : 11) * s, y);
        }
        b.stroke();
        for (let i = 0; i < 6; i += 1) {
          const bh = (3 + 8 * Math.abs(Math.sin(t * 4.0 + i * 0.9))) * s;
          f.fillStyle = `rgba(${i === 5 ? red : cyan},.72)`;
          f.fillRect(W - (42 - i * 5.2) * s, H - 8 * s - bh, 3.2 * s, bh);
        }
      }
      // Machined armored helmet plates with cast shadow & directional chamfer highlight
      f.lineCap = 'round';
      f.strokeStyle = 'rgba(2,6,12,.62)'; f.lineWidth = 3.0 * s;
      f.save(); f.translate(L_DX * 1.8 * s, L_DY * 1.8 * s); tracePoly(f, armorL, false); f.stroke(); tracePoly(f, armorR, false); f.stroke(); f.restore();
      f.strokeStyle = `rgba(${steel},.88)`; f.lineWidth = 1.85 * s; tracePoly(f, armorL, false); f.stroke(); tracePoly(f, armorR, false); f.stroke();
      f.strokeStyle = 'rgba(240,250,255,.65)'; f.lineWidth = 0.7 * s;
      f.save(); f.translate(-0.6 * s, -0.7 * s); tracePoly(f, armorL, false); f.stroke(); tracePoly(f, armorR, false); f.stroke(); f.restore();

      if (surge > 0.02) {
        const al = Math.min(1, surge * 1.2) * (1 - dissolve * 0.82);
        if (scene === 0) {
          // 6-Blade Brushed-Titanium Iris w/ outer cast shadow, inter-blade contact shadow, pivot screws & ruby optical lens!
          const closeK = Math.min(1, surge * 1.12);
          const irisR = ra * 1.28;
          castShadow(f, 6.5 * s, al * 0.92, (shCol) => {
            f.fillStyle = shCol; f.beginPath(); f.arc(cx, cy, irisR, 0, TAU); f.fill();
          });
          f.save(); f.globalAlpha = al * 0.97;
          for (let i = 0; i < 6; i += 1) {
            const a = (i / 6) * TAU + closeK * 0.45;
            const aNext = a + TAU / 6;
            const inR = ra * (1.12 - closeK * 0.92);
            const p1 = [cx + Math.cos(a) * irisR, cy + Math.sin(a) * irisR];
            const p2 = [cx + Math.cos(aNext) * irisR, cy + Math.sin(aNext) * irisR];
            const p3 = [cx + Math.cos(aNext - 0.35) * inR, cy + Math.sin(aNext - 0.35) * inR];
            const p4 = [cx + Math.cos(a - 0.12) * inR, cy + Math.sin(a - 0.12) * inR];
            // Brushed anisotropic gunmetal blade gradient
            const bGr = f.createLinearGradient(p1[0], p1[1], p3[0], p3[1]);
            bGr.addColorStop(0, i % 2 ? '#344c62' : '#2a3f54');
            bGr.addColorStop(0.55, '#192838');
            bGr.addColorStop(1, '#0b141e');
            f.fillStyle = bGr;
            f.beginPath(); f.moveTo(p1[0], p1[1]); f.lineTo(p2[0], p2[1]); f.lineTo(p3[0], p3[1]); f.lineTo(p4[0], p4[1]); f.closePath(); f.fill();
            // Inter-blade dark contact occlusion shadow along overlapping seam
            f.strokeStyle = 'rgba(0,0,0,.72)'; f.lineWidth = 2.0 * s;
            f.beginPath(); f.moveTo(p1[0], p1[1]); f.lineTo(p4[0], p4[1]); f.stroke();
            // Precision cyan-silver leading bevel catchlight
            f.strokeStyle = `rgba(${cyan},.76)`; f.lineWidth = 0.95 * s;
            f.beginPath(); f.moveTo(p2[0], p2[1]); f.lineTo(p3[0], p3[1]); f.stroke();
            // Tiny machined titanium hinge screw
            const hx = cx + Math.cos(a + 0.25) * irisR * 0.86; const hy = cy + Math.sin(a + 0.25) * irisR * 0.86;
            f.fillStyle = '#5f7a94'; f.beginPath(); f.arc(hx, hy, 1.8 * s, 0, TAU); f.fill();
            f.strokeStyle = 'rgba(0,0,0,.65)'; f.lineWidth = 0.65 * s; f.beginPath(); f.moveTo(hx - 1.2 * s, hy); f.lineTo(hx + 1.2 * s, hy); f.stroke();
          }
          // Recessed Optical Ruby Lens Dome at center when iris locks shut!
          if (closeK > 0.72) {
            const lr = ra * 0.22;
            const lGr = f.createRadialGradient(cx - lr * 0.35, cy - lr * 0.35, lr * 0.1, cx, cy, lr);
            lGr.addColorStop(0, '#ffd0d8'); lGr.addColorStop(0.35, '#e83454'); lGr.addColorStop(0.85, '#540818'); lGr.addColorStop(1, '#1a0208');
            f.fillStyle = lGr; f.beginPath(); f.arc(cx, cy, lr, 0, TAU); f.fill();
            f.strokeStyle = 'rgba(255,255,255,.72)'; f.lineWidth = 0.8 * s;
            f.beginPath(); f.arc(cx, cy, lr * 0.68, -2.4, -1.1); f.stroke();
          }
          f.restore();
        } else if (scene === 1) {
          const scanY = activeU * H;
          const cols = full ? 10 : 7; const rows = full ? 10 : 6;
          const elev = (rx, ry) => Math.exp(-Math.hypot(rx - cx, ry - cy) / (ra * 1.6)) * 16 * s;
          f.lineWidth = 0.85 * s;
          for (let r = 0; r < rows; r += 1) {
            const ry = (r / (rows - 1)) * H;
            const dist = Math.abs(ry - scanY);
            if (dist > H * 0.36) continue;
            const localAl = (1 - dist / (H * 0.36)) * al;
            f.strokeStyle = `rgba(${cyan},${localAl * 0.74})`;
            f.beginPath();
            for (let c = 0; c <= cols; c += 1) {
              const rx = (c / cols) * W; const py = ry - elev(rx, ry);
              if (c === 0) f.moveTo(rx, py); else f.lineTo(rx, py);
            }
            f.stroke();
            if (dist < H * 0.14) {
              f.fillStyle = `rgba(${red},${localAl * 0.92})`;
              for (let c = 1; c < cols; c += 2) {
                const rx = (c / cols) * W;
                f.fillRect(rx - 1.5 * s, ry - elev(rx, ry) - 1.5 * s, 3 * s, 3 * s);
              }
            }
          }
          f.strokeStyle = `rgba(${steel},${al * 0.3})`;
          for (let c = 1; c < cols; c += 2) {
            const rx = (c / cols) * W;
            const y0 = Math.max(0, scanY - H * 0.24); const y1 = Math.min(H, scanY + H * 0.24);
            f.beginPath(); f.moveTo(rx, y0 - elev(rx, y0)); f.lineTo(rx, y1 - elev(rx, y1)); f.stroke();
          }
          // Cast shadow + sharp laser emitter beam + machined side pods
          f.strokeStyle = `rgba(4,8,14,${al * 0.55})`; f.lineWidth = 3.2 * s;
          f.beginPath(); f.moveTo(6 * s, scanY + 2 * s); f.lineTo(W - 6 * s, scanY + 2 * s); f.stroke();
          f.strokeStyle = `rgba(${red},${al * 0.96})`; f.lineWidth = 1.8 * s;
          f.beginPath(); f.moveTo(6 * s, scanY); f.lineTo(W - 6 * s, scanY); f.stroke();
        } else if (scene === 2) {
          // Beveled Reactive Honeycomb Armor Matrix (each hex tile has lit top-left chamfer & dark bottom-right groove!)
          const hexR = (full ? 21 : 14) * s;
          const dx = hexR * 1.55; const dy = hexR * 1.76;
          const waveR = activeU * (full ? Math.hypot(W, H) * 0.95 : ra * 3.4);
          for (let gx = -1; gx <= Math.ceil(W / dx) + 1; gx += 1) {
            for (let gy = -1; gy <= Math.ceil(H / dy) + 1; gy += 1) {
              const hx = gx * dx; const hy = gy * dy + (gx % 2 ? dy * 0.5 : 0);
              const band = Math.exp(-Math.pow((Math.hypot(hx - cx, hy - cy) - waveR) / (ra * 1.4), 2));
              if (band < 0.08) continue;
              const cellAl = band * al;
              const hGr = f.createLinearGradient(hx - hexR, hy - hexR, hx + hexR, hy + hexR);
              hGr.addColorStop(0, `rgba(210,248,255,${cellAl * 0.24})`);
              hGr.addColorStop(0.55, `rgba(${cyan},${cellAl * 0.14})`);
              hGr.addColorStop(1, `rgba(6,18,32,${cellAl * 0.36})`);
              f.fillStyle = hGr;
              f.beginPath();
              for (let k = 0; k < 6; k += 1) {
                const a = (k / 6) * TAU;
                const px = hx + Math.cos(a) * hexR * 0.9; const py = hy + Math.sin(a) * hexR * 0.9;
                if (k === 0) f.moveTo(px, py); else f.lineTo(px, py);
              }
              f.closePath(); f.fill();
              f.strokeStyle = `rgba(${cyan},${cellAl * 0.78})`; f.lineWidth = 0.95 * s; f.stroke();
            }
          }
        } else {
          // 4 Extruded Hydraulic Steel Rail Clamps with cast shadows, machined bolts & recessed target LEDs
          const snap = Math.min(1, surge * 1.15);
          const off = ra * (1.28 + (1 - snap) * (full ? 2.6 : 1.3) + dissolve * 1.4);
          const arm = 19 * s;
          f.lineCap = 'square';
          for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            const px = cx + sx * off; const py = cy + sy * off;
            // Hydraulic piston shaft connecting card corner to clamp jaw
            const cX = sx < 0 ? 4 * s : W - 4 * s; const cY = sy < 0 ? 4 * s : H - 4 * s;
            f.strokeStyle = `rgba(3,6,12,${al * 0.5})`; f.lineWidth = 3.2 * s;
            f.beginPath(); f.moveTo(cX + 1.5 * s, cY + 2 * s); f.lineTo(px + 1.5 * s, py + 2 * s); f.stroke();
            f.strokeStyle = `rgba(${steel},${al * 0.65})`; f.lineWidth = 1.8 * s;
            f.beginPath(); f.moveTo(cX, cY); f.lineTo(px, py); f.stroke();
            // Cast shadow beneath thick titanium L-bracket
            f.strokeStyle = `rgba(2,5,10,${al * 0.62})`; f.lineWidth = 4.6 * s;
            f.beginPath(); f.moveTo(px - sx * arm + 2 * s, py + 2.6 * s); f.lineTo(px + 2 * s, py + 2.6 * s); f.lineTo(px + 2 * s, py - sy * arm + 2.6 * s); f.stroke();
            // Machined steel clamp body + bright cyan top edge
            f.strokeStyle = `rgba(${steel},${al * 0.94})`; f.lineWidth = 3.2 * s;
            f.beginPath(); f.moveTo(px - sx * arm, py); f.lineTo(px, py); f.lineTo(px, py - sy * arm); f.stroke();
            f.strokeStyle = `rgba(${cyan},${al * 0.92})`; f.lineWidth = 1.1 * s;
            f.beginPath(); f.moveTo(px - sx * arm, py); f.lineTo(px, py); f.lineTo(px, py - sy * arm); f.stroke();
            f.fillStyle = `rgba(${red},${al})`; f.fillRect(px - 2.2 * s, py - 2.2 * s, 4.4 * s, 4.4 * s);
          }
          f.strokeStyle = `rgba(${red},${al * 0.48})`; f.lineWidth = 0.85 * s; f.setLineDash([4 * s, 4 * s]);
          f.beginPath(); f.moveTo(cx - off, cy); f.lineTo(cx + off, cy); f.moveTo(cx, cy - off); f.lineTo(cx, cy + off); f.stroke();
          f.setLineDash([]);
        }
      }
    };
  }, { fullCard: true });

  // =========================================================================
  // 9. CHROMATIC SUPERNOVA — Optical Cut-Crystal Glass Prism Dispersion,
  //    Subtle Thin-Film Soap Spheres, Silky Lissajous Weave, Baccarat Facets
  // =========================================================================
  api.registerEffect('ex_prism', 'Chromatic Supernova', 'Exclusive', 'Four optical crystal acts: studio-refracted Newtonian glass prism, thin-film iridescent spheres, luminous Lissajous laser weave, and dual-beveled cut-crystal facets.', 3, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    // Refined museum-grade pastel optical dispersion spectrum (no cheap harsh neon!)
    const spec = ['242,114,132', '246,178,108', '246,232,146', '128,232,184', '118,218,246', '156,144,242', '234,148,224'];
    const bubbles = Array.from({ length: full ? 14 : 8 }, (_, i) => ({
      x: ((i * 0.33 + 0.08) % 0.88 + 0.06) * W, y0: R(0, 1), r: R(10, 22), ph: R(0, TAU)
    }));
    const haloPts = Array.from({ length: 12 }, (_, i) => {
      const a = -Math.PI / 2 + (i / 12) * TAU;
      return [cx + Math.cos(a) * ra * (i % 2 === 0 ? 1.3 : 1.18), cy + Math.sin(a) * ra * (i % 2 === 0 ? 1.3 : 1.18)];
    });

    return (t) => {
      const { scene, activeU, surge, dissolve } = sceneDirector(t, 6.2, 'silk', 4);
      // Bespoke Perimeter: Cut-diamond beveled glass card frame with dual inner shadow & specular glint
      if (full) {
        const oct = (o) => {
          b.beginPath();
          b.moveTo(22 * s, 5 * s + o); b.lineTo(W - 22 * s, 5 * s + o); b.lineTo(W - 5 * s - o, 22 * s);
          b.lineTo(W - 5 * s - o, H - 22 * s); b.lineTo(W - 22 * s, H - 5 * s - o); b.lineTo(22 * s, H - 5 * s - o);
          b.lineTo(5 * s + o, H - 22 * s); b.lineTo(5 * s + o, 22 * s); b.closePath(); b.stroke();
        };
        b.strokeStyle = 'rgba(0,0,0,.45)'; b.lineWidth = 2.0 * s; oct(1.2 * s);
        const bg = b.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, 'rgba(255,255,255,.36)'); bg.addColorStop(0.35, 'rgba(118,218,246,.32)');
        bg.addColorStop(0.68, 'rgba(234,148,224,.28)'); bg.addColorStop(1, 'rgba(246,232,146,.34)');
        b.strokeStyle = bg; b.lineWidth = 1.2 * s; oct(0);
        const gl = 0.5 + 0.5 * Math.sin(t * 1.7);
        sparkle(f, 5 * s + gl * 17 * s, 22 * s - gl * 17 * s, 4.2 * s, '255,255,255', 0.78);
        sparkle(f, W - 5 * s - gl * 17 * s, H - 22 * s + gl * 17 * s, 4.2 * s, spec[4], 0.76);
      }
      f.strokeStyle = 'rgba(2,5,10,.52)'; f.lineWidth = 2.6 * s;
      f.save(); f.translate(L_DX * 1.6 * s, L_DY * 1.6 * s); tracePoly(f, haloPts, true); f.stroke(); f.restore();
      const hg = f.createLinearGradient(cx - ra, cy - ra, cx + ra, cy + ra);
      hg.addColorStop(0, '#ffffff'); hg.addColorStop(0.35, '#8ee0fa'); hg.addColorStop(0.68, '#eab0e4'); hg.addColorStop(1, '#f4e498');
      f.strokeStyle = hg; f.lineWidth = 1.6 * s; tracePoly(f, haloPts, true); f.stroke();

      if (surge > 0.02) {
        const al = Math.min(1, surge * 1.18) * (1 - dissolve * 0.84);
        if (scene === 0) {
          // Sculpted Optical Glass Prism with ground cast shadow, internal refractive facet & feathered dispersion fan!
          const prR = ra * 0.94;
          const pPts = [0, 1, 2].map((i) => {
            const a = -Math.PI / 2 + (i / 3) * TAU + Math.sin(t * 1.3) * 0.07;
            return [cx + Math.cos(a) * prR, cy + Math.sin(a) * prR];
          });
          // Incoming collimated pure-white light beam
          f.strokeStyle = `rgba(255,255,255,${al * 0.9})`; f.lineWidth = 2.4 * s;
          f.beginPath(); f.moveTo(0, cy + ra * 0.24); f.lineTo(cx - prR * 0.34, cy - ra * 0.05); f.stroke();
          // Feathered 7-band continuous rainbow dispersion
          f.save(); f.globalCompositeOperation = 'lighter';
          const outLen = full ? Math.hypot(W, H) * 0.9 : ra * 2.8;
          for (let i = 0; i < spec.length; i += 1) {
            const ang = -0.34 + (i / (spec.length - 1)) * 0.92 + Math.sin(t * 1.2) * 0.05;
            const gr = f.createLinearGradient(cx, cy, cx + Math.cos(ang) * outLen, cy + Math.sin(ang) * outLen);
            gr.addColorStop(0, `rgba(${spec[i]},${al * 0.48})`); gr.addColorStop(0.55, `rgba(${spec[i]},${al * 0.16})`); gr.addColorStop(1, `rgba(${spec[i]},0)`);
            f.fillStyle = gr;
            f.beginPath(); f.moveTo(cx + prR * 0.18, cy); f.arc(cx + prR * 0.18, cy, outLen, ang - 0.058, ang + 0.058); f.closePath(); f.fill();
          }
          f.restore();
          // Grounded cast shadow under optical crystal block
          castShadow(f, 7 * s, al * 0.84, (shCol) => {
            f.fillStyle = shCol; tracePoly(f, pPts, true); f.fill();
          });
          // Multi-face beveled glass prism body (left lit glass + right deep sapphire internal reflection)
          const cM = [cx, cy + prR * 0.08];
          f.fillStyle = `rgba(255,255,255,${al * 0.24})`;
          f.beginPath(); f.moveTo(pPts[0][0], pPts[0][1]); f.lineTo(pPts[2][0], pPts[2][1]); f.lineTo(cM[0], cM[1]); f.closePath(); f.fill();
          f.fillStyle = `rgba(128,196,246,${al * 0.2})`;
          f.beginPath(); f.moveTo(pPts[0][0], pPts[0][1]); f.lineTo(pPts[1][0], pPts[1][1]); f.lineTo(cM[0], cM[1]); f.closePath(); f.fill();
          f.fillStyle = `rgba(22,36,64,${al * 0.34})`;
          f.beginPath(); f.moveTo(pPts[1][0], pPts[1][1]); f.lineTo(pPts[2][0], pPts[2][1]); f.lineTo(cM[0], cM[1]); f.closePath(); f.fill();
          f.strokeStyle = `rgba(255,255,255,${al * 0.92})`; f.lineWidth = 1.45 * s; tracePoly(f, pPts, true); f.stroke();
        } else if (scene === 1) {
          // Thin-film iridescent glass/soap spheres with soft studio softbox reflection & caustic shadow!
          for (let i = 0; i < bubbles.length; i += 1) {
            const bb = bubbles[i];
            const p = frac(activeU * 1.12 + bb.y0);
            const y = H * (1.08 - p * 1.2);
            const x = bb.x + Math.sin(t * 1.5 + bb.ph) * 18 * s;
            const r = bb.r * s * (0.72 + 0.32 * surge);
            const bal = Math.sin(p * Math.PI) * al;
            // Subtle translucent sphere contact shadow
            f.fillStyle = `rgba(4,8,16,${bal * 0.22})`; f.beginPath(); f.arc(x + 3.5 * s, y + 4.8 * s, r * 0.96, 0, TAU); f.fill();
            const gr = f.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.08, x, y, r);
            gr.addColorStop(0, `rgba(255,255,255,${bal * 0.06})`);
            gr.addColorStop(0.7, `rgba(${spec[i % spec.length]},${bal * 0.14})`);
            gr.addColorStop(0.92, `rgba(${spec[(i + 2) % spec.length]},${bal * 0.56})`);
            gr.addColorStop(1, `rgba(255,255,255,${bal * 0.82})`);
            f.fillStyle = gr; f.beginPath(); f.arc(x, y, r, 0, TAU); f.fill();
            f.strokeStyle = `rgba(255,255,255,${bal * 0.9})`; f.lineWidth = 1.55 * s; f.lineCap = 'round';
            f.beginPath(); f.arc(x, y, r * 0.74, -Math.PI * 0.84, -Math.PI * 0.44); f.stroke();
            // Opposite warm bounce rim highlight on bottom-right edge
            f.strokeStyle = `rgba(${spec[(i + 4) % spec.length]},${bal * 0.5})`; f.lineWidth = 0.9 * s;
            f.beginPath(); f.arc(x, y, r * 0.84, 0.35, 1.25); f.stroke();
          }
        } else if (scene === 2) {
          f.save(); f.lineCap = 'round';
          const rx = full ? W * 0.44 : ra * 1.65; const ry = full ? H * 0.42 : ra * 1.35;
          const ox = full ? W * 0.5 : cx; const oy = full ? H * 0.5 : cy;
          const pts = 68;
          for (let i = 1; i <= pts; i += 1) {
            const k0 = (i - 1) / pts; const k1 = i / pts;
            const x0 = ox + Math.sin(k0 * TAU * 3 + t * 1.5) * rx; const y0 = oy + Math.sin(k0 * TAU * 2 + t * 1.05) * ry;
            const x1 = ox + Math.sin(k1 * TAU * 3 + t * 1.5) * rx; const y1 = oy + Math.sin(k1 * TAU * 2 + t * 1.05) * ry;
            const col = spec[Math.floor((k0 * 7 + t * 1.4) % spec.length)];
            const lw = (1.6 + Math.sin(k0 * Math.PI) * 2.1) * s;
            f.strokeStyle = `rgba(4,8,16,${al * 0.36})`; f.lineWidth = lw + 1.8 * s;
            f.beginPath(); f.moveTo(x0 + 1.5 * s, y0 + 2.2 * s); f.lineTo(x1 + 1.5 * s, y1 + 2.2 * s); f.stroke();
            f.strokeStyle = `rgba(${col},${al * 0.78})`; f.lineWidth = lw;
            f.beginPath(); f.moveTo(x0, y0); f.lineTo(x1, y1); f.stroke();
          }
          f.restore();
        } else {
          // Cut Baccarat Crystal Facets: dual left-lit / right-shaded bevel diamonds with crisp specular seams!
          const cols = full ? 5 : 4; const rows = full ? 6 : 3;
          const cw = W / cols; const ch = H / rows;
          for (let r = 0; r < rows; r += 1) {
            for (let c = 0; c < cols; c += 1) {
              const shimmer = Math.pow(0.5 + 0.5 * Math.sin(t * 2.8 + c * 1.3 + r * 1.7), 2.3);
              if (shimmer < 0.16) continue;
              const col = spec[(c + r * 2) % spec.length];
              const x0 = c * cw; const y0 = r * ch;
              // Left key-lit facet
              f.fillStyle = `rgba(255,255,255,${shimmer * al * 0.24})`;
              f.beginPath(); f.moveTo(x0 + cw * 0.5, y0); f.lineTo(x0 + cw * 0.5, y0 + ch); f.lineTo(x0, y0 + ch * 0.5); f.closePath(); f.fill();
              // Right chromatic refracted facet
              f.fillStyle = `rgba(${col},${shimmer * al * 0.32})`;
              f.beginPath(); f.moveTo(x0 + cw * 0.5, y0); f.lineTo(x0 + cw, y0 + ch * 0.5); f.lineTo(x0 + cw * 0.5, y0 + ch); f.closePath(); f.fill();
              f.strokeStyle = `rgba(255,255,255,${shimmer * al * 0.52})`; f.lineWidth = 0.75 * s;
              f.beginPath(); f.moveTo(x0 + cw * 0.5, y0); f.lineTo(x0 + cw, y0 + ch * 0.5); f.lineTo(x0 + cw * 0.5, y0 + ch); f.lineTo(x0, y0 + ch * 0.5); f.closePath(); f.stroke();
            }
          }
        }
      }
    };
  }, { fullCard: true });

  // =========================================================================
  // 10. PHANTOM MONARCH — Forged Wrought-Iron Cathedral Gates w/ Deep Cast Shadow,
  //     3D Interlocking Metal Chains, Veined Luna Moths, Wax-Drip Taper Candles
  // =========================================================================
  api.registerEffect('ex_abyss', 'Phantom Monarch', 'Exclusive', 'Four gothic-atelier acts: forged wrought-iron cathedral gates with lanterns, 3D interlocking metal chains, veined luna moth swarm, and levitating wax-drip candelabra.', 3, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const vio = '172,118,238';
    const cyan = '96,214,242';
    const pale = '236,226,248';
    const gothPts = Array.from({ length: 64 }, (_, i) => {
      const a = -Math.PI / 2 + (i / 64) * TAU;
      const r = ra * (1.2 + 0.095 * Math.pow(Math.abs(Math.cos(2 * (a + Math.PI / 2))), 2.2));
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    });
    const moths = Array.from({ length: full ? 14 : 9 }, (_, i) => ({
      a: (i / (full ? 14 : 9)) * TAU + R(-0.2, 0.2), sp: R(0.72, 1.3), sz: R(6.4, 10.4), ph: R(0, TAU), c: i % 2 ? pale : vio
    }));

    const drawLunaMoth = (g, x, y, sz, ang, flap, rgb, al) => {
      const wingScale = 0.25 + 0.75 * Math.abs(Math.sin(flap));
      const wingPath = (sd) => {
        g.beginPath();
        g.moveTo(0, 0);
        g.bezierCurveTo(sz * 0.8, sd * sz * 0.2, sz * 1.12, sd * sz * 1.15, 0, sd * sz * 0.96);
        g.quadraticCurveTo(-sz * 0.65, sd * sz * 1.38, -sz * 1.18, sd * sz * 0.45);
        g.closePath();
      };
      // Floating shadow beneath moth
      g.save(); g.globalAlpha = al * 0.34;
      g.translate(x + L_DX * 5.5 * s, y + L_DY * 5.5 * s); g.rotate(ang); g.scale(1, wingScale);
      g.fillStyle = '#030208'; for (const sd of [-1, 1]) { wingPath(sd); g.fill(); } g.restore();
      g.save(); g.translate(x, y); g.rotate(ang); g.scale(1, wingScale);
      for (const sd of [-1, 1]) {
        const wGr = g.createLinearGradient(sz, 0, -sz, sd * sz);
        wGr.addColorStop(0, `rgba(255,250,255,${al * 0.92})`);
        wGr.addColorStop(0.5, `rgba(${rgb},${al * 0.84})`);
        wGr.addColorStop(1, `rgba(42,20,76,${al * 0.88})`);
        g.fillStyle = wGr; g.strokeStyle = `rgba(${cyan},${al * 0.72})`; g.lineWidth = 0.7 * s;
        wingPath(sd); g.fill(); g.stroke();
        // Delicate ringed eyespot marking on each forewing
        g.fillStyle = `rgba(${cyan},${al * 0.86})`;
        g.beginPath(); g.arc(sz * 0.35, sd * sz * 0.5, sz * 0.14, 0, TAU); g.fill();
      }
      g.restore();
    };

    const drawLinkChain = (g, x1, y1, x2, y2, sag, al, rgb) => {
      const links = 14;
      // Grounded chain shadow pass
      for (let i = 0; i <= links; i += 1) {
        const k = i / links;
        const px = x1 + (x2 - x1) * k + L_DX * 5.5 * s;
        const py = y1 + (y2 - y1) * k + Math.sin(k * Math.PI) * sag + L_DY * 5.5 * s;
        const ang = Math.atan2(y2 - y1 + Math.cos(k * Math.PI) * sag * Math.PI * 0.4, x2 - x1);
        g.save(); g.translate(px, py); g.rotate(ang);
        g.strokeStyle = `rgba(2,2,8,${al * 0.42})`; g.lineWidth = 2.6 * s;
        g.beginPath(); g.ellipse(0, 0, 5.2 * s, 2.7 * s, 0, 0, TAU); g.stroke();
        g.restore();
      }
      // Sculpted forged-steel interlocking chain links w/ specular catchlight
      for (let i = 0; i <= links; i += 1) {
        const k = i / links;
        const px = x1 + (x2 - x1) * k;
        const py = y1 + (y2 - y1) * k + Math.sin(k * Math.PI) * sag;
        const ang = Math.atan2(y2 - y1 + Math.cos(k * Math.PI) * sag * Math.PI * 0.4, x2 - x1);
        g.save(); g.translate(px, py); g.rotate(ang);
        if (i % 2 === 0) {
          g.strokeStyle = `rgba(42,30,68,${al * 0.94})`; g.lineWidth = 2.4 * s;
          g.beginPath(); g.ellipse(0, 0, 5.3 * s, 2.8 * s, 0, 0, TAU); g.stroke();
          g.strokeStyle = `rgba(${rgb},${al * 0.9})`; g.lineWidth = 1.2 * s;
          g.beginPath(); g.ellipse(0, 0, 5.3 * s, 2.8 * s, 0, -2.6, -0.4); g.stroke();
        } else {
          g.strokeStyle = `rgba(34,24,56,${al * 0.96})`; g.lineWidth = 2.6 * s; g.lineCap = 'round';
          g.beginPath(); g.moveTo(-4.8 * s, 0); g.lineTo(4.8 * s, 0); g.stroke();
          g.strokeStyle = `rgba(${pale},${al * 0.88})`; g.lineWidth = 1.0 * s;
          g.beginPath(); g.moveTo(-4.2 * s, -0.5 * s); g.lineTo(4.2 * s, -0.5 * s); g.stroke();
        }
        g.restore();
      }
    };

    return (t) => {
      const { scene, activeU, surge, dissolve } = sceneDirector(t, 6.4, 'creep', 4);
      if (full) {
        b.strokeStyle = 'rgba(2,2,8,.55)'; b.lineWidth = 2.4 * s;
        b.beginPath(); b.moveTo(11 * s, 43 * s); b.quadraticCurveTo(11 * s, 11 * s, W * 0.5, 7 * s); b.quadraticCurveTo(W - 9 * s, 11 * s, W - 9 * s, 43 * s); b.stroke();
        b.strokeStyle = `rgba(${vio},${0.32 + surge * 0.34})`; b.lineWidth = 1.2 * s;
        b.beginPath();
        b.moveTo(10 * s, 42 * s); b.quadraticCurveTo(10 * s, 10 * s, W * 0.5, 6 * s); b.quadraticCurveTo(W - 10 * s, 10 * s, W - 10 * s, 42 * s);
        b.moveTo(10 * s, H - 42 * s); b.quadraticCurveTo(10 * s, H - 10 * s, W * 0.5, H - 6 * s); b.quadraticCurveTo(W - 10 * s, H - 10 * s, W - 10 * s, H - 42 * s);
        b.stroke();
      }
      f.strokeStyle = 'rgba(2,2,8,.58)'; f.lineWidth = 2.8 * s;
      f.save(); f.translate(L_DX * 1.7 * s, L_DY * 1.7 * s); tracePoly(f, gothPts, true); f.stroke(); f.restore();
      const gg = f.createLinearGradient(cx - ra, cy - ra * 1.3, cx + ra, cy + ra * 1.3);
      gg.addColorStop(0, '#f4ecff'); gg.addColorStop(0.45, '#9d68e0'); gg.addColorStop(0.8, '#36205a'); gg.addColorStop(1, '#68d4ee');
      f.strokeStyle = gg; f.lineWidth = 1.65 * s; tracePoly(f, gothPts, true); f.stroke();

      if (surge > 0.02) {
        const al = Math.min(1, surge * 1.18) * (1 - dissolve * 0.84);
        if (scene === 0) {
          // Forged Wrought-Iron Cathedral Gates w/ deep projected shadow, Fleur-de-lis finials & iron cage lanterns!
          const closeK = Math.min(1, surge * 1.15);
          const gateW = ra * 1.2 * closeK; const gateH = ra * 1.38;
          f.save(); f.globalAlpha = al * 0.96;
          for (const sd of [-1, 1]) {
            const hingeX = cx + sd * ra * 1.2; const innerX = hingeX - sd * gateW;
            const gateShape = (ox, oy) => {
              f.beginPath();
              f.moveTo(hingeX + ox, cy + gateH + oy); f.lineTo(hingeX + ox, cy - gateH * 0.56 + oy);
              f.quadraticCurveTo(hingeX - sd * gateW * 0.5 + ox, cy - gateH * 1.08 + oy, innerX + ox, cy - gateH + oy);
              f.lineTo(innerX + ox, cy + gateH + oy); f.closePath();
            };
            // Grounded directional shadow behind gate leaf
            f.fillStyle = 'rgba(2,2,8,.52)'; gateShape(L_DX * 5.5 * s, L_DY * 5.5 * s); f.fill();
            // Translucent smoked-obsidian stained glass backing + forged iron frame
            const gGr = f.createLinearGradient(hingeX, cy - gateH, innerX, cy + gateH);
            gGr.addColorStop(0, 'rgba(32,20,54,.72)'); gGr.addColorStop(1, 'rgba(10,6,20,.84)');
            f.fillStyle = gGr; f.strokeStyle = '#6c4f98'; f.lineWidth = 2.0 * s; gateShape(0, 0); f.fill(); f.stroke();
            // Horizontal forged crossbars with top bevel catchlight
            for (const ry of [-0.3, 0.45]) {
              f.strokeStyle = '#181028'; f.lineWidth = 2.4 * s;
              f.beginPath(); f.moveTo(hingeX, cy + gateH * ry + 1 * s); f.lineTo(innerX, cy + gateH * ry + 1 * s); f.stroke();
              f.strokeStyle = `rgba(${pale},.74)`; f.lineWidth = 0.85 * s;
              f.beginPath(); f.moveTo(hingeX, cy + gateH * ry); f.lineTo(innerX, cy + gateH * ry); f.stroke();
            }
            for (let k = 1; k <= 3; k += 1) {
              const bx = hingeX - sd * (gateW * k / 4);
              const topY = cy - gateH * (0.72 + k * 0.08);
              f.strokeStyle = 'rgba(2,2,8,.65)'; f.lineWidth = 2.2 * s;
              f.beginPath(); f.moveTo(bx + 1.2 * s, topY + 1.5 * s); f.lineTo(bx + 1.2 * s, cy + gateH); f.stroke();
              f.strokeStyle = '#9a84bd'; f.lineWidth = 1.2 * s;
              f.beginPath(); f.moveTo(bx, topY); f.lineTo(bx, cy + gateH); f.stroke();
              f.fillStyle = `rgba(${pale},.94)`;
              f.beginPath(); f.moveTo(bx, topY - 5.4 * s); f.lineTo(bx + 2.6 * s, topY + 1 * s); f.lineTo(bx - 2.6 * s, topY + 1 * s); f.closePath(); f.fill();
            }
            // Forged wrought-iron hanging lantern housing with glowing amethyst glass core
            const lx = hingeX + sd * 5.5 * s; const ly = cy - gateH * 0.44;
            glow(f, lx, ly, 11 * s, cyan, al * 0.56);
            f.fillStyle = '#1b142c'; f.strokeStyle = `rgba(${pale},.78)`; f.lineWidth = 0.9 * s;
            rr(f, lx - 3.6 * s, ly - 5 * s, 7.2 * s, 10 * s, 1.8 * s); f.fill(); f.stroke();
            f.fillStyle = `rgba(${cyan},.94)`; f.beginPath(); f.arc(lx, ly, 2.2 * s, 0, TAU); f.fill();
          }
          if (full) {
            for (let i = 0; i < 6; i += 1) glow(b, W * (0.1 + i * 0.16) + Math.sin(t + i) * 14 * s, H - 14 * s, 26 * s, vio, al * 0.18);
          }
          f.restore();
        } else if (scene === 1) {
          const bind = Math.min(1, activeU * 1.6);
          const sag = (1 - bind) * 28 * s + Math.sin(t * 7) * 2.2 * s;
          drawLinkChain(f, 0, 12 * s, W, full ? H * 0.65 : cy + ra * 1.2, sag, al, vio);
          drawLinkChain(f, W, 16 * s, 0, full ? H * 0.72 : cy + ra * 1.1, sag, al, cyan);
          if (full) drawLinkChain(f, 0, H * 0.45, W, H * 0.25, -sag * 0.6, al * 0.85, vio);
        } else if (scene === 2) {
          for (const m of moths) {
            const dist = ra * (0.15 + activeU * (full ? 4.2 : 2.5) * m.sp);
            const ang = m.a + Math.sin(activeU * 5 + m.ph) * 0.42;
            drawLunaMoth(f, cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist * 0.92, m.sz * s, ang + Math.PI * 0.5, t * 13 + m.ph, m.c, al * (1 - activeU * 0.35));
          }
        } else {
          // 7 Levitating Wax-Drip Taper Candles w/ cylindrical wax shading, brass sconce dish & layered flame!
          const cnt = full ? 7 : 5;
          for (let i = 0; i < cnt; i += 1) {
            const k = (i + 0.5) / cnt;
            const kx = W * (0.1 + k * 0.8);
            const ky = (full ? H * (0.28 + (i % 3) * 0.24) : cy + (i % 2 ? -14 : 18) * s) + Math.sin(t * 2.1 + i * 1.4) * 8 * s;
            const ch = (19 + (i % 3) * 6) * s;
            // Subtle floating ground shadow below candle saucer
            f.fillStyle = `rgba(2,2,8,${al * 0.38})`;
            f.beginPath(); f.ellipse(kx + 2.5 * s, ky + ch + 5.5 * s, 6.2 * s, 2.0 * s, 0, 0, TAU); f.fill();
            // 3D Cylindrical wax column (key-lit left ivory -> warm shadowed right)
            const wGr = f.createLinearGradient(kx - 2.8 * s, ky, kx + 2.8 * s, ky);
            wGr.addColorStop(0, `rgba(255,250,245,${al * 0.95})`);
            wGr.addColorStop(0.58, `rgba(218,204,234,${al * 0.92})`);
            wGr.addColorStop(1, `rgba(92,74,118,${al * 0.92})`);
            f.fillStyle = wGr; rr(f, kx - 2.8 * s, ky, 5.6 * s, ch, 1.4 * s); f.fill();
            // Brass candle drip saucer
            f.fillStyle = `rgba(180,148,96,${al * 0.88})`;
            f.beginPath(); f.ellipse(kx, ky + ch, 5.4 * s, 1.8 * s, 0, 0, TAU); f.fill();
            // Dark wick + 2-zone layered flame (outer spectral mantle + incandescent white core)
            const sway = Math.sin(t * 7.5 + i * 2) * 2.1 * s;
            glow(f, kx + sway * 0.4, ky - 5 * s, 9.5 * s, i % 2 ? cyan : vio, al * 0.58);
            f.fillStyle = `rgba(${i % 2 ? cyan : vio},${al * 0.86})`;
            f.beginPath(); f.moveTo(kx, ky - 1 * s); f.quadraticCurveTo(kx - 3.8 * s, ky - 5.5 * s, kx + sway, ky - 11.5 * s); f.quadraticCurveTo(kx + 3.8 * s, ky - 5.5 * s, kx, ky - 1 * s); f.fill();
            f.fillStyle = `rgba(255,254,250,${al * 0.96})`;
            f.beginPath(); f.moveTo(kx, ky - 1.5 * s); f.quadraticCurveTo(kx - 1.7 * s, ky - 4.2 * s, kx + sway * 0.4, ky - 7.4 * s); f.quadraticCurveTo(kx + 1.7 * s, ky - 4.2 * s, kx, ky - 1.5 * s); f.fill();
          }
        }
      }
    };
  }, { fullCard: true });

  // =========================================================================
  // 11. AETHER VALKYRIE — Leaded Stained-Glass Rose Window, Tuning-Bridge Harp
  //     Strings, Faceted Two-Bevel Spears & Sculpted Olive Wreath, Cathedral Sunbeams
  // =========================================================================
  api.registerEffect('ex_valkyrie', 'Aether Valkyrie', 'Exclusive', 'Four cathedral-atelier acts: leaded stained-glass rose window with cast mullion shadows, golden harp strings on tuning bridges, dual-beveled spears with olive wreath, and warm sunlit dust shafts.', 3, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const ivory = '255,248,232';
    const rose = '242,188,206';
    const sky = '178,218,246';
    const gold = '238,204,132';
    const shieldPts = [];
    for (let i = 0; i <= 48; i += 1) {
      const a = -Math.PI / 2 + (i / 48) * TAU;
      const tip = a > Math.PI * 0.1 && a < Math.PI * 0.9 ? 0.15 * Math.sin(((a - Math.PI * 0.1) / (Math.PI * 0.8)) * Math.PI) : 0;
      shieldPts.push([cx + Math.cos(a) * ra * (1.2 + tip), cy + Math.sin(a) * ra * (1.2 + tip)]);
    }
    const motes = Array.from({ length: full ? 26 : 14 }, (_, i) => ({
      x: ((i * 0.37 + 0.05) % 1) * W, y0: R(0, 1), r: R(1.1, 2.7), ph: R(0, TAU)
    }));

    return (t) => {
      const { scene, activeU, surge, dissolve } = sceneDirector(t, 6.4, 'silk', 4);
      if (full) {
        b.strokeStyle = 'rgba(4,4,8,.46)'; b.lineWidth = 2.2 * s;
        b.beginPath(); b.arc(W * 0.5 + 1.2 * s, 1.5 * s, W * 0.44, 0.14, Math.PI - 0.14); b.stroke();
        b.strokeStyle = `rgba(${gold},${0.28 + surge * 0.28})`; b.lineWidth = 1.15 * s;
        b.beginPath(); b.arc(W * 0.5, 0, W * 0.44, 0.14, Math.PI - 0.14); b.stroke();
        b.strokeStyle = `rgba(${ivory},.2)`; b.lineWidth = 0.8 * s;
        b.beginPath(); b.arc(W * 0.5, 0, W * 0.36, 0.2, Math.PI - 0.2); b.stroke();
      }
      // Sculpted pearl-gold tilted halo & beveled Valkyrie shield rim around DP
      f.strokeStyle = 'rgba(4,4,8,.52)'; f.lineWidth = 2.4 * s;
      f.beginPath(); f.ellipse(cx + 1.5 * s, cy - ra * 1.28 + 2 * s, ra * 0.78, ra * 0.2, 0, 0, TAU); f.stroke();
      const hGr = f.createLinearGradient(cx - ra * 0.8, cy - ra * 1.4, cx + ra * 0.8, cy - ra * 1.15);
      hGr.addColorStop(0, '#fffaf0'); hGr.addColorStop(0.5, '#e6be6c'); hGr.addColorStop(1, '#8c6626');
      f.strokeStyle = hGr; f.lineWidth = 1.6 * s;
      f.beginPath(); f.ellipse(cx, cy - ra * 1.28, ra * 0.78, ra * 0.2, 0, 0, TAU); f.stroke();
      f.strokeStyle = 'rgba(4,4,8,.5)'; f.lineWidth = 2.6 * s;
      f.save(); f.translate(L_DX * 1.6 * s, L_DY * 1.6 * s); tracePoly(f, shieldPts, true); f.stroke(); f.restore();
      const vg = f.createLinearGradient(cx - ra, cy - ra * 1.25, cx + ra, cy + ra * 1.38);
      vg.addColorStop(0, '#fffaf0'); vg.addColorStop(0.45, '#f4ceda'); vg.addColorStop(0.8, '#d4a652'); vg.addColorStop(1, '#7c5c20');
      f.strokeStyle = vg; f.lineWidth = 1.65 * s; tracePoly(f, shieldPts, true); f.stroke();

      if (surge > 0.02) {
        const al = Math.min(1, surge * 1.18) * (1 - dissolve * 0.84);
        if (scene === 0) {
          // Authentic Leaded Stained-Glass Cathedral Rose Window w/ cast mullion shadow & beveled bronze cames!
          const rw = ra * (1.3 + dissolve * 0.44);
          castShadow(f, 6.5 * s, al * 0.86, (shCol) => {
            f.strokeStyle = shCol; f.lineWidth = 3.2 * s; f.beginPath(); f.arc(cx, cy, rw, 0, TAU); f.stroke();
          });
          f.save(); f.globalAlpha = al * 0.94; f.translate(cx, cy); f.rotate(t * 0.2);
          const panes = 12; const cols = [rose, sky, gold, ivory];
          for (let i = 0; i < panes; i += 1) {
            const a0 = (i / panes) * TAU; const a1 = ((i + 1) / panes) * TAU; const aMid = (a0 + a1) * 0.5;
            const gGr = f.createRadialGradient(0, 0, rw * 0.12, 0, 0, rw);
            gGr.addColorStop(0, `rgba(255,252,244,.42)`); gGr.addColorStop(0.55, `rgba(${cols[i % 4]},.36)`); gGr.addColorStop(1, `rgba(24,18,32,.46)`);
            f.fillStyle = gGr; f.strokeStyle = '#382a1e'; f.lineWidth = 2.0 * s;
            f.beginPath(); f.moveTo(0, 0);
            f.lineTo(Math.cos(a0) * rw * 0.78, Math.sin(a0) * rw * 0.78);
            f.quadraticCurveTo(Math.cos(aMid) * rw * 1.12, Math.sin(aMid) * rw * 1.12, Math.cos(a1) * rw * 0.78, Math.sin(a1) * rw * 0.78);
            f.closePath(); f.fill(); f.stroke();
            f.strokeStyle = `rgba(${gold},.82)`; f.lineWidth = 0.8 * s; f.stroke();
            f.fillStyle = `rgba(${cols[(i + 1) % 4]},.52)`;
            f.beginPath(); f.arc(Math.cos(aMid) * rw * 0.84, Math.sin(aMid) * rw * 0.84, rw * 0.11, 0, TAU); f.fill(); f.stroke();
          }
          drawBevelRing(f, 0, 0, rw * 1.02, 2.2 * s, [[0, '#fff7de'], [0.5, '#c69a4a'], [1, '#4c3412']], al, s);
          f.restore();
        } else if (scene === 1) {
          // 7 Spun-Gold Harp Strings anchored to beveled top/bottom brass tuning-pin bridge bars!
          const strings = 7;
          // Top & bottom beveled gilded harp bridge rails
          for (const by of [5 * s, H - 5 * s]) {
            f.fillStyle = `rgba(3,4,8,${al * 0.48})`; f.fillRect(W * 0.1, by + 1 * s, W * 0.8, 3.6 * s);
            const bGr = f.createLinearGradient(W * 0.1, by - 2 * s, W * 0.1, by + 2.5 * s);
            bGr.addColorStop(0, '#fff4cf'); bGr.addColorStop(0.55, '#c89840'); bGr.addColorStop(1, '#54380e');
            f.fillStyle = bGr; f.fillRect(W * 0.1, by - 1.8 * s, W * 0.8, 3.6 * s);
          }
          for (let i = 0; i < strings; i += 1) {
            const sx = W * (0.14 + (i / (strings - 1)) * 0.72);
            const age = activeU - i * 0.095;
            const vib = age > 0 ? Math.exp(-age * 5.0) * Math.sin(age * 46) * 14 * s : 0;
            // Subtle string shadow + metallic spun-gold string
            f.strokeStyle = `rgba(4,4,8,${al * 0.34})`; f.lineWidth = 2.0 * s;
            f.beginPath(); f.moveTo(sx + 1.5 * s, 6 * s); f.quadraticCurveTo(sx + vib + 1.8 * s, H * 0.5, sx + 1.5 * s, H - 6 * s); f.stroke();
            f.strokeStyle = `rgba(${i % 2 ? gold : ivory},${al * (age > 0 ? 0.94 : 0.46)})`; f.lineWidth = (age > 0 ? 1.55 : 0.95) * s;
            f.beginPath(); f.moveTo(sx, 6 * s); f.quadraticCurveTo(sx + vib, H * 0.5, sx, H - 6 * s); f.stroke();
            // Machined tuning pin heads
            f.fillStyle = `rgba(${gold},${al * 0.92})`; f.beginPath(); f.arc(sx, 5 * s, 2.2 * s, 0, TAU); f.fill();
            if (age > 0 && age < 0.35) sparkle(f, sx + vib * 0.5, cy + (i - 3) * 14 * s, (6 * (1 - age / 0.35)) * s, ivory, al);
          }
        } else if (scene === 2) {
          // Twin Crossed Dual-Beveled Valkyrie Spears + Two-Tone Sculpted Golden Olive Wreath!
          const slide = Math.min(1, surge * 1.15);
          const len = ra * (1.75 + (full ? 0.8 : 0.15));
          for (const sd of [-1, 1]) {
            const ang = sd * 0.68;
            const push = (1 - slide) * 44 * s + dissolve * 32 * s;
            const ox = cx - Math.cos(ang) * push * sd; const oy = cy - Math.sin(ang) * push * sd;
            // Cast shadow behind shaft & spearhead
            castShadow(f, 5.5 * s, al * 0.82, (shCol) => {
              f.save(); f.translate(ox, oy); f.rotate(ang);
              f.strokeStyle = shCol; f.lineWidth = 3.2 * s; f.beginPath(); f.moveTo(-len, 0); f.lineTo(len + 12 * s, 0); f.stroke();
              f.restore();
            });
            f.save(); f.globalAlpha = al * 0.96; f.translate(ox, oy); f.rotate(ang); f.lineCap = 'round';
            const shGr = f.createLinearGradient(0, -2 * s, 0, 2 * s);
            shGr.addColorStop(0, '#fff7dc'); shGr.addColorStop(0.5, '#cfa048'); shGr.addColorStop(1, '#5c3e10');
            f.strokeStyle = shGr; f.lineWidth = 2.4 * s; f.beginPath(); f.moveTo(-len, 0); f.lineTo(len, 0); f.stroke();
            // Dual-bevel diamond spearhead: upper lit brushed silver, lower shaded bronze
            f.fillStyle = '#fff9ee';
            f.beginPath(); f.moveTo(len + 15 * s, 0); f.lineTo(len - 4 * s, -5.8 * s); f.lineTo(len - 1 * s, 0); f.closePath(); f.fill();
            f.fillStyle = '#9a7638';
            f.beginPath(); f.moveTo(len + 15 * s, 0); f.lineTo(len - 1 * s, 0); f.lineTo(len - 4 * s, 5.8 * s); f.closePath(); f.fill();
            f.restore();
          }
          for (const sd of [-1, 1]) {
            for (let k = 0; k < 6; k += 1) {
              const a = Math.PI * 0.5 + sd * (0.28 + k * 0.36);
              drawSculptedLeaf(f, cx + Math.cos(a) * ra * 1.18, cy + Math.sin(a) * ra * 1.18, 12.5 * s * slide, 4.4 * s * slide, a - sd * 0.55, '#fff7dc', '#e2b85c', '#987228', '#4c340e', 'rgba(255,250,234,.78)', al * 0.95, 2.8 * s);
            }
          }
        } else {
          // Soft Feathered Cathedral Sunbeam Shafts + Depth-Layered Golden Dust Bokeh
          f.save(); f.globalCompositeOperation = 'lighter';
          for (let i = 0; i < 4; i += 1) {
            const topX = W * (0.04 + i * 0.28) + Math.sin(t * 0.65 + i) * 10 * s;
            const beamW = (24 + (i % 2) * 14) * s; const slant = W * 0.34;
            const gr = f.createLinearGradient(topX, 0, topX + slant, H);
            gr.addColorStop(0, `rgba(${ivory},${al * 0.28})`); gr.addColorStop(0.55, `rgba(${gold},${al * 0.14})`); gr.addColorStop(1, 'rgba(255,248,232,0)');
            f.fillStyle = gr;
            f.beginPath(); f.moveTo(topX, 0); f.lineTo(topX + beamW, 0); f.lineTo(topX + beamW + slant, H); f.lineTo(topX + slant, H); f.closePath(); f.fill();
          }
          f.restore();
          for (const m of motes) {
            const p = frac(m.y0 + activeU * 0.62);
            const mx = m.x + p * 26 * s; const my = p * H;
            const mal = Math.sin(p * Math.PI) * al;
            glow(f, mx, my, m.r * 2.1 * s, ivory, mal * 0.65);
            f.fillStyle = `rgba(255,252,240,${mal * 0.88})`; f.beginPath(); f.arc(mx, my, m.r * 0.52 * s, 0, TAU); f.fill();
          }
        }
      }
    };
  }, { fullCard: true });

  // =========================================================================
  // 12. ABYSSAL LEVIATHAN — Sculpted Bioluminescent Manta Rays w/ Deep-Water
  //     Cast Shadows, Dual-Depth Sun Caustics, Refractive Bubbles, Trench Sonar
  // =========================================================================
  api.registerEffect('ex_leviathan', 'Abyssal Leviathan', 'Exclusive', 'Four deep-ocean studio acts: gliding bioluminescent manta rays with deep-water shadows, dual-depth lagoon caustics, refractive sea-bubble kelp plumes, and trench bathymetry sonar.', 3, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const turq = '72,226,214';
    const deep = '84,142,232';
    const foam = '226,250,255';
    const wavePts = Array.from({ length: 72 }, (_, i) => {
      const a = -Math.PI / 2 + (i / 72) * TAU;
      const r = ra * (1.22 + 0.065 * Math.sin(9 * a));
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    });
    const bubbles = Array.from({ length: full ? 26 : 15 }, (_, i) => ({
      x: ((i * 0.37 + 0.06) % 0.9 + 0.05) * W, y0: R(0, 1), r: R(2.4, 6.4), ph: R(0, TAU)
    }));

    const drawMantaRay = (g, x, y, sc, ang, flap, al) => {
      const wingY = (24 + Math.sin(flap) * 6.5) * sc;
      const tipX = (-4 + Math.cos(flap) * 4.5) * sc;
      const mantaBody = () => {
        g.beginPath();
        g.moveTo(14 * sc, -4.5 * sc);
        g.quadraticCurveTo(10 * sc, -8 * sc, tipX, -wingY);
        g.quadraticCurveTo(-12 * sc, -10 * sc, -14 * sc, 0);
        g.quadraticCurveTo(-12 * sc, 10 * sc, tipX, wingY);
        g.quadraticCurveTo(10 * sc, 8 * sc, 14 * sc, 4.5 * sc);
        g.quadraticCurveTo(9 * sc, 0, 14 * sc, -4.5 * sc);
        g.closePath();
      };
      // Deep underwater shadow drifting noticeably offset beneath the swimming manta!
      castShadow(g, 11 * s, al * 0.85, (shCol) => {
        g.save(); g.translate(x, y); g.rotate(ang); g.fillStyle = shCol; mantaBody(); g.fill(); g.restore();
      });
      g.save(); g.globalAlpha = al; g.translate(x, y); g.rotate(ang);
      const gr = g.createLinearGradient(14 * sc, -wingY * 0.7, -18 * sc, wingY * 0.8);
      gr.addColorStop(0, '#c2f7f4'); gr.addColorStop(0.32, '#2eb8b8'); gr.addColorStop(0.75, '#1b4a7a'); gr.addColorStop(1, '#091a36');
      g.fillStyle = gr; g.strokeStyle = `rgba(${foam},.68)`; g.lineWidth = 0.9 * s;
      mantaBody(); g.fill(); g.stroke();
      // Subtle sculpted dorsal spine catchlight + delicate bioluminescent wing markings
      g.strokeStyle = `rgba(${foam},.62)`; g.lineWidth = 1.15 * s; g.lineCap = 'round';
      g.beginPath(); g.moveTo(8 * sc, 0); g.lineTo(-12 * sc, 0); g.stroke();
      for (const sd of [-1, 1]) {
        g.fillStyle = `rgba(${foam},.72)`;
        g.beginPath(); g.arc(2 * sc, sd * 8 * sc, 1.4 * sc, 0, TAU); g.arc(-3 * sc, sd * 13 * sc, 1.1 * sc, 0, TAU); g.fill();
      }
      g.strokeStyle = `rgba(${turq},.84)`; g.lineWidth = 1.25 * s;
      g.beginPath(); g.moveTo(-14 * sc, 0);
      g.bezierCurveTo(-24 * sc, Math.sin(flap) * 6 * sc, -34 * sc, -Math.sin(flap) * 7 * sc, -44 * sc, Math.sin(flap + 1) * 5 * sc);
      g.stroke();
      g.restore();
    };

    return (t) => {
      const { scene, activeU, surge, dissolve } = sceneDirector(t, 6.2, 'silk', 4);
      if (full) {
        b.lineCap = 'round';
        for (const [kx, kh] of [[18 * s, 44 * s], [32 * s, 32 * s], [W - 20 * s, 48 * s], [W - 34 * s, 30 * s]]) {
          const sw = Math.sin(t * 1.4 + kx) * 8 * s;
          b.strokeStyle = 'rgba(2,8,14,.46)'; b.lineWidth = 2.6 * s;
          b.beginPath(); b.moveTo(kx + 2 * s, H); b.quadraticCurveTo(kx + sw + 2 * s, H - kh * 0.5, kx - sw * 0.6 + 2 * s, H - kh); b.stroke();
          b.strokeStyle = `rgba(${turq},${0.26 + surge * 0.24})`; b.lineWidth = 1.6 * s;
          b.beginPath(); b.moveTo(kx, H); b.quadraticCurveTo(kx + sw, H - kh * 0.5, kx - sw * 0.6, H - kh); b.stroke();
        }
      }
      f.strokeStyle = 'rgba(2,8,16,.54)'; f.lineWidth = 2.6 * s;
      f.save(); f.translate(L_DX * 1.6 * s, L_DY * 1.6 * s); tracePoly(f, wavePts, true); f.stroke(); f.restore();
      const og = f.createLinearGradient(cx - ra, cy - ra, cx + ra, cy + ra);
      og.addColorStop(0, '#e6fcff'); og.addColorStop(0.45, '#48dad0'); og.addColorStop(1, '#2a5696');
      f.strokeStyle = og; f.lineWidth = 1.65 * s; tracePoly(f, wavePts, true); f.stroke();

      if (surge > 0.02) {
        const al = Math.min(1, surge * 1.18) * (1 - dissolve * 0.84);
        if (scene === 0) {
          for (let m = 0; m < 2; m += 1) {
            const p = Math.min(1.15, Math.max(-0.15, activeU * 1.38 - m * 0.22));
            const mx = (m === 0 ? -36 * s + p * (W + 72 * s) : W + 36 * s - p * (W + 72 * s));
            const my = (m === 0 ? cy + ra * 0.8 - p * (full ? H * 0.42 : ra * 1.2) : cy - ra * 0.4 + p * (full ? H * 0.55 : ra * 1.1)) + Math.sin(p * TAU) * 14 * s;
            const ang = m === 0 ? -0.35 : Math.PI + 0.35;
            for (let k = 1; k <= 6; k += 1) glow(f, mx - Math.cos(ang) * k * 9 * s, my - Math.sin(ang) * k * 9 * s, (6.5 - k * 0.8) * s, turq, al * (0.38 - k * 0.05));
            drawMantaRay(f, mx, my, (m === 0 ? 1.15 : 0.85) * s, ang, t * 4.4 + m * 2, al);
          }
        } else if (scene === 1) {
          // Dual-Depth Sunlit Lagoon Water Caustics (deep shadowed refraction web + crisp sunlit caustic mesh!)
          const cols = full ? 7 : 5; const rows = full ? 8 : 5;
          const pts = [];
          for (let r = 0; r <= rows; r += 1) {
            pts[r] = [];
            for (let c = 0; c <= cols; c += 1) {
              pts[r][c] = [
                (c / cols) * W + Math.sin(t * 2.0 + r * 1.4 + c * 0.9) * 13 * s,
                (r / rows) * H + Math.cos(t * 1.7 + c * 1.5 - r * 0.8) * 13 * s
              ];
            }
          }
          // Shadowed background caustic offset
          f.strokeStyle = `rgba(6,22,42,${al * 0.36})`; f.lineWidth = 2.4 * s;
          for (let r = 0; r <= rows; r += 1) {
            f.beginPath(); for (let c = 0; c <= cols; c += 1) { if (c === 0) f.moveTo(pts[r][c][0] + 2.5 * s, pts[r][c][1] + 3.5 * s); else f.lineTo(pts[r][c][0] + 2.5 * s, pts[r][c][1] + 3.5 * s); } f.stroke();
          }
          f.save(); f.globalCompositeOperation = 'lighter';
          f.strokeStyle = `rgba(${turq},${al * 0.38})`; f.lineWidth = 1.55 * s;
          for (let r = 0; r <= rows; r += 1) {
            f.beginPath(); for (let c = 0; c <= cols; c += 1) { if (c === 0) f.moveTo(pts[r][c][0], pts[r][c][1]); else f.lineTo(pts[r][c][0], pts[r][c][1]); } f.stroke();
          }
          f.strokeStyle = `rgba(${foam},${al * 0.28})`; f.lineWidth = 0.95 * s;
          for (let c = 0; c <= cols; c += 1) {
            f.beginPath(); for (let r = 0; r <= rows; r += 1) { if (r === 0) f.moveTo(pts[r][c][0], pts[r][c][1]); else f.lineTo(pts[r][c][0], pts[r][c][1]); } f.stroke();
          }
          f.restore();
        } else if (scene === 2) {
          // Refractive Air Bubbles (meniscus shadow + key specular crescent + bottom bounce dot) & Shaded Kelp
          for (const bb of bubbles) {
            const p = frac(activeU * 1.28 + bb.y0);
            const bx = bb.x + Math.sin(p * TAU * 2.4 + bb.ph) * 11 * s;
            const by = H * (1.06 - p * 1.18);
            const r = bb.r * s;
            const bal = Math.sin(p * Math.PI) * al;
            f.fillStyle = `rgba(2,10,20,${bal * 0.26})`; f.beginPath(); f.arc(bx + 2 * s, by + 2.6 * s, r, 0, TAU); f.fill();
            const bGr = f.createRadialGradient(bx - r * 0.3, by - r * 0.3, r * 0.1, bx, by, r);
            bGr.addColorStop(0, `rgba(255,255,255,${bal * 0.12})`); bGr.addColorStop(0.76, `rgba(${turq},${bal * 0.22})`); bGr.addColorStop(1, `rgba(${foam},${bal * 0.82})`);
            f.fillStyle = bGr; f.beginPath(); f.arc(bx, by, r, 0, TAU); f.fill();
            f.strokeStyle = `rgba(255,255,255,${bal * 0.9})`; f.lineWidth = 0.95 * s;
            f.beginPath(); f.arc(bx, by, r * 0.7, -2.5, -1.1); f.stroke();
            f.fillStyle = `rgba(${turq},${bal * 0.72})`; f.beginPath(); f.arc(bx + r * 0.32, by + r * 0.34, r * 0.16, 0, TAU); f.fill();
          }
          for (let k = 0; k < 5; k += 1) {
            const kx = W * (0.12 + k * 0.19); const kh = H * (0.48 + (k % 2) * 0.18) * surge;
            const sw = Math.sin(t * 2.3 + k * 1.5) * 18 * s;
            f.lineCap = 'round';
            f.strokeStyle = `rgba(4,16,24,${al * 0.44})`; f.lineWidth = (5.4 - (k % 2)) * s;
            f.beginPath(); f.moveTo(kx + 2 * s, H + 4 * s); f.quadraticCurveTo(kx + sw + 2 * s, H - kh * 0.55, kx - sw * 0.5 + 2 * s, H - kh); f.stroke();
            f.strokeStyle = `rgba(${turq},${al * 0.54})`; f.lineWidth = (3.8 - (k % 2)) * s;
            f.beginPath(); f.moveTo(kx, H + 4 * s); f.quadraticCurveTo(kx + sw, H - kh * 0.55, kx - sw * 0.5, H - kh); f.stroke();
          }
        } else {
          const sweepA = -Math.PI * 0.5 + activeU * TAU * 1.25;
          const sLen = full ? Math.hypot(W, H) * 0.72 : ra * 2.7;
          if (full) {
            b.strokeStyle = `rgba(${deep},${al * 0.26})`; b.lineWidth = 0.9 * s;
            for (let row = 1; row <= 5; row += 1) {
              const by = H * (0.14 + row * 0.15);
              b.beginPath();
              for (let x = 0; x <= W; x += 22 * s) {
                const y = by + Math.sin(x * 0.025 + row * 1.7 + t * 0.8) * 10 * s;
                if (x === 0) b.moveTo(x, y); else b.lineTo(x, y);
              }
              b.stroke();
            }
          }
          f.strokeStyle = `rgba(${turq},${al * 0.34})`; f.lineWidth = 0.9 * s;
          for (const rk of [1.2, 2.0, 2.85]) { f.beginPath(); f.arc(cx, cy, ra * rk, sweepA - 0.85, sweepA - 0.05); f.stroke(); }
          const gr = f.createLinearGradient(cx, cy, cx + Math.cos(sweepA) * sLen, cy + Math.sin(sweepA) * sLen);
          gr.addColorStop(0, `rgba(${foam},${al * 0.54})`); gr.addColorStop(1, `rgba(${turq},0)`);
          f.fillStyle = gr; f.beginPath(); f.moveTo(cx, cy); f.arc(cx, cy, sLen, sweepA - 0.56, sweepA); f.closePath(); f.fill();
          f.strokeStyle = `rgba(${foam},${al * 0.94})`; f.lineWidth = 1.6 * s;
          f.beginPath(); f.moveTo(cx, cy); f.lineTo(cx + Math.cos(sweepA) * sLen, cy + Math.sin(sweepA) * sLen); f.stroke();
          for (let i = 0; i < 16; i += 1) {
            const ka = (i / 16) * TAU + 0.22;
            const diff = frac((sweepA - ka) / TAU);
            if (diff < 0.42) {
              const fade = (1 - diff / 0.42) * al;
              const kr = ra * (0.75 + (i % 5) * 0.62);
              const px = cx + Math.cos(ka) * kr; const py = cy + Math.sin(ka) * kr;
              glow(f, px, py, 6.2 * s, i % 2 ? foam : turq, fade * 0.82);
              f.fillStyle = `rgba(255,255,255,${fade})`; f.beginPath(); f.arc(px, py, 1.5 * s, 0, TAU); f.fill();
            }
          }
        }
      }
    };
  }, { fullCard: true });

  // =========================================================================
  // 13. CHRONOS ASTRAL — Haute Horlogerie Skeleton Tourbillon w/ Hand Shadows &
  //     Cabochon Rubies, Beveled Meshed Gears, Spun-Brass Pendulum, 3D Armillary
  // =========================================================================
  api.registerEffect('ex_chronos', 'Chronos Astral', 'Exclusive', 'Four haute-horlogerie acts: skeleton tourbillon watchface with shadowed Breguet hands and cabochon rubies, meshed brushed-brass gears, spun-brass pendulum, and a 3D armillary sphere.', 3, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const brass = '236,198,122';
    const cobalt = '106,162,238';
    const ruby = '216,64,96';
    const ivory = '252,244,222';

    const drawToothedGear = (g, x, y, r, teeth, rot, metalType, al, withShadow = true) => {
      const traceWheel = () => {
        g.beginPath();
        for (let i = 0; i < teeth * 2; i += 1) {
          const a = (i / (teeth * 2)) * TAU;
          const rad = i % 2 === 0 ? r * 1.13 : r * 0.91;
          if (i === 0) g.moveTo(Math.cos(a) * rad, Math.sin(a) * rad); else g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
        }
        g.closePath();
      };
      if (withShadow) {
        g.save(); g.globalAlpha = al * 0.44;
        g.translate(x + L_DX * 4.2 * s, y + L_DY * 4.2 * s); g.rotate(rot);
        g.strokeStyle = '#02040a'; g.lineWidth = 2.2 * s; traceWheel(); g.stroke();
        g.restore();
      }
      g.save(); g.globalAlpha = al; g.translate(x, y); g.rotate(rot);
      const mGr = g.createLinearGradient(-r, -r, r, r);
      if (metalType === 'cobalt') {
        mGr.addColorStop(0, '#d8ecff'); mGr.addColorStop(0.45, '#5a94e0'); mGr.addColorStop(1, '#1d3664');
      } else if (metalType === 'ivory') {
        mGr.addColorStop(0, '#ffffff'); mGr.addColorStop(0.5, '#cbd4de'); mGr.addColorStop(1, '#586474');
      } else {
        mGr.addColorStop(0, '#fff4cf'); mGr.addColorStop(0.45, '#d6a446'); mGr.addColorStop(1, '#684612');
      }
      g.strokeStyle = mGr; g.lineWidth = 1.65 * s; traceWheel(); g.stroke();
      g.beginPath(); g.arc(0, 0, r * 0.56, 0, TAU); g.stroke();
      for (let i = 0; i < 5; i += 1) {
        const a = (i / 5) * TAU;
        g.beginPath(); g.moveTo(Math.cos(a) * r * 0.22, Math.sin(a) * r * 0.22); g.lineTo(Math.cos(a) * r * 0.91, Math.sin(a) * r * 0.91); g.stroke();
      }
      // Cabochon bearing ruby jewel in brass chaton collar with pinpoint catchlight!
      const jr = Math.max(2.2 * s, r * 0.15);
      g.fillStyle = '#382208'; g.beginPath(); g.arc(0, 0, jr * 1.35, 0, TAU); g.fill();
      const jGr = g.createRadialGradient(-jr * 0.35, -jr * 0.35, jr * 0.1, 0, 0, jr);
      jGr.addColorStop(0, '#ffc4d4'); jGr.addColorStop(0.45, '#d83860'); jGr.addColorStop(1, '#540a1e');
      g.fillStyle = jGr; g.beginPath(); g.arc(0, 0, jr, 0, TAU); g.fill();
      g.restore();
    };

    return (t) => {
      const { scene, activeU, surge, dissolve } = sceneDirector(t, 6.4, 'tick', 4);
      if (full) {
        drawToothedGear(b, W - 26 * s, H - 26 * s, 14 * s, 12, Math.sin(t * 6.0) * 0.72, 'brass', 0.42 + surge * 0.26, true);
        for (const px of [12 * s, W - 12 * s]) {
          f.fillStyle = 'rgba(2,4,8,.5)'; f.beginPath(); f.arc(px + 1 * s, 13.5 * s, 4.2 * s, 0, TAU); f.fill();
          const pGr = f.createRadialGradient(px - 1.2 * s, 10.8 * s, 0.4 * s, px, 12 * s, 4 * s);
          pGr.addColorStop(0, '#fff5d2'); pGr.addColorStop(0.55, '#c89840'); pGr.addColorStop(1, '#4c320c');
          f.fillStyle = pGr; f.beginPath(); f.arc(px, 12 * s, 3.8 * s, 0, TAU); f.fill();
        }
      }
      // Haute-horlogerie beveled brass watchcase bezel + recessed chapter ring
      drawBevelRing(f, cx, cy, ra * 1.26, 2.0 * s, [[0, '#fff5d6'], [0.42, '#d8a64c'], [0.78, '#6c4814'], [1, '#e6bc66']], 0.94, s);
      f.strokeStyle = `rgba(${cobalt},.48)`; f.lineWidth = 0.85 * s;
      f.beginPath(); f.arc(cx, cy, ra * 1.13, 0, TAU); f.stroke();
      f.strokeStyle = `rgba(${ivory},.74)`; f.lineWidth = 1.0 * s;
      f.beginPath();
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * TAU;
        const r1 = ra * (i % 3 === 0 ? 1.13 : 1.18);
        f.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        f.lineTo(cx + Math.cos(a) * ra * 1.26, cy + Math.sin(a) * ra * 1.26);
      }
      f.stroke();

      if (surge > 0.02) {
        const al = Math.min(1, surge * 1.18) * (1 - dissolve * 0.84);
        if (scene === 0) {
          // Skeleton Tourbillon Watchface with inner rehaut shadow, cast hand shadows & blued-steel Breguet hands!
          const cr = ra * (1.22 + dissolve * 0.36);
          castShadow(f, 6.5 * s, al * 0.86, (shCol) => {
            f.fillStyle = shCol; f.beginPath(); f.arc(cx, cy, cr, 0, TAU); f.fill();
          });
          f.save(); f.globalAlpha = al * 0.96;
          // Recessed smoked-sapphire watch crystal dial with inner rehaut shadow
          const dGr = f.createRadialGradient(cx - cr * 0.25, cy - cr * 0.25, cr * 0.1, cx, cy, cr);
          dGr.addColorStop(0, 'rgba(22,34,58,.64)'); dGr.addColorStop(0.75, 'rgba(10,16,30,.72)'); dGr.addColorStop(1, 'rgba(3,6,14,.86)');
          f.fillStyle = dGr; f.beginPath(); f.arc(cx, cy, cr, 0, TAU); f.fill();
          drawBevelRing(f, cx, cy, cr, 2.2 * s, [[0, '#fff5d4'], [0.45, '#cfa048'], [1, '#58380e']], al, s);
          // Beveled skeleton bridge bar with two blued-steel micro-screws + spinning 6-o'clock tourbillon
          f.strokeStyle = 'rgba(2,4,8,.55)'; f.lineWidth = 2.4 * s;
          f.beginPath(); f.moveTo(cx - cr * 0.78, cy + 1.5 * s); f.quadraticCurveTo(cx, cy - cr * 0.25 + 1.5 * s, cx + cr * 0.78, cy + 1.5 * s); f.stroke();
          f.strokeStyle = `rgba(${brass},.72)`; f.lineWidth = 1.45 * s;
          f.beginPath(); f.moveTo(cx - cr * 0.78, cy); f.quadraticCurveTo(cx, cy - cr * 0.25, cx + cr * 0.78, cy); f.stroke();
          for (const sd of [-1, 1]) {
            f.fillStyle = `rgba(${cobalt},.92)`; f.beginPath(); f.arc(cx + sd * cr * 0.62, cy - cr * 0.04, 1.5 * s, 0, TAU); f.fill();
          }
          drawToothedGear(f, cx, cy + cr * 0.44, cr * 0.24, 8, t * 5.2, 'cobalt', al * 0.92, true);
          f.strokeStyle = `rgba(${ivory},.84)`; f.lineWidth = 1.05 * s;
          for (let i = 0; i < 12; i += 1) {
            const a = (i / 12) * TAU; const r0 = cr * (i % 3 === 0 ? 0.78 : 0.86);
            f.beginPath(); f.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); f.lineTo(cx + Math.cos(a) * cr * 0.95, cy + Math.sin(a) * cr * 0.95); f.stroke();
          }
          const rewinding = activeU > 0.34;
          const mA = rewinding ? (-Math.PI * 0.2 - (activeU - 0.34) * TAU * 3.4) : (-Math.PI * 0.5 + Math.floor(t * 4) * 0.14);
          const hA = mA * 0.22;
          f.lineCap = 'round';
          // Watch-hand shadows cast onto the sapphire dial face!
          f.strokeStyle = 'rgba(0,0,0,.55)'; f.lineWidth = 2.4 * s;
          f.beginPath(); f.moveTo(cx + 1.5 * s, cy + 2.2 * s); f.lineTo(cx + Math.cos(mA) * cr * 0.82 + 1.5 * s, cy + Math.sin(mA) * cr * 0.82 + 2.2 * s); f.stroke();
          f.strokeStyle = 'rgba(0,0,0,.55)'; f.lineWidth = 3.2 * s;
          f.beginPath(); f.moveTo(cx + 1.5 * s, cy + 2.2 * s); f.lineTo(cx + Math.cos(hA) * cr * 0.54 + 1.5 * s, cy + Math.sin(hA) * cr * 0.54 + 2.2 * s); f.stroke();
          // Blued-steel minute & gilded hour Breguet hands
          f.strokeStyle = '#7bb4ff'; f.lineWidth = 1.9 * s;
          f.beginPath(); f.moveTo(cx, cy); f.lineTo(cx + Math.cos(mA) * cr * 0.82, cy + Math.sin(mA) * cr * 0.82); f.stroke();
          f.beginPath(); f.arc(cx + Math.cos(mA) * cr * 0.64, cy + Math.sin(mA) * cr * 0.64, 2.3 * s, 0, TAU); f.stroke();
          f.strokeStyle = '#f2cc76'; f.lineWidth = 2.7 * s;
          f.beginPath(); f.moveTo(cx, cy); f.lineTo(cx + Math.cos(hA) * cr * 0.54, cy + Math.sin(hA) * cr * 0.54); f.stroke();
          // Central cabochon ruby pivot jewel
          const rGr = f.createRadialGradient(cx - 1.2 * s, cy - 1.2 * s, 0.4 * s, cx, cy, 3.6 * s);
          rGr.addColorStop(0, '#ffc4d4'); rGr.addColorStop(0.5, '#d63258'); rGr.addColorStop(1, '#4c0818');
          f.fillStyle = rGr; f.beginPath(); f.arc(cx, cy, 3.4 * s, 0, TAU); f.fill();
          f.restore();
        } else if (scene === 1) {
          const omega = t * 1.65;
          drawToothedGear(f, cx, cy, ra * 0.95, 16, omega, 'brass', al * 0.96, true);
          drawToothedGear(f, cx + ra * 1.48, cy - ra * 0.42, ra * 0.59, 10, -omega * (16 / 10) + 0.31, 'cobalt', al * 0.9, true);
          drawToothedGear(f, cx - ra * 1.38, cy + ra * 0.58, ra * 0.59, 10, -omega * (16 / 10) + 0.2, 'ivory', al * 0.86, true);
          if (full) {
            drawToothedGear(f, cx + ra * 2.25, cy + ra * 0.85, ra * 0.82, 14, omega * (16 / 14), 'brass', al * 0.8, true);
            drawToothedGear(f, cx + ra * 0.55, cy + ra * 2.15, ra * 0.71, 12, -omega * (16 / 12), 'cobalt', al * 0.74, true);
          }
        } else if (scene === 2) {
          // Spun-Brass Grandfather Pendulum w/ cast shadow, cylindrical rod & 3D lenticular spun-gold bob!
          const pivotX = full ? W * 0.5 : cx; const pivotY = 4 * s;
          const rodLen = full ? H * 0.78 : ra * 2.15;
          for (let ghost = 4; ghost >= 0; ghost -= 1) {
            const swingA = Math.sin((t - ghost * 0.055) * 3.6) * 0.6;
            const bx = pivotX + Math.sin(swingA) * rodLen; const by = pivotY + Math.cos(swingA) * rodLen;
            if (ghost > 0) {
              const gal = al * (0.24 - ghost * 0.045);
              f.strokeStyle = `rgba(${brass},${gal})`; f.lineWidth = 0.95 * s;
              f.beginPath(); f.moveTo(pivotX, pivotY); f.lineTo(bx, by); f.stroke();
              f.fillStyle = `rgba(${brass},${gal})`; f.beginPath(); f.arc(bx, by, 9.2 * s, 0, TAU); f.fill();
            } else {
              // Cast shadow beneath live brass rod & pendulum bob
              f.strokeStyle = `rgba(2,4,10,${al * 0.44})`; f.lineWidth = 2.8 * s;
              f.beginPath(); f.moveTo(pivotX + 3 * s, pivotY + 4 * s); f.lineTo(bx + 5 * s, by + 6.5 * s); f.stroke();
              f.fillStyle = `rgba(2,4,10,${al * 0.44})`; f.beginPath(); f.arc(bx + 5.5 * s, by + 7 * s, 12 * s, 0, TAU); f.fill();
              // Brushed brass rod
              f.strokeStyle = `rgba(${brass},${al * 0.96})`; f.lineWidth = 1.9 * s;
              f.beginPath(); f.moveTo(pivotX, pivotY); f.lineTo(bx, by); f.stroke();
              // 3D Spun-Brass Lenticular Pendulum Bob
              const bGr = f.createRadialGradient(bx - 4 * s, by - 4.5 * s, 1.2 * s, bx, by, 12.2 * s);
              bGr.addColorStop(0, '#fff9df'); bGr.addColorStop(0.32, '#efd07c'); bGr.addColorStop(0.68, '#a87622'); bGr.addColorStop(1, '#3e2606');
              f.fillStyle = bGr; f.beginPath(); f.arc(bx, by, 12 * s, 0, TAU); f.fill();
              f.strokeStyle = `rgba(255,250,224,${al * 0.85})`; f.lineWidth = 0.95 * s;
              f.beginPath(); f.arc(bx, by, 11.4 * s, -2.5, -0.7); f.stroke();
            }
          }
        } else {
          // 3D Rotating Brass Armillary Sphere with shadowed polar axis & depth-shaded meridian rings
          const ar = ra * (1.36 + dissolve * 0.46);
          const ax = Math.cos(-0.48) * ar * 1.42; const ay = Math.sin(-0.48) * ar * 1.42;
          f.strokeStyle = `rgba(2,4,10,${al * 0.45})`; f.lineWidth = 2.4 * s;
          f.beginPath(); f.moveTo(cx - ax + 2 * s, cy - ay + 2.8 * s); f.lineTo(cx + ax + 2 * s, cy + ay + 2.8 * s); f.stroke();
          f.strokeStyle = `rgba(${brass},${al * 0.78})`; f.lineWidth = 1.3 * s;
          f.beginPath(); f.moveTo(cx - ax, cy - ay); f.lineTo(cx + ax, cy + ay); f.stroke();
          const rings = [
            { rot: t * 0.82, tilt: Math.cos(t * 1.1) * 0.82, col: brass },
            { rot: -t * 0.6 + 1.05, tilt: Math.sin(t * 0.92) * 0.78, col: cobalt },
            { rot: t * 0.44 + 2.1, tilt: Math.cos(t * 0.72 + 1.1) * 0.85, col: ivory }
          ];
          for (const rg of rings) {
            const ry = Math.max(ra * 0.16, Math.abs(rg.tilt) * ar);
            f.strokeStyle = `rgba(2,4,10,${al * 0.44})`; f.lineWidth = 2.6 * s;
            f.beginPath(); f.ellipse(cx + 2.2 * s, cy + 3.2 * s, ar, ry, rg.rot, 0, TAU); f.stroke();
            f.strokeStyle = `rgba(${rg.col},${al * 0.9})`; f.lineWidth = 1.65 * s;
            f.beginPath(); f.ellipse(cx, cy, ar, ry, rg.rot, 0, TAU); f.stroke();
            for (let k = 0; k < 6; k += 1) {
              const th = t * 2.0 + rg.rot + (k / 6) * TAU;
              const ex = Math.cos(th) * ar; const ey = Math.sin(th) * ry;
              const px = cx + ex * Math.cos(rg.rot) - ey * Math.sin(rg.rot);
              const py = cy + ex * Math.sin(rg.rot) + ey * Math.cos(rg.rot);
              f.fillStyle = `rgba(${k === 0 ? ruby : ivory},${al})`; f.beginPath(); f.arc(px, py, (k === 0 ? 2.8 : 1.3) * s, 0, TAU); f.fill();
            }
          }
        }
      }
    };
  }, { fullCard: true });

  // =========================================================================
  // 14. NINE-TAIL MIRAGE — Braided Shimenawa Rope & Folded Paper Shide,
  //     Shaded Brushwork Fox Tails, Subsurface-Lit Chochin Lanterns,
  //     Parchment Ofuda Talismans, Sculpted Porcelain Kitsune Mask
  // =========================================================================
  api.registerEffect('ex_kitsune', 'Nine-Tail Mirage', 'Exclusive', 'Four Japanese spirit-craft acts: nine shaded S-curved foxfire tails, subsurface-lit festival chochin lanterns, parchment ofuda talismans, and a sculpted porcelain kitsune mask.', 3, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const verm = '234,86,64';
    const foxCyan = '92,226,242';
    const ivory = '252,244,230';
    const gold = '238,198,122';
    const kitPts = [];
    const arcS = (a0, a1, rk, steps) => {
      for (let i = 0; i <= steps; i += 1) {
        const a = a0 + (i / steps) * (a1 - a0);
        kitPts.push([cx + Math.cos(a) * ra * rk, cy + Math.sin(a) * ra * rk]);
      }
    };
    arcS(-Math.PI * 0.65, -Math.PI * 0.35, 1.15, 6);
    kitPts.push([cx + ra * 0.98, cy - ra * 1.44]);
    kitPts.push([cx + ra * 1.15, cy - ra * 0.68]);
    arcS(-0.52, Math.PI + 0.52, 1.22, 34);
    kitPts.push([cx - ra * 0.98, cy - ra * 1.44]);

    const drawFoxTail = (g, ox, oy, baseAng, len, wavePh, al, tipCyan) => {
      const segs = 14;
      const spine = [];
      for (let i = 0; i <= segs; i += 1) {
        const k = i / segs;
        const bend = Math.sin(k * Math.PI * 1.65 + wavePh) * 0.42 * k;
        const a = baseAng + bend;
        spine.push([ox + Math.cos(a) * len * k, oy + Math.sin(a) * len * k]);
      }
      // 1. Floating shadow under each curved fox tail
      g.save(); g.globalAlpha = al * 0.32; g.lineCap = 'round';
      for (let i = 0; i < segs; i += 1) {
        const k = i / segs;
        g.strokeStyle = '#060306'; g.lineWidth = (2.0 + Math.sin(k * Math.PI) * ra * 0.28) * (1 - k * 0.18);
        g.beginPath(); g.moveTo(spine[i][0] + 3.2 * s, spine[i][1] + 4.5 * s); g.lineTo(spine[i + 1][0] + 3.2 * s, spine[i + 1][1] + 4.5 * s); g.stroke();
      }
      g.restore();
      // 2. Sculpted two-tone plush fur body (warm ochre underside shadow + key-lit alabaster upper brush)
      g.save(); g.globalAlpha = al; g.lineCap = 'round';
      for (let i = 0; i < segs; i += 1) {
        const k = i / segs;
        const w = (1.6 + Math.sin(k * Math.PI) * ra * 0.28) * (1 - k * 0.2);
        const underCol = k > 0.72 ? (tipCyan ? '28,112,138' : '142,32,22') : '168,144,124';
        const topCol = k > 0.72 ? (tipCyan ? foxCyan : verm) : ivory;
        g.strokeStyle = `rgba(${underCol},.88)`; g.lineWidth = w;
        g.beginPath(); g.moveTo(spine[i][0], spine[i][1]); g.lineTo(spine[i + 1][0], spine[i + 1][1]); g.stroke();
        g.strokeStyle = `rgba(${topCol},.94)`; g.lineWidth = w * 0.64;
        g.beginPath(); g.moveTo(spine[i][0] - 0.9 * s, spine[i][1] - 1.2 * s); g.lineTo(spine[i + 1][0] - 0.9 * s, spine[i + 1][1] - 1.2 * s); g.stroke();
      }
      const tip = spine[segs];
      glow(g, tip[0], tip[1], 6.2 * s, tipCyan ? foxCyan : verm, al * 0.64);
      g.restore();
    };

    const drawChochinLantern = (g, x, y, sc, sway, al) => {
      const rw = 10.8 * sc; const rh = 14.5 * sc;
      // Floating shadow beneath lantern body
      g.save(); g.globalAlpha = al * 0.34; g.translate(x + L_DX * 6.5 * s, y + L_DY * 6.5 * s); g.rotate(sway);
      g.fillStyle = '#050204'; g.beginPath(); g.ellipse(0, 0, rw, rh, 0, 0, TAU); g.fill(); g.restore();
      g.save(); g.globalAlpha = al; g.translate(x, y); g.rotate(sway);
      glow(g, 0, 0, 16 * sc, verm, al * 0.38);
      // Warm candle subsurface-scattering gradient through ribbed washi paper
      const gr = g.createRadialGradient(-2 * sc, -1 * sc, 1.5 * sc, 0, 0, rh * 1.05);
      gr.addColorStop(0, '#fff9e4'); gr.addColorStop(0.38, '#ff9d62'); gr.addColorStop(0.75, '#c83424'); gr.addColorStop(1, '#581010');
      g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, rw, rh, 0, 0, TAU); g.fill();
      // Recessed bamboo rib shadows + warm upper edge catchlight
      for (const ry of [-7.5 * sc, -2.5 * sc, 2.5 * sc, 7.5 * sc]) {
        const hw = Math.sqrt(Math.max(0, 1 - (ry / rh) * (ry / rh))) * rw;
        g.strokeStyle = 'rgba(54,10,8,.62)'; g.lineWidth = 1.0 * s;
        g.beginPath(); g.moveTo(-hw, ry); g.lineTo(hw, ry); g.stroke();
        g.strokeStyle = 'rgba(255,232,192,.32)'; g.lineWidth = 0.6 * s;
        g.beginPath(); g.moveTo(-hw * 0.85, ry - 0.8 * s); g.lineTo(hw * 0.85, ry - 0.8 * s); g.stroke();
      }
      // Beveled lacquered ebony wooden caps w/ top highlight
      const capGr = g.createLinearGradient(-5.5 * sc, 0, 5.5 * sc, 0);
      capGr.addColorStop(0, '#4a3234'); capGr.addColorStop(0.35, '#1e1114'); capGr.addColorStop(1, '#0b0608');
      g.fillStyle = capGr;
      g.fillRect(-5.4 * sc, -rh - 2.4 * sc, 10.8 * sc, 3.2 * sc);
      g.fillRect(-5.4 * sc, rh - 0.8 * sc, 10.8 * sc, 3.2 * sc);
      g.strokeStyle = `rgba(${gold},.9)`; g.lineWidth = 1.2 * s;
      g.beginPath(); g.moveTo(0, rh + 2.2 * sc); g.quadraticCurveTo(sway * 18, rh + 8 * sc, sway * 10, rh + 13.5 * sc); g.stroke();
      g.restore();
    };

    return (t) => {
      const { scene, activeU, surge, dissolve } = sceneDirector(t, 6.4, 'silk', 4);
      // Bespoke Perimeter: Braided Shinto Shimenawa straw rope w/ cast shadow & origami-folded shide paper!
      if (full) {
        b.strokeStyle = 'rgba(4,2,2,.48)'; b.lineWidth = 3.8 * s;
        b.beginPath(); b.moveTo(8 * s, 10.5 * s); b.quadraticCurveTo(W * 0.5, 24.5 * s, W - 8 * s, 10.5 * s); b.stroke();
        b.strokeStyle = `rgba(${gold},${0.54 + surge * 0.3})`; b.lineWidth = 2.6 * s;
        b.beginPath(); b.moveTo(8 * s, 8 * s); b.quadraticCurveTo(W * 0.5, 22 * s, W - 8 * s, 8 * s); b.stroke();
        for (const k of [0.22, 0.5, 0.78]) {
          const sx = 8 * s + (W - 16 * s) * k; const sy = 8 * s + 14 * s * (4 * k * (1 - k));
          const sw = Math.sin(t * 2.0 + k * 5) * 2.5 * s;
          // Cast shadow + two-facet folded origami paper shide
          b.fillStyle = 'rgba(4,2,2,.38)';
          b.beginPath(); b.moveTo(sx - 1 * s, sy + 1.5 * s); b.lineTo(sx + 3.5 * s, sy + 6.5 * s); b.lineTo(sx + 3.8 * s + sw, sy + 14.5 * s); b.lineTo(sx - 1.8 * s + sw, sy + 14.5 * s); b.closePath(); b.fill();
          b.fillStyle = `rgba(${ivory},${0.8 + surge * 0.18})`;
          b.beginPath(); b.moveTo(sx - 2 * s, sy); b.lineTo(sx + 2.5 * s, sy + 5 * s); b.lineTo(sx - 1.5 * s + sw, sy + 8 * s); b.closePath(); b.fill();
          b.fillStyle = `rgba(204,192,176,${0.78 + surge * 0.18})`;
          b.beginPath(); b.moveTo(sx - 1.5 * s + sw, sy + 8 * s); b.lineTo(sx + 2.8 * s + sw, sy + 13 * s); b.lineTo(sx - 2.8 * s + sw, sy + 13 * s); b.closePath(); b.fill();
        }
      }
      f.strokeStyle = 'rgba(4,2,4,.54)'; f.lineWidth = 2.6 * s;
      f.save(); f.translate(L_DX * 1.6 * s, L_DY * 1.6 * s); tracePoly(f, kitPts, true); f.stroke(); f.restore();
      const kg = f.createLinearGradient(cx - ra, cy - ra * 1.44, cx + ra, cy + ra * 1.26);
      kg.addColorStop(0, '#fff7eb'); kg.addColorStop(0.45, '#e8684e'); kg.addColorStop(0.8, '#8a261c'); kg.addColorStop(1, '#5ce2f2');
      f.strokeStyle = kg; f.lineWidth = 1.65 * s; tracePoly(f, kitPts, true); f.stroke();
      for (let i = -2; i <= 2; i += 1) {
        const a = Math.PI * 0.5 + i * 0.24;
        const bx = cx + Math.cos(a) * ra * 1.24; const by = cy + Math.sin(a) * ra * 1.24;
        const br = (i === 0 ? 2.6 : 1.9) * s;
        const bGr = f.createRadialGradient(bx - br * 0.35, by - br * 0.35, 0.3 * s, bx, by, br);
        bGr.addColorStop(0, '#ffffff'); bGr.addColorStop(0.55, i === 0 ? '#5ce2f2' : '#e8644c'); bGr.addColorStop(1, i === 0 ? '#185468' : '#641812');
        f.fillStyle = bGr; f.beginPath(); f.arc(bx, by, br, 0, TAU); f.fill();
      }

      if (surge > 0.02) {
        const al = Math.min(1, surge * 1.18) * (1 - dissolve * 0.84);
        if (scene === 0) {
          const fanOpen = 0.22 + surge * 0.82 + dissolve * 0.38;
          for (let i = 0; i < 9; i += 1) {
            const k = (i - 4) / 4;
            drawFoxTail(f, cx, cy + ra * 0.26, -Math.PI * 0.5 + k * 1.52 * fanOpen, ra * (1.88 - Math.abs(k) * 0.24 + (full ? 0.45 : 0)), t * 3.5 + i * 0.65, al * 0.95, i % 2 === 1);
          }
        } else if (scene === 1) {
          const cnt = full ? 6 : 4;
          for (let i = 0; i < cnt; i += 1) {
            const p = frac(activeU * 0.85 + i / cnt);
            const lx = W * (0.14 + ((i * 0.37) % 0.74)) + Math.sin(t * 1.35 + i * 2) * 14 * s;
            const ly = H * (1.12 - p * 1.28);
            drawChochinLantern(f, lx, ly, (0.85 + (i % 3) * 0.16) * s, Math.sin(t * 2.1 + i) * 0.12, Math.sin(p * Math.PI) * al);
          }
        } else if (scene === 2) {
          // 3D Tumbling Parchment Ofuda Shrine Charms w/ drop shadows & warm cream-ochre fold gradients!
          const cnt = full ? 14 : 9;
          for (let i = 0; i < cnt; i += 1) {
            const k = frac(activeU * 1.12 + i / cnt);
            const ox = W * (1.08 - k * 1.22);
            const oy = H * (0.12 + ((i * 0.43) % 0.78)) + Math.sin(k * TAU * 1.5 + i) * 20 * s;
            const oal = Math.sin(k * Math.PI) * al;
            const rot = Math.sin(t * 2.8 + i) * 0.52;
            const sx = 0.35 + 0.65 * Math.abs(Math.cos(t * 3.6 + i));
            // Cast paper shadow
            f.save(); f.globalAlpha = oal * 0.32; f.translate(ox + 3.5 * s, oy + 4.8 * s); f.rotate(rot); f.scale(sx, 1);
            f.fillStyle = '#050204'; rr(f, -4.6 * s, -9.8 * s, 9.2 * s, 19.6 * s, 1.2 * s); f.fill(); f.restore();
            f.save(); f.globalAlpha = oal; f.translate(ox, oy); f.rotate(rot); f.scale(sx, 1);
            const pGr = f.createLinearGradient(-4.5 * s, -9.5 * s, 4.5 * s, 9.5 * s);
            pGr.addColorStop(0, '#fff9ee'); pGr.addColorStop(0.65, '#f2dfbe'); pGr.addColorStop(1, '#c8a87e');
            f.fillStyle = pGr; f.strokeStyle = '#d4422a'; f.lineWidth = 1.0 * s;
            rr(f, -4.5 * s, -9.6 * s, 9.0 * s, 19.2 * s, 1.2 * s); f.fill(); f.stroke();
            f.strokeStyle = '#c42e18'; f.lineWidth = 1.1 * s; f.lineCap = 'round';
            f.beginPath();
            f.moveTo(-2 * s, -5.5 * s); f.lineTo(2 * s, -5.5 * s);
            f.moveTo(0, -6.5 * s); f.lineTo(0, 6.2 * s);
            f.moveTo(-2.2 * s, 0.5 * s); f.lineTo(2.2 * s, -1.2 * s);
            f.moveTo(-2 * s, 4 * s); f.lineTo(2 * s, 4 * s);
            f.stroke(); f.restore();
          }
        } else {
          // Sculpted 3D Lacquered Porcelain Kitsune Mask w/ cast shadow, snout shading, recessed cyan eyes & vermilion markings!
          const mr = ra * (1.08 + dissolve * 0.3);
          const maskPath = () => {
            f.beginPath();
            f.moveTo(-mr * 0.72, -mr * 0.25); f.lineTo(-mr * 0.62, -mr * 1.12); f.lineTo(-mr * 0.16, -mr * 0.62);
            f.lineTo(mr * 0.16, -mr * 0.62); f.lineTo(mr * 0.62, -mr * 1.12); f.lineTo(mr * 0.72, -mr * 0.25);
            f.quadraticCurveTo(mr * 0.76, mr * 0.45, 0, mr * 0.98);
            f.quadraticCurveTo(-mr * 0.76, mr * 0.45, -mr * 0.72, -mr * 0.25);
            f.closePath();
          };
          castShadow(f, 7.5 * s, al * 0.88, (shCol) => {
            f.save(); f.translate(cx, cy); f.fillStyle = shCol; maskPath(); f.fill(); f.restore();
          });
          f.save(); f.globalAlpha = al * 0.95; f.translate(cx, cy);
          // 3D Ceramic porcelain contour gradient (bright brow/nose bridge -> warm taupe jaw shadow)
          const mGr = f.createRadialGradient(-mr * 0.18, -mr * 0.22, mr * 0.08, 0, mr * 0.12, mr * 1.15);
          mGr.addColorStop(0, 'rgba(255,252,246,.88)');
          mGr.addColorStop(0.48, 'rgba(234,222,206,.76)');
          mGr.addColorStop(0.85, 'rgba(148,128,116,.68)');
          mGr.addColorStop(1, 'rgba(54,38,36,.78)');
          f.fillStyle = mGr; f.strokeStyle = 'rgba(255,250,242,.88)'; f.lineWidth = 1.45 * s;
          maskPath(); f.fill(); f.stroke();
          // Recessed inner ear hollows painted in deep lacquer crimson
          for (const sd of [-1, 1]) {
            f.fillStyle = 'rgba(176,42,30,.72)';
            f.beginPath();
            f.moveTo(sd * mr * 0.56, -mr * 0.96); f.lineTo(sd * mr * 0.28, -mr * 0.64); f.lineTo(sd * mr * 0.58, -mr * 0.42);
            f.closePath(); f.fill();
            // Dark recessed eye-slits + glowing cyan iridescence inside
            f.fillStyle = '#0e1620';
            f.beginPath();
            f.moveTo(sd * mr * 0.12, -mr * 0.04); f.quadraticCurveTo(sd * mr * 0.34, -mr * 0.26, sd * mr * 0.58, -mr * 0.12);
            f.quadraticCurveTo(sd * mr * 0.34, mr * 0.07, sd * mr * 0.12, -mr * 0.04); f.fill();
            f.fillStyle = `rgba(${foxCyan},.95)`;
            f.beginPath();
            f.moveTo(sd * mr * 0.18, -mr * 0.05); f.quadraticCurveTo(sd * mr * 0.34, -mr * 0.19, sd * mr * 0.5, -mr * 0.11);
            f.quadraticCurveTo(sd * mr * 0.34, mr * 0.01, sd * mr * 0.18, -mr * 0.05); f.fill();
            // Hand-painted vermilion shrine whisker marks
            f.strokeStyle = `rgba(${verm},.94)`; f.lineWidth = 1.65 * s; f.lineCap = 'round';
            f.beginPath();
            f.moveTo(sd * mr * 0.24, mr * 0.24); f.lineTo(sd * mr * 0.54, mr * 0.16);
            f.moveTo(sd * mr * 0.2, mr * 0.38); f.lineTo(sd * mr * 0.46, mr * 0.34);
            f.stroke();
          }
          f.restore();
          // Layered teardrop Kitsunebi spirit flames
          for (let i = 0; i < 8; i += 1) {
            const p = frac(activeU * 1.18 + i * 0.125);
            const fx = W * (0.12 + ((i * 0.29) % 0.78)) + Math.sin(t * 2.9 + i) * 10 * s;
            const fy = H * (0.96 - p * 0.92);
            const fal = Math.sin(p * Math.PI) * al;
            glow(f, fx, fy, 9 * s, i % 2 ? foxCyan : verm, fal * 0.54);
            f.fillStyle = `rgba(${i % 2 ? foxCyan : verm},${fal * 0.85})`;
            f.beginPath(); f.moveTo(fx, fy + 4.5 * s); f.quadraticCurveTo(fx - 4.2 * s, fy, fx, fy - 9 * s); f.quadraticCurveTo(fx + 4.2 * s, fy, fx, fy + 4.5 * s); f.fill();
            f.fillStyle = `rgba(255,254,248,${fal * 0.94})`;
            f.beginPath(); f.moveTo(fx, fy + 2 * s); f.quadraticCurveTo(fx - 1.8 * s, fy - 0.5 * s, fx, fy - 5 * s); f.quadraticCurveTo(fx + 1.8 * s, fy - 0.5 * s, fx, fy + 2 * s); f.fill();
          }
        }
      }
    };
  }, { fullCard: true });
})();
