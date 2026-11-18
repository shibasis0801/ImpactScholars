/* PPMI Atlas explorer: dropout and missing data (MCAR, MAR, MNAR; Rubin 1976).
 * Everything here is simulated. No PPMI data is used or loaded.
 * Complete data: y_ij = (b0 + b0_i) + (b1 + b1_i) t_j + e_ij at yearly visits t = 0..5.
 * Monotone dropout before each follow-up with probability expit(logit(h) - gamma * z), where z is
 * nothing (MCAR), the last observed score (MAR), the current unseen score (MNAR) or the person's
 * own slope (MNAR), each standardised.
 * MAR-valid estimate: the random-intercept-and-slope model fitted by maximum likelihood (ECME:
 * beta by GLS, EM steps for G and sigma^2) to every observed visit.
 */
(function () {
  'use strict';
  var NAME = 'missing';
  var P = NAME + '-';
  var X = (window.PPMIExplorers = window.PPMIExplorers || {});

  /* ------------------------------------------------------------------ */
  /* Pure statistics (exported as _lib for node tests)                    */
  /* ------------------------------------------------------------------ */

  var T = [0, 1, 2, 3, 4, 5], NV = 6, MAX_N = 2000, REPS = 200;
  // Illustrative true model, in z-units: mean decline 0.25 per year.
  var TRUE = { beta0: 0, beta1: -0.25, tau0: 0.8, tau1: 0.2, rho: 0, sigma: 0.4 };
  var MECHS = ['mcar', 'mar', 'mnar-y', 'mnar-slope'];
  var MECH_LABEL = {
    'mcar': 'MCAR: unrelated to anything',
    'mar': 'MAR: last observed score',
    'mnar-y': 'MNAR: current, unseen score',
    'mnar-slope': 'MNAR: own rate of decline'
  };
  var MECH_SHORT = { 'mcar': 'MCAR', 'mar': 'MAR', 'mnar-y': 'MNAR (score)', 'mnar-slope': 'MNAR (slope)' };

  function mulberry32(seed) {
    var a = seed | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeNormal(rng) {
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

  /* Random draws fixed by the seed (common random numbers): the same people and the same dropout
   * uniforms are reused when the mechanism or its strength changes. */
  function drawBase(seed, n) {
    var nE = makeNormal(mulberry32(seed * 4 + 1)), nN = makeNormal(mulberry32(seed * 4 + 2)), rU = mulberry32(seed * 4 + 3);
    var b = { n: n, u0: new Float64Array(n), u1: new Float64Array(n), eps: new Float64Array(n * NV), U: new Float64Array(n * (NV - 1)) };
    for (var i = 0; i < n; i++) {
      b.u0[i] = nE(); b.u1[i] = nE();
      for (var j = 0; j < NV; j++) b.eps[i * NV + j] = nN();
      for (j = 0; j < NV - 1; j++) b.U[i * (NV - 1) + j] = rU();
    }
    return b;
  }

  function completeData(base, n, Pm) {
    var y = new Float64Array(n * NV), b1 = new Float64Array(n), c = Math.sqrt(1 - Pm.rho * Pm.rho);
    for (var i = 0; i < n; i++) {
      var B0 = Pm.tau0 * base.u0[i], B1 = Pm.tau1 * (Pm.rho * base.u0[i] + c * base.u1[i]);
      b1[i] = B1;
      for (var j = 0; j < NV; j++) y[i * NV + j] = Pm.beta0 + B0 + (Pm.beta1 + B1) * T[j] + Pm.sigma * base.eps[i * NV + j];
    }
    return { n: n, y: y, b1: b1 };
  }

  function marginal(Pm) {
    return {
      mu: T.map(function (t) { return Pm.beta0 + Pm.beta1 * t; }),
      sd: T.map(function (t) { return Math.sqrt(Pm.tau0 * Pm.tau0 + 2 * Pm.rho * Pm.tau0 * Pm.tau1 * t + Pm.tau1 * Pm.tau1 * t * t + Pm.sigma * Pm.sigma); })
    };
  }

  /* Monotone dropout. Returns the number of observed visits per person (1..6). */
  function dropout(cd, base, mech, h, gamma, Pm) {
    var n = cd.n, D = new Int8Array(n), mg = marginal(Pm), lh = Math.log(h / (1 - h));
    for (var i = 0; i < n; i++) {
      var d = NV;
      for (var j = 1; j < NV; j++) {
        var z = 0;
        if (mech === 'mar') z = (cd.y[i * NV + j - 1] - mg.mu[j - 1]) / mg.sd[j - 1];
        else if (mech === 'mnar-y') z = (cd.y[i * NV + j] - mg.mu[j]) / mg.sd[j];
        else if (mech === 'mnar-slope') z = cd.b1[i] / Pm.tau1;
        var p = 1 / (1 + Math.exp(-(lh - gamma * z)));
        if (base.U[i * (NV - 1) + j - 1] < p) { d = j; break; }
      }
      D[i] = d;
    }
    return D;
  }

  function inv2(M) { var d = M[0] * M[3] - M[1] * M[2]; return [M[3] / d, -M[1] / d, -M[2] / d, M[0] / d]; }
  function mul2(A, B) { return [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3]]; }
  function mv2(A, v) { return [A[0] * v[0] + A[1] * v[1], A[2] * v[0] + A[3] * v[1]]; }
  function tr2(A, B) { return A[0] * B[0] + A[1] * B[2] + A[2] * B[1] + A[3] * B[3]; }
  function det2(A) { return A[0] * A[3] - A[1] * A[2]; }

  /* Sufficient statistics per dropout pattern (m = observed visits). With a common visit grid and
   * monotone dropout, everyone in a pattern shares Z'Z, so the likelihood needs only n, the sum of
   * Z'y, the sum of (Z'y)(Z'y)' and the sum of y'y in each pattern. */
  function aggregate(cd, D) {
    var pats = [], j;
    for (var m = 0; m <= NV; m++) {
      var st = 0, stt = 0;
      for (j = 0; j < m; j++) { st += T[j]; stt += T[j] * T[j]; }
      pats.push({ m: m, n: 0, s: [0, 0], S: [0, 0, 0, 0], Y: 0, Q: [m, st, st, stt] });
    }
    for (var i = 0; i < cd.n; i++) {
      var k = D[i], sy = 0, sty = 0, syy = 0;
      for (j = 0; j < k; j++) { var v = cd.y[i * NV + j]; sy += v; sty += T[j] * v; syy += v * v; }
      var p = pats[k];
      p.n++; p.s[0] += sy; p.s[1] += sty;
      p.S[0] += sy * sy; p.S[1] += sy * sty; p.S[2] += sy * sty; p.S[3] += sty * sty; p.Y += syy;
    }
    return pats.filter(function (q) { return q.n > 0 && q.m > 0; });
  }

  // D_k = sum_i (Z'r_i)(Z'r_i)' with r_i = y_i - X_i beta, from the aggregates.
  function devCross(p, beta) {
    var Qb = mv2(p.Q, beta);
    var off = p.S[1] - p.s[0] * Qb[1] - Qb[0] * p.s[1] + p.n * Qb[0] * Qb[1];
    return { Qb: Qb, D: [p.S[0] - 2 * p.s[0] * Qb[0] + p.n * Qb[0] * Qb[0], off, off, p.S[3] - 2 * p.s[1] * Qb[1] + p.n * Qb[1] * Qb[1]] };
  }
  function rss(p, beta, Qb) { return p.Y - 2 * (beta[0] * p.s[0] + beta[1] * p.s[1]) + p.n * (beta[0] * Qb[0] + beta[1] * Qb[1]); }

  /* Observed-data log-likelihood of the random-intercept-and-slope model. */
  function logLik(pats, beta, G, s2) {
    var Gi = inv2(G), ll = 0, ldG = Math.log(det2(G));
    for (var k = 0; k < pats.length; k++) {
      var p = pats[k], Q = p.Q;
      var A = [Q[0] / s2 + Gi[0], Q[1] / s2 + Gi[1], Q[2] / s2 + Gi[2], Q[3] / s2 + Gi[3]], C = inv2(A);
      var dc = devCross(p, beta);
      ll += -0.5 * (p.n * (p.m * Math.log(2 * Math.PI * s2) + ldG + Math.log(det2(A))) + (rss(p, beta, dc.Qb) - tr2(C, dc.D) / s2) / s2);
    }
    return ll;
  }

  function glsStep(pats, G, s2) {
    var Gi = inv2(G), M = [0, 0, 0, 0], v = [0, 0], Cs = [];
    for (var k = 0; k < pats.length; k++) {
      var p = pats[k], Q = p.Q;
      var A = [Q[0] / s2 + Gi[0], Q[1] / s2 + Gi[1], Q[2] / s2 + Gi[2], Q[3] / s2 + Gi[3]], C = inv2(A);
      Cs.push({ A: A, C: C });
      var QCQ = mul2(Q, mul2(C, Q));
      for (var q = 0; q < 4; q++) M[q] += p.n * (Q[q] - QCQ[q] / s2) / s2;
      var QCs = mv2(Q, mv2(C, p.s));
      v[0] += (p.s[0] - QCs[0] / s2) / s2; v[1] += (p.s[1] - QCs[1] / s2) / s2;
    }
    return { beta: mv2(inv2(M), v), Cs: Cs };
  }

  /* Maximum likelihood by ECME (Liu & Rubin 1994): beta by generalised least squares given the
   * variance components (this maximises the observed-data likelihood in beta), then one EM step
   * for G and sigma^2 (Laird & Ware 1982). No step can lower the likelihood. */
  function fitLMM(pats, opt) {
    opt = opt || {};
    var maxIter = opt.maxIter || 5000, tol = opt.tol || 1e-13;
    var N = 0, nobs = 0, XtX = [0, 0, 0, 0], Xty = [0, 0], k, p, q;
    for (k = 0; k < pats.length; k++) {
      p = pats[k]; N += p.n; nobs += p.n * p.m;
      for (q = 0; q < 4; q++) XtX[q] += p.n * p.Q[q];
      Xty[0] += p.s[0]; Xty[1] += p.s[1];
    }
    var beta = mv2(inv2(XtX), Xty), r0 = 0;
    for (k = 0; k < pats.length; k++) r0 += rss(pats[k], beta, mv2(pats[k].Q, beta));
    var v0 = r0 / nobs;
    var G = [0.5 * v0, 0, 0, 0.05 * v0], s2 = 0.5 * v0, ll = -Infinity, it, conv = false, trace = [];
    for (it = 1; it <= maxIter; it++) {
      var g = glsStep(pats, G, s2);
      beta = g.beta;
      var Gn = [0, 0, 0, 0], num = 0, llNew = 0, ldG = Math.log(det2(G));
      for (k = 0; k < pats.length; k++) {
        p = pats[k];
        var Q = p.Q, C = g.Cs[k].C, A = g.Cs[k].A, dc = devCross(p, beta);
        var CDC = mul2(C, mul2(dc.D, C));
        for (q = 0; q < 4; q++) Gn[q] += CDC[q] / (s2 * s2) + p.n * C[q];
        var rr = rss(p, beta, dc.Qb), trCD = tr2(C, dc.D);
        num += rr - 2 * trCD / s2 + tr2(mul2(C, mul2(Q, C)), dc.D) / (s2 * s2) + p.n * tr2(Q, C);
        llNew += -0.5 * (p.n * (p.m * Math.log(2 * Math.PI * s2) + ldG + Math.log(det2(A))) + (rr - trCD / s2) / s2);
      }
      if (opt.trace) trace.push(llNew);
      for (q = 0; q < 4; q++) Gn[q] /= N;
      // keep G positive definite (a guard; it does not bind in the settings offered here)
      Gn[0] = Math.max(Gn[0], 1e-10); Gn[3] = Math.max(Gn[3], 1e-10);
      var lim = 0.9999 * Math.sqrt(Gn[0] * Gn[3]);
      Gn[1] = Gn[2] = Math.max(-lim, Math.min(lim, Gn[1]));
      var done = Math.abs(llNew - ll) < tol * (1 + Math.abs(llNew));
      G = Gn; s2 = num / nobs; ll = llNew;
      if (done) { conv = true; break; }
    }
    beta = glsStep(pats, G, s2).beta;
    return { beta: beta, G: G, s2: s2, loglik: logLik(pats, beta, G, s2), iter: it, converged: conv, trace: trace };
  }

  function slopeOf(means) {                 // least-squares slope of the six visit means
    var mb = 0, j;
    for (j = 0; j < NV; j++) mb += means[j];
    mb /= NV;
    var num = 0, den = 0;
    for (j = 0; j < NV; j++) { num += (T[j] - 2.5) * (means[j] - mb); den += (T[j] - 2.5) * (T[j] - 2.5); }
    return num / den;
  }

  /* Per-visit means of the four kinds, plus yearly declines, for one data set and dropout pattern. */
  function summarise(cd, D) {
    var n = cd.n, truth = [], avail = [], compl = [], seen = [], nc = 0, j, i;
    for (j = 0; j < NV; j++) { truth.push(0); avail.push(0); compl.push(0); seen.push(0); }
    for (i = 0; i < n; i++) {
      var full = D[i] === NV;
      if (full) nc++;
      for (j = 0; j < NV; j++) {
        var v = cd.y[i * NV + j];
        truth[j] += v;
        if (j < D[i]) { avail[j] += v; seen[j]++; }
        if (full) compl[j] += v;
      }
    }
    for (j = 0; j < NV; j++) {
      truth[j] /= n;
      avail[j] = seen[j] ? avail[j] / seen[j] : NaN;
      compl[j] = nc ? compl[j] / nc : NaN;
    }
    var fit = fitLMM(aggregate(cd, D));
    var lmm = T.map(function (t) { return fit.beta[0] + fit.beta[1] * t; });
    return {
      truth: truth, avail: avail, compl: compl, lmm: lmm,
      seen: seen.map(function (c) { return c / n; }), completers: nc / n, fit: fit,
      slope: { truth: slopeOf(truth), compl: nc ? slopeOf(compl) : NaN, avail: slopeOf(avail), lmm: fit.beta[1] }
    };
  }

  /* One replicate for the repeated-sampling check: errors in the yearly decline for each mechanism. */
  function replicate(seed, n, h, gamma) {
    var base = drawBase(seed, n), cd = completeData(base, n, TRUE), out = {};
    MECHS.forEach(function (m) {
      var s = summarise(cd, dropout(cd, base, m, h, gamma, TRUE));
      out[m] = { compl: s.slope.compl - s.slope.truth, avail: s.slope.avail - s.slope.truth, lmm: s.slope.lmm - s.slope.truth };
    });
    return out;
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
    if (v !== v) return '\u2013';
    var str = v.toFixed(d);
    if (/^-0(\.0+)?$/.test(str)) str = str.slice(1);
    return str.replace('-', '\u2212');
  }
  function fmtS(v, d) { var f = fmt(v, d); return (v > 0 && f.replace(/[0.]/g, '') !== '' ? '+' : '') + f; }
  function pathFrom(xs, ys) {
    var d = '', pen = false;
    for (var i = 0; i < xs.length; i++) {
      if (ys[i] !== ys[i]) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + xs[i].toFixed(1) + ',' + ys[i].toFixed(1);
      pen = true;
    }
    return d;
  }

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
    '.R .P-field label,.R legend{font-size:13px;font-weight:600;color:var(--fg)}',
    '.R output,.R .P-num{font-variant-numeric:tabular-nums;color:var(--muted);font-size:13px}',
    '.R .P-hint{font-size:12px;color:var(--muted);margin:0}',
    '.R input[type=range]{width:100%;accent-color:var(--accent);margin:2px 0}',
    '.R input[type=range]:disabled{opacity:.45}',
    '.R fieldset{border:0;padding:0;margin:0;min-width:0;display:flex;flex-direction:column;gap:4px}',
    '.R legend{padding:0;margin-bottom:2px}',
    '.R .P-check{display:flex;align-items:flex-start;gap:6px;font-size:13px}',
    '.R .P-check input{accent-color:var(--accent);margin:3px 0 0}',
    '.R button{font:inherit;font-size:13px;color:var(--fg);background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:5px 9px;cursor:pointer;font-weight:600}',
    '.R button:hover{background:var(--tint)}',
    '.R .P-btnrow{display:flex;gap:6px;flex-wrap:wrap;align-items:center}',
    '.R .P-main{display:flex;flex-direction:column;gap:16px;min-width:0}',
    '.R .P-callout{font-family:var(--font-body);font-size:15px;background:var(--tint);border-left:3px solid var(--accent);border-radius:0 8px 8px 0;padding:10px 14px;margin:0}',
    '.R .P-callout p{margin:0 0 6px}',
    '.R .P-callout p:last-child{margin:0}',
    '.R .P-callout .P-num{color:var(--fg);font-family:var(--font-ui);font-size:14px}',
    '.R .P-link{background:none;border:0;padding:0;color:var(--accent);text-decoration:underline;font:inherit;cursor:pointer;font-weight:400}',
    '.R .P-link:hover{background:none}',
    '.R .P-pair{display:grid;gap:16px;grid-template-columns:minmax(0,1fr)}',
    '.R.P-xwide .P-pair{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}',
    '.R .P-card{background:var(--surface);border:1px solid var(--rule);border-radius:8px;padding:12px 14px;min-width:0}',
    '.R .P-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:2px 12px}',
    '.R .P-card h3{font-size:15px;margin:0;font-weight:600}',
    '.R .P-synth{font-size:12px;color:var(--muted)}',
    '.R .P-howto{font-size:13px;color:var(--muted);margin:4px 0 8px}',
    '.R .P-legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--muted);margin:0 0 8px;padding:0;list-style:none}',
    '.R .P-legend li{display:flex;align-items:center;gap:6px}',
    '.R .P-panels{display:grid;gap:10px;grid-template-columns:minmax(0,1fr)}',
    '.R.P-mid .P-panels{grid-template-columns:repeat(2,minmax(0,1fr))}',
    '.R.P-four .P-panels{grid-template-columns:repeat(4,minmax(0,1fr))}',
    '.R .P-panel{border:1px solid var(--rule);border-radius:6px;padding:6px 6px 2px;min-width:0}',
    '.R .P-panel.P-on{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}',
    '.R .P-panel>button{display:block;width:100%;text-align:left;border:0;background:none;padding:2px 4px;font-size:13px;font-weight:600}',
    '.R .P-panel>button:hover{background:var(--tint)}',
    '.R .P-panel .P-sub{display:block;font-weight:400;color:var(--muted);font-size:12px}',
    '.R .P-plot{position:relative;width:100%}',
    '.R .P-plot svg{display:block}',
    '.R .P-tip{position:absolute;pointer-events:none;background:var(--surface);color:var(--fg);border:1px solid var(--axis);border-radius:6px;padding:6px 9px;font-size:12px;line-height:1.4;z-index:3;white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.R .P-tip b{font-weight:600}',
    '.R .P-trow{display:flex;align-items:center;gap:6px}',
    '.R table{border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums}',
    '.R th,.R td{text-align:right;padding:3px 8px;border-bottom:1px solid var(--rule)}',
    '.R th:first-child,.R td:first-child{text-align:left}',
    '.R th{font-weight:600;color:var(--muted)}',
    '.R details{margin-top:8px;font-size:13px}',
    '.R summary{cursor:pointer;color:var(--muted)}',
    '.R .P-tablewrap{overflow:auto;margin-top:6px}',
    '.R .P-foot{font-size:12px;color:var(--muted);margin:4px 0 0}',
    '.R .P-status{font-size:12px;color:var(--muted);min-height:18px;display:flex;align-items:center;gap:8px}',
    '.R .P-status progress{width:120px;height:6px;accent-color:var(--accent)}',
    '.R .P-stale{opacity:.45}',
    /* SVG marks */
    '.R .P-grid line{stroke:var(--grid);stroke-width:1}',
    '.R .P-axis line{stroke:var(--axis);stroke-width:1}',
    '.R .P-tick{fill:var(--muted);font-family:var(--font-ui);font-size:12px;font-variant-numeric:tabular-nums}',
    '.R .P-axlab{fill:var(--muted);font-family:var(--font-ui);font-size:12px}',
    '.R .P-glab{fill:var(--fg);font-family:var(--font-ui);font-size:12px;font-weight:600}',
    '.R .P-rlab{fill:var(--fg);font-family:var(--font-ui);font-size:12px}',
    '.R .P-truth{stroke:var(--fg);stroke-width:2.5;fill:none;stroke-linejoin:round;stroke-linecap:round}',
    '.R .P-compl{stroke:var(--warn);stroke-width:2;fill:none;stroke-dasharray:7 4;stroke-linejoin:round}',
    '.R .P-avail{stroke:var(--muted);stroke-width:2;fill:none;stroke-dasharray:1.5 4;stroke-linecap:round;stroke-linejoin:round}',
    '.R .P-lmm{stroke:var(--accent);stroke-width:2.25;fill:none;stroke-linecap:round}',
    '.R .P-dot-compl{fill:var(--warn);stroke:var(--surface);stroke-width:1.5}',
    '.R .P-dot-avail{fill:var(--muted);stroke:var(--surface);stroke-width:1.5}',
    '.R .P-dot-lmm{fill:var(--accent);stroke:var(--surface);stroke-width:1.5}',
    '.R .P-dot-truth{fill:var(--fg);stroke:var(--surface);stroke-width:1.5}',
    '.R .P-cross{stroke:var(--axis);stroke-width:1}',
    '.R .P-sp-done{stroke:var(--warn);stroke-width:1.25;fill:none;opacity:.75}',
    '.R .P-sp-obs{stroke:var(--muted);stroke-width:1.25;fill:none}',
    '.R .P-sp-hid{stroke:var(--muted);stroke-width:1.1;fill:none;stroke-dasharray:1 3.5;stroke-linecap:round;opacity:.85}',
    '.R .P-sp-last{fill:var(--surface);stroke:var(--muted);stroke-width:1.5}',
    '.R .P-zero{stroke:var(--fg);stroke-width:1.5}',
    '.R .P-bar-compl{stroke:var(--warn);stroke-width:6;opacity:.35;stroke-linecap:round}',
    '.R .P-bar-avail{stroke:var(--muted);stroke-width:6;opacity:.35;stroke-linecap:round}',
    '.R .P-bar-lmm{stroke:var(--accent);stroke-width:6;opacity:.35;stroke-linecap:round}',
    '.R .P-rowhit{fill:transparent}',
    '.R .P-rowhit:hover{fill:var(--tint)}',
    '.R .P-hit{fill:transparent}',
    '.R .P-key-truth{stroke:var(--fg);stroke-width:2.5}',
    '.R .P-key-compl{stroke:var(--warn);stroke-width:2;stroke-dasharray:6 3}',
    '.R .P-key-avail{stroke:var(--muted);stroke-width:2;stroke-dasharray:1.5 3;stroke-linecap:round}',
    '.R .P-key-lmm{stroke:var(--accent);stroke-width:2.25}',
    '.R .P-key-done{stroke:var(--warn);stroke-width:1.5}',
    '.R .P-key-obs{stroke:var(--muted);stroke-width:1.5}',
    '.R .P-key-hid{stroke:var(--muted);stroke-width:1.5;stroke-dasharray:1 3;stroke-linecap:round}',
    '@media (prefers-reduced-motion:no-preference){.R .P-stale{transition:opacity .2s}}'
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
    var state = { seed: 20261110, n: 500, mech: 'mar', h: 0.15, gamma: 1.0 };
    var base = drawBase(state.seed, MAX_N);
    var res = null;            // per-mechanism summaries for the current sample
    var reps = null;           // repeated-sampling results
    var raf = 0, needFull = true, job = null, debounce = 0;

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
      'Simulated people decline on a cognitive score over six yearly visits, and some leave the study early. ',
      'Rubin (1976) sorts missing data by what drives it: nothing (MCAR), what we have already observed (MAR), or what we never get to see (MNAR) (guide ',
      link('10.2', '102-longitudinal-data-and-mixed-effects-models'),
      '). Change what drives dropout and watch which estimates of the mean trajectory stay honest.'
    ]));

    /* ---------- controls ---------- */
    var controls = h('form', { class: P + 'controls', 'aria-label': 'Simulation settings' });
    controls.addEventListener('submit', function (e) { e.preventDefault(); });

    function range(key, label, min, max, step, format) {
      var id = uid + key;
      var out = h('output', { id: id + '-out', for: id });
      var inp = h('input', { type: 'range', id: id, min: min, max: max, step: step, value: state[key] });
      function sync() { var v = +inp.value; out.textContent = format(v); inp.setAttribute('aria-valuetext', format(v)); }
      inp.addEventListener('input', function () { state[key] = +inp.value; sync(); onParams(); });
      sync();
      var wrap = h('div', { class: P + 'field' }, [h('div', { class: P + 'row' }, [h('label', { for: id, text: label }), out]), inp]);
      return { wrap: wrap, input: inp, sync: sync };
    }

    var rN = range('n', 'People', 100, MAX_N, 50, function (v) { return String(v); });
    controls.appendChild(rN.wrap);

    var mechSet = h('fieldset', {}, [h('legend', { text: 'What drives dropout' })]);
    var mechInputs = {};
    MECHS.forEach(function (m) {
      var id = uid + 'mech-' + m;
      var inp = h('input', { type: 'radio', name: uid + 'mech', id: id, value: m });
      inp.checked = state.mech === m;
      inp.addEventListener('change', function () { if (inp.checked) setMech(m); });
      mechInputs[m] = inp;
      mechSet.appendChild(h('div', { class: P + 'check' }, [inp, h('label', { for: id, text: MECH_LABEL[m] })]));
    });
    controls.appendChild(mechSet);

    var rH = range('h', 'Dropout per year (typical person)', 0.05, 0.3, 0.01, function (v) { return Math.round(v * 100) + '%'; });
    controls.appendChild(rH.wrap);
    var rG = range('gamma', 'Dependence', 0, 3, 0.1, function (v) {
      return 'odds \u00d7' + fmt(Math.exp(v), 1) + ' per SD';
    });
    rG.wrap.appendChild(h('p', { class: P + 'hint', text: 'How much the odds of leaving rise per standard deviation of worse score (or faster decline). Not used under MCAR.' }));
    controls.appendChild(rG.wrap);

    var newBtn = h('button', { type: 'button', id: uid + 'new', text: 'New sample' });
    newBtn.addEventListener('click', function () {
      state.seed = (Math.imul(state.seed, 1103515245) + 12345) >>> 1;
      base = drawBase(state.seed, MAX_N);
      onParams();
    });
    controls.appendChild(h('div', { class: P + 'btnrow' }, [newBtn]));

    /* ---------- main column ---------- */
    var main = h('div', { class: P + 'main' });
    var callout = h('div', { class: P + 'callout', 'aria-live': 'polite' });
    main.appendChild(callout);

    function legend(items) {
      return h('ul', { class: P + 'legend', 'aria-label': 'Legend' }, items.map(function (it) {
        var svg = s('svg', { width: 24, height: 10, 'aria-hidden': 'true' });
        s('line', { x1: 1, y1: 5, x2: 23, y2: 5, class: P + it[0] }, svg);
        return h('li', {}, [svg, h('span', { text: it[1] })]);
      }));
    }
    function cardShell(title, howto, legendItems) {
      var c = h('section', { class: P + 'card' }, [
        h('div', { class: P + 'head' }, [h('h3', { text: title }), h('span', { class: P + 'synth', text: 'Simulated data for illustration, not PPMI data' })]),
        h('p', { class: P + 'howto', text: 'How to read this: ' + howto }),
        legendItems ? legend(legendItems) : null
      ]);
      return c;
    }

    // Card A: mean trajectories (one panel, or small multiples for all four mechanisms)
    var cardA = cardShell('Mean score at each visit',
      'thick line: the true mean of all N people, hidden scores included; the others are what three analyses of the observed data report. A line above the truth makes the group look healthier than it is.',
      [['key-truth', 'Truth (all N, no dropout)'], ['key-compl', 'Completers only'], ['key-avail', 'All available at each visit'], ['key-lmm', 'Mixed model (MAR-valid)']]);
    var panelsWrap = h('div', { class: P + 'panels' });
    cardA.appendChild(panelsWrap);
    var tableA = h('table');
    cardA.appendChild(h('details', {}, [h('summary', { text: 'Table: means at each visit for the selected mechanism' }), h('div', { class: P + 'tablewrap' }, [tableA])]));
    main.appendChild(cardA);

    var panels = {};
    MECHS.forEach(function (m) {
      var btn = h('button', { type: 'button', id: uid + 'panel-' + m, 'aria-pressed': 'false' }, [MECH_LABEL[m]]);
      var sub = h('span', { class: P + 'sub' });
      btn.appendChild(sub);
      btn.addEventListener('click', function () { setMech(m); });
      var plot = h('div', { class: P + 'plot' });
      var tip = h('div', { class: P + 'tip', hidden: true });
      plot.appendChild(tip);
      var seenLine = h('p', { class: P + 'hint', style: 'margin:2px 4px 4px' });
      var pn = h('div', { class: P + 'panel' }, [btn, plot, seenLine]);
      panelsWrap.appendChild(pn);
      panels[m] = { el: pn, btn: btn, sub: sub, plot: plot, tip: tip, seen: seenLine };
    });

    var pair = h('div', { class: P + 'pair' });
    main.appendChild(pair);

    // Card B: what dropout hides
    var cardB = cardShell('What dropout hides',
      'forty people under the selected mechanism. Amber: completed every visit. Grey: left early, solid while observed and dotted for the scores they would have had. Under MAR and MNAR the hidden scores are mostly low.',
      [['key-done', 'Completed all visits'], ['key-obs', 'Left early: observed'], ['key-hid', 'Left early: hidden scores']]);
    var plotB = h('div', { class: P + 'plot' });
    cardB.appendChild(plotB);
    pair.appendChild(cardB);

    // Card C: repeated sampling
    var cardC = cardShell('Error over ' + REPS + ' repeated samples',
      'each bar spans 95% of the errors in the estimated yearly decline over ' + REPS + ' simulated studies with these settings; the dot is their average. Right of zero means a milder decline than the truth.',
      [['bar-compl', 'Completers only'], ['bar-avail', 'All available'], ['bar-lmm', 'Mixed model']]);
    var statusC = h('div', { class: P + 'status', 'aria-live': 'polite' });
    cardC.appendChild(statusC);
    var plotC = h('div', { class: P + 'plot' });
    var tipC = h('div', { class: P + 'tip', hidden: true });
    plotC.appendChild(tipC);
    cardC.appendChild(plotC);
    pair.appendChild(cardC);

    main.appendChild(h('p', { class: P + 'foot', text:
      'Complete data: score = (\u03b2\u2080 + b\u2080) + (\u03b2\u2081 + b\u2081)\u00b7t + noise at years 0 to 5, with \u03b2\u2081 = \u22120.25 per year, SD of baselines 0.8, SD of slopes 0.2, noise SD 0.4 (illustrative z-units). ' +
      'Before each follow-up a person still in the study leaves with probability logit\u207b\u00b9(logit h \u2212 \u03b3\u00b7z), where z is the standardised driver of dropout. ' +
      'Mixed model: random intercept and slope fitted by maximum likelihood (ECME algorithm: \u03b2 by generalised least squares, then EM steps for the variance components; Laird & Ware 1982, Liu & Rubin 1994) to every observed visit; its line is \u03b2\u0302\u2080 + \u03b2\u0302\u2081\u00b7t. ' +
      'Yearly decline for completers and all-available is the least-squares slope through their six visit means.' }));

    root.appendChild(h('div', { class: P + 'layout' }, [controls, main]));

    /* ---------- state ---------- */
    function setMech(m) {
      state.mech = m;
      mechInputs[m].checked = true;
      rG.input.disabled = m === 'mcar';
      needFull = true;
      schedule();
    }
    var dirty = true;
    function onParams() { dirty = true; needFull = true; schedule(); startReps(); }
    function recompute() {
      dirty = false;
      var cd = completeData(base, state.n, TRUE);
      res = {};
      MECHS.forEach(function (m) {
        var D = dropout(cd, base, m, state.h, state.gamma, TRUE);
        var sm = summarise(cd, D);
        sm.D = D;
        res[m] = sm;
      });
      res.cd = cd;
    }
    function schedule() {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; render(); });
    }

    /* ---------- repeated sampling, in slices so the page stays responsive ---------- */
    function startReps() {
      if (job) job.cancelled = true;
      if (debounce) clearTimeout(debounce);
      plotC.classList.add(P + 'stale');
      debounce = setTimeout(function () {
        debounce = 0;
        var j = { cancelled: false, k: 0, acc: {}, settings: { n: state.n, h: state.h, gamma: state.gamma, seed: state.seed } };
        MECHS.forEach(function (m) { j.acc[m] = { compl: [], avail: [], lmm: [] }; });
        job = j;
        statusC.textContent = '';
        var prog = h('progress', { max: REPS, value: 0 });
        var lab = h('span', { text: 'Running samples\u2026' });
        statusC.appendChild(prog); statusC.appendChild(lab);
        function slice() {
          if (j.cancelled) return;
          var t0 = performance.now();
          while (j.k < REPS && performance.now() - t0 < 12) {
            var r = replicate(j.settings.seed * 7919 + 101 * (j.k + 1), j.settings.n, j.settings.h, j.settings.gamma);
            MECHS.forEach(function (m) { j.acc[m].compl.push(r[m].compl); j.acc[m].avail.push(r[m].avail); j.acc[m].lmm.push(r[m].lmm); });
            j.k++;
          }
          prog.value = j.k;
          lab.textContent = 'Running sample ' + j.k + ' of ' + REPS;
          if (j.k < REPS) { j.timer = setTimeout(slice, 0); return; }
          reps = j.acc;
          job = null;
          clear(statusC);
          statusC.appendChild(h('span', { text: REPS + ' samples of ' + j.settings.n + ' people, dropout ' + Math.round(j.settings.h * 100) + '% per year, odds \u00d7' + fmt(Math.exp(j.settings.gamma), 1) + ' per SD.' }));
          plotC.classList.remove(P + 'stale');
          drawReps();
        }
        slice();
      }, 250);
    }

    /* ---------- card A panels ---------- */
    var yDom = null;
    function domainA() {
      var lo = Infinity, hi = -Infinity;
      MECHS.forEach(function (m) {
        ['truth', 'avail', 'compl', 'lmm'].forEach(function (k) {
          res[m][k].forEach(function (v) { if (v === v) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
        });
      });
      lo = Math.min(lo, -1.5); hi = Math.max(hi, 0.25);
      var st = niceStep(hi - lo, 5);
      return [Math.floor(lo / st) * st, Math.ceil(hi / st) * st];
    }
    function drawPanel(m, small) {
      var pn = panels[m], r = res[m];
      var W = Math.max(200, Math.floor(pn.plot.clientWidth));
      var H = small ? clamp(Math.round(W * 0.62), 170, 260) : clamp(Math.round(W * 0.5), 240, 380);
      var mg = { l: 52, r: 12, t: 8, b: 34 };
      var iw = W - mg.l - mg.r, ih = H - mg.t - mg.b;
      var lo = yDom[0], hi = yDom[1];
      var x = function (t) { return mg.l + (t / 5) * iw; };
      var y = function (v) { return mg.t + (1 - (v - lo) / (hi - lo)) * ih; };
      var old = pn.plot.querySelector('svg');
      var svg = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img',
        'aria-label': MECH_LABEL[m] + '. Yearly decline: truth ' + fmt(r.slope.truth, 2) + ', completers ' + fmt(r.slope.compl, 2) + ', all available ' + fmt(r.slope.avail, 2) + ', mixed model ' + fmt(r.slope.lmm, 2) + ' per year.' });
      var grid = s('g', { class: P + 'grid' }, svg);
      var tkA = ticks(lo, hi, small ? 4 : 5);
      tkA.forEach(function (v) {
        s('line', { x1: mg.l, x2: mg.l + iw, y1: y(v), y2: y(v) }, grid);
        s('text', { x: mg.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: P + 'tick', text: fmt(v, tkA.dec) }, svg);
      });
      var ax = s('g', { class: P + 'axis' }, svg);
      s('line', { x1: mg.l, x2: mg.l + iw, y1: mg.t + ih, y2: mg.t + ih }, ax);
      T.forEach(function (t) {
        s('line', { x1: x(t), x2: x(t), y1: mg.t + ih, y2: mg.t + ih + 4 }, ax);
        s('text', { x: x(t), y: mg.t + ih + 16, 'text-anchor': 'middle', class: P + 'tick', text: String(t) }, svg);
      });
      s('text', { x: mg.l + iw / 2, y: H - 3, 'text-anchor': 'middle', class: P + 'axlab', text: 'Years since baseline' }, svg);
      pn.seen.textContent = 'Still in the study at each visit: ' + r.seen.map(function (v) { return Math.round(100 * v) + '%'; }).join(' \u00b7 ');
      s('text', { x: 10, y: mg.t + ih / 2, 'text-anchor': 'middle', class: P + 'axlab', transform: 'rotate(-90 10 ' + (mg.t + ih / 2) + ')', text: 'Mean score (z)' }, svg);
      var xs = T.map(x);
      s('path', { d: pathFrom(xs, r.truth.map(y)), class: P + 'truth' }, svg);
      s('path', { d: pathFrom(xs, r.avail.map(y)), class: P + 'avail' }, svg);
      s('path', { d: pathFrom(xs, r.compl.map(y)), class: P + 'compl' }, svg);
      s('path', { d: pathFrom(xs, r.lmm.map(y)), class: P + 'lmm' }, svg);
      var rr = small ? 2.6 : 3.2;
      T.forEach(function (t, j) {
        if (r.avail[j] === r.avail[j]) s('circle', { cx: x(t), cy: y(r.avail[j]), r: rr, class: P + 'dot-avail' }, svg);
        if (r.compl[j] === r.compl[j]) s('circle', { cx: x(t), cy: y(r.compl[j]), r: rr, class: P + 'dot-compl' }, svg);
      });
      var cross = s('line', { x1: 0, x2: 0, y1: mg.t, y2: mg.t + ih, class: P + 'cross', visibility: 'hidden' }, svg);
      var hit = s('rect', { x: mg.l - 8, y: mg.t, width: iw + 16, height: ih, class: P + 'hit' }, svg);
      if (old) pn.plot.replaceChild(svg, old); else pn.plot.insertBefore(svg, pn.tip);
      hit.addEventListener('pointermove', function (e) {
        var rect = svg.getBoundingClientRect(), px = e.clientX - rect.left, py = e.clientY - rect.top;
        var j = clamp(Math.round(((px - mg.l) / iw) * 5), 0, 5);
        cross.setAttribute('x1', x(j)); cross.setAttribute('x2', x(j)); cross.setAttribute('visibility', 'visible');
        showTip(pn, r, j, x(j), py, W);
      });
      hit.addEventListener('pointerleave', function () { cross.setAttribute('visibility', 'hidden'); pn.tip.hidden = true; });
    }
    function showTip(pn, r, j, px, py, W) {
      var tip = pn.tip;
      clear(tip);
      tip.appendChild(h('div', {}, [h('b', { text: 'Year ' + j }), ' \u00b7 ' + Math.round(100 * r.seen[j]) + '% seen']));
      [['key-truth', r.truth[j], 'truth'], ['key-compl', r.compl[j], 'completers'], ['key-avail', r.avail[j], 'all available'], ['key-lmm', r.lmm[j], 'mixed model']].forEach(function (row) {
        var svg = s('svg', { width: 18, height: 8, 'aria-hidden': 'true' });
        s('line', { x1: 0, y1: 4, x2: 18, y2: 4, class: P + row[0] }, svg);
        tip.appendChild(h('div', { class: P + 'trow' }, [svg, h('b', { text: fmt(row[1], 2) }), h('span', { text: row[2] })]));
      });
      tip.hidden = false;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var left = px + 12; if (left + tw > W) left = px - tw - 12;
      tip.style.left = Math.max(0, left) + 'px';
      tip.style.top = clamp(py - th / 2, 0, 1e4) + 'px';
    }

    function drawPanels() {
      yDom = domainA();
      var multi = root.classList.contains(P + 'mid') || root.classList.contains(P + 'four');
      MECHS.forEach(function (m) {
        var pn = panels[m], on = m === state.mech;
        pn.el.hidden = !multi && !on;
        pn.el.classList.toggle(P + 'on', multi && on);
        pn.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        pn.sub.textContent = Math.round(100 * res[m].completers) + '% completed \u00b7 decline ' + fmt(res[m].slope.lmm, 2) + ' (mixed model) vs ' + fmt(res[m].slope.truth, 2) + ' (truth)';
        if (!pn.el.hidden) drawPanel(m, multi);
      });
      // table for the selected mechanism
      var r = res[state.mech];
      clear(tableA);
      tableA.appendChild(h('caption', { class: P + 'hint', text: MECH_LABEL[state.mech], style: 'text-align:left;caption-side:top;padding-bottom:4px' }));
      tableA.appendChild(h('thead', {}, [h('tr', {}, ['Year', 'Seen', 'Truth', 'Completers', 'All available', 'Mixed model'].map(function (c) { return h('th', { scope: 'col', text: c }); }))]));
      var tb = h('tbody');
      T.forEach(function (t, j) {
        tb.appendChild(h('tr', {}, [String(t), Math.round(100 * r.seen[j]) + '%', fmt(r.truth[j], 2), fmt(r.compl[j], 2), fmt(r.avail[j], 2), fmt(r.lmm[j], 2)].map(function (c) { return h('td', { text: c }); })));
      });
      tb.appendChild(h('tr', {}, ['Decline per year', '', fmt(r.slope.truth, 3), fmt(r.slope.compl, 3), fmt(r.slope.avail, 3), fmt(r.slope.lmm, 3)].map(function (c) { return h('td', { text: c }); })));
      tableA.appendChild(tb);
    }

    /* ---------- card B: spaghetti of 40 people ---------- */
    function drawHidden() {
      var r = res[state.mech], cd = res.cd, D = r.D, K = Math.min(40, state.n);
      var W = Math.max(240, Math.floor(plotB.clientWidth));
      var H = clamp(Math.round(W * 0.62), 220, 360);
      var mg = { l: 52, r: 10, t: 8, b: 34 };
      var iw = W - mg.l - mg.r, ih = H - mg.t - mg.b;
      var lo = Infinity, hi = -Infinity, i, j;
      for (i = 0; i < K; i++) for (j = 0; j < NV; j++) { var v = cd.y[i * NV + j]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      var st = niceStep(hi - lo, 5);
      lo = Math.floor(lo / st) * st; hi = Math.ceil(hi / st) * st;
      var x = function (t) { return mg.l + (t / 5) * iw; };
      var y = function (v2) { return mg.t + (1 - (v2 - lo) / (hi - lo)) * ih; };
      var old = plotB.querySelector('svg');
      var nLeft = 0;
      for (i = 0; i < K; i++) if (D[i] < NV) nLeft++;
      var svg = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img',
        'aria-label': 'Trajectories of ' + K + ' simulated people under ' + MECH_LABEL[state.mech] + '; ' + nLeft + ' of them left early.' });
      var grid = s('g', { class: P + 'grid' }, svg);
      var tkB = ticks(lo, hi, 5);
      tkB.forEach(function (v2) {
        s('line', { x1: mg.l, x2: mg.l + iw, y1: y(v2), y2: y(v2) }, grid);
        s('text', { x: mg.l - 6, y: y(v2) + 4, 'text-anchor': 'end', class: P + 'tick', text: fmt(v2, tkB.dec) }, svg);
      });
      var ax = s('g', { class: P + 'axis' }, svg);
      s('line', { x1: mg.l, x2: mg.l + iw, y1: mg.t + ih, y2: mg.t + ih }, ax);
      T.forEach(function (t) { s('text', { x: x(t), y: mg.t + ih + 16, 'text-anchor': 'middle', class: P + 'tick', text: String(t) }, svg); });
      s('text', { x: mg.l + iw / 2, y: H - 3, 'text-anchor': 'middle', class: P + 'axlab', text: 'Years since baseline' }, svg);
      s('text', { x: 10, y: mg.t + ih / 2, 'text-anchor': 'middle', class: P + 'axlab', transform: 'rotate(-90 10 ' + (mg.t + ih / 2) + ')', text: 'Score (z)' }, svg);
      var gDone = s('g', null, svg), gHid = s('g', null, svg), gObs = s('g', null, svg);
      for (i = 0; i < K; i++) {
        var xs = T.map(x), ys = [];
        for (j = 0; j < NV; j++) ys.push(y(cd.y[i * NV + j]));
        var d = D[i];
        if (d === NV) { s('path', { d: pathFrom(xs, ys), class: P + 'sp-done' }, gDone); continue; }
        s('path', { d: pathFrom(xs.slice(d - 1), ys.slice(d - 1)), class: P + 'sp-hid' }, gHid);
        if (d > 1) s('path', { d: pathFrom(xs.slice(0, d), ys.slice(0, d)), class: P + 'sp-obs' }, gObs);
        s('circle', { cx: xs[d - 1], cy: ys[d - 1], r: 2.8, class: P + 'sp-last' }, gObs);
      }
      if (old) plotB.replaceChild(svg, old); else plotB.appendChild(svg);
    }

    /* ---------- card C: repeated sampling ---------- */
    function quant(a, q) { var b = a.slice().sort(function (u, v) { return u - v; }); var pos = (b.length - 1) * q, lo = Math.floor(pos); return b[lo] + (b[Math.min(lo + 1, b.length - 1)] - b[lo]) * (pos - lo); }
    function mean(a) { var t = 0; for (var i = 0; i < a.length; i++) t += a[i]; return t / a.length; }
    function drawReps() {
      if (!reps) return;
      var W = Math.max(260, Math.floor(plotC.clientWidth));
      var labW = clamp(Math.round(W * 0.3), 96, 150);
      var rowH = 20, groupGap = 24, top = 6;
      var H = top + MECHS.length * (groupGap + 3 * rowH) + 34;
      var mg = { l: labW, r: 14 };
      var iw = W - mg.l - mg.r;
      var stats = {}, lo = 0, hi = 0;
      MECHS.forEach(function (m) {
        stats[m] = {};
        ['compl', 'avail', 'lmm'].forEach(function (k) {
          var a = reps[m][k].filter(function (v) { return v === v; });
          if (!a.length) { stats[m][k] = null; return; }
          var st = { mean: mean(a), q1: quant(a, 0.025), q2: quant(a, 0.975), n: a.length, of: reps[m][k].length };
          stats[m][k] = st;
          lo = Math.min(lo, st.q1); hi = Math.max(hi, st.q2);
        });
      });
      var span = Math.max(0.05, hi - lo);
      lo -= span * 0.06; hi += span * 0.06;
      var x = function (v) { return mg.l + ((v - lo) / (hi - lo)) * iw; };
      var old = plotC.querySelector('svg');
      var svg = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img',
        'aria-label': 'Average error in the estimated yearly decline by mechanism and analysis over ' + REPS + ' samples. Mixed model under MAR: ' + fmtS(stats.mar.lmm.mean, 3) + ' per year.' });
      var plotBottom = H - 30;
      var grid = s('g', { class: P + 'grid' }, svg);
      var tks = ticks(lo, hi, 5);
      tks.forEach(function (v) {
        s('line', { x1: x(v), x2: x(v), y1: top, y2: plotBottom }, grid);
        s('text', { x: x(v), y: plotBottom + 16, 'text-anchor': 'middle', class: P + 'tick', text: fmtS(v, tks.dec) }, svg);
      });
      s('text', { x: mg.l + iw / 2, y: H - 2, 'text-anchor': 'middle', class: P + 'axlab', text: 'Error in yearly decline (z per year)' }, svg);
      var rowsG = s('g', null, svg);
      s('line', { x1: x(0), x2: x(0), y1: top, y2: plotBottom, class: P + 'zero' }, svg);
      var yy = top;
      var names = { compl: 'Completers', avail: 'All available', lmm: 'Mixed model' };
      MECHS.forEach(function (m) {
        yy += groupGap;
        s('text', { x: 4, y: yy - 7, class: P + 'glab', text: MECH_LABEL[m] }, rowsG);
        ['compl', 'avail', 'lmm'].forEach(function (k) {
          var st = stats[m][k], cy = yy + rowH / 2;
          var hitR = s('rect', { x: 0, y: yy, width: W, height: rowH, class: P + 'rowhit' }, rowsG);
          s('text', { x: 14, y: cy + 4, class: P + 'rlab', text: names[k] }, rowsG);
          if (st) {
            s('line', { x1: x(st.q1), x2: x(st.q2), y1: cy, y2: cy, class: P + 'bar-' + k }, rowsG);
            s('circle', { cx: x(st.mean), cy: cy, r: 4.5, class: P + 'dot-' + k }, rowsG);
          }
          hitR.addEventListener('pointermove', function (e) {
            var rect = svg.getBoundingClientRect();
            clear(tipC);
            tipC.appendChild(h('div', {}, [h('b', { text: MECH_SHORT[m] + ', ' + names[k].toLowerCase() })]));
            if (st) {
              tipC.appendChild(h('div', { text: 'Average error ' + fmtS(st.mean, 3) + ' per year' }));
              tipC.appendChild(h('div', { text: '95% of samples between ' + fmtS(st.q1, 3) + ' and ' + fmtS(st.q2, 3) }));
              if (st.n < st.of) tipC.appendChild(h('div', { text: (st.of - st.n) + ' samples had no completers and are left out' }));
            } else tipC.appendChild(h('div', { text: 'No sample had any completers' }));
            tipC.hidden = false;
            var px = e.clientX - rect.left, tw = tipC.offsetWidth;
            tipC.style.left = clamp(px + 12 + tw > W ? px - tw - 12 : px + 12, 0, W) + 'px';
            tipC.style.top = (cy + 12) + 'px';
          });
          hitR.addEventListener('pointerleave', function () { tipC.hidden = true; });
          yy += rowH;
        });
      });
      if (old) plotC.replaceChild(svg, old); else plotC.insertBefore(svg, tipC);
    }

    /* ---------- callout ---------- */
    function renderText() {
      var m = state.mech, r = res[m];
      clear(callout);
      var lead = {
        'mcar': 'Dropout here depends on nothing (MCAR). Every analysis is unbiased; the completers are simply fewer, so their estimates are noisier.',
        'mar': 'People who scored low at their last visit are more likely to leave (MAR). Completers and the per-visit means look healthier than the truth. The mixed model uses every observed visit and the correlation within each person, so it recovers the true decline.',
        'mnar-y': 'People leave because of a low score at the very visit they miss, a score we never see (MNAR). Every analysis looks too healthy, including the mixed model: the observed data cannot reveal what was never measured.',
        'mnar-slope': 'People who are declining fastest leave early, before their own decline is clear in their few visits (MNAR). The mixed model reduces the bias but does not remove it.'
      }[m];
      if (m !== 'mcar' && state.gamma === 0) lead = 'With the dependence set to zero, dropout depends on nothing, so this behaves like MCAR.';
      callout.appendChild(h('p', { text: lead }));
      var p2 = h('p');
      p2.appendChild(document.createTextNode('Mean decline per year in this sample: truth '));
      p2.appendChild(h('span', { class: P + 'num', text: fmt(r.slope.truth, 2) }));
      p2.appendChild(document.createTextNode(', completers '));
      p2.appendChild(h('span', { class: P + 'num', text: fmt(r.slope.compl, 2) }));
      p2.appendChild(document.createTextNode(', all available '));
      p2.appendChild(h('span', { class: P + 'num', text: fmt(r.slope.avail, 2) }));
      p2.appendChild(document.createTextNode(', mixed model '));
      p2.appendChild(h('span', { class: P + 'num', text: fmt(r.slope.lmm, 2) }));
      p2.appendChild(document.createTextNode('. ' + Math.round(100 * r.completers) + '% completed all six visits.'));
      callout.appendChild(p2);
      var p3 = h('p');
      p3.appendChild(document.createTextNode('In PPMI, sicker participants are more likely to miss visits or withdraw (guide '));
      p3.appendChild(link('4.6', '46-properties-of-these-measures-that-matter-for-modelling'));
      p3.appendChild(document.createTextNode('), and dropout after decline is probably MNAR (guide '));
      p3.appendChild(link('10.2', '102-longitudinal-data-and-mixed-effects-models'));
      p3.appendChild(document.createTextNode('). Fit likelihood-based models, which are valid under MAR, and pre-register sensitivity analyses for MNAR, such as pattern-mixture models or a joint model of trajectories and dropout (Rizopoulos 2012).'));
      callout.appendChild(p3);
    }

    /* ---------- render ---------- */
    function render() {
      if (dirty) recompute();
      if (!res) return;
      if (needFull) {
        drawPanels(); drawHidden(); drawReps();
        needFull = false;
      }
      renderText();
    }

    var lastKey = '';
    function layoutClass() {
      var w = el.clientWidth || root.clientWidth;
      root.classList.toggle(P + 'wide', w >= 1100);
      root.classList.toggle(P + 'xwide', w >= 1200);
      var mainW = w >= 1100 ? w - 296 : w;
      root.classList.toggle(P + 'four', mainW >= 1150);
      root.classList.toggle(P + 'mid', w >= 760 && mainW < 1150);
    }
    var ro = new ResizeObserver(function () {
      layoutClass();
      var key = [el.clientWidth, plotB.clientWidth, plotC.clientWidth, panels.mcar.plot.clientWidth, panels[state.mech].plot.clientWidth].join(',');
      if (key !== lastKey) { lastKey = key; needFull = true; schedule(); }
    });
    ro.observe(el); ro.observe(plotB); ro.observe(plotC);
    MECHS.forEach(function (m) { ro.observe(panels[m].plot); });

    layoutClass();
    rG.input.disabled = state.mech === 'mcar';
    onParams();

    return {
      destroy: function () {
        ro.disconnect();
        if (raf) cancelAnimationFrame(raf);
        if (debounce) clearTimeout(debounce);
        if (job) { job.cancelled = true; if (job.timer) clearTimeout(job.timer); }
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  X[NAME] = {
    title: 'Dropout and missing data',
    blurb: 'Change what drives dropout (MCAR, MAR, MNAR) and see which estimates of decline stay honest.',
    mount: mount,
    _lib: {
      T: T, NV: NV, TRUE: TRUE, MECHS: MECHS, mulberry32: mulberry32, makeNormal: makeNormal, drawBase: drawBase,
      completeData: completeData, marginal: marginal, dropout: dropout, aggregate: aggregate, logLik: logLik,
      fitLMM: fitLMM, slopeOf: slopeOf, summarise: summarise, replicate: replicate
    }
  };
})();
