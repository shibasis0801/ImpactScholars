/* Two clocks or one: a progression simulator (PPMI Atlas explorer "twoclock").
   Everything shown is simulated; no PPMI data are read or embedded. The model follows guide section 10.4.
   Curve shapes, units, noise levels and loadings are illustrative. */
(function () {
  'use strict';
  const X = (window.PPMIExplorers = window.PPMIExplorers || {});
  const P = 'twoclock', NS = 'http://www.w3.org/2000/svg', MINUS = '−';

  /* ---------- Model constants (illustrative) ---------- */
  const T0 = -0.25, T1 = 5.5, LANDMARK = 2.5, NMAX = 400, DOM = 6;
  // SBR(D) = floor + drop / (1 + exp(k (D - mid))): the putamen starts lower, falls earlier and floors (guide 3.1, 3.2, 6.2)
  const PUT = [0.35, 1.85, 0.8, -1], CAU = [0.8, 2.2, 0.35, 2];
  const GMC = [104, 4, 0.15];                    // grey matter(S) = 104 - 4 exp(0.15 S); 100 = average person at baseline
  const SD = { sbr: 0.12, gm: 0.6, cog: 0.5 };   // noise SD per measurement at noise x1
  const SLOPE = 0.4;                             // z units lost per year of a clock at link strength 1
  const SCHED = { dat: [-2 / 12, 1, 2, 4], mri: [0, 2, 4], cog: [0, 1, 2, 3, 4, 5] }; // guide 2.3, 4.6, 6.2
  const LMK = { dat: [-2 / 12, 1, 2], mri: [0, 2], cog: [0, 1, 2] };                   // data up to the 2.5-year landmark
  const NE = 16 + 3 + 36;                        // stored noise draws per person: DaTScan 4 visits x 4 regions, MRI 3, tests 6 x 6
  const TESTS = [
    ['HVLT-R immediate recall', 'Immediate recall', 'both'], ['HVLT-R delayed recall', 'Delayed recall', 'S'],
    ['Benton Judgment of Line Orientation', 'Line orientation', 'S'], ['Letter-Number Sequencing', 'Letter-Number', 'D'],
    ['Symbol Digit Modalities', 'Symbol Digit', 'D'], ['Semantic fluency (animals)', 'Animal fluency', 'S']
  ].map(([name, short, expect]) => ({ name, short, expect }));
  const PRESETS = [ // [link to D, link to S] per test, in TESTS order; every preset has links summing to 0.8
    ['Dual syndrome hypothesis', [[0.4, 0.4], [0.1, 0.7], [0.1, 0.7], [0.7, 0.1], [0.7, 0.1], [0.1, 0.7]]],
    ['All on D', TESTS.map(() => [0.8, 0])], ['All on S', TESTS.map(() => [0, 0.8])], ['Equal', TESTS.map(() => [0.4, 0.4])]
  ];

  /* ---------- Pure maths ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussian(rand) { // Box-Muller, both values used
    let spare = null;
    return function () {
      if (spare !== null) { const v = spare; spare = null; return v; }
      let u = 0; while (u < 1e-12) u = rand();
      const r = Math.sqrt(-2 * Math.log(u)), th = 2 * Math.PI * rand();
      spare = r * Math.sin(th); return r * Math.cos(th);
    };
  }
  const OUT = [0, 0]; // [value, slope]; shared to keep the Monte Carlo allocation-free
  function sbr(c, x) { const e = Math.exp(c[2] * (x - c[3])); OUT[0] = c[0] + c[1] / (1 + e); OUT[1] = -c[1] * c[2] / (1 / e + 2 + e); return OUT; }
  function gm(x) { const e = Math.exp(GMC[2] * x); OUT[0] = GMC[0] - GMC[1] * e; OUT[1] = -GMC[1] * GMC[2] * e; return OUT; }
  function cog(w, d, s) { return -SLOPE * (w[0] * d + w[1] * s); } // links are 0..1 strengths; the sign makes more disease = lower score

  // Covariance of the offsets after sliding a fraction c of the way onto the diagonal (c = 1: one clock, each person
  // keeps the mean of their two offsets). Returns SDs and correlation of P Omega P', P = [[1-c/2, c/2], [c/2, 1-c/2]].
  function omega(sD, sS, rho, c) {
    const a = 1 - c / 2, b = c / 2, vD = sD * sD, vS = sS * sS, cv = rho * sD * sS;
    const oD = a * a * vD + 2 * a * b * cv + b * b * vS, oS = b * b * vD + 2 * a * b * cv + a * a * vS;
    const oc = a * b * (vD + vS) + (a * a + b * b) * cv, xD = Math.sqrt(oD), xS = Math.sqrt(oS);
    return { sD: xD, sS: xS, rho: xD > 1e-12 && xS > 1e-12 ? Math.max(-1, Math.min(1, oc / (xD * xS))) : 1 };
  }
  function discSD(sD, sS, rho) { return Math.sqrt(Math.max(0, sD * sD + sS * sS - 2 * rho * sD * sS)); }
  function ellipse(sD, sS, rho, k, n) { // k-SD contour of N(0, Omega) through the Cholesky factor
    const c = Math.sqrt(Math.max(0, 1 - rho * rho)), pts = [];
    for (let j = 0; j <= n; j++) { const a = 2 * Math.PI * j / n, u = Math.cos(a), v = Math.sin(a); pts.push([k * sD * u, k * sS * (rho * u + c * v)]); }
    return pts;
  }
  // Between-person variance of one test at a fixed year: lD^2 sD^2 + lS^2 sS^2 + 2 rho lD lS sD sS + noise^2.
  // D and S each get their own term plus half of the covariance term.
  function split(w, o, noise) {
    const a = SLOPE * w[0] * o.sD, b = SLOPE * w[1] * o.sS, half = a * b * o.rho, e = Math.pow(SD.cog * noise, 2);
    return { D: a * a + half, S: b * b + half, cov: 2 * half, noise: e, total: a * a + b * b + 2 * half + e };
  }
  // SE of one person's estimated D - S (maximum likelihood, curves and loadings known) at the average offsets,
  // from the expected Fisher information for (dD, dS) under schedule sch.
  function discSE(W, noise, sch) {
    const s2 = Math.pow(SD.sbr * noise, 2), g2 = Math.pow(SD.gm * noise, 2), e2 = Math.pow(SD.cog * noise, 2);
    let a = 0, b = 0, c = 0;
    sch.dat.forEach(t => { const p = sbr(PUT, t)[1], q = sbr(CAU, t)[1]; a += 2 * (p * p + q * q) / s2; }); // left and right
    sch.mri.forEach(t => { const g = gm(t)[1]; c += g * g / g2; });
    sch.cog.forEach(() => W.forEach(w => { const d = SLOPE * w[0], s = SLOPE * w[1]; a += d * d / e2; b += d * s / e2; c += s * s / e2; }));
    return Math.sqrt((a + c + 2 * b) / (a * c - b * b));
  }
  function normCdf(z) { // Abramowitz and Stegun 7.1.26
    const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
    const erf = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
    return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
  }
  function chi2q95(df) { const a = 2 / (9 * df); return df * Math.pow(1 - a + 1.6448536 * Math.sqrt(a), 3); } // Wilson-Hilferty

  // Monte Carlo: in each of R simulated cohorts, fit every person's D offset to their DaTScans (putamen and caudate,
  // mean of left and right) and S offset to their MRIs by Gauss-Newton with the true curves, then call "two clocks"
  // when Q = sum (dD^ - dS^)^2 / (SE_D^2 + SE_S^2) exceeds the chi-square 95th percentile with N df.
  const MC_T = { 2: [0, 4], 3: [0, 2, 4], 4: [0, 4 / 3, 8 / 3, 4] };
  const FIT = { d: 0, info: 0 }; // offset estimate and sum of squared curve slopes at it
  function fitOffset(ts, k, y1, y2) { // y2 null: MRI fit; otherwise DaTScan fit (y1 putamen, y2 caudate)
    let d = 0, den = 0;
    for (let it = 0; it < 8; it++) {
      let nu = 0; den = 0;
      for (let j = 0; j < k; j++) {
        const x = ts[j] + d;
        if (y2) { sbr(PUT, x); nu += OUT[1] * (y1[j] - OUT[0]); den += OUT[1] * OUT[1]; sbr(CAU, x); nu += OUT[1] * (y2[j] - OUT[0]); den += OUT[1] * OUT[1]; }
        else { gm(x); nu += OUT[1] * (y1[j] - OUT[0]); den += OUT[1] * OUT[1]; }
      }
      if (den < 1e-12) break;
      let st = nu / den; st = st > 1.5 ? 1.5 : st < -1.5 ? -1.5 : st;
      d += st; d = d > 10 ? 10 : d < -10 ? -10 : d;
      if (st < 1e-4 && st > -1e-4) break;
    }
    FIT.d = d; FIT.info = den;
    return FIT;
  }
  function mcPower(p, k, R, seed) { // share of cohorts in which the test picks two clocks
    const ts = MC_T[k], sb = SD.sbr * p.noise / Math.SQRT2, sg = SD.gm * p.noise, crit = chi2q95(p.N);
    const c = Math.sqrt(Math.max(0, 1 - p.rho * p.rho)), s1 = discSD(p.sD, p.sS, -p.rho) / 2; // SD of the mean offset
    const y1 = new Float64Array(k), y2 = new Float64Array(k), y3 = new Float64Array(k);
    let two = 0;
    for (let r = 0; r < R; r++) {
      const g = gaussian(mulberry32(seed + 7919 * r));
      let Q = 0;
      for (let i = 0; i < p.N; i++) {
        const z1 = g(), z2 = g();
        const dD = p.one ? s1 * z1 : p.sD * z1, dS = p.one ? dD : p.sS * (p.rho * z1 + c * z2);
        for (let j = 0; j < k; j++) {
          y1[j] = sbr(PUT, ts[j] + dD)[0] + sb * g(); y2[j] = sbr(CAU, ts[j] + dD)[0] + sb * g(); y3[j] = gm(ts[j] + dS)[0] + sg * g();
        }
        fitOffset(ts, k, y1, y2); const eD = FIT.d, vD = sb * sb / FIT.info;
        fitOffset(ts, k, y3, null); const e = eD - FIT.d;
        Q += e * e / (vD + sg * sg / FIT.info);
      }
      if (Q > crit) two++;
    }
    return two / R;
  }
  function pct(v) { return v > 0 && v < 0.005 ? '<1%' : Math.round(v * 100) + '%'; }
  function num(v, d) { const t = Math.abs(v).toFixed(d); return (v < 0 && +t !== 0 ? MINUS : '') + t; }
  function sgn(v, d) { const t = Math.abs(v).toFixed(d); return (+t === 0 ? '' : v < 0 ? MINUS : '+') + t; }
  // One plain sentence (main) plus the numbers behind it (detail). Reliability R = SD^2 / (SD^2 + SE^2) is the share of
  // the true D - S variance a person's estimate recovers; "clearly discordant" means |D - S| > 2 SE.
  function verdict(v) { // v: { one, sdd, se, rho, sD, sS }
    if (v.one) return { main: 'With one clock D − S is zero for everyone, so a two-clock model fitted to these data would collapse onto the one-clock model and predict the same thing.', detail: '' };
    const R = v.sdd * v.sdd / (v.sdd * v.sdd + v.se * v.se), frac = v.sdd > 0 ? 2 * (1 - normCdf(2 * v.se / v.sdd)) : 0;
    const share = frac < 0.005 ? 'Fewer than 1%' : 'About ' + pct(frac), lead = `${share} of people have clocks that disagree by more than measurement noise can explain, so `;
    let main;
    if (R < 0.3) {
      const R0 = (v.sD * v.sD + v.sS * v.sS) / (v.sD * v.sD + v.sS * v.sS + v.se * v.se);
      main = lead + 'one clock and two clocks predict almost the same thing; the main reason here is ' + (R0 >= 0.6 ? 'the high correlation between the offsets.' : 'that the offsets are small compared with measurement noise.');
    } else if (R < 0.6) main = lead + 'two clocks should predict somewhat better than one, mainly for those people.';
    else main = lead + 'two clocks should predict held-out participants’ later measurements better than one.';
    let detail = `SD of D − S ${num(v.sdd, 2)} years; SE of one person’s D − S by the 2.5-year landmark ${num(v.se, 2)} years; reliability ${num(R, 2)}; clearly discordant means beyond 2 SE.`;
    if (v.rho >= 0.9 && Math.abs(v.sD - v.sS) >= 0.3) detail += ' A correlation near 1 is not enough for one clock: with unequal SDs the offsets still differ, because both clocks tick at one year per year.';
    return { main, detail };
  }

  /* ---------- DOM helpers ---------- */
  const cls = n => n.split(' ').map(x => P + '-' + x).join(' ');
  function h(tag, attrs, parent, text) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function s(tag, attrs, parent, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  const clear = e => { while (e.firstChild) e.removeChild(e.firstChild); };
  function lin(d0, d1, r0, r1) { const k = (r1 - r0) / (d1 - d0), f = v => r0 + (v - d0) * k; f.inv = p => d0 + (p - r0) / k; return f; }
  function mark(g, slot, x, y, r) { // A circle, B square, C triangle
    if (slot === 0) return s('circle', { cx: x, cy: y, r }, g);
    if (slot === 1) return s('rect', { x: x - 0.88 * r, y: y - 0.88 * r, width: 1.76 * r, height: 1.76 * r }, g);
    return s('path', { d: `M${x},${y - 1.2 * r}L${x + 1.1 * r},${y + 0.8 * r}L${x - 1.1 * r},${y + 0.8 * r}Z` }, g);
  }
  function frame(g, x, y, o) { // gridlines, ticks, labels
    o.yt.forEach(v => {
      s('line', { x1: o.m.l, x2: o.w - o.m.r, y1: y(v), y2: y(v), class: cls('gl') }, g);
      s('text', { x: o.m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, g, o.yf(v));
    });
    o.xt.forEach(v => {
      if (o.vgrid) s('line', { x1: x(v), x2: x(v), y1: o.m.t, y2: o.h - o.m.b, class: cls('gl') }, g);
      s('line', { x1: x(v), x2: x(v), y1: o.h - o.m.b, y2: o.h - o.m.b + 4, class: cls('ax') }, g);
      s('text', { x: x(v), y: o.h - o.m.b + 16, 'text-anchor': 'middle' }, g, o.xf(v));
    });
    s('line', { x1: o.m.l, x2: o.w - o.m.r, y1: o.h - o.m.b, y2: o.h - o.m.b, class: cls('ax') }, g);
    if (o.xl) s('text', { x: (o.m.l + o.w - o.m.r) / 2, y: o.h - 3, 'text-anchor': 'middle', class: cls('tfg') }, g, o.xl);
    if (o.yl) s('text', { transform: `translate(11,${(o.m.t + o.h - o.m.b) / 2}) rotate(-90)`, 'text-anchor': 'middle', class: cls('tfg') }, g, o.yl);
  }
  function legendItem(parent, draw, text) {
    const it = h('span', {}, parent), sv = s('svg', { width: 22, height: 14, 'aria-hidden': 'true' }, it);
    draw(sv); it.appendChild(document.createTextNode(text)); return it;
  }
  function abcKey(sv, k) {
    s('line', { x1: 1, x2: 21, y1: 7, y2: 7, class: cls('hl' + (k ? ' hl' + k : '')) }, sv);
    mark(sv, k, 11, 7, 3.6).setAttribute('class', cls('mk'));
  }
  function setBar(box, sp, one, labelled) { // segmented bar: D, S (or one clock), noise
    const parts = one ? [['f1', Math.max(0, sp.D + sp.S)]] : [['fd', Math.max(0, sp.D)], ['fs', Math.max(0, sp.S)]];
    parts.push(['fn', sp.noise]);
    const tot = parts.reduce((a, q) => a + q[1], 0) || 1, W = labelled ? box.clientWidth : 0;
    while (box.childNodes.length < 3) h('span', {}, box);
    Array.from(box.childNodes).forEach((el, j) => {
      const q = parts[j], f = q ? q[1] / tot : 0;
      el.style.display = f < 0.002 ? 'none' : '';
      if (!q) return;
      el.className = cls(q[0]); el.style.flex = f + ' 1 0';
      el.textContent = labelled && f * W >= 44 ? pct(f) : '';
    });
    return parts.map(q => q[1] / tot);
  }

  const CSS = `
.twoclock-root{font:14px/1.45 var(--font-ui);color:var(--fg);position:relative}
.twoclock-root *{box-sizing:border-box}
.twoclock-root :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.twoclock-intro{font:15px/1.55 var(--font-body);margin:0 0 14px;max-width:92ch}
.twoclock-link{background:none;border:0;padding:0;font:600 14px var(--font-ui);color:var(--accent);text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.twoclock-grid{display:grid;gap:14px;grid-template-columns:minmax(0,1fr);grid-template-areas:"ctl" "plane" "traj" "load" "disc"}
.twoclock-mid .twoclock-grid{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-areas:"ctl ctl" "plane disc" "traj traj" "load load"}
.twoclock-wide .twoclock-grid{grid-template-columns:250px repeat(2,minmax(0,1fr));grid-template-areas:"ctl plane disc" "traj traj traj" "load load load"}
.twoclock-ctl{grid-area:ctl}.twoclock-plane{grid-area:plane}.twoclock-disc{grid-area:disc}.twoclock-traj{grid-area:traj}.twoclock-load{grid-area:load}
.twoclock-card{border:1px solid var(--rule);border-radius:8px;padding:12px 14px;min-width:0;background:var(--surface)}
.twoclock-card h3{margin:0 0 4px;font:600 15px var(--font-ui)}
.twoclock-card h4{margin:14px 0 2px;font:600 13px var(--font-ui)}
.twoclock-how{margin:0 0 8px;font-size:13px;color:var(--muted);max-width:120ch}
.twoclock-how b{color:var(--fg);font-weight:600}
.twoclock-syn{margin:8px 0 0;font-size:12px;color:var(--muted);font-style:italic}
.twoclock-note{margin:6px 0 0;font-size:12px;color:var(--muted)}
.twoclock-crows{display:grid;gap:10px 18px;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}
.twoclock-wide .twoclock-crows{grid-template-columns:minmax(0,1fr)}
.twoclock-crow label{display:flex;justify-content:space-between;gap:8px;font-size:13px}
.twoclock-check{display:flex;gap:8px;align-items:flex-start}.twoclock-check label{display:block}
.twoclock-check input{margin:3px 0 0}
.twoclock-out{font-variant-numeric:tabular-nums;font-weight:600}
.twoclock-root input[type=range]{width:100%;margin:4px 0 0;accent-color:var(--fg)}
.twoclock-root input.twoclock-rd{accent-color:var(--accent)}.twoclock-root input.twoclock-rs{accent-color:var(--accent-2)}
.twoclock-root select{font:13px var(--font-ui);color:var(--fg);background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:4px 6px;width:100%;margin-top:4px}
.twoclock-btn{font:13px var(--font-ui);color:var(--fg);background:var(--surface-2);border:1px solid var(--rule);border-radius:6px;padding:5px 10px;cursor:pointer}
.twoclock-btn:hover{border-color:var(--axis)}
.twoclock-btn[aria-pressed=true]{background:var(--fg);color:var(--surface);border-color:var(--fg)}
.twoclock-seed{font-size:12px;color:var(--muted);margin-left:8px;font-variant-numeric:tabular-nums}
.twoclock-legend{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12px;color:var(--muted);margin:0 0 6px;align-items:center}
.twoclock-legend svg{vertical-align:middle;margin-right:4px}
.twoclock-wrap{position:relative}
.twoclock-root svg{display:block;overflow:visible}
.twoclock-legend svg,.twoclock-hlist svg{display:inline-block}
.twoclock-root svg text{font:12px var(--font-ui);fill:var(--muted);font-variant-numeric:tabular-nums}
.twoclock-root svg text.twoclock-tfg{fill:var(--fg)}
.twoclock-root svg text.twoclock-lbl{fill:var(--fg);font-weight:700}
.twoclock-gl{stroke:var(--grid);stroke-width:1}.twoclock-ax,.twoclock-diag{stroke:var(--axis);stroke-width:1}
.twoclock-ell1,.twoclock-ell2{fill:none;stroke:var(--fg)}.twoclock-ell1{stroke-width:1.5;stroke-opacity:.6}.twoclock-ell2{stroke-width:1;stroke-opacity:.35}
.twoclock-pd{fill:var(--accent)}.twoclock-ps{fill:var(--accent-2)}.twoclock-p0{fill:var(--muted)}
.twoclock-spd,.twoclock-sps,.twoclock-spc{fill:none;stroke-width:1}
.twoclock-spd{stroke:var(--accent)}.twoclock-sps{stroke:var(--accent-2)}.twoclock-spc{stroke:var(--fg)}
.twoclock-hl{fill:none;stroke:var(--fg);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.twoclock-hl1{stroke-dasharray:7 4}.twoclock-hl2{stroke-dasharray:.5 4.5}
.twoclock-mk{fill:var(--fg);stroke:var(--surface);stroke-width:2}
.twoclock-mk.twoclock-hol{fill:var(--surface);stroke:var(--fg);stroke-width:1.5}
.twoclock-ring{fill:none;stroke:var(--fg);stroke-width:1.5}
.twoclock-cross,.twoclock-lm{stroke:var(--axis);stroke-width:1}
.twoclock-vt{stroke:var(--fg);stroke-width:1.5}
.twoclock-band{fill:var(--surface-2)}
.twoclock-curve{fill:none;stroke:var(--fg);stroke-width:1.5}
.twoclock-tip{position:absolute;pointer-events:none;background:var(--surface);color:var(--fg);border:1px solid var(--rule);border-radius:6px;padding:5px 8px;font-size:12px;line-height:1.35;white-space:nowrap;z-index:2}
.twoclock-tip b{display:block}
.twoclock-hlist{font-size:12px;margin:6px 0 0;display:flex;flex-wrap:wrap;gap:4px 18px}
.twoclock-hlist svg{vertical-align:middle;margin-right:4px}
.twoclock-row{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin-top:6px}
.twoclock-stat{font-size:12px;color:var(--muted);margin:0}
.twoclock-mult{display:grid;gap:12px 18px;grid-template-columns:repeat(2,minmax(0,1fr))}
.twoclock-wide .twoclock-mult{grid-template-columns:repeat(4,minmax(0,1fr))}
.twoclock-panel{display:flex;flex-direction:column;min-width:0}.twoclock-panel svg{margin-top:auto}
.twoclock-ptitle{font:600 13px var(--font-ui)}.twoclock-psub{font-size:12px;color:var(--muted);margin-bottom:2px}
.twoclock-readout{font-size:12px;color:var(--muted);min-height:1.5em;margin:6px 0 0}
.twoclock-presets{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 10px;font-size:13px}
.twoclock-lwrap{display:grid;gap:16px}
.twoclock-wide .twoclock-lwrap{grid-template-columns:minmax(0,3fr) minmax(0,2fr);align-items:start}
.twoclock-lrow{display:grid;grid-template-columns:minmax(150px,1.3fr) minmax(90px,1fr) minmax(90px,1fr) minmax(70px,.8fr);gap:4px 14px;align-items:center;padding:5px 8px;border-radius:6px}
.twoclock-narrow .twoclock-lrow{grid-template-columns:repeat(2,minmax(0,1fr))}
.twoclock-narrow .twoclock-lname,.twoclock-narrow .twoclock-mini{grid-column:1/-1}
.twoclock-lhead{font-size:12px;color:var(--muted);padding-top:0;padding-bottom:0}
.twoclock-narrow .twoclock-lhead{display:none}
.twoclock-sel{background:var(--tint)}
.twoclock-lname button{background:none;border:0;padding:0;font:600 13px var(--font-ui);color:var(--fg);text-align:left;cursor:pointer}
.twoclock-exp{display:block;font-size:12px;color:var(--muted)}
.twoclock-seg,.twoclock-mini{display:flex;gap:2px}
.twoclock-seg{height:28px;margin:8px 0 6px}.twoclock-mini{height:8px}
.twoclock-seg>span,.twoclock-mini>span{border-radius:4px;min-width:0}
.twoclock-seg>span{display:flex;align-items:center;padding:0 6px;font-size:12px;font-weight:600;white-space:nowrap}
.twoclock-fd{background:var(--accent);color:var(--surface)}.twoclock-fs{background:var(--accent-2);color:var(--surface)}
.twoclock-f1{background:var(--muted);color:var(--surface)}.twoclock-fn{background:var(--rule);color:var(--fg)}
.twoclock-sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 5px 0 0;vertical-align:-1px}
.twoclock-vtitle{font:600 13px var(--font-ui)}
.twoclock-formula{font-size:13px;margin:0 0 6px}
.twoclock-sentence{font:14px/1.5 var(--font-body);margin:8px 0 0}
.twoclock-mcrow{display:grid;grid-template-columns:130px minmax(0,1fr) 44px;gap:10px;align-items:center;font-size:12px;margin:4px 0}
.twoclock-track{height:10px;background:var(--surface-2);border-radius:5px}
.twoclock-fill{height:100%;background:var(--fg);opacity:.75;border-radius:5px}
.twoclock-mcval{font-variant-numeric:tabular-nums;font-weight:600;text-align:right}
.twoclock-stale{opacity:.5}
.twoclock-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}`;
  function injectStyle() {
    if (document.getElementById('style-' + P)) return;
    h('style', { id: 'style-' + P }, document.head, CSS);
  }

  let instances = 0;
  function mount(el, ctx) {
    injectStyle();
    const uid = ++instances;
    const S = { rho: 0.7, sD: 1, sS: 1, noise: 1, N: 200, seed: 1, one: false, c: 0, test: 3, w: PRESETS[0][1].map(r => r.slice()),
      hl: [-1, -1, -1], age: [1, 2, 3], tick: 3, cursor: -1, hover: -1, crossT: null };
    const dD = new Float64Array(NMAX), dS = new Float64Array(NMAX);
    let Z = null, raf = 0, anim = 0, mcTimer = 0, width = 0, roRaf = 0;
    const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    const root = h('div', { class: cls('root') }, el);
    const live = h('div', { class: cls('sr'), 'aria-live': 'polite' }, root);
    const say = t => { live.textContent = t; };
    const intro = h('p', { class: cls('intro') }, root, 'Each simulated person carries two hidden clocks: a dopaminergic stage D, read mainly from DaTScan, and a structural stage S, read from MRI. Both tick at one year per year from a personal offset, and each cognitive test mixes the two through its loadings. The worked question is whether letting the offsets differ (two clocks) predicts held-out participants’ later measurements better than forcing them to be equal (one clock); the panels show when that difference is large enough to matter. ');
    if (ctx && typeof ctx.openSection === 'function') {
      h('button', { type: 'button', class: cls('link') }, intro, 'Read the model in guide section 10.4')
        .addEventListener('click', () => ctx.openSection('104-disease-progression-models'));
    }
    const grid = h('div', { class: cls('grid') }, root);
    function card(area, title, how) {
      const c = h('section', { class: cls('card ' + area), 'aria-labelledby': `${P}-h-${area}-${uid}` }, grid);
      h('h3', { id: `${P}-h-${area}-${uid}` }, c, title);
      if (how) { const p = h('p', { class: cls('how'), id: `${P}-how-${area}-${uid}` }, c); h('b', {}, p, 'How to read this: '); p.appendChild(document.createTextNode(how)); }
      return c;
    }
    const synth = c => h('p', { class: cls('syn') }, c, 'Simulated data for illustration, not PPMI data');

    /* ---------- Controls ---------- */
    const ctl = card('ctl', 'Settings');
    const rows = h('div', { class: cls('crows') }, ctl);
    function slider(key, id, label, min, max, step, fmt, kind, mc) {
      const row = h('div', { class: cls('crow') }, rows), lab = h('label', { for: `${P}-${id}` }, row, label + ' ');
      const out = h('output', { class: cls('out') }, lab, fmt(S[key]));
      const inp = h('input', { type: 'range', id: `${P}-${id}`, min, max, step, value: S[key], class: kind ? cls(kind) : '' }, row);
      inp.addEventListener('input', () => {
        S[key] = +inp.value; out.textContent = fmt(S[key]);
        if (key === 'N') { S.hl = S.hl.map(i => (i < S.N ? i : -1)); if (S.cursor >= S.N) S.cursor = -1; }
        requestRender(); if (mc) scheduleMC();
      });
    }
    slider('rho', 'rho', 'Correlation of the offsets, ρ', -0.2, 1, 0.05, v => num(v, 2), '', true);
    slider('sD', 'sd', 'SD of D offsets, σD (years)', 0.1, 2.5, 0.1, v => num(v, 1), 'rd', true);
    slider('sS', 'ss', 'SD of S offsets, σS (years)', 0.1, 2.5, 0.1, v => num(v, 1), 'rs', true);
    slider('noise', 'noise', 'Measurement noise', 0.25, 3, 0.05, v => num(v, 2) + '×', '', true);
    slider('N', 'n', 'People, N', 50, 400, 10, v => String(v), '', true);
    const oneRow = h('div', { class: cls('crow check') }, rows);
    const oneBox = h('input', { type: 'checkbox', id: `${P}-one` }, oneRow);
    h('label', { for: `${P}-one` }, oneRow, 'One-stage model: one clock (each person’s offsets forced equal)');
    oneBox.addEventListener('change', () => { S.one = oneBox.checked; collapseTo(S.one ? 1 : 0); scheduleMC(); });
    const tRow = h('div', { class: cls('crow') }, rows);
    h('label', { for: `${P}-test` }, tRow, 'Cognitive test shown');
    const sel = h('select', { id: `${P}-test` }, tRow);
    TESTS.forEach((t, k) => { h('option', { value: k }, sel, t.name).selected = k === S.test; });
    sel.addEventListener('change', () => { S.test = +sel.value; requestRender(); });
    const nRow = h('div', { class: cls('crow') }, rows);
    const newBtn = h('button', { type: 'button', id: `${P}-new`, class: cls('btn') }, nRow, 'New sample');
    const seedOut = h('span', { class: cls('seed') }, nRow, 'Sample 1');
    newBtn.addEventListener('click', () => { S.seed++; seedOut.textContent = 'Sample ' + S.seed; newDraws(); requestRender(); scheduleMC(); });
    h('p', { class: cls('note') }, ctl, 'Noise ×1 means a per-scan SD of 0.12 SBR in each striatal region, 0.6 grey-matter units, and 0.5 z per test session. Curves, units and noise levels are illustrative.');

    /* ---------- 1. Latent plane ---------- */
    const plane = card('plane', '1. The two offsets, person by person', 'each dot is one person, placed by how many years ahead (+) or behind (−) the average they sit on the D clock (across) and the S clock (up). On the diagonal the clocks agree; blue dots are further along on D, orange on S.');
    const pLeg = h('div', { class: cls('legend') }, plane);
    legendItem(pLeg, sv => s('circle', { cx: 11, cy: 7, r: 4, class: cls('pd') }, sv), 'D clock ahead');
    legendItem(pLeg, sv => s('circle', { cx: 11, cy: 7, r: 4, class: cls('ps') }, sv), 'S clock ahead');
    legendItem(pLeg, sv => { s('line', { x1: 1, x2: 21, y1: 4, y2: 4, class: cls('ell1') }, sv); s('line', { x1: 1, x2: 21, y1: 10, y2: 10, class: cls('ell2') }, sv); }, '1 and 2 SD ellipses of Ω (about 39% and 86% of people)');
    legendItem(pLeg, sv => s('line', { x1: 1, x2: 21, y1: 13, y2: 1, class: cls('diag') }, sv), 'diagonal: one clock');
    const pWrap = h('div', { class: cls('wrap') }, plane);
    const pSvg = s('svg', { tabindex: 0, role: 'application', 'aria-roledescription': 'scatter plot', 'aria-describedby': `${P}-how-plane-${uid}`,
      'aria-label': 'Offsets of the simulated people. Arrow keys step through people from most S-ahead to most D-ahead; Enter follows or unfollows the current person.' }, pWrap);
    const pTip = h('div', { class: cls('tip'), hidden: '' }, pWrap);
    h('p', { class: cls('note') }, plane, 'Click a dot, or focus the plot and use the arrow keys and Enter, to follow up to three people (A, B, C) in the other panels.');
    const pList = h('div', { class: cls('hlist'), 'aria-label': 'Followed people' }, plane);
    const pRow = h('div', { class: cls('row') }, plane);
    const pStat = h('p', { class: cls('stat') }, pRow);
    h('button', { type: 'button', class: cls('btn') }, pRow, 'Clear followed people').addEventListener('click', () => { S.hl = [-1, -1, -1]; say('No one followed.'); requestRender(); });
    synth(plane);
    const PL = {};
    function layoutPlane() {
      const side = Math.max(200, Math.min(pWrap.clientWidth - 52, 440)), m = { l: 44, r: 8, t: 6, b: 38 };
      PL.w = side + m.l + m.r; PL.h = side + m.t + m.b; PL.x = lin(-DOM, DOM, m.l, m.l + side); PL.y = lin(-DOM, DOM, m.t + side, m.t);
      clear(pSvg); pSvg.setAttribute('width', PL.w); pSvg.setAttribute('height', PL.h); pSvg.setAttribute('viewBox', `0 0 ${PL.w} ${PL.h}`);
      const t = [-6, -4, -2, 0, 2, 4, 6];
      frame(s('g', {}, pSvg), PL.x, PL.y, { w: PL.w, h: PL.h, m, xt: t, yt: t, vgrid: true, xf: v => num(v, 0), yf: v => num(v, 0), xl: 'D offset (years)', yl: 'S offset (years)' });
      s('line', { x1: PL.x(-DOM), y1: PL.y(-DOM), x2: PL.x(DOM), y2: PL.y(DOM), class: cls('diag') }, pSvg);
      s('text', { x: PL.x(4.6), y: PL.y(-5.2), 'text-anchor': 'middle' }, pSvg, 'D ahead');
      s('text', { x: PL.x(-4.6), y: PL.y(5.2) + 4, 'text-anchor': 'middle' }, pSvg, 'S ahead');
      const cp = s('clipPath', { id: `${P}-pclip-${uid}` }, pSvg);
      s('rect', { x: m.l, y: m.t, width: side, height: side }, cp);
      const g = s('g', { 'clip-path': `url(#${P}-pclip-${uid})` }, pSvg);
      PL.e2 = s('path', { class: cls('ell2') }, g); PL.e1 = s('path', { class: cls('ell1') }, g);
      PL.pts = s('g', {}, g); PL.hl = s('g', {}, g); PL.ov = s('g', {}, pSvg);
    }
    const ellPath = (o, k) => ellipse(o.sD, o.sS, o.rho, k, 96).map((q, j) => (j ? 'L' : 'M') + PL.x(q[0]).toFixed(1) + ',' + PL.y(q[1]).toFixed(1)).join('') + 'Z';
    function renderPlane() {
      const o = omega(S.sD, S.sS, S.rho, S.c), pts = PL.pts;
      PL.e1.setAttribute('d', ellPath(o, 1)); PL.e2.setAttribute('d', ellPath(o, 2));
      while (pts.childNodes.length < S.N) s('circle', { r: 3.2 }, pts);
      for (let i = 0; i < pts.childNodes.length; i++) {
        const c = pts.childNodes[i];
        if (i >= S.N) { c.setAttribute('display', 'none'); continue; }
        const d = dD[i] - dS[i];
        c.removeAttribute('display'); c.setAttribute('cx', PL.x(dD[i]).toFixed(1)); c.setAttribute('cy', PL.y(dS[i]).toFixed(1));
        c.setAttribute('class', cls(d > 0.05 ? 'pd' : d < -0.05 ? 'ps' : 'p0'));
        c.setAttribute('fill-opacity', (0.3 + 0.6 * Math.min(1, Math.abs(d) / 1.5)).toFixed(2));
      }
      clear(PL.hl); clear(pList);
      S.hl.forEach((id, k) => {
        if (id < 0) return;
        const x = PL.x(dD[id]), y = PL.y(dS[id]);
        mark(PL.hl, k, x, y, 6).setAttribute('class', cls('mk'));
        s('text', { x: x + 9, y: y - 7, class: cls('lbl') }, PL.hl, 'ABC'[k]);
        const it = h('span', {}, pList), sv = s('svg', { width: 14, height: 14, 'aria-hidden': 'true' }, it);
        mark(sv, k, 7, 7.5, 4.5).setAttribute('class', cls('mk'));
        it.appendChild(document.createTextNode(`${'ABC'[k]}, person ${id + 1}: D ${sgn(dD[id], 2)}, S ${sgn(dS[id], 2)}, D − S ${sgn(dD[id] - dS[id], 2)} years`));
      });
      let sd = 0, ss = 0, cv = 0, md = 0, ms = 0;
      for (let i = 0; i < S.N; i++) { md += dD[i]; ms += dS[i]; }
      md /= S.N; ms /= S.N;
      for (let i = 0; i < S.N; i++) { const a = dD[i] - md, b = dS[i] - ms; sd += a * a; ss += b * b; cv += a * b; }
      const r = sd > 1e-12 && ss > 1e-12 ? cv / Math.sqrt(sd * ss) : 1;
      pStat.textContent = S.one ? `One-stage model: each person keeps one offset, the mean of their two; its SD in this sample of ${S.N} is ${num(Math.sqrt(sd / (S.N - 1)), 2)} years.`
        : `This sample of ${S.N}: SD of D ${num(Math.sqrt(sd / (S.N - 1)), 2)}, SD of S ${num(Math.sqrt(ss / (S.N - 1)), 2)} years, correlation r = ${num(r, 2)} (settings: ${num(S.sD, 1)}, ${num(S.sS, 1)}, ${num(S.rho, 2)}).`;
      PL.order = Array.from({ length: S.N }, (_, i) => i).sort((a, b) => (dD[a] - dS[a]) - (dD[b] - dS[b]) || dD[a] - dD[b]);
      renderPlaneOverlay();
    }
    function renderPlaneOverlay() {
      clear(PL.ov);
      const id = S.hover >= 0 ? S.hover : document.activeElement === pSvg ? S.cursor : -1;
      if (id < 0 || id >= S.N) { pTip.hidden = true; return; }
      const x = PL.x(dD[id]), y = PL.y(dS[id]), k = S.hl.indexOf(id);
      s('circle', { cx: x, cy: y, r: 10, class: cls('ring') }, PL.ov);
      clear(pTip); h('b', {}, pTip, `Person ${id + 1}${k >= 0 ? ' (' + 'ABC'[k] + ')' : ''}`);
      pTip.appendChild(document.createTextNode(`D ${sgn(dD[id], 2)} y · S ${sgn(dS[id], 2)} y · D − S ${sgn(dD[id] - dS[id], 2)} y`));
      pTip.hidden = false;
      const tw = pTip.offsetWidth, wrapW = pWrap.clientWidth;
      pTip.style.left = (x + 14 + tw > wrapW ? Math.max(0, x - 14 - tw) : x + 14) + 'px';
      pTip.style.top = Math.max(0, y - 44) + 'px';
    }
    function describe(id) {
      const d = dD[id] - dS[id], k = S.hl.indexOf(id);
      return `Person ${id + 1}: D offset ${sgn(dD[id], 2)} years, S offset ${sgn(dS[id], 2)} years, ` +
        (Math.abs(d) < 0.005 ? 'clocks in step. ' : `${d > 0 ? 'D' : 'S'} clock ${num(Math.abs(d), 2)} years ahead. `) + (k >= 0 ? `Followed as ${'ABC'[k]}.` : 'Not followed.');
    }
    function toggle(id) {
      const k = S.hl.indexOf(id);
      if (k >= 0) { S.hl[k] = -1; say(`Stopped following person ${id + 1}.`); }
      else {
        let j = S.hl.indexOf(-1);
        if (j < 0) j = S.age.indexOf(Math.min.apply(null, S.age));
        S.hl[j] = id; S.age[j] = ++S.tick; say(`Following person ${id + 1} as ${'ABC'[j]}.`);
      }
      requestRender();
    }
    function nearest(e) {
      const r = pSvg.getBoundingClientRect(), k = PL.w / (r.width || PL.w), px = (e.clientX - r.left) * k, py = (e.clientY - r.top) * k;
      let best = -1, bd = 16 * 16;
      for (let i = 0; i < S.N; i++) { const dx = PL.x(dD[i]) - px, dy = PL.y(dS[i]) - py, q = dx * dx + dy * dy; if (q < bd) { bd = q; best = i; } }
      return best;
    }
    pSvg.addEventListener('pointermove', e => { const id = nearest(e); pSvg.style.cursor = id >= 0 ? 'pointer' : 'default'; if (id !== S.hover) { S.hover = id; renderPlaneOverlay(); } });
    pSvg.addEventListener('pointerleave', () => { S.hover = -1; renderPlaneOverlay(); });
    pSvg.addEventListener('click', e => { const id = nearest(e); if (id >= 0) { S.cursor = id; toggle(id); } });
    pSvg.addEventListener('focus', () => {
      if (S.cursor < 0 || S.cursor >= S.N) S.cursor = PL.order[PL.order.length >> 1];
      renderPlaneOverlay(); say(describe(S.cursor));
    });
    pSvg.addEventListener('blur', () => renderPlaneOverlay());
    pSvg.addEventListener('keydown', e => {
      const ord = PL.order, step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
      let pos = ord.indexOf(S.cursor); if (pos < 0) pos = ord.length >> 1;
      if (e.key in step) pos = Math.max(0, Math.min(ord.length - 1, pos + step[e.key]));
      else if (e.key === 'Home') pos = 0;
      else if (e.key === 'End') pos = ord.length - 1;
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (S.cursor >= 0) toggle(S.cursor); return; }
      else return;
      e.preventDefault(); S.cursor = ord[pos]; S.hover = -1; renderPlaneOverlay(); say(describe(S.cursor));
    });

    /* ---------- 2. Trajectories ---------- */
    const traj = card('traj', '2. What the clocks do to each measurement', 'faint lines are each person’s noise-free path, the average curve slid sideways by their offset. For A, B and C, marks are simulated measurements at PPMI visit times: filled up to the 2.5-year landmark, hollow after it, where the project predicts them.');
    const tLeg = h('div', { class: cls('legend') }, traj);
    legendItem(tLeg, sv => { s('line', { x1: 1, x2: 21, y1: 4, y2: 4, class: cls('spd') }, sv); s('line', { x1: 1, x2: 21, y1: 10, y2: 10, class: cls('sps') }, sv); }, 'each person (D panels blue, S panel orange)');
    ['A', 'B', 'C'].forEach((L, k) => legendItem(tLeg, sv => abcKey(sv, k), L));
    legendItem(tLeg, sv => { mark(sv, 0, 6, 7, 4).setAttribute('class', cls('mk')); mark(sv, 0, 16, 7, 4).setAttribute('class', cls('mk hol')); }, 'measured before / after the landmark');
    legendItem(tLeg, sv => s('line', { x1: 11, x2: 11, y1: 0, y2: 14, class: cls('lm') }, sv), '2.5-year landmark');
    legendItem(tLeg, sv => s('line', { x1: 11, x2: 11, y1: 6, y2: 13, class: cls('vt') }, sv), 'scheduled visits');
    const mult = h('div', { class: cls('mult') }, traj);
    const PANELS = [
      { key: 'put', title: 'Putamen SBR, mean of left and right', sub: 'DaTScan at screening, 12, 24, 48 months', y: [0, 3], ticks: [0, 1, 2, 3], sp: 'spd', times: SCHED.dat, f: v => num(v, 0), r: v => num(v, 2) },
      { key: 'cau', title: 'Caudate SBR, mean of left and right', sub: 'DaTScan at screening, 12, 24, 48 months', y: [0, 3], ticks: [0, 1, 2, 3], sp: 'spd', times: SCHED.dat, f: v => num(v, 0), r: v => num(v, 2) },
      { key: 'gm', title: 'Grey-matter measure', sub: 'Processed MRI at baseline, 24, 48 months; 100 = average at baseline', y: [82, 106], ticks: [85, 90, 95, 100, 105], sp: 'sps', times: SCHED.mri, f: v => num(v, 0), r: v => num(v, 1) },
      { key: 'cog', title: '', sub: 'Cognitive battery yearly; z units', y: [-4.5, 2.5], ticks: [-4, -2, 0, 2], sp: 'spc', times: SCHED.cog, f: v => num(v, 0), r: v => num(v, 2) }
    ];
    const PAN = PANELS.map(cfg => {
      const box = h('div', { class: cls('panel') }, mult), t = h('div', { class: cls('ptitle') }, box, cfg.title);
      h('div', { class: cls('psub') }, box, cfg.sub);
      const svg = s('svg', { role: 'img' }, box);
      svg.addEventListener('pointermove', e => {
        const pn = PAN.find(q => q.svg === svg), r = svg.getBoundingClientRect(), k = pn.W / (r.width || pn.W);
        const tt = Math.round(Math.max(0, Math.min(T1, pn.x.inv((e.clientX - r.left) * k))) * 10) / 10;
        if (tt !== S.crossT) { S.crossT = tt; renderCross(); }
      });
      svg.addEventListener('pointerleave', () => { S.crossT = null; renderCross(); });
      return { cfg, box, t, svg };
    });
    const readout = h('p', { class: cls('readout'), 'aria-live': 'off' }, traj);
    synth(traj);
    function val(key, i, t) {
      if (key === 'put') return sbr(PUT, t + dD[i])[0];
      if (key === 'cau') return sbr(CAU, t + dD[i])[0];
      if (key === 'gm') return gm(t + dS[i])[0];
      return cog(S.w[S.test], t + dD[i], t + dS[i]);
    }
    function obs(key, i, j) { // simulated measurement at scheduled visit j (stored standard normals x noise SD)
      const e = Z.e, b = i * NE, n = S.noise;
      if (key === 'put') return val(key, i, SCHED.dat[j]) + SD.sbr * n * (e[b + 4 * j] + e[b + 4 * j + 1]) / 2;
      if (key === 'cau') return val(key, i, SCHED.dat[j]) + SD.sbr * n * (e[b + 4 * j + 2] + e[b + 4 * j + 3]) / 2;
      if (key === 'gm') return val(key, i, SCHED.mri[j]) + SD.gm * n * e[b + 16 + j];
      return val(key, i, SCHED.cog[j]) + SD.cog * n * e[b + 19 + 6 * S.test + j];
    }
    function layoutTraj() {
      PAN.forEach((pn, k) => {
        const W = Math.max(200, pn.box.clientWidth), H = 196, m = { l: 36, r: 20, t: 8, b: 34 };
        Object.assign(pn, { W, H, m, x: lin(T0, T1, m.l, W - m.r), y: lin(pn.cfg.y[0], pn.cfg.y[1], H - m.b, m.t) });
        const sv = pn.svg; clear(sv);
        sv.setAttribute('width', W); sv.setAttribute('height', H); sv.setAttribute('viewBox', `0 0 ${W} ${H}`);
        const ax = s('g', {}, sv);
        frame(ax, pn.x, pn.y, { w: W, h: H, m, xt: [0, 1, 2, 3, 4, 5], yt: pn.cfg.ticks, xf: String, yf: pn.cfg.f, xl: 'years since baseline' });
        s('line', { x1: pn.x(LANDMARK), x2: pn.x(LANDMARK), y1: m.t, y2: H - m.b, class: cls('lm') }, ax);
        pn.cfg.times.forEach(t => s('line', { x1: pn.x(t), x2: pn.x(t), y1: H - m.b - 7, y2: H - m.b, class: cls('vt') }, ax));
        const cp = s('clipPath', { id: `${P}-clip-${uid}-${k}` }, sv);
        s('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b }, cp);
        const cg = s('g', { 'clip-path': `url(#${P}-clip-${uid}-${k})` }, sv);
        pn.sp = s('g', { class: cls(pn.cfg.sp) }, cg); pn.hl = s('g', {}, cg); pn.lab = s('g', {}, sv); pn.ov = s('g', {}, sv);
      });
    }
    const TS = [T0]; for (let t = 0; t <= T1 + 1e-9; t += 0.5) TS.push(t);
    const TF = []; for (let t = T0; t <= T1 + 1e-9; t += 0.05) TF.push(t);
    const line = (pn, key, i, ts) => { let d = ''; for (let j = 0; j < ts.length; j++) d += (j ? 'L' : 'M') + pn.x(ts[j]).toFixed(1) + ',' + pn.y(val(key, i, ts[j])).toFixed(1); return d; };
    function renderTraj() {
      const alpha = Math.max(0.05, Math.min(0.3, 10 / S.N)).toFixed(3), test = TESTS[S.test];
      PAN[3].t.textContent = test.name;
      PAN.forEach(pn => {
        const key = pn.cfg.key, g = pn.sp, ts = key === 'cog' ? [T0, T1] : TS;
        g.setAttribute('stroke-opacity', alpha);
        while (g.childNodes.length < S.N) s('path', {}, g);
        for (let i = 0; i < g.childNodes.length; i++) {
          const p = g.childNodes[i];
          if (i >= S.N) p.setAttribute('display', 'none'); else { p.removeAttribute('display'); p.setAttribute('d', line(pn, key, i, ts)); }
        }
        clear(pn.hl); clear(pn.lab);
        const labs = [];
        S.hl.forEach((id, k) => {
          if (id < 0) return;
          s('path', { d: line(pn, key, id, key === 'cog' ? [T0, T1] : TF), class: cls('hl' + (k ? ' hl' + k : '')) }, pn.hl);
          pn.cfg.times.forEach((t, j) => mark(pn.hl, k, pn.x(t), pn.y(obs(key, id, j)), 4).setAttribute('class', cls(t <= LANDMARK ? 'mk' : 'mk hol')));
          const ye = pn.y(val(key, id, T1));
          if (ye >= pn.m.t && ye <= pn.H - pn.m.b) labs.push([ye, k]);
        });
        labs.sort((a, b) => a[0] - b[0]); // end labels: keep 11 px apart where the paths converge (the putamen floor)
        for (let j = 1; j < labs.length; j++) labs[j][0] = Math.max(labs[j][0], labs[j - 1][0] + 11);
        const over = labs.length ? labs[labs.length - 1][0] - (pn.H - pn.m.b - 4) : 0;
        labs.forEach(([yy, k]) => s('text', { x: pn.W - pn.m.r + 4, y: yy - Math.max(0, over) + 4, class: cls('lbl') }, pn.lab, 'ABC'[k]));
        pn.svg.setAttribute('aria-label', `${key === 'cog' ? test.name : pn.cfg.title} over 0 to 5.5 years for ${S.N} simulated people` +
          (S.hl.some(i => i >= 0) ? ', with the followed people’s simulated measurements' : '') + '.');
      });
      renderCross();
    }
    function renderCross() {
      const t = S.crossT, who = S.hl.map((id, k) => [id, k]).filter(q => q[0] >= 0);
      PAN.forEach(pn => {
        clear(pn.ov);
        if (t == null) return;
        s('line', { x1: pn.x(t), x2: pn.x(t), y1: pn.m.t, y2: pn.H - pn.m.b, class: cls('cross') }, pn.ov);
        who.forEach(([id, k]) => { const y = pn.y(val(pn.cfg.key, id, t)); if (y >= pn.m.t && y <= pn.H - pn.m.b) mark(pn.ov, k, pn.x(t), y, 3.5).setAttribute('class', cls('mk')); });
      });
      if (t == null) { readout.textContent = who.length ? 'Point at a chart to read the followed people’s true (noise-free) values at that year.' : 'Follow someone in panel 1 to compare their paths here.'; return; }
      readout.textContent = `Year ${t.toFixed(1)}. ` + (who.length ? who.map(([id, k]) => `${'ABC'[k]}: putamen ${PAN[0].cfg.r(val('put', id, t))}, caudate ${PAN[1].cfg.r(val('cau', id, t))}, grey matter ${PAN[2].cfg.r(val('gm', id, t))}, ${TESTS[S.test].short} ${PAN[3].cfg.r(val('cog', id, t))}`).join('. ') + '.' : 'No one followed.');
    }

    /* ---------- 3. Loadings ---------- */
    const load = card('load', '3. How each cognitive test mixes the two clocks', 'a test loses 0.4 z per year of a clock times its link strength (illustrative). Each bar splits the test’s spread across people at year 3 into D, S and measurement noise; “expected” is the dual syndrome hypothesis (guide 3.5).');
    const pres = h('div', { class: cls('presets'), role: 'group', 'aria-label': 'Loading presets' }, load);
    h('span', {}, pres, 'Presets:');
    const presetBtns = PRESETS.map(([label, w]) => {
      const b = h('button', { type: 'button', class: cls('btn'), 'aria-pressed': 'false' }, pres, label);
      b.addEventListener('click', () => { S.w = w.map(r => r.slice()); syncLoadings(); requestRender(); });
      return b;
    });
    const lwrap = h('div', { class: cls('lwrap') }, load), ltab = h('div', { class: cls('ltable') }, lwrap);
    const head = h('div', { class: cls('lrow lhead'), 'aria-hidden': 'true' }, ltab);
    ['Test (click to show it in panel 2)', 'Link to D', 'Link to S', 'Spread at year 3'].forEach(t => h('span', {}, head, t));
    const LR = TESTS.map((t, k) => {
      const row = h('div', { class: cls('lrow') }, ltab), name = h('div', { class: cls('lname') }, row);
      const nb = h('button', { type: 'button', 'aria-pressed': 'false' }, name, t.name);
      nb.addEventListener('click', () => { S.test = k; sel.value = k; requestRender(); });
      h('span', { class: cls('exp') }, name, 'Expected: ' + (t.expect === 'both' ? 'both' : t.expect === 'D' ? 'D (dopaminergic)' : 'S (structural, posterior)'));
      const outs = [], inps = [];
      [0, 1].forEach(j => {
        const id = `${P}-w${'ds'[j]}-${k}`, box = h('div', {}, row), lab = h('label', { for: id }, box);
        h('span', { class: cls('sr') }, lab, t.name + ', link ');
        lab.appendChild(document.createTextNode(j ? 'to S ' : 'to D '));
        outs.push(h('output', { class: cls('out') }, lab));
        const inp = h('input', { type: 'range', id, min: 0, max: 1, step: 0.05, value: S.w[k][j], class: cls(j ? 'rs' : 'rd') }, box);
        inp.addEventListener('input', () => { S.w[k][j] = +inp.value; outs[j].textContent = num(S.w[k][j], 2); requestRender(); });
        inps.push(inp);
      });
      const mini = h('div', { class: cls('mini'), 'aria-hidden': 'true' }, row);
      return { row, nb, outs, inps, mini };
    });
    function syncLoadings() { LR.forEach((r, k) => [0, 1].forEach(j => { r.inps[j].value = S.w[k][j]; r.outs[j].textContent = num(S.w[k][j], 2); })); }
    const vd = h('div', { class: cls('vdetail') }, lwrap);
    const vTitle = h('div', { class: cls('vtitle') }, vd), vBar = h('div', { class: cls('seg'), role: 'img' }, vd);
    const vLeg = h('div', { class: cls('legend') }, vd), vText = h('p', { class: cls('note') }, vd), vForm = h('p', { class: cls('note') }, vd);
    synth(load);
    function renderLoad() {
      const o = omega(S.sD, S.sS, S.rho, S.c), one = S.one && S.c > 0.999;
      LR.forEach((r, k) => {
        setBar(r.mini, split(S.w[k], o, S.noise), one, false);
        r.row.classList.toggle(P + '-sel', k === S.test); r.nb.setAttribute('aria-pressed', String(k === S.test));
        r.outs.forEach((out, j) => { out.textContent = num(S.w[k][j], 2); });
      });
      PRESETS.forEach(([, w], j) => presetBtns[j].setAttribute('aria-pressed', String(w.every((r, k) => Math.abs(r[0] - S.w[k][0]) < 1e-9 && Math.abs(r[1] - S.w[k][1]) < 1e-9))));
      const sp = split(S.w[S.test], o, S.noise), f = setBar(vBar, sp, one, true), t = TESTS[S.test];
      vTitle.textContent = `${t.name}: where its spread across people comes from (year 3)`;
      clear(vLeg);
      (one ? [['f1', 'one clock (D = S)'], ['fn', 'measurement noise']] : [['fd', 'D, dopaminergic'], ['fs', 'S, structural'], ['fn', 'measurement noise']])
        .forEach(([c, label], j) => { const it = h('span', {}, vLeg); h('span', { class: cls('sw ' + c) }, it); it.appendChild(document.createTextNode(`${label} ${pct(f[j])}`)); });
      vBar.setAttribute('aria-label', `${t.name} at year 3: ` + (one ? `one clock ${pct(f[0])}, noise ${pct(f[1])}` : `D ${pct(f[0])}, S ${pct(f[1])}, noise ${pct(f[2])}`));
      const dz = Math.max(0, sp.D), sz = Math.max(0, sp.S);
      vText.textContent = one ? `One clock: D and S are the same, so the disease-related part (${pct(f[0])}) cannot be split between them.`
        : dz + sz > 1e-12 ? `Of the disease-related part, ${pct(dz / (dz + sz))} comes from D and ${pct(sz / (dz + sz))} from S.` : 'With both links at 0 this test carries no information about either clock.';
      vForm.textContent = one ? 'Var = (λD + λS)²σ² + σε², where σ is the SD of the single offset (each person’s mean of their two). It is the same at every year, because the clock runs at one year per year and the test is linear in it.'
        : `Var = λD²σD² + λS²σS² + 2ρλDλSσDσS + σε². D and S each get their own term plus half of the covariance term (${pct(Math.abs(sp.cov) / sp.total)} of the total${sp.cov < 0 ? ', negative here' : ''}). The split is the same at every year, because both clocks run at one year per year and the tests are linear in D and S.`;
    }

    /* ---------- 4. Discordance ---------- */
    const disc = card('disc', '4. Why one clock and two are hard to tell apart', 'bars count people by D offset minus S offset, the curve is the distribution the settings imply, and the shaded band (±2 SE) is the disagreement that measurement noise alone can fake for one person.');
    const dForm = h('p', { class: cls('formula') }, disc), dWrap = h('div', { class: cls('wrap') }, disc), dSvg = s('svg', { role: 'img' }, dWrap);
    const dSent = h('p', { class: cls('sentence') }, disc), dDetail = h('p', { class: cls('note') }, disc);
    h('p', { class: cls('note') }, disc, 'SE: the standard error of one person’s estimated D − S from data up to the 2.5-year landmark (DaTScans at screening, 12 and 24 months; MRIs at baseline and 24 months; tests at years 0, 1, 2), for a person at the average offsets, with curves and loadings known. Reliability = SD² / (SD² + SE²), the share of the true disagreement a person’s estimate recovers.');
    const mcBox = h('div', {}, disc);
    h('h4', {}, mcBox, 'Can a simple test tell? (illustrative Monte Carlo)');
    const mcHead = h('p', { class: cls('note') }, mcBox);
    const mcRows = [2, 3, 4].map(k => {
      const row = h('div', { class: cls('mcrow') }, mcBox);
      h('span', {}, row, `${k} scans of each kind`);
      const track = h('div', { class: cls('track'), 'aria-hidden': 'true' }, row);
      return { fill: h('div', { class: cls('fill') }, track), val: h('span', { class: cls('mcval') }, row) };
    });
    h('p', { class: cls('note') }, mcBox, 'The test: fit each person’s D offset to their DaTScans and S offset to their MRIs (true curves and noise known), and pick two clocks when the sum over people of (D offset − S offset)² / SE² exceeds the 95th percentile of a chi-square with N degrees of freedom.');
    h('p', { class: cls('note') }, mcBox, 'Scans spread evenly over years 0 to 4 (illustrative schedule); tests not used; 30 cohorts per bar, so expect up to about ±9 points of Monte Carlo error. Knowing the curves makes this an optimistic upper bound; the project’s real comparison is held-out log-likelihood (guide 10.5).');
    synth(disc);
    const DH = {};
    function layoutDisc() {
      DH.W = Math.max(240, dWrap.clientWidth); DH.H = 200; DH.m = { l: 36, r: 10, t: 14, b: 36 };
      dSvg.setAttribute('width', DH.W); dSvg.setAttribute('height', DH.H); dSvg.setAttribute('viewBox', `0 0 ${DH.W} ${DH.H}`);
    }
    function renderDisc() {
      clear(dSvg);
      const o = omega(S.sD, S.sS, S.rho, S.c), sdd = discSD(o.sD, o.sS, o.rho), se = discSE(S.w, S.noise, LMK);
      const dom = discSD(S.sD, S.sS, S.rho) * 3.5 <= 3 && 2 * se <= 3 ? 3 : 6; // range +-3 or +-6 years, by the two-clock spread
      const { W, H, m } = DH, x = lin(-dom, dom, m.l, W - m.r), bw = 0.25, half = dom / bw, counts = new Array(2 * half + 1).fill(0);
      let outside = 0, sum = 0, sum2 = 0;
      for (let i = 0; i < S.N; i++) {
        const d = dD[i] - dS[i], b = Math.round(d / bw) + half; sum += d; sum2 += d * d;
        if (b < 0 || b > 2 * half) outside++; else counts[b]++;
      }
      const sampleSD = Math.sqrt(Math.max(0, (sum2 - sum * sum / S.N) / (S.N - 1)));
      const peak = sdd > bw / 2 ? S.N * bw / (sdd * Math.sqrt(2 * Math.PI)) : 0, top = Math.max(5, Math.max.apply(null, counts), peak);
      const stepY = [1, 2, 5, 10, 20, 25, 50, 100, 200].find(v => top / v <= 4) || 400, ymax = Math.ceil(top / stepY) * stepY, y = lin(0, ymax, H - m.b, m.t);
      const yt = []; for (let v = 0; v <= ymax + 1e-9; v += stepY) yt.push(v);
      if (!S.one && sdd > 0) {
        const xa = x(Math.max(-dom, -2 * se)), xb = x(Math.min(dom, 2 * se));
        s('rect', { x: xa, y: m.t, width: xb - xa, height: H - m.b - m.t, class: cls('band') }, dSvg);
        s('text', { x: (xa + xb) / 2, y: m.t - 3, 'text-anchor': 'middle' }, dSvg, '±2 SE');
      }
      const xt = dom === 3 ? [-3, -2, -1, 0, 1, 2, 3] : [-6, -4, -2, 0, 2, 4, 6];
      frame(s('g', {}, dSvg), x, y, { w: W, h: H, m, xt, yt, xf: v => sgn(v, 0), yf: v => String(v), xl: 'D offset − S offset (years); right of 0: D clock ahead' });
      counts.forEach((n, b) => {
        if (!n) return;
        const c = (b - half) * bw, x0 = x(c - bw / 2) + 1, x1 = x(c + bw / 2) - 1, y0 = y(n), yb = y(0), r = Math.min(2, (x1 - x0) / 2, yb - y0);
        s('path', { d: `M${x0},${yb}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x1 - r}Q${x1},${y0} ${x1},${y0 + r}V${yb}Z`, class: cls(c > 0.01 ? 'pd' : c < -0.01 ? 'ps' : 'p0'), 'fill-opacity': 0.8 }, dSvg);
      });
      if (peak > 0) {
        let d = '';
        for (let v = -dom; v <= dom + 1e-9; v += 0.05) d += (d ? 'L' : 'M') + x(v).toFixed(1) + ',' + y(peak * Math.exp(-v * v / (2 * sdd * sdd))).toFixed(1);
        s('path', { d, class: cls('curve') }, dSvg);
      }
      if (outside) s('text', { x: W - m.r, y: m.t + 10, 'text-anchor': 'end' }, dSvg, `${outside} beyond ±${dom}`);
      dSvg.setAttribute('aria-label', `Histogram of D minus S offsets for ${S.N} simulated people; SD ${num(sampleSD, 2)} years.`);
      dForm.textContent = S.one ? 'One-stage model: D − S = 0 for everyone.'
        : `SD of D − S = √(σD² + σS² − 2ρσDσS) = √(${num(S.sD, 1)}² + ${num(S.sS, 1)}² − 2 × ${num(S.rho, 2)} × ${num(S.sD, 1)} × ${num(S.sS, 1)}) = ${num(discSD(S.sD, S.sS, S.rho), 2)} years; this sample ${num(sampleSD, 2)}.`;
      const vt = verdict({ one: S.one, sdd: discSD(S.sD, S.sS, S.rho), se, rho: S.rho, sD: S.sD, sS: S.sS });
      dSent.textContent = vt.main; dDetail.textContent = vt.detail; dDetail.hidden = !vt.detail;
    }
    function scheduleMC() { clearTimeout(mcTimer); mcBox.classList.add(P + '-stale'); mcTimer = setTimeout(runMC, 220); }
    function runMC() {
      const p = { rho: S.rho, sD: S.sD, sS: S.sS, noise: S.noise, N: S.N, one: S.one }, R = 30, seed = (S.seed * 7919 + 17) >>> 0;
      const res = [2, 3, 4].map(k => mcPower(p, k, R, seed)), right = res.map(v => (S.one ? 1 - v : v));
      mcHead.textContent = S.one ? `Truth here: one clock. Share of ${R} simulated cohorts of ${S.N} people in which the test rightly keeps one clock:`
        : `Truth here: two clocks. Share of ${R} simulated cohorts of ${S.N} people in which the test detects the second clock:`;
      mcRows.forEach((r, j) => { r.fill.style.width = (100 * right[j]).toFixed(1) + '%'; r.val.textContent = Math.round(100 * right[j]) + '%'; });
      mcBox.classList.remove(P + '-stale');
    }

    /* ---------- State, layout, render loop ---------- */
    function newDraws() { // seed offset 5: the first sample is a typical one (its SDs and correlation within 3% of the settings)
      const g = gaussian(mulberry32(((S.seed + 5) * 2654435761) >>> 0)), z = new Float64Array(2 * NMAX), e = new Float64Array(NE * NMAX);
      for (let i = 0; i < z.length; i++) z[i] = g();
      for (let i = 0; i < e.length; i++) e[i] = g();
      Z = { z, e };
      const c = Math.sqrt(Math.max(0, 1 - S.rho * S.rho)), sdd = discSD(S.sD, S.sS, S.rho) || 1, used = [];
      const pick = f => { // default people among the first 50: D ahead, S ahead, in step
        let best = 0, bv = Infinity;
        for (let i = 0; i < 50; i++) {
          if (used.indexOf(i) >= 0) continue;
          const a = S.sD * z[2 * i], b = S.sS * (S.rho * z[2 * i] + c * z[2 * i + 1]), v = f(a - b, (a + b) / 2);
          if (v < bv) { bv = v; best = i; }
        }
        used.push(best); return best;
      };
      S.hl = [pick((d, mm) => Math.abs(d - 1.5 * sdd) + 0.5 * Math.abs(mm)), pick((d, mm) => Math.abs(d + 1.5 * sdd) + 0.5 * Math.abs(mm)), pick((d, mm) => Math.abs(d) + Math.abs(mm))];
      S.age = [1, 2, 3]; S.tick = 3; S.cursor = -1; S.hover = -1;
    }
    function computeOffsets() {
      const c = Math.sqrt(Math.max(0, 1 - S.rho * S.rho));
      for (let i = 0; i < S.N; i++) {
        const z1 = Z.z[2 * i], z2 = Z.z[2 * i + 1], a = S.sD * z1, b = S.sS * (S.rho * z1 + c * z2), mm = (a + b) / 2;
        dD[i] = a + S.c * (mm - a); dS[i] = b + S.c * (mm - b);
      }
    }
    function renderAll() { if (!width) return; computeOffsets(); renderPlane(); renderTraj(); renderLoad(); renderDisc(); }
    function requestRender() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderAll(); }); }
    function collapseTo(target) {
      cancelAnimationFrame(anim);
      if (reduced()) { S.c = target; requestRender(); return; }
      const from = S.c, t0 = performance.now();
      const stepFn = now => {
        const u = Math.min(1, (now - t0) / 450), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(2 - 2 * u, 2) / 2;
        S.c = from + (target - from) * e; renderAll();
        anim = u < 1 ? requestAnimationFrame(stepFn) : 0;
      };
      anim = requestAnimationFrame(stepFn);
    }
    function applyLayout() {
      const w = Math.round(root.clientWidth);
      if (!w || w === width) return;
      width = w;
      ['narrow', 'mid', 'wide'].forEach(n => root.classList.remove(P + '-' + n));
      root.classList.add(P + '-' + (w >= 1100 ? 'wide' : w >= 820 ? 'mid' : 'narrow'));
      layoutPlane(); layoutTraj(); layoutDisc(); renderAll();
    }
    newDraws();
    const ro = new ResizeObserver(() => { cancelAnimationFrame(roRaf); roRaf = requestAnimationFrame(applyLayout); });
    ro.observe(root);
    applyLayout(); syncLoadings(); runMC();
    return {
      destroy() {
        ro.disconnect(); cancelAnimationFrame(raf); cancelAnimationFrame(anim); cancelAnimationFrame(roRaf); clearTimeout(mcTimer);
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  X[P] = {
    title: 'Two clocks or one: progression simulator',
    blurb: 'Simulate a cohort whose dopaminergic and structural clocks can disagree, follow people’s scans and test scores, and see when two clocks can be told apart from one.',
    mount,
    _math: { mulberry32, gaussian, sbr, gm, cog, omega, discSD, ellipse, split, discSE, normCdf, chi2q95, mcPower, verdict, pct, num, sgn,
      constants: { PUT, CAU, GMC, SD, SLOPE, SCHED, LMK, TESTS, PRESETS, T0, T1, LANDMARK } }
  };
})();
