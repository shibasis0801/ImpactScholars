/* PPMI Atlas explorer: cross-validation that does not leak.
 * Everything here is simulated. No PPMI data is used or loaded.
 * Demo A: people with stable person-specific features and outcomes, several visits each;
 *   k-nearest-neighbour regression; error from visit-level K-fold, participant-level K-fold,
 *   and the true error on brand-new people.
 * Demo B: pure-noise features and random labels; top-k feature selection by correlation and a
 *   nearest-centroid classifier; selection on all data versus tuning by CV versus nested CV.
 */
(function () {
  'use strict';
  var NAME = 'leakage';
  var P = NAME + '-';
  var X = (window.PPMIExplorers = window.PPMIExplorers || {});

  /* ------------------------------------------------------------------ */
  /* Pure statistics (exported as _lib for node tests)                    */
  /* ------------------------------------------------------------------ */

  var D_FEAT = 5, SIGNAL = 0.6, VISIT_NOISE = 0.5, N_NEW = 200, REPS_A = 20, REPS_B = 40;
  var GRID = [1, 2, 5, 10, 20, 50];

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
  function shuffle(a, rng) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function seq(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }

  /* ---------- Demo A ---------- */

  /* Person i has a feature signature s_i ~ N(0, I) and an outcome effect u_i ~ N(0, tau^2).
   * Visit features: x_ij = s_i + w * noise. Outcome: y_ij = 0.6 * s_i1 + u_i + 0.5 * noise.
   * Only 0.6 * s_i1 generalises to new people; u_i is specific to the person. */
  function genA(seed, people, visits, w, tau) {
    var nrm = makeNormal(mulberry32(seed));
    var n = people * visits, Xm = new Float64Array(n * D_FEAT), y = new Float64Array(n), pid = new Int32Array(n);
    var sgn = new Float64Array(D_FEAT);
    for (var i = 0; i < people; i++) {
      for (var f = 0; f < D_FEAT; f++) sgn[f] = nrm();
      var u = tau * nrm();
      for (var j = 0; j < visits; j++) {
        var r = i * visits + j;
        pid[r] = i;
        for (f = 0; f < D_FEAT; f++) Xm[r * D_FEAT + f] = sgn[f] + w * nrm();
        y[r] = SIGNAL * sgn[0] + u + VISIT_NOISE * nrm();
      }
    }
    return { n: n, people: people, visits: visits, X: Xm, y: y, pid: pid };
  }

  /* k-nearest-neighbour regression. Predicts each test row from the training rows; also returns
   * the share of each test row's neighbours that belong to the same person. */
  function knn(train, trainRows, test, testRows, k) {
    var kk = Math.min(k, trainRows.length);
    var bd = new Float64Array(kk), bi = new Int32Array(kk);
    var pred = new Float64Array(testRows.length), same = new Float64Array(testRows.length);
    for (var a = 0; a < testRows.length; a++) {
      var t = testRows[a], to = t * D_FEAT, cnt = 0;
      for (var b = 0; b < trainRows.length; b++) {
        var r = trainRows[b], ro = r * D_FEAT, d2 = 0;
        for (var f = 0; f < D_FEAT; f++) { var df = test.X[to + f] - train.X[ro + f]; d2 += df * df; }
        if (cnt < kk || d2 < bd[kk - 1]) {
          var pos = cnt < kk ? cnt++ : kk - 1;
          while (pos > 0 && bd[pos - 1] > d2) { bd[pos] = bd[pos - 1]; bi[pos] = bi[pos - 1]; pos--; }
          bd[pos] = d2; bi[pos] = r;
        }
      }
      var sy = 0, sm = 0;
      for (var q = 0; q < kk; q++) { sy += train.y[bi[q]]; if (train === test && train.pid[bi[q]] === test.pid[t]) sm++; }
      pred[a] = sy / kk; same[a] = sm / kk;
    }
    return { pred: pred, same: same };
  }

  /* Fold labels: 'visit' assigns visits to folds at random; 'person' assigns whole people. */
  function foldsA(data, K, scheme, rng) {
    var fold = new Int32Array(data.n), i;
    if (scheme === 'visit') {
      var perm = shuffle(seq(data.n), rng);
      for (i = 0; i < data.n; i++) fold[perm[i]] = i % K;
    } else {
      var pp = shuffle(seq(data.people), rng), pf = new Int32Array(data.people);
      for (i = 0; i < data.people; i++) pf[pp[i]] = i % K;
      for (i = 0; i < data.n; i++) fold[i] = pf[data.pid[i]];
    }
    return fold;
  }

  function cvA(data, k, K, fold) {
    var sse = 0, same = 0;
    for (var f = 0; f < K; f++) {
      var tr = [], te = [];
      for (var i = 0; i < data.n; i++) (fold[i] === f ? te : tr).push(i);
      if (!te.length || !tr.length) continue;
      var out = knn(data, tr, data, te, k);
      for (var a = 0; a < te.length; a++) { var e = data.y[te[a]] - out.pred[a]; sse += e * e; same += out.same[a]; }
    }
    return { rmse: Math.sqrt(sse / data.n), same: same / data.n };
  }

  function runA(seed, s) {
    var data = genA(seed, s.people, s.visits, s.w, s.tau);
    var rng = mulberry32(seed + 31);
    var fv = foldsA(data, s.K, 'visit', rng), fp = foldsA(data, s.K, 'person', rng);
    var v = cvA(data, s.k, s.K, fv), p = cvA(data, s.k, s.K, fp);
    var fresh = genA(seed + 7777, N_NEW, s.visits, s.w, s.tau);
    var out = knn(data, seq(data.n), fresh, seq(fresh.n), s.k);
    var ybar = 0, i;
    for (i = 0; i < data.n; i++) ybar += data.y[i];
    ybar /= data.n;
    var sse = 0, sse0 = 0;
    for (i = 0; i < fresh.n; i++) { var e = fresh.y[i] - out.pred[i], e0 = fresh.y[i] - ybar; sse += e * e; sse0 += e0 * e0; }
    return { visit: v.rmse, person: p.rmse, truth: Math.sqrt(sse / fresh.n), baseline: Math.sqrt(sse0 / fresh.n),
      sameVisit: v.same, samePerson: p.same, foldVisit: fv, foldPerson: fp };
  }

  /* ---------- Demo B ---------- */

  /* n participants in two equal groups with random labels; p pure-noise features (feature-major). */
  function genB(seed, n, p) {
    var nrm = makeNormal(mulberry32(seed)), rng = mulberry32(seed + 77);
    var Xm = new Float64Array(p * n);
    for (var q = 0; q < Xm.length; q++) Xm[q] = nrm();
    var lab = [];
    for (var i = 0; i < n; i++) lab.push(i < n / 2 ? 0 : 1);
    shuffle(lab, rng);
    var data = { n: n, p: p, X: Xm, y: Int8Array.from(lab) };
    data.tot = featureTotals(data);
    return data;
  }

  /* Features ranked by |difference in group means| / SD on the given rows: the same ranking as
   * |correlation| with the label. Returns the top `top` feature indices. */
  function rankFeatures(data, rows, top) {
    var n = data.n, p = data.p, score = new Float64Array(p), n1 = 0, i;
    for (i = 0; i < rows.length; i++) n1 += data.y[rows[i]];
    var n0 = rows.length - n1, nr = rows.length;
    for (var f = 0; f < p; f++) {
      var off = f * n, s0 = 0, s1 = 0, ss = 0;
      for (i = 0; i < nr; i++) { var r = rows[i], v = data.X[off + r]; if (data.y[r]) s1 += v; else s0 += v; ss += v * v; }
      var mean = (s0 + s1) / nr, vr = ss / nr - mean * mean;
      score[f] = vr > 0 ? Math.abs(s1 / n1 - s0 / n0) / Math.sqrt(vr) : 0;
    }
    var idx = seq(p);
    idx.sort(function (a, b) { return score[b] - score[a] || a - b; });
    return idx.slice(0, Math.min(top, p));
  }

  /* Fast equivalent of rankFeatures for "all rows except excl": per-feature sums over all rows are
   * computed once, the excluded rows are subtracted, and a small buffer keeps the top features. */
  function featureTotals(data) {
    var n = data.n, p = data.p, t = { s0: new Float64Array(p), s1: new Float64Array(p), ss: new Float64Array(p), n1: 0 };
    for (var i = 0; i < n; i++) t.n1 += data.y[i];
    for (var f = 0; f < p; f++) {
      var off = f * n, s0 = 0, s1 = 0, ss = 0;
      for (i = 0; i < n; i++) { var v = data.X[off + i]; if (data.y[i]) s1 += v; else s0 += v; ss += v * v; }
      t.s0[f] = s0; t.s1[f] = s1; t.ss[f] = ss;
    }
    return t;
  }
  function rankExcluding(data, tot, excl, top) {
    var n = data.n, p = data.p, n1 = tot.n1, i;
    for (i = 0; i < excl.length; i++) n1 -= data.y[excl[i]];
    var nr = n - excl.length, n0 = nr - n1, kk = Math.min(top, p);
    var bs = new Float64Array(kk), bi = new Int32Array(kk), cnt = 0;
    for (var f = 0; f < p; f++) {
      var off = f * n, s0 = tot.s0[f], s1 = tot.s1[f], ss = tot.ss[f];
      for (i = 0; i < excl.length; i++) { var r = excl[i], v = data.X[off + r]; if (data.y[r]) s1 -= v; else s0 -= v; ss -= v * v; }
      var mean = (s0 + s1) / nr, vr = ss / nr - mean * mean;
      var sc = vr > 0 ? Math.abs(s1 / n1 - s0 / n0) / Math.sqrt(vr) : 0;
      if (cnt < kk || sc > bs[kk - 1]) {
        var pos = cnt < kk ? cnt++ : kk - 1;
        while (pos > 0 && bs[pos - 1] < sc) { bs[pos] = bs[pos - 1]; bi[pos] = bi[pos - 1]; pos--; }
        bs[pos] = sc; bi[pos] = f;
      }
    }
    return Array.prototype.slice.call(bi, 0, cnt);
  }
  function complement(n, rows) {
    var inR = new Uint8Array(n), out = [];
    for (var i = 0; i < rows.length; i++) inR[rows[i]] = 1;
    for (i = 0; i < n; i++) if (!inR[i]) out.push(i);
    return out;
  }

  /* Nearest-centroid classifier on standardised features; standardisation and centroids are fitted
   * on the training rows only. Returns the number of correct test predictions. */
  function centroidCorrect(data, trainRows, testRows, feats) {
    var n = data.n, m = feats.length, mu = new Float64Array(m), sd = new Float64Array(m);
    var c0 = new Float64Array(m), c1 = new Float64Array(m), n1 = 0, i, j;
    for (i = 0; i < trainRows.length; i++) n1 += data.y[trainRows[i]];
    var n0 = trainRows.length - n1;
    for (j = 0; j < m; j++) {
      var off = feats[j] * n, s = 0, ss = 0, a0 = 0, a1 = 0;
      for (i = 0; i < trainRows.length; i++) { var r = trainRows[i], v = data.X[off + r]; s += v; ss += v * v; if (data.y[r]) a1 += v; else a0 += v; }
      mu[j] = s / trainRows.length;
      sd[j] = Math.sqrt(Math.max(ss / trainRows.length - mu[j] * mu[j], 1e-12));
      c0[j] = (a0 / n0 - mu[j]) / sd[j]; c1[j] = (a1 / n1 - mu[j]) / sd[j];
    }
    var correct = 0;
    for (i = 0; i < testRows.length; i++) {
      var t = testRows[i], d0 = 0, d1 = 0;
      for (j = 0; j < m; j++) {
        var z = (data.X[feats[j] * n + t] - mu[j]) / sd[j];
        d0 += (z - c0[j]) * (z - c0[j]); d1 += (z - c1[j]) * (z - c1[j]);
      }
      if ((d1 < d0 ? 1 : 0) === data.y[t]) correct++;
    }
    return correct;
  }

  /* Stratified K-fold labels for the given rows (classes spread evenly over folds). */
  function stratFolds(data, rows, K, rng) {
    var c0 = [], c1 = [], fold = {}, i;
    for (i = 0; i < rows.length; i++) (data.y[rows[i]] ? c1 : c0).push(rows[i]);
    shuffle(c0, rng); shuffle(c1, rng);
    var all = c0.concat(c1);
    for (i = 0; i < all.length; i++) fold[all[i]] = i % K;
    return fold;
  }
  function split(rows, fold, f) {
    var tr = [], te = [];
    for (var i = 0; i < rows.length; i++) (fold[rows[i]] === f ? te : tr).push(rows[i]);
    return { tr: tr, te: te };
  }
  function gridFor(p) { return GRID.filter(function (g) { return g <= p; }); }

  /* Leak 1: rank features on ALL rows, then cross-validate the classifier on the top k. */
  function leakySelection(data, k, K, rng) {
    var rows = seq(data.n), feats = rankExcluding(data, data.tot || featureTotals(data), [], k), fold = stratFolds(data, rows, K, rng), correct = 0;
    for (var f = 0; f < K; f++) { var sp = split(rows, fold, f); correct += centroidCorrect(data, sp.tr, sp.te, feats); }
    return correct / data.n;
  }

  /* CV accuracy for every k in the grid, with ranking done inside each training fold. */
  function cvByK(data, rows, K, rng, grid) {
    var fold = stratFolds(data, rows, K, rng), correct = grid.map(function () { return 0; });
    for (var f = 0; f < K; f++) {
      var sp = split(rows, fold, f), order = rankExcluding(data, data.tot || featureTotals(data), complement(data.n, sp.tr), grid[grid.length - 1]);
      for (var g = 0; g < grid.length; g++) correct[g] += centroidCorrect(data, sp.tr, sp.te, order.slice(0, grid[g]));
    }
    return correct.map(function (c) { return c / rows.length; });
  }

  /* Leak 2: selection is inside the folds, but k is chosen by CV and the best CV score reported. */
  function leakyTuning(data, K, rng) {
    var grid = gridFor(data.p), acc = cvByK(data, seq(data.n), K, rng, grid), best = 0;
    for (var g = 1; g < acc.length; g++) if (acc[g] > acc[best]) best = g;
    return { acc: acc[best], k: grid[best] };
  }

  /* Honest: nested CV. Inner CV on each outer training set picks k; selection, standardisation and
   * centroids are fitted on the outer training set; the outer test fold is touched once. */
  function nestedCV(data, K, rng) {
    var rows = seq(data.n), grid = gridFor(data.p), fold = stratFolds(data, rows, K, rng), correct = 0;
    for (var f = 0; f < K; f++) {
      var sp = split(rows, fold, f), inner = cvByK(data, sp.tr, K, rng, grid), best = 0;
      for (var g = 1; g < inner.length; g++) if (inner[g] > inner[best]) best = g;
      correct += centroidCorrect(data, sp.tr, sp.te, rankExcluding(data, data.tot || featureTotals(data), sp.te, grid[best]));
    }
    return correct / data.n;
  }

  /* Selection inside the folds with a fixed k (no tuning): also honest. */
  function insideSelection(data, k, K, rng) {
    var rows = seq(data.n), fold = stratFolds(data, rows, K, rng), correct = 0;
    for (var f = 0; f < K; f++) { var sp = split(rows, fold, f); correct += centroidCorrect(data, sp.tr, sp.te, rankExcluding(data, data.tot || featureTotals(data), sp.te, k)); }
    return correct / data.n;
  }

  function runB(seed, s) {
    var data = genB(seed, s.n, s.p), rng = mulberry32(seed + 5);
    var tune = leakyTuning(data, 5, rng);
    return { select: leakySelection(data, s.k, 5, rng), tune: tune.acc, tuneK: tune.k, nested: nestedCV(data, 5, rng) };
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
  function pct(v) { return Math.round(100 * v) + '%'; }
  function mean(a) { var t = 0; for (var i = 0; i < a.length; i++) t += a[i]; return t / a.length; }

  /* ------------------------------------------------------------------ */
  /* Style                                                               */
  /* ------------------------------------------------------------------ */

  var CSS = [
    '.R{font-family:var(--font-ui);color:var(--fg);font-size:14px;line-height:1.45}',
    '.R *{box-sizing:border-box}',
    '.R :focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '.R .P-intro{font-family:var(--font-body);font-size:15px;margin:0 0 14px;max-width:80ch}',
    '.R .P-demo{border:1px solid var(--rule);border-radius:10px;padding:14px;margin:0 0 18px;background:var(--surface)}',
    '.R .P-demo>h3{font-size:16px;margin:0 0 4px}',
    '.R .P-demo>.P-lede{font-family:var(--font-body);font-size:14.5px;margin:0 0 12px;max-width:80ch}',
    '.R .P-layout{display:flex;flex-direction:column;gap:16px}',
    '.R.P-wide .P-layout{display:grid;grid-template-columns:260px minmax(0,1fr);gap:22px;align-items:start}',
    '.R .P-controls{background:var(--surface-2);border-radius:8px;padding:14px;display:grid;gap:14px 18px;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));align-items:start}',
    '.R.P-wide .P-controls{grid-template-columns:1fr}',
    '.R .P-field{display:flex;flex-direction:column;gap:4px;min-width:0}',
    '.R .P-row{display:flex;justify-content:space-between;align-items:baseline;gap:8px}',
    '.R .P-field label{font-size:13px;font-weight:600;color:var(--fg)}',
    '.R output{font-variant-numeric:tabular-nums;color:var(--muted);font-size:13px}',
    '.R .P-hint{font-size:12px;color:var(--muted);margin:0}',
    '.R input[type=range]{width:100%;accent-color:var(--accent);margin:2px 0}',
    '.R select,.R button{font:inherit;font-size:13px;color:var(--fg);background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:5px 9px}',
    '.R button{cursor:pointer;font-weight:600}',
    '.R button:hover{background:var(--tint)}',
    '.R .P-btnrow{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
    '.R .P-main{display:flex;flex-direction:column;gap:14px;min-width:0}',
    '.R .P-callout{font-family:var(--font-body);font-size:15px;background:var(--tint);border-left:3px solid var(--accent);border-radius:0 8px 8px 0;padding:10px 14px;margin:0}',
    '.R .P-callout b{font-family:var(--font-ui);font-weight:600;font-variant-numeric:tabular-nums}',
    '.R .P-link{background:none;border:0;padding:0;color:var(--accent);text-decoration:underline;font:inherit;cursor:pointer;font-weight:400}',
    '.R .P-link:hover{background:none}',
    '.R .P-pair{display:grid;gap:14px;grid-template-columns:minmax(0,1fr)}',
    '.R.P-xwide .P-pair{grid-template-columns:minmax(0,0.8fr) minmax(0,1.2fr)}',
    '.R .P-card{border:1px solid var(--rule);border-radius:8px;padding:12px 14px;min-width:0;background:var(--surface)}',
    '.R .P-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:2px 12px}',
    '.R .P-card h4{font-size:14px;margin:0;font-weight:600}',
    '.R .P-synth{font-size:12px;color:var(--muted)}',
    '.R .P-howto{font-size:13px;color:var(--muted);margin:4px 0 8px}',
    '.R .P-legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--muted);margin:0 0 6px;padding:0;list-style:none}',
    '.R .P-legend li{display:flex;align-items:center;gap:6px}',
    '.R .P-plot{position:relative;width:100%}',
    '.R .P-plot svg{display:block}',
    '.R .P-tip{position:absolute;pointer-events:none;background:var(--surface);color:var(--fg);border:1px solid var(--axis);border-radius:6px;padding:6px 9px;font-size:12px;line-height:1.4;z-index:3;white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.R .P-status{font-size:12px;color:var(--muted);min-height:18px;display:flex;align-items:center;gap:8px}',
    '.R .P-status progress{width:120px;height:6px;accent-color:var(--accent)}',
    '.R .P-stale{opacity:.45}',
    '.R table{border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums}',
    '.R th,.R td{text-align:right;padding:3px 8px;border-bottom:1px solid var(--rule)}',
    '.R th:first-child,.R td:first-child{text-align:left}',
    '.R th{font-weight:600;color:var(--muted)}',
    '.R details{margin-top:8px;font-size:13px}',
    '.R summary{cursor:pointer;color:var(--muted)}',
    '.R .P-foot{font-size:12px;color:var(--muted);margin:6px 0 0}',
    '.R .P-grids{display:flex;flex-wrap:wrap;gap:12px 24px}',
    /* SVG */
    '.R .P-grid line{stroke:var(--grid);stroke-width:1}',
    '.R .P-tick{fill:var(--muted);font-family:var(--font-ui);font-size:12px;font-variant-numeric:tabular-nums}',
    '.R .P-axlab{fill:var(--muted);font-family:var(--font-ui);font-size:12px}',
    '.R .P-rlab{fill:var(--fg);font-family:var(--font-ui);font-size:12px}',
    '.R .P-vlab{fill:var(--fg);font-family:var(--font-ui);font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}',
    '.R .P-glab{fill:var(--fg);font-family:var(--font-ui);font-size:12px;font-weight:600}',
    '.R .P-cell{fill:var(--rule);stroke:var(--surface);stroke-width:2}',
    '.R .P-cell-test{fill:var(--accent);stroke:var(--surface);stroke-width:2}',
    '.R .P-dot-leak{fill:var(--warn);stroke:var(--surface);stroke-width:1.5;opacity:.85}',
    '.R .P-dot-leak2{fill:var(--muted);stroke:var(--surface);stroke-width:1.5;opacity:.85}',
    '.R .P-dot-ok{fill:var(--accent);stroke:var(--surface);stroke-width:1.5;opacity:.85}',
    '.R .P-dot-truth{fill:var(--fg);stroke:var(--surface);stroke-width:1.5;opacity:.85}',
    '.R .P-mean{stroke:var(--fg);stroke-width:2.5;stroke-linecap:round}',
    '.R .P-ref{stroke:var(--fg);stroke-width:1.5;stroke-dasharray:5 4}',
    '.R .P-rowhit{fill:transparent}',
    '.R .P-rowhit:hover{fill:var(--tint)}',
    '.R .P-key-leak{fill:var(--warn)}',
    '.R .P-key-leak2{fill:var(--muted)}',
    '.R .P-key-ok{fill:var(--accent)}',
    '.R .P-key-truth{fill:var(--fg)}',
    '.R .P-key-ref{stroke:var(--fg);stroke-width:1.5;stroke-dasharray:4 3}',
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
    var A = { seed: 20261110, people: 60, visits: 4, w: 0.25, tau: 1.0, k: 3, K: 5 };
    var B = { seed: 20261111, n: 50, p: 1000, k: 10 };
    var resA = null, resB = null, jobs = {}, timers = {}, raf = 0;

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
      'Cross-validation estimates how a model will do on people it has never seen. It only works if nothing about the test people reaches the training step. ',
      'Two leaks are common: splitting by visit instead of by participant, and choosing features or settings on all the data before cross-validating (guide ',
      link('10.5', '105-model-comparison-and-validation'), ', ', link('11.3', '113-validation-hygiene'), ').'
    ]));

    /* shared builders */
    function rangeField(obj, key, id, label, min, max, step, format, onChange) {
      var out = h('output', { id: id + '-out', for: id });
      var inp = h('input', { type: 'range', id: id, min: min, max: max, step: step, value: obj[key] });
      function sync() { var v = +inp.value; out.textContent = format(v); inp.setAttribute('aria-valuetext', format(v)); }
      inp.addEventListener('input', function () { obj[key] = +inp.value; sync(); onChange(); });
      sync();
      return h('div', { class: P + 'field' }, [h('div', { class: P + 'row' }, [h('label', { for: id, text: label }), out]), inp]);
    }
    function selectField(obj, key, id, label, options, onChange) {
      var sel = h('select', { id: id });
      options.forEach(function (o) { var op = h('option', { value: String(o[0]), text: o[1] }); if (o[0] === obj[key]) op.selected = true; sel.appendChild(op); });
      sel.addEventListener('change', function () { obj[key] = +sel.value; onChange(); });
      return h('div', { class: P + 'field' }, [h('label', { for: id, text: label }), sel]);
    }
    function card(title, howto, legendItems) {
      var plot = h('div', { class: P + 'plot' });
      var tip = h('div', { class: P + 'tip', hidden: true });
      plot.appendChild(tip);
      var c = h('section', { class: P + 'card' }, [
        h('div', { class: P + 'head' }, [h('h4', { text: title }), h('span', { class: P + 'synth', text: 'Simulated data for illustration, not PPMI data' })]),
        h('p', { class: P + 'howto', text: 'How to read this: ' + howto }),
        legendItems ? h('ul', { class: P + 'legend', 'aria-label': 'Legend' }, legendItems) : null,
        plot
      ]);
      return { card: c, plot: plot, tip: tip };
    }
    function dotKey(cls, label) {
      var svg = s('svg', { width: 12, height: 12, 'aria-hidden': 'true' });
      s('circle', { cx: 6, cy: 6, r: 4.5, class: P + cls }, svg);
      return h('li', {}, [svg, h('span', { text: label })]);
    }
    function lineKey(cls, label) {
      var svg = s('svg', { width: 22, height: 10, 'aria-hidden': 'true' });
      s('line', { x1: 1, y1: 5, x2: 21, y2: 5, class: P + cls }, svg);
      return h('li', {}, [svg, h('span', { text: label })]);
    }

    /* =================== Demo A =================== */
    var demoA = h('section', { class: P + 'demo', 'aria-label': 'Demo A: split by participant' }, [
      h('h3', { text: 'A. Split by participant, not by visit' }),
      h('p', { class: P + 'lede', text: 'Each simulated person has a stable signature in five features (think of head size or a personal test profile) and a personal level on the outcome that the features do not explain. A nearest-neighbour model predicts a visit\u2019s outcome from the most similar visits in the training set. If another visit by the same person is in training, it finds that one and copies the person\u2019s own level.' })
    ]);
    var ctlA = h('form', { class: P + 'controls', 'aria-label': 'Demo A settings' });
    ctlA.addEventListener('submit', function (e) { e.preventDefault(); });
    ctlA.appendChild(rangeField(A, 'people', uid + 'a-people', 'People', 20, 200, 10, String, function () { queue('A'); }));
    ctlA.appendChild(rangeField(A, 'visits', uid + 'a-visits', 'Visits per person', 2, 8, 1, String, function () { queue('A'); }));
    ctlA.appendChild(rangeField(A, 'w', uid + 'a-w', 'Feature change between visits (SD)', 0.05, 1, 0.05, function (v) { return fmt(v, 2); }, function () { queue('A'); }));
    ctlA.appendChild(rangeField(A, 'tau', uid + 'a-tau', 'Personal level on the outcome (SD)', 0, 1.5, 0.1, function (v) { return fmt(v, 1); }, function () { queue('A'); }));
    ctlA.appendChild(selectField(A, 'k', uid + 'a-k', 'Neighbours (k)', [[1, '1'], [3, '3'], [5, '5'], [10, '10'], [20, '20']], function () { queue('A'); }));
    ctlA.appendChild(selectField(A, 'K', uid + 'a-K', 'Folds', [[5, '5-fold'], [10, '10-fold']], function () { queue('A'); }));
    var newA = h('button', { type: 'button', id: uid + 'a-new', text: 'New sample' });
    newA.addEventListener('click', function () { A.seed = (Math.imul(A.seed, 1103515245) + 12345) >>> 1; queue('A', true); });
    ctlA.appendChild(h('div', { class: P + 'btnrow' }, [newA]));
    ctlA.appendChild(h('p', { class: P + 'hint', text: 'Between-person SD of each feature is 1. Each run repeats the whole study ' + REPS_A + ' times.' }));

    var mainA = h('div', { class: P + 'main' });
    var calloutA = h('p', { class: P + 'callout', 'aria-live': 'polite' });
    mainA.appendChild(calloutA);
    var pairA = h('div', { class: P + 'pair' });
    var cA1 = card('How the folds split the data', 'each row is a person, each square a visit (first eight people). Filled squares are the test set of one fold. Split by visit, a person sits on both sides of the split.', null);
    var cA2 = card('Estimated error versus the truth', 'each dot is one simulated study; the bar is the average over ' + REPS_A + ' studies. Lower is better. The dashed line is the error of always guessing the average outcome.',
      [dotKey('dot-leak', 'Visit-level CV'), dotKey('dot-ok', 'Participant-level CV'), dotKey('dot-truth', 'New people (truth)'), lineKey('key-ref', 'Guess the average')]);
    var statusA = h('div', { class: P + 'status', 'aria-live': 'polite' });
    cA2.card.insertBefore(statusA, cA2.plot);
    var tableA = h('table');
    cA2.card.appendChild(h('details', {}, [h('summary', { text: 'Table: errors over ' + REPS_A + ' studies' }), tableA]));
    pairA.appendChild(cA1.card); pairA.appendChild(cA2.card);
    mainA.appendChild(pairA);
    mainA.appendChild(h('p', { class: P + 'foot', text: 'Outcome = 0.6 \u00d7 feature 1 + personal level + visit noise (SD 0.5); only the first term carries over to new people. k-nearest-neighbour regression with Euclidean distance on the five features. True error: the model trained on all the data, tested on ' + N_NEW + ' new people.' }));
    var layA = h('div', { class: P + 'layout' }, [ctlA, mainA]);
    demoA.appendChild(layA);
    root.appendChild(demoA);

    /* =================== Demo B =================== */
    var demoB = h('section', { class: P + 'demo', 'aria-label': 'Demo B: select and tune inside the folds' }, [
      h('h3', { text: 'B. Choose features and settings inside the folds' }),
      h('p', { class: P + 'lede', text: 'Here the labels are coin flips and every feature is pure noise, so no model can beat 50% on new people. Pick the features that best separate the two groups using all the data, then cross-validate, and the noise you selected on looks like signal (Varma & Simon 2006; Cawley & Talbot 2010).' })
    ]);
    var ctlB = h('form', { class: P + 'controls', 'aria-label': 'Demo B settings' });
    ctlB.addEventListener('submit', function (e) { e.preventDefault(); });
    ctlB.appendChild(rangeField(B, 'n', uid + 'b-n', 'Participants (two equal groups)', 20, 200, 10, String, function () { queue('B'); }));
    ctlB.appendChild(selectField(B, 'p', uid + 'b-p', 'Noise features', [[100, '100'], [500, '500'], [1000, '1,000'], [2000, '2,000']], function () { queue('B'); }));
    ctlB.appendChild(selectField(B, 'k', uid + 'b-k', 'Features kept (select on all data)', [[1, '1'], [2, '2'], [5, '5'], [10, '10'], [20, '20'], [50, '50']], function () { queue('B'); }));
    var newB = h('button', { type: 'button', id: uid + 'b-new', text: 'New sample' });
    newB.addEventListener('click', function () { B.seed = (Math.imul(B.seed, 1103515245) + 12345) >>> 1; queue('B', true); });
    ctlB.appendChild(h('div', { class: P + 'btnrow' }, [newB]));
    ctlB.appendChild(h('p', { class: P + 'hint', text: '5-fold stratified CV, nearest-centroid classifier. Tuning chooses the number of features from 1, 2, 5, 10, 20 and 50. Each run repeats the whole study ' + REPS_B + ' times.' }));

    var mainB = h('div', { class: P + 'main' });
    var calloutB = h('p', { class: P + 'callout', 'aria-live': 'polite' });
    mainB.appendChild(calloutB);
    var cB = card('Cross-validated accuracy on pure noise', 'each dot is one simulated study; the bar is the average over ' + REPS_B + '. The dashed line at 50% is the truth for any model on new people.',
      [dotKey('dot-leak', 'Select on all data, then CV'), dotKey('dot-leak2', 'Tune by CV, report best score'), dotKey('dot-ok', 'Nested CV'), lineKey('key-ref', 'Chance: the truth')]);
    var statusB = h('div', { class: P + 'status', 'aria-live': 'polite' });
    cB.card.insertBefore(statusB, cB.plot);
    var tableB = h('table');
    cB.card.appendChild(h('details', {}, [h('summary', { text: 'Table: accuracy over ' + REPS_B + ' studies' }), tableB]));
    mainB.appendChild(cB.card);
    mainB.appendChild(h('p', { class: P + 'foot', text: 'Nested CV: an inner 5-fold CV inside each outer training set picks the number of features; ranking, standardisation and centroids are fitted on the outer training set only, and the outer test fold is used once. Features are ranked by the gap between group means over the SD, the same order as their correlation with the label.' }));
    demoB.appendChild(h('div', { class: P + 'layout' }, [ctlB, mainB]));
    root.appendChild(demoB);

    /* =================== running the simulations =================== */
    function queue(which, now) {
      if (jobs[which]) jobs[which].cancelled = true;
      if (timers[which]) clearTimeout(timers[which]);
      (which === 'A' ? cA2.plot : cB.plot).classList.add(P + 'stale');
      timers[which] = setTimeout(function () { timers[which] = 0; start(which); }, now ? 0 : 220);
    }
    function start(which) {
      var isA = which === 'A', reps = isA ? REPS_A : REPS_B, st = isA ? A : B, status = isA ? statusA : statusB;
      var snap = JSON.parse(JSON.stringify(st));
      var job = { cancelled: false, k: 0, out: [] };
      jobs[which] = job;
      clear(status);
      var prog = h('progress', { max: reps, value: 0 }), lab = h('span', { text: 'Running\u2026' });
      status.appendChild(prog); status.appendChild(lab);
      function slice() {
        if (job.cancelled) return;
        var t0 = performance.now();
        while (job.k < reps && performance.now() - t0 < 14) {
          job.out.push(isA ? runA(snap.seed + 1009 * job.k, snap) : runB(snap.seed + 1009 * job.k, snap));
          job.k++;
        }
        prog.value = job.k;
        lab.textContent = 'Study ' + job.k + ' of ' + reps;
        if (job.k < reps) { job.timer = setTimeout(slice, 0); return; }
        jobs[which] = null;
        clear(status);
        status.appendChild(h('span', { text: reps + ' simulated studies.' }));
        if (isA) { resA = { runs: job.out, s: snap }; } else { resB = { runs: job.out, s: snap }; }
        (isA ? cA2.plot : cB.plot).classList.remove(P + 'stale');
        schedule();
      }
      slice();
    }
    function schedule() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; render(); }); }

    /* =================== drawing =================== */
    function stripChart(c, rows, opt) {
      // rows: [{label, cls, vals:[], fmt}], opt: {lo, hi, ref, refLabel, axisLabel, tickFmt}
      var W = Math.max(260, Math.floor(c.plot.clientWidth));
      var labW = clamp(Math.round(W * 0.3), 110, 190);
      var rowH = 40, top = 8, H = top + rows.length * rowH + 40;
      var mg = { l: labW, r: 16 };
      var iw = W - mg.l - mg.r;
      var x = function (v) { return mg.l + ((v - opt.lo) / (opt.hi - opt.lo)) * iw; };
      var old = c.plot.querySelector('svg');
      var svg = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opt.aria });
      var grid = s('g', { class: P + 'grid' }, svg);
      var bottom = top + rows.length * rowH;
      var tk = ticks(opt.lo, opt.hi, 5);
      tk.forEach(function (v) {
        s('line', { x1: x(v), x2: x(v), y1: top, y2: bottom }, grid);
        s('text', { x: x(v), y: bottom + 16, 'text-anchor': 'middle', class: P + 'tick', text: opt.tickFmt(v, tk.dec) }, svg);
      });
      s('text', { x: mg.l + iw / 2, y: H - 4, 'text-anchor': 'middle', class: P + 'axlab', text: opt.axisLabel }, svg);
      if (opt.ref != null) s('line', { x1: x(opt.ref), x2: x(opt.ref), y1: top - 4, y2: bottom, class: P + 'ref' }, svg);
      rows.forEach(function (r, i) {
        var y0 = top + i * rowH, cy = y0 + rowH / 2;
        var hit = s('rect', { x: 0, y: y0, width: W, height: rowH, class: P + 'rowhit' }, svg);
        var words = r.label.split('\n');
        words.forEach(function (wd, k) { s('text', { x: 4, y: cy + 4 + (k - (words.length - 1) / 2) * 14, class: P + 'rlab', text: wd }, svg); });
        r.vals.forEach(function (v, k) {
          var jit = ((k * 0.618034) % 1 - 0.5) * (rowH - 18);
          s('circle', { cx: x(v), cy: cy + jit, r: 4, class: P + r.cls }, svg);
        });
        var m = mean(r.vals), vmax = Math.max.apply(null, r.vals), vmin = Math.min.apply(null, r.vals);
        s('line', { x1: x(m), x2: x(m), y1: cy - rowH / 2 + 5, y2: cy + rowH / 2 - 5, class: P + 'mean' }, svg);
        // the average sits beside the dot cloud, so it never covers a dot
        var lx = x(vmax) + 9, anchor = 'start';
        var ly = cy + 4;
        if (lx > mg.l + iw - 34) { lx = x(vmin) - 9; anchor = 'end'; }
        if (anchor === 'end' && lx - 54 < mg.l) { lx = x(m) + 6; anchor = 'start'; ly = y0 + 11; }   // very wide spread: label on top
        s('text', { x: lx, y: ly, 'text-anchor': anchor, class: P + 'vlab', text: 'avg ' + r.fmt(m) }, svg);
        hit.addEventListener('pointermove', function (e) {
          var rect = svg.getBoundingClientRect();
          clear(c.tip);
          var mn = Math.min.apply(null, r.vals), mx = Math.max.apply(null, r.vals);
          c.tip.appendChild(h('div', {}, [h('b', { text: r.label.replace('\n', ' ') })]));
          c.tip.appendChild(h('div', { text: 'Average ' + r.fmt(m) + '; range ' + r.fmt(mn) + ' to ' + r.fmt(mx) }));
          c.tip.hidden = false;
          var px = e.clientX - rect.left, tw = c.tip.offsetWidth;
          c.tip.style.left = clamp(px + 12 + tw > W ? px - tw - 12 : px + 12, 0, W) + 'px';
          c.tip.style.top = (y0 + rowH) + 'px';
        });
        hit.addEventListener('pointerleave', function () { c.tip.hidden = true; });
      });
      if (old) c.plot.replaceChild(svg, old); else c.plot.insertBefore(svg, c.tip);
    }

    function drawSplitGrids() {
      var plot = cA1.plot;
      var old = plot.querySelector('.' + P + 'grids');
      var wrap = h('div', { class: P + 'grids' });
      var first = resA.runs[0], V = resA.s.visits, nP = Math.min(8, resA.s.people);
      var W = Math.max(240, Math.floor(plot.clientWidth));
      var gW = clamp(Math.floor((W - 25) / 2), 140, 320);   // two grids side by side when they fit
      var cell = clamp(Math.floor((gW - 68) / V), 9, 24);
      [['Split by visit', first.foldVisit], ['Split by participant', first.foldPerson]].forEach(function (g) {
        var svgW = 64 + V * cell + 4, svgH = 22 + nP * cell + 4;
        var svg = s('svg', { width: svgW, height: svgH, role: 'img', 'aria-label': g[0] + ': test-set visits of fold 1 for the first ' + nP + ' people.' });
        s('text', { x: 0, y: 13, class: P + 'glab', text: g[0] }, svg);
        for (var i = 0; i < nP; i++) {
          s('text', { x: 0, y: 22 + i * cell + cell / 2 + 4, class: P + 'tick', text: 'Person ' + (i + 1) }, svg);
          for (var j = 0; j < V; j++) {
            var r = i * V + j;
            s('rect', { x: 64 + j * cell, y: 22 + i * cell, width: cell, height: cell, rx: 2, class: P + (g[1][r] === 0 ? 'cell-test' : 'cell') }, svg);
          }
        }
        wrap.appendChild(svg);
      });
      var legend = h('ul', { class: P + 'legend', style: 'margin-top:8px' }, [
        (function () { var sv = s('svg', { width: 12, height: 12, 'aria-hidden': 'true' }); s('rect', { x: 1, y: 1, width: 10, height: 10, rx: 2, class: P + 'cell-test' }, sv); return h('li', {}, [sv, h('span', { text: 'Test set (fold 1)' })]); })(),
        (function () { var sv = s('svg', { width: 12, height: 12, 'aria-hidden': 'true' }); s('rect', { x: 1, y: 1, width: 10, height: 10, rx: 2, class: P + 'cell' }, sv); return h('li', {}, [sv, h('span', { text: 'Training set' })]); })()
      ]);
      var box = h('div', { class: P + 'grids-box' }, [wrap, legend]);
      if (old) plot.replaceChild(box, old.parentNode); else plot.insertBefore(box, cA1.tip);
    }

    function renderA() {
      if (!resA) return;
      var runs = resA.runs;
      var vis = runs.map(function (r) { return r.visit; }), per = runs.map(function (r) { return r.person; }),
        tru = runs.map(function (r) { return r.truth; }), bas = runs.map(function (r) { return r.baseline; });
      var all = vis.concat(per, tru, bas), lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
      var pad = (hi - lo) * 0.08 + 0.02;
      lo = Math.max(0, lo - pad); hi += pad;
      var f2 = function (v) { return fmt(v, 2); };
      var mB = mean(bas), mV = mean(vis), mP = mean(per), mT = mean(tru);
      stripChart(cA2, [
        { label: 'Visit-level CV', cls: 'dot-leak', vals: vis, fmt: f2 },
        { label: 'Participant-level CV', cls: 'dot-ok', vals: per, fmt: f2 },
        { label: 'New people (truth)', cls: 'dot-truth', vals: tru, fmt: f2 }
      ], { lo: lo, hi: hi, ref: mB, axisLabel: 'Prediction error (root mean square, outcome SD units)', tickFmt: function (v, dec) { return fmt(v, dec); },
        aria: 'Average prediction error: visit-level CV ' + f2(mV) + ', participant-level CV ' + f2(mP) + ', new people ' + f2(mT) + ', guessing the average ' + f2(mB) + '.' });
      drawSplitGrids();
      clear(calloutA);
      var same = mean(runs.map(function (r) { return r.sameVisit; }));
      calloutA.appendChild(document.createTextNode('Visit-level cross-validation reports an error of '));
      calloutA.appendChild(h('b', { text: f2(mV) }));
      calloutA.appendChild(document.createTextNode('; participant-level reports '));
      calloutA.appendChild(h('b', { text: f2(mP) }));
      calloutA.appendChild(document.createTextNode('. On new people the model\u2019s error is '));
      calloutA.appendChild(h('b', { text: f2(mT) }));
      calloutA.appendChild(document.createTextNode(mT > mB ? ', worse than just guessing the average (' : ', against ' ));
      calloutA.appendChild(h('b', { text: f2(mB) }));
      calloutA.appendChild(document.createTextNode(mT > mB ? '). ' : ' for guessing the average. '));
      calloutA.appendChild(document.createTextNode('With visit-level folds, ' + pct(same) + ' of the neighbours the model used were the same person\u2019s other visits. Split folds by participant, never by visit (guide 10.5).'));
      clear(tableA);
      tableA.appendChild(h('thead', {}, [h('tr', {}, ['Error estimate', 'Average', 'Lowest', 'Highest'].map(function (c) { return h('th', { scope: 'col', text: c }); }))]));
      var tb = h('tbody');
      [['Visit-level CV', vis], ['Participant-level CV', per], ['New people (truth)', tru], ['Guess the average', bas]].forEach(function (r) {
        tb.appendChild(h('tr', {}, [r[0], f2(mean(r[1])), f2(Math.min.apply(null, r[1])), f2(Math.max.apply(null, r[1]))].map(function (c) { return h('td', { text: c }); })));
      });
      tableA.appendChild(tb);
    }

    function renderB() {
      if (!resB) return;
      var runs = resB.runs;
      var sel = runs.map(function (r) { return r.select; }), tun = runs.map(function (r) { return r.tune; }), nes = runs.map(function (r) { return r.nested; });
      stripChart(cB, [
        { label: 'Select on all data,\nthen CV', cls: 'dot-leak', vals: sel, fmt: pct },
        { label: 'Tune by CV,\nreport best score', cls: 'dot-leak2', vals: tun, fmt: pct },
        { label: 'Nested CV', cls: 'dot-ok', vals: nes, fmt: pct }
      ], { lo: 0.2, hi: 1, ref: 0.5, axisLabel: 'Cross-validated accuracy', tickFmt: pct,
        aria: 'Average accuracy on pure noise: select on all data ' + pct(mean(sel)) + ', tune and report best ' + pct(mean(tun)) + ', nested CV ' + pct(mean(nes)) + '. Chance is 50%.' });
      clear(calloutB);
      calloutB.appendChild(document.createTextNode('On pure noise, selecting ' + resB.s.k + ' feature' + (resB.s.k > 1 ? 's' : '') + ' on all the data and then cross-validating reports '));
      calloutB.appendChild(h('b', { text: pct(mean(sel)) }));
      calloutB.appendChild(document.createTextNode(' accuracy. Selecting inside the folds but tuning the number of features by CV and reporting the best score gives '));
      calloutB.appendChild(h('b', { text: pct(mean(tun)) }));
      calloutB.appendChild(document.createTextNode('. Nested CV gives '));
      calloutB.appendChild(h('b', { text: pct(mean(nes)) }));
      calloutB.appendChild(document.createTextNode(', the honest answer: the labels are coin flips. Fit every choice, including norms, scaling, imputation, feature selection and tuning, inside the training folds (guide 6.4, 11.3).'));
      clear(tableB);
      tableB.appendChild(h('thead', {}, [h('tr', {}, ['Procedure', 'Average', 'Lowest', 'Highest'].map(function (c) { return h('th', { scope: 'col', text: c }); }))]));
      var tb = h('tbody');
      [['Select on all data, then CV', sel], ['Tune by CV, report best score', tun], ['Nested CV', nes]].forEach(function (r) {
        tb.appendChild(h('tr', {}, [r[0], pct(mean(r[1])), pct(Math.min.apply(null, r[1])), pct(Math.max.apply(null, r[1]))].map(function (c) { return h('td', { text: c }); })));
      });
      tableB.appendChild(tb);
    }

    function render() { renderA(); renderB(); }

    var lastKey = '';
    function layoutClass() {
      var w = el.clientWidth || root.clientWidth;
      root.classList.toggle(P + 'wide', w >= 1100);
      root.classList.toggle(P + 'xwide', w >= 1250);
    }
    var ro = new ResizeObserver(function () {
      layoutClass();
      var key = [el.clientWidth, cA1.plot.clientWidth, cA2.plot.clientWidth, cB.plot.clientWidth].join(',');
      if (key !== lastKey) { lastKey = key; schedule(); }
    });
    ro.observe(el); ro.observe(cA1.plot); ro.observe(cA2.plot); ro.observe(cB.plot);
    layoutClass();
    queue('A', true);
    queue('B', true);

    return {
      destroy: function () {
        ro.disconnect();
        if (raf) cancelAnimationFrame(raf);
        ['A', 'B'].forEach(function (w) {
          if (timers[w]) clearTimeout(timers[w]);
          if (jobs[w]) { jobs[w].cancelled = true; if (jobs[w].timer) clearTimeout(jobs[w].timer); }
        });
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  X[NAME] = {
    title: 'Cross-validation that does not leak',
    blurb: 'See how splitting by visit, or selecting features on all the data, makes a model look far better than it is.',
    mount: mount,
    _lib: {
      mulberry32: mulberry32, makeNormal: makeNormal, genA: genA, knn: knn, foldsA: foldsA, cvA: cvA, runA: runA,
      genB: genB, rankFeatures: rankFeatures, rankExcluding: rankExcluding, featureTotals: featureTotals, complement: complement,
      centroidCorrect: centroidCorrect, stratFolds: stratFolds,
      leakySelection: leakySelection, leakyTuning: leakyTuning, nestedCV: nestedCV, insideSelection: insideSelection, runB: runB,
      D_FEAT: D_FEAT, GRID: GRID
    }
  };
})();
