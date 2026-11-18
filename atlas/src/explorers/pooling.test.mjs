// Tests for explorers/pooling.js. Run: node --test explorers/pooling.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const code = fs.readFileSync(new URL('./pooling.js', import.meta.url), 'utf8');
// Run the module in the main realm (a vm sandbox makes global lookups such as Math far slower).
globalThis.window = globalThis.window || {};
(0, eval)(code);
const mod = globalThis.window.PPMIExplorers.pooling;
const L = mod._lib;

/* ---------- brute-force linear algebra ---------- */
function solveDense(A, b) {            // Gaussian elimination with partial pivoting
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}
function invDense(A) {
  const n = A.length;
  const cols = [];
  for (let j = 0; j < n; j++) cols.push(solveDense(A, A.map((_, i) => (i === j ? 1 : 0))));
  return A.map((_, i) => cols.map(c => c[i]));
}

/* Henderson's mixed-model equations for the whole data set, solved by brute force:
 *  [X'X/s2      X'Z/s2         ] [beta]   [X'y/s2]
 *  [Z'X/s2   Z'Z/s2 + I (x) G^-1] [ b  ] = [Z'y/s2]                                         */
function hendersonBruteForce(people, G, s2) {
  const N = people.length, q = 2 + 2 * N;
  const C = Array.from({ length: q }, () => new Array(q).fill(0));
  const rhs = new Array(q).fill(0);
  people.forEach((p, i) => {
    p.t.forEach((t, j) => {
      const w = new Array(q).fill(0);
      w[0] = 1; w[1] = t; w[2 + 2 * i] = 1; w[3 + 2 * i] = t;
      for (let a = 0; a < q; a++) {
        if (w[a] === 0) continue;
        rhs[a] += w[a] * p.y[j] / s2;
        for (let b = 0; b < q; b++) C[a][b] += w[a] * w[b] / s2;
      }
    });
  });
  const Gi = L.inv2(G);
  for (let i = 0; i < N; i++) {
    const o = 2 + 2 * i;
    C[o][o] += Gi[0]; C[o][o + 1] += Gi[1]; C[o + 1][o] += Gi[2]; C[o + 1][o + 1] += Gi[3];
  }
  const sol = solveDense(C, rhs);
  return { beta: [sol[0], sol[1]], b: people.map((_, i) => [sol[2 + 2 * i], sol[3 + 2 * i]]) };
}

/* The textbook marginal form b_i = G Z_i' V_i^-1 (y_i - X_i beta), with V_i inverted densely. */
function blupMarginal(t, y, beta, G, s2) {
  const m = t.length;
  const Z = t.map(tt => [1, tt]);
  const V = Z.map((zi, a) => Z.map((zj, b) => {
    const zg = [zi[0] * G[0] + zi[1] * G[2], zi[0] * G[1] + zi[1] * G[3]];
    return zg[0] * zj[0] + zg[1] * zj[1] + (a === b ? s2 : 0);
  }));
  const Vi = invDense(V);
  const r = y.map((v, j) => v - beta[0] - beta[1] * t[j]);
  const Vr = Vi.map(row => row.reduce((acc, v, k) => acc + v * r[k], 0));
  const ZtVr = [Vr.reduce((a, v) => a + v, 0), Vr.reduce((a, v, k) => a + v * t[k], 0)];
  return [G[0] * ZtVr[0] + G[1] * ZtVr[1], G[2] * ZtVr[0] + G[3] * ZtVr[1]];
}

const settings = [
  { n: 30, schedule: 'regular', visits: 3, sigma: 0.5, tau0: 0.6, tau1: 0.1, rho: 0 },
  { n: 25, schedule: 'ppmi', visits: 3, sigma: 0.8, tau0: 1.0, tau1: 0.3, rho: -0.6 },
  { n: 12, schedule: 'regular', visits: 2, sigma: 0.2, tau0: 0.3, tau1: 0.02, rho: 0.7 },
  { n: 60, schedule: 'regular', visits: 6, sigma: 1.0, tau0: 1.2, tau1: 0.4, rho: 0.3 },
  { n: 40, schedule: 'ppmi', visits: 2, sigma: 0.35, tau0: 0.5, tau1: 0.15, rho: 0.8 }
];

test('module registers with the contract shape', () => {
  assert.equal(typeof mod.mount, 'function');
  assert.ok(mod.title.length <= 40, 'title at most 40 characters');
  assert.ok(mod.blurb.length > 10);
});

test('BLUP formula equals the brute-force solution of Henderson\'s mixed-model equations', () => {
  for (const [k, p] of settings.entries()) {
    const people = L.simulate(L.drawBase(100 + k), p);
    const G = L.covG(p.tau0, p.tau1, p.rho), s2 = p.sigma * p.sigma;
    const bf = hendersonBruteForce(people, G, s2);
    const beta = L.glsBeta(people, G, s2);
    assert.ok(Math.abs(beta[0] - bf.beta[0]) < 1e-9 && Math.abs(beta[1] - bf.beta[1]) < 1e-9, `GLS beta matches MME (setting ${k})`);
    people.forEach((q, i) => {
      const b = L.blup(q.t, q.y, beta, G, s2).b;
      assert.ok(Math.abs(b[0] - bf.b[i][0]) < 1e-9, `intercept BLUP person ${i} setting ${k}: ${b[0]} vs ${bf.b[i][0]}`);
      assert.ok(Math.abs(b[1] - bf.b[i][1]) < 1e-9, `slope BLUP person ${i} setting ${k}: ${b[1]} vs ${bf.b[i][1]}`);
    });
  }
});

