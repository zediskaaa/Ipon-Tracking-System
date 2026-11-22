(() => {
  'use strict';

  const api = globalThis.IponProfileEffects;
  if (!api?.registerEffect) return;
  const { TAU, frac, glow, star4 } = api._H;
  const { sin, cos, PI } = Math;
  const seed = (i, salt) => frac(sin(i * 41.27 + salt * 19.73) * 43758.54);
  const smooth = (v) => {
    const x = Math.max(0, Math.min(1, v));
    return x * x * (3 - 2 * x);
  };
  const envelope = (phase) => smooth(phase / .24) * smooth((1 - phase) / .32);

  function gradient(g, x1, y1, x2, y2, stops) {
    const result = g.createLinearGradient(x1, y1, x2, y2);
    for (const [at, color] of stops) result.addColorStop(at, color);
    return result;
  }

  function polygon(g, points, paint) {
    g.beginPath();
    g.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) g.lineTo(points[i], points[i + 1]);
    g.closePath();
    g.fillStyle = paint;
    g.fill();
  }

  function ellipse(g, x, y, rx, ry, color, angle = 0) {
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(x, y, rx, ry, angle, 0, TAU);
    g.fill();
  }

  function object(g, x, y, angle, scale, opacity, draw) {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    g.scale(scale, scale);
    g.globalAlpha *= opacity;
    draw();
    g.restore();
  }

  function light(g, x, y, radius, rgb, strength) {
    const alpha = g.globalAlpha;
    glow(g, x, y, radius, rgb, alpha * strength);
    g.globalAlpha = alpha;
  }

  function glint(g, x, y, r, tint, strength) {
    light(g, x, y, r * 3.8, tint, strength * .41);
    g.save();
    g.globalAlpha *= strength;
    g.fillStyle = '#fff7eb';
    star4(g, x, y, r);
    g.restore();
  }

  function line(g, x, y, endX, endY, paint, width) {
    g.strokeStyle = paint;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(endX, endY);
    g.stroke();
  }

  const gold = [[0,'#513622'],[.18,'#b88042'],[.34,'#f9df99'],[.44,'#fff1cb'],
    [.51,'#b08041'],[.72,'#64422e'],[.87,'#dfba77'],[1,'#8b5934']];
  const chrome = [[0,'#303442'],[.19,'#bacbce'],[.36,'#f9fcf9'],[.46,'#71818b'],
    [.50,'#272d3a'],[.71,'#475568'],[.87,'#ccdade'],[1,'#586576']];
  const rose = [[0,'#4a2d32'],[.18,'#ae7061'],[.39,'#ffcab0'],[.46,'#fff0cf'],
    [.54,'#a87168'],[.77,'#633d42'],[.89,'#d79c83'],[1,'#986656']];

  // Both canvases share one isotropic coordinate system. Each design supplies
  // exactly three tracks in paint order; the stage owns time, visibility and exit.
  function register(id, name, description, seconds, tint, compose) {
    api.registerEffect('deluxe_' + id, name, 'Deluxe', description, 3, (S) => {
      const { b, f, W, H } = S;
      const unit = Math.min(W / 300, H / 210);
      const w = W / unit;
      const h = H / unit;
      const ground = gradient(b, 0, 0, 0, h, [
        [0, 'rgba(' + tint + ',.96)'], [.33, 'rgba(' + tint + ',.80)'],
        [.61, 'rgba(' + tint + ',.32)'], [1, 'rgba(' + tint + ',.47)']
      ]);
      const [environment, centerpiece, illumination] = compose({ b, f, w, h });
      return (time, dt) => {
        const p = frac(time / seconds);
        const phase = p * TAU;
        const alpha = dt === 0 ? 1 : smooth(time / .82);
        b.save();
        f.save();
        b.scale(unit, unit);
        f.scale(unit, unit);
        b.globalAlpha = f.globalAlpha = alpha;
        b.fillStyle = ground;
        b.fillRect(0, 0, w, h);
        environment(phase, p);
        centerpiece(phase, p);
        illumination(phase, p);
        f.restore();
        b.restore();
      };
    }, { fullCard: true });
  }

  register('aureate', 'Aureate Mobile', 'Hammered gold sails balance above softly rippling champagne light.', 24, '42,29,24', ({ b, f, w, h }) => {
    const foil = gradient(b, -29, -21, 28, 19, gold);
    return [
      function brushedSilk(a) {
        light(b, w * (.33 + .14 * cos(a)), h * .32, 155, '200,142,71', .66);
        for (let i = 0; i < 22; i += 1) {
          const y = (i + .5) * h / 22;
          b.strokeStyle = i % 4 ? 'rgba(234,185,117,.09)' : 'rgba(238,200,141,.23)';
          b.lineWidth = i % 4 ? .55 : 1.1;
          b.beginPath();
          b.moveTo(0, y + 12 * sin(a + i * .23));
          b.bezierCurveTo(w * .34, y - 26, w * .67, y + 32 * sin(a + i * .17), w, y - 10);
          b.stroke();
        }
      },
      function suspendedSails(a) {
        const anchor = w * .65;
        const tip = h * .095 + 3 * sin(a);
        line(b, anchor, 0, anchor, tip, '#b4a482', .8);
        for (const [offset, length, size, lean] of [[-.31,.18,.77,-.2],[.02,.26,1.1,.23],[.23,.16,.85,-.46]]) {
          const swing = sin(a + offset * 6);
          const end = anchor + w * offset + swing * 4;
          const barY = tip + 9 * swing;
          const y = barY + h * length;
          line(b, anchor, tip, end, barY, '#caa979', 1.3);
          line(b, end, barY, end + swing * 4, y, '#c8b896', .7);
          object(b, end + swing * 4, y, lean + .19 * swing, size, 1, () => {
            b.scale(.72 + .27 * cos(a + lean), 1);
            polygon(b, [-32,2, -5,-18, 34,3, 11,27], '#523625');
            polygon(b, [-34,0, -7,-20, 32,1, 9,25], foil);
            polygon(b, [-34,0, -7,-20, 9,25], 'rgba(255,230,166,.19)');
            line(b, -7, -20, 9, 25, '#f6d39b', .7);
            for (let j = 0; j < 9; j += 1) {
              const x = -12 + j * 3.5;
              line(b, x, -2, x + 3, 4, 'rgba(92,58,29,.16)', .55);
            }
          });
        }
      },
      function goldLeaf(a, p) {
        light(b, w * (.5 + .36 * sin(a)), h * .81, 105, '199,132,58', .29);
        for (let i = 0; i < 13; i += 1) {
          const q = frac(p * 3 + seed(i, 2));
          const x = w * (.05 + .88 * seed(i, 5)) + 8 * sin(TAU * q);
          const y = h * (.10 + .68 * seed(i, 3) + .18 * q);
          const width = .65 + 2.8 * sin(PI * q) ** 2;
          object(f, x, y, TAU * q + i, 1, envelope(q) * .81, () => {
            polygon(f, [-width,0, 0,-1.1, width,0, 0,1.6], '#daae69');
            line(f, -width, 0, 0, -1.1, '#fff0bb', .55);
          });
        }
      }
    ];
  });

  register('parure', 'Diamond Parure', 'A marquise diamond collar opens across a midnight jeweler’s display.', 20, '18,26,42', ({ b, f, w, h }) => {
    const cut = gradient(b, -8, -18, 9, 18, chrome);
    const facets = ['#92a9c6','#d3edf5','#76859f','#bcacc8','#f5f8fe','#658b99'];
    function marquise(x, y, radius, tilt, twist) {
      object(b, x, y, tilt, radius, 1, () => {
        b.scale(.77 + .16 * twist, 1);
        const outline = [0,-16, 7,-8, 10,0, 7,8, 0,16, -7,8, -10,0, -7,-8];
        b.save();
        b.translate(1.5, 2);
        polygon(b, outline, 'rgba(6,15,30,.72)');
        b.restore();
        polygon(b, outline, cut);
        for (let j = 0; j < 8; j += 1) {
          const k = j * 2, next = (k + 2) % 16;
          polygon(b, [outline[k],outline[k+1], outline[next],outline[next+1], twist * 2, -2], facets[j % 6]);
        }
        polygon(b, [0,-9, 4,0, 0,8, -4,0], cut);
        line(b, 0, -15, -7, -8, '#fffaff', .6);
      });
    }
    return [
      function caseReflections(a) {
        light(b, w * (.20 + .12 * sin(a)), h * .27, 145, '102,151,192', .59);
        for (let i = 0; i < 5; i += 1) {
          const y = h * (.26 + i * .145);
          const shift = 12 * sin(a + i);
          polygon(b, [0,y, w*.51,y-18+shift, w,y+7, w*.53,y-11+shift], 'rgba(151,186,215,.11)');
        }
      },
      function articulatedCollar(a) {
        const center = w * .63;
        const yAt = (x) => h * (.16 + .20 * cos((x - .5) * PI * 1.48)) + 4 * sin(a + x * 4);
        for (let i = 0; i <= 12; i += 1) {
          const x = i / 12;
          const at = center + (x - .5) * w * .77;
          const y = yAt(x);
          if (i) line(b, at - w * .77 / 12, yAt((i - 1) / 12) - 6, at, y - 6, '#c2c5cf', 1.3);
          marquise(at, y, .47 + .72 * sin(PI * x) ** 3, (x - .5) * 1.62 + .09 * sin(a + i), sin(a + i * .42));
        }
      },
      function dispersion(a, p) {
        for (let i = 0; i < 7; i += 1) {
          const q = frac(p * 2 + i / 7);
          const x = w * (.1 + .77 * seed(i, 20));
          const y = h * (.42 + .40 * seed(i, 22)) + 12 * sin(q * PI);
          const ray = gradient(f, x, y, x + w * .23, y - 18, [
            [0,'rgba(213,242,255,.82)'],[.38,'rgba(150,181,255,.25)'],[1,'rgba(219,155,215,0)']
          ]);
          f.save();
          f.globalAlpha *= envelope(q) * .62;
          polygon(f, [x,y, x+w*.26,y-19+8*cos(a), x+w*.22,y-4], ray);
          f.restore();
          glint(f, x, y, 2.7, '183,214,255', envelope(q) * .86);
        }
      }
    ];
  });

  register('nocturne', 'Midnight Nocturne', 'Black lacquer and silver piano keys catch a moving studio light.', 24, '13,17,26', ({ b, f, w, h }) => {
    const ebony = gradient(b, -7, 0, 7, 0, [[0,'#121620'],[.16,'#535862'],[.27,'#262b35'],[.84,'#0b0e15'],[1,'#697078']]);
    return [
      function lacquerGrain(a) {
        light(b, w * (.3 + .16 * cos(a)), h * .35, 151, '93,104,129', .51);
        for (let i = 0; i < 17; i += 1) {
          const x = (i - 3) * w / 13;
          b.beginPath();
          b.moveTo(x, 0);
          b.bezierCurveTo(x + w * .23, h * .27, x - 29 + 7 * sin(a + i), h * .69, x + w * .2, h);
          b.strokeStyle = i % 3 ? 'rgba(145,154,169,.10)' : 'rgba(170,158,140,.22)';
          b.lineWidth = .65;
          b.stroke();
        }
      },
      function grandPiano(a) {
        object(b, w * .68, h * .23, -.41, Math.min(w / 334, 1.15), 1, () => {
          const silver = gradient(b, 0, -29, 5, 31, chrome);
          polygon(b, [-95,-30, 94,-30, 94,34, -95,34], '#0d0c14');
          for (let i = 0; i < 12; i += 1) {
            const x = -91 + i * 15.3;
            const depth = 3.5 * Math.max(0, cos(2 * a - i * .63)) ** 6;
            polygon(b, [x,-28, x+14.5,-28, x+14.5,27-depth, x,27-depth], silver);
            line(b, x, 28-depth, x+14.3, 28-depth, '#6a6260', 2.4);
          }
          for (let i = 0; i < 11; i += 1) {
            if (i % 7 === 2 || i % 7 === 6) continue;
            object(b, -76.3 + i * 15.3, -9, 0, 1, 1, () => {
              b.fillStyle = ebony;
              b.fillRect(-4.3, -19, 8.6, 34);
              line(b, -4, 15, 4, 15, '#050911', 2);
            });
          }
          line(b, -95, -30, 94, -30, '#d6ba8e', 1.2);
        });
      },
      function studioBlades(a) {
        for (let i = 0; i < 3; i += 1) {
          const x = w * (.50 + .39 * sin(a + i * 1.92));
          const width = w * (.08 + i * .025);
          const paint = gradient(f, x, 0, x + width, 0, [[0,'rgba(169,193,215,0)'],[.62,'rgba(169,193,215,.12)'],[1,'rgba(169,193,215,0)']]);
          polygon(f, [x,0, x+width,0, x+width+w*.21,h, x+w*.21,h], paint);
          light(b, x + w*.15, h * (.78 - i * .19), 47, '142,158,184', .19);
        }
      }
    ];
  });

  register('nacre', 'Atelier Nacre', 'A graduated pearl strand floats over pleated silk and pools of iridescent light.', 22, '57,46,57', ({ b, f, w, h }) => {
    const pearl = b.createRadialGradient(-.36, -.46, .025, .05, .03, 1.08);
    for (const [stop, color] of [[0,'#fffef1'],[.16,'#ffefd9'],[.36,'#dbcdd5'],[.58,'#aba9bf'],[.74,'#829697'],[.84,'#c9aeaa'],[.94,'#e5cbb5'],[1,'#756978']]) pearl.addColorStop(stop, color);
    const silk = gradient(b,0,0,w,h,[[0,'#e8bcc4'],[.31,'#fff0d9'],[.62,'#a9bdc4'],[1,'#e1bac8']]);
    return [
      function pleatedSilk(a) {
        b.save();
        const alpha = b.globalAlpha;
        b.strokeStyle = silk;
        for (let i = -2; i < 7; i += 1) {
          const x = w*i/5, sway = sin(a+i*.57)*17;
          b.beginPath(); b.moveTo(x,-28);
          b.bezierCurveTo(x+107+sway,h*.38,x-64,h*.64,x+16,h+28);
          for (const [width, opacity] of [[44,.035],[32,.045],[24,.055],[17,.062],[11,.07],[6,.07],[2,.065]]) {
            b.lineWidth = width;
            b.globalAlpha = alpha*opacity; b.stroke();
          }
        }
        b.restore();
      },
      function graduatedStrand(a) {
        const beads = 23;
        for (let i = 0; i < beads; i += 1) {
          const u = i / (beads - 1);
          const x = w * (-.035 + 1.08 * u);
          const y = h * (.14 + .29 * sin(PI * u) - .16 * u) + 7 * sin(a + u * 4);
          const r = (4.6 + 5.3 * sin(PI * u)) * (.96 + .04 * cos(a + u));
          object(b, x, y, .07 * sin(a + u), r, 1, () => {
            ellipse(b, .22, .47, 1.06, .73, 'rgba(52,38,55,.50)');
            ellipse(b, 0, 0, 1, .96, pearl);
            ellipse(b, -.32, -.44, .23, .11, 'rgba(255,255,244,.85)', -.35);
            ellipse(b, .45, .44, .17, .065, 'rgba(229,230,207,.58)', -.68);
          });
        }
      },
      function nacreousSheen(a) {
        for (let i = 0; i < 5; i += 1) {
          const x = w * (.13 + .18 * i + .08 * cos(a + i));
          const y = h * (.71 + .19 * sin(a + i * 1.7));
          light(b, x, y, 63, i % 2 ? '148,214,213' : '231,172,193', .25);
          glint(f, x, y, 1.0 + .7 * cos(a + i), '248,227,218', .38);
        }
      }
    ];
  });

  register('malachite', 'Malachite Cabinet', 'Bookmatched malachite doors part around a step-cut emerald in a gold setting.', 24, '12,42,34', ({ b, f, w, h }) => {
    const metal = gradient(b, -48, -28, 45, 27, gold);
    const stone = gradient(b, -37, -20, 32, 24, [[0,'#0a4238'],[.28,'#238874'],[.42,'#97e3b6'],[.48,'#187564'],[.74,'#103d38'],[1,'#40b48e']]);
    return [
      function bookmatchedVeins(a) {
        for (const side of [-1, 1]) {
          b.save();
          b.translate(w * .53, 0);
          b.scale(side, 1);
          b.beginPath(); b.moveTo(0,0); b.lineTo(w,0); b.lineTo(w,h); b.lineTo(0,h); b.closePath(); b.clip();
          for (let i = -9; i <= 29; i += 1) {
            const x = i*7 + 2*sin(i*1.1);
            b.lineWidth = i%5 ? .7 + seed(i,51)*1.6 : 3.1;
            b.strokeStyle = i%5 ? 'rgba(126,202,150,.26)' : 'rgba(2,23,21,.57)';
            b.beginPath();
            for (let j=0; j<=32; j+=1) {
              const u=j/32, t=u*TAU;
              const vein=x+33*sin(t+i*.055)+12*sin(2*t+i*.15)+4*sin(3*t+i*.19+a);
              if (!j) b.moveTo(vein,0); else b.lineTo(vein,u*h);
            }
            b.stroke();
          }
          b.restore();
        }
      },
      function cabinetClasp(a) {
        const open = (1 - cos(a)) * 3.2;
        object(b, w * .57, h * .24 + sin(a) * 2, -.075, 1, 1, () => {
          for (const side of [-1, 1]) {
            const edge = side * (35 + open);
            line(b, edge, -h, edge, h, 'rgba(4,25,23,.72)', 5);
            line(b, edge - 1.3, -h, edge - 1.3, h, '#bd9c65', 1);
            polygon(b, [edge, -18, edge + side * 20,-9, edge + side * 20,9, edge,18], metal);
          }
          const outline = [-39,-14,-28,-25,26,-25,39,-13,39,14,28,25,-28,25,-39,14];
          ellipse(b, 4, 9, 45, 26, 'rgba(2,22,21,.73)');
          polygon(b, outline, metal);
          b.scale(.91, .86);
          polygon(b, outline, stone);
          for (let i = 0; i < outline.length; i += 2) {
            const j = (i + 2) % outline.length;
            const [x,y,x2,y2] = [outline[i],outline[i+1],outline[j],outline[j+1]];
            polygon(b, [x,y,x2,y2,x2*.73,y2*.64,x*.73,y*.64],
              'rgba(173,255,209,' + (.18 + .16 * sin(a + i * .8)) + ')');
            line(b, x*.73, y*.64, x2*.73, y2*.64, 'rgba(187,232,194,.63)', .75);
          }
        });
      },
      function movingInlay(a, p) {
        for (let i = 0; i < 8; i += 1) {
          const q = frac(p * 2 + i * .139);
          const x = w * (i % 2 ? .92 : .10) + 13 * sin(a + i);
          const y = h * q;
          line(f, x, y, x + 5, y - 12, 'rgba(234,209,143,' + envelope(q) * .37 + ')', .8);
          light(b, x, y, 44, '116,205,151', envelope(q) * .27);
        }
      }
    ];
  });

  register('argent', 'Argent Helix', 'A polished ribbon twists between smoked mirrors as narrow white reflections travel the room.', 20, '30,37,48', ({ b, f, w, h }) => {
    const spectrum = [
      [0,[61,72,83]],[.14,[145,166,170]],[.30,[248,251,243]],[.42,[184,200,200]],
      [.54,[77,92,107]],[.60,[39,48,64]],[.78,[70,84,96]],[1,[185,201,206]]
    ];
    const bands = 30;
    const silver = Array.from({length:bands}, (_,i) => {
      const u=(i+.5)/bands, k=spectrum.findIndex(([v])=>v>=u);
      const [lo,left]=spectrum[k-1], [hi,right]=spectrum[k];
      return 'rgb('+left.map((v,c)=>Math.round(v+(right[c]-v)*(u-lo)/(hi-lo))).join(',')+')';
    });
    const ribbon = Array.from({length:65}, (_,i) => ({u:i/64,y:(i/64*1.15-.075)*h}));
    return [
      function mirrorPanels(a) {
        for (let i = -1; i < 7; i += 1) {
          const x = w * (i / 6 + .035 * sin(a + .32 * i));
          const width = w * .17;
          polygon(b, [x,0,x+width,0,x+width-29,h,x-29,h],
            gradient(b, x, 0, x + width, h * .13, [[0,'rgba(21,27,37,.70)'],[.14,'rgba(171,195,199,.21)'],[.8,'rgba(56,66,80,.19)'],[1,'rgba(195,210,222,.27)']]));
        }
      },
      function silverRibbon(a) {
        // Continuous lengthwise strips keep the reflection aligned with the
        // twisting metal, including where the ribbon is nearly edge-on.
        for (const row of ribbon) {
          const angle=a+row.u*TAU*1.52;
          row.center=w*(.63+.18*sin(angle))+13*row.u;
          row.half=5+27*(.5+.5*cos(angle+.5));
          row.spec=.19*sin(angle);
        }
        function strip(left,right,paint,offset=0) {
          const projected=(row,u)=>row.center+offset+row.half*(2*u-1+4*u*(1-u)*row.spec);
          b.beginPath(); b.moveTo(projected(ribbon[0],left),ribbon[0].y);
          for (const row of ribbon) b.lineTo(projected(row,left),row.y);
          for (let k=ribbon.length-1;k>=0;k--) b.lineTo(projected(ribbon[k],right),ribbon[k].y);
          b.closePath(); b.fillStyle=paint; b.fill();
        }
        strip(0,1,'rgba(8,14,24,.48)',4);
        strip(0,1,'#8a9b9f');
        for (let i=0;i<bands;i++) strip(i/bands,Math.min(1,(i+1.36)/bands),silver[i]);
      },
      function silverSlivers(a,p) {
        for (let i = 0; i < 10; i += 1) {
          const q = frac(p * 2 + seed(i, 15));
          const x = w * q;
          const y = h * (.08 + .84 * seed(i, 16)) + 6 * sin(a + i);
          line(f, x, y, x + 4 + 9 * seed(i, 17), y - 2, 'rgba(225,238,238,' + envelope(q) * .59 + ')', .8);
          light(b, x, y, 37, '175,203,222', envelope(q) * .19);
        }
      }
    ];
  });

  register('calibre', 'Rose Calibre', 'An openworked rose-gold movement turns behind a blued balance spring and ruby bearings.', 24, '58,35,39', ({ b, f, w, h }) => {
    const metal = gradient(b,-38,-36,36,38,rose);
    function wheel(x,y,r,teeth,angle) {
      object(b, x, y, angle, r / 40, 1, () => {
        b.beginPath();
        for (let i = 0; i < teeth * 4; i += 1) {
          const theta = TAU * i / (teeth * 4);
          const radius = i % 4 < 2 ? 40 : 36;
          const px = cos(theta) * radius, py = sin(theta) * radius;
          if (!i) b.moveTo(px,py);
          else b.lineTo(px,py);
        }
        b.closePath();
        b.moveTo(30,0);
        b.arc(0,0,30,0,TAU,true);
        b.fillStyle = metal;
        b.fill('evenodd');
        for (let i = 0; i < 6; i += 1) {
          const t = TAU * i / 6;
          line(b, 0,0,cos(t)*32,sin(t)*32,'#694947',4.5);
          line(b, 0,-.8,cos(t)*32,sin(t)*32-.8,'#dbab91',2);
        }
        ellipse(b,0,1,8.6,8.6,'#4d3239');
        ellipse(b,0,0,7,7,metal);
        ellipse(b,0,0,3.4,3.4,'#953f51');
        ellipse(b,-.9,-1.2,.95,.72,'#ffdcce');
      });
    }
    return [
      function balanceSpring(a) {
        const x = w * .80, y = h * .80;
        for (let i = 0; i < 8; i += 1) {
          const r = 15 + i * 9;
          b.beginPath();
          b.ellipse(x,y,r,r*.85,-.2,0,TAU);
          b.strokeStyle = i % 2 ? 'rgba(248,200,169,.16)' : 'rgba(33,23,32,.48)';
          b.lineWidth = i % 2 ? .75 : 2;
          b.stroke();
        }
        b.beginPath();
        for (let j = 0; j <= 110; j += 1) {
          const u = j / 110, theta = u * TAU * 3.4 + .55 * sin(a * 4);
          const r = u * (33 + 3 * sin(a * 4));
          const px = x + r*cos(theta), py = y + r*.85*sin(theta);
          if (!j) b.moveTo(px,py); else b.lineTo(px,py);
        }
        b.strokeStyle = '#b1a9ad'; b.lineWidth = 1.2; b.stroke();
      },
      function gearTrain(a) {
        const x = w * .65, y = h * .26;
        for (const [dx,dy,r] of [[0,0,40],[-51,25,20],[47,-28,20]]) {
          ellipse(b,x+dx+2,y+dy+4,r,r,'rgba(39,21,29,.53)');
        }
        wheel(x-51,y+25,20,12,-2*a+.14);
        wheel(x+47,y-28,20,12,-2*a+.11);
        wheel(x,y,40,24,a);
      },
      function escapementHighlights(a,p) {
        for (let i = 0; i < 9; i += 1) {
          const q = frac(p * 2 + seed(i,22));
          const x = w * (.05 + .91 * seed(i,23));
          const y = h * (.09 + .84 * seed(i,24)) - 8 * q;
          glint(f,x,y,(1.1+seed(i,25))*envelope(q),'251,187,163',envelope(q)*.77);
        }
        light(b,w*(.38+.26*sin(a)),h*.48,94,'226,145,120',.32);
      }
    ];
  });
})();
