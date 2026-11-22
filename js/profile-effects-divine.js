(() => {
  'use strict';

  const api = globalThis.IponProfileEffects;
  if (!api?.registerEffect) return;

  const { TAU, frac, glow, star4 } = api._H;
  const clamp = (x, min = 0, max = 1) => Math.max(min, Math.min(max, x));
  const ease = (x) => {
    const t = clamp(x);
    return t * t * (3 - 2 * t);
  };
  const veil = (p, rise, fall) => ease(p / rise) * ease((1 - p) / fall);
  const seed = (index, salt) => frac(Math.sin(index * 127.1 + salt * 311.7) * 43758.5453);

  function ramp(gradient, colors) {
    for (const [at, color] of colors) gradient.addColorStop(at, color);
    return gradient;
  }

  function face(g, points, fill) {
    g.beginPath();
    g.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) g.lineTo(points[i], points[i + 1]);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  }

  function disc(g, x, y, radius, fill) {
    g.fillStyle = fill;
    g.beginPath();
    g.arc(x, y, radius, 0, TAU);
    g.fill();
  }

  function place(g, x, y, size, rotation, alpha, paint) {
    if (alpha <= 0 || size <= 0) return;
    g.save();
    g.translate(x, y);
    g.rotate(rotation);
    g.scale(size, size);
    g.globalAlpha = alpha;
    paint();
    g.restore();
  }

  function stage(S, duration, entrance) {
    const { W, H } = S;
    const unit = Math.min(W, H);
    return (draw) => (t, dt) => {
      const opacity = dt === 0 ? 1 : ease(t / entrance);
      draw(frac(t / duration), opacity, unit);
    };
  }

  // Darken the cover for the scene's focal object, then let the card's own
  // surface show through around profile content and controls.
  function atmosphere(g, H, colors) {
    return ramp(g.createLinearGradient(0, 0, 0, H), colors);
  }

  function backdrop(g, W, H, gradient, alpha) {
    g.save();
    g.fillStyle = gradient;
    g.globalAlpha = alpha;
    g.fillRect(0, 0, W, H);
    g.restore();
  }

  function highlight(g, x, y, radius, color, alpha) {
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = color;
    star4(g, x, y, radius);
    g.restore();
  }

  function meridian(S) {
    const { b, f, W, H } = S;
    const sky = atmosphere(b, H, [
      [0, 'rgba(8,13,34,.92)'], [.38, 'rgba(15,20,51,.74)'],
      [.62, 'rgba(35,42,97,.19)'], [1, 'rgba(88,69,155,.12)']
    ]);
    const brass = ramp(b.createLinearGradient(-1, -.82, .65, .84), [
      [0, '#6a4229'], [.23, '#d2a472'], [.37, '#ffeac2'], [.51, '#6c4c3b'],
      [.71, '#291d32'], [.84, '#ecd3ab'], [1, '#673e35']
    ]);
    const globe = ramp(b.createRadialGradient(-.41, -.45, .02, 0, 0, 1), [
      [0, '#eff0fd'], [.24, '#bfc9ee'], [.51, '#7d8abf'],
      [.77, '#3b3974'], [.94, '#171725'], [1, '#757baf']
    ]);
    const chart = [[.12,.21],[.22,.12],[.37,.19],[.48,.08],[.59,.12],[.71,.07]];
    const stars = Array.from({ length: 37 }, (_, i) => [seed(i, 1), seed(i, 2), seed(i, 4)]);

    return stage(S, 24, .86)((p, alpha, u) => {
      const a = TAU * p;
      const x = W * (.73 + .035 * Math.sin(a));
      const y = H * (.29 + .035 * Math.cos(a));
      const r = Math.min(W * .155, H * .155);

      // Nebula: separate veils move laterally and climb from the lower corners.
      backdrop(b, W, H, sky, alpha);
      glow(b, W * (.28 + .14 * Math.sin(a)), H * .26, u * .66, '91,99,206', alpha * .52);
      glow(b, W * (.89 - .11 * Math.sin(a)), H * .77, u * .6, '120,86,198', alpha * .27);
      glow(b, W * .15, H * (.84 + .06 * Math.cos(a)), u * .43, '163,100,125', alpha * .2);

      // Planetarium: the globe turns under a separately banked engraved armillary.
      glow(b, x + r * .28, y + r * .37, r * 2, '5,6,25', alpha * .84);
      glow(b, x - r * .35, y - r * .32, r * 2.15, '145,155,242', alpha * .49);
      place(b, x, y, r, -.24 + .16 * Math.sin(a), alpha, () => {
        disc(b, .09, .13, .97, '#191428');
        disc(b, 0, 0, 1, globe);
        b.save();
        b.beginPath();
        b.arc(0, 0, .992, 0, TAU);
        b.clip();
        for (let i = 0; i < 7; i += 1) {
          const band = -.8 + i * .26;
          const tide = .12 * Math.sin(2 * a + i);
          b.strokeStyle = i % 2 ? 'rgba(233,215,255,.25)' : 'rgba(30,31,87,.35)';
          b.lineWidth = .075 + .03 * Math.sin(i);
          b.beginPath();
          b.moveTo(-1, band + .18);
          b.bezierCurveTo(-.4, band + tide, .31, band - .21, 1, band - .09 + tide);
          b.stroke();
        }
        b.restore();
        b.strokeStyle = 'rgba(10,10,26,.76)';
        b.lineWidth = .114;
        b.beginPath();
        b.ellipse(.05, .051, 1.54, .37 + .10 * Math.sin(a), -.23, 0, TAU);
        b.stroke();
        b.strokeStyle = brass;
        b.lineWidth = .063;
        b.beginPath();
        b.ellipse(0, 0, 1.54, .37 + .10 * Math.sin(a), -.23, 0, TAU);
        b.stroke();
        b.lineWidth = .014;
        for (let i = 0; i < 18; i += 1) {
          const tick = i * TAU / 18 - .16;
          const tx = 1.55 * Math.cos(tick);
          const ty = .39 * Math.sin(tick);
          b.beginPath();
          b.moveTo(tx, ty);
          b.lineTo(tx * 1.05, ty * 1.14);
          b.stroke();
        }
      });

      // Constellation: plotted paths grow out of the chart and dissolve.
      const ink = frac(p * 2 + .16);
      const chartAlpha = alpha * veil(ink, .29, .36);
      for (let i = 0; i < chart.length; i += 1) {
        const [px, py] = chart[i];
        const reveal = ease(ink * 5.8 - i * .48);
        const light = reveal * chartAlpha;
        if (i) {
          const [qx, qy] = chart[i - 1];
          b.strokeStyle = `rgba(185,193,243,${light * .62})`;
          b.lineWidth = .75;
          b.beginPath();
          b.moveTo(qx * W, qy * H);
          b.lineTo((qx + (px - qx) * reveal) * W, (qy + (py - qy) * reveal) * H);
          b.stroke();
        }
        highlight(f, px * W, py * H, u * (i === 2 ? .022 : .012), '#ffe5b9', light);
      }

      // Stellar dust: broad, parallax sweeps pulse across the full card.
      for (const [sx, sy, depth] of stars) {
        const tx = W * (.025 + .95 * sx + .024 * Math.sin(a + sy * 11));
        const ty = H * (.04 + .92 * sy + .026 * Math.cos(2 * a + sx * 8));
        const power = alpha * (.14 + .52 * depth) * (.55 + .45 * Math.sin(3 * a + sy * 45) ** 2);
        glow(b, tx, ty, u * (.006 + .009 * depth), '156,173,255', power);
        disc(b, tx, ty, Math.max(.38, u * .0034 * depth), `rgba(232,222,255,${power})`);
      }

      // Light transit: silver-blue comet carries a tapered light trail.
      const transit = frac(p * 3 + .24);
      const tx = W * (.11 + .78 * ease(transit));
      const ty = H * (.82 - .57 * transit + .08 * Math.sin(Math.PI * transit));
      const spark = alpha * veil(transit, .21, .4);
      const tail = ramp(f.createLinearGradient(-.28, .10, 0, 0), [
        [0, 'rgba(154,157,255,0)'], [.7, 'rgba(168,184,240,.4)'], [1, '#f3ebff']
      ]);
      place(f, tx, ty, u, 0, spark * .8, () => {
        face(f, [-.28,.108,-.08,.018,0,0,-.045,.039], tail);
      });
      glow(f, tx, ty, u * .061, '203,216,255', spark * .56);
      highlight(f, tx, ty, u * .021, '#fff2dc', spark);
    });
  }

  function boreal(S) {
    const { b, f, W, H } = S;
    const night = atmosphere(b, H, [
      [0, 'rgba(8,12,36,.96)'], [.34, 'rgba(15,24,57,.75)'],
      [.59, 'rgba(60,73,156,.18)'], [1, 'rgba(31,137,126,.095)']
    ]);
    const flakes = Array.from({ length: 23 }, (_, i) => [seed(i, 6), seed(i, 9), seed(i, 10)]);
    const silks = [0, 1, 2].map((layer) => ramp(b.createLinearGradient(0, .02 * H, 0, .59 * H), [
      [0, 'rgba(105,77,227,0)'], [.35, layer === 1 ? '#7065d8' : '#5c47a1'],
      [.59, layer === 1 ? '#65b6dc' : '#658cdf'], [.74, '#93ffe0'], [1, 'rgba(139,255,214,0)']
    ]));
    const edge = ramp(b.createLinearGradient(0, 0, W, 0), [
      [0, 'rgba(160,170,248,0)'], [.24, 'rgba(161,244,225,.18)'], [.58, '#8cf4dc'],
      [.85, '#bdfbea'], [1, 'rgba(175,238,222,0)']
    ]);
    const reflection = ramp(b.createLinearGradient(0, 0, W, 0), [
      [0, 'rgba(105,68,229,0)'], [.22, 'rgba(145,118,242,.31)'],
      [.56, 'rgba(108,255,206,.5)'], [1, 'rgba(109,187,247,0)']
    ]);
    const fold = (x, t, offset) => Math.sin(x * 5.4 + t + offset) * .10
      + Math.sin(x * 11.4 - t + offset * .8) * .047;

    return stage(S, 20, .98)((p, alpha, u) => {
      const a = TAU * p;
      // Polar atmosphere: tilted fields drift in opposite directions at different depths.
      backdrop(b, W, H, night, alpha);
      glow(b, W * (.15 + .14 * Math.cos(a)), H * .23, u * .68, '94,75,219', alpha * .67);
      glow(b, W * (.74 - .19 * Math.sin(a)), H * .34, u * .64, '62,221,188', alpha * .55);
      glow(b, W * (.47 + .17 * Math.sin(a)), H * .79, u * .58, '116,91,223', alpha * .25);

      // Primary curtain: three translucent silk ridges billow across the cover.
      for (let layer = 0; layer < 3; layer += 1) {
        const crest = (x) => H * (.23 + layer * .071 + .115 * (1 - x) + fold(x, a, layer * 1.7));
        b.save();
        b.globalAlpha = alpha * (.44 + layer * .15);
        b.fillStyle = silks[layer];
        b.beginPath();
        b.moveTo(0, crest(0));
        for (let i = 1; i <= 32; i += 1) {
          const x = i / 32;
          b.lineTo(x * W, crest(x));
        }
        for (let i = 32; i >= 0; i -= 1) {
          const x = i / 32;
          b.lineTo(x * W, crest(x) - H * (.10 + .085 * (1 + Math.cos(x * 8 - a - layer))));
        }
        b.closePath();
        b.fill();
        b.strokeStyle = edge;
        b.lineWidth = u * .007;
        b.beginPath();
        b.moveTo(0, crest(0));
        for (let i = 1; i <= 32; i += 1) b.lineTo(i / 32 * W, crest(i / 32));
        b.stroke();
        b.restore();
      }

      // Striations: individual vertically stretched folds descend through the sky.
      for (let i = 0; i < 25; i += 1) {
        const x = .04 + i * .038;
        const t = frac(p * 4 + i * .123);
        const end = H * (.38 + fold(x, a, 1.7));
        const top = end - H * (.09 + .24 * ease(t));
        const strength = alpha * veil(t, .34, .49) * (.3 + .35 * ((i % 5) / 4));
        const thread = ramp(b.createLinearGradient(0, top, 0, end), [
          [0, 'rgba(191,180,255,0)'], [.56, 'rgba(137,164,248,.25)'], [1, 'rgba(180,255,230,.8)']
        ]);
        b.save();
        b.strokeStyle = thread;
        b.globalAlpha = strength;
        b.lineWidth = Math.max(.6, u * .0032);
        b.beginPath();
        b.moveTo(W * (x - .065 * t), top);
        b.quadraticCurveTo(W * x, end - H * .11, W * (x + .011 * t), end);
        b.stroke();
        b.restore();
      }

      // Ice dust: individual flakes rise at two depths and fade at their peaks.
      flakes.forEach(([sx, sy, depth], i) => {
        const phase = frac(p * (i % 3 ? 2 : 4) + sx);
        const x = W * (.045 + .91 * sx + .028 * Math.sin(phase * Math.PI));
        const y = H * (.22 + .7 * sy - .13 * ease(phase));
        const strength = alpha * veil(phase, .28, .35) * (.24 + .57 * depth);
        glow(f, x, y, u * (.012 + .018 * depth), '123,225,224', strength * .71);
        highlight(f, x, y, u * (.004 + .01 * depth), '#c6ffed', strength);
      });

      // Reflected aurora: broad caustic ribbons sweep through the lower half.
      for (let i = 0; i < 2; i += 1) {
        const flow = frac(p * 2 + i * .48);
        const y = H * (.64 + .23 * ease(flow));
        b.save();
        b.globalAlpha = alpha * veil(flow, .27, .43);
        b.strokeStyle = reflection;
        b.lineWidth = u * (.013 + .027 * flow);
        b.beginPath();
        b.moveTo(0, y + H * .05);
        b.bezierCurveTo(W * .21, y - H * .17, W * .65, y + H * .18, W, y - H * .067);
        b.stroke();
        b.restore();
      }
    });
  }

  function opal(S) {
    const { b, f, W, H } = S;
    const cavern = atmosphere(b, H, [
      [0, 'rgba(18,13,39,.93)'], [.35, 'rgba(33,24,63,.74)'],
      [.66, 'rgba(105,55,115,.15)'], [1, 'rgba(64,88,169,.12)']
    ]);
    const frost = ramp(b.createLinearGradient(-.9, -.92, .76, .95), [
      [0, '#fff4e9'], [.31, '#95f3e4'], [.55, '#586f9c'], [.73, '#d4a6e5'], [1, '#534473']
    ]);
    const ink = ramp(b.createLinearGradient(-.2, -.9, .92, .8), [
      [0, '#c2f1ed'], [.35, '#5b79a7'], [.66, '#342c61'], [.82, '#90659a'], [1, '#272044']
    ]);
    const splinters = [
      [.91, .45, -.26, .27], [.12, .70, -.47, .27], [.76, .79, .62, .31],
      [.9, .91, .86, .24], [.47, .54, .66, .13], [.30, .13, .44, .21], [.1, .21, -.33, .18]
    ];

    function crystal(g, twist, gleam) {
      const spine = .14 + .23 * twist;
      face(g, [-.51,-.50,-.15,-1.15,.56,-.52,.55,.51,-.09,.96,-.50,.59], 'rgba(46,36,77,.71)');
      face(g, [-.61,-.56,-.19,-1.20,.51,-.61,.48,.49,-.16,.93,-.59,.57], ink);
      face(g, [-.61,-.56,-.19,-1.20,spine,-.47,-.16,.93,-.59,.57], frost);
      face(g, [-.19,-1.20,.51,-.61,spine,-.47], '#b2dbeb');
      face(g, [spine,-.47,.51,-.61,.48,.49,-.16,.93], 'rgba(60,46,96,.54)');
      face(g, [-.61,-.56,spine,-.47,-.16,.93,-.44,.17], 'rgba(123,219,226,.22)');
      face(g, [-.44,.17,spine,-.47,.03,.24,-.16,.93], 'rgba(73,105,153,.24)');
      face(g, [spine,-.47,.51,-.61,.22,-.20,.48,.49,.03,.24], 'rgba(176,145,222,.15)');
      face(g, [-.19,-1.20,spine,-.47,-.16,.86,spine-.035,-.47], `rgba(255,246,246,${gleam})`);
    }

    return stage(S, 24, .91)((p, alpha, u) => {
      const a = TAU * p;
      // Environment: a refractive vapor field opens across the card.
      backdrop(b, W, H, cavern, alpha);
      glow(b, W * (.68 + .11 * Math.sin(a)), H * .27, u * .61, '130,113,235', alpha * .67);
      glow(b, W * (.17 + .11 * Math.sin(a)), H * (.27 + .13 * Math.cos(a)), u * .53, '79,209,198', alpha * .28);
      glow(b, W * .92, H * .85, u * .49, '211,108,176', alpha * .31);

      // Main object: the three asymmetric planes of a suspended opal turn into the light.
      const x = W * (.73 + .045 * Math.sin(a));
      const y = H * (.24 + .056 * Math.cos(a));
      const r = u * .245;
      glow(b, x + r * .17, y + r * .31, r * 1.48, '21,14,49', alpha * .93);
      glow(b, x - r * .14, y - r * .12, r * 1.61, '156,205,255', alpha * .37);
      place(b, x, y, r, -.54 + .25 * Math.sin(a), alpha, () => {
        crystal(b, Math.cos(a), .55 + .41 * Math.sin(a) ** 2);
      });

      // Smaller shards float in opposing diagonals through middle and lower regions.
      splinters.forEach(([sx, sy, slant, scale], i) => {
        const bob = 2 * a + i * 1.1;
        const tx = W * (sx + .035 * Math.sin(bob));
        const ty = H * (sy + .047 * Math.cos(bob));
        const size = r * scale;
        glow(b, tx + size * .28, ty + size * .36, size * 1.85, '31,20,73', alpha * .43);
        place(b, tx, ty, size, slant + Math.sin(bob) * .28, alpha * (.49 + i % 4 * .080), () => {
          crystal(b, Math.sin(bob), .65);
        });
      });

      // Spectral beams fan across the composition as each facet comes on-axis.
      const beam = frac(p * 3 + .19);
      const width = W * (.38 + .25 * ease(beam));
      const ray = ramp(b.createLinearGradient(x, y, x - width, H * .9), [
        [0, 'rgba(188,227,255,.58)'], [.49, 'rgba(158,164,226,.31)'],
        [.76, 'rgba(231,131,183,.16)'], [1, 'rgba(231,131,183,0)']
      ]);
      b.save();
      b.globalAlpha = alpha * veil(beam, .22, .32) * .77;
      face(b, [x,y,x-width,H*.91,x-width*.71,H*.62], ray);
      face(b, [x,y,x-width*.81,H*.92,x-width*.74,H*.8], ray);
      b.restore();

      // Foreground chips break away on arcing paths, taper to sparks, and fade.
      for (let i = 0; i < 15; i += 1) {
        const q = frac(p * (i % 4 ? 4 : 3) + seed(i, 18));
        const tx = W * (.07 + .85 * seed(i, 11) + .035 * Math.sin(q * TAU));
        const ty = H * (.11 + .72 * seed(i, 15) + .13 * ease(q));
        const power = alpha * veil(q, .24, .39) * (.42 + seed(i, 3) * .49);
        glow(f, tx, ty, u * .025, '196,165,247', power * .57);
        place(f, tx, ty, u * (.008 + .009 * seed(i, 12)), q * TAU, power, () => {
          face(f, [0,-1,.6,.12,0,1,-.45,.1], '#d6f7ed');
          face(f, [0,-1,.11,.14,0,1,.6,.12], '#9c81b9');
        });
      }
    });
  }

  function imperial(S) {
    const { b, f, W, H } = S;
    const vault = atmosphere(b, H, [
      [0, 'rgba(31,16,20,.97)'], [.35, 'rgba(52,25,30,.84)'],
      [.62, 'rgba(145,80,51,.15)'], [1, 'rgba(114,49,51,.14)']
    ]);
    const gold = ramp(b.createLinearGradient(-.81, -1, .69, .8), [
      [0, '#6c3424'], [.25, '#c9864e'], [.38, '#fff1bb'], [.48, '#89623b'],
      [.58, '#e6ad66'], [.79, '#502324'], [1, '#ae754a']
    ]);
    const enamel = ramp(b.createRadialGradient(-.29, -.52, .05, 0, 0, 1), [
      [0, '#a86859'], [.38, '#662b2e'], [.83, '#351923'], [1, '#160f1c']
    ]);
    function seal(g, depth, glint) {
      g.save();
      g.scale(depth, 1);
      disc(g, .08, .10, 1.02, '#231319');
      disc(g, 0, 0, 1, gold);
      disc(g, 0, 0, .87, '#613a31');
      disc(g, 0, 0, .81, enamel);
      g.strokeStyle = gold;
      g.lineWidth = .037;
      for (let i = 0; i < 12; i += 1) {
        const t = i * TAU / 12;
        g.beginPath();
        g.moveTo(.905 * Math.cos(t), .905 * Math.sin(t));
        g.lineTo(.965 * Math.cos(t), .965 * Math.sin(t));
        g.stroke();
      }
      face(g, [0,-.69,.45,-.26,.61,.02,.43,.39,0,.65,-.43,.39,-.61,.02,-.45,-.26], gold);
      face(g, [0,-.61,.36,-.24,.51,.02,.32,.32,0,.56,-.32,.32,-.51,.02,-.36,-.24], enamel);
      face(g, [0,-.41,.36,.02,0,.39,-.36,.02], gold);
      face(g, [0,-.31,.26,.02,0,.27,-.26,.02], '#6e292d');
      face(g, [0,-.31,.26,.02,0,.018,-.26,.02], `rgba(248,174,118,${glint})`);
      g.restore();
    }

    return stage(S, 24, 1)((p, alpha, u) => {
      const a = TAU * p;
      // Chamber: deep red enamel atmosphere with moving amber key and floor bounce.
      backdrop(b, W, H, vault, alpha);
      glow(b, W * (.59 + .13 * Math.sin(a)), H * .27, u * .74, '194,105,51', alpha * .58);
      glow(b, W * .92, H * (.66 + .19 * Math.cos(a)), u * .53, '185,76,50', alpha * .31);

      // Vaulted ribs: the second set of rails drifts at a different depth.
      for (let i = 0; i < 5; i += 1) {
        const w = W * (.24 + i * .125);
        const x = W * .55 + W * .06 * Math.sin(a + i * .4);
        const y = H * (.75 + .039 * i);
        const peak = H * (.014 + i * .058 + .026 * Math.cos(a + i));
        b.save();
        b.globalAlpha = alpha * (.41 - i * .043);
        b.lineWidth = Math.max(1, u * .016);
        b.strokeStyle = 'rgba(31,13,26,.59)';
        const arch = (offset) => {
          b.beginPath();
          b.moveTo(x - w + offset,y);
          b.bezierCurveTo(x-w+offset,peak+H*.17,x-w*.31,peak+H*.06,x,peak);
          b.bezierCurveTo(x+w*.3,peak+H*.06,x+w+offset,peak+H*.17,x+w+offset,y);
          b.stroke();
        };
        arch(3);
        b.lineWidth = Math.max(.7,u*.006);
        b.strokeStyle = '#e2b27a';
        arch(0);
        b.restore();
      }

      // Reliquary: a gold medallion yaws, revealing its beveled side and garnet center.
      const x = W * (.72 + .045 * Math.sin(a));
      const y = H * (.276 + .045 * Math.cos(a));
      const r = u * .235;
      glow(b,x+r*.2,y+r*.28,r*1.47,'39,14,23',alpha*.91);
      glow(b,x-r*.28,y-r*.29,r*1.63,'252,170,79',alpha*.43);
      place(b,x,y,r,-.18 + .17 * Math.sin(a),alpha,()=> {
        seal(b,.76+.22*Math.cos(a),.4+.5*Math.sin(a)**2);
      });

      // Tumbled satellites follow longer loops through the lower chamber.
      for (let i = 0; i < 6; i += 1) {
        const q = frac(p * (1 + i % 2) + i * .217);
        const sx = W * (.12 + i * .152 + .025 * Math.sin(TAU * q));
        const sy = H * (.47 + .45 * ease(q));
        const light = alpha * veil(q,.23,.34) * .73;
        const size = u * (.026 + i % 3 * .013);
        glow(b,sx+size*.26,sy+size*.31,size*1.61,'69,20,22',light*.53);
        place(f,sx,sy,size,TAU*q,light,()=> {
          seal(f,.55+.43*Math.cos(TAU*q)**2,.58);
        });
      }

      // Specular accents chase the vault edge and split into tiny gold dust points.
      for (let i = 0; i < 12; i += 1) {
        const q = frac(p * 4 + i * .153);
        const sx = W * (.06 + .86 * seed(i,22) + .043 * Math.sin(Math.PI*q));
        const sy = H * (.07 + .75 * seed(i,21) + .12 * ease(q));
        const strength = alpha * veil(q,.17,.53) * (i % 3 ? .48 : .91);
        glow(f,sx,sy,u*.041,'255,168,82',strength*.55);
        highlight(f,sx,sy,u*(i%3 ? .008 : .018),'#ffe7b2',strength);
      }
    });
  }

  function hellebore(S) {
    const { b, f, W, H } = S;
    const garden = atmosphere(b, H, [
      [0, 'rgba(13,32,28,.93)'], [.37, 'rgba(21,67,50,.76)'],
      [.67, 'rgba(99,138,71,.14)'], [1, 'rgba(46,139,99,.14)']
    ]);
    const petals = ramp(b.createLinearGradient(-.45,-.84,.29,-.05), [
      [0, '#fcf0d4'], [.21, '#dfbcb3'], [.50, '#a76978'], [.72, '#72485d'], [1, '#4a344e']
    ]);
    const leaves = ramp(b.createLinearGradient(-.29,-.69,.32,-.33), [
      [0, '#54754e'], [.38, '#acbd76'], [.55, '#607b50'], [.75, '#345941'], [1, '#203a31']
    ]);

    function petal(g, fill, bend) {
      g.beginPath();
      g.moveTo(0,.13);
      g.bezierCurveTo(-.44,-.17,-.49,-.79,-.17,-.94);
      g.bezierCurveTo(.01,-1.02,.31 + bend,-1.02,.36 + bend,-.7);
      g.bezierCurveTo(.49 + bend,-.46,.22,-.10,0,.13);
      g.fillStyle = fill;
      g.fill();
    }

    function leaf(g, bend) {
      g.beginPath();
      g.moveTo(0,0);
      g.bezierCurveTo(-.40,-.26,-.52,-.76,-.05,-1);
      g.bezierCurveTo(.07,-.84,.54 + bend,-.56,0,0);
      g.fillStyle = leaves;
      g.fill();
      g.strokeStyle = 'rgba(240,206,126,.51)';
      g.lineWidth = .014;
      g.beginPath();
      g.moveTo(0,0);
      g.quadraticCurveTo(.093,-.48,-.05,-1);
      g.stroke();
    }

    return stage(S, 24, 1.08)((p, alpha, u) => {
      const a = TAU * p;
      // Greenhouse: mist and luminous pockets drift behind the complete arrangement.
      backdrop(b,W,H,garden,alpha);
      glow(b,W*(.72+.15*Math.cos(a)),H*.22,u*.68,'127,160,83',alpha*.58);
      glow(b,W*.08,H*(.57+.15*Math.sin(a)),u*.55,'41,150,113',alpha*.36);
      glow(b,W*.85,H*.85,u*.51,'207,140,128',alpha*.21);

      // Branch network: gilded stems bow and leaves rotate from individual nodes.
      const drift = .042 * Math.sin(a);
      const branch = ramp(b.createLinearGradient(0,H, W*.84,H*.25),[
        [0,'rgba(76,112,63,.32)'],[.42,'#9a925b'],[.75,'#d9c087'],[1,'rgba(240,216,147,0)']
      ]);
      b.save();
      b.globalAlpha = alpha * .75;
      b.lineWidth = u * .008;
      for (const side of [0,1]) {
        const x = side ? W : 0;
        const dir = side ? -1 : 1;
        const drawStem = (offset) => {
          b.beginPath();
          b.moveTo(x+offset,H*.95);
          b.bezierCurveTo(x+dir*W*.32+offset,H*.73,x+dir*W*(.09+drift)+offset,H*.49,x+dir*W*.26,H*.21);
          b.stroke();
        };
        b.strokeStyle = 'rgba(21,27,18,.64)';
        drawStem(u*.011);
        b.strokeStyle = branch;
        drawStem(0);
        for (let i=0;i<8;i+=1) {
          const leap = (i%2 ? 1 : -1);
          const lx = x+dir*W*(.08 + .024*i + drift*Math.sin(i*.48));
          const ly = H*(.88-i*.078);
          const r = u*(.07 + .033*Math.sin(i*.8)**2);
          place(b,lx,ly,r,dir*(.32*i - .9) + leap*.69 + .21*Math.sin(a+i),alpha*(.26+.044*i),()=>leaf(b,drift));
        }
      }
      b.restore();

      // Hellebore: layered sepals open at different angles around a lit stamen crown.
      const bud = .5 + .5*Math.sin(a-.7);
      const x = W*(.73+.036*Math.sin(a));
      const y = H*(.257+.028*Math.cos(a));
      const r = u*.24;
      glow(b,x+r*.14,y+r*.28,r*1.42,'32,30,26',alpha*.81);
      glow(b,x-r*.22,y-r*.25,r*1.54,'237,157,138',alpha*.37);
      place(b,x,y,r,-.31+Math.sin(a)*.18,alpha,()=> {
        for (let layer=0;layer<2;layer+=1) {
          for (let i=0;i<5;i+=1) {
            b.save();
            b.rotate(i*TAU/5+layer*.67);
            const open = 1+.14*bud*Math.cos(i)+.055*i;
            const scale = layer ? .69 : 1;
            b.scale(scale*(.89+.13*bud),scale*open);
            b.translate(.036,.055);
            petal(b,'rgba(32,23,41,.58)',.06*Math.sin(a+i));
            b.translate(-.065,-.079);
            petal(b,petals,.085*Math.sin(a+i+.32*layer));
            b.strokeStyle = 'rgba(252,219,183,.29)';
            b.lineWidth = .012;
            b.beginPath();
            b.moveTo(0,-.01);
            b.quadraticCurveTo(-.11,-.46,-.15,-.83);
            b.stroke();
            b.restore();
          }
        }
        disc(b,.024,.026,.25,'#4f3938');
        disc(b,0,0,.19,'#866243');
        for (let i=0;i<21;i+=1) {
          const phase=i*2.4;
          const spread=.029+.032*Math.sqrt(i);
          disc(b,spread*Math.cos(phase),spread*Math.sin(phase),.028,i%3?'#d9b075':'#ffe2a7');
        }
      });

      // Loose sepals tumble in five distinct paths, gradually folding into shadow.
      for (let i=0;i<8;i+=1) {
        const q=frac(p*(i%2 ? 2 : 3)+seed(i,33));
        const sx=W*(.08+.79*seed(i,34)+.065*Math.sin(TAU*q));
        const sy=H*(.29+.44*seed(i,35)+.19*ease(q));
        const size=u*(.029+.026*seed(i,39));
        const power=alpha*veil(q,.22,.38)*(.43+.37*seed(i,36));
        glow(b,sx+size*.28,sy+size*.33,size*1.1,'66,35,48',power*.44);
        place(f,sx,sy,size,TAU*q+i,power,()=>{
          f.scale(.37+.63*Math.sin(Math.PI*q),1);
          petal(f,petals,.1*Math.sin(TAU*q));
        });
      }

      // Pollen lights: moving pinpoints grow and fade across the whole garden.
      for (let i=0;i<20;i+=1) {
        const q=frac(p*4 + seed(i,41));
        const sx=W*(.05+.88*seed(i,42)+.04*Math.sin(Math.PI*q));
        const sy=H*(.10+.84*seed(i,43)-.094*ease(q));
        const power=alpha*veil(q,.32,.37)*(.3+.4*seed(i,44));
        glow(f,sx,sy,u*.026,'252,216,143',power*.87);
        disc(f,sx,sy,u*(i % 5 ? .003 : .005),`rgba(255,229,177,${power})`);
      }
    });
  }

  api.registerEffect('divine_meridian', 'Meridian Observatory', 'Divine', 'An engraved armillary turns beneath a drifting nebula.', 3, meridian, { fullCard: true });
  api.registerEffect('divine_boreal', 'Boreal Veil', 'Divine', 'Polar curtains ripple across a sky lit from below.', 3, boreal, { fullCard: true });
  api.registerEffect('divine_opal', 'Opal Sanctum', 'Divine', 'A suspended opal refracts light through a field of crystals.', 3, opal, { fullCard: true });
  api.registerEffect('divine_imperial', 'Imperial Reliquary', 'Divine', 'An enamel seal turns inside a vault of gilded arches.', 3, imperial, { fullCard: true });
  api.registerEffect('divine_hellebore', 'Gilded Hellebore', 'Divine', 'A hellebore opens amid bending golden stems and drifting pollen.', 3, hellebore, { fullCard: true });
})();