test('BLUP formula equals the marginal form G Z\' V^-1 (y - X beta)', () => {
  for (const [k, p] of settings.entries()) {
    const people = L.simulate(L.drawBase(200 + k), p);
    const G = L.covG(p.tau0, p.tau1, p.rho), s2 = p.sigma * p.sigma;
    const beta = [0.1, -0.2];
    people.forEach(q => {
      const a = L.blup(q.t, q.y, beta, G, s2).b, b = blupMarginal(q.t, q.y, beta, G, s2);
      assert.ok(Math.abs(a[0] - b[0]) < 1e-10 && Math.abs(a[1] - b[1]) < 1e-10);
    });
  }
});

test('own least-squares line is exact on noiseless data', () => {
  const t = [0, 1.25, 3, 4.5], y = t.map(v => 2 - 0.4 * v);
  const o = L.olsLine(t, y);
  assert.ok(Math.abs(o[0] - 2) < 1e-12 && Math.abs(o[1] + 0.4) < 1e-12);
});

test('simulated random effects have the requested covariance', () => {
  const p = { n: 60, schedule: 'regular', visits: 3, sigma: 0.5, tau0: 0.8, tau1: 0.3, rho: -0.5 };
  let s00 = 0, s11 = 0, s01 = 0, n = 0;
  for (let seed = 1; seed <= 300; seed++) {
    for (const q of L.simulate(L.drawBase(seed), p)) { s00 += q.b0 * q.b0; s11 += q.b1 * q.b1; s01 += q.b0 * q.b1; n++; }
  }
  assert.ok(Math.abs(Math.sqrt(s00 / n) - 0.8) < 0.02, 'SD of b0');
  assert.ok(Math.abs(Math.sqrt(s11 / n) - 0.3) < 0.01, 'SD of b1');
  assert.ok(Math.abs(s01 / Math.sqrt(s00 * s11) + 0.5) < 0.02, 'correlation');
});

test('PPMI-like schedule: 2 to 4 visits, baseline at 0, distinct month-rounded times within 0 to 5.25 years', () => {
  const counts = { 2: 0, 3: 0, 4: 0 };
  for (let seed = 1; seed <= 50; seed++) {
    for (const b of L.drawBase(seed)) {
      const t = b.ppmi;
      assert.ok(t.length >= 2 && t.length <= 4);
      counts[t.length]++;
      assert.equal(t[0], 0);
      for (let j = 1; j < t.length; j++) {
        assert.ok(t[j] - t[j - 1] >= 0.49, 'times at least about half a year apart');
        assert.ok(Math.abs(t[j] * 12 - Math.round(t[j] * 12)) < 1e-9, 'rounded to the month');
        assert.ok(t[j] <= 5.25 + 1e-9);
      }
    }
  }
  for (const k of [2, 3, 4]) assert.ok(counts[k] > 700, 'each visit count occurs');
});

test('shrinkage curve: regression of BLUP slope on own slope has slope lambda (known beta)', () => {
  const cases = [
    { t: [0, 1], tau0: 0.6, tau1: 0.1, rho: 0, sigma: 0.5 },
    { t: [0, 1, 2], tau0: 0.6, tau1: 0.1, rho: 0.5, sigma: 0.5 },
    { t: [0, 1, 2, 3, 4, 5], tau0: 1.0, tau1: 0.2, rho: -0.4, sigma: 0.4 },
    { t: [0, 1.1, 3.9], tau0: 0.8, tau1: 0.15, rho: 0.3, sigma: 0.7 }
  ];
  const nrm = L.makeNormal(L.mulberry32(99));
  for (const c of cases) {
    const G = L.covG(c.tau0, c.tau1, c.rho), s2 = c.sigma * c.sigma, beta = [0, -0.15];
    const cc = Math.sqrt(1 - c.rho * c.rho);
    let sxy = 0, sxx = 0, seOwn = 0, seMM = 0;
    const R = 40000;
    for (let r = 0; r < R; r++) {
      const u0 = nrm(), u1 = nrm();
      const b0 = c.tau0 * u0, b1 = c.tau1 * (c.rho * u0 + cc * u1);
      const y = c.t.map(t => beta[0] + b0 + (beta[1] + b1) * t + c.sigma * nrm());
      const own = L.olsLine(c.t, y)[1] - beta[1];
      const mm = L.blup(c.t, y, beta, G, s2).b[1];
      sxy += own * mm; sxx += own * own;
      seOwn += (own - b1) ** 2; seMM += (mm - b1) ** 2;
    }
    const lam = L.slopeReliability(c.t, c.tau1, c.sigma);
    const est = sxy / sxx;
    assert.ok(Math.abs(est - lam) < 0.02 + 0.03 * lam, `t=${c.t}: regression slope ${est.toFixed(3)} vs lambda ${lam.toFixed(3)}`);
    assert.ok(seMM < seOwn, 'BLUP slopes closer to the truth than own slopes on average');
  }
});

test('fitAll summaries are consistent and deterministic for a seed', () => {
  const p = { n: 30, schedule: 'regular', visits: 3, sigma: 0.5, tau0: 0.6, tau1: 0.1, rho: 0 };
  const a = L.fitAll(L.simulate(L.drawBase(7), p), p);
  const b = L.fitAll(L.simulate(L.drawBase(7), p), p);
  assert.deepEqual(a.beta, b.beta);
  assert.equal(a.rows.length, 30);
  const lam = L.slopeReliability([0, 1, 2], 0.1, 0.5);
  assert.ok(Math.abs(a.meanLambda - lam) < 1e-12);
  assert.ok(a.rmseMM < a.rmseOwn);
});
