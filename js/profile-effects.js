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

  const FX = Object.create(null);
  const EFFECTS = [];
  function def(id, name, cat, desc, rare, make) {
    const entry = { id, name, cat, desc, rare, make };
    FX[id] = entry;
    EFFECTS.push({ id, name, cat, desc, rare });
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

  const CATEGORIES = ['All', 'Cosmic', 'Animal', 'Robot & Cyber', 'Sci-Fi', 'Nature', 'Magic', 'Special'];
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
        this.S = { W, H, ...g, s: Math.max(0.35, g.ra / 36), b: this.bc, f: this.fc };
        const defEntry = FX[this.id];
        this.run = defEntry ? defEntry.make(this.S) : null;
        this.time = 0;
        this.drawn = false;
        if (this.run) this.render(0.016, 0.016);
      },
      render(t, dt) {
        if (!this.S || !this.run) return;
        const { W, H, b, f } = this.S;
        b.globalCompositeOperation = 'source-over';
        f.globalCompositeOperation = 'source-over';
        b.globalAlpha = 1;
        f.globalAlpha = 1;
        b.clearRect(0, 0, W, H);
        f.clearRect(0, 0, W, H);
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
