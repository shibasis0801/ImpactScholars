// Unit tests for the DaTScan explorer's pure functions. Run: node datscan.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {} };
vm.runInNewContext(readFileSync(join(here, 'datscan.js'), 'utf8'), sandbox, { filename: 'datscan.js' });
const mod = sandbox.window.PPMIExplorers.datscan;
const M = mod._model;
const P = M.PARAMS;

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok  ' + name); }
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const base = { years: 2, asym: 0.3, worse: 'right', age: 60, method: 'occ', healthy: false };

test('registration shape and title length', () => {
  assert.equal(typeof mod.mount, 'function');
  assert.ok(mod.title.length <= 40, 'title too long: ' + mod.title.length);
  assert.deepEqual(Object.keys(sandbox.window), ['PPMIExplorers']);
});

test('SBR = target / reference - 1', () => {
  assert.ok(close(M.sbrFromCounts(300, 100), 2));
  assert.ok(close(M.sbrFromCounts(100, 100), 0));            // no specific binding
  assert.ok(close(M.sbrFromCounts(150, 120), 0.25));
  // occipital reference = nonspecific background, so counts round-trip exactly
  for (const s of [0, 0.37, 1.2, 3.5]) assert.ok(close(M.toMethod(s, 'occ'), s));
  // white-matter reference: (100 * (1 + s)) / 115 - 1
  assert.ok(close(M.toMethod(2, 'cwm'), 300 / 115 - 1));
});

test('every scan number obeys the formula with its own reference', () => {
  for (const method of ['occ', 'cwm']) {
    const r = M.scan({ ...base, method });
    for (const k of M.REGIONS) {
      const x = r.regions[k];
      assert.ok(close(x.sbr, x.target / x.reference - 1));
      assert.ok(close(x.pct, x.sbr / x.expected));
      assert.equal(x.reference, P.ref[method]);
    }
  }
});

test('age: 8% of the age-40 value per decade, same in caudate and putamen', () => {
  for (const kind of ['caudate', 'putamen']) {
    assert.ok(close(M.expectedOcc(kind, 50) / M.expectedOcc(kind, 40), 0.92));
    assert.ok(close(M.expectedOcc(kind, 85) / M.expectedOcc(kind, 40), 0.64));
  }
  // a healthy scan is at exactly 100% of expected at every age, with either reference
  for (const age of [40, 62, 85]) for (const method of ['occ', 'cwm']) {
    const h = M.scan({ ...base, age, method, healthy: true });
    for (const k of M.REGIONS) { assert.ok(close(h.regions[k].pct, 1, 1e-12)); assert.equal(h.regions[k].belowD, false); }
    assert.equal(h.sides.L.shape.key, 'comma');
    assert.equal(h.sides.R.shape.key, 'comma');
  }
});

test('binding falls monotonically with years in every region, and stays above the floor', () => {
  let prev = null;
  for (let y = 0; y <= 10.0001; y += 0.5) {
    const r = M.scan({ ...base, years: y });
    if (prev) for (const k of M.REGIONS) assert.ok(r.regions[k].sbr < prev.regions[k].sbr, k + ' at ' + y);
    for (const k of M.REGIONS) assert.ok(r.regions[k].fraction > P.floor);
    prev = r;
  }
});

test('putamen below caudate; the side opposite the worse limbs below the other side', () => {
  for (const worse of ['right', 'left']) {
    const r = M.scan({ ...base, worse });
    const c = r.contraSide, i = c === 'L' ? 'R' : 'L';
    assert.equal(c, worse === 'right' ? 'L' : 'R');
    for (const side of ['L', 'R']) assert.ok(r.regions[side + '_putamen'].fraction < r.regions[side + '_caudate'].fraction);
    assert.ok(r.regions[c + '_putamen'].sbr < r.regions[i + '_putamen'].sbr);
    assert.ok(r.regions[c + '_caudate'].sbr < r.regions[i + '_caudate'].sbr);
    // asymmetry index sign: (left - right) / mean is negative when the left is lower
    assert.equal(Math.sign(r.summary.asymPut), c === 'L' ? -1 : 1);
  }
  const sym = M.scan({ ...base, asym: 0 });
  assert.ok(close(sym.regions.L_putamen.sbr, sym.regions.R_putamen.sbr));
  assert.ok(close(sym.summary.asymPut, 0));
});

test('loss runs from the back of the putamen forwards', () => {
  for (const S of [2, 8.5, 12, 18.5]) {
    let last = Infinity;
    for (let u = 0; u <= 1.0001; u += 0.1) {
      const f = M.localFraction(M.vPutamen(u), S);
      assert.ok(f < last); last = f;
    }
    assert.ok(M.caudateFraction(S) > M.localFraction(M.vPutamen(0), S)); // caudate spared relative to the front of the putamen
  }
});

