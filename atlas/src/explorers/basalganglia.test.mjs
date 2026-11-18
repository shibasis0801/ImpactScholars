// Unit tests for the basal ganglia rate model. Run: node basalganglia.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(here, 'basalganglia.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(code, sandbox, { filename: 'basalganglia.js' });
const mod = sandbox.window.PPMIExplorers.basalganglia;
const M = mod._model;

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok  ' + name); }
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

test('registration shape and title length', () => {
  assert.equal(typeof mod.mount, 'function');
  assert.ok(mod.title.length <= 40, 'title too long: ' + mod.title.length);
  assert.ok(mod.blurb.length > 10);
  assert.deepEqual(Object.keys(sandbox.window), ['PPMIExplorers']);
});

test('healthy steady state is exactly 1 everywhere', () => {
  const r = M.steadyState({ dopamine: 1, levodopa: false, dbs: false });
  for (const k of M.KEYS) assert.ok(close(r[k], 1, 1e-9), k + '=' + r[k]);
  // levodopa changes nothing when dopamine is already normal
  const rl = M.steadyState({ dopamine: 1, levodopa: true, dbs: false });
  for (const k of M.KEYS) assert.ok(close(rl[k], 1, 1e-9));
});

test('steady state is a fixed point of the equations', () => {
  for (const o of [{ dopamine: 0.1, levodopa: false, dbs: false }, { dopamine: 0.4, levodopa: true, dbs: true }]) {
    const r = M.steadyState(o);
    const f = M.targetRates(r, o, 0, M.PARAMS);
    for (const k of M.KEYS) assert.ok(close(r[k], f[k], 1e-8), k);
  }
});

function grid(o) {
  const out = [];
  for (let i = 0; i <= 90; i++) { const d = 1 - i * 0.01; out.push(M.steadyState(Object.assign({ dopamine: d }, o))); }
  return out; // dopamine falling from 1.00 to 0.10
}

for (const [L, D] of [[false, false], [true, false], [false, true], [true, true]]) {
  test(`as dopamine falls, GPi/SNr rises and thalamus falls (levodopa=${L}, dbs=${D})`, () => {
    const g = grid({ levodopa: L, dbs: D });
    for (let i = 1; i < g.length; i++) {
      assert.ok(g[i].G > g[i - 1].G, 'GPi not rising at step ' + i);
      assert.ok(g[i].T < g[i - 1].T, 'thalamus not falling at step ' + i);
    }
  });
}

test('untreated: every nucleus moves in the classic direction, monotonically', () => {
  const g = grid({ levodopa: false, dbs: false });
  const dir = { C: -1, D1: -1, D2: +1, E: -1, S: +1, G: +1, T: -1 };
  for (let i = 1; i < g.length; i++) for (const k of M.KEYS) {
    assert.ok(Math.sign(g[i][k] - g[i - 1][k]) === dir[k], k + ' wrong direction at step ' + i);
  }
  const s = g[g.length - 1];
  assert.ok(s.D1 > 0.05, 'D1 must not clip at 10% dopamine');
  // magnitudes at 10% dopamine (the cartoon is calibrated to these ranges)
  assert.ok(s.G > 1.35 && s.G < 1.6, 'GPi ' + s.G);
  assert.ok(s.T > 0.45 && s.T < 0.65, 'thalamus ' + s.T);
  assert.ok(s.E > 0.65 && s.E < 0.85, 'GPe ' + s.E);
  assert.ok(s.S > 1.25 && s.S < 1.5, 'STN ' + s.S);
  assert.equal(M.vigourBand(s.T).key, 'bradykinesia');
});

test('levodopa partly restores: between untreated and healthy', () => {
  for (const d of [0.1, 0.3, 0.6, 0.9]) {
    const u = M.steadyState({ dopamine: d, levodopa: false, dbs: false });
    const l = M.steadyState({ dopamine: d, levodopa: true, dbs: false });
    assert.ok(l.G < u.G && l.G > 1, 'GPi at d=' + d);
    assert.ok(l.T > u.T && l.T < 1, 'thalamus at d=' + d);
  }
  assert.ok(close(M.dopamineSignal(0.1, true), 0.64, 1e-12));
  assert.ok(close(M.dopamineSignal(0.1, false), 0.1, 1e-12));
});

test('STN DBS lowers GPi/SNr and raises thalamic drive at every dopamine level', () => {
  for (const d of [0.1, 0.5, 1]) {
    const u = M.steadyState({ dopamine: d, levodopa: false, dbs: false });
    const s = M.steadyState({ dopamine: d, levodopa: false, dbs: true });
    assert.ok(s.G < u.G && s.T > u.T);
    assert.ok(close(s.Sout, 0.3 * s.S, 1e-12), 'DBS removes 70% of STN output');
  }
  // severe loss + DBS lands near normal; healthy circuit + DBS overshoots (hyperkinetic end of the rate model)
  assert.equal(M.vigourBand(M.steadyState({ dopamine: 0.1, levodopa: false, dbs: true }).T).key, 'normal');
  assert.equal(M.vigourBand(M.steadyState({ dopamine: 1, levodopa: false, dbs: true }).T).key, 'excess');
});

