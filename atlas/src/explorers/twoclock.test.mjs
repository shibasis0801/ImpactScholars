// Unit tests for the pure maths in twoclock.js. Run: node explorers/twoclock.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// Load the browser module with a stand-in window (main context, so timings match a browser's JIT, unlike node:vm).
const src = readFileSync(new URL('./twoclock.js', import.meta.url), 'utf8');
const sandbox = { window: {} };
new Function('window', src)(sandbox.window);
const M = sandbox.window.PPMIExplorers.twoclock._math;
const K = M.constants;
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + e.message); }
}
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a} (tol ${tol})`);
const rng = seed => M.gaussian(M.mulberry32(seed));
function draw(n, sD, sS, rho, seed) {
  const g = rng(seed), c = Math.sqrt(Math.max(0, 1 - rho * rho)), a = new Float64Array(n), b = new Float64Array(n);
  for (let i = 0; i < n; i++) { const z1 = g(), z2 = g(); a[i] = sD * z1; b[i] = sS * (rho * z1 + c * z2); }
  return [a, b];
}
const sd = xs => { let m = 0; for (const x of xs) m += x; m /= xs.length; let v = 0; for (const x of xs) v += (x - m) ** 2; return Math.sqrt(v / (xs.length - 1)); };

test('registration shape', () => {
  const x = sandbox.window.PPMIExplorers.twoclock;
  assert.equal(typeof x.mount, 'function');
  assert.ok(x.title.length <= 40, 'title at most 40 characters');
  assert.ok(x.blurb.length > 20);
});

test('mulberry32 is deterministic and gaussian has mean 0, SD 1', () => {
  const a = M.mulberry32(42), b = M.mulberry32(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  const g = rng(7); let s = 0, s2 = 0; const n = 200000;
  for (let i = 0; i < n; i++) { const v = g(); s += v; s2 += v * v; }
  close(s / n, 0, 0.01, 'mean'); close(Math.sqrt(s2 / n), 1, 0.01, 'sd');
});

test('ellipse points lie on the k-SD Mahalanobis contour', () => {
  for (const [sD, sS, rho] of [[1, 1, 0.7], [2.5, 0.4, -0.2], [0.3, 1.8, 0.95], [1.2, 1.2, 0]]) {
    const det = sD * sD * sS * sS * (1 - rho * rho);
    for (const k of [1, 2]) for (const [x, y] of M.ellipse(sD, sS, rho, k, 64)) {
      const m2 = (sS * sS * x * x - 2 * rho * sD * sS * x * y + sD * sD * y * y) / det;
      close(m2, k * k, 1e-9, `rho ${rho} k ${k}`);
    }
  }
  for (const [x, y] of M.ellipse(2, 1, 1, 1, 16)) close(y, x / 2, 1e-12, 'rho = 1 gives a segment on dS = (sS/sD) dD');
});

test('discordance SD matches the formula and a large simulation', () => {
  close(M.discSD(1, 1, 0.7), Math.sqrt(0.6), 1e-12);
  close(M.discSD(2, 1, 1), 1, 1e-12, 'rho = 1 with unequal SDs leaves |sD - sS|');
  close(M.discSD(1.5, 1.5, 1), 0, 1e-12);
  for (const [sD, sS, rho] of [[1, 1, 0.7], [2.5, 0.5, -0.2], [0.8, 1.6, 0.4]]) {
    const [a, b] = draw(200000, sD, sS, rho, 3);
    close(sd(a.map((v, i) => v - b[i])), M.discSD(sD, sS, rho), 0.01 * M.discSD(sD, sS, rho) + 0.003, `${sD},${sS},${rho}`);
  }
});

test('omega: collapse onto the diagonal', () => {
  const o0 = M.omega(1.3, 0.7, 0.4, 0);
  close(o0.sD, 1.3, 1e-12); close(o0.sS, 0.7, 1e-12); close(o0.rho, 0.4, 1e-12);
  const o1 = M.omega(1.3, 0.7, 0.4, 1), v = (1.69 + 0.49 + 2 * 0.4 * 1.3 * 0.7) / 4;
  close(o1.sD, Math.sqrt(v), 1e-12); close(o1.sS, Math.sqrt(v), 1e-12); close(o1.rho, 1, 1e-9);
  const c = 0.35, [a, b] = draw(200000, 1.3, 0.7, 0.4, 5);
  const ca = a.map((x, i) => x + c * ((x + b[i]) / 2 - x)), cb = b.map((y, i) => y + c * ((a[i] + y) / 2 - y));
  const oc = M.omega(1.3, 0.7, 0.4, c), sa = sd(ca), sb = sd(cb);
  let cv = 0; for (let i = 0; i < ca.length; i++) cv += ca[i] * cb[i]; cv /= ca.length - 1;
  close(sa, oc.sD, 0.01); close(sb, oc.sS, 0.01); close(cv / (sa * sb), oc.rho, 0.01);
  close(M.discSD(oc.sD, oc.sS, oc.rho), (1 - c) * M.discSD(1.3, 0.7, 0.4), 1e-9, 'discordance shrinks by (1 - c)');
});

test('variance split adds up and matches simulated test scores at year 3', () => {
  const w = [0.7, 0.1], o = { sD: 1.2, sS: 0.9, rho: 0.6 }, sp = M.split(w, o, 1);
  close(sp.D + sp.S + sp.noise, sp.total, 1e-12);
  const lD = K.SLOPE * w[0], lS = K.SLOPE * w[1];
  close(sp.D, lD * lD * 1.44 + lD * lS * 0.6 * 1.2 * 0.9, 1e-12);
  close(sp.cov, 2 * lD * lS * 0.6 * 1.2 * 0.9, 1e-12);
  const [a, b] = draw(200000, 1.2, 0.9, 0.6, 9), g = rng(10);
  for (const t of [0, 3, 5]) {
    const y = a.map((x, i) => M.cog(w, t + x, t + b[i]) + K.SD.cog * g());
    close(sd(y) ** 2, sp.total, 0.012 * sp.total, `year ${t}`);
  }
  const zero = M.split([0, 0], o, 2); close(zero.D + zero.S, 0, 1e-12); close(zero.noise, (2 * K.SD.cog) ** 2, 1e-12);
});

test('curves: putamen lower than caudate, both falling, putamen floors by D = 4, caudate still informative', () => {
  for (let d = -6; d <= 12; d += 0.25) {
    const p = M.sbr(K.PUT, d)[0], pd = M.sbr(K.PUT, d)[1], c = M.sbr(K.CAU, d)[0], cd = M.sbr(K.CAU, d)[1];
    assert.ok(p < c, `putamen below caudate at D = ${d}`); assert.ok(pd < 0 && cd < 0, 'both decreasing');
    assert.ok(M.gm(d)[1] < 0, 'grey matter decreasing');
  }
  const pf = (M.sbr(K.PUT, 4)[0] - K.PUT[0]) / K.PUT[1]; assert.ok(pf < 0.05, `putamen within 5% of floor at D = 4 (${pf})`);
  assert.ok(Math.abs(M.sbr(K.CAU, 4)[1]) > 0.1, 'caudate slope at D = 4');
  const h = 1e-6;
  close(M.sbr(K.PUT, 0.3)[1], (M.sbr(K.PUT, 0.3 + h)[0] - M.sbr(K.PUT, 0.3 - h)[0]) / (2 * h), 1e-6, 'putamen derivative');
  close(M.gm(1.7)[1], (M.gm(1.7 + h)[0] - M.gm(1.7 - h)[0]) / (2 * h), 1e-6, 'grey matter derivative');
  close(M.gm(0)[0], 100, 1e-12, 'grey matter 100 for the average person at baseline');
});

test('discordance SE: scales with noise; imaging-only case; matches simulated ML fits', () => {
  const W = K.PRESETS[0][1];
  close(M.discSE(W, 2, K.LMK), 2 * M.discSE(W, 1, K.LMK), 1e-12, 'linear in noise');
  const z = K.TESTS.map(() => [0, 0]);
  let iD = 0, iS = 0;
  for (const t of K.LMK.dat) iD += 2 * (M.sbr(K.PUT, t)[1] ** 2 + M.sbr(K.CAU, t)[1] ** 2) / K.SD.sbr ** 2;
  for (const t of K.LMK.mri) iS += M.gm(t)[1] ** 2 / K.SD.gm ** 2;
  close(M.discSE(z, 1, K.LMK), Math.sqrt(1 / iD + 1 / iS), 1e-12, 'zero loadings');
  // Monte Carlo: a person at offsets (0, 0), all landmark data, 2-D Gauss-Newton ML fit of (dD, dS).
  const noise = 0.5, g = rng(21), est = [];
  for (let r = 0; r < 4000; r++) {
    const obs = [];
    for (const t of K.LMK.dat) for (const c of [K.PUT, K.PUT, K.CAU, K.CAU]) obs.push({ t, kind: c, y: M.sbr(c, t)[0] + K.SD.sbr * noise * g(), s: K.SD.sbr * noise });
    for (const t of K.LMK.mri) obs.push({ t, kind: 'gm', y: M.gm(t)[0] + K.SD.gm * noise * g(), s: K.SD.gm * noise });
    for (const t of K.LMK.cog) W.forEach(w => obs.push({ t, kind: w, y: M.cog(w, t, t) + K.SD.cog * noise * g(), s: K.SD.cog * noise }));
    let d = 0, s = 0;
    for (let it = 0; it < 12; it++) {
      let a = 0, b = 0, c = 0, u = 0, v = 0;
      for (const o of obs) {
        let f, jd = 0, js = 0;
        if (o.kind === 'gm') { const q = M.gm(o.t + s); f = q[0]; js = q[1]; }
        else if (Array.isArray(o.kind) && o.kind.length === 2) { f = M.cog(o.kind, o.t + d, o.t + s); jd = -K.SLOPE * o.kind[0]; js = -K.SLOPE * o.kind[1]; }
        else { const q = M.sbr(o.kind, o.t + d); f = q[0]; jd = q[1]; }
        const res = (o.y - f) / o.s; jd /= o.s; js /= o.s;
        a += jd * jd; b += jd * js; c += js * js; u += jd * res; v += js * res;
      }
      const det = a * c - b * b; d += (c * u - b * v) / det; s += (a * v - b * u) / det;
    }
    est.push(d - s);
  }
  close(sd(est), M.discSE(W, noise, K.LMK), 0.05 * M.discSE(W, noise, K.LMK), 'empirical SD of D - S estimates');
});

test('normal CDF and chi-square quantile', () => {
  close(M.normCdf(0), 0.5, 1e-7); close(M.normCdf(1.959964), 0.975, 1e-6); close(M.normCdf(-1), 0.158655, 1e-6);
  close(M.chi2q95(50), 67.5048, 0.02); close(M.chi2q95(100), 124.3421, 0.02); close(M.chi2q95(400), 447.6325, 0.03);
});

test('Monte Carlo test: calibrated under one clock, powerful when clocks clearly differ', () => {
  const base = { sD: 1, sS: 1, rho: 0.7, noise: 1, N: 100 };
  for (const k of [2, 3, 4]) {
    const a = M.mcPower({ ...base, one: true }, k, 400, 99);
    assert.ok(a > 0.015 && a < 0.09, `false-positive rate near 5% (k = ${k}: ${a})`);
  }
  assert.equal(M.mcPower({ ...base, rho: 0.5, one: false }, 2, 40, 1), 1);
  const tie = M.mcPower({ ...base, rho: 1, one: false }, 3, 400, 2);
  assert.ok(tie < 0.1, `rho = 1 with equal SDs behaves like one clock (${tie})`);
  const lo = M.mcPower({ ...base, rho: 0.95, noise: 3, one: false }, 4, 200, 3), hi = M.mcPower({ ...base, rho: 0.95, noise: 0.5, one: false }, 4, 200, 3);
  assert.ok(lo < hi, `less noise, more power (${lo} < ${hi})`);
});

test('Monte Carlo runs in under 50 ms at N = 400 (30 cohorts x 3 schedules)', () => {
  const p = { sD: 1, sS: 1, rho: 0.7, noise: 1, N: 400, one: false };
  [2, 3, 4].forEach(k => M.mcPower(p, k, 30, 5)); // warm up
  const t0 = performance.now(); [2, 3, 4].forEach(k => M.mcPower(p, k, 30, 6)); const ms = performance.now() - t0;
  console.log(`     (${ms.toFixed(1)} ms)`);
  assert.ok(ms < 50, `took ${ms.toFixed(1)} ms`);
});

test('verdict sentence follows the identifiability logic', () => {
  assert.match(M.verdict({ one: true }).main, /one clock D − S is zero/);
  const low = M.verdict({ one: false, sdd: 0.2, se: 0.6, rho: 0.98, sD: 1, sS: 1 });
  assert.match(low.main, /predict almost the same thing/); assert.match(low.main, /high correlation/);
  assert.match(low.main, /^Fewer than 1%/, 'P(|N(0, 0.2^2)| > 1.2) is about 2e-9');
  assert.match(low.detail, /reliability 0\.10/, 'R = 0.04 / (0.04 + 0.36)');
  const small = M.verdict({ one: false, sdd: 0.2, se: 0.6, rho: 0.2, sD: 0.15, sS: 0.15 });
  assert.match(small.main, /small compared with measurement noise/);
  const high = M.verdict({ one: false, sdd: 1.2, se: 0.4, rho: 0.3, sD: 1, sS: 1 });
  assert.match(high.main, /two clocks should predict held-out participants/);
  assert.match(high.main, /^About 50%/, '2 (1 - Phi(0.8 / 1.2)) = 0.50498');
  assert.equal(M.verdict({ one: false, sdd: 1.2, se: 0.4, rho: 0.3, sD: 1, sS: 1 }).main.split('. ').length, 1, 'one sentence');
  assert.match(M.verdict({ one: false, sdd: 1.0, se: 0.4, rho: 1, sD: 2, sS: 1 }).detail, /not enough for one clock/);
});

test('formatting helpers', () => {
  assert.equal(M.num(-0.004, 2), '0.00'); assert.equal(M.num(-1.5, 1), '−1.5');
  assert.equal(M.sgn(0.84, 2), '+0.84'); assert.equal(M.pct(0.003), '<1%'); assert.equal(M.pct(0.256), '26%');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
