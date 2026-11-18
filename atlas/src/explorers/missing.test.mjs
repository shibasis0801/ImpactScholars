// Tests for explorers/missing.js. Run: node --test explorers/missing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const code = fs.readFileSync(new URL('./missing.js', import.meta.url), 'utf8');
// Run the module in the main realm (a vm sandbox makes global lookups such as Math far slower).
globalThis.window = globalThis.window || {};
(0, eval)(code);
const mod = globalThis.window.PPMIExplorers.missing;
const L = mod._lib;
const P = L.TRUE;

/* Brute-force observed-data log-likelihood: dense V_i = Z G Z' + s2 I per person, Cholesky. */
function chol(A) {
  const n = A.length, Lm = A.map(r => r.map(() => 0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = A[i][j];
    for (let k = 0; k < j; k++) s -= Lm[i][k] * Lm[j][k];
    Lm[i][j] = i === j ? Math.sqrt(s) : s / Lm[j][j];
  }
  return Lm;
}
function logLikBrute(cd, D, beta, G, s2) {
  let ll = 0;
  for (let i = 0; i < cd.n; i++) {
    const m = D[i], t = L.T.slice(0, m);
    const V = t.map((a, p) => t.map((b, q) => G[0] + G[1] * (a + b) + G[3] * a * b + (p === q ? s2 : 0)));
    const C = chol(V);
    const r = t.map((tt, j) => cd.y[i * 6 + j] - beta[0] - beta[1] * tt);
    const z = [];
    for (let p = 0; p < m; p++) { let s = r[p]; for (let k = 0; k < p; k++) s -= C[p][k] * z[k]; z.push(s / C[p][p]); }
    let ld = 0, q = 0;
    for (let p = 0; p < m; p++) { ld += 2 * Math.log(C[p][p]); q += z[p] * z[p]; }
    ll += -0.5 * (m * Math.log(2 * Math.PI) + ld + q);
  }
  return ll;
}
const meanSE = a => {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
  return { m, se: sd / Math.sqrt(a.length) };
};

test('module registers with the contract shape', () => {
  assert.equal(typeof mod.mount, 'function');
  assert.ok(mod.title.length <= 40);
});

test('log-likelihood from pattern aggregates equals the brute-force dense computation', () => {
  const base = L.drawBase(11, 300), cd = L.completeData(base, 300, P);
  for (const mech of L.MECHS) {
    const D = L.dropout(cd, base, mech, 0.2, 1.5, P);
    const pats = L.aggregate(cd, D);
    for (const [b, G, s2] of [[[0.1, -0.2], [0.5, 0.05, 0.05, 0.06], 0.2], [[-0.3, -0.4], [1.1, -0.1, -0.1, 0.09], 0.3]]) {
      const a = L.logLik(pats, b, G, s2), c = logLikBrute(cd, D, b, G, s2);
      assert.ok(Math.abs(a - c) < 1e-8 * Math.abs(c), `${mech}: ${a} vs ${c}`);
    }
  }
});

test('ECME fit never lowers the likelihood and stops at a stationary point (the ML estimate)', () => {
  const base = L.drawBase(12, 400), cd = L.completeData(base, 400, P);
  for (const mech of L.MECHS) {
    const D = L.dropout(cd, base, mech, 0.15, 1.5, P);
    const pats = L.aggregate(cd, D);
    const fit = L.fitLMM(pats, { trace: true, tol: 1e-15, maxIter: 100000 });
    assert.ok(fit.converged);
    for (let k = 1; k < fit.trace.length; k++) assert.ok(fit.trace[k] >= fit.trace[k - 1] - 1e-9, 'monotone');
    const th = [fit.beta[0], fit.beta[1], fit.G[0], fit.G[1], fit.G[3], fit.s2];
    const f = v => logLikBrute(cd, D, [v[0], v[1]], [v[2], v[3], v[3], v[4]], v[5]);
    const f0 = f(th);
    // no small move in any direction improves the brute-force likelihood
    for (let k = 0; k < th.length; k++) for (const e of [1e-3, -1e-3]) {
      const v = th.slice(); v[k] += e;
      assert.ok(f(v) <= f0 + 1e-6, `${mech}: parameter ${k} step ${e} improves likelihood`);
    }
  }
});

test('with no dropout the fit recovers the true parameters', () => {
  const n = 2000, base = L.drawBase(5, n), cd = L.completeData(base, n, P);
  const D = new Int8Array(n).fill(6);
  const fit = L.fitLMM(L.aggregate(cd, D));
  assert.ok(Math.abs(fit.beta[1] - P.beta1) < 0.015, 'slope');
  assert.ok(Math.abs(Math.sqrt(fit.G[0]) - P.tau0) < 0.04, 'SD of baselines');
  assert.ok(Math.abs(Math.sqrt(fit.G[3]) - P.tau1) < 0.015, 'SD of slopes');
  assert.ok(Math.abs(Math.sqrt(fit.s2) - P.sigma) < 0.015, 'noise SD');
});

test('dropout hazard equals h when the dependence is zero, and dropout is monotone', () => {
  const n = 20000, base = L.drawBase(3, n), cd = L.completeData(base, n, P);
  for (const mech of L.MECHS) {
    const D = L.dropout(cd, base, mech, 0.2, 0, P);
    let atRisk = n, left = 0;
    for (let j = 1; j < 6; j++) {
      let leaveNow = 0;
      for (let i = 0; i < n; i++) if (D[i] === j) leaveNow++;
      const hz = leaveNow / atRisk;
      assert.ok(Math.abs(hz - 0.2) < 0.015, `${mech} visit ${j}: hazard ${hz}`);
      atRisk -= leaveNow; left += leaveNow;
    }
  }
});

test('at the last visit, all-available equals completers (monotone dropout)', () => {
  const base = L.drawBase(8, 500), cd = L.completeData(base, 500, P);
  const s = L.summarise(cd, L.dropout(cd, base, 'mar', 0.15, 1.5, P));
  assert.ok(Math.abs(s.avail[5] - s.compl[5]) < 1e-12);
  assert.equal(s.seen[0], 1);
});

/* The core check: repeated simulation of the yearly decline. */
function repeated(mech, h, gamma, R = 300, N = 500) {
  const out = { lmm: [], compl: [], avail: [] };
  for (let r = 0; r < R; r++) {
    const base = L.drawBase(5000 + r, N), cd = L.completeData(base, N, P);
    const s = L.summarise(cd, L.dropout(cd, base, mech, h, gamma, P));
    out.lmm.push(s.slope.lmm - P.beta1);          // against the population slope
    out.compl.push(s.slope.compl - s.slope.truth);
    out.avail.push(s.slope.avail - s.slope.truth);
  }
  return { lmm: meanSE(out.lmm), compl: meanSE(out.compl), avail: meanSE(out.avail) };
}

test('MAR: the mixed model is unbiased for the decline; completers and available data are not', () => {
  for (const [h, g] of [[0.15, 1.0], [0.15, 1.5], [0.25, 3.0]]) {
    const r = repeated('mar', h, g);
    assert.ok(Math.abs(r.lmm.m) < 3 * r.lmm.se + 0.002, `MAR h=${h} g=${g}: mixed model bias ${r.lmm.m.toFixed(4)} (SE ${r.lmm.se.toFixed(4)})`);
    assert.ok(r.compl.m > 0.03 && r.compl.m > 8 * r.compl.se, `completers biased towards milder decline: ${r.compl.m.toFixed(3)}`);
    assert.ok(r.avail.m > 0.03 && r.avail.m > 8 * r.avail.se, `available biased towards milder decline: ${r.avail.m.toFixed(3)}`);
  }
});

test('MCAR: every estimate is unbiased', () => {
  const r = repeated('mcar', 0.2, 2.0);
  for (const k of ['lmm', 'compl', 'avail']) assert.ok(Math.abs(r[k].m) < 3 * r[k].se + 0.002, `${k}: ${r[k].m.toFixed(4)} (SE ${r[k].se.toFixed(4)})`);
});

test('MNAR: the mixed model stays biased towards a milder decline', () => {
  for (const mech of ['mnar-y', 'mnar-slope']) {
    const r = repeated(mech, 0.15, 1.5);
    assert.ok(r.lmm.m > 0.02 && r.lmm.m > 6 * r.lmm.se, `${mech}: mixed model bias ${r.lmm.m.toFixed(4)}`);
    assert.ok(r.compl.m > r.lmm.m, `${mech}: completers worse than the mixed model`);
  }
});

test('replicate() returns finite errors for every mechanism', () => {
  const r = L.replicate(42, 300, 0.15, 1);
  for (const m of L.MECHS) for (const k of ['compl', 'avail', 'lmm']) assert.ok(Number.isFinite(r[m][k]));
});
