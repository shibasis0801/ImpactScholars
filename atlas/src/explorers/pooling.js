/* PPMI Atlas explorer: partial pooling in a linear mixed-effects model.
 * Everything here is simulated. No PPMI data is used or loaded.
 * Model (guide 10.2): y_ij = (b0 + b0_i) + (b1 + b1_i) t_ij + e_ij,
 *   (b0_i, b1_i) ~ N(0, G), e_ij ~ N(0, s2).
 * The mixed-model line for person i is the BLUP computed exactly from the TRUE variance
 * components: b_i = (Z'Z/s2 + G^-1)^-1 Z'(y - X beta)/s2, with beta estimated by GLS.
 */
(function () {
  'use strict';
  var NAME = 'pooling';
  var P = NAME + '-';
  var X = (window.PPMIExplorers = window.PPMIExplorers || {});

  /* ------------------------------------------------------------------ */
  /* Pure statistics (exported as _lib for node tests)                    */
  /* ------------------------------------------------------------------ */

  var BETA = [0, -0.15];   // illustrative population intercept (z) and slope (z per year)
  var MAX_N = 60, MAX_V = 6;

  function mulberry32(seed) {
    var a = seed | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeNormal(rng) {           // Box-Muller, caches the second draw
    var spare = 0, has = false;
    return function () {
      if (has) { has = false; return spare; }
      var u = rng(), v = rng();
      if (u < 1e-300) u = 1e-300;
      var r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v); has = true;
      return r * Math.cos(2 * Math.PI * v);
    };
  }

  /* Standard-normal draws for up to MAX_N people, fixed by the seed, so that moving a slider
   * rescales the same people instead of drawing new ones (common random numbers). */
  function drawBase(seed) {
    var nEff = makeNormal(mulberry32(seed * 3 + 1));
    var nNoise = makeNormal(mulberry32(seed * 3 + 2));
    var rSched = mulberry32(seed * 3 + 3);
    var out = [];
    for (var i = 0; i < MAX_N; i++) {
      var eps = [];
      for (var j = 0; j < MAX_V; j++) eps.push(nNoise());
      // PPMI-like schedule (illustrative): baseline plus 1 to 3 follow-ups in distinct years 1..5,
      // each within +-3 months, rounded to the month as PPMI dates are.
      var m = 2 + Math.floor(rSched() * 3);
      var years = [1, 2, 3, 4, 5];
      for (var k = years.length - 1; k > 0; k--) {
        var r = Math.floor(rSched() * (k + 1)), tmp = years[k];
        years[k] = years[r]; years[r] = tmp;
      }
      var fu = years.slice(0, m - 1).sort(function (a, b) { return a - b; });
      var ppmi = [0];
      for (k = 0; k < fu.length; k++) ppmi.push(Math.round((fu[k] + (rSched() - 0.5) * 0.5) * 12) / 12);
      out.push({ u0: nEff(), u1: nEff(), eps: eps, ppmi: ppmi });
    }
    return out;
  }

  function regularTimes(m) { var t = []; for (var j = 0; j < m; j++) t.push(j); return t; }

  function covG(tau0, tau1, rho) { var c = rho * tau0 * tau1; return [tau0 * tau0, c, c, tau1 * tau1]; }

  function simulate(base, p) {
    var c = Math.sqrt(1 - p.rho * p.rho), people = [];
    for (var i = 0; i < p.n; i++) {
      var B = base[i];
      var b0 = p.tau0 * B.u0, b1 = p.tau1 * (p.rho * B.u0 + c * B.u1);   // b = chol(G) u
      var t = p.schedule === 'ppmi' ? B.ppmi.slice() : regularTimes(p.visits);
      var y = [];
      for (var j = 0; j < t.length; j++) y.push(BETA[0] + b0 + (BETA[1] + b1) * t[j] + p.sigma * B.eps[j]);
      people.push({ id: i + 1, t: t, y: y, b0: b0, b1: b1 });
    }
    return people;
  }

  // 2x2 matrices are row-major arrays [a, b, c, d] = [[a, b], [c, d]].
  function inv2(M) { var d = M[0] * M[3] - M[1] * M[2]; return [M[3] / d, -M[1] / d, -M[2] / d, M[0] / d]; }
  function mul2(A, B) {
    return [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3]];
  }
  function mv2(A, v) { return [A[0] * v[0] + A[1] * v[1], A[2] * v[0] + A[3] * v[1]]; }

  function sums(t, y) {
    var s = { m: t.length, st: 0, stt: 0, sy: 0, sty: 0 };
    for (var j = 0; j < t.length; j++) { s.st += t[j]; s.stt += t[j] * t[j]; s.sy += y[j]; s.sty += t[j] * y[j]; }
    return s;
  }

  /* A person's own least-squares line: [intercept, slope]. Needs two distinct times. */
  function olsLine(t, y) {
    var s = sums(t, y), tb = s.st / s.m, yb = s.sy / s.m;
    var slope = (s.sty - s.m * tb * yb) / (s.stt - s.m * tb * tb);
    return [yb - slope * tb, slope];
  }

  /* BLUP of the person's random effects, exactly the formula
   *   b_i = (Z_i'Z_i / s2 + G^-1)^-1 Z_i'(y_i - X_i beta) / s2,   X_i = Z_i = [1, t].
   * Also returns C = (Z'Z/s2 + G^-1)^-1, the conditional covariance of b_i given y_i. */
  function blup(t, y, beta, G, s2) {
    var s = sums(t, y), Gi = inv2(G);
    var A = [s.m / s2 + Gi[0], s.st / s2 + Gi[1], s.st / s2 + Gi[2], s.stt / s2 + Gi[3]];
    var C = inv2(A);
    var zr = [s.sy - beta[0] * s.m - beta[1] * s.st, s.sty - beta[0] * s.st - beta[1] * s.stt];
    var b = mv2(C, zr);
    return { b: [b[0] / s2, b[1] / s2], C: C };
  }

  /* Generalised least squares for beta given G and s2, using
   * V_i^-1 = (I - Z C Z'/s2)/s2 (Woodbury), so only 2x2 inverses are needed. */
  function glsBeta(people, G, s2) {
    var Gi = inv2(G), M = [0, 0, 0, 0], v = [0, 0];
    for (var i = 0; i < people.length; i++) {
      var s = sums(people[i].t, people[i].y);
      var ZtZ = [s.m, s.st, s.st, s.stt], Zty = [s.sy, s.sty];
      var C = inv2([ZtZ[0] / s2 + Gi[0], ZtZ[1] / s2 + Gi[1], ZtZ[2] / s2 + Gi[2], ZtZ[3] / s2 + Gi[3]]);
      var Pm = mul2(ZtZ, mul2(C, ZtZ));
      for (var k = 0; k < 4; k++) M[k] += (ZtZ[k] - Pm[k] / s2) / s2;
      var q = mv2(ZtZ, mv2(C, Zty));
      v[0] += (Zty[0] - q[0] / s2) / s2; v[1] += (Zty[1] - q[1] / s2) / s2;
    }
    return mv2(inv2(M), v);
  }

  /* Reliability of a person's own slope, lambda = tau1^2 / (tau1^2 + s2 / sum (t - tbar)^2).
   * Under the model, the regression of the BLUP slope deviation on the own-slope deviation has
   * slope exactly lambda, so 1 - lambda is the average shrinkage towards the population slope. */
  function slopeReliability(t, tau1, sigma) {
    var m = t.length, tb = 0, j;
    for (j = 0; j < m; j++) tb += t[j];
    tb /= m;
    var stt = 0;
    for (j = 0; j < m; j++) stt += (t[j] - tb) * (t[j] - tb);
    var v = tau1 * tau1;
    return v / (v + sigma * sigma / stt);
  }

  function fitAll(people, p) {
    var G = covG(p.tau0, p.tau1, p.rho), s2 = p.sigma * p.sigma;
    var beta = glsBeta(people, G, s2);
    var se = 0, sm = 0, lam = 0;
    var rows = people.map(function (q) {
      var own = olsLine(q.t, q.y);
      var bl = blup(q.t, q.y, beta, G, s2);
      var row = {
        id: q.id, t: q.t, y: q.y,
        own: own,
        mm: [beta[0] + bl.b[0], beta[1] + bl.b[1]],
        truth: [BETA[0] + q.b0, BETA[1] + q.b1],
        lambda: slopeReliability(q.t, p.tau1, p.sigma)
      };
      se += Math.pow(row.own[1] - row.truth[1], 2);
      sm += Math.pow(row.mm[1] - row.truth[1], 2);
      lam += row.lambda;
      return row;
    });
    var n = rows.length;
    return { beta: beta, rows: rows, rmseOwn: Math.sqrt(se / n), rmseMM: Math.sqrt(sm / n), meanLambda: lam / n };
  }

  /* ------------------------------------------------------------------ */
  /* DOM and SVG helpers                                                 */
  /* ------------------------------------------------------------------ */

  var SVGNS = 'http://www.w3.org/2000/svg';
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') e.textContent = v;
      else if (k === 'class') e.className = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    if (kids) for (var i = 0; i < kids.length; i++) if (kids[i] != null) e.appendChild(typeof kids[i] === 'string' ? document.createTextNode(kids[i]) : kids[i]);
    return e;
  }
  function s(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] != null) {
      if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(e);
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function niceStep(range, count) {
    var raw = range / Math.max(1, count), mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  }
  function ticks(lo, hi, count) {      // nice tick values; .dec = decimals the step needs (0.25 -> 2)
    var st = niceStep(hi - lo, count), out = [];
    for (var v = Math.ceil(lo / st - 1e-9) * st; v <= hi + 1e-9; v += st) out.push(Math.abs(v) < 1e-12 ? 0 : v);
    var d = Math.max(0, -Math.floor(Math.log10(st) + 1e-9));
    while (d < 6 && Math.abs(Math.round(st * Math.pow(10, d)) - st * Math.pow(10, d)) > 1e-6) d++;
    out.dec = d;
    return out;
  }
  function fmt(v, d) {
    var str = v.toFixed(d);
    if (/^-0(\.0+)?$/.test(str)) str = str.slice(1);
    return str.replace('-', '\u2212');
  }
  function fmtS(v, d) { return (v > 0 ? '+' : '') + fmt(v, d); }

  /* ------------------------------------------------------------------ */
  /* Style                                                               */
  /* ------------------------------------------------------------------ */

  var CSS = [
    '.R{font-family:var(--font-ui);color:var(--fg);font-size:14px;line-height:1.45}',
    '.R *{box-sizing:border-box}',
    '.R :focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '.R .P-intro{font-family:var(--font-body);font-size:15px;margin:0 0 14px;max-width:80ch}',
    '.R .P-layout{display:flex;flex-direction:column;gap:16px}',
    '.R.P-wide .P-layout{display:grid;grid-template-columns:272px minmax(0,1fr);gap:24px;align-items:start}',
    '.R .P-controls{background:var(--surface-2);border-radius:8px;padding:14px;display:grid;gap:14px 18px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));align-items:start}',
    '.R.P-wide .P-controls{grid-template-columns:1fr;position:sticky;top:8px}',
    '.R .P-field{display:flex;flex-direction:column;gap:4px;min-width:0}',
    '.R .P-row{display:flex;justify-content:space-between;align-items:baseline;gap:8px}',
    '.R .P-field label,.R legend,.R .P-lab{font-size:13px;font-weight:600;color:var(--fg)}',
    '.R output,.R .P-num{font-variant-numeric:tabular-nums;color:var(--muted);font-size:13px}',
    '.R .P-hint{font-size:12px;color:var(--muted);margin:0}',
    '.R input[type=range]{width:100%;accent-color:var(--accent);margin:2px 0}',
    '.R input[type=range]:disabled{opacity:.45}',
    '.R fieldset{border:0;padding:0;margin:0;min-width:0;display:flex;flex-direction:column;gap:4px}',
    '.R legend{padding:0;margin-bottom:2px}',
    '.R .P-check{display:flex;align-items:center;gap:6px;font-size:13px}',
    '.R .P-check input{accent-color:var(--accent);margin:0}',
    '.R .P-checks{display:grid;grid-template-columns:1fr 1fr;gap:2px 10px}',
    '.R select,.R button{font:inherit;font-size:13px;color:var(--fg);background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:5px 9px}',
    '.R button{cursor:pointer;font-weight:600}',
    '.R button:hover{background:var(--tint)}',
    '.R .P-btnrow{display:flex;gap:6px;flex-wrap:wrap;align-items:center}',
    '.R .P-main{display:flex;flex-direction:column;gap:16px;min-width:0}',
    '.R .P-callout{font-family:var(--font-body);font-size:15px;background:var(--tint);border-left:3px solid var(--accent);border-radius:0 8px 8px 0;padding:10px 14px;margin:0}',
    '.R .P-callout .P-num{color:var(--fg);font-family:var(--font-ui)}',
    '.R .P-link{background:none;border:0;padding:0;color:var(--accent);text-decoration:underline;font:inherit;cursor:pointer;font-weight:400}',
    '.R .P-link:hover{background:none}',
    '.R .P-charts{display:grid;gap:16px;grid-template-columns:minmax(0,1fr)}',
    '.R.P-xwide .P-charts{grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)}',
    '.R.P-xwide .P-c1{grid-row:span 2;align-self:start}',
    '.R .P-card{background:var(--surface);border:1px solid var(--rule);border-radius:8px;padding:12px 14px;min-width:0}',
    '.R .P-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:2px 12px}',
    '.R .P-card h3{font-size:15px;margin:0;font-weight:600}',
    '.R .P-synth{font-size:12px;color:var(--muted)}',
    '.R .P-howto{font-size:13px;color:var(--muted);margin:4px 0 8px}',
    '.R .P-legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--muted);margin:0 0 6px;padding:0;list-style:none}',
    '.R .P-legend li{display:flex;align-items:center;gap:6px}',
    '.R .P-plot{position:relative;width:100%}',
    '.R .P-plot svg{display:block;touch-action:none}',
    '.R .P-tip{position:absolute;pointer-events:none;background:var(--surface);color:var(--fg);border:1px solid var(--axis);border-radius:6px;padding:6px 9px;font-size:12px;line-height:1.4;z-index:3;white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.R .P-tip b{font-weight:600}',
    '.R .P-tip .P-trow{display:flex;align-items:center;gap:6px}',
    '.R .P-detail{font-size:13px;margin-top:8px}',
    '.R table{border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums}',
    '.R th,.R td{text-align:right;padding:3px 8px;border-bottom:1px solid var(--rule)}',
    '.R th:first-child,.R td:first-child{text-align:left}',
    '.R th{font-weight:600;color:var(--muted)}',
    '.R details{margin-top:8px;font-size:13px}',
    '.R summary{cursor:pointer;color:var(--muted)}',
    '.R .P-tablewrap{max-height:280px;overflow:auto;margin-top:6px}',
    '.R .P-foot{font-size:12px;color:var(--muted);margin:4px 0 0;font-family:var(--font-ui)}',
    /* SVG marks */
    '.R .P-grid line{stroke:var(--grid);stroke-width:1}',
    '.R .P-axis line{stroke:var(--axis);stroke-width:1}',
    '.R .P-tick{fill:var(--muted);font-family:var(--font-ui);font-size:12px;font-variant-numeric:tabular-nums}',
    '.R .P-axlab{fill:var(--muted);font-family:var(--font-ui);font-size:12px}',
    '.R .P-dlab{fill:var(--fg);font-family:var(--font-ui);font-size:12px}',
    '.R .P-own{stroke:var(--warn);stroke-width:1.1;fill:none;opacity:.6}',
    '.R .P-mm{stroke:var(--accent);stroke-width:1.25;fill:none;opacity:.6}',
    '.R .P-pt{fill:var(--muted);opacity:.6}',
    '.R .P-pop{stroke:var(--fg);stroke-width:2.5;fill:none;stroke-linecap:round}',
    '.R .P-dim .P-own,.R .P-dim .P-mm{opacity:.13}',
    '.R .P-dim .P-pt{opacity:.18}',
    '.R .P-own-hl{stroke:var(--warn);stroke-width:2;fill:none;stroke-dasharray:7 4}',
    '.R .P-mm-hl{stroke:var(--accent);stroke-width:2.5;fill:none;stroke-linecap:round}',
    '.R .P-truth-hl{stroke:var(--fg);stroke-width:1.75;fill:none;stroke-dasharray:1 4;stroke-linecap:round}',
    '.R .P-pt-hl{fill:var(--fg);stroke:var(--surface);stroke-width:2}',
    '.R .P-key-own{stroke:var(--warn);stroke-width:2;stroke-dasharray:6 3}',
    '.R .P-key-mm{stroke:var(--accent);stroke-width:2.5}',
    '.R .P-key-pop{stroke:var(--fg);stroke-width:2.5}',
    '.R .P-key-truth{stroke:var(--fg);stroke-width:1.75;stroke-dasharray:1 4;stroke-linecap:round}',
    '.R .P-key-ref{stroke:var(--muted);stroke-width:1.25}',
    '.R .P-conn{stroke:var(--muted);stroke-width:1;opacity:.6}',
    '.R .P-dot-own{fill:var(--surface);stroke:var(--warn);stroke-width:1.75}',
    '.R .P-dot-mm{fill:var(--accent);stroke:var(--surface);stroke-width:1.5}',
    '.R .P-tick-truth{stroke:var(--fg);stroke-width:2}',
    '.R .P-band{fill:var(--tint)}',
    '.R .P-ref{stroke:var(--muted);stroke-width:1.25;fill:none}',
    '.R .P-cur{stroke:var(--accent);stroke-width:2.5;fill:none}',
    '.R .P-pdot{fill:var(--accent);stroke:var(--surface);stroke-width:1.5;opacity:.85}',
    '.R .P-pdot-hl{fill:var(--accent);stroke:var(--fg);stroke-width:2}',
    '.R .P-hit{fill:transparent;cursor:pointer}',
    '@media (prefers-reduced-motion:no-preference){.R .P-own,.R .P-mm,.R .P-pt{transition:opacity .15s}}'
  ].join('\n');

  function ensureStyle() {
    if (document.getElementById('style-' + NAME)) return;
    var st = document.createElement('style');
    st.id = 'style-' + NAME;
    st.textContent = CSS.replace(/\.R\b/g, '.' + NAME + '-root').replace(/\.P-/g, '.' + P);
    document.head.appendChild(st);
  }

  /* ------------------------------------------------------------------ */
  /* Mount                                                               */
  /* ------------------------------------------------------------------ */

  var instances = 0;

  function mount(el, ctx) {
    ensureStyle();
    ctx = ctx || {};
    var uid = P + (++instances) + '-';
    var state = { seed: 20261110, n: 30, schedule: 'regular', visits: 3, sigma: 0.5, tau0: 0.6, tau1: 0.15, rho: 0,
      showOwn: true, showMM: true, showPop: true, showPts: true, selected: null, hover: null };
    var base = drawBase(state.seed);
    var model = null;
    var raf = 0, needFull = true;

    var root = h('div', { class: NAME + '-root' });
    el.appendChild(root);

    var links = 0;
    function link(label, id) {
      if (!ctx.openSection) return document.createTextNode(label);
      var b = h('button', { type: 'button', id: uid + 'link-' + (++links), class: P + 'link', text: label });
      b.addEventListener('click', function () { ctx.openSection(id); });
      return b;
    }

    root.appendChild(h('p', { class: P + 'intro' }, [
      'Each simulated person has their own baseline and rate of decline, seen through a few noisy visits. ',
      'Fitting a line to each person alone treats every wobble as real. A mixed-effects model (guide ',
      link('10.2', '102-longitudinal-data-and-mixed-effects-models'),
      ') treats people as draws from one population, so each person\u2019s line becomes a compromise between their own data and the population average: partial pooling. ',
      'How far it leans on the population depends on how much information that person\u2019s visits carry.'
    ]));

    /* ---------- controls ---------- */
    var controls = h('form', { class: P + 'controls', 'aria-label': 'Simulation settings' });
    controls.addEventListener('submit', function (e) { e.preventDefault(); });

    function range(key, label, min, max, step, format, hint) {
      var id = uid + key;
      var out = h('output', { id: id + '-out', for: id });
      var inp = h('input', { type: 'range', id: id, min: min, max: max, step: step, value: state[key] });
      function sync() { var v = +inp.value; out.textContent = format(v); inp.setAttribute('aria-valuetext', format(v)); }
      inp.addEventListener('input', function () { state[key] = +inp.value; sync(); onParams(); });
      sync();
      var kids = [h('div', { class: P + 'row' }, [h('label', { for: id, text: label }), out]), inp];
      if (hint) kids.push(h('p', { class: P + 'hint', text: hint }));
      var wrap = h('div', { class: P + 'field' }, kids);
      controls.appendChild(wrap);
      return inp;
    }

    range('n', 'People', 10, MAX_N, 1, function (v) { return String(v); });

    var sched = h('fieldset', {}, [h('legend', { text: 'Visit schedule' })]);
    [['regular', 'Yearly, same for everyone'], ['ppmi', 'PPMI-like: 2 to 4 visits, irregular']].forEach(function (o) {
      var id = uid + 'sched-' + o[0];
      var inp = h('input', { type: 'radio', name: uid + 'sched', id: id, value: o[0] });
      inp.checked = state.schedule === o[0];
      inp.addEventListener('change', function () {
        if (!inp.checked) return;
        state.schedule = o[0];
        visitsInput.disabled = state.schedule === 'ppmi';
        onParams();
      });
      sched.appendChild(h('div', { class: P + 'check' }, [inp, h('label', { for: id, text: o[1] })]));
    });
    controls.appendChild(sched);

    var visitsInput = range('visits', 'Visits per person', 2, MAX_V, 1, function (v) {
      return v + ' (years 0 to ' + (v - 1) + ')';
    });
    range('sigma', 'Noise SD per visit (\u03c3)', 0.1, 1, 0.05, function (v) { return fmt(v, 2); });
    range('tau1', 'Slope spread (SD per year)', 0.02, 0.4, 0.01, function (v) { return fmt(v, 2); });
    range('tau0', 'Baseline spread (SD)', 0.2, 1.2, 0.05, function (v) { return fmt(v, 2); });
    range('rho', 'Baseline\u2013slope correlation', -0.8, 0.8, 0.1, function (v) { return fmt(v, 1); });

    var showSet = h('fieldset', {}, [h('legend', { text: 'Show' })]);
    var checks = h('div', { class: P + 'checks' });
    [['showOwn', 'Own fits'], ['showMM', 'Mixed model'], ['showPop', 'Population line'], ['showPts', 'Data points']].forEach(function (o) {
      var id = uid + o[0];
      var inp = h('input', { type: 'checkbox', id: id });
      inp.checked = state[o[0]];
      inp.addEventListener('change', function () { state[o[0]] = inp.checked; needFull = true; schedule(); });
      checks.appendChild(h('div', { class: P + 'check' }, [inp, h('label', { for: id, text: o[1] })]));
    });
    showSet.appendChild(checks);
    controls.appendChild(showSet);

    var personSel = h('select', { id: uid + 'person' });
    var prevBtn = h('button', { type: 'button', id: uid + 'prev', text: 'Previous', 'aria-label': 'Previous person' });
    var nextBtn = h('button', { type: 'button', id: uid + 'next', text: 'Next', 'aria-label': 'Next person' });
    controls.appendChild(h('div', { class: P + 'field' }, [
      h('label', { for: uid + 'person', text: 'Person' }),
      h('div', { class: P + 'btnrow' }, [personSel, prevBtn, nextBtn])
    ]));
    personSel.addEventListener('change', function () { select(personSel.value ? +personSel.value : null); });
    prevBtn.addEventListener('click', function () { step(-1); });
    nextBtn.addEventListener('click', function () { step(1); });

    var newBtn = h('button', { type: 'button', id: uid + 'new', text: 'New sample' });
    newBtn.addEventListener('click', function () {
      state.seed = (Math.imul(state.seed, 1103515245) + 12345) >>> 1;
      base = drawBase(state.seed);
      onParams();
    });
    controls.appendChild(h('div', { class: P + 'btnrow' }, [newBtn]));

    /* ---------- charts ---------- */
    var main = h('div', { class: P + 'main' });
    var callout = h('p', { class: P + 'callout', 'aria-live': 'polite' });
    main.appendChild(callout);
    var charts = h('div', { class: P + 'charts' });
    main.appendChild(charts);

    function legendItem(cls, label) {
      var svg = s('svg', { width: 22, height: 10, 'aria-hidden': 'true' });
      s('line', { x1: 1, y1: 5, x2: 21, y2: 5, class: P + cls }, svg);
      return h('li', {}, [svg, h('span', { text: label })]);
    }
    function card(cls, title, howto, legendItems) {
      var plot = h('div', { class: P + 'plot' });
      var tip = h('div', { class: P + 'tip', hidden: true });
      plot.appendChild(tip);
      var c = h('section', { class: P + 'card ' + P + cls }, [
        h('div', { class: P + 'head' }, [h('h3', { text: title }), h('span', { class: P + 'synth', text: 'Simulated data for illustration, not PPMI data' })]),
        h('p', { class: P + 'howto', text: 'How to read this: ' + howto }),
        legendItems ? h('ul', { class: P + 'legend', 'aria-label': 'Legend' }, legendItems) : null,
        plot
      ]);
      charts.appendChild(c);
      return { card: c, plot: plot, tip: tip };
    }

    var c1 = card('c1', 'Each person\u2019s line',
      'one line per person: amber, their own least-squares fit; blue, the mixed model; thick, the population. Hover or click a person to see their data and true line.',
      [legendItem('key-own', 'Own fit'), legendItem('key-mm', 'Mixed model'), legendItem('key-pop', 'Population (estimated)'), legendItem('key-truth', 'True line (selected person)')]);
    var detail = h('div', { class: P + 'detail', 'aria-live': 'polite' });
    c1.card.appendChild(detail);

    var c2 = card('c2', 'Slopes, person by person',
      'one column per person, sorted by own slope: ring, own slope; dot, mixed model; tick, true slope. Dots sit nearer their ticks on average but are less spread out than the truth: shrinkage trades a little bias for much less noise.',
      null);
    var leg2 = h('ul', { class: P + 'legend', 'aria-label': 'Legend' });
    (function () {
      function item(draw, label) { var svg = s('svg', { width: 16, height: 12, 'aria-hidden': 'true' }); draw(svg); return h('li', {}, [svg, h('span', { text: label })]); }
      leg2.appendChild(item(function (g) { s('circle', { cx: 8, cy: 6, r: 4, class: P + 'dot-own' }, g); }, 'Own slope'));
      leg2.appendChild(item(function (g) { s('circle', { cx: 8, cy: 6, r: 4, class: P + 'dot-mm' }, g); }, 'Mixed model'));
      leg2.appendChild(item(function (g) { s('line', { x1: 3, y1: 6, x2: 13, y2: 6, class: P + 'tick-truth' }, g); }, 'True slope'));
      leg2.appendChild(legendItem('key-pop', 'Population slope'));
    })();
    c2.card.insertBefore(leg2, c2.plot);
    var table2 = h('table');
    var details2 = h('details', {}, [h('summary', { text: 'Table: every person\u2019s slopes' }), h('div', { class: P + 'tablewrap' }, [table2])]);
    c2.card.appendChild(details2);

    var c3 = card('c3', 'Shrinkage of the slope',
      'the share of a person\u2019s own slope deviation that the mixed model discounts, by number of yearly visits. Blue: current noise; grey: other noise levels; dots: the people in this sample (visits spread over more years shrink less).',
      [legendItem('key-mm', 'Current noise SD'), legendItem('key-ref', 'Other noise SDs')]);
    c3.card.appendChild(h('p', { class: P + 'foot', text:
      'Shrinkage = 1 \u2212 \u03c4\u2081\u00b2 / (\u03c4\u2081\u00b2 + \u03c3\u00b2 / \u03a3(t \u2212 t\u0304)\u00b2), where \u03c4\u2081 is the spread of true slopes. Under the model this is exactly the average pull of the mixed-model slope towards the population slope (Raudenbush & Bryk 2002 call \u03bb = 1 \u2212 shrinkage the reliability).' }));

    var foot = h('p', { class: P + 'foot', text:
      'Model: score = (\u03b2\u2080 + b\u2080) + (\u03b2\u2081 + b\u2081)\u00b7t + noise, with \u03b2\u2080 = 0 and \u03b2\u2081 = \u22120.15 per year (illustrative z-units). ' +
      'The mixed-model line is the BLUP computed exactly from the true variance components, b = (Z\u2032Z/\u03c3\u00b2 + G\u207b\u00b9)\u207b\u00b9 Z\u2032(y \u2212 X\u03b2)/\u03c3\u00b2, ' +
      'with \u03b2 estimated by generalised least squares. A real analysis also has to estimate G and \u03c3\u00b2 (for example by REML), which adds uncertainty.' });
    main.appendChild(foot);

    var layout = h('div', { class: P + 'layout' }, [controls, main]);
    root.appendChild(layout);
    visitsInput.disabled = state.schedule === 'ppmi';

    /* ---------- state changes ---------- */
    function rebuildPersonSelect() {
      var cur = state.selected;
      clear(personSel);
      personSel.appendChild(h('option', { value: '', text: 'None' }));
      for (var i = 1; i <= state.n; i++) personSel.appendChild(h('option', { value: String(i), text: 'Person ' + i }));
      if (cur != null && cur > state.n) state.selected = null;
      personSel.value = state.selected == null ? '' : String(state.selected);
    }
    function select(id) {
      state.selected = id;
      personSel.value = id == null ? '' : String(id);
      schedule();
    }
    function step(d) {
      var cur = state.selected == null ? (d > 0 ? 0 : state.n + 1) : state.selected;
      var next = cur + d;
      if (next < 1) next = state.n;
      if (next > state.n) next = 1;
      select(next);
    }
    var dirty = true;
    function onParams() { dirty = true; needFull = true; schedule(); }
    function recompute() {
      model = fitAll(simulate(base, state), state);
      if (personSel.options.length !== state.n + 1) rebuildPersonSelect();
      dirty = false;
    }
    function schedule() {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; render(); });
    }

    /* ---------- chart 1: trajectories ---------- */
    var g1 = null;   // {svg, x, y, base, hl, w, h, m}
    function drawTraj() {
      var W = Math.max(280, Math.floor(c1.plot.clientWidth));
      var H = clamp(Math.round(W * 0.58), 300, 500);
      var m = { l: 56, r: 14, t: 10, b: 40 };
      var iw = W - m.l - m.r, ih = H - m.t - m.b;
      var lo = Infinity, hi = -Infinity;
      model.rows.forEach(function (r) { r.y.forEach(function (v) { lo = Math.min(lo, v); hi = Math.max(hi, v); }); });
      lo = Math.min(lo, -1.5); hi = Math.max(hi, 1);
      var st = niceStep(hi - lo, 6);
      lo = Math.floor(lo / st) * st; hi = Math.ceil(hi / st) * st;
      var tMax = 1;
      model.rows.forEach(function (r) { tMax = Math.max(tMax, r.t[r.t.length - 1]); });
      var xMax = Math.ceil(tMax * 2 - 1e-9) / 2;   // axis ends at the last visit, rounded up to half a year
      var x = function (t) { return m.l + (t / xMax) * iw; };
      var y = function (v) { return m.t + (1 - (v - lo) / (hi - lo)) * ih; };

      var old = c1.plot.querySelector('svg');
      var svg = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img',
        'aria-label': 'Lines for ' + state.n + ' simulated people: own least-squares fits, mixed-model lines and the population line, score against years since baseline.' });
      var clipId = uid + 'clip1';
      var defs = s('defs', null, svg);
      var cp = s('clipPath', { id: clipId }, defs);
      s('rect', { x: m.l - 6, y: m.t - 6, width: iw + 12, height: ih + 12 }, cp);   // room for edge points

      var grid = s('g', { class: P + 'grid' }, svg);
      var axis = s('g', { class: P + 'axis' }, svg);
      var tk1 = ticks(lo, hi, 6);
      tk1.forEach(function (v) {
        s('line', { x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v) }, grid);
        s('text', { x: m.l - 7, y: y(v) + 4, 'text-anchor': 'end', class: P + 'tick', text: fmt(v, tk1.dec) }, svg);
      });
      for (var t = 0; t <= xMax + 1e-9; t++) {
        s('line', { x1: x(t), x2: x(t), y1: m.t + ih, y2: m.t + ih + 5 }, axis);
        s('text', { x: x(t), y: m.t + ih + 18, 'text-anchor': 'middle', class: P + 'tick', text: String(t) }, svg);
      }
      s('line', { x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih }, axis);
      s('text', { x: m.l + iw / 2, y: H - 4, 'text-anchor': 'middle', class: P + 'axlab', text: 'Years since baseline' }, svg);
      s('text', { x: 10, y: m.t + ih / 2, 'text-anchor': 'middle', class: P + 'axlab', transform: 'rotate(-90 10 ' + (m.t + ih / 2) + ')', text: 'Cognitive score (z)' }, svg);

      var plotG = s('g', { 'clip-path': 'url(#' + clipId + ')' }, svg);
      var baseG = s('g', null, plotG);
      model.rows.forEach(function (r) {
        var t0 = r.t[0], t1 = r.t[r.t.length - 1];
        if (state.showOwn) s('line', { x1: x(t0), y1: y(r.own[0] + r.own[1] * t0), x2: x(t1), y2: y(r.own[0] + r.own[1] * t1), class: P + 'own' }, baseG);
        if (state.showMM) s('line', { x1: x(t0), y1: y(r.mm[0] + r.mm[1] * t0), x2: x(t1), y2: y(r.mm[0] + r.mm[1] * t1), class: P + 'mm' }, baseG);
        if (state.showPts) r.t.forEach(function (tt, j) { s('circle', { cx: x(tt), cy: y(r.y[j]), r: 2.5, class: P + 'pt' }, baseG); });
      });
      if (state.showPop) s('line', { x1: x(0), y1: y(model.beta[0]), x2: x(xMax), y2: y(model.beta[0] + model.beta[1] * xMax), class: P + 'pop' }, plotG);
      var hl = s('g', null, plotG);
      var hit = s('rect', { x: m.l, y: m.t, width: iw, height: ih, class: P + 'hit' }, svg);

      if (old) c1.plot.replaceChild(svg, old); else c1.plot.insertBefore(svg, c1.tip);
      g1 = { svg: svg, x: x, y: y, xMax: xMax, base: baseG, hl: hl, m: m, iw: iw, ih: ih, W: W, H: H };

      function nearest(evt) {
        var rect = svg.getBoundingClientRect();
        var px = evt.clientX - rect.left, py = evt.clientY - rect.top, best = null, bd = 14;
        model.rows.forEach(function (r) {
          var t0 = r.t[0], t1 = r.t[r.t.length - 1];
          var segs = [];
          if (state.showMM) segs.push(r.mm);
          if (state.showOwn) segs.push(r.own);
          segs.forEach(function (ln) {
            var d = segDist(px, py, x(t0), y(ln[0] + ln[1] * t0), x(t1), y(ln[0] + ln[1] * t1));
            if (d < bd) { bd = d; best = r.id; }
          });
          if (state.showPts) r.t.forEach(function (tt, j) {
            var d = Math.hypot(px - x(tt), py - y(r.y[j]));
            if (d < bd) { bd = d; best = r.id; }
          });
        });
        return { id: best, px: px, py: py };
      }
      hit.addEventListener('pointermove', function (e) {
        var n = nearest(e);
        if (n.id !== state.hover) { state.hover = n.id; schedule(); }
        placeTip(c1, n.id, n.px, n.py);
      });
      hit.addEventListener('pointerleave', function () { state.hover = null; c1.tip.hidden = true; schedule(); });
      hit.addEventListener('click', function (e) { var n = nearest(e); select(n.id === state.selected ? null : n.id); });
    }

    function segDist(px, py, x1, y1, x2, y2) {
      var dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
      var u = L > 0 ? clamp(((px - x1) * dx + (py - y1) * dy) / L, 0, 1) : 0;
      return Math.hypot(px - (x1 + u * dx), py - (y1 + u * dy));
    }

    function rowById(id) { return id == null ? null : model.rows[id - 1]; }

    function tipContent(tip, r) {
      clear(tip);
      tip.appendChild(h('div', {}, [h('b', { text: 'Person ' + r.id }), ' \u00b7 ' + r.t.length + ' visits']));
      function line(cls, val, label) {
        var svg = s('svg', { width: 16, height: 8, 'aria-hidden': 'true' });
        s('line', { x1: 0, y1: 4, x2: 16, y2: 4, class: P + cls }, svg);
        tip.appendChild(h('div', { class: P + 'trow' }, [svg, h('b', { text: fmt(val, 2) }), h('span', { text: label })]));
      }
      line('key-own', r.own[1], 'own slope per year');
      line('key-mm', r.mm[1], 'mixed model');
      line('key-truth', r.truth[1], 'true slope');
    }
    function placeTip(c, id, px, py) {
      var r = rowById(id);
      if (!r) { c.tip.hidden = true; return; }
      tipContent(c.tip, r);
      c.tip.hidden = false;
      var W = c.plot.clientWidth, tw = c.tip.offsetWidth, th = c.tip.offsetHeight;
      var left = px + 14; if (left + tw > W) left = px - tw - 14;
      var top = py - th - 10; if (top < 0) top = py + 14;
      c.tip.style.left = Math.max(0, left) + 'px';
      c.tip.style.top = top + 'px';
    }

    function drawTrajHighlight() {
      if (!g1) return;
      clear(g1.hl);
      var id = state.hover != null ? state.hover : state.selected;
      g1.base.setAttribute('class', id != null ? P + 'dim' : '');
      var r = rowById(id);
      if (!r) return;
      var x = g1.x, y = g1.y;
      var xe = g1.xMax;
      function full(ln, cls) { s('line', { x1: x(0), y1: y(ln[0]), x2: x(xe), y2: y(ln[0] + ln[1] * xe), class: P + cls }, g1.hl); }
      full(r.truth, 'truth-hl');
      full(r.own, 'own-hl');
      full(r.mm, 'mm-hl');
      r.t.forEach(function (tt, j) { s('circle', { cx: x(tt), cy: y(r.y[j]), r: 4.5, class: P + 'pt-hl' }, g1.hl); });
    }

    /* ---------- chart 2: slopes person by person ---------- */
    var g2 = null;
    function drawSlopes() {
      var W = Math.max(280, Math.floor(c2.plot.clientWidth));
      var H = clamp(Math.round(W * 0.42), 220, 320);
      var m = { l: 56, r: 12, t: 10, b: 30 };
      var iw = W - m.l - m.r, ih = H - m.t - m.b;
      var rows = model.rows.slice().sort(function (a, b) { return a.own[1] - b.own[1]; });
      var lo = Infinity, hi = -Infinity;
      rows.forEach(function (r) { [r.own[1], r.mm[1], r.truth[1]].forEach(function (v) { lo = Math.min(lo, v); hi = Math.max(hi, v); }); });
      var pad = (hi - lo) * 0.06 + 0.02; lo -= pad; hi += pad;
      var n = rows.length, bw = iw / n;
      var x = function (i) { return m.l + (i + 0.5) * bw; };
      var y = function (v) { return m.t + (1 - (v - lo) / (hi - lo)) * ih; };
      var old = c2.plot.querySelector('svg');
      var svg = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img',
        'aria-label': 'Own slopes, mixed-model slopes and true slopes for each person. Root mean square error of own slopes ' + fmt(model.rmseOwn, 2) + ', of mixed-model slopes ' + fmt(model.rmseMM, 2) + ' per year.' });
      var grid = s('g', { class: P + 'grid' }, svg);
      var tk2 = ticks(lo, hi, 5);
      tk2.forEach(function (v) {
        s('line', { x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v) }, grid);
        s('text', { x: m.l - 7, y: y(v) + 4, 'text-anchor': 'end', class: P + 'tick', text: fmt(v, tk2.dec) }, svg);
      });
      s('text', { x: 10, y: m.t + ih / 2, 'text-anchor': 'middle', class: P + 'axlab', transform: 'rotate(-90 10 ' + (m.t + ih / 2) + ')', text: 'Slope per year' }, svg);
      s('text', { x: m.l + iw / 2, y: H - 8, 'text-anchor': 'middle', class: P + 'axlab', text: 'People, sorted by own slope' }, svg);
      var band = s('g', null, svg);
      s('line', { x1: m.l, x2: m.l + iw, y1: y(model.beta[1]), y2: y(model.beta[1]), class: P + 'pop', style: 'stroke-width:1.5' }, svg);
      var r0 = clamp(bw * 0.32, 2.5, 4.5);
      rows.forEach(function (r, i) {
        s('line', { x1: x(i), x2: x(i), y1: y(r.own[1]), y2: y(r.mm[1]), class: P + 'conn' }, svg);
        s('line', { x1: x(i) - Math.max(3, r0 + 1), x2: x(i) + Math.max(3, r0 + 1), y1: y(r.truth[1]), y2: y(r.truth[1]), class: P + 'tick-truth' }, svg);
        s('circle', { cx: x(i), cy: y(r.own[1]), r: r0, class: P + 'dot-own' }, svg);
        s('circle', { cx: x(i), cy: y(r.mm[1]), r: r0, class: P + 'dot-mm' }, svg);
      });
      var hit = s('rect', { x: m.l, y: m.t, width: iw, height: ih, class: P + 'hit' }, svg);
      if (old) c2.plot.replaceChild(svg, old); else c2.plot.insertBefore(svg, c2.tip);
      g2 = { band: band, rows: rows, x: x, bw: bw, m: m, ih: ih };
      function idx(e) { var rect = svg.getBoundingClientRect(); var px = e.clientX - rect.left; return { i: clamp(Math.floor((px - m.l) / bw), 0, n - 1), px: px, py: e.clientY - rect.top }; }
      hit.addEventListener('pointermove', function (e) {
        var k = idx(e), id = rows[k.i].id;
        if (id !== state.hover) { state.hover = id; schedule(); }
        placeTip(c2, id, k.px, k.py);
      });
      hit.addEventListener('pointerleave', function () { state.hover = null; c2.tip.hidden = true; schedule(); });
      hit.addEventListener('click', function (e) { var id = rows[idx(e).i].id; select(id === state.selected ? null : id); });

      clear(table2);
      table2.appendChild(h('thead', {}, [h('tr', {}, ['Person', 'Visits', 'Own slope', 'Mixed model', 'True slope'].map(function (c) { return h('th', { scope: 'col', text: c }); }))]));
      var tb = h('tbody');
      model.rows.forEach(function (r) {
        tb.appendChild(h('tr', {}, [h('td', { text: String(r.id) }), h('td', { text: String(r.t.length) }), h('td', { text: fmt(r.own[1], 3) }), h('td', { text: fmt(r.mm[1], 3) }), h('td', { text: fmt(r.truth[1], 3) })]));
      });
      table2.appendChild(tb);
    }
    function drawSlopesHighlight() {
      if (!g2) return;
      clear(g2.band);
      var id = state.hover != null ? state.hover : state.selected;
      if (id == null) return;
      for (var i = 0; i < g2.rows.length; i++) if (g2.rows[i].id === id) {
        s('rect', { x: g2.x(i) - g2.bw / 2, y: g2.m.t, width: g2.bw, height: g2.ih, class: P + 'band' }, g2.band);
      }
    }

    /* ---------- chart 3: shrinkage versus visits and noise ---------- */
    var g3 = null;
    function drawShrink() {
      var W = Math.max(280, Math.floor(c3.plot.clientWidth));
      var H = clamp(Math.round(W * 0.5), 220, 320);
      var m = { l: 58, r: 64, t: 12, b: 40 };
      var iw = W - m.l - m.r, ih = H - m.t - m.b;
      var x = function (v) { return m.l + ((v - 2) / 4) * iw; };
      var y = function (p) { return m.t + (1 - p) * ih; };
      var old = c3.plot.querySelector('svg');
      var cur = 1 - slopeReliability(regularTimes(state.visits), state.tau1, state.sigma);
      var svg = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img',
        'aria-label': 'Shrinkage of the slope against number of yearly visits for several noise levels. At the current noise, ' + Math.round(100 * cur) + ' percent with ' + state.visits + ' visits.' });
      var grid = s('g', { class: P + 'grid' }, svg);
      [0, 0.25, 0.5, 0.75, 1].forEach(function (p) {
        s('line', { x1: m.l, x2: m.l + iw, y1: y(p), y2: y(p) }, grid);
        s('text', { x: m.l - 7, y: y(p) + 4, 'text-anchor': 'end', class: P + 'tick', text: Math.round(p * 100) + '%' }, svg);
      });
      for (var v = 2; v <= 6; v++) {
        s('line', { x1: x(v), x2: x(v), y1: m.t + ih, y2: m.t + ih + 5, class: P + 'conn' }, svg);
        s('text', { x: x(v), y: m.t + ih + 18, 'text-anchor': 'middle', class: P + 'tick', text: String(v) }, svg);
      }
      s('text', { x: m.l + iw / 2, y: H - 4, 'text-anchor': 'middle', class: P + 'axlab', text: 'Yearly visits per person' }, svg);
      s('text', { x: 10, y: m.t + ih / 2, 'text-anchor': 'middle', class: P + 'axlab', transform: 'rotate(-90 10 ' + (m.t + ih / 2) + ')', text: 'Shrinkage' }, svg);
      function path(sig) {
        var d = '';
        for (var k = 2; k <= 6; k++) d += (k === 2 ? 'M' : 'L') + x(k).toFixed(1) + ',' + y(1 - slopeReliability(regularTimes(k), state.tau1, sig)).toFixed(1);
        return d;
      }
      var refs = [0.25, 0.5, 0.75, 1].filter(function (sg) { return Math.abs(sg - state.sigma) > 0.06; });
      var labels = [];
      refs.forEach(function (sg) {
        s('path', { d: path(sg), class: P + 'ref' }, svg);
        labels.push({ v: 1 - slopeReliability(regularTimes(6), state.tau1, sg), text: '\u03c3 ' + fmt(sg, 2), cls: P + 'tick' });
      });
      s('path', { d: path(state.sigma), class: P + 'cur' }, svg);
      for (v = 2; v <= 6; v++) s('circle', { cx: x(v), cy: y(1 - slopeReliability(regularTimes(v), state.tau1, state.sigma)), r: 3, class: P + 'dot-mm' }, svg);
      labels.push({ v: 1 - slopeReliability(regularTimes(6), state.tau1, state.sigma), text: '\u03c3 ' + fmt(state.sigma, 2), cls: P + 'dlab' });
      // end labels, nudged apart only when they overlap
      labels.sort(function (a, b) { return a.v - b.v; });
      var lastY = Infinity;
      labels.forEach(function (L) {
        var yy = y(L.v) + 4;
        if (lastY - yy < 13) yy = lastY - 13;
        lastY = yy;
        s('text', { x: m.l + iw + 6, y: yy, class: L.cls, text: L.text }, svg);
      });
      // people in this sample: their own visit count and times
      var dots = s('g', null, svg);
      var counts = {};
      model.rows.forEach(function (r) {
        var k = r.t.length; counts[k] = (counts[k] || 0) + 1;
        var j = counts[k];
        var jitter = ((j * 0.618034) % 1 - 0.5) * Math.min(26, iw / 10);
        r._sx = x(k) + jitter; r._sy = y(1 - r.lambda);
        s('circle', { cx: r._sx, cy: r._sy, r: 3.5, class: P + 'pdot' }, dots);
      });
      var hlG = s('g', null, svg);
      if (old) c3.plot.replaceChild(svg, old); else c3.plot.insertBefore(svg, c3.tip);
      g3 = { hl: hlG };
    }
    function drawShrinkHighlight() {
      if (!g3) return;
      clear(g3.hl);
      var r = rowById(state.hover != null ? state.hover : state.selected);
      if (r && r._sx != null) s('circle', { cx: r._sx, cy: r._sy, r: 6, class: P + 'pdot-hl' }, g3.hl);
    }

    /* ---------- text ---------- */
    function renderText() {
      var lam = model.meanLambda, noise = Math.round(100 * (1 - lam)), keep = 100 - noise;
      var setting = state.schedule === 'ppmi'
        ? 'With this PPMI-like schedule of 2 to 4 irregular visits'
        : 'With ' + state.visits + ' yearly visits';
      clear(callout);
      var parts = [setting + ' and noise SD ' + fmt(state.sigma, 2) + ', about ' + noise + '% of the spread in people\u2019s own slopes is measurement noise. '];
      if (lam < 0.5) parts.push('A person\u2019s own slope is mostly noise, so the mixed model keeps only about ' + keep + '% of each person\u2019s deviation from the average slope and leans on the population for the rest. ');
      else if (lam < 0.85) parts.push('The mixed model keeps about ' + keep + '% of each person\u2019s deviation from the average slope and pulls the extreme ones in. ');
      else parts.push('Own slopes are mostly signal here, so the mixed model barely moves them. ');
      parts.push('In this sample, own slopes miss the true slopes by ');
      callout.appendChild(document.createTextNode(parts.join('')));
      callout.appendChild(h('span', { class: P + 'num', text: fmt(model.rmseOwn, 2) }));
      callout.appendChild(document.createTextNode(' per year (root mean square); the mixed model\u2019s slopes by '));
      callout.appendChild(h('span', { class: P + 'num', text: fmt(model.rmseMM, 2) }));
      callout.appendChild(document.createTextNode('. That is why a mixed model is the default for PPMI\u2019s 2 to 4 observations per modality (guide '));
      callout.appendChild(link('10.2', '102-longitudinal-data-and-mixed-effects-models'));
      callout.appendChild(document.createTextNode(', '));
      callout.appendChild(link('10.4', '104-disease-progression-models'));
      callout.appendChild(document.createTextNode(').'));

      clear(detail);
      var r = rowById(state.selected);
      if (!r) {
        detail.appendChild(h('p', { class: P + 'hint', text: 'Click a line, or choose a person in the settings, to compare one person\u2019s fits with their true line.' }));
        return;
      }
      detail.appendChild(h('p', { class: P + 'hint', text: 'Person ' + r.id + ': visits at ' + r.t.map(function (t) { return fmt(t, 2).replace(/\.?0+$/, ''); }).join(', ') + ' years. Mixed model keeps ' + Math.round(100 * r.lambda) + '% of this person\u2019s own slope deviation, on average.' }));
      var tbl = h('table');
      tbl.appendChild(h('thead', {}, [h('tr', {}, ['', 'Baseline', 'Slope per year'].map(function (c) { return h('th', { scope: 'col', text: c }); }))]));
      var tb = h('tbody');
      [['Own fit', r.own], ['Mixed model', r.mm], ['True line', r.truth], ['Population (estimated)', model.beta]].forEach(function (row) {
        tb.appendChild(h('tr', {}, [h('td', { text: row[0] }), h('td', { text: fmt(row[1][0], 2) }), h('td', { text: fmt(row[1][1], 3) })]));
      });
      tbl.appendChild(tb);
      detail.appendChild(tbl);
    }

    /* ---------- render ---------- */
    var lastW = '';
    function render() {
      if (dirty) recompute();
      if (!model) return;
      if (needFull) {
        drawTraj(); drawSlopes(); drawShrink();
        needFull = false;
      }
      drawTrajHighlight(); drawSlopesHighlight(); drawShrinkHighlight();
      renderText();
    }

    function layoutClass() {
      var w = el.clientWidth || root.clientWidth;
      root.classList.toggle(P + 'wide', w >= 1100);
      root.classList.toggle(P + 'xwide', w >= 1200);
    }

    var ro = new ResizeObserver(function () {
      layoutClass();
      var w = [c1.plot.clientWidth, c2.plot.clientWidth, c3.plot.clientWidth].join(',');
      if (w !== lastW) { lastW = w; needFull = true; schedule(); }
    });
    ro.observe(el);
    ro.observe(c1.plot); ro.observe(c2.plot); ro.observe(c3.plot);

    layoutClass();
    rebuildPersonSelect();
    onParams();

    return {
      destroy: function () {
        ro.disconnect();
        if (raf) cancelAnimationFrame(raf);
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  X[NAME] = {
    title: 'Partial pooling in a mixed model',
    blurb: 'Simulate people with a few noisy visits and see how a mixed model pulls each person\u2019s line towards the population.',
    mount: mount,
    _lib: {
      BETA: BETA, mulberry32: mulberry32, makeNormal: makeNormal, drawBase: drawBase, simulate: simulate,
      regularTimes: regularTimes, covG: covG, inv2: inv2, olsLine: olsLine, blup: blup, glsBeta: glsBeta,
      slopeReliability: slopeReliability, fitAll: fitAll
    }
  };
})();
