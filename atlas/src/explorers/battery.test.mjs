// Unit tests for explorers/battery.js. Run: node --test atlas/src/explorers/battery.test.mjs
//
// The expected numbers below are a hand calculation of code/ppmi_pipeline/css.sql done independently in
// bc (arbitrary precision, scale = 30), not by the JavaScript under test. The bc script:
//
//   define clip(z) { if (z > 3) return 3; if (z < -3) return -3; return z; }
//   define pz(e, s, r) { return (s - e) / r; }
//   /* all centres and quadratic coefficients in css_reference_norms.csv are 0, so: */
//   e1 = 28.37542 + (-0.05979)*a + 1.58306*x                          /* HVLT-R immediate */
//   e2 = 10.92487 + (-0.03996)*a + 0.80139*x                          /* HVLT-R delayed   */
//   e3 = 15.07467 + (-0.02374)*a + (-1.29422)*x + 0.08678*d           /* JLO              */
//   e4 = 12.30761 + (-0.05359)*a + 0.13650*d                          /* LNS              */
//   e5 = 76.80621 + (-0.47289)*a                                      /* SDMT             */
//   e6 = 20.25284 + 1.71525*x                                         /* semantic fluency */
//   z_i = pz(e_i, score_i, rmse_i); css = (clip(z1) + ... + clip(z6)) / 6
//
// Set A (invented): age 64, female (paper code 2), 16 years; scores 24, 8, 12, 9, 38, 19.
// Set B (invented, the capping edge): age 71, male (code 1), 12 years; scores 21, 7, 14, 4, 11, 40.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {} };
vm.runInNewContext(readFileSync(join(here, 'battery.js'), 'utf8'), sandbox, { filename: 'battery.js' });
const mod = sandbox.window.PPMIExplorers.battery;
const L = mod.lib;