test('closed-form putamen mean matches numerical integration', () => {
  for (const S of [0, 1e-12, 3, 8.5, 18.5]) {
    let s = 0; const n = 20000;
    for (let i = 0; i < n; i++) s += M.localFraction(M.vPutamen((i + 0.5) / n), S);
    assert.ok(Math.abs(M.putamenFraction(S) - s / n) < 1e-7, 'S=' + S);
  }
  assert.ok(close(M.putamenFraction(0), 1));
});

test('floor effect: late putamen loss is a small fraction of early loss', () => {
  const tc = M.timeCourse({ ...base });
  const at = (t) => tc.rows[Math.round(t * 10)];
  const early = at(0).putC - at(2).putC, late = at(8).putC - at(10).putC;
  assert.ok(late < 0.5 * early, JSON.stringify({ early, late }));
  // the caudate is still falling late, and more than the putamen does
  assert.ok(at(8).cauC - at(10).cauC > late);
  // the posterior putamen is near its floor within about four years
  assert.ok(at(4).postC - tc.floorPct < 0.1);
});

test('calibration near the guide summary of Marek et al. 2018 (de novo PD)', () => {
  const r = M.scan({ ...base, years: 2 });
  const contra = r.summary.contraPut.pct, mean = r.summary.meanStriatumPct;
  assert.ok(contra > 0.28 && contra < 0.42, 'contralateral putamen ' + contra);   // guide: 68% lower, i.e. 32%
  assert.ok(mean > 0.5 && mean < 0.62, 'mean striatum ' + mean);                  // guide: 45% lower, i.e. 55%
});

test('NSD-ISS D flag is "below 75% of expected", strictly', () => {
  assert.equal(P.dCut, 0.75);
  for (let y = 0; y <= 10; y += 1) {
    const r = M.scan({ ...base, years: y });
    for (const k of M.REGIONS) assert.equal(r.regions[k].belowD, r.regions[k].pct < 0.75);
  }
  // early on, the putamina are below the line and the ipsilateral caudate is not
  const r = M.scan({ ...base, years: 0 });
  assert.equal(r.regions.L_putamen.belowD, true);
  assert.equal(r.regions.R_caudate.belowD, false);
});

test('the two references give different numbers for the same scan (never pool)', () => {
  const a = M.scan({ ...base, method: 'occ' }), b = M.scan({ ...base, method: 'cwm' });
  for (const k of M.REGIONS) {
    assert.ok(Math.abs(a.regions[k].sbr - b.regions[k].sbr) > 0.1);
    assert.ok(close(a.regions[k].target, b.regions[k].target));     // same counts, different reference
    assert.ok(close(a.regions[k].other, b.regions[k].sbr));
    assert.ok(b.regions[k].sbr > 0);
  }
  // % of expected is not invariant to the reference either
  assert.ok(Math.abs(a.regions.L_putamen.pct - b.regions.L_putamen.pct) > 0.01);
  // the lowest reachable value stays positive with the white-matter reference
  const worst = M.scan({ ...base, years: 10, asym: 0, age: 85, method: 'cwm' });
  for (const k of M.REGIONS) assert.ok(worst.regions[k].sbr > 0);
});

test('visual description: comma becomes a full stop on the contralateral side first', () => {
  const s0 = M.scan({ ...base, years: 0 }), s10 = M.scan({ ...base, years: 10 });
  assert.notEqual(s0.sides.L.shape.key, 'comma');
  assert.equal(s10.sides.L.shape.key, 'fullstop');
  const order = { comma: 0, fading: 1, fullstop: 2 };
  for (let y = 0; y <= 10; y += 0.5) {
    const r = M.scan({ ...base, years: y });
    assert.ok(order[r.sides.L.shape.key] >= order[r.sides.R.shape.key], 'contralateral never looks better, year ' + y);
  }
});

test('putamen-to-caudate ratio falls with disease', () => {
  const h = M.scan({ ...base, healthy: true }), p = M.scan({ ...base, years: 4 });
  assert.ok(p.summary.pcL < h.summary.pcL && p.summary.pcR < h.summary.pcR);
  assert.ok(close(h.summary.pcL, P.e40.putamen / P.e40.caudate, 1e-12));
});

test('colour scale and geometry helpers', () => {
  assert.match(M.bindColor(0), /var\(--surface-2\)/);
  assert.match(M.bindColor(1), /var\(--fg\) 38\.0%/);
  assert.equal(M.bindColor(-1), M.bindColor(0));
  const d = M.closedSpline([[0, 0], [10, 0], [10, 10], [0, 10]]);
  assert.match(d, /^M0,0C/); assert.match(d, /Z$/);
  assert.equal((d.match(/C/g) || []).length, 4);
  // caudate and putamen outlines do not overlap (check bounding boxes along the shared border)
  const cau = M.GEO.caudate, put = M.GEO.putamen;
  const maxCx = Math.max(...cau.map((p) => p[0])), minPx = Math.min(...put.map((p) => p[0]));
  assert.ok(minPx > maxCx, 'internal capsule gap');
});

console.log(`\n${passed} tests passed`);