test('hyperdirect pulse: STN and GPi/SNr rise, thalamus dips, then recovery', () => {
  for (const o of [{ dopamine: 1, levodopa: false, dbs: false }, { dopamine: 0.3, levodopa: false, dbs: false }]) {
    const sim = M.simulatePulse(o);
    const b = sim.base, last = sim.states[sim.states.length - 1];
    const sMax = Math.max(...sim.states.map((s) => s.S));
    const gMax = Math.max(...sim.states.map((s) => s.G));
    const tMin = Math.min(...sim.states.map((s) => s.T));
    assert.ok(sMax > b.S + 0.5 && gMax > b.G + 0.15 && tMin < b.T - 0.15);
    for (const k of M.KEYS) assert.ok(Math.abs(last[k] - b[k]) < 0.02, 'recovers: ' + k);
    // before the pulse nothing moves
    const pre = sim.states[Math.floor(sim.on / M.PARAMS.dt) - 1];
    for (const k of M.KEYS) assert.ok(Math.abs(pre[k] - b[k]) < 1e-9);
  }
  // with DBS the brake on GPi/SNr is much weaker
  const off = M.simulatePulse({ dopamine: 0.3, levodopa: false, dbs: false });
  const on = M.simulatePulse({ dopamine: 0.3, levodopa: false, dbs: true });
  const rise = (sim) => Math.max(...sim.states.map((s) => s.G)) - sim.base.G;
  assert.ok(rise(on) < 0.5 * rise(off));
});

test('chart axis ranges never clip any reachable value', () => {
  let sMax = 0, gMax = 0, tMax = 0, tMin = 9;
  for (const L of [false, true]) for (const D of [false, true]) for (let d = 0.1; d <= 1.0001; d += 0.05) {
    const sim = M.simulatePulse({ dopamine: d, levodopa: L, dbs: D });
    for (const s of sim.states) { sMax = Math.max(sMax, s.S); gMax = Math.max(gMax, s.G); tMax = Math.max(tMax, s.T); tMin = Math.min(tMin, s.T); }
  }
  assert.ok(sMax < 3 && gMax < 2 && tMax < 1.5 && tMin > 0, JSON.stringify({ sMax, gMax, tMax, tMin }));
  // sweep chart range 40% to 160%
  for (const L of [false, true]) for (const D of [false, true]) for (let d = 0.1; d <= 1.0001; d += 0.02) {
    const r = M.steadyState({ dopamine: d, levodopa: L, dbs: D });
    assert.ok(r.G >= 0.4 && r.G <= 1.6 && r.T >= 0.4 && r.T <= 1.6);
  }
});

test('vigour bands are contiguous and ordered', () => {
  const B = M.BANDS;
  for (let i = 1; i < B.length; i++) assert.equal(B[i].lo, B[i - 1].hi);
  assert.equal(M.vigourBand(0.3).key, 'akinesia');
  assert.equal(M.vigourBand(1).key, 'normal');
  assert.equal(M.vigourBand(2).key, 'excess');
});

test('edge geometry: arrow tip and bar sit on the end point', () => {
  const a = M.edgeGeometry([[0, 0], [0, 100]], 'exc', 2.4);
  assert.match(a.cap, /^0,100 /);
  const b = M.edgeGeometry([[0, 0], [100, 0]], 'inh', 4);
  const xs = b.cap.match(/-?\d+(\.\d+)?/g).map(Number);
  assert.ok(xs[0] < 100 && xs[0] > 95 && xs[0] === xs[2], 'bar perpendicular near the end');
});

test('diagram layout keeps nodes apart at the narrowest and widest widths', () => {
  for (const W of [480, 520, 700, 960, 1300]) {
    const L = M.layoutDiagram(W);
    const N = L.N;
    const boxes = ['D1', 'D2', 'E', 'S', 'G', 'T', 'SNc'].map((k) => N[k]);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const p = boxes[i], q = boxes[j];
      const overlap = p.l < q.r + 8 && q.l < p.r + 8 && p.t < q.b + 8 && q.t < p.b + 8;
      assert.ok(!overlap, 'overlap at W=' + W);
    }
    assert.ok(L.xH + 30 < W, 'hyperdirect label fits at W=' + W);
    assert.ok(N.SNc.l > L.xL + 8, 'SNc clear of the direct pathway at W=' + W);
  }
});

console.log(`\n${passed} tests passed`);
