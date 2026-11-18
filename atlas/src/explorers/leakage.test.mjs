// Tests for explorers/leakage.js. Run: node --test explorers/leakage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const code = fs.readFileSync(new URL('./leakage.js', import.meta.url), 'utf8');
// Run the module in the main realm (a vm sandbox makes global lookups such as Math far slower).
globalThis.window = globalThis.window || {};
(0, eval)(code);
const mod = globalThis.window.PPMIExplorers.leakage;
const L = mod._lib;
const seq = n => Array.from({ length: n }, (_, i) => i);
const meanSE = a => {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
  return { m, se: sd / Math.sqrt(a.length) };
};

test('module registers with the contract shape', () => {
  assert.equal(typeof mod.mount, 'function');
  assert.ok(mod.title.length <= 40);
});

test('kNN matches a brute-force sort of all distances', () => {
  const data = L.genA(3, 30, 3, 0.4, 1.0), fresh = L.genA(4, 10, 3, 0.4, 1.0), d = L.D_FEAT;
  for (const k of [1, 3, 7]) {
    const out = L.knn(data, seq(data.n), fresh, seq(fresh.n), k);
    for (let t = 0; t < fresh.n; t++) {
      const dist = seq(data.n).map(r => {
        let s = 0;
        for (let f = 0; f < d; f++) s += (fresh.X[t * d + f] - data.X[r * d + f]) ** 2;
        return [s, r];
      }).sort((a, b) => a[0] - b[0]);
      const want = dist.slice(0, k).reduce((acc, [, r]) => acc + data.y[r], 0) / k;
      assert.ok(Math.abs(out.pred[t] - want) < 1e-12, `k=${k} row ${t}`);
    }
  }
});

test('participant-level folds keep every person in one fold; visit-level folds do not', () => {
  const data = L.genA(5, 40, 4, 0.3, 1.0), rng = L.mulberry32(9);
  const fp = L.foldsA(data, 5, 'person', rng), fv = L.foldsA(data, 5, 'visit', rng);
  let splitPeople = 0;
  for (let i = 0; i < data.people; i++) {
    const fs1 = new Set(), fs2 = new Set();
    for (let j = 0; j < data.visits; j++) { fs1.add(fp[i * 4 + j]); fs2.add(fv[i * 4 + j]); }
    assert.equal(fs1.size, 1);
    if (fs2.size > 1) splitPeople++;
  }
  assert.ok(splitPeople > 30, 'most people straddle visit-level folds');
});

test('Demo A: visit-level CV is far too optimistic; participant-level CV tracks the truth', () => {
  const s = { people: 60, visits: 4, w: 0.25, tau: 1.0, k: 3, K: 5 };
  const runs = seq(20).map(r => L.runA(1000 + 17 * r, s));
  const m = key => runs.reduce((a, r) => a + r[key], 0) / runs.length;
  assert.ok(m('visit') < 0.7 * m('truth'), `visit-level ${m('visit').toFixed(3)} vs truth ${m('truth').toFixed(3)}`);
  assert.ok(Math.abs(m('person') - m('truth')) < 0.1 * m('truth'), `participant-level ${m('person').toFixed(3)} vs truth ${m('truth').toFixed(3)}`);
  assert.ok(m('sameVisit') > 0.5, 'visit-level neighbours are mostly the same person');
  assert.equal(m('samePerson'), 0, 'participant-level neighbours are never the same person');
});

test('stratified folds balance the two groups', () => {
  const data = L.genB(2, 60, 10), rng = L.mulberry32(1);
  const fold = L.stratFolds(data, seq(60), 5, rng);
  for (let f = 0; f < 5; f++) {
    let c0 = 0, c1 = 0;
    for (let i = 0; i < 60; i++) if (fold[i] === f) (data.y[i] ? c1++ : c0++);
    assert.equal(c0, 6); assert.equal(c1, 6);
  }
});

test('Demo B: on pure noise, nested CV and inside-fold selection stay at chance', () => {
  const nested = [], inside = [];
  for (let r = 0; r < 200; r++) {
    const data = L.genB(500 + r, 50, 500), rng = L.mulberry32(77 + r);
    nested.push(L.nestedCV(data, 5, rng));
    inside.push(L.insideSelection(data, 10, 5, rng));
  }
  const a = meanSE(nested), b = meanSE(inside);
  assert.ok(Math.abs(a.m - 0.5) < 3 * a.se + 0.005, `nested ${a.m.toFixed(4)} (SE ${a.se.toFixed(4)})`);
  assert.ok(Math.abs(b.m - 0.5) < 3 * b.se + 0.005, `inside ${b.m.toFixed(4)} (SE ${b.se.toFixed(4)})`);
});

test('Demo B: selection on all data inflates accuracy a lot; reporting the best tuned score inflates it a little', () => {
  const sel = [], tune = [];
  for (let r = 0; r < 100; r++) {
    const data = L.genB(900 + r, 50, 1000), rng = L.mulberry32(5 + r);
    sel.push(L.leakySelection(data, 10, 5, rng));
    tune.push(L.leakyTuning(data, 5, rng).acc);
  }
  const a = meanSE(sel), b = meanSE(tune);
  assert.ok(a.m > 0.75, `select-on-all ${a.m.toFixed(3)}`);
  assert.ok(b.m > 0.5 + 4 * b.se && b.m < a.m, `tune-and-report-best ${b.m.toFixed(3)} (SE ${b.se.toFixed(4)})`);
});

test('nearest-centroid classifier is exact on separable data', () => {
  const data = L.genB(1, 40, 3);
  for (let i = 0; i < 40; i++) data.X[0 * 40 + i] = data.y[i] ? 5 + 0.1 * i : -5 - 0.1 * i;
  assert.equal(L.centroidCorrect(data, seq(30), seq(40).slice(30), [0]), 10);
  assert.deepEqual(Array.from(L.rankFeatures(data, seq(40), 1)), [0]);   // copy out of the vm realm
});

test('fast ranking (whole-sample sums minus held-out rows) equals the direct ranking', () => {
  for (const [seed, n, p] of [[1, 50, 300], [2, 80, 1000], [3, 20, 100]]) {
    const data = L.genB(seed, n, p), rng = L.mulberry32(seed);
    for (let rep = 0; rep < 5; rep++) {
      const excl = seq(n).filter(() => rng() < 0.3);
      const keep = L.complement(n, excl);
      const a = Array.from(L.rankExcluding(data, data.tot, excl, 50));
      const b = Array.from(L.rankFeatures(data, keep, 50));
      assert.deepEqual(a, b);
    }
  }
});
