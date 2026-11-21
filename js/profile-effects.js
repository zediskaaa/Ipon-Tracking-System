(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const R = (a, b) => a + Math.random() * (b - a);
  const frac = (x) => x - Math.floor(x);
  const sprites = Object.create(null);

  function glow(g, x, y, r, rgb, a) {
    if (!g || r <= 0 || a <= 0) return;
    let c = sprites[rgb];
    if (!c && typeof document !== 'undefined') {
      c = sprites[rgb] = document.createElement('canvas');
      c.width = c.height = 64;
      const x2 = c.getContext('2d');
      if (x2) {
        const gr = x2.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, `rgba(${rgb},1)`);
        gr.addColorStop(0.3, `rgba(${rgb},.35)`);
        gr.addColorStop(1, `rgba(${rgb},0)`);
        x2.fillStyle = gr;
        x2.fillRect(0, 0, 64, 64);
      }
    }
    if (!c) return;
    g.globalAlpha = Math.max(0, Math.min(1, a));
    g.drawImage(c, x - r, y - r, r * 2, r * 2);
    g.globalAlpha = 1;
  }

  function star4(g, x, y, r) {
    g.beginPath();
    g.moveTo(x, y - r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.quadraticCurveTo(x, y, x, y + r);
    g.quadraticCurveTo(x, y, x - r, y);
    g.quadraticCurveTo(x, y, x, y - r);
    g.fill();
  }

  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function planet(g, x, y, r, c1, c2) {
    const gr = g.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
    gr.addColorStop(0, c1);
    gr.addColorStop(1, c2);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }

  function bot(g, x, y, u, t, ph, flip) {
    g.save();
    g.translate(x, y);
    g.scale(flip, 1);
    g.rotate(Math.sin(t * 1.3 + ph) * 0.07);
    const fl = 5 + 3 * Math.abs(Math.sin(t * 30 + ph));
    glow(g, 0, u * 13, u * 9, '110,200,255', 0.45);
    let gr = g.createLinearGradient(0, u * 9, 0, u * 9 + fl * u);
    gr.addColorStop(0, 'rgba(140,220,255,.95)');
    gr.addColorStop(1, 'rgba(80,140,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(-u * 2.2, u * 9);
    g.lineTo(u * 2.2, u * 9);
    g.lineTo(0, u * 9 + fl * u);
    g.fill();
    g.fillStyle = '#c6d3e0';
    rr(g, -u * 5, u * 2, u * 10, u * 7, u * 2.5);
    g.fill();
    g.fillStyle = `rgba(91,224,255,${0.5 + 0.5 * Math.sin(t * 3 + ph)})`;
    g.fillRect(-u * 1.2, u * 4.4, u * 2.4, u * 1.2);
    g.strokeStyle = '#aebdcc';
    g.lineWidth = u * 1.8;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-u * 5, u * 4);
    g.lineTo(-u * 7.5, u * 7);
    g.stroke();
    g.save();
    g.translate(u * 5, u * 4);
    g.rotate(-0.9 + Math.sin(t * 7 + ph) * 0.5);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(u * 3.2, u * 2.2);
    g.stroke();
    g.restore();
    gr = g.createLinearGradient(0, -u * 9, 0, u * 2);
    gr.addColorStop(0, '#f2f7fb');
    gr.addColorStop(1, '#b9c8d8');
    g.fillStyle = gr;
    rr(g, -u * 7, -u * 8, u * 14, u * 10.5, u * 4);
    g.fill();
    g.fillStyle = '#0d1824';
    rr(g, -u * 5.2, -u * 5.8, u * 10.4, u * 5.4, u * 2.6);
    g.fill();
    const bl = ((t + ph) % 4) < 0.14 ? 0.15 : 1;
    g.fillStyle = '#5be0ff';
    g.beginPath();
    g.ellipse(-u * 2.3, -u * 3.1, u * 1.1, u * 1.3 * bl, 0, 0, TAU);
    g.fill();
    g.beginPath();
    g.ellipse(u * 2.3, -u * 3.1, u * 1.1, u * 1.3 * bl, 0, 0, TAU);
    g.fill();
    g.strokeStyle = '#aebdcc';
    g.lineWidth = u * 0.8;
    g.beginPath();
    g.moveTo(0, -u * 8);
    g.lineTo(0, -u * 11.5);
    g.stroke();
    const p = 0.5 + 0.5 * Math.sin(t * 4 + ph);
    glow(g, 0, -u * 12, u * 4, '255,110,140', 0.4 + 0.5 * p);
    g.fillStyle = '#ff6b8e';
    g.beginPath();
    g.arc(0, -u * 12, u * 1.2, 0, TAU);
    g.fill();
    g.restore();
  }

  function jelly(g, x, y, u, t, ph, c, tilt) {
    const p = Math.sin(t * 1.9 + ph);
    const bw = u * 9 * (1 + 0.1 * p);
    const bh = u * 7.5 * (1 - 0.16 * p);
    g.save();
    g.translate(x, y);
    g.rotate(tilt);
    g.lineCap = 'round';
    for (let i = 0; i < 7; i += 1) {
      const x0 = -bw * 0.72 + (i * bw * 1.44) / 6;
      const L = u * (15 + (i % 3) * 5);
      g.strokeStyle = `rgba(${c},${0.5 - (i % 2) * 0.18})`;
      g.lineWidth = u * (i % 3 === 1 ? 1.3 : 0.7);
      g.beginPath();
      g.moveTo(x0, bh * 0.1);
      for (let j = 1; j <= 9; j += 1) {
        const k = j / 9;
        g.lineTo(
          x0 + Math.sin(t * 1.6 - k * 4 + i * 1.3 + ph) * u * 2.4 * k + p * u * 0.6 * k * (i % 2 ? -1 : 1),
          bh * 0.1 + k * L
        );
      }
      g.stroke();
    }
    glow(g, 0, -bh * 0.2, bw * 2, c, 0.4);
    const gr = g.createLinearGradient(0, -bh * 1.3, 0, bh * 0.3);
    gr.addColorStop(0, `rgba(${c},.85)`);
    gr.addColorStop(1, `rgba(${c},.18)`);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(-bw, bh * 0.1);
    g.bezierCurveTo(-bw * 1.05, -bh * 1.7, bw * 1.05, -bh * 1.7, bw, bh * 0.1);
    g.quadraticCurveTo(bw * 0.5, bh * 0.4 + p * u * 0.4, 0, bh * 0.12);
    g.quadraticCurveTo(-bw * 0.5, bh * 0.4 + p * u * 0.4, -bw, bh * 0.1);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,.38)';
    g.lineWidth = u * 0.6;
    g.beginPath();
    g.moveTo(-bw * 0.6, -bh * 0.85);
    g.quadraticCurveTo(-bw * 0.2, -bh * 1.15, bw * 0.25, -bh * 1.05);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,.5)';
    for (let i = 0; i < 4; i += 1) {
      g.beginPath();
      g.arc(-bw * 0.45 + i * bw * 0.3, -bh * 0.35 + Math.sin(i * 2) * u, u * 0.55, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  function astro(g, x, y, u, t, rot, pf) {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.lineCap = 'round';
    const sw = Math.sin(t * 0.9);
    if (pf > 0.05) glow(g, -u * 7, u * 4, u * 6 * pf + u, '140,220,255', pf * 0.9);
    g.fillStyle = '#8d9bb0';
    rr(g, -u * 6.2, -u * 2, u * 3, u * 7, u * 1.2);
    g.fill();
    for (const d of [-1, 1]) {
      const fx = d * u * (2 + sw * d * 1.6);
      g.strokeStyle = '#dfe6ee';
      g.lineWidth = u * 3.2;
      g.beginPath();
      g.moveTo(d * u * 1.6, u * 5);
      g.quadraticCurveTo(d * u * (2.6 + sw * d * 0.8), u * 8.5, fx, u * 11.5);
      g.stroke();
      g.strokeStyle = '#8d9bb0';
      g.lineWidth = u * 3.5;
      g.beginPath();
      g.moveTo(fx, u * 10.8);
      g.lineTo(fx, u * 11.8);
      g.stroke();
    }
    g.fillStyle = '#eef2f7';
    rr(g, -u * 4.2, -u * 3, u * 8.4, u * 9, u * 3);
    g.fill();
    g.fillStyle = '#ff8a4c';
    rr(g, -u * 2, 0, u * 4, u * 2.2, u * 0.8);
    g.fill();
    g.fillStyle = '#5be0ff';
    g.fillRect(-u * 1.2, u * 0.7, u * 0.8, u * 0.8);
    g.strokeStyle = '#eef2f7';
    g.lineWidth = u * 2.6;
    g.beginPath();
    g.moveTo(-u * 3.6, -u);
    g.quadraticCurveTo(-u * 7, u * (1 + sw), -u * 7.4, u * (3.2 + sw * 2));
    g.stroke();
    g.beginPath();
    g.moveTo(u * 3.6, -u);
    g.quadraticCurveTo(u * 7.2, -u * (1 + sw), u * 8, -u * (3 + sw * 1.5));
    g.stroke();
    let gr = g.createRadialGradient(-u * 2, -u * 8, u, 0, -u * 6, u * 6.5);
    gr.addColorStop(0, '#fff');
    gr.addColorStop(1, '#c3cedb');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, -u * 6, u * 5.2, 0, TAU);
    g.fill();
    gr = g.createLinearGradient(-u * 3, -u * 8, u * 3, -u * 3);
    gr.addColorStop(0, '#27406b');
    gr.addColorStop(1, '#0b1226');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(u * 0.3, -u * 5.8, u * 3.5, u * 2.9, 0, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(160,210,255,.55)';
    g.beginPath();
    g.ellipse(-u * 1.1, -u * 7, u * 1.2, u * 0.7, -0.5, 0, TAU);
    g.fill();
    g.restore();
  }

  const GL = [
    [[0, -1, 0, 1], [0, -0.2, 0.6, -0.7]],
    [[-0.6, -1, 0, 0], [0, 0, 0.6, -1], [0, 0, 0, 1]],
    [[-0.6, 1, 0, -1], [0, -1, 0.6, 1], [-0.4, 0.3, 0.4, 0.3]],
    [[-0.6, -1, -0.6, 1], [-0.6, -1, 0.6, 0], [0.6, 0, -0.6, 1]],
    [[0, -1, 0, 1], [-0.6, -0.4, 0.6, -0.4], [-0.6, 0.4, 0.6, 0.4]],
    [[-0.6, -1, 0.6, 1], [0.6, -1, -0.6, 1]]
  ];

  function tracePoly(g, pts, closed = true) {
    if (!pts || pts.length < 2) return;
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i += 1) g.lineTo(pts[i][0], pts[i][1]);
    if (closed) g.closePath();
  }

  function pathMetrics(pts, closed = true) {
    const cum = [0];
    let total = 0;
    const count = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < count; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      total += Math.hypot(b[0] - a[0], b[1] - a[1]);
      cum.push(total);
    }
    return { pts, cum, total: total || 1, closed };
  }

  function samplePath(m, u) {
    const uu = m.closed ? frac(u) : Math.max(0, Math.min(1, u));
    const target = uu * m.total;
    const { pts, cum } = m;
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < target) i += 1;
    const segLen = (cum[i + 1] - cum[i]) || 1;
    const k = (target - cum[i]) / segLen;
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, Math.atan2(b[1] - a[1], b[0] - a[0])];
  }

  function traceComet(g, m, headU, span, rgb, width, alpha, s, steps = 18) {
    if (!m || alpha <= 0 || span <= 0) return;
    g.lineCap = 'round';
    let prev = null;
    for (let i = 0; i <= steps; i += 1) {
      const k = i / steps;
      const u = headU - span * (1 - k);
      if (!m.closed && (u < 0 || u > 1)) {
        prev = null;
        continue;
      }
      const p = samplePath(m, u);
      if (prev) {
        g.strokeStyle = `rgba(${rgb},${alpha * k * k})`;
        g.lineWidth = Math.max(0.45 * s, width * (0.35 + 0.65 * k));
        g.beginPath();
        g.moveTo(prev[0], prev[1]);
        g.lineTo(p[0], p[1]);
        g.stroke();
      }
      prev = p;
    }
    if (m.closed || (headU >= 0 && headU <= 1)) {
      const head = samplePath(m, headU);
      glow(g, head[0], head[1], width * 3.8, rgb, alpha * 0.85);
      g.fillStyle = `rgba(255,255,255,${Math.min(1, alpha * 0.95)})`;
      g.beginPath();
      g.arc(head[0], head[1], Math.max(0.75 * s, width * 0.62), 0, TAU);
      g.fill();
    }
  }

  function leaf(g, x, y, len, wid, ang, c1, c2, veinAlpha = 0.45) {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    const gr = g.createLinearGradient(0, 0, len, 0);
    gr.addColorStop(0, c1);
    gr.addColorStop(1, c2);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(len * 0.45, -wid, len, 0);
    g.quadraticCurveTo(len * 0.45, wid, 0, 0);
    g.closePath();
    g.fill();
    if (veinAlpha > 0) {
      g.strokeStyle = `rgba(255,250,230,${veinAlpha})`;
      g.lineWidth = Math.max(0.45, wid * 0.16);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(len * 0.1, 0);
      g.lineTo(len * 0.82, 0);
      g.stroke();
    }
    g.restore();
  }

  function paw(g, x, y, r, ang, rgb, a) {
    if (a <= 0.01) return;
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    glow(g, 0, 0, r * 2.4, rgb, a * 0.35);
    g.fillStyle = `rgba(${rgb},${a})`;
    g.beginPath();
    g.moveTo(0, -r * 0.25);
    g.bezierCurveTo(r * 0.62, -r * 0.28, r * 0.78, r * 0.48, r * 0.36, r * 0.66);
    g.quadraticCurveTo(0, r * 0.52, -r * 0.36, r * 0.66);
    g.bezierCurveTo(-r * 0.78, r * 0.48, -r * 0.62, -r * 0.28, 0, -r * 0.25);
    g.closePath();
    g.fill();
    const toes = [
      [-0.64, -0.42, 0.22, 0.3, -0.35],
      [-0.22, -0.78, 0.23, 0.33, -0.1],
      [0.22, -0.78, 0.23, 0.33, 0.1],
      [0.64, -0.42, 0.22, 0.3, 0.35]
    ];
    for (const [tx, ty, rx, ry, rot] of toes) {
      g.beginPath();
      g.ellipse(tx * r, ty * r, rx * r, ry * r, rot, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  function ecgWave(u) {
    const x = frac(u);
    if (x < 0.22 || x > 0.78) return 0;
    if (x < 0.32) return 0.14 * Math.sin(((x - 0.22) / 0.1) * Math.PI);
    if (x < 0.39) return 0;
    if (x < 0.43) return -0.22 * Math.sin(((x - 0.39) / 0.04) * Math.PI);
    if (x < 0.49) return 1.0 * Math.sin(((x - 0.43) / 0.06) * Math.PI);
    if (x < 0.54) return -0.36 * Math.sin(((x - 0.49) / 0.05) * Math.PI);
    if (x < 0.62) return 0;
    return 0.24 * Math.sin(((x - 0.62) / 0.16) * Math.PI);
  }

  function sparkle(g, x, y, r, rgb, a) {
    if (a <= 0.01) return;
    glow(g, x, y, r * 3.1, rgb, a * 0.62);
    g.fillStyle = `rgba(255,252,240,${Math.min(1, a)})`;
    star4(g, x, y, r);
  }

  function cardFrameMetrics(W, H, inset, rad) {
    const x0 = inset;
    const y0 = inset;
    const x1 = W - inset;
    const y1 = H - inset;
    const r = Math.max(4, Math.min(rad, (x1 - x0) * 0.25, (y1 - y0) * 0.25));
    const pts = [];
    const arcCorner = (cx0, cy0, a0, a1) => {
      for (let i = 0; i <= 5; i += 1) {
        const a = a0 + (i / 5) * (a1 - a0);
        pts.push([cx0 + Math.cos(a) * r, cy0 + Math.sin(a) * r]);
      }
    };
    arcCorner(x1 - r, y0 + r, -Math.PI / 2, 0);
    arcCorner(x1 - r, y1 - r, 0, Math.PI / 2);
    arcCorner(x0 + r, y1 - r, Math.PI / 2, Math.PI);
    arcCorner(x0 + r, y0 + r, Math.PI, Math.PI * 1.5);
    return { pts, m: pathMetrics(pts, true), x0, y0, x1, y1, r };
  }

  function drawCardCorners(g, W, H, inset, len, rgb, lw, a, style = 'bracket') {
    const x0 = inset;
    const y0 = inset;
    const x1 = W - inset;
    const y1 = H - inset;
    g.strokeStyle = `rgba(${rgb},${a})`;
    g.lineWidth = lw;
    g.lineCap = 'round';
    const corners = [
      [x0, y0, 1, 1],
      [x1, y0, -1, 1],
      [x1, y1, -1, -1],
      [x0, y1, 1, -1]
    ];
    for (const [cx0, cy0, sx, sy] of corners) {
      g.beginPath();
      if (style === 'chamfer') {
        const ch = len * 0.42;
        g.moveTo(cx0 + sx * len, cy0);
        g.lineTo(cx0 + sx * ch, cy0);
        g.lineTo(cx0, cy0 + sy * ch);
        g.lineTo(cx0, cy0 + sy * len);
      } else if (style === 'arc') {
        g.moveTo(cx0 + sx * len, cy0);
        g.quadraticCurveTo(cx0, cy0, cx0, cy0 + sy * len);
      } else if (style === 'double') {
        g.moveTo(cx0 + sx * len, cy0);
        g.lineTo(cx0, cy0);
        g.lineTo(cx0, cy0 + sy * len);
        g.moveTo(cx0 + sx * (len * 0.62), cy0 + sy * 4);
        g.lineTo(cx0 + sx * 4, cy0 + sy * 4);
        g.lineTo(cx0 + sx * 4, cy0 + sy * (len * 0.62));
      } else {
        g.moveTo(cx0 + sx * len, cy0);
        g.lineTo(cx0, cy0);
        g.lineTo(cx0, cy0 + sy * len);
      }
      g.stroke();
    }
  }

  function drawFullCardAura(b, f, frame, rgb1, rgb2, s, t, style = 'arc') {
    if (!frame) return;
    b.strokeStyle = `rgba(${rgb1},.24)`;
    b.lineWidth = 1.05 * s;
    tracePoly(b, frame.pts, true);
    b.stroke();
    drawCardCorners(f, frame.x1 + frame.x0, frame.y1 + frame.y0, frame.x0 + 2 * s, 14 * s, rgb2, 1.25 * s, 0.56, style);
    const u = frac(t * 0.085);
    traceComet(f, frame.m, u, 0.14, rgb1, 1.35 * s, 0.72, s, 18);
    traceComet(f, frame.m, frac(u + 0.5), 0.12, rgb2, 1.15 * s, 0.58, s, 16);
  }

  function drawCoin(g, x, y, r, spin, tilt, alpha = 1) {
    if (alpha <= 0.02 || r <= 0.5) return;
    const c = Math.cos(spin);
    const sx = Math.max(0.16, Math.abs(c));
    const edge = (1 - sx) * r * 0.34 * (c >= 0 ? 1 : -1);
    g.save();
    g.globalAlpha = Math.max(0, Math.min(1, alpha));
    g.translate(x, y);
    g.rotate(tilt);
    glow(g, 0, 0, r * 2.1, '248,214,122', alpha * 0.32);
    // Extruded milled gold edge
    g.fillStyle = '#b47f20';
    g.beginPath();
    g.ellipse(edge, 0, r * sx, r, 0, 0, TAU);
    g.fill();
    // Main coin face
    const gr = g.createLinearGradient(-r * sx, -r, r * sx, r);
    gr.addColorStop(0, '#fff5c8');
    gr.addColorStop(0.45, '#f2ca65');
    gr.addColorStop(1, '#c58f2b');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(0, 0, r * sx, r, 0, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(255,248,215,.72)';
    g.lineWidth = Math.max(0.6, r * 0.09);
    g.stroke();
    // Inner mint ring & embossed peso mark when facing viewer
    if (sx > 0.36) {
      g.strokeStyle = 'rgba(150,100,18,.55)';
      g.lineWidth = Math.max(0.5, r * 0.07);
      g.beginPath();
      g.ellipse(0, 0, r * 0.74 * sx, r * 0.74, 0, 0, TAU);
      g.stroke();
      g.save();
      g.scale(sx, 1);
      g.fillStyle = 'rgba(130,82,12,.85)';
      g.font = `700 ${Math.max(5, Math.round(r * 1.05))}px Arial,sans-serif`;
      g.fillText('₱', -r * 0.32, r * 0.37);
      g.restore();
    }
    g.restore();
  }

  const FX = Object.create(null);
  const EFFECTS = [];
  function def(id, name, cat, desc, rare, make, opts = {}) {
    const fullCard = Boolean(opts && opts.fullCard);
    const cardFrame = Array.isArray(opts?.cardFrame) ? opts.cardFrame : null;
    const entry = { id, name, cat, desc, rare, fullCard, cardFrame, make };
    FX[id] = entry;
    EFFECTS.push({ id, name, cat, desc, rare, fullCard });
  }

  def('stardust', 'Stardust', 'Cosmic', 'Twinkling stars and passing comets drift across your profile.', 0, (S) => {
    const { W, H, cx, cy, ra, s, b, f } = S;
    const stars = Array.from({ length: Math.max(10, Math.round((W * H) / 2400)) }, () => ({
      x: R(0, W), y: R(0, H), z: R(0.35, 1), p: R(0, TAU), v: R(0.8, 2.4),
      c: Math.random() < 0.25 ? '170,200,255' : '255,255,255'
    }));
    const sp = Array.from({ length: 5 }, (_, i) => ({
      a: (i / 5) * TAU + R(0, 0.6), k: R(1.3, 1.8), p: R(0, TAU), z: R(3, 5.5)
    }));
    let sh = null;
    let next = 1.5;
    return (t, dt) => {
      for (const q of stars) {
        const x = (q.x + t * 5 * q.z * s) % W;
        const a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * q.v + q.p));
        b.fillStyle = `rgba(${q.c},${a * q.z})`;
        b.beginPath();
        b.arc(x, q.y, (0.5 + q.z * 0.9) * s, 0, TAU);
        b.fill();
      }
      if (!sh && t > next) {
        sh = { x: R(W * 0.5, W), y: R(0, H * 0.3), vx: -R(240, 320) * s, vy: R(90, 140) * s, l: 0 };
      }
      if (sh) {
        sh.l += dt;
        sh.x += sh.vx * dt;
        sh.y += sh.vy * dt;
        const tx = sh.x - sh.vx * 0.18;
        const ty = sh.y - sh.vy * 0.18;
        const g = b.createLinearGradient(sh.x, sh.y, tx, ty);
        g.addColorStop(0, 'rgba(255,255,255,.95)');
        g.addColorStop(1, 'rgba(160,190,255,0)');
        b.strokeStyle = g;
        b.lineWidth = 1.6 * s;
        b.lineCap = 'round';
        b.beginPath();
        b.moveTo(sh.x, sh.y);
        b.lineTo(tx, ty);
        b.stroke();
        glow(b, sh.x, sh.y, 7 * s, '200,220,255', 0.8);
        if (sh.l > 1.3 || sh.x < -20) {
          sh = null;
          next = t + R(2.5, 5);
        }
      }
      f.fillStyle = '#fff';
      for (const q of sp) {
        const a = 0.2 + 0.8 * Math.max(0, Math.sin(t * 1.6 + q.p));
        const r = ra * q.k;
        f.globalAlpha = a;
        star4(f, cx + Math.cos(q.a) * r, cy + Math.sin(q.a) * r * 0.8, q.z * s * (0.6 + 0.6 * a));
      }
      f.globalAlpha = 1;
    };
  });

  def('orbit', 'Orbit', 'Cosmic', 'A ringed planet and its moon circle your avatar.', 0, (S) => {
    const { cx, cy, ra, s, b, f } = S;
    const P = [
      { a: 1.62, e: 0.36, tilt: -0.38, sp: 0.55, r: 9, c1: '#9cc8ff', c2: '#2a3f9c', ring: 1, moon: 1, ph: 0 },
      { a: 2.0, e: 0.3, tilt: 0.3, sp: -0.33, r: 5.6, c1: '#ffc08a', c2: '#8a3a1f', ring: 0, moon: 0, ph: 2 }
    ];
    return (t) => {
      for (const p of P) {
        const A = ra * p.a;
        const B = A * p.e;
        const cs = Math.cos(p.tilt);
        const sn = Math.sin(p.tilt);
        b.strokeStyle = 'rgba(160,190,255,.16)';
        b.lineWidth = s;
        b.setLineDash([3 * s, 5 * s]);
        b.beginPath();
        b.ellipse(cx, cy, A, B, p.tilt, 0, TAU);
        b.stroke();
        b.setLineDash([]);
        const th = t * p.sp + p.ph;
        const ex = A * Math.cos(th);
        const ey = B * Math.sin(th);
        const x = cx + ex * cs - ey * sn;
        const y = cy + ex * sn + ey * cs;
        const g = Math.sin(th) > 0 ? f : b;
        const r = p.r * s * (1 + 0.18 * Math.sin(th));
        glow(g, x, y, r * 3, '140,180,255', 0.3);
        if (p.ring) {
          g.save();
          g.translate(x, y);
          g.rotate(-0.35 + p.tilt);
          g.strokeStyle = 'rgba(230,220,255,.7)';
          g.lineWidth = 1.2 * s;
          g.beginPath();
          g.ellipse(0, 0, r * 1.9, r * 0.55, 0, Math.PI, TAU);
          g.stroke();
          g.restore();
        }
        let mx = 0;
        let my = 0;
        let mb = false;
        if (p.moon) {
          const mt = t * 2.2;
          mx = x + Math.cos(mt) * r * 2.7;
          my = y + Math.sin(mt) * r * 0.9;
          mb = Math.sin(mt) < 0;
          if (mb) planet(g, mx, my, r * 0.34, '#fff', '#8a93a8');
        }
        planet(g, x, y, r, p.c1, p.c2);
        if (p.ring) {
          g.save();
          g.translate(x, y);
          g.rotate(-0.35 + p.tilt);
          g.strokeStyle = 'rgba(230,220,255,.8)';
          g.lineWidth = 1.2 * s;
          g.beginPath();
          g.ellipse(0, 0, r * 1.9, r * 0.55, 0, 0, Math.PI);
          g.stroke();
          g.restore();
        }
        if (p.moon && !mb) planet(g, mx, my, r * 0.34, '#fff', '#8a93a8');
      }
    };
  });

  def('butterflies', 'Neon Butterflies', 'Animal', 'Glowing butterflies flutter in loose loops around you.', 0, (S) => {
    const { cx, cy, ra, s, f } = S;
    const B = [
      { ph: 0, sp: 0.55, c: '90,230,255', c2: '60,120,255', k: 1 },
      { ph: 2.1, sp: 0.43, c: '255,120,220', c2: '150,80,255', k: 0.85 },
      { ph: 4.2, sp: 0.5, c: '150,255,190', c2: '60,200,170', k: 0.72 }
    ];
    const pos = (u, q) => [cx + ra * 1.55 * Math.sin(u) + ra * 0.35 * Math.sin(u * 2.7 + q), cy - ra * 0.1 + ra * 0.9 * Math.sin(u * 1.3 + q)];
    return (t) => {
      for (const q of B) {
        const u = t * q.sp + q.ph;
        const [x, y] = pos(u, q.ph);
        const [x2, y2] = pos(u + 0.03, q.ph);
        const ang = Math.atan2(y2 - y, x2 - x) + Math.PI / 2;
        const fl = Math.abs(Math.cos(t * (9 + q.ph))) * 0.85 + 0.15;
        const z = q.k * s * 11;
        glow(f, x, y, z * 2.2, q.c, 0.35);
        f.save();
        f.translate(x, y);
        f.rotate(ang);
        for (const sd of [-1, 1]) {
          f.save();
          f.scale(sd * fl, 1);
          f.strokeStyle = 'rgba(255,255,255,.65)';
          f.lineWidth = 0.7 * s;
          f.fillStyle = `rgba(${q.c},.8)`;
          f.beginPath();
          f.ellipse(z * 0.55, -z * 0.35, z * 0.55, z * 0.85, -0.5, 0, TAU);
          f.fill();
          f.stroke();
          f.fillStyle = `rgba(${q.c2},.75)`;
          f.beginPath();
          f.ellipse(z * 0.4, z * 0.55, z * 0.38, z * 0.55, 0.5, 0, TAU);
          f.fill();
          f.stroke();
          f.restore();
        }
        f.fillStyle = '#fff';
        f.beginPath();
        f.ellipse(0, 0, z * 0.1, z * 0.55, 0, 0, TAU);
        f.fill();
        f.restore();
      }
    };
  });

  def('koi', 'Aurora Koi', 'Animal', 'Two glowing koi glide through ripples around your avatar.', 0, (S) => {
    const { cx, cy, ra, s, b } = S;
    const N = 16;
    const K = [
      { d: 1, ph: 0, c: '255,160,90', a: 1.62, e: 0.78 },
      { d: -1, ph: 3.4, c: '120,210,255', a: 1.95, e: 0.7 }
    ];
    return (t) => {
      for (let i = 0; i < 2; i += 1) {
        const r = (t * 0.5 + i * 0.5) % 1;
        b.strokeStyle = `rgba(150,210,255,${0.35 * (1 - r)})`;
        b.lineWidth = 1.2 * s;
        b.beginPath();
        b.ellipse(cx, cy, ra * (1.05 + r * 1.2), ra * (1.05 + r * 1.2) * 0.8, 0, 0, TAU);
        b.stroke();
      }
      for (const k of K) {
        const A = ra * k.a;
        const Bb = A * k.e;
        const pts = [];
        for (let i = 0; i <= N; i += 1) {
          const th = t * 0.55 * k.d + k.ph - k.d * i * 0.055;
          const x = cx + A * Math.cos(th);
          const y = cy + Bb * Math.sin(th);
          let tx = -A * Math.sin(th) * k.d;
          let ty = Bb * Math.cos(th) * k.d;
          const m = Math.hypot(tx, ty) || 1;
          tx /= m;
          ty /= m;
          const w = Math.sin(t * 5.5 - i * 0.6) * (0.4 + i * 0.28) * s;
          pts.push([x - ty * w, y + tx * w]);
        }
        glow(b, pts[0][0], pts[0][1], 14 * s, k.c, 0.3);
        b.lineCap = 'round';
        for (let i = 0; i < N; i += 1) {
          b.strokeStyle = `rgba(${k.c},${0.95 - i * 0.02})`;
          b.lineWidth = s * (5.4 * Math.sin((Math.PI * (i + 1.2)) / (N + 3.2)) + 0.5);
          b.beginPath();
          b.moveTo(pts[i][0], pts[i][1]);
          b.lineTo(pts[i + 1][0], pts[i + 1][1]);
          b.stroke();
        }
        const e = pts[N];
        const e0 = pts[N - 2];
        const dx = e[0] - e0[0];
        const dy = e[1] - e0[1];
        const m = Math.hypot(dx, dy) || 1;
        const ux = dx / m;
        const uy = dy / m;
        b.fillStyle = `rgba(${k.c},.75)`;
        b.beginPath();
        b.moveTo(e[0], e[1]);
        b.lineTo(e[0] + ux * 9 * s - uy * 5 * s, e[1] + uy * 9 * s + ux * 5 * s);
        b.lineTo(e[0] + ux * 5 * s, e[1] + uy * 5 * s);
        b.lineTo(e[0] + ux * 9 * s + uy * 5 * s, e[1] + uy * 9 * s - ux * 5 * s);
        b.closePath();
        b.fill();
        b.fillStyle = '#10202a';
        b.beginPath();
        b.arc(pts[0][0], pts[0][1], 0.9 * s, 0, TAU);
        b.fill();
      }
    };
  });

  def('robots', 'Mini Bots', 'Robot & Cyber', 'Two tiny hover-bots wave, blink and bob beside your avatar.', 0, (S) => {
    const { cx, cy, ra, s, f } = S;
    return (t) => {
      bot(f, cx + ra * 1.55 + Math.sin(t * 0.9) * 3 * s, cy - ra * 0.8 + Math.sin(t * 1.7) * 4 * s, 1.4 * s, t, 0, 1);
      bot(f, cx - ra * 1.42 + Math.sin(t * 0.7 + 1) * 3 * s, cy + ra * 0.5 + Math.sin(t * 1.4 + 2) * 3.5 * s, 0.95 * s, t, 1.7, -1);
    };
  });

  def('drones', 'Patrol Drones', 'Robot & Cyber', 'Scout drones circle and sweep your avatar with scan beams.', 0, (S) => {
    const { cx, cy, ra, s, b, f } = S;
    const D = [{ ph: 0, c: '90,230,255' }, { ph: Math.PI, c: '255,140,120' }];
    return (t) => {
      const sc = 0.5 + 0.5 * Math.sin(t * 2);
      b.strokeStyle = `rgba(90,230,255,${0.12 + 0.2 * sc})`;
      b.lineWidth = 1.2 * s;
      b.beginPath();
      b.arc(cx, cy, ra * (1.08 + 0.06 * sc), 0, TAU);
      b.stroke();
      for (const d of D) {
        const th = t * 0.6 + d.ph;
        const x = cx + Math.cos(th) * ra * 1.7;
        const y = cy - ra * 0.55 + Math.sin(th) * ra * 0.5;
        const a = Math.atan2(cy - y, cx - x);
        const L = Math.hypot(cx - x, cy - y);
        const sp = 0.22 + 0.06 * Math.sin(t * 3);
        const g = b.createRadialGradient(x, y, 0, x, y, L);
        g.addColorStop(0, `rgba(${d.c},.4)`);
        g.addColorStop(1, `rgba(${d.c},0)`);
        b.fillStyle = g;
        b.beginPath();
        b.moveTo(x, y);
        b.arc(x, y, L, a - sp, a + sp);
        b.closePath();
        b.fill();
        f.save();
        f.translate(x, y);
        f.scale(1.55, 1.55);
        f.rotate(Math.sin(t * 1.4 + d.ph) * 0.1);
        f.strokeStyle = '#8fa2b6';
        f.lineWidth = 1.3 * s;
        f.beginPath();
        f.moveTo(-8 * s, -2 * s);
        f.lineTo(8 * s, -2 * s);
        f.stroke();
        for (const sx of [-8, 8]) {
          f.fillStyle = `rgba(200,225,255,${0.25 + 0.35 * Math.abs(Math.cos(t * 38 + sx))})`;
          f.beginPath();
          f.ellipse(sx * s, -3 * s, 5 * s, 1 * s, 0, 0, TAU);
          f.fill();
        }
        f.fillStyle = '#2a3643';
        rr(f, -5 * s, -3 * s, 10 * s, 6 * s, 2.5 * s);
        f.fill();
        f.fillStyle = `rgba(${d.c},.95)`;
        rr(f, -3 * s, -0.8 * s, 6 * s, 1.8 * s, 0.9 * s);
        f.fill();
        const on = Math.sin(t * 6 + d.ph) > 0;
        glow(f, -4.5 * s, 2.5 * s, 5 * s, on ? '255,90,90' : '90,255,160', on ? 0.8 : 0.3);
        f.restore();
      }
    };
  });

  def('holo', 'Holo Rings', 'Sci-Fi', 'Tilted holographic rings with data nodes rotate around you.', 0, (S) => {
    const { cx, cy, ra, s, b, f } = S;
    const rings = [
      { k: 1.5, ax: 1.15, rz: -0.4, sp: 0.6, c: '90,230,255', dash: [2, 5] },
      { k: 1.85, ax: 1.28, rz: 0.5, sp: -0.4, c: '255,110,230', dash: [8, 4] },
      { k: 2.15, ax: 1.38, rz: -1.1, sp: 0.3, c: '120,255,200', dash: [1, 6] }
    ];
    return (t) => {
      for (const r of rings) {
        const A = ra * r.k;
        const Bk = A * Math.abs(Math.cos(r.ax + Math.sin(t * 0.5 + r.k) * 0.12));
        for (const [g, a0, a1] of [[b, Math.PI, TAU], [f, 0, Math.PI]]) {
          g.strokeStyle = `rgba(${r.c},${g === f ? 0.85 : 0.4})`;
          g.lineWidth = 1.3 * s;
          g.setLineDash(r.dash.map((v) => v * s));
          g.lineDashOffset = -t * r.sp * 40 * s;
          g.beginPath();
          g.ellipse(cx, cy, A, Bk, r.rz, a0, a1);
          g.stroke();
          g.setLineDash([]);
        }
        const th = t * r.sp * 1.8;
        const ex = A * Math.cos(th);
        const ey = Bk * Math.sin(th);
        const x = cx + ex * Math.cos(r.rz) - ey * Math.sin(r.rz);
        const y = cy + ex * Math.sin(r.rz) + ey * Math.cos(r.rz);
        const g = Math.sin(th) > 0 ? f : b;
        glow(g, x, y, 8 * s, r.c, 0.9);
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(x, y, 1.5 * s, 0, TAU);
        g.fill();
      }
      const sy = cy - ra + ((t * 0.5) % 1) * ra * 2;
      const hw = Math.sqrt(Math.max(0, ra * ra - (sy - cy) ** 2));
      f.strokeStyle = 'rgba(120,240,255,.55)';
      f.lineWidth = 1.2 * s;
      f.beginPath();
      f.moveTo(cx - hw, sy);
      f.lineTo(cx + hw, sy);
      f.stroke();
    };
  });

  def('glitch', 'Glitch Stream', 'Sci-Fi', 'Digital rain and signal glitches ripple through the banner.', 0, (S) => {
    const { W, H, cx, cy, ra, s, b, f } = S;
    const cols = Array.from({ length: Math.max(8, Math.floor(W / (9 * s))) }, (_, i) => ({
      x: i * 9 * s + 4 * s, y: R(-H, H * 0.6), v: R(18, 48) * s, len: Math.floor(R(3, 8)),
      c: Math.random() < 0.3 ? '255,90,220' : '90,240,230'
    }));
    let gl = 0;
    let nextG = 1.2;
    let seed = 0.37;
    return (t, dt) => {
      b.font = `${7 * s}px ui-monospace,Menlo,monospace`;
      for (const c of cols) {
        c.y += c.v * dt;
        if (c.y - c.len * 8 * s > H * 0.95) c.y = R(-40, 0) * s;
        for (let j = 0; j < c.len; j += 1) {
          const y = c.y - j * 8 * s;
          if (y < 0 || y > H) continue;
          b.fillStyle = `rgba(${c.c},${(1 - j / c.len) * 0.55})`;
          b.fillText(Math.sin(c.x * 13 + j * 7 + Math.floor(t * 3 + c.x)) > 0 ? '1' : '0', c.x, y);
        }
      }
      if (t > nextG && gl <= 0) {
        gl = 0.28;
        nextG = t + R(2, 4);
        seed = Math.random();
      }
      if (gl > 0) {
        gl -= dt;
        for (let i = 0; i < 4; i += 1) {
          const y = frac(seed * 7 + i * 0.29) * H * 0.8;
          const h = (3 + frac(seed * 13 + i) * 8) * s;
          const o = (frac(seed * 31 + i) - 0.5) * 14 * s;
          f.fillStyle = 'rgba(255,60,200,.26)';
          f.fillRect(o, y, W * 0.6, h);
          f.fillStyle = 'rgba(60,240,255,.26)';
          f.fillRect(W * 0.4 - o, y + h * 0.6, W * 0.6, h * 0.7);
        }
      }
      const q = ra * 1.3;
      const L = 7 * s;
      f.strokeStyle = `rgba(120,240,255,${0.35 + 0.3 * Math.sin(t * 2.4)})`;
      f.lineWidth = 1.3 * s;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = cx + sx * q;
        const y = cy + sy * q;
        f.beginPath();
        f.moveTo(x - sx * L, y);
        f.lineTo(x, y);
        f.lineTo(x, y - sy * L);
        f.stroke();
      }
    };
  });

  def('fireflies', 'Firefly Grove', 'Nature', 'Soft fireflies wander and blink in the dark.', 0, (S) => {
    const { W, H, s, b, f } = S;
    const F = Array.from({ length: Math.max(10, Math.round((W * H) / 2600) + 6) }, () => ({
      x: R(0, W), y: R(0, H * 0.95), ax: R(8, 26), ay: R(6, 18), fx: R(0.2, 0.6), fy: R(0.2, 0.6),
      p: R(0, TAU), bl: R(0.8, 1.8), z: Math.random() < 0.35
    }));
    return (t) => {
      for (const q of F) {
        const x = q.x + Math.sin(t * q.fx + q.p) * q.ax * s + Math.sin(t * q.fy * 2.3 + q.p) * 6 * s;
        const y = q.y + Math.cos(t * q.fy + q.p) * q.ay * s;
        const a = Math.pow(0.5 + 0.5 * Math.sin(t * q.bl + q.p), 2.2);
        const g = q.z ? f : b;
        glow(g, x, y, 9 * s, '210,255,120', 0.75 * a);
        g.fillStyle = `rgba(255,255,210,${0.3 + 0.7 * a})`;
        g.beginPath();
        g.arc(x, y, 1.1 * s, 0, TAU);
        g.fill();
      }
    };
  });

  def('petals', 'Sakura Drift', 'Nature', 'Petals tumble through a gentle breeze around a glowing bloom.', 0, (S) => {
    const { W, H, cx, cy, ra, s, b, f } = S;
    const P = Array.from({ length: Math.max(8, Math.round((W * H) / 3200) + 4) }, () => ({
      x: R(0, W), y: R(-H * 0.2, H * 0.9), v: R(12, 24), sw: R(0, TAU), swf: R(0.6, 1.4),
      amp: R(8, 20), rot: R(0, TAU), rs: R(0.6, 1.8), sz: R(3.4, 5.6),
      c: Math.random() < 0.5 ? '255,190,210' : '255,225,235', z: Math.random() < 0.4
    }));
    return (t, dt) => {
      for (const p of P) {
        p.y += p.v * dt * s;
        if (p.y > H * 0.95) {
          p.y = -6 * s;
          p.x = R(0, W);
        }
        const x = (p.x + Math.sin(t * p.swf + p.sw) * p.amp * s + t * 5 * s) % W;
        const g = p.z ? f : b;
        g.save();
        g.translate(x, p.y);
        g.rotate(p.rot + t * p.rs);
        g.scale(1, Math.abs(Math.cos(t * p.rs * 1.7 + p.sw)) * 0.8 + 0.2);
        g.fillStyle = `rgba(${p.c},.85)`;
        g.beginPath();
        g.ellipse(0, 0, p.sz * s, p.sz * s * 0.62, 0, 0, TAU);
        g.fill();
        g.restore();
      }
      const bx = cx + ra * 0.88;
      const by = cy + ra * 0.78;
      const br = (8 + 1.2 * Math.sin(t * 1.5)) * s;
      glow(f, bx, by, br * 2.6, '255,150,200', 0.45 + 0.2 * Math.sin(t * 1.5));
      for (let i = 0; i < 8; i += 1) {
        f.save();
        f.translate(bx, by);
        f.rotate((i / 8) * TAU + t * 0.15);
        f.fillStyle = `rgba(255,${170 + i * 6},215,.88)`;
        f.beginPath();
        f.ellipse(0, -br * 0.62, br * 0.28, br * 0.62, 0, 0, TAU);
        f.fill();
        f.restore();
      }
      f.fillStyle = '#ffe9a0';
      f.beginPath();
      f.arc(bx, by, br * 0.24, 0, TAU);
      f.fill();
    };
  });

  def('singularity', 'Singularity', 'Special', 'A gravitational lens bends light as matter spirals into your avatar.', 2, (S) => {
    const { cx, cy, ra, s, b, f } = S;
    const P = Array.from({ length: 110 }, () => ({
      r: R(1.12, 2.5), th: R(0, TAU), sp: R(0.7, 1.3),
      c: Math.random() < 0.5 ? '255,170,90' : '255,230,190'
    }));
    return (t, dt) => {
      b.globalCompositeOperation = 'lighter';
      f.globalCompositeOperation = 'lighter';
      for (const p of P) {
        p.r -= dt * 0.11 * p.sp;
        if (p.r < 1.08) {
          p.r = R(2.1, 2.5);
          p.th = R(0, TAU);
        }
        p.th += (dt * p.sp * 1.9) / Math.pow(p.r, 1.5);
        const rr_ = ra * p.r;
        const tl = 0.3;
        const x0 = Math.cos(p.th) * rr_;
        const y0 = Math.sin(p.th) * rr_ * 0.34;
        const x = cx + x0 * Math.cos(tl) - y0 * Math.sin(tl);
        const y = cy + x0 * Math.sin(tl) + y0 * Math.cos(tl);
        const g = Math.sin(p.th) > 0 ? f : b;
        const a = Math.min(1, (2.5 - p.r) * 1.2 + 0.2);
        g.fillStyle = `rgba(${p.c},${0.85 * a})`;
        g.beginPath();
        g.arc(x, y, (0.8 + 0.9 / p.r) * s, 0, TAU);
        g.fill();
      }
      const pl = 0.5 + 0.5 * Math.sin(t * 1.2);
      f.strokeStyle = `rgba(255,200,140,${0.45 + 0.3 * pl})`;
      f.lineWidth = 1.4 * s;
      f.beginPath();
      f.arc(cx, cy, ra * 1.07, 0, TAU);
      f.stroke();
      glow(f, cx, cy, ra * 1.7, '255,150,70', 0.12 + 0.1 * pl);
      b.globalCompositeOperation = 'source-over';
      f.globalCompositeOperation = 'source-over';
    };
  });

  def('warp', 'Hyperdrive', 'Special', 'Starlines streak outward as your profile jumps to lightspeed.', 1, (S) => {
    const { W, H, cx, cy, ra, s, b } = S;
    const mx = Math.hypot(W, H);
    const Q = Array.from({ length: 70 }, () => ({
      a: R(0, TAU), d: R(ra * 1.05, Math.max(ra * 1.2, mx * 0.6)), v: R(0.2, 1),
      c: Math.random() < 0.3 ? '160,200,255' : '255,255,255'
    }));
    return (t, dt) => {
      const boost = 0.3 + 0.7 * Math.pow(0.5 + 0.5 * Math.sin(t * 0.9 - 1.2), 2);
      b.lineCap = 'round';
      for (const q of Q) {
        q.d += dt * (40 + q.v * 160) * s * (0.4 + boost * 2.2) * (q.d / (ra * 3) + 0.3);
        if (q.d > mx * 0.62) {
          q.d = R(ra * 1.05, ra * 1.8);
          q.a = R(0, TAU);
        }
        const len = Math.max(1, (4 + q.v * 26 * boost) * s * (q.d / (ra * 2)) * 0.8);
        const ca = Math.cos(q.a);
        const sa = Math.sin(q.a);
        const al = Math.min(1, (q.d - ra) / (ra * 0.9)) * 0.9;
        b.strokeStyle = `rgba(${q.c},${Math.max(0, al)})`;
        b.lineWidth = (0.6 + q.v * 0.9) * s;
        b.beginPath();
        b.moveTo(cx + ca * q.d, cy + sa * q.d);
        b.lineTo(cx + ca * (q.d + len), cy + sa * (q.d + len));
        b.stroke();
      }
      const r = (t * 0.45) % 1;
      b.strokeStyle = `rgba(140,190,255,${0.4 * (1 - r)})`;
      b.lineWidth = 1.4 * s;
      b.beginPath();
      b.arc(cx, cy, ra * (1.1 + r * 2.2), 0, TAU);
      b.stroke();
    };
  });

  def('jelly', 'Lumen Jelly', 'Animal', 'Two bioluminescent jellyfish pulse and trail glowing tentacles.', 1, (S) => {
    const { W, H, cx, cy, ra, s, b, f } = S;
    const ocx = Math.max(cx, ra * 1.8 + 16 * s);
    const J = [
      { ph: 0, sp: 0.32, c: '110,220,255', k: 1.25, ax: 1.8, ay: 0.85 },
      { ph: 2.6, sp: 0.24, c: '255,140,230', k: 0.85, ax: 1.7, ay: 0.7 }
    ];
    const M = Array.from({ length: 18 }, () => ({ x: R(0, W), y: R(0, H), v: R(3, 8), p: R(0, TAU) }));
    return (t, dt) => {
      for (const m of M) {
        m.y -= m.v * dt * s;
        if (m.y < -4) m.y = H + 4;
        glow(b, m.x + Math.sin(t * 0.6 + m.p) * 5 * s, m.y, 3.2 * s, '160,230,255', 0.25 + 0.25 * Math.sin(t + m.p));
      }
      J.forEach((j, i) => {
        const th = t * j.sp + j.ph;
        jelly(i ? b : f, ocx + Math.cos(th) * ra * j.ax, cy - ra * 0.15 + Math.sin(th * 1.4) * ra * j.ay, s * j.k, t, j.ph, j.c, -Math.sin(th) * j.sp * 0.5);
      });
    };
  });

  def('astro', 'Drift Astronaut', 'Cosmic', 'A tethered astronaut tumbles slowly through zero gravity.', 1, (S) => {
    const { W, H, cx, cy, ra, s, b, f } = S;
    const ocx = Math.max(cx, ra * 1.7 + 16 * s);
    const st = Array.from({ length: Math.max(8, Math.round((W * H) / 3000)) }, () => ({ x: R(0, W), y: R(0, H), p: R(0, TAU), z: R(0.3, 1) }));
    return (t) => {
      for (const q of st) {
        b.fillStyle = `rgba(255,255,255,${(0.2 + 0.5 * (0.5 + 0.5 * Math.sin(t * 1.3 + q.p))) * q.z})`;
        b.beginPath();
        b.arc(q.x, q.y, 0.8 * s * q.z, 0, TAU);
        b.fill();
      }
      const x = ocx + Math.cos(t * 0.23) * ra * 1.7;
      const y = cy - ra * 0.25 + Math.sin(t * 0.37) * ra * 0.75;
      const rot = Math.sin(t * 0.45) * 0.55 + Math.sin(t * 0.17) * 0.3;
      b.strokeStyle = 'rgba(220,230,245,.6)';
      b.lineWidth = 1.1 * s;
      b.beginPath();
      b.moveTo(cx, cy);
      b.quadraticCurveTo((cx + x) / 2, (cy + y) / 2 + ra * 0.4 + Math.sin(t * 0.8) * ra * 0.1, x, y);
      b.stroke();
      astro(f, x, y, s * 1.5, t, rot, Math.pow(Math.max(0, Math.sin(t * 1.1)), 10));
    };
  });

  def('constellation', 'Lyra Chart', 'Cosmic', 'A star chart draws itself line by line, then dissolves into the dark.', 0, (S) => {
    const { W, H, s, b } = S;
    const N = [[0.36, 0.72], [0.44, 0.3], [0.56, 0.14], [0.66, 0.38], [0.8, 0.2], [0.9, 0.5], [0.74, 0.7]].map(([x, y]) => [x * W, y * H]);
    const E = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [3, 6]];
    const D = Array.from({ length: Math.max(10, Math.round((W * H) / 1800)) }, () => ({ x: R(0, W), y: R(0, H), p: R(0, TAU) }));
    return (t) => {
      b.fillStyle = '#fff';
      for (const q of D) {
        b.globalAlpha = 0.1 + 0.25 * (0.5 + 0.5 * Math.sin(t * 0.9 + q.p));
        b.beginPath();
        b.arc(q.x, q.y, 0.7 * s, 0, TAU);
        b.fill();
      }
      const ph = (t % 11) / 11;
      const dr = Math.min(1, ph / 0.5) * E.length;
      const fd = ph > 0.78 ? 1 - (ph - 0.78) / 0.22 : 1;
      b.lineCap = 'round';
      E.forEach(([i, j], k) => {
        const sg = Math.max(0, Math.min(1, dr - k));
        if (!sg) return;
        const a = N[i];
        const c = N[j];
        const x = a[0] + (c[0] - a[0]) * sg;
        const y = a[1] + (c[1] - a[1]) * sg;
        b.globalAlpha = 0.55 * fd;
        b.strokeStyle = '#bfd6ff';
        b.lineWidth = s;
        b.beginPath();
        b.moveTo(a[0], a[1]);
        b.lineTo(x, y);
        b.stroke();
        if (sg < 1) glow(b, x, y, 6 * s, '190,215,255', 0.8 * fd);
      });
      N.forEach(([x, y], k) => {
        if (dr < Math.max(0, k - 0.001) || dr === 0) return;
        const fl = Math.max(0, 1 - (dr - k) * 1.5);
        const tw = 0.75 + 0.25 * Math.sin(t * 2 + k * 2);
        glow(b, x, y, (6 + fl * 8) * s, '190,215,255', (0.4 + fl * 0.5) * fd);
        b.globalAlpha = fd * tw;
        b.fillStyle = '#fff';
        star4(b, x, y, (2.4 + fl * 2) * s);
      });
      b.globalAlpha = 1;
    };
  });

  def('sigil', 'Arcane Sigil', 'Magic', 'A runic circle turns beneath you, shedding embers into the air.', 2, (S) => {
    const { cx, cy, ra, s, b, f } = S;
    const y0 = cy + ra * 0.98;
    const sq = 0.34;
    const gold = '255,215,130';
    const vio = '190,140,255';
    const E = Array.from({ length: 26 }, () => ({ a: R(0, TAU), r: R(0.3, 1.7), h: R(0, 1), v: R(0.3, 0.7), z: R(0.8, 1.6) }));
    const Z = Math.max(0.45, Math.min(1, (cx - 4 * s) / (ra * 2.1)));
    const P = (a, k) => [cx + Math.cos(a) * ra * Z * k, y0 + Math.sin(a) * ra * Z * k * sq];
    const ring = (k, w, al, c) => {
      b.strokeStyle = `rgba(${c},${al})`;
      b.lineWidth = w * s;
      b.beginPath();
      b.ellipse(cx, y0, ra * Z * k, ra * Z * k * sq, 0, 0, TAU);
      b.stroke();
    };
    return (t, dt) => {
      b.save();
      b.translate(cx, y0);
      b.scale(1, 0.45);
      glow(b, 0, 0, ra * 2.4, vio, 0.28 + 0.08 * Math.sin(t * 1.4));
      b.restore();
      ring(2.1, 1.4, 0.8, gold);
      ring(1.95, 0.8, 0.5, vio);
      ring(1.35, 0.8, 0.5, gold);
      b.strokeStyle = `rgba(${gold},.5)`;
      b.lineWidth = 0.9 * s;
      b.beginPath();
      for (let i = 0; i < 48; i += 1) {
        const a = (i / 48) * TAU + t * 0.1;
        const p1 = P(a, 1.95);
        const p2 = P(a, i % 4 ? 1.88 : 1.8);
        b.moveTo(p1[0], p1[1]);
        b.lineTo(p2[0], p2[1]);
      }
      b.stroke();
      for (let t3 = 0; t3 < 2; t3 += 1) {
        b.strokeStyle = `rgba(${gold},.55)`;
        b.lineWidth = s;
        b.beginPath();
        for (let j = 0; j < 3; j += 1) {
          const q = P(-t * 0.15 + (j * TAU) / 3 + t3 * (Math.PI / 3), 1.3);
          if (j) b.lineTo(q[0], q[1]);
          else b.moveTo(q[0], q[1]);
        }
        b.closePath();
        b.stroke();
      }
      const r = Math.max(1, ra * 0.13);
      for (let i = 0; i < 8; i += 1) {
        const q = P((i / 8) * TAU + t * 0.18, 1.65);
        b.save();
        b.translate(q[0], q[1]);
        b.scale(r, r * sq * 1.6);
        b.strokeStyle = `rgba(${i % 2 ? vio : gold},.85)`;
        b.lineWidth = (1.1 * s) / r;
        b.lineCap = 'round';
        b.beginPath();
        for (const [x1, y1, x2, y2] of GL[i % 6]) {
          b.moveTo(x1, y1);
          b.lineTo(x2, y2);
        }
        b.stroke();
        b.restore();
      }
      ring(0.4 + ((t * 0.4) % 1) * 1.7, 1, 0.45 * (1 - ((t * 0.4) % 1)), vio);
      for (const e of E) {
        e.h += e.v * dt * 0.5;
        if (e.h > 1) {
          e.h = 0;
          e.a = R(0, TAU);
          e.r = R(0.3, 1.7);
        }
        const q = P(e.a + t * 0.2, e.r);
        const al = (1 - e.h) * (0.5 + 0.5 * Math.sin(t * 6 + e.a * 3));
        glow(f, q[0], q[1] - e.h * ra * 1.9, 3.4 * e.z * s, gold, al);
      }
    };
  });

  def('laurel', 'Golden Laurel', 'Education', 'Twin gilded laurel branches weave around your avatar as luminous parchment motes drift upward.', 1, (S) => {
    const { W, H, cx, cy, ra, s, b, f } = S;
    const gold = '244,212,140';
    const ivory = '255,244,214';
    const motes = Array.from({ length: 12 }, (_, i) => ({
      x: ((i + 0.35) / 12) * W + R(-8, 8) * s,
      y0: R(0, 1),
      v: R(0.055, 0.105),
      amp: R(5, 13),
      ph: R(0, TAU),
      r: R(1.1, 2.1),
      st: i % 3 === 0
    }));
    const leftPts = [];
    const rightPts = [];
    const segs = 22;
    for (let i = 0; i <= segs; i += 1) {
      const k = i / segs;
      const al = Math.PI * 0.5 + k * Math.PI * 0.89;
      const ar = Math.PI * 0.5 - k * Math.PI * 0.89;
      const rad = ra * (1.15 + 0.08 * Math.sin(k * Math.PI));
      leftPts.push([cx + Math.cos(al) * rad, cy + Math.sin(al) * rad]);
      rightPts.push([cx + Math.cos(ar) * rad, cy + Math.sin(ar) * rad]);
    }
    const leftM = pathMetrics(leftPts, false);
    const rightM = pathMetrics(rightPts, false);
    return (t) => {
      // Subtle engraved astrolabe ring on back canvas
      b.save();
      b.translate(cx, cy);
      b.rotate(t * 0.07);
      b.strokeStyle = 'rgba(244,212,140,.13)';
      b.lineWidth = 0.85 * s;
      b.beginPath();
      b.arc(0, 0, ra * 1.46, 0, TAU);
      b.stroke();
      b.strokeStyle = 'rgba(244,212,140,.18)';
      b.beginPath();
      for (let i = 0; i < 24; i += 1) {
        const a = (i / 24) * TAU;
        const r1 = ra * 1.46;
        const r2 = ra * (i % 3 === 0 ? 1.38 : 1.42);
        b.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        b.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
      }
      b.stroke();
      b.restore();

      // Slow rising parchment-gold motes
      for (const m of motes) {
        const prog = frac(m.y0 + t * m.v);
        const y = H * (1.04 - prog * 1.12);
        const x = m.x + Math.sin(t * 0.75 + m.ph) * m.amp * s;
        const fade = Math.sin(prog * Math.PI);
        if (m.st) {
          sparkle(b, x, y, m.r * 1.65 * s, gold, fade * 0.65);
        } else {
          glow(b, x, y, m.r * 3.4 * s, ivory, fade * 0.38);
          b.fillStyle = `rgba(${ivory},${fade * 0.65})`;
          b.beginPath();
          b.arc(x, y, m.r * 0.58 * s, 0, TAU);
          b.fill();
        }
      }

      // Soft warm crown halo behind wreath
      glow(b, cx, cy, ra * 1.6, gold, 0.09 + 0.03 * Math.sin(t * 1.1));

      // Laurel vine stems
      for (const pts of [leftPts, rightPts]) {
        f.strokeStyle = 'rgba(216,174,88,.72)';
        f.lineWidth = 1.45 * s;
        f.lineCap = 'round';
        tracePoly(f, pts, false);
        f.stroke();
      }

      // Paired sculpted laurel leaves with cascading sheen wave
      const wave = frac(t * 0.21);
      const count = 9;
      for (const side of [-1, 1]) {
        for (let i = 0; i < count; i += 1) {
          const k = 0.08 + (i / (count - 1)) * 0.85;
          const a = Math.PI * 0.5 - side * k * Math.PI * 0.89;
          const rad = ra * (1.15 + 0.08 * Math.sin(k * Math.PI));
          const sx = cx + Math.cos(a) * rad;
          const sy = cy + Math.sin(a) * rad;
          const tang = a - side * (Math.PI * 0.5);
          const sway = Math.sin(t * 1.25 - i * 0.42) * 0.055;
          const dWave = Math.min(Math.abs(wave - k), 1 - Math.abs(wave - k));
          const sheen = Math.max(0, 1 - dWave * 5.2);
          const sizeK = 0.72 + 0.34 * Math.sin(k * Math.PI);
          const len = ra * 0.34 * sizeK;
          const wid = ra * 0.115 * sizeK;
          const cOut1 = sheen > 0.2 ? '#fff4cf' : '#e8c46f';
          const cOut2 = sheen > 0.2 ? '#f7d887' : '#a77c2c';
          const cIn1 = sheen > 0.2 ? '#f8dfa0' : '#d2a74f';
          const cIn2 = '#896320';
          leaf(f, sx, sy, len, wid, tang + side * 0.46 + sway, cOut1, cOut2, 0.35 + sheen * 0.45);
          leaf(f, sx, sy, len * 0.84, wid * 0.86, tang - side * 0.36 - sway * 0.6, cIn1, cIn2, 0.22 + sheen * 0.35);
        }
      }

      // Symmetrical traveling golden light along both wreath arcs
      traceComet(f, leftM, wave, 0.22, ivory, 1.55 * s, 0.68, s, 14);
      traceComet(f, rightM, wave, 0.22, ivory, 1.55 * s, 0.68, s, 14);

      // Bottom ribbon knot & graceful tails
      const ky = cy + ra * 1.16;
      f.strokeStyle = 'rgba(244,212,140,.85)';
      f.lineWidth = 1.65 * s;
      f.lineCap = 'round';
      for (const sd of [-1, 1]) {
        const flutter = Math.sin(t * 1.6 + sd) * 1.2 * s;
        f.beginPath();
        f.moveTo(cx, ky);
        f.quadraticCurveTo(cx + sd * ra * 0.18, ky + ra * 0.11, cx + sd * ra * 0.3, ky + ra * 0.2 + flutter);
        f.stroke();
      }
      f.fillStyle = '#f5d78c';
      f.beginPath();
      f.ellipse(cx, ky, 3.6 * s, 2.2 * s, 0, 0, TAU);
      f.fill();

      // Open crown apex star blooming when wave reaches apex
      const apexBloom = Math.max(0, 1 - Math.min(Math.abs(wave - 0.96), Math.abs(wave + 0.04)) * 6);
      const stR = (4.2 + apexBloom * 2.4 + 0.45 * Math.sin(t * 1.8)) * s;
      sparkle(f, cx, cy - ra * 1.24, stR, gold, 0.78 + apexBloom * 0.22);
    };
  }, { fullCard: true, cardFrame: ['244,212,140', '255,244,214', 'arc'] });

  def('scholar', 'Scholar\'s Folio', 'Education', 'An ornate diamond-crested bookmark frame shines as luminous pages and a gliding quill trace golden notes.', 2, (S) => {
    const { W, H, cx, cy, ra, s, b, f } = S;
    const gold = '248,206,120';
    const sapph = '136,184,255';
    const cream = '255,244,222';
    // Build scalloped heraldic diamond lozenge path (4 cardinal peaks + inward ogee shoulders)
    const buildLozenge = (scale) => {
      const pts = [];
      const rx = ra * 1.35 * scale;
      const ry = ra * 1.40 * scale;
      const N = 64;
      for (let i = 0; i < N; i += 1) {
        const a = -Math.PI / 2 + (i / N) * TAU;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const peak = Math.pow(Math.abs(c), 1.45) + Math.pow(Math.abs(sn), 1.45);
        const rad = 1 / Math.pow(peak, 1 / 1.45);
        const scallop = 1 - 0.045 * Math.sin(2 * a) * Math.sin(2 * a);
        pts.push([cx + c * rx * rad * scallop, cy + sn * ry * rad * scallop]);
      }
      return pts;
    };
    const outerPts = buildLozenge(1);
    const innerPts = buildLozenge(0.93);
    const outerM = pathMetrics(outerPts, true);
    const peaks = [
      [cx, cy - ra * 1.40],
      [cx + ra * 1.35, cy],
      [cx, cy + ra * 1.40],
      [cx - ra * 1.35, cy]
    ];
    const pages = Array.from({ length: 6 }, (_, i) => ({
      x0: ((i + 0.4) / 6) * W,
      y0: R(0, 1),
      v: R(0.045, 0.085),
      sw: R(0, TAU),
      amp: R(10, 22),
      rot: R(-0.4, 0.4),
      rs: R(0.4, 0.9),
      sz: R(4.2, 6.2)
    }));
    return (t) => {
      // Soft floating curling ivory pages on back canvas
      for (const p of pages) {
        const prog = frac(p.y0 + t * p.v);
        const y = H * (1.06 - prog * 1.16);
        const x = p.x0 + Math.sin(t * 0.65 + p.sw) * p.amp * s;
        const fade = Math.sin(prog * Math.PI) * 0.62;
        b.save();
        b.translate(x, y);
        b.rotate(p.rot + Math.sin(t * p.rs + p.sw) * 0.35);
        b.scale(1, 0.35 + 0.65 * Math.abs(Math.cos(t * p.rs * 1.3 + p.sw)));
        const pw = p.sz * 1.45 * s;
        const ph = p.sz * s;
        b.fillStyle = `rgba(${cream},${fade * 0.72})`;
        b.strokeStyle = `rgba(${gold},${fade * 0.85})`;
        b.lineWidth = 0.7 * s;
        b.beginPath();
        b.moveTo(-pw * 0.5, -ph * 0.5);
        b.quadraticCurveTo(0, -ph * 0.72, pw * 0.5, -ph * 0.45);
        b.lineTo(pw * 0.5, ph * 0.5);
        b.quadraticCurveTo(0, ph * 0.25, -pw * 0.5, ph * 0.5);
        b.closePath();
        b.fill();
        b.stroke();
        b.restore();
      }

      // Subtle sapphire scholar aura behind diamond
      glow(b, cx, cy, ra * 1.65, sapph, 0.1 + 0.03 * Math.sin(t * 0.9));

      // Double-lined scalloped heraldic diamond bookplate frame
      f.strokeStyle = 'rgba(248,206,120,.72)';
      f.lineWidth = 1.45 * s;
      tracePoly(f, outerPts, true);
      f.stroke();

      f.strokeStyle = 'rgba(136,184,255,.42)';
      f.lineWidth = 0.85 * s;
      tracePoly(f, innerPts, true);
      f.stroke();

      // Cardinal diamond tip ornaments
      for (let i = 0; i < peaks.length; i += 1) {
        const [px, py] = peaks[i];
        const pulse = 0.65 + 0.35 * Math.sin(t * 1.7 + i * 1.57);
        sparkle(f, px, py, 2.5 * s * (0.85 + 0.2 * pulse), i % 2 === 0 ? gold : sapph, 0.75 * pulse);
      }

      // Opposing calligraphic light comets gliding around the diamond
      const u1 = frac(t * 0.14);
      traceComet(f, outerM, u1, 0.16, gold, 1.8 * s, 0.85, s, 18);
      traceComet(f, outerM, frac(u1 + 0.5), 0.14, sapph, 1.4 * s, 0.72, s, 16);

      // Miniature open-book emblem tucked at bottom crest
      const by = cy + ra * 1.27;
      f.save();
      f.translate(cx, by);
      f.fillStyle = 'rgba(255,244,222,.9)';
      f.strokeStyle = 'rgba(248,206,120,.92)';
      f.lineWidth = 0.95 * s;
      for (const sd of [-1, 1]) {
        f.beginPath();
        f.moveTo(0, 1.8 * s);
        f.quadraticCurveTo(sd * 4.5 * s, -1.6 * s, sd * 8.4 * s, 0.4 * s);
        f.lineTo(sd * 7.8 * s, 4.6 * s);
        f.quadraticCurveTo(sd * 4.2 * s, 2.8 * s, 0, 5.2 * s);
        f.closePath();
        f.fill();
        f.stroke();
      }
      f.restore();

      // Gliding golden feather quill pen tracing soft ink sparks on upper-right rim
      const qt = t * 0.55;
      const qx = cx + ra * 1.18 + Math.cos(qt) * ra * 0.24;
      const qy = cy - ra * 0.62 + Math.sin(qt * 2) * ra * 0.16;
      for (let i = 1; i <= 6; i += 1) {
        const pt = qt - i * 0.16;
        const tx = cx + ra * 1.18 + Math.cos(pt) * ra * 0.24;
        const ty = cy - ra * 0.62 + Math.sin(pt * 2) * ra * 0.16;
        const a = (1 - i / 7) * 0.6;
        glow(f, tx, ty, 3.2 * s, gold, a);
      }
      f.save();
      f.translate(qx, qy);
      f.rotate(-0.62 + Math.sin(qt) * 0.14);
      // Nib tip at (0,0), plume sweeping up-right
      const qg = f.createLinearGradient(0, 0, 15 * s, -12 * s);
      qg.addColorStop(0, '#f8ce78');
      qg.addColorStop(0.55, '#fff4de');
      qg.addColorStop(1, '#9cc4ff');
      f.fillStyle = qg;
      f.beginPath();
      f.moveTo(2.5 * s, -2 * s);
      f.bezierCurveTo(6 * s, -10.5 * s, 14 * s, -13 * s, 17 * s, -11.5 * s);
      f.bezierCurveTo(13 * s, -6.5 * s, 9 * s, -2.5 * s, 2.5 * s, -2 * s);
      f.closePath();
      f.fill();
      f.strokeStyle = '#f8ce78';
      f.lineWidth = 1.05 * s;
      f.lineCap = 'round';
      f.beginPath();
      f.moveTo(0, 0);
      f.lineTo(15.5 * s, -10.5 * s);
      f.stroke();
      glow(f, 0, 0, 4.2 * s, gold, 0.85);
      f.restore();
    };
  }, { fullCard: true, cardFrame: ['248,206,120', '136,184,255', 'double'] });

  def('circuit', 'Silicon Hex', 'Information Technology', 'A chamfered silicon hex frame channels smooth emerald-cyan pulses along precision micro-traces.', 1, (S) => {
    const { W, H, cx, cy, ra, s, b, f } = S;
    const cyan = '74,240,210';
    const sky = '112,198,255';
    const gold = '240,204,122';
    const hexPts = (rad) => Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * TAU;
      return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad];
    });
    const outerHex = hexPts(ra * 1.27);
    const innerHex = hexPts(ra * 1.14);
    const hexM = pathMetrics(outerHex, true);
    // Clean orthogonal 45-degree PCB micro-traces radiating softly into available banner space
    const traces = [
      { v: 0, dx1: 0.55, dy1: 0, dx2: 1.05, dy2: -0.45, dx3: 1.85, dy3: -0.45, ph: 0.0, c: cyan },
      { v: 0, dx1: 0.42, dy1: 0.32, dx2: 1.15, dy2: 0.32, dx3: 1.55, dy3: 0.68, ph: 0.35, c: sky },
      { v: 1, dx1: 0.25, dy1: 0.42, dx2: 0.95, dy2: 0.42, dx3: 1.35, dy3: 0.12, ph: 0.62, c: cyan },
      { v: 5, dx1: 0.28, dy1: -0.42, dx2: 1.0, dy2: -0.42, dx3: 1.48, dy3: -0.1, ph: 0.18, c: sky },
      { v: 3, dx1: -0.45, dy1: 0, dx2: -0.85, dy2: -0.35, dx3: -1.35, dy3: -0.35, ph: 0.48, c: cyan },
      { v: 4, dx1: -0.22, dy1: -0.38, dx2: -0.78, dy2: -0.38, dx3: -1.12, dy3: -0.08, ph: 0.82, c: sky }
    ].map((tr) => {
      const [vx, vy] = outerHex[tr.v];
      const pts = [
        [vx, vy],
        [vx + tr.dx1 * ra, vy + tr.dy1 * ra],
        [vx + tr.dx2 * ra, vy + tr.dy2 * ra],
        [vx + tr.dx3 * ra, vy + tr.dy3 * ra]
      ];
      return { ...tr, pts, m: pathMetrics(pts, false) };
    });
    return (t) => {
      // Subtle ambient silicon glow
      glow(b, cx, cy, ra * 1.65, cyan, 0.08 + 0.025 * Math.sin(t * 1.2));

      // Minimal PCB micro-traces & smooth traveling optical packets on back canvas
      for (const tr of traces) {
        b.strokeStyle = `rgba(${tr.c},.17)`;
        b.lineWidth = 1.0 * s;
        b.lineCap = 'round';
        tracePoly(b, tr.pts, false);
        b.stroke();
        const end = tr.pts[tr.pts.length - 1];
        const prog = frac(t * 0.26 + tr.ph);
        const arrival = Math.max(0, 1 - Math.abs(prog - 0.92) * 8);
        if (end[0] > 2 && end[0] < W - 2 && end[1] > 2 && end[1] < H - 2) {
          b.strokeStyle = `rgba(${gold},${0.32 + arrival * 0.55})`;
          b.lineWidth = 1.05 * s;
          b.beginPath();
          b.arc(end[0], end[1], 2.2 * s, 0, TAU);
          b.stroke();
          if (arrival > 0.05) glow(b, end[0], end[1], 6.5 * s, tr.c, arrival * 0.65);
        }
        traceComet(b, tr.m, prog, 0.28, tr.c, 1.35 * s, 0.72, s, 10);
      }

      // Outer chamfered silicon hexagon + inner precision bezel
      f.strokeStyle = 'rgba(74,240,210,.76)';
      f.lineWidth = 1.6 * s;
      tracePoly(f, outerHex, true);
      f.stroke();

      f.strokeStyle = 'rgba(112,198,255,.38)';
      f.lineWidth = 0.85 * s;
      tracePoly(f, innerHex, true);
      f.stroke();

      // Radial gold-tipped microchip contact pins along the 6 hex edges
      f.strokeStyle = 'rgba(240,204,122,.58)';
      f.lineWidth = 1.0 * s;
      f.lineCap = 'round';
      for (let i = 0; i < 6; i += 1) {
        const a = outerHex[i];
        const p2 = outerHex[(i + 1) % 6];
        const mx = (a[0] + p2[0]) * 0.5;
        const my = (a[1] + p2[1]) * 0.5;
        const ex = p2[0] - a[0];
        const ey = p2[1] - a[1];
        const len = Math.hypot(ex, ey) || 1;
        const tx = ex / len;
        const ty = ey / len;
        const nx = (mx - cx);
        const ny = (my - cy);
        const nm = Math.hypot(nx, ny) || 1;
        const ox = nx / nm;
        const oy = ny / nm;
        for (const off of [-3.4 * s, 0, 3.4 * s]) {
          const px = mx + tx * off;
          const py = my + ty * off;
          const pinL = (off === 0 ? 5.2 : 3.4) * s;
          f.beginPath();
          f.moveTo(px + ox * 0.8 * s, py + oy * 0.8 * s);
          f.lineTo(px + ox * pinL, py + oy * pinL);
          f.stroke();
        }
      }

      // Smooth dual optical pulses racing calmly along the hex border
      const u = frac(t * 0.22);
      traceComet(f, hexM, u, 0.2, cyan, 1.9 * s, 0.88, s, 18);
      traceComet(f, hexM, frac(u + 0.5), 0.16, sky, 1.45 * s, 0.72, s, 16);

      // Gold-rimmed vertex solder via pads softly lighting as pulse passes
      for (let i = 0; i < 6; i += 1) {
        const [vx, vy] = outerHex[i];
        const vu = i / 6;
        const d1 = Math.min(Math.abs(u - vu), 1 - Math.abs(u - vu));
        const d2 = Math.min(Math.abs(frac(u + 0.5) - vu), 1 - Math.abs(frac(u + 0.5) - vu));
        const hit = Math.max(0, 1 - Math.min(d1, d2) * 11);
        if (hit > 0.04) glow(f, vx, vy, 6.8 * s, cyan, hit * 0.75);
        f.fillStyle = '#0d1d1a';
        f.beginPath();
        f.arc(vx, vy, 2.3 * s, 0, TAU);
        f.fill();
        f.strokeStyle = hit > 0.25 ? '#9cfce8' : `rgba(${gold},.85)`;
        f.lineWidth = 1.15 * s;
        f.stroke();
      }
    };
  }, { fullCard: true, cardFrame: ['74,240,210', '240,204,122', 'chamfer'] });

  def('neural', 'Quantum Prism', 'Information Technology', 'A faceted octagonal prism frame links orbiting neural nodes with silk-smooth fiber-optic threads.', 2, (S) => {
    const { W, H, cx, cy, ra, s, b, f } = S;
    const ice = '108,236,255';
    const vio = '172,146,255';
    const mint = '120,255,212';
    const makeOct = (rad) => Array.from({ length: 8 }, (_, i) => {
      const a = Math.PI / 8 + (i / 8) * TAU;
      return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad];
    });
    const outerOct = makeOct(ra * 1.26);
    const octM = pathMetrics(outerOct, true);
    const nodes = Array.from({ length: 8 }, (_, i) => ({
      bx: ((i + 0.5) / 8) * W,
      by: H * (0.22 + (i % 3) * 0.27),
      ax: R(14, 28),
      ay: R(8, 18),
      fx: R(0.24, 0.44),
      fy: R(0.2, 0.38),
      ph: i * 1.15 + R(0, 0.7),
      c: i % 3 === 0 ? ice : i % 3 === 1 ? vio : mint,
      fg: i === 2 || i === 5
    }));
    const maxLink = Math.max(ra * 2.15, 74 * s);
    return (t) => {
      const pos = nodes.map((n) => [
        n.bx + Math.sin(t * n.fx + n.ph) * n.ax * s,
        n.by + Math.cos(t * n.fy + n.ph * 1.2) * n.ay * s,
        n
      ]);

      // Dynamic fiber-optic synapse links between nearby nodes & nearest prism vertices
      b.lineCap = 'round';
      for (let i = 0; i < pos.length; i += 1) {
        const [x1, y1, n1] = pos[i];
        // Link to nearest octagon vertex if close
        let bestV = outerOct[0];
        let bestD = Infinity;
        for (const v of outerOct) {
          const d = Math.hypot(v[0] - x1, v[1] - y1);
          if (d < bestD) { bestD = d; bestV = v; }
        }
        if (bestD < maxLink && bestD > ra * 0.3) {
          const al = (1 - bestD / maxLink) * 0.42;
          b.strokeStyle = `rgba(${n1.c},${al})`;
          b.lineWidth = 0.85 * s;
          b.beginPath();
          b.moveTo(x1, y1);
          b.lineTo(bestV[0], bestV[1]);
          b.stroke();
          const pk = frac(t * 0.35 + i * 0.27);
          const px = x1 + (bestV[0] - x1) * pk;
          const py = y1 + (bestV[1] - y1) * pk;
          glow(b, px, py, 3.8 * s, n1.c, al * 1.45);
        }
        // Soft node-to-node links
        for (let j = i + 1; j < pos.length; j += 1) {
          const [x2, y2] = pos[j];
          const d = Math.hypot(x2 - x1, y2 - y1);
          if (d < maxLink * 0.88) {
            b.strokeStyle = `rgba(${ice},${(1 - d / (maxLink * 0.88)) * 0.24})`;
            b.lineWidth = 0.75 * s;
            b.beginPath();
            b.moveTo(x1, y1);
            b.lineTo(x2, y2);
            b.stroke();
          }
        }
      }

      // Render neural nodes with depth split (keep avatar face completely unobstructed)
      for (const [x, y, n] of pos) {
        const clearFace = Math.hypot(x - cx, y - cy) > ra * 1.1;
        const g = n.fg && clearFace ? f : b;
        const pulse = 0.65 + 0.35 * Math.sin(t * 1.6 + n.ph);
        glow(g, x, y, 6.2 * s, n.c, 0.55 * pulse);
        g.fillStyle = `rgba(255,255,255,${0.72 * pulse})`;
        g.beginPath();
        g.arc(x, y, 1.35 * s, 0, TAU);
        g.fill();
      }

      // Counter-breathing inner crystalline octagon
      const breathe = 1 + 0.018 * Math.sin(t * 1.3);
      const innerOct = makeOct(ra * 1.13 * breathe);
      f.strokeStyle = 'rgba(172,146,255,.42)';
      f.lineWidth = 0.9 * s;
      tracePoly(f, innerOct, true);
      f.stroke();

      // Split-bevel outer octagonal prism (luminous micro-gaps at diagonal chamfer midpoints)
      f.lineCap = 'round';
      for (let i = 0; i < 8; i += 1) {
        const a = outerOct[i];
        const c = outerOct[(i + 1) % 8];
        const isDiag = i % 2 === 0;
        f.strokeStyle = isDiag ? 'rgba(172,146,255,.78)' : 'rgba(108,236,255,.78)';
        f.lineWidth = 1.55 * s;
        if (isDiag) {
          const m1x = a[0] + (c[0] - a[0]) * 0.42;
          const m1y = a[1] + (c[1] - a[1]) * 0.42;
          const m2x = a[0] + (c[0] - a[0]) * 0.58;
          const m2y = a[1] + (c[1] - a[1]) * 0.58;
          f.beginPath();
          f.moveTo(a[0], a[1]);
          f.lineTo(m1x, m1y);
          f.moveTo(m2x, m2y);
          f.lineTo(c[0], c[1]);
          f.stroke();
        } else {
          f.beginPath();
          f.moveTo(a[0], a[1]);
          f.lineTo(c[0], c[1]);
          f.stroke();
        }
      }

      // 4 floating detached telemetry corner arcs outside the diagonal chamfers
      const arcShift = Math.sin(t * 0.85) * 0.04;
      f.strokeStyle = 'rgba(120,255,212,.52)';
      f.lineWidth = 1.05 * s;
      for (let i = 0; i < 4; i += 1) {
        const midA = Math.PI * 0.25 + i * Math.PI * 0.5 + arcShift * (i % 2 ? -1 : 1);
        f.beginPath();
        f.arc(cx, cy, ra * 1.39, midA - 0.19, midA + 0.19);
        f.stroke();
      }

      // Silky iridescent waves sweeping cleanly around the 8-sided prism
      const u = frac(t * 0.18);
      traceComet(f, octM, u, 0.18, ice, 1.85 * s, 0.88, s, 18);
      traceComet(f, octM, frac(u + 0.5), 0.18, vio, 1.65 * s, 0.82, s, 18);
    };
  }, { fullCard: true, cardFrame: ['108,236,255', '172,146,255', 'chamfer'] });

  def('blueprint', 'Arch Blueprint', 'Architecture', 'A classic drafting-arch portal with living dimension lines and golden-ratio guides frames your avatar.', 1, (S) => {
    const { W, H, cx, cy, ra, s, b, f } = S;
    const ink = '128,208,255';
    const white = '232,246,255';
    const brass = '244,208,132';
    // Construct Gothic/classical vaulted architectural arch portal polyline
    const buildArch = (wK, yBaseK, ySpringK, yApexK) => {
      const hw = ra * wK;
      const yb = cy + ra * yBaseK;
      const ys = cy + ra * ySpringK;
      const ya = cy - ra * yApexK;
      const left = [[cx, yb], [cx - hw, yb], [cx - hw, ys]];
      const right = [[cx, yb], [cx + hw, yb], [cx + hw, ys]];
      const steps = 16;
      for (let i = 1; i <= steps; i += 1) {
        const k = i / steps;
        const u = 1 - k;
        // Pointed quadratic vaulted arch from pilaster capital to apex
        const lx = u * u * (cx - hw) + 2 * u * k * (cx - hw * 0.82) + k * k * cx;
        const ly = u * u * ys + 2 * u * k * (ya + (ys - ya) * 0.22) + k * k * ya;
        const rx = u * u * (cx + hw) + 2 * u * k * (cx + hw * 0.82) + k * k * cx;
        left.push([lx, ly]);
        right.push([rx, ly]);
      }
      const full = [...left, ...right.slice(0, -1).reverse()];
      return { left, right, full, hw, yb, ys, ya };
    };
    const outer = buildArch(1.16, 1.15, -0.18, 1.38);
    const inner = buildArch(1.04, 1.06, -0.18, 1.25);
    const leftM = pathMetrics(outer.left, false);
    const rightM = pathMetrics(outer.right, false);
    const gridStep = Math.max(14, Math.round(18 * s));
    return (t) => {
      // Ultra-refined cyanotype blueprint drafting grid on back canvas
      b.strokeStyle = 'rgba(128,208,255,.065)';
      b.lineWidth = 0.75;
      b.beginPath();
      for (let x = cx % gridStep; x < W; x += gridStep) {
        b.moveTo(x, 0);
        b.lineTo(x, H);
      }
      for (let y = cy % gridStep; y < H; y += gridStep) {
        b.moveTo(0, y);
        b.lineTo(W, y);
      }
      b.stroke();

      // Living self-drawing architectural construction arcs & dimension callouts (9.5s serene cycle)
      const ph = frac(t / 9.5);
      const drawK = Math.min(1, ph / 0.42);
      const fadeK = ph > 0.78 ? 1 - (ph - 0.78) / 0.22 : Math.min(1, ph / 0.12);
      const da = 0.36 * fadeK;

      // Compass construction arc sweeping across right/banner space
      b.strokeStyle = `rgba(${ink},${da * 0.85})`;
      b.lineWidth = 0.85 * s;
      b.setLineDash([3 * s, 4 * s]);
      b.beginPath();
      b.arc(cx, cy, ra * 1.48, -Math.PI * 0.75, -Math.PI * 0.75 + TAU * 0.65 * drawK);
      b.stroke();
      b.setLineDash([]);

      // Horizontal & vertical blueprint dimension callout lines with 45-deg drafting ticks
      const dimY = outer.yb + 7.5 * s;
      const xL = outer.hw * drawK;
      b.strokeStyle = `rgba(${white},${da})`;
      b.lineWidth = 0.85 * s;
      b.beginPath();
      b.moveTo(cx - xL, dimY);
      b.lineTo(cx + xL, dimY);
      if (drawK > 0.85) {
        for (const sx of [-1, 1]) {
          const ex = cx + sx * outer.hw;
          b.moveTo(ex, outer.yb + 2.5 * s);
          b.lineTo(ex, dimY + 3.5 * s);
          b.moveTo(ex - 2.4 * s, dimY + 2.4 * s);
          b.lineTo(ex + 2.4 * s, dimY - 2.4 * s);
        }
      }
      b.stroke();

      // Secondary architectural elevation rail on right side of banner when wide enough
      if (W - cx > ra * 2.1) {
        const rx = cx + ra * 1.62;
        const topY = outer.ya;
        const botY = outer.yb;
        const curY = botY - (botY - topY) * drawK;
        b.strokeStyle = `rgba(${ink},${da * 0.9})`;
        b.beginPath();
        b.moveTo(rx, botY);
        b.lineTo(rx, curY);
        b.moveTo(rx - 4 * s, botY);
        b.lineTo(rx + 4 * s, botY);
        if (drawK > 0.8) {
          b.moveTo(rx - 4 * s, topY);
          b.lineTo(rx + 4 * s, topY);
        }
        b.stroke();
      }

      // Vaulted Cathedral Arch Portal border on front canvas
      f.lineCap = 'round';
      f.strokeStyle = `rgba(${ink},.82)`;
      f.lineWidth = 1.6 * s;
      tracePoly(f, outer.full, true);
      f.stroke();

      f.strokeStyle = `rgba(${white},.36)`;
      f.lineWidth = 0.85 * s;
      tracePoly(f, inner.full, true);
      f.stroke();

      // Architectural stepped plinth ledge & pilaster capital moldings
      f.strokeStyle = `rgba(${white},.72)`;
      f.lineWidth = 1.75 * s;
      f.beginPath();
      f.moveTo(cx - outer.hw - 4.5 * s, outer.yb);
      f.lineTo(cx + outer.hw + 4.5 * s, outer.yb);
      f.stroke();
      f.strokeStyle = `rgba(${brass},.72)`;
      f.lineWidth = 1.15 * s;
      for (const sx of [-1, 1]) {
        const px = cx + sx * outer.hw;
        f.beginPath();
        f.moveTo(px - 3 * s, outer.ys);
        f.lineTo(px + 3 * s, outer.ys);
        f.stroke();
      }

      // Symmetrical luminous drafting light beads ascending both pilasters to keystone
      const prog = frac(t * 0.18);
      traceComet(f, leftM, prog, 0.24, white, 1.55 * s, 0.8, s, 14);
      traceComet(f, rightM, prog, 0.24, white, 1.55 * s, 0.8, s, 14);

      // Sculpted brass diamond keystone crowning the arch apex
      const bloom = Math.max(0, 1 - Math.min(Math.abs(prog - 0.96), Math.abs(prog + 0.04)) * 5.5);
      const kx = cx;
      const ky = outer.ya;
      glow(f, kx, ky, (7 + bloom * 6) * s, brass, 0.45 + bloom * 0.5);
      f.fillStyle = bloom > 0.2 ? '#fff4d4' : '#f4d084';
      f.strokeStyle = '#fff8e6';
      f.lineWidth = 0.85 * s;
      f.beginPath();
      f.moveTo(kx, ky - 4.8 * s);
      f.lineTo(kx + 3.6 * s, ky);
      f.lineTo(kx, ky + 4.8 * s);
      f.lineTo(kx - 3.6 * s, ky);
      f.closePath();
      f.fill();
      f.stroke();
    };
  }, { fullCard: true, cardFrame: ['128,208,255', '244,208,132', 'bracket'] });

  def('atelier', 'Gilded Dome', 'Architecture', 'An Art Deco stepped-diamond monolith and rotating golden-ratio compasses frame your profile in warm brass.', 2, (S) => {
    const { W, H, cx, cy, ra, s, b, f } = S;
    const brass = '245,208,128';
    const ivory = '255,244,218';
    // Art Deco stepped ziggurat monolith polyline (mirrored left & right halves)
    const buildDeco = (sc) => {
      const k = ra * sc;
      const right = [
        [cx, cy + k * 1.33],
        [cx + k * 0.42, cy + k * 1.15],
        [cx + k * 0.84, cy + k * 1.15],
        [cx + k * 0.84, cy + k * 0.86],
        [cx + k * 1.12, cy + k * 0.86],
        [cx + k * 1.12, cy + k * 0.48],
        [cx + k * 1.28, cy + k * 0.48],
        [cx + k * 1.28, cy - k * 0.48],
        [cx + k * 1.12, cy - k * 0.48],
        [cx + k * 1.12, cy - k * 0.86],
        [cx + k * 0.84, cy - k * 0.86],
        [cx + k * 0.84, cy - k * 1.14],
        [cx + k * 0.42, cy - k * 1.14],
        [cx, cy - k * 1.38]
      ];
      const left = right.map(([x, y]) => [cx - (x - cx), y]);
      const full = [...right, ...left.slice(1, -1).reverse()];
      return { left, right, full };
    };
    const outer = buildDeco(1);
    const inner = buildDeco(0.91);
    const leftM = pathMetrics(outer.left, false);
    const rightM = pathMetrics(outer.right, false);
    const motes = Array.from({ length: 11 }, (_, i) => ({
      x: ((i + 0.3) / 11) * W,
      y0: R(0, 1),
      v: R(0.035, 0.07),
      ph: R(0, TAU),
      r: R(1.0, 1.9)
    }));
    return (t) => {
      // Soft diagonal atrium skylight shaft sweeping serenely across banner
      const beamX = ((t * 14 * s) % (W + H * 1.4)) - H * 0.4;
      b.save();
      const bgr = b.createLinearGradient(beamX - 38 * s, 0, beamX + 38 * s, 0);
      bgr.addColorStop(0, 'rgba(255,244,218,0)');
      bgr.addColorStop(0.5, 'rgba(255,240,200,.085)');
      bgr.addColorStop(1, 'rgba(255,244,218,0)');
      b.fillStyle = bgr;
      b.beginPath();
      b.moveTo(beamX - 24 * s, 0);
      b.lineTo(beamX + 32 * s, 0);
      b.lineTo(beamX - 18 * s, H);
      b.lineTo(beamX - 74 * s, H);
      b.closePath();
      b.fill();
      b.restore();

      // Rotating golden-ratio rose-window brass dome wireframe behind avatar
      b.save();
      b.translate(cx, cy);
      b.rotate(t * 0.085);
      b.strokeStyle = 'rgba(245,208,128,.16)';
      b.lineWidth = 0.85 * s;
      for (const rk of [1.46, 1.24]) {
        b.beginPath();
        b.arc(0, 0, ra * rk, 0, TAU);
        b.stroke();
      }
      b.strokeStyle = 'rgba(245,208,128,.13)';
      b.beginPath();
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * TAU;
        b.moveTo(Math.cos(a) * ra * 1.05, Math.sin(a) * ra * 1.05);
        b.lineTo(Math.cos(a) * ra * 1.46, Math.sin(a) * ra * 1.46);
      }
      b.stroke();
      b.restore();

      // Warm gilded skylight dust motes
      for (const m of motes) {
        const prog = frac(m.y0 + t * m.v);
        const y = H * (1.03 - prog * 1.08);
        const x = m.x + Math.sin(t * 0.6 + m.ph) * 8 * s;
        const a = Math.sin(prog * Math.PI) * 0.58;
        glow(b, x, y, m.r * 3.4 * s, brass, a * 0.65);
        b.fillStyle = `rgba(${ivory},${a})`;
        b.beginPath();
        b.arc(x, y, m.r * 0.55 * s, 0, TAU);
        b.fill();
      }

      // Art Deco stepped ziggurat monolith frame
      const grad = f.createLinearGradient(cx, cy - ra * 1.38, cx, cy + ra * 1.34);
      grad.addColorStop(0, '#fff3cf');
      grad.addColorStop(0.5, '#f2c872');
      grad.addColorStop(1, '#c3903d');
      f.strokeStyle = grad;
      f.lineWidth = 1.65 * s;
      tracePoly(f, outer.full, true);
      f.stroke();

      f.strokeStyle = 'rgba(255,244,218,.34)';
      f.lineWidth = 0.8 * s;
      tracePoly(f, inner.full, true);
      f.stroke();

      // Triple-fluted Art Deco side accent rails
      f.strokeStyle = 'rgba(245,208,128,.48)';
      f.lineWidth = 0.85 * s;
      f.lineCap = 'round';
      for (const sx of [-1, 1]) {
        const rx = cx + sx * ra * 1.36;
        f.beginPath();
        f.moveTo(rx, cy - ra * 0.38);
        f.lineTo(rx, cy + ra * 0.38);
        f.moveTo(rx + sx * 3.2 * s, cy - ra * 0.22);
        f.lineTo(rx + sx * 3.2 * s, cy + ra * 0.22);
        f.stroke();
      }

      // Symmetrical champagne light glints gliding up both stepped flanks
      const prog = frac(t * 0.16);
      traceComet(f, leftM, prog, 0.22, ivory, 1.75 * s, 0.82, s, 16);
      traceComet(f, rightM, prog, 0.22, ivory, 1.75 * s, 0.82, s, 16);

      // Spire apex & base finials
      const apexGlint = 0.6 + 0.4 * Math.sin(t * 1.5);
      sparkle(f, cx, cy - ra * 1.38, 3.3 * s, brass, 0.85 * apexGlint);
      sparkle(f, cx, cy + ra * 1.33, 2.3 * s, ivory, 0.65 * apexGlint);
    };
  }, { fullCard: true, cardFrame: ['245,208,128', '255,244,218', 'double'] });

  def('vetpulse', 'Vital Paw', 'Veterinary Medicine', 'A smooth organic shield-heart frame pulses softly with a serene ECG heartbeat and drifting glowing paw prints.', 1, (S) => {
    const { W, H, cx, cy, ra, s, b, f } = S;
    const mint = '96,240,204';
    const rose = '255,156,178';
    const pearl = '245,255,252';
    // Sculpted continuous heart-shield crest polyline (soft twin upper lobes -> refined shield apex)
    const buildShield = (sc) => {
      const k = ra * sc;
      const right = [];
      const steps = 28;
      // Right upper lobe: top cleft (0, -1.14) -> arch peak -> cheek (1.26, -0.26) -> bottom apex (0, 1.35)
      for (let i = 0; i <= steps; i += 1) {
        const u = i / steps;
        let x;
        let y;
        if (u <= 0.45) {
          const p = u / 0.45;
          const q = 1 - p;
          x = q * q * 0 + 2 * q * p * (0.82 * k) + p * p * (1.26 * k);
          y = q * q * (-1.14 * k) + 2 * q * p * (-1.40 * k) + p * p * (-0.26 * k);
        } else {
          const p = (u - 0.45) / 0.55;
          const q = 1 - p;
          x = q * q * (1.26 * k) + 2 * q * p * (1.22 * k) + p * p * 0;
          y = q * q * (-0.26 * k) + 2 * q * p * (0.76 * k) + p * p * (1.35 * k);
        }
        right.push([cx + x, cy + y]);
      }
      const left = right.map(([x, y]) => [cx - (x - cx), y]);
      const full = [...right, ...left.slice(1, -1).reverse()];
      return { left, right, full };
    };
    const outer = buildShield(1);
    const inner = buildShield(0.93);
    const leftM = pathMetrics(outer.left, false);
    const rightM = pathMetrics(outer.right, false);
    const paws = Array.from({ length: 7 }, (_, i) => ({
      x0: ((i + 0.45) / 7) * W,
      y0: R(0, 1),
      v: R(0.05, 0.09),
      amp: R(7, 15),
      ph: R(0, TAU),
      r: R(4.2, 6.2),
      ang: R(-0.35, 0.35),
      c: i % 3 === 0 ? rose : mint,
      fg: i % 4 === 1
    }));
    return (t) => {
      // Calm resting heartbeat cycle (~2.4s per beat)
      const beatPhase = frac(t / 2.4);
      const beatPeak = Math.max(0, ecgWave(beatPhase));

      // Serene glowing ECG vitals waveform gliding smoothly across banner behind avatar
      const ecgY = cy + ra * 0.08;
      const headX = beatPhase * W;
      const ecgSteps = 72;
      b.lineCap = 'round';
      for (let i = 0; i < ecgSteps; i += 1) {
        const x1 = (i / ecgSteps) * W;
        const x2 = ((i + 1) / ecgSteps) * W;
        const trail = frac((headX - x1) / W);
        const fade = Math.max(0, 1 - trail * 1.55);
        if (fade <= 0.02) continue;
        const y1 = ecgY - ecgWave((x1 / W) * 1.45) * 15 * s;
        const y2 = ecgY - ecgWave((x2 / W) * 1.45) * 15 * s;
        b.strokeStyle = `rgba(${mint},${fade * 0.56})`;
        b.lineWidth = (0.9 + fade * 0.75) * s;
        b.beginPath();
        b.moveTo(x1, y1);
        b.lineTo(x2, y2);
        b.stroke();
      }
      const headY = ecgY - ecgWave((headX / W) * 1.45) * 15 * s;
      glow(b, headX, headY, 8 * s, mint, 0.82);
      b.fillStyle = `rgba(${pearl},.95)`;
      b.beginPath();
      b.arc(headX, headY, 1.4 * s, 0, TAU);
      b.fill();

      // Floating glowing paw prints drifting upward at varied depths (keep avatar face clear)
      for (const p of paws) {
        const prog = frac(p.y0 + t * p.v);
        const y = H * (1.06 - prog * 1.15);
        const x = p.x0 + Math.sin(t * 0.7 + p.ph) * p.amp * s;
        const fade = Math.sin(prog * Math.PI) * 0.56;
        const g = p.fg && Math.hypot(x - cx, y - cy) > ra * 1.28 ? f : b;
        paw(g, x, y, p.r * s, p.ang + Math.sin(t * 0.8 + p.ph) * 0.14, p.c, fade);
      }

      // Soft warm clinical aura reacting gently to heartbeat
      glow(b, cx, cy, ra * 1.58, mint, 0.08 + beatPeak * 0.09);

      // Sculpted organic heart-shield border on front canvas
      const gr = f.createLinearGradient(cx, cy - ra * 1.3, cx, cy + ra * 1.33);
      gr.addColorStop(0, '#9ef7df');
      gr.addColorStop(0.55, '#68dec0');
      gr.addColorStop(1, '#ffb1c2');
      f.strokeStyle = gr;
      f.lineWidth = 1.65 * s;
      tracePoly(f, outer.full, true);
      f.stroke();

      f.strokeStyle = `rgba(${rose},${0.36 + beatPeak * 0.24})`;
      f.lineWidth = 0.85 * s;
      tracePoly(f, inner.full, true);
      f.stroke();

      // Synchronized dual pulse waves sweeping gracefully from top cleft down to shield apex
      traceComet(f, leftM, beatPhase, 0.24, rose, 1.7 * s, 0.82, s, 16);
      traceComet(f, rightM, beatPhase, 0.24, mint, 1.7 * s, 0.82, s, 16);

      // Crisp miniature veterinary cross-gem nestled cleanly at top cleft
      const mx = cx;
      const my = cy - ra * 1.14;
      const cr = (2.8 + beatPeak * 0.9) * s;
      glow(f, mx, my, 7 * s, rose, 0.45 + beatPeak * 0.4);
      f.strokeStyle = `rgba(${pearl},.95)`;
      f.lineWidth = 1.5 * s;
      f.lineCap = 'round';
      f.beginPath();
      f.moveTo(mx - cr, my);
      f.lineTo(mx + cr, my);
      f.moveTo(mx, my - cr);
      f.lineTo(mx, my + cr);
      f.stroke();
    };
  }, { fullCard: true, cardFrame: ['96,240,204', '255,156,178', 'arc'] });

  def('sanctuary', 'Sanctuary Caduceus', 'Veterinary Medicine', 'An Art Nouveau botanical medallion with intertwined healing ribbons and floating bioluminescent petals guards your avatar.', 2, (S) => {
    const { W, H, cx, cy, ra, s, b, f } = S;
    const jade = '106,242,190';
    const gold = '248,218,144';
    const aqua = '142,236,255';
    // 6-lobed scalloped botanical rosette medallion path
    const buildRosette = (baseK, ampK) => {
      const pts = [];
      const N = 84;
      for (let i = 0; i < N; i += 1) {
        const a = -Math.PI / 2 + (i / N) * TAU;
        const r = ra * (baseK + ampK * Math.cos(6 * (a + Math.PI / 2)));
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      return pts;
    };
    const outerPts = buildRosette(1.21, 0.075);
    const innerPts = buildRosette(1.12, 0.045);
    const rosetteM = pathMetrics(outerPts, true);
    const cusps = Array.from({ length: 6 }, (_, i) => {
      const a = -Math.PI / 2 + (i / 6) * TAU;
      const r = ra * 1.285;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    });
    const flora = Array.from({ length: 8 }, (_, i) => ({
      x0: ((i + 0.35) / 8) * W,
      y0: R(0, 1),
      v: R(0.045, 0.085),
      amp: R(8, 18),
      ph: R(0, TAU),
      sz: R(4.5, 6.8),
      leaf: i % 2 === 0
    }));
    return (t) => {
      // Gentle sanctuary jade-gold halo
      glow(b, cx, cy, ra * 1.7, jade, 0.09 + 0.03 * Math.sin(t * 1.05));

      // Floating translucent botanical leaves & aqua healing spores
      for (const q of flora) {
        const prog = frac(q.y0 + t * q.v);
        const y = H * (1.05 - prog * 1.14);
        const x = q.x0 + Math.sin(t * 0.65 + q.ph) * q.amp * s;
        const fade = Math.sin(prog * Math.PI) * 0.65;
        if (q.leaf) {
          b.globalAlpha = fade;
          leaf(b, x, y, q.sz * 1.35 * s, q.sz * 0.48 * s, -Math.PI / 3 + Math.sin(t * 0.9 + q.ph) * 0.35, '#8af4ca', '#2d9d74', 0.38);
          b.globalAlpha = 1;
        } else {
          glow(b, x, y, q.sz * 0.95 * s, aqua, fade * 0.72);
          b.fillStyle = `rgba(240,255,252,${fade * 0.85})`;
          b.beginPath();
          b.arc(x, y, 1.15 * s, 0, TAU);
          b.fill();
        }
      }

      // 3D Intertwined Double-Helix Healing Ribbons (abstract Caduceus halo cradling the lower rim, leaving avatar face clear)
      const ribbonSegs = 44;
      const baseY = cy + ra * 0.84;
      for (const strand of [0, 1]) {
        const rgb = strand === 0 ? gold : jade;
        for (let i = 0; i < ribbonSegs; i += 1) {
          const u1 = i / ribbonSegs;
          const u2 = (i + 1) / ribbonSegs;
          const th1 = u1 * TAU + t * 0.36;
          const th2 = u2 * TAU + t * 0.36;
          const w1 = Math.sin(th1 * 3 + strand * Math.PI) * ra * 0.095;
          const w2 = Math.sin(th2 * 3 + strand * Math.PI) * ra * 0.095;
          const x1 = cx + Math.cos(th1) * ra * 1.42;
          const y1 = baseY + Math.sin(th1) * ra * 0.28 + w1;
          const x2 = cx + Math.cos(th2) * ra * 1.42;
          const y2 = baseY + Math.sin(th2) * ra * 0.28 + w2;
          const inFront = Math.sin(th1) > 0.12;
          const g = inFront ? f : b;
          const al = (inFront ? 0.62 : 0.28) * (0.65 + 0.35 * Math.abs(Math.cos(th1)));
          g.strokeStyle = `rgba(${rgb},${al})`;
          g.lineWidth = (inFront ? 1.65 : 1.05) * s;
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(x1, y1);
          g.lineTo(x2, y2);
          g.stroke();
        }
      }

      // 6-lobed scalloped botanical medallion frame
      const mgrad = f.createLinearGradient(cx - ra, cy - ra, cx + ra, cy + ra);
      mgrad.addColorStop(0, '#fae09b');
      mgrad.addColorStop(0.5, '#7cf0c0');
      mgrad.addColorStop(1, '#9be8ff');
      f.strokeStyle = mgrad;
      f.lineWidth = 1.55 * s;
      tracePoly(f, outerPts, true);
      f.stroke();

      f.strokeStyle = 'rgba(248,218,144,.36)';
      f.lineWidth = 0.8 * s;
      tracePoly(f, innerPts, true);
      f.stroke();

      // Twin sculpted feathered-wing flourishes on upper-left & upper-right medallion shoulders
      const lift = Math.sin(t * 1.2) * 0.055;
      for (const sd of [-1, 1]) {
        const ax = cx + sd * ra * 1.02;
        const ay = cy - ra * 0.72;
        const baseA = sd === 1 ? -0.42 : Math.PI + 0.42;
        for (let k = 0; k < 3; k += 1) {
          const flen = (13.5 - k * 2.6) * s;
          const fwid = (3.1 - k * 0.45) * s;
          const ang = baseA + sd * (k * 0.26 - lift);
          leaf(f, ax, ay + k * 2.2 * s, flen, fwid, ang, k === 0 ? '#fff2cc' : '#8ff4ca', k === 0 ? '#dfb25b' : '#2d8d6c', 0.45);
        }
      }

      // Smooth starlight comets orbiting the 6 scalloped cusps
      const u = frac(t * 0.14);
      traceComet(f, rosetteM, u, 0.16, gold, 1.75 * s, 0.85, s, 18);
      traceComet(f, rosetteM, frac(u + 0.5), 0.16, jade, 1.6 * s, 0.8, s, 18);

      // 6 cusp jewel highlights + bottom veterinary cross medallion gem
      for (let i = 0; i < cusps.length; i += 1) {
        const [px, py] = cusps[i];
        if (i === 3) continue; // bottom cusp holds veterinary cross emblem
        const tw = 0.6 + 0.4 * Math.sin(t * 1.8 + i * 1.1);
        sparkle(f, px, py, 2.0 * s * tw, i % 2 === 0 ? gold : jade, 0.72 * tw);
      }
      const [bx, by] = cusps[3];
      glow(f, bx, by, 7.5 * s, jade, 0.65);
      f.fillStyle = '#0d221c';
      f.strokeStyle = '#f8da90';
      f.lineWidth = 1.05 * s;
      f.beginPath();
      f.arc(bx, by, 4.4 * s, 0, TAU);
      f.fill();
      f.stroke();
      f.strokeStyle = '#9ef7d6';
      f.lineWidth = 1.35 * s;
      f.lineCap = 'round';
      f.beginPath();
      f.moveTo(bx - 2.2 * s, by);
      f.lineTo(bx + 2.2 * s, by);
      f.moveTo(bx, by - 2.2 * s);
      f.lineTo(bx, by + 2.2 * s);
      f.stroke();
    };
  }, { fullCard: true, cardFrame: ['106,242,190', '248,218,144', 'arc'] });

  def('iponcoins', 'Peso Cascade', 'myIPON', 'A milled sovereign coin medallion frames your avatar while 3D gilded peso coins glide smoothly across your full profile.', 1, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const gold = '248,214,122';
    const emer = '112,232,176';
    const ivory = '255,246,216';
    const cardM = full ? cardFrameMetrics(W, H, 5 * s, 16 * s) : null;
    const rimPts = Array.from({ length: 48 }, (_, i) => {
      const a = -Math.PI / 2 + (i / 48) * TAU;
      return [cx + Math.cos(a) * ra * 1.24, cy + Math.sin(a) * ra * 1.24];
    });
    const rimM = pathMetrics(rimPts, true);
    const coinCount = full ? 10 : 6;
    const coins = Array.from({ length: coinCount }, (_, i) => {
      // Keep full-card coins focused along left/right flanks & banner so text stays crystal clear
      const side = i % 2 === 0 ? 0.08 + (i % 3) * 0.055 : 0.92 - (i % 3) * 0.055;
      return {
        x: full ? W * (i % 5 === 0 ? 0.52 + (i % 2 ? 0.24 : -0.1) : side) : ((i + 0.5) / coinCount) * W,
        y0: (i / coinCount) + R(0, 0.12),
        v: R(0.048, 0.088),
        r: R(5.4, 8.6),
        sp: R(1.1, 1.9) * (i % 2 ? 1 : -1),
        ph: R(0, TAU),
        tilt: R(-0.22, 0.22),
        amp: R(5, 11)
      };
    });
    const glints = Array.from({ length: full ? 14 : 8 }, (_, i) => ({
      x: ((i + 0.3) / (full ? 14 : 8)) * W,
      y0: R(0, 1),
      v: R(0.035, 0.07),
      ph: R(0, TAU),
      r: R(1.4, 2.5)
    }));
    return (t) => {
      // Full-card minted bullion border + double-notched corner coin clasps
      if (cardM) {
        b.strokeStyle = 'rgba(248,214,122,.28)';
        b.lineWidth = 1.2 * s;
        tracePoly(b, cardM.pts, true);
        b.stroke();
        b.strokeStyle = 'rgba(112,232,176,.16)';
        b.lineWidth = 0.8 * s;
        const innerC = cardFrameMetrics(W, H, 9 * s, 13 * s);
        tracePoly(b, innerC.pts, true);
        b.stroke();
        for (const [qx, qy] of [[9 * s, 9 * s], [W - 9 * s, 9 * s], [W - 9 * s, H - 9 * s], [9 * s, H - 9 * s]]) {
          f.fillStyle = '#0a2219';
          f.strokeStyle = 'rgba(248,214,122,.72)';
          f.lineWidth = 1.05 * s;
          f.beginPath();
          f.arc(qx, qy, 3.2 * s, 0, TAU);
          f.fill();
          f.stroke();
        }
        const cu = frac(t * 0.08);
        traceComet(f, cardM.m, cu, 0.14, gold, 1.45 * s, 0.78, s, 20);
        traceComet(f, cardM.m, frac(cu + 0.5), 0.12, emer, 1.2 * s, 0.58, s, 16);
      }

      // Soft warm gold-emerald ambient dust across full height
      for (const gl of glints) {
        const prog = frac(gl.y0 + t * gl.v);
        const y = H * (1.03 - prog * 1.08);
        const x = gl.x + Math.sin(t * 0.65 + gl.ph) * 7 * s;
        const fade = Math.sin(prog * Math.PI) * 0.5;
        sparkle(b, x, y, gl.r * s, gold, fade);
      }

      // 3D spinning gold peso coins cascading serenely top-to-bottom across the full profile
      for (const c of coins) {
        const prog = frac(c.y0 + t * c.v);
        const y = -12 * s + prog * (H + 24 * s);
        const x = c.x + Math.sin(t * 0.75 + c.ph) * c.amp * s;
        const edgeFade = Math.sin(prog * Math.PI);
        const centerDim = full && y > cy + ra * 1.25 && x > W * 0.18 && x < W * 0.82 ? 0.34 : 0.86;
        drawCoin(b, x, y, c.r * s, t * c.sp + c.ph, c.tilt + Math.sin(t * 0.8 + c.ph) * 0.12, edgeFade * centerDim);
      }

      // Milled 36-notch sovereign gold coin rim around avatar
      glow(b, cx, cy, ra * 1.56, gold, 0.11 + 0.03 * Math.sin(t * 1.2));
      f.strokeStyle = 'rgba(248,214,122,.82)';
      f.lineWidth = 1.65 * s;
      f.beginPath();
      f.arc(cx, cy, ra * 1.24, 0, TAU);
      f.stroke();
      f.strokeStyle = 'rgba(112,232,176,.46)';
      f.lineWidth = 0.85 * s;
      f.beginPath();
      f.arc(cx, cy, ra * 1.12, 0, TAU);
      f.stroke();

      // 36 precision reeded mint notches
      f.strokeStyle = 'rgba(255,244,205,.62)';
      f.lineWidth = 0.9 * s;
      f.lineCap = 'round';
      f.beginPath();
      for (let i = 0; i < 36; i += 1) {
        const a = (i / 36) * TAU + t * 0.06;
        const r1 = ra * 1.14;
        const r2 = ra * (i % 3 === 0 ? 1.29 : 1.24);
        f.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        f.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      }
      f.stroke();

      // Silky gold shimmer gliding around sovereign coin rim
      const u = frac(t * 0.16);
      traceComet(f, rimM, u, 0.2, ivory, 1.8 * s, 0.84, s, 18);
      traceComet(f, rimM, frac(u + 0.5), 0.16, emer, 1.35 * s, 0.65, s, 14);

      // Gleaming ₱ sovereign hallmark clasp at bottom center of avatar rim
      const hx = cx;
      const hy = cy + ra * 1.25;
      glow(f, hx, hy, 7 * s, gold, 0.62);
      f.fillStyle = '#09241a';
      f.strokeStyle = '#f8dc84';
      f.lineWidth = 1.25 * s;
      f.beginPath();
      f.arc(hx, hy, 5.2 * s, 0, TAU);
      f.fill();
      f.stroke();
      f.fillStyle = '#fce7a2';
      f.font = `700 ${Math.max(6, Math.round(7.6 * s))}px Arial,sans-serif`;
      f.fillText('₱', hx - 2.3 * s, hy + 2.7 * s);
    };
  }, { fullCard: true });

  def('iponsprout', 'Emerald Harvest', 'myIPON', 'Inspired by the myIPON emblem: living emerald sprouts unfurl around a gilded coin cradle as savings glints rise across your entire profile.', 2, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const gold = '248,218,130';
    const sprout = '118,214,88';
    const emer = '84,228,172';
    const cardM = full ? cardFrameMetrics(W, H, 5 * s, 16 * s) : null;
    const leftArc = [];
    const rightArc = [];
    for (let i = 0; i <= 18; i += 1) {
      const k = i / 18;
      const al = Math.PI * 0.5 + k * Math.PI * 0.78;
      const ar = Math.PI * 0.5 - k * Math.PI * 0.78;
      const rad = ra * (1.17 + 0.08 * Math.sin(k * Math.PI));
      leftArc.push([cx + Math.cos(al) * rad, cy + Math.sin(al) * rad]);
      rightArc.push([cx + Math.cos(ar) * rad, cy + Math.sin(ar) * rad]);
    }
    const leftM = pathMetrics(leftArc, false);
    const rightM = pathMetrics(rightArc, false);
    const rising = Array.from({ length: full ? 14 : 9 }, (_, i) => ({
      x: ((i + 0.35) / (full ? 14 : 9)) * W,
      y0: R(0, 1),
      v: R(0.042, 0.078),
      ph: R(0, TAU),
      amp: R(6, 13),
      coin: i % 3 === 0,
      r: R(3.2, 5.4)
    }));
    return (t) => {
      // Full-profile organic emerald-gold vine border & bottom-right stacked coin silhouette
      if (cardM) {
        b.strokeStyle = 'rgba(118,214,88,.26)';
        b.lineWidth = 1.15 * s;
        tracePoly(b, cardM.pts, true);
        b.stroke();
        // Living sprout leaf flourishes at bottom-left and bottom-right card corners
        const swayC = Math.sin(t * 1.1) * 0.07;
        leaf(f, 12 * s, H - 12 * s, 15 * s, 4.5 * s, -0.55 + swayC, '#8ae068', '#2a7d46', 0.4);
        leaf(f, 12 * s, H - 12 * s, 11 * s, 3.6 * s, -1.15 - swayC, '#f8dc84', '#b88326', 0.35);
        leaf(f, W - 12 * s, H - 12 * s, 15 * s, 4.5 * s, Math.PI + 0.55 - swayC, '#8ae068', '#2a7d46', 0.4);
        leaf(f, W - 12 * s, H - 12 * s, 11 * s, 3.6 * s, Math.PI + 1.15 + swayC, '#f8dc84', '#b88326', 0.35);
        // Subtle glowing myIPON coin-stack watermark in bottom-right background
        const sx = W - 26 * s;
        const sy = H - 18 * s;
        for (let k = 0; k < 3; k += 1) {
          const yk = sy - k * 5.2 * s;
          b.fillStyle = `rgba(248,218,130,${0.14 + k * 0.04})`;
          b.strokeStyle = `rgba(248,218,130,${0.28 + k * 0.06})`;
          b.lineWidth = 0.85 * s;
          b.beginPath();
          b.ellipse(sx, yk, 11 * s, 3.8 * s, 0, 0, TAU);
          b.fill();
          b.stroke();
        }
        const cu = frac(t * 0.09);
        traceComet(f, cardM.m, cu, 0.14, sprout, 1.35 * s, 0.72, s, 18);
        traceComet(f, cardM.m, frac(cu + 0.5), 0.14, gold, 1.35 * s, 0.72, s, 18);
      }

      // Soft rising mini peso coins & chlorophyll dew sparkles across the entire profile
      for (const p of rising) {
        const prog = frac(p.y0 + t * p.v);
        const y = H * (1.04 - prog * 1.12);
        const x = p.x + Math.sin(t * 0.7 + p.ph) * p.amp * s;
        const fade = Math.sin(prog * Math.PI);
        const dim = full && y > cy + ra * 1.3 && x > W * 0.2 && x < W * 0.8 ? 0.38 : 0.76;
        if (p.coin) {
          drawCoin(b, x, y, p.r * s, t * 1.35 + p.ph, 0.12, fade * dim * 0.85);
        } else {
          glow(b, x, y, p.r * 2.1 * s, sprout, fade * dim * 0.55);
          b.fillStyle = `rgba(230,255,220,${fade * dim * 0.8})`;
          b.beginPath();
          b.arc(x, y, 1.1 * s, 0, TAU);
          b.fill();
        }
      }

      // Sculpted golden coin-arc crescent cradling bottom of avatar
      glow(b, cx, cy, ra * 1.58, emer, 0.1 + 0.03 * Math.sin(t * 1.1));
      f.strokeStyle = '#f5d274';
      f.lineWidth = 2.1 * s;
      f.lineCap = 'round';
      f.beginPath();
      f.arc(cx, cy, ra * 1.17, Math.PI * 0.18, Math.PI * 0.82);
      f.stroke();

      // Twin living emerald sprout shoots curling up both flanks
      for (const pts of [leftArc, rightArc]) {
        f.strokeStyle = 'rgba(118,214,88,.84)';
        f.lineWidth = 1.45 * s;
        tracePoly(f, pts, false);
        f.stroke();
      }
      const breathe = Math.sin(t * 1.35) * 0.07;
      for (const sd of [-1, 1]) {
        // Upper unfurling twin myIPON sprout leaves near top shoulders
        const topPt = sd === -1 ? leftArc[leftArc.length - 1] : rightArc[rightArc.length - 1];
        const midPt = sd === -1 ? leftArc[11] : rightArc[11];
        leaf(f, topPt[0], topPt[1], ra * 0.44, ra * 0.16, (sd === 1 ? -0.58 : Math.PI + 0.58) + sd * breathe, '#8fe36a', '#2c8246', 0.48);
        leaf(f, topPt[0], topPt[1], ra * 0.32, ra * 0.12, (sd === 1 ? -1.32 : Math.PI + 1.32) - sd * breathe, '#b6f28a', '#3d9950', 0.35);
        leaf(f, midPt[0], midPt[1], ra * 0.28, ra * 0.1, (sd === 1 ? -0.25 : Math.PI + 0.25) + sd * breathe * 0.7, '#f8dc84', '#b67f22', 0.35);
      }

      // Symmetrical golden-emerald sap pulses rising to top sprout crown
      const wave = frac(t * 0.2);
      traceComet(f, leftM, wave, 0.24, gold, 1.55 * s, 0.78, s, 14);
      traceComet(f, rightM, wave, 0.24, gold, 1.55 * s, 0.78, s, 14);

      // Dewdrop crown glint between twin sprouts at top center
      const topBloom = 0.65 + 0.35 * Math.sin(t * 1.9);
      sparkle(f, cx, cy - ra * 1.24, 3.6 * s * topBloom, gold, 0.85);
    };
  }, { fullCard: true });

  def('iponvault', 'Sovereign Vault', 'myIPON', 'A horological bank-vault locking dial and riveted champagne-emerald chassis guard your entire profile card.', 2, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const gold = '242,208,132';
    const emer = '92,236,184';
    const cardM = full ? cardFrameMetrics(W, H, 5 * s, 14 * s) : null;
    const dialPts = Array.from({ length: 48 }, (_, i) => {
      const a = -Math.PI / 2 + (i / 48) * TAU;
      return [cx + Math.cos(a) * ra * 1.28, cy + Math.sin(a) * ra * 1.28];
    });
    const dialM = pathMetrics(dialPts, true);
    const facets = Array.from({ length: full ? 14 : 8 }, (_, i) => ({
      x: ((i + 0.4) / (full ? 14 : 8)) * W,
      y0: R(0, 1),
      v: R(0.032, 0.062),
      ph: R(0, TAU),
      sz: R(2.2, 3.8),
      c: i % 2 === 0 ? emer : gold
    }));
    return (t) => {
      // Full-profile heavy-luxury riveted chamfered vault chassis
      if (cardM) {
        b.strokeStyle = 'rgba(242,208,132,.30)';
        b.lineWidth = 1.3 * s;
        tracePoly(b, cardM.pts, true);
        b.stroke();
        drawCardCorners(f, W, H, 6 * s, 18 * s, gold, 1.65 * s, 0.76, 'chamfer');
        // Corner vault rivets
        for (const [rx, ry] of [[12 * s, 12 * s], [W - 12 * s, 12 * s], [W - 12 * s, H - 12 * s], [12 * s, H - 12 * s]]) {
          f.fillStyle = '#0c2019';
          f.strokeStyle = 'rgba(92,236,184,.72)';
          f.lineWidth = 1.0 * s;
          f.beginPath();
          f.arc(rx, ry, 2.2 * s, 0, TAU);
          f.fill();
          f.stroke();
        }
        const su = frac(t * 0.09);
        traceComet(f, cardM.m, su, 0.14, emer, 1.45 * s, 0.78, s, 20);
        traceComet(f, cardM.m, frac(su + 0.5), 0.14, gold, 1.45 * s, 0.72, s, 18);
      }

      // Weightless floating emerald-gold crystal facets across full height
      for (const q of facets) {
        const prog = frac(q.y0 + t * q.v);
        const y = H * (1.03 - prog * 1.08);
        const x = q.x + Math.sin(t * 0.55 + q.ph) * 6 * s;
        const fade = Math.sin(prog * Math.PI) * (full && y > cy + ra * 1.3 && x > W * 0.18 && x < W * 0.82 ? 0.28 : 0.62);
        b.save();
        b.translate(x, y);
        b.rotate(t * 0.45 + q.ph);
        b.strokeStyle = `rgba(${q.c},${fade})`;
        b.lineWidth = 0.9 * s;
        const sz = q.sz * s;
        b.beginPath();
        b.moveTo(0, -sz);
        b.lineTo(sz * 0.72, 0);
        b.lineTo(0, sz);
        b.lineTo(-sz * 0.72, 0);
        b.closePath();
        b.stroke();
        b.restore();
      }

      // Horological smooth-stepped dial rotation (turns smoothly then pauses briefly at lock detents)
      const stepPhase = t * 0.25;
      const stepFloor = Math.floor(stepPhase);
      const stepFrac = stepPhase - stepFloor;
      const eased = stepFrac < 0.65 ? (0.5 - 0.5 * Math.cos((stepFrac / 0.65) * Math.PI)) : 1;
      const dialAngle = (stepFloor + eased) * (Math.PI / 6);
      const lockedFlash = stepFrac > 0.62 && stepFrac < 0.85 ? Math.sin(((stepFrac - 0.62) / 0.23) * Math.PI) : 0;

      // Outer brushed-gold vault bezel + 4 recessed diagonal locking lugs
      glow(b, cx, cy, ra * 1.62, emer, 0.08 + lockedFlash * 0.12);
      f.strokeStyle = 'rgba(242,208,132,.84)';
      f.lineWidth = 1.75 * s;
      f.beginPath();
      f.arc(cx, cy, ra * 1.28, 0, TAU);
      f.stroke();

      // Rotating inner combination calibration ring & 24 micro-ticks
      f.strokeStyle = 'rgba(92,236,184,.54)';
      f.lineWidth = 0.95 * s;
      f.beginPath();
      f.arc(cx, cy, ra * 1.13, 0, TAU);
      f.stroke();
      f.strokeStyle = `rgba(255,244,212,${0.48 + lockedFlash * 0.35})`;
      f.lineWidth = 0.9 * s;
      f.beginPath();
      for (let i = 0; i < 24; i += 1) {
        const a = dialAngle + (i / 24) * TAU;
        const r1 = ra * 1.13;
        const r2 = ra * (i % 6 === 0 ? 1.25 : 1.19);
        f.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        f.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      }
      f.stroke();

      // 4 diagonal vault locking lugs + emerald security status beads
      for (let i = 0; i < 4; i += 1) {
        const a = Math.PI * 0.25 + i * Math.PI * 0.5;
        const lx = cx + Math.cos(a) * ra * 1.32;
        const ly = cy + Math.sin(a) * ra * 1.32;
        f.save();
        f.translate(lx, ly);
        f.rotate(a);
        f.fillStyle = '#0e241c';
        f.strokeStyle = '#f2d084';
        f.lineWidth = 1.1 * s;
        rr(f, -3.4 * s, -4.4 * s, 6.8 * s, 8.8 * s, 2.2 * s);
        f.fill();
        f.stroke();
        f.fillStyle = `rgba(${emer},${0.55 + lockedFlash * 0.45})`;
        f.beginPath();
        f.arc(0, 0, 1.5 * s, 0, TAU);
        f.fill();
        f.restore();
        if (lockedFlash > 0.05) glow(f, lx, ly, 6.5 * s, emer, lockedFlash * 0.7);
      }

      // Smooth dial sweep glint
      traceComet(f, dialM, frac(t * 0.14), 0.18, gold, 1.6 * s, 0.78, s, 16);
    };
  }, { fullCard: true });

  def('orrery', 'Celestial Academy', 'Education', 'Interlocking brass armillary rings and an engraved star-atlas border illuminate your entire profile.', 2, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const brass = '244,210,136';
    const starC = '186,216,255';
    const cardM = full ? cardFrameMetrics(W, H, 5 * s, 16 * s) : null;
    const stars = Array.from({ length: full ? 24 : 12 }, (_, i) => ({
      x: ((i * 0.37 + 0.13) % 1) * W,
      y: ((i * 0.61 + 0.09) % 1) * H,
      p: R(0, TAU),
      v: R(0.7, 1.6),
      r: R(0.7, 1.5)
    }));
    return (t) => {
      // Engraved observatory star-atlas border & corner astrolabe quadrants
      if (cardM) {
        b.strokeStyle = 'rgba(244,210,136,.26)';
        b.lineWidth = 1.05 * s;
        tracePoly(b, cardM.pts, true);
        b.stroke();
        // Corner brass astrolabe quadrant arcs
        f.strokeStyle = 'rgba(244,210,136,.52)';
        f.lineWidth = 1.0 * s;
        for (const [qx, qy, a0, a1] of [
          [6 * s, 6 * s, 0, Math.PI * 0.5],
          [W - 6 * s, 6 * s, Math.PI * 0.5, Math.PI],
          [W - 6 * s, H - 6 * s, Math.PI, Math.PI * 1.5],
          [6 * s, H - 6 * s, Math.PI * 1.5, TAU]
        ]) {
          f.beginPath();
          f.arc(qx, qy, 15 * s, a0, a1);
          f.stroke();
        }
        traceComet(f, cardM.m, frac(t * 0.075), 0.14, brass, 1.35 * s, 0.72, s, 18);
      }

      // Soft star-atlas constellation background across entire card
      for (const st of stars) {
        const tw = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * st.v + st.p));
        b.fillStyle = `rgba(${starC},${tw * 0.55})`;
        b.beginPath();
        b.arc(st.x, st.y, st.r * s, 0, TAU);
        b.fill();
      }

      // Brass Armillary Sphere interlocking meridian gimbals around avatar (back & front 3D split)
      const gimbals = [
        { rx: 1.34, ry: 0.92, rot: -0.45 + Math.sin(t * 0.28) * 0.12, sp: 0.34, c: brass, ph: 0 },
        { rx: 1.34, ry: 0.92, rot: 0.45 - Math.sin(t * 0.28) * 0.12, sp: -0.28, c: starC, ph: 2.1 }
      ];
      // Outer equatorial brass ring
      f.strokeStyle = 'rgba(244,210,136,.74)';
      f.lineWidth = 1.45 * s;
      f.beginPath();
      f.arc(cx, cy, ra * 1.22, 0, TAU);
      f.stroke();

      for (const gm of gimbals) {
        const A = ra * gm.rx;
        const B = ra * gm.ry;
        // Draw back half on b, front half on f (only arcs outside avatar radius stay crisp; we draw full rings with gentle alpha on b so face stays 100% clear)
        b.strokeStyle = `rgba(${gm.c},.56)`;
        b.lineWidth = 1.15 * s;
        b.beginPath();
        b.ellipse(cx, cy, A, B, gm.rot, 0, TAU);
        b.stroke();

        // Orbiting planetary pearl along gimbal path (foreground only outside avatar circle)
        const th = t * gm.sp + gm.ph;
        const ex = A * Math.cos(th);
        const ey = B * Math.sin(th);
        const px = cx + ex * Math.cos(gm.rot) - ey * Math.sin(gm.rot);
        const py = cy + ex * Math.sin(gm.rot) + ey * Math.cos(gm.rot);
        const g = Math.hypot(px - cx, py - cy) > ra * 1.06 ? f : b;
        glow(g, px, py, 7.5 * s, gm.c, 0.78);
        g.fillStyle = '#fff9ea';
        g.beginPath();
        g.arc(px, py, 2.2 * s, 0, TAU);
        g.fill();
      }

      // Top meridian brass finial spire & bottom compass needle tip
      f.strokeStyle = 'rgba(244,210,136,.85)';
      f.lineWidth = 1.25 * s;
      f.lineCap = 'round';
      f.beginPath();
      f.moveTo(cx, cy - ra * 1.22);
      f.lineTo(cx, cy - ra * 1.40);
      f.moveTo(cx, cy + ra * 1.22);
      f.lineTo(cx, cy + ra * 1.38);
      f.stroke();
      sparkle(f, cx, cy - ra * 1.40, 2.8 * s, brass, 0.85);
      sparkle(f, cx, cy + ra * 1.38, 2.0 * s, starC, 0.72);
    };
  }, { fullCard: true });

  def('diploma', 'Honor Seal', 'Education', 'A 20-point embossed academic wax seal with fluttering honor ribbons and parchment filigree frames your entire profile.', 1, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const gold = '246,208,124';
    const crim = '232,116,136';
    const ivory = '255,246,226';
    const cardM = full ? cardFrameMetrics(W, H, 6 * s, 14 * s) : null;
    // 20-tooth serrated embossed academic wax-seal medallion
    const teeth = 20;
    const sealPts = [];
    const N = teeth * 4;
    for (let i = 0; i < N; i += 1) {
      const a = -Math.PI / 2 + (i / N) * TAU;
      const r = ra * (1.22 + 0.075 * Math.cos(teeth * a));
      sealPts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    const sealM = pathMetrics(sealPts, true);
    const specks = Array.from({ length: full ? 14 : 8 }, (_, i) => ({
      x: ((i + 0.35) / (full ? 14 : 8)) * W,
      y0: R(0, 1),
      v: R(0.036, 0.068),
      ph: R(0, TAU),
      r: R(1.3, 2.3)
    }));
    return (t) => {
      // Double-ruled parchment diploma full-card border with classic scrollwork corner finials
      if (cardM) {
        b.strokeStyle = 'rgba(246,208,124,.30)';
        b.lineWidth = 1.2 * s;
        tracePoly(b, cardM.pts, true);
        b.stroke();
        drawCardCorners(f, W, H, 7 * s, 16 * s, gold, 1.3 * s, 0.65, 'double');
        const cu = frac(t * 0.085);
        traceComet(f, cardM.m, cu, 0.14, gold, 1.35 * s, 0.74, s, 18);
        traceComet(f, cardM.m, frac(cu + 0.5), 0.12, crim, 1.2 * s, 0.56, s, 16);
      }

      // Soft warm gold honor dust floating across the entire card
      for (const sp of specks) {
        const prog = frac(sp.y0 + t * sp.v);
        const y = H * (1.03 - prog * 1.08);
        const x = sp.x + Math.sin(t * 0.65 + sp.ph) * 7 * s;
        const fade = Math.sin(prog * Math.PI) * 0.54;
        sparkle(b, x, y, sp.r * s, gold, fade);
      }

      // Twin pleated crimson-gold academic honor ribbons trailing smoothly beneath seal
      const rbY = cy + ra * 1.12;
      for (const sd of [-1, 1]) {
        const fl = Math.sin(t * 1.45 + sd * 0.9) * 2.2 * s;
        const rg = b.createLinearGradient(cx, rbY, cx + sd * ra * 0.62, rbY + ra * 0.74);
        rg.addColorStop(0, 'rgba(220,96,118,.82)');
        rg.addColorStop(1, 'rgba(246,208,124,.55)');
        b.fillStyle = rg;
        b.strokeStyle = 'rgba(246,208,124,.75)';
        b.lineWidth = 0.85 * s;
        b.beginPath();
        b.moveTo(cx + sd * ra * 0.14, rbY);
        b.lineTo(cx + sd * ra * 0.48, rbY - ra * 0.06);
        b.quadraticCurveTo(cx + sd * ra * 0.56 + fl * 0.5, rbY + ra * 0.34, cx + sd * ra * 0.66 + fl, rbY + ra * 0.66);
        b.lineTo(cx + sd * ra * 0.44 + fl * 0.8, rbY + ra * 0.54);
        b.lineTo(cx + sd * ra * 0.30 + fl * 0.6, rbY + ra * 0.72);
        b.closePath();
        b.fill();
        b.stroke();
      }

      // 20-tooth embossed crimson-gold wax-seal border
      glow(b, cx, cy, ra * 1.56, crim, 0.1 + 0.03 * Math.sin(t * 1.1));
      const sg = f.createLinearGradient(cx - ra, cy - ra, cx + ra, cy + ra);
      sg.addColorStop(0, '#fae09a');
      sg.addColorStop(0.5, '#e8788a');
      sg.addColorStop(1, '#f4c76e');
      f.strokeStyle = sg;
      f.lineWidth = 1.65 * s;
      tracePoly(f, sealPts, true);
      f.stroke();

      f.strokeStyle = 'rgba(255,246,226,.46)';
      f.lineWidth = 0.85 * s;
      f.beginPath();
      f.arc(cx, cy, ra * 1.12, 0, TAU);
      f.stroke();

      // Smooth champagne sheen tracing the scalloped seal teeth
      traceComet(f, sealM, frac(t * 0.15), 0.18, ivory, 1.65 * s, 0.8, s, 18);
    };
  }, { fullCard: true });

  def('cybergrid', 'Syntax Matrix', 'Information Technology', 'Asymmetric code brackets and calm floating syntax glyphs frame your entire profile in crisp emerald-cyan telemetry.', 1, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const cyan = '84,242,226';
    const mint = '132,248,186';
    const amber = '248,208,118';
    const cardM = full ? cardFrameMetrics(W, H, 5 * s, 12 * s) : null;
    // Asymmetric < / > chamfered code-bracket shield around avatar
    const rx = ra * 1.38;
    const ry = ra * 1.24;
    const leftBr = [
      [cx - ra * 0.42, cy - ry],
      [cx - ra * 0.96, cy - ry],
      [cx - rx, cy],
      [cx - ra * 0.96, cy + ry],
      [cx - ra * 0.42, cy + ry]
    ];
    const rightBr = [
      [cx + ra * 0.42, cy - ry],
      [cx + ra * 0.96, cy - ry],
      [cx + rx, cy],
      [cx + ra * 0.96, cy + ry],
      [cx + ra * 0.42, cy + ry]
    ];
    const leftM = pathMetrics(leftBr, false);
    const rightM = pathMetrics(rightBr, false);
    const glyphs = ['</>', '{ }', '=>', '01', '::', '[]', '&&', 'fn'];
    const tokens = Array.from({ length: full ? 12 : 6 }, (_, i) => ({
      x: full ? (i % 2 === 0 ? W * (0.05 + (i % 3) * 0.04) : W * (0.83 + (i % 3) * 0.04)) : ((i + 0.4) / 6) * W,
      y0: (i / (full ? 12 : 6)) + R(0, 0.08),
      v: R(0.032, 0.058),
      txt: glyphs[i % glyphs.length],
      c: i % 3 === 0 ? mint : cyan
    }));
    return (t) => {
      // Full-profile HUD terminal chassis with notched corners & coordinate side ticks
      if (cardM) {
        b.strokeStyle = 'rgba(84,242,226,.22)';
        b.lineWidth = 1.0 * s;
        tracePoly(b, cardM.pts, true);
        b.stroke();
        drawCardCorners(f, W, H, 6 * s, 16 * s, cyan, 1.45 * s, 0.68, 'chamfer');
        // Minimal side telemetry ruler ticks
        b.strokeStyle = 'rgba(132,248,186,.24)';
        b.lineWidth = 0.85 * s;
        b.beginPath();
        for (let y = 34 * s; y < H - 30 * s; y += 22 * s) {
          b.moveTo(W - 8 * s, y);
          b.lineTo(W - 12.5 * s, y);
        }
        b.stroke();
        traceComet(f, cardM.m, frac(t * 0.095), 0.14, cyan, 1.35 * s, 0.74, s, 18);
      }

      // Calm margin-drifting syntax tokens (low contrast so profile text stays spotless)
      b.font = `600 ${Math.max(7, Math.round(8.2 * s))}px ui-monospace,Menlo,monospace`;
      for (const tk of tokens) {
        const prog = frac(tk.y0 + t * tk.v);
        const y = 12 * s + prog * (H - 20 * s);
        const fade = Math.sin(prog * Math.PI) * 0.34;
        b.fillStyle = `rgba(${tk.c},${fade})`;
        b.fillText(tk.txt, tk.x, y);
      }

      // Code-bracket < > avatar frame + top/bottom hairline syntax bridges
      f.lineCap = 'round';
      f.strokeStyle = 'rgba(84,242,226,.85)';
      f.lineWidth = 1.75 * s;
      tracePoly(f, leftBr, false);
      f.stroke();
      tracePoly(f, rightBr, false);
      f.stroke();

      f.strokeStyle = 'rgba(132,248,186,.42)';
      f.lineWidth = 0.9 * s;
      f.setLineDash([3 * s, 3.5 * s]);
      f.beginPath();
      f.moveTo(cx - ra * 0.32, cy - ry);
      f.lineTo(cx + ra * 0.32, cy - ry);
      f.moveTo(cx - ra * 0.32, cy + ry);
      f.lineTo(cx + ra * 0.32, cy + ry);
      f.stroke();
      f.setLineDash([]);

      // 3 crisp IDE window indicator micro-dots at top-left bracket shoulder
      const dotCols = [amber, mint, cyan];
      for (let i = 0; i < 3; i += 1) {
        const pulse = 0.55 + 0.45 * Math.sin(t * 1.8 + i * 1.1);
        f.fillStyle = `rgba(${dotCols[i]},${pulse})`;
        f.beginPath();
        f.arc(cx - ra * 0.88 + i * 4.2 * s, cy - ry - 4.2 * s, 1.35 * s, 0, TAU);
        f.fill();
      }

      // Compiler light pulses tracing both < and > brackets synchronously
      const u = frac(t * 0.24);
      traceComet(f, leftM, u, 0.28, mint, 1.7 * s, 0.82, s, 14);
      traceComet(f, rightM, u, 0.28, cyan, 1.7 * s, 0.82, s, 14);
    };
  }, { fullCard: true });

  def('fibercloud', 'Optic Lattice', 'Information Technology', 'A curved Reuleaux delta-core prism guides silky fiber-optic light streams from top to bottom of your profile.', 2, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const aqua = '98,238,255';
    const blue = '112,158,255';
    const pearl = '238,250,255';
    const cardM = full ? cardFrameMetrics(W, H, 5 * s, 18 * s) : null;
    // 3-lobed curved Reuleaux triangle (rounded tri-wing delta core)
    const buildDelta = (baseK, ampK) => {
      const pts = [];
      const N = 72;
      for (let i = 0; i < N; i += 1) {
        const a = -Math.PI / 2 + (i / N) * TAU;
        const r = ra * (baseK + ampK * Math.cos(3 * (a + Math.PI / 2)));
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      return pts;
    };
    const outerPts = buildDelta(1.25, 0.13);
    const innerPts = buildDelta(1.13, 0.08);
    const deltaM = pathMetrics(outerPts, true);
    const ports = Array.from({ length: 3 }, (_, i) => {
      const a = -Math.PI / 2 + (i / 3) * TAU;
      return [cx + Math.cos(a) * ra * 1.38, cy + Math.sin(a) * ra * 1.38];
    });
    // Graceful full-height arching fiber-optic ribbons along outer flanks
    const fibers = [
      { x0: W * 0.04, x1: W * 0.16, ph: 0.0, c: aqua },
      { x0: W * 0.96, x1: W * 0.84, ph: 0.35, c: blue },
      { x0: W * 0.92, x1: W * 0.76, ph: 0.68, c: aqua }
    ].map((fb) => {
      const pts = [];
      for (let i = 0; i <= 20; i += 1) {
        const k = i / 20;
        pts.push([fb.x0 + (fb.x1 - fb.x0) * Math.sin(k * Math.PI), k * H]);
      }
      return { ...fb, pts, m: pathMetrics(pts, false) };
    });
    return (t) => {
      // Full-card seamless fiber-optic light-pipe perimeter
      if (cardM) {
        b.strokeStyle = 'rgba(112,158,255,.24)';
        b.lineWidth = 1.15 * s;
        tracePoly(b, cardM.pts, true);
        b.stroke();
        const cu = frac(t * 0.1);
        traceComet(f, cardM.m, cu, 0.16, aqua, 1.5 * s, 0.8, s, 20);
        traceComet(f, cardM.m, frac(cu + 0.5), 0.16, blue, 1.4 * s, 0.74, s, 18);
      }

      // Silky vertical arching fiber-optic streams carrying photon packets along full card height
      for (const fb of fibers) {
        b.strokeStyle = `rgba(${fb.c},.14)`;
        b.lineWidth = 0.9 * s;
        tracePoly(b, fb.pts, false);
        b.stroke();
        traceComet(b, fb.m, frac(t * 0.22 + fb.ph), 0.24, fb.c, 1.3 * s, 0.68, s, 12);
      }

      // Curved 3-lobed Reuleaux Delta-Core frame around avatar
      glow(b, cx, cy, ra * 1.62, blue, 0.1 + 0.03 * Math.sin(t * 1.15));
      const dg = f.createLinearGradient(cx - ra, cy - ra, cx + ra, cy + ra);
      dg.addColorStop(0, '#8ff4ff');
      dg.addColorStop(0.55, '#78a8ff');
      dg.addColorStop(1, '#98f5e0');
      f.strokeStyle = dg;
      f.lineWidth = 1.7 * s;
      tracePoly(f, outerPts, true);
      f.stroke();

      f.strokeStyle = 'rgba(238,250,255,.38)';
      f.lineWidth = 0.85 * s;
      tracePoly(f, innerPts, true);
      f.stroke();

      // Bi-directional optic waves around the 3-lobed core
      const u = frac(t * 0.18);
      traceComet(f, deltaM, u, 0.18, pearl, 1.8 * s, 0.86, s, 18);
      traceComet(f, deltaM, frac(1 - u), 0.16, blue, 1.5 * s, 0.76, s, 16);

      // 3 glowing fiber-optic port nodes at the 3 rounded apexes (120 deg apart)
      for (let i = 0; i < 3; i += 1) {
        const [px, py] = ports[i];
        const pulse = 0.65 + 0.35 * Math.sin(t * 1.8 + i * 2.09);
        glow(f, px, py, 7 * s, aqua, 0.65 * pulse);
        f.fillStyle = '#0c1a2a';
        f.strokeStyle = '#9cf5ff';
        f.lineWidth = 1.2 * s;
        f.beginPath();
        f.arc(px, py, 2.7 * s, 0, TAU);
        f.fill();
        f.stroke();
      }
    };
  }, { fullCard: true });

  def('stainedglass', 'Cathedral Rose', 'Architecture', 'Twelve Gothic stained-glass lancet arches cast serene rotating jewel light shafts down your entire profile card.', 2, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const brass = '238,198,124';
    const cols = ['120,186,255', '110,236,192', '248,186,120', '224,142,216'];
    const cardM = full ? cardFrameMetrics(W, H, 5 * s, 16 * s) : null;
    const N = 12;
    const rosePts = [];
    for (let i = 0; i < N * 6; i += 1) {
      const a = -Math.PI / 2 + (i / (N * 6)) * TAU;
      const arch = Math.abs(Math.sin((N * a) * 0.5));
      const r = ra * (1.17 + 0.14 * arch);
      rosePts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    const roseM = pathMetrics(rosePts, true);
    const motes = Array.from({ length: full ? 14 : 8 }, (_, i) => ({
      x: ((i + 0.3) / (full ? 14 : 8)) * W,
      y0: R(0, 1),
      v: R(0.028, 0.055),
      ph: R(0, TAU),
      c: cols[i % cols.length]
    }));
    return (t) => {
      // Soft diagonal cathedral stained-glass prism light shafts drifting down full profile height
      for (let i = 0; i < 3; i += 1) {
        const bx = ((t * 9 * s + i * W * 0.42) % (W + H * 0.9)) - H * 0.35;
        const gr = b.createLinearGradient(bx - 28 * s, 0, bx + 28 * s, 0);
        gr.addColorStop(0, `rgba(${cols[i]},0)`);
        gr.addColorStop(0.5, `rgba(${cols[i]},.065)`);
        gr.addColorStop(1, `rgba(${cols[i]},0)`);
        b.fillStyle = gr;
        b.beginPath();
        b.moveTo(bx - 16 * s, 0);
        b.lineTo(bx + 26 * s, 0);
        b.lineTo(bx - 28 * s, H);
        b.lineTo(bx - 70 * s, H);
        b.closePath();
        b.fill();
      }

      // Full-profile leaded-glass Gothic border with pointed lancet top corners
      if (cardM) {
        b.strokeStyle = 'rgba(238,198,124,.28)';
        b.lineWidth = 1.2 * s;
        tracePoly(b, cardM.pts, true);
        b.stroke();
        drawCardCorners(f, W, H, 6 * s, 16 * s, brass, 1.35 * s, 0.64, 'arc');
        traceComet(f, cardM.m, frac(t * 0.075), 0.14, brass, 1.35 * s, 0.72, s, 18);
      }

      // Floating warm cathedral dust motes tinted by stained glass
      for (const m of motes) {
        const prog = frac(m.y0 + t * m.v);
        const y = H * (1.03 - prog * 1.08);
        const x = m.x + Math.sin(t * 0.55 + m.ph) * 8 * s;
        const a = Math.sin(prog * Math.PI) * 0.52;
        glow(b, x, y, 4.5 * s, m.c, a * 0.7);
      }

      // 12 translucent stained-glass jewel lancet petals behind gold tracery
      const shift = t * 0.14;
      for (let i = 0; i < N; i += 1) {
        const a0 = -Math.PI / 2 + (i / N) * TAU;
        const a1 = -Math.PI / 2 + ((i + 1) / N) * TAU;
        const am = (a0 + a1) * 0.5;
        const shimmer = 0.24 + 0.24 * (0.5 + 0.5 * Math.sin(shift * 3 + i * 0.9));
        f.fillStyle = `rgba(${cols[i % cols.length]},${shimmer})`;
        f.beginPath();
        f.moveTo(cx + Math.cos(a0) * ra * 1.12, cy + Math.sin(a0) * ra * 1.12);
        f.quadraticCurveTo(cx + Math.cos(am) * ra * 1.38, cy + Math.sin(am) * ra * 1.38, cx + Math.cos(a1) * ra * 1.12, cy + Math.sin(a1) * ra * 1.12);
        f.arc(cx, cy, ra * 1.12, a1, a0, true);
        f.closePath();
        f.fill();
      }

      // Warm bronze-gold Gothic rose-window leadwork tracery
      f.strokeStyle = 'rgba(238,198,124,.84)';
      f.lineWidth = 1.45 * s;
      tracePoly(f, rosePts, true);
      f.stroke();

      f.strokeStyle = 'rgba(255,242,208,.48)';
      f.lineWidth = 0.85 * s;
      f.beginPath();
      f.arc(cx, cy, ra * 1.12, 0, TAU);
      f.stroke();

      traceComet(f, roseM, frac(t * 0.13), 0.16, brass, 1.65 * s, 0.82, s, 18);
    };
  }, { fullCard: true });

  def('cantilever', 'Zenith Wireframe', 'Architecture', 'Offset Bauhaus cantilevered squares and a subtle modernist skyline wireframe refine your full profile card.', 1, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const plat = '222,232,240';
    const copp = '238,176,126';
    const cardM = full ? cardFrameMetrics(W, H, 6 * s, 10 * s) : null;
    const d = ra * 1.19;
    const off = ra * 0.11;
    const sq1 = [
      [cx - d, cy - d],
      [cx + d, cy - d],
      [cx + d, cy + d],
      [cx - d, cy + d]
    ];
    const sq2 = [
      [cx - d + off, cy - d - off],
      [cx + d + off, cy - d - off],
      [cx + d + off, cy + d - off],
      [cx - d + off, cy + d - off]
    ];
    const sq1M = pathMetrics(sq1, true);
    const sq2M = pathMetrics(sq2, true);
    return (t) => {
      // Modernist gallery full-card hairline frame + cantilevered copper beam & mm scale ticks
      if (cardM) {
        b.strokeStyle = 'rgba(222,232,240,.20)';
        b.lineWidth = 0.95 * s;
        tracePoly(b, cardM.pts, true);
        b.stroke();
        // Asymmetric cantilevered copper L-beam on left & bottom card margins
        f.strokeStyle = 'rgba(238,176,126,.65)';
        f.lineWidth = 1.8 * s;
        f.lineCap = 'round';
        f.beginPath();
        f.moveTo(6 * s, cy + ra * 1.45);
        f.lineTo(6 * s, H - 14 * s);
        f.quadraticCurveTo(6 * s, H - 6 * s, 14 * s, H - 6 * s);
        f.lineTo(W * 0.44, H - 6 * s);
        f.stroke();
        // Fine millimeter drafting scale ticks along right card margin
        b.strokeStyle = 'rgba(222,232,240,.22)';
        b.lineWidth = 0.8 * s;
        b.beginPath();
        for (let i = 0; i < 14; i += 1) {
          const y = 26 * s + i * ((H - 52 * s) / 13);
          const tick = i % 3 === 0 ? 7 * s : 3.8 * s;
          b.moveTo(W - 6 * s, y);
          b.lineTo(W - 6 * s - tick, y);
        }
        b.stroke();
        // Subtle breathing modernist isometric skyline wireframe along bottom-right background
        const ph = 0.55 + 0.45 * Math.sin(t * 0.65);
        b.strokeStyle = `rgba(222,232,240,${0.12 * ph})`;
        b.lineWidth = 0.85 * s;
        const baseY = H - 12 * s;
        const towers = [[0.64, 0.14, 0.14], [0.76, 0.11, 0.22], [0.85, 0.09, 0.17]];
        for (const [xk, wk, hk] of towers) {
          const tx = W * xk;
          const tw = W * wk;
          const th = H * hk;
          b.strokeRect(tx, baseY - th, tw, th);
        }
        traceComet(f, cardM.m, frac(t * 0.08), 0.14, plat, 1.25 * s, 0.68, s, 18);
      }

      // Offset Bauhaus cantilevered double-square frame around avatar
      f.strokeStyle = 'rgba(238,176,126,.78)';
      f.lineWidth = 1.45 * s;
      tracePoly(f, sq2, true);
      f.stroke();

      f.strokeStyle = 'rgba(222,232,240,.84)';
      f.lineWidth = 1.55 * s;
      tracePoly(f, sq1, true);
      f.stroke();

      // Tiny architectural registration crosshairs (+) at offset corner intersections
      f.strokeStyle = 'rgba(238,176,126,.78)';
      f.lineWidth = 0.9 * s;
      const cr = 3.2 * s;
      for (const [ix, iy] of [[cx - d + off, cy - d], [cx + d, cy + d - off]]) {
        f.beginPath();
        f.moveTo(ix - cr, iy);
        f.lineTo(ix + cr, iy);
        f.moveTo(ix, iy - cr);
        f.lineTo(ix, iy + cr);
        f.stroke();
      }

      // Smooth platinum & copper light traces gliding around both cantilevered squares
      const u = frac(t * 0.15);
      traceComet(f, sq1M, u, 0.18, plat, 1.65 * s, 0.84, s, 16);
      traceComet(f, sq2M, frac(u + 0.5), 0.18, copp, 1.5 * s, 0.8, s, 16);
    };
  }, { fullCard: true });

  def('biolumfauna', 'Moonlit Whiskers', 'Veterinary Medicine', 'A silver crescent cradle crowned with nocturnal ear crests sends spirit paw prints drifting across your full profile.', 2, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const moon = '218,236,255';
    const lav = '184,166,255';
    const aqua = '126,244,224';
    const cardM = full ? cardFrameMetrics(W, H, 5 * s, 18 * s) : null;
    // Sculpted nocturnal crescent + graceful cat/fox ear-crest silhouette
    const buildCrown = () => {
      const pts = [];
      // Start at top-center brow -> right ear peak -> outer cheek -> bottom crescent -> left cheek -> left ear peak -> top brow
      const arcSeg = (a0, a1, radK, steps) => {
        for (let i = 0; i <= steps; i += 1) {
          const a = a0 + (i / steps) * (a1 - a0);
          pts.push([cx + Math.cos(a) * ra * radK, cy + Math.sin(a) * ra * radK]);
        }
      };
      // Top brow bridge between ears
      arcSeg(-Math.PI * 0.62, -Math.PI * 0.38, 1.15, 6);
      // Right sculpted ear crest peak
      pts.push([cx + ra * 0.94, cy - ra * 1.40]);
      pts.push([cx + ra * 1.12, cy - ra * 0.72]);
      // Lower moonlit crescent cradle around cheeks and chin
      arcSeg(-0.56, Math.PI + 0.56, 1.22, 34);
      // Left sculpted ear crest peak
      pts.push([cx - ra * 0.94, cy - ra * 1.40]);
      return pts;
    };
    const crownPts = buildCrown();
    const crownM = pathMetrics(crownPts, true);
    const spiritPaws = Array.from({ length: full ? 9 : 5 }, (_, i) => ({
      x0: ((i + 0.4) / (full ? 9 : 5)) * W,
      y0: R(0, 1),
      v: R(0.036, 0.068),
      ph: R(0, TAU),
      r: R(4.2, 6.2),
      c: i % 2 === 0 ? aqua : lav
    }));
    const wisps = Array.from({ length: full ? 12 : 7 }, (_, i) => ({
      x: ((i + 0.3) / (full ? 12 : 7)) * W,
      y: ((i * 0.43 + 0.14) % 1) * H,
      ax: R(8, 18),
      ay: R(6, 14),
      fx: R(0.25, 0.5),
      fy: R(0.25, 0.5),
      ph: R(0, TAU)
    }));
    return (t) => {
      // Moonlit sanctuary full-card border with corner silver crescents
      if (cardM) {
        b.strokeStyle = 'rgba(184,166,255,.26)';
        b.lineWidth = 1.1 * s;
        tracePoly(b, cardM.pts, true);
        b.stroke();
        drawCardCorners(f, W, H, 6 * s, 15 * s, moon, 1.25 * s, 0.6, 'arc');
        const cu = frac(t * 0.08);
        traceComet(f, cardM.m, cu, 0.15, aqua, 1.4 * s, 0.76, s, 18);
        traceComet(f, cardM.m, frac(cu + 0.5), 0.14, lav, 1.3 * s, 0.68, s, 16);
      }

      // Drifting glowing nocturnal spirit paw prints across full profile height
      for (const p of spiritPaws) {
        const prog = frac(p.y0 + t * p.v);
        const y = H * (1.05 - prog * 1.12);
        const x = p.x0 + Math.sin(t * 0.6 + p.ph) * 10 * s;
        const fade = Math.sin(prog * Math.PI) * (full && y > cy + ra * 1.35 && x > W * 0.22 && x < W * 0.78 ? 0.26 : 0.52);
        paw(b, x, y, p.r * s, Math.sin(t * 0.7 + p.ph) * 0.22, p.c, fade);
      }

      // Soft nocturnal firefly wisps across full card
      for (const w of wisps) {
        const x = w.x + Math.sin(t * w.fx + w.ph) * w.ax * s;
        const y = w.y + Math.cos(t * w.fy + w.ph) * w.ay * s;
        const a = Math.pow(0.5 + 0.5 * Math.sin(t * 1.2 + w.ph), 2) * 0.62;
        glow(b, x, y, 5.5 * s, aqua, a);
      }

      // Moonlit sculpted ear-crest & silver crescent cradle around avatar
      glow(b, cx, cy, ra * 1.6, lav, 0.1 + 0.03 * Math.sin(t * 1.1));
      const cg = f.createLinearGradient(cx, cy - ra * 1.4, cx, cy + ra * 1.26);
      cg.addColorStop(0, '#eef7ff');
      cg.addColorStop(0.5, '#b8a6ff');
      cg.addColorStop(1, '#7ef4e0');
      f.strokeStyle = cg;
      f.lineWidth = 1.65 * s;
      tracePoly(f, crownPts, true);
      f.stroke();

      // Delicate luminous whisker-light filaments flanking left & right cheeks
      f.strokeStyle = 'rgba(218,236,255,.46)';
      f.lineWidth = 0.85 * s;
      f.lineCap = 'round';
      for (const sd of [-1, 1]) {
        const sw = Math.sin(t * 1.3 + sd) * 1.2 * s;
        for (const dy of [-2.8 * s, 2.2 * s]) {
          f.beginPath();
          f.moveTo(cx + sd * ra * 1.22, cy + ra * 0.14 + dy);
          f.quadraticCurveTo(cx + sd * ra * 1.36, cy + ra * 0.12 + dy + sw * 0.4, cx + sd * ra * 1.44, cy + ra * 0.18 + dy * 1.6 + sw);
          f.stroke();
        }
      }

      // Smooth silver-aqua moonbeam comet gliding around the ear-crest silhouette
      const u = frac(t * 0.15);
      traceComet(f, crownM, u, 0.18, moon, 1.7 * s, 0.85, s, 18);
      traceComet(f, crownM, frac(u + 0.5), 0.16, aqua, 1.45 * s, 0.72, s, 16);

      // Tiny crescent moon pendant at bottom center
      const my = cy + ra * 1.26;
      glow(f, cx, my, 6 * s, moon, 0.65);
      f.fillStyle = '#edf6ff';
      f.beginPath();
      f.arc(cx, my, 3.2 * s, 0.4, TAU - 0.8);
      f.fill();
    };
  }, { fullCard: true });

  def('botanicvet', 'Healing Terrarium', 'Veterinary Medicine', 'A faceted glass terrarium dome and botanical apothecary mullions float healing dewdrops across your full profile.', 1, (S) => {
    const { W, H, cx, cy, ra, s, full, b, f } = S;
    const jade = '112,236,178';
    const brass = '238,208,136';
    const dew = '196,250,255';
    const cardM = full ? cardFrameMetrics(W, H, 5 * s, 16 * s) : null;
    // Faceted botanical glass terrarium teardrop / marquise dome around avatar
    const domePts = [
      [cx, cy - ra * 1.42],
      [cx + ra * 0.76, cy - ra * 1.06],
      [cx + ra * 1.28, cy - ra * 0.24],
      [cx + ra * 1.18, cy + ra * 0.64],
      [cx + ra * 0.66, cy + ra * 1.20],
      [cx - ra * 0.66, cy + ra * 1.20],
      [cx - ra * 1.18, cy + ra * 0.64],
      [cx - ra * 1.28, cy - ra * 0.24],
      [cx - ra * 0.76, cy - ra * 1.06]
    ];
    const domeM = pathMetrics(domePts, true);
    const drops = Array.from({ length: full ? 14 : 8 }, (_, i) => ({
      x: ((i + 0.35) / (full ? 14 : 8)) * W,
      y0: R(0, 1),
      v: R(0.038, 0.072),
      ph: R(0, TAU),
      amp: R(6, 13),
      r: R(2.2, 4.0),
      herb: i % 3 === 0
    }));
    return (t) => {
      // Botanical glasshouse full-card border with brass mullions & corner fern sprigs
      if (cardM) {
        b.strokeStyle = 'rgba(238,208,136,.24)';
        b.lineWidth = 1.1 * s;
        tracePoly(b, cardM.pts, true);
        b.stroke();
        drawCardCorners(f, W, H, 6 * s, 15 * s, brass, 1.2 * s, 0.62, 'bracket');
        // Miniature hanging fern leaves in upper-right & lower-left corners
        const sw = Math.sin(t * 1.05) * 0.06;
        leaf(f, W - 10 * s, 10 * s, 14 * s, 4.2 * s, Math.PI * 0.78 + sw, '#88f0c0', '#2b865c', 0.38);
        leaf(f, W - 10 * s, 10 * s, 10 * s, 3.2 * s, Math.PI * 0.56 - sw, '#b4f8d8', '#3c9a6e', 0.3);
        leaf(f, 10 * s, H - 10 * s, 14 * s, 4.2 * s, -0.45 + sw, '#88f0c0', '#2b865c', 0.38);
        leaf(f, 10 * s, H - 10 * s, 10 * s, 3.2 * s, -1.0 - sw, '#f0d48a', '#9c7830', 0.3);
        const cu = frac(t * 0.08);
        traceComet(f, cardM.m, cu, 0.14, jade, 1.35 * s, 0.72, s, 18);
        traceComet(f, cardM.m, frac(cu + 0.5), 0.12, dew, 1.2 * s, 0.62, s, 16);
      }

      // Rising bioluminescent healing dewdrops & miniature apothecary leaves across full height
      for (const d of drops) {
        const prog = frac(d.y0 + t * d.v);
        const y = H * (1.04 - prog * 1.12);
        const x = d.x + Math.sin(t * 0.65 + d.ph) * d.amp * s;
        const fade = Math.sin(prog * Math.PI) * (full && y > cy + ra * 1.35 && x > W * 0.2 && x < W * 0.8 ? 0.34 : 0.68);
        if (d.herb) {
          b.globalAlpha = fade;
          leaf(b, x, y, d.r * 2.3 * s, d.r * 0.85 * s, -Math.PI / 3 + Math.sin(t * 0.9 + d.ph) * 0.3, '#88f2c2', '#2c845a', 0.38);
          b.globalAlpha = 1;
        } else {
          glow(b, x, y, d.r * 2.4 * s, dew, fade * 0.65);
          b.fillStyle = `rgba(${dew},${fade * 0.9})`;
          b.beginPath();
          b.arc(x, y, d.r * 0.45 * s, 0, TAU);
          b.fill();
        }
      }

      // Faceted glass terrarium teardrop dome around avatar
      glow(b, cx, cy, ra * 1.56, jade, 0.09 + 0.03 * Math.sin(t * 1.1));
      const tg = f.createLinearGradient(cx, cy - ra * 1.42, cx, cy + ra * 1.22);
      tg.addColorStop(0, '#f4dca0');
      tg.addColorStop(0.45, '#b8f5e0');
      tg.addColorStop(1, '#68d4a2');
      f.strokeStyle = tg;
      f.lineWidth = 1.65 * s;
      tracePoly(f, domePts, true);
      f.stroke();

      // Delicate curved mossy-jade terrarium base & brass hanging loop at apex
      f.strokeStyle = 'rgba(112,236,178,.72)';
      f.lineWidth = 1.5 * s;
      f.lineCap = 'round';
      f.beginPath();
      f.moveTo(cx - ra * 0.62, cy + ra * 1.24);
      f.quadraticCurveTo(cx, cy + ra * 1.36, cx + ra * 0.62, cy + ra * 1.24);
      f.stroke();

      // Tiny botanical leaf cluster sprouting gently on the lower-right terrarium ledge
      const lb = Math.sin(t * 1.25) * 0.06;
      leaf(f, cx + ra * 0.66, cy + ra * 1.16, ra * 0.3, ra * 0.11, -0.5 + lb, '#8cf2c2', '#2c845a', 0.4);
      leaf(f, cx - ra * 0.66, cy + ra * 1.16, ra * 0.26, ra * 0.095, Math.PI + 0.5 - lb, '#8cf2c2', '#2c845a', 0.4);

      // Brass hanging eyelet ring at top apex
      f.strokeStyle = 'rgba(238,208,136,.88)';
      f.lineWidth = 1.15 * s;
      f.beginPath();
      f.arc(cx, cy - ra * 1.47, 3.0 * s, 0, TAU);
      f.stroke();

      // Greenhouse sun-glint gliding cleanly along the faceted glass panes
      traceComet(f, domeM, frac(t * 0.14), 0.18, dew, 1.65 * s, 0.82, s, 18);
    };
  }, { fullCard: true });

  const CATEGORIES = [
    'All',
    'myIPON',
    'Education',
    'Information Technology',
    'Architecture',
    'Veterinary Medicine',
    'Cosmic',
    'Animal',
    'Robot & Cyber',
    'Sci-Fi',
    'Nature',
    'Magic',
    'Special'
  ];
  const RARITIES = ['Common', 'Rare', 'Epic'];
  const NONE_EFFECT = Object.freeze({
    id: 'none',
    name: 'No Effect',
    cat: 'Clean',
    desc: 'Keep your profile calm and minimal.',
    rare: 0
  });
  const ALL_OPTIONS = [NONE_EFFECT, ...EFFECTS];
  const EFFECT_BY_ID = new Map(ALL_OPTIONS.map((item) => [item.id, item]));
  const VALID_EFFECT_IDS = new Set(EFFECTS.map((item) => item.id));

  function normalizeEffectId(raw) {
    const clean = String(raw || '').trim().toLowerCase();
    return VALID_EFFECT_IDS.has(clean) ? clean : 'none';
  }

  function getEffect(raw) {
    return EFFECT_BY_ID.get(normalizeEffectId(raw)) || NONE_EFFECT;
  }

  const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
  const motion = { reduced: Boolean(mq?.matches), force: false };
  const motionListeners = new Set();
  const still = () => motion.reduced && !motion.force;

  const stages = new Set();
  let rafId = null;
  let lastNow = 0;

  function ensureLoopRunning() {
    if (rafId !== null || typeof requestAnimationFrame !== 'function' || stages.size === 0) return;
    lastNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const tick = (now) => {
      if (stages.size === 0) {
        rafId = null;
        return;
      }
      rafId = requestAnimationFrame(tick);
      const dt = Math.min(0.05, Math.max(0, (now - lastNow) / 1000));
      lastNow = now;
      if (typeof document !== 'undefined' && document.hidden) return;
      for (const st of stages) {
        if (!st.vis || !st.run) continue;
        if (still()) {
          if (!st.drawn) {
            st.render(3.2, 0);
            st.drawn = true;
          }
          continue;
        }
        st.acc += dt;
        if (st.acc < st.minDt) continue;
        const step = st.acc;
        st.acc = 0;
        st.time += step;
        st.render(st.time, step);
      }
    };
    rafId = requestAnimationFrame(tick);
  }

  if (mq) {
    const handleMq = (event) => {
      motion.reduced = Boolean(event?.matches);
      stages.forEach((st) => { st.drawn = false; });
      motionListeners.forEach((cb) => {
        try { cb({ reduced: motion.reduced, force: motion.force }); } catch { }
      });
    };
    mq.addEventListener?.('change', handleMq);
  }

  function defaultAvatarGeometry(host) {
    return (W, H) => {
      const av = host?.querySelector?.('.avatar-circle, .avatar, .mav, .effect-hero-avatar');
      if (av && typeof host.getBoundingClientRect === 'function' && typeof av.getBoundingClientRect === 'function') {
        const hr = host.getBoundingClientRect();
        const ar = av.getBoundingClientRect();
        if (hr.width > 0 && ar.width > 0) {
          return {
            cx: ar.left - hr.left + ar.width / 2,
            cy: ar.top - hr.top + ar.height / 2,
            ra: Math.max(12, ar.width / 2)
          };
        }
      }
      return { cx: Math.min(60, W * 0.24), cy: Math.min(86, H * 0.5), ra: Math.max(16, Math.min(35, W * 0.115)) };
    };
  }

  function mountStage(host, { effectId = 'none', geometryFn = null, fps = 60, maxDpr = 2 } = {}) {
    if (!host || typeof document === 'undefined') {
      return { setEffect() { }, refreshGeometry() { }, destroy() { } };
    }
    let backCanvas = host.querySelector('canvas.fxb');
    let frontCanvas = host.querySelector('canvas.fxf');
    let createdBack = false;
    let createdFront = false;
    if (!backCanvas) {
      backCanvas = document.createElement('canvas');
      backCanvas.className = 'fxb';
      backCanvas.setAttribute('aria-hidden', 'true');
      host.prepend(backCanvas);
      createdBack = true;
    }
    if (!frontCanvas) {
      frontCanvas = document.createElement('canvas');
      frontCanvas.className = 'fxf';
      frontCanvas.setAttribute('aria-hidden', 'true');
      const cover = host.querySelector('.banner, .msg-pop-cover');
      if (cover && cover.parentElement === host) cover.insertAdjacentElement('afterend', frontCanvas);
      else host.appendChild(frontCanvas);
      createdFront = true;
    }

    const bc = typeof backCanvas.getContext === 'function' ? backCanvas.getContext('2d') : null;
    const fc = typeof frontCanvas.getContext === 'function' ? frontCanvas.getContext('2d') : null;
    if (!bc || !fc) {
      return { setEffect() { }, refreshGeometry() { }, destroy() { } };
    }

    const geom = typeof geometryFn === 'function' ? geometryFn : defaultAvatarGeometry(host);
    const stage = {
      host,
      b: backCanvas,
      f: frontCanvas,
      bc,
      fc,
      geom,
      minDt: 1 / Math.max(15, fps) - 0.002,
      vis: true,
      id: normalizeEffectId(effectId),
      run: null,
      time: 0,
      acc: 0,
      drawn: false,
      S: null,
      build() {
        const defEntry = FX[this.id];
        const isFull = Boolean(defEntry?.fullCard);
        if (this.host?.dataset) {
          if (isFull) this.host.dataset.effectScope = 'full';
          else delete this.host.dataset.effectScope;
        }
        const W = this.b.clientWidth || this.b.offsetWidth || 0;
        const H = this.b.clientHeight || this.b.offsetHeight || 0;
        if (!W || !H) {
          this.run = null;
          return;
        }
        const d = Math.min((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1, maxDpr);
        for (const c of [this.b, this.f]) {
          c.width = Math.round(W * d);
          c.height = Math.round(H * d);
        }
        this.bc.setTransform(d, 0, 0, d, 0, 0);
        this.fc.setTransform(d, 0, 0, d, 0, 0);
        this.bc.clearRect(0, 0, W, H);
        this.fc.clearRect(0, 0, W, H);
        const g = this.geom(W, H) || { cx: W / 2, cy: H / 2, ra: 30 };
        const full = isFull && (Boolean(this.host?.classList?.contains?.('effects-card') || this.host?.classList?.contains?.('msg-profile-popover')) || H >= W * 0.92);
        const s = Math.max(0.35, g.ra / 36);
        this.S = { W, H, ...g, s, full, b: this.bc, f: this.fc };
        this.frameSpec = full && defEntry?.cardFrame ? { spec: defEntry.cardFrame, m: cardFrameMetrics(W, H, 5 * s, 16 * s) } : null;
        this.run = defEntry ? defEntry.make(this.S) : null;
        this.time = 0;
        this.drawn = false;
        if (this.run) this.render(0.016, 0.016);
      },
      render(t, dt) {
        if (!this.S || !this.run) return;
        const { W, H, s, b, f } = this.S;
        b.globalCompositeOperation = 'source-over';
        f.globalCompositeOperation = 'source-over';
        b.globalAlpha = 1;
        f.globalAlpha = 1;
        b.clearRect(0, 0, W, H);
        f.clearRect(0, 0, W, H);
        if (this.frameSpec) {
          const [rgb1, rgb2, style] = this.frameSpec.spec;
          drawFullCardAura(b, f, this.frameSpec.m, rgb1, rgb2, s, t, style);
        }
        this.run(t, dt);
        b.globalCompositeOperation = 'source-over';
        f.globalCompositeOperation = 'source-over';
        b.globalAlpha = 1;
        f.globalAlpha = 1;
      }
    };

    let ro = null;
    let io = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(() => stage.build());
      ro.observe(backCanvas);
    }
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver((entries) => {
        stage.vis = Boolean(entries[0]?.isIntersecting);
        if (stage.vis) stage.drawn = false;
      }, { rootMargin: '60px' });
      io.observe(host);
    }

    stages.add(stage);
    stage.build();
    ensureLoopRunning();

    return {
      setEffect(nextId) {
        stage.id = normalizeEffectId(nextId);
        stage.build();
      },
      refreshGeometry() {
        stage.build();
      },
      destroy() {
        stages.delete(stage);
        ro?.disconnect?.();
        io?.disconnect?.();
        stage.run = null;
        if (stage.host?.dataset) delete stage.host.dataset.effectScope;
        if (stage.S) {
          stage.bc.clearRect(0, 0, stage.S.W, stage.S.H);
          stage.fc.clearRect(0, 0, stage.S.W, stage.S.H);
        }
        if (createdBack) backCanvas.remove();
        if (createdFront) frontCanvas.remove();
      }
    };
  }

  const api = Object.freeze({
    EFFECTS: Object.freeze(EFFECTS),
    NONE_EFFECT,
    ALL_OPTIONS: Object.freeze(ALL_OPTIONS),
    CATEGORIES: Object.freeze(CATEGORIES),
    RARITIES: Object.freeze(RARITIES),
    VALID_EFFECT_IDS,
    getEffect,
    normalizeEffectId,
    mountStage,
    isReducedMotion: () => motion.reduced,
    getMotionForced: () => motion.force,
    setMotionForced(flag) {
      motion.force = Boolean(flag);
      stages.forEach((st) => { st.drawn = false; });
      motionListeners.forEach((cb) => {
        try { cb({ reduced: motion.reduced, force: motion.force }); } catch { }
      });
    },
    shouldPlayStill: still,
    onMotionChange(fn) {
      if (typeof fn !== 'function') return () => { };
      motionListeners.add(fn);
      return () => motionListeners.delete(fn);
    }
  });

  if (typeof window !== 'undefined') window.IponProfileEffects = api;
  if (typeof globalThis !== 'undefined') globalThis.IponProfileEffects = api;
})();