const close = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} (tol ${tol})`);

// Verbatim copy of ppmi_pipeline/css_reference_norms.csv (read 10 Nov 2026).
const CSV_COPY = `measure,intercept,age_center,age_linear,age_quadratic,sex_coef,edu_center,edu_linear,edu_quadratic,rmse
hvlt_immediate,28.37542,0,-0.05979,0,1.58306,0,0,0,4.32146
hvlt_delayed,10.92487,0,-0.03996,0,0.80139,0,0,0,2.12293
jlo,15.07467,0,-0.02374,0,-1.29422,0,0.08678,0,1.77892
lns,12.30761,0,-0.05359,0,0,0,0.13650,0,2.68988
sdmt,76.80621,0,-0.47289,0,0,0,0,0,8.95934
semantic,20.25284,0,0,0,1.71525,0,0,0,5.49634
`;
function parseCsv(text) {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(',');
  const out = {};
  for (const line of lines) {
    const cells = line.split(',');
    const row = {};
    cols.slice(1).forEach((c, i) => { row[c] = Number(cells[i + 1]); });
    out[cells[0].trim().toLowerCase()] = row;
  }
  return out;
}

test('module registers with the contract shape', () => {
  assert.equal(typeof mod.mount, 'function');
  assert.ok(mod.title.length <= 40, 'title at most 40 characters');
  assert.ok(mod.blurb.length > 10);
  assert.deepEqual(Object.keys(sandbox.window), ['PPMIExplorers'], 'no other globals');
});

test('embedded norms equal css_reference_norms.csv exactly', () => {
  const sources = [['inline copy', CSV_COPY]];
  const real = new URL('../../../code/ppmi_pipeline/css_reference_norms.csv', import.meta.url);
  if (existsSync(real)) sources.push(['ppmi_pipeline file', readFileSync(real, 'utf8')]);
  for (const [label, text] of sources) {
    const parsed = parseCsv(text);
    assert.deepEqual(Object.keys(parsed).sort(), [...L.MEASURES].sort(), `${label}: same measures`);
    for (const m of L.MEASURES) {
      for (const [k, v] of Object.entries(parsed[m])) {
        assert.ok(Object.is(L.NORMS[m][k], v), `${label}: ${m}.${k} is ${L.NORMS[m][k]}, CSV says ${v}`);
      }
      assert.equal(Object.keys(L.NORMS[m]).length, 9, `${m} has the nine norm columns`);
    }
  }
});

test('set A matches the bc hand calculation of css.sql', () => {
  const cov = L.prepareCovariates({ age: 64, sex: 2, education: 16 });
  const scores = { hvlt_immediate: 24, hvlt_delayed: 8, jlo: 12, lns: 9, sdmt: 38, semantic: 19 };
  const res = L.scoreCSS(cov, scores);
  const expected = [27.71498, 9.97021, 12.35535, 11.06185, 46.54125, 23.68334];
  const z = [-0.859658541326311015, -0.928061688326982048, -0.199756031749600881,
    -0.766521183101104882, -0.953334732245902042, -0.852083386398949119];
  res.rows.forEach((r, i) => {
    close(r.expected, expected[i], 1e-10, `${r.measure} expected`);
    close(r.z, z[i], 1e-12, `${r.measure} z`);
    assert.equal(r.capped, false, `${r.measure} not capped`);
    assert.equal(r.zUsed, r.z);
  });
  close(res.css, -0.759902593858141665, 1e-12, 'CSS');
  assert.equal(res.nFinite, 6);
});

test('set B (capping edge) matches the bc hand calculation, with z capped at -3 and +3', () => {
  const cov = L.prepareCovariates({ age: 71, sex: 1, education: 12 });
  const scores = { hvlt_immediate: 21, hvlt_delayed: 7, jlo: 14, lns: 4, sdmt: 11, semantic: 40 };
  const res = L.scoreCSS(cov, scores);
  const expected = [25.71339, 8.88910, 13.13627, 10.14072, 43.23102, 21.96809];
  const z = [-1.090693885862648272, -0.889855058810229259, 0.485536168012052256,
    -2.282897378321709519, -3.597477046300285512, 3.280712255792036155];
  res.rows.forEach((r, i) => {
    close(r.expected, expected[i], 1e-10, `${r.measure} expected`);
    close(r.z, z[i], 1e-12, `${r.measure} raw z`);
  });
  const sdmt = res.rows.find((r) => r.measure === 'sdmt');
  const sem = res.rows.find((r) => r.measure === 'semantic');
  assert.equal(sdmt.zUsed, -3); assert.equal(sdmt.capped, true);
  assert.equal(sem.zUsed, 3); assert.equal(sem.capped, true);
  assert.equal(res.rows.filter((r) => r.capped).length, 2);
  close(res.css, -0.629651692497089132, 1e-12, 'CSS with capping');
  const unclipped = res.rows.reduce((s, r) => s + r.z, 0) / 6;
  close(unclipped, -0.682445824248464025, 1e-12, 'mean without capping (differs, as it should)');
});

test('the cap is greatest(-3, least(3, z)): inclusive at the boundary, exact outside it', () => {
  assert.equal(L.capZ(3), 3);
  assert.equal(L.capZ(-3), -3);
  assert.equal(L.capZ(3.0000001), 3);
  assert.equal(L.capZ(-3.0000001), -3);
  assert.equal(L.capZ(2.9999999), 2.9999999);
  assert.equal(L.capZ(-2.9999999), -2.9999999);
  assert.equal(L.capZ(0), 0);
  // A score built to sit exactly 3 residual errors above the expected score.
  const n = L.NORMS.sdmt;
  const e = L.expectedScore(n, 64, 2, 16);
  const res = L.scoreCSS({ age: 64, sex: 2, education: 16 },
    { hvlt_immediate: 24, hvlt_delayed: 8, jlo: 12, lns: 9, sdmt: e + 3 * n.rmse, semantic: 19 });
  const row = res.rows.find((r) => r.measure === 'sdmt');
  close(row.z, 3, 1e-12, 'boundary z');
  assert.ok(row.zUsed <= 3 && Math.abs(row.zUsed - 3) < 1e-12);
});

test('JLO_TOTCALC pitfall: doubling the raw score (set A) gives the bc values', () => {
  const cov = L.prepareCovariates({ age: 64, sex: 2, education: 16 });
  const res = L.scoreCSS(cov, { hvlt_immediate: 24, hvlt_delayed: 8, jlo: 24, lns: 9, sdmt: 38, semantic: 19 });
  const jlo = res.rows.find((r) => r.measure === 'jlo');
  close(jlo.z, 6.545909877903447035, 1e-12, 'JLO z on the doubled scale');
  assert.equal(jlo.zUsed, 3);
  close(res.css, -0.226609921899874851, 1e-12, 'CSS with the doubled JLO');
});

test('missing covariates follow the CASE WHEN coef = 0 guards in css.sql', () => {
  const scores = { hvlt_immediate: 24, hvlt_delayed: 8, jlo: 12, lns: 9, sdmt: 38, semantic: 19 };
  // Array.from copies into this realm (arrays built inside the vm sandbox have another prototype).
  const nullOf = (res) => Array.from(res.rows.filter((r) => r.z === null), (r) => r.measure);
  // No education: only JLO and LNS have an education coefficient.
  let res = L.scoreCSS(L.prepareCovariates({ age: 64, sex: 2, education: null }), scores);
  assert.deepEqual(nullOf(res), ['jlo', 'lns']);
  assert.equal(res.css, null); assert.equal(res.nFinite, 4);
  // No sex: LNS and SDMT have no sex term, so they survive.
  res = L.scoreCSS(L.prepareCovariates({ age: 64, sex: null, education: 16 }), scores);
  assert.deepEqual(nullOf(res), ['hvlt_immediate', 'hvlt_delayed', 'jlo', 'semantic']);
  assert.equal(res.css, null);
  // Age outside 18..120 becomes NULL (css.py); only semantic fluency has no age term.
  res = L.scoreCSS(L.prepareCovariates({ age: 17, sex: 2, education: 16 }), scores);
  assert.deepEqual(nullOf(res), ['hvlt_immediate', 'hvlt_delayed', 'jlo', 'lns', 'sdmt']);
  // A missing score: five finite z-scores, so no CSS (HAVING count(*) = 6).
  res = L.scoreCSS(L.prepareCovariates({ age: 64, sex: 2, education: 16 }), { ...scores, lns: null });
  assert.equal(res.nFinite, 5); assert.equal(res.css, null);
});

test('covariate preparation mirrors css.py', () => {
  assert.equal(L.guardAge(17.9), null);
  assert.equal(L.guardAge(18), 18);
  assert.equal(L.guardAge(64.5), 64.5);
  assert.equal(L.guardAge(120), 120);
  assert.equal(L.guardAge(120.1), null);
  // IDA female 0 -> 2, male 1 -> 1.
  assert.equal(L.paperSexCode(0), 2);
  assert.equal(L.paperSexCode(1), 1);
  assert.equal(L.paperSexCode('0'), 2);
  assert.equal(L.paperSexCode('1'), 1);
  assert.equal(L.paperSexCode('1.0'), 1);
  assert.equal(L.paperSexCode('M'), 1);
  assert.equal(L.paperSexCode('Female'), 2);
  assert.equal(L.paperSexCode(2), null);
  assert.equal(L.paperSexCode(''), null);
  assert.equal(L.paperSexCode(null), null);
});

test('score cleaning uses the guide 4.2 ranges', () => {
  assert.equal(L.cleanScore('hvlt_immediate', 36).status, 'ok');
  assert.equal(L.cleanScore('hvlt_immediate', 37).status, 'range');
  assert.equal(L.cleanScore('jlo', 15).status, 'ok');
  assert.equal(L.cleanScore('jlo', 16).status, 'range');
  assert.equal(L.cleanScore('sdmt', -1).status, 'range');
  assert.equal(L.cleanScore('semantic', 80).status, 'ok');
  assert.equal(L.cleanScore('lns', null).status, 'missing');
});

test('examples in the UI are the two tested sets', () => {
  assert.deepEqual({ ...L.EXAMPLES.A, scores: { ...L.EXAMPLES.A.scores } },
    { age: 64, sex: 2, education: 16, scores: { hvlt_immediate: 24, hvlt_delayed: 8, jlo: 12, lns: 9, sdmt: 38, semantic: 19 } });
  assert.deepEqual({ ...L.EXAMPLES.B, scores: { ...L.EXAMPLES.B.scores } },
    { age: 71, sex: 1, education: 12, scores: { hvlt_immediate: 21, hvlt_delayed: 7, jlo: 14, lns: 4, sdmt: 11, semantic: 40 } });
});

test('helpers: signed format, norm sentence, bar path', () => {
  assert.equal(L.fmtSigned(-0.759902, 2), '−0.76');
  assert.equal(L.fmtSigned(0.004, 2), '0.00');
  assert.equal(L.fmtSigned(-0.004, 2), '0.00');
  assert.equal(L.fmtSigned(3, 0), '+3');
  assert.match(L.normSentence(L.NORMS.sdmt), /−0\.473 per year of age; no sex term; no education term/);
  assert.match(L.normSentence(L.NORMS.semantic), /no age term; women \+1\.72 relative to men/);
  assert.equal(L.barPath(10, 10.2, 0, 16, 4), '');
  assert.match(L.barPath(100, 160, 0, 16, 4), /^M100,0H156A4,4 0 0 1 160,4/);
  assert.match(L.barPath(100, 40, 0, 16, 4), /^M100,0H44A4,4 0 0 0 40,4/);
});
