// Unit tests for explorers/schedule.js. Run: node --test explorers/schedule.test.mjs
// Expected values are worked out by hand from the guide: SC about -2 months, BL 0, V04 12, V06 24,
// V08 36, V10 48, V12 60 (2.3); cognition yearly from BL; DaTScan at SC, 12, 24, 48; processed MRI at
// BL, 24, 48 (4.6); motor exam every 3 months in year 1 then every 6; CSF at baseline, 6 and 12 then yearly (2.3, corrected in doc revision 28).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {} };
vm.runInNewContext(readFileSync(join(here, 'schedule.js'), 'utf8'), sandbox, { filename: 'schedule.js' });
const mod = sandbox.window.PPMIExplorers.schedule;
const L = mod.lib;
const row = (id) => L.ROW_BY_ID[id];
const base = { offset: 0, windowEnd: 66, landmark: 30, includeSC: true };
const pick = (c) => ({ total: c.total, upTo: c.upTo, after: c.after });

test('module registers with the contract shape', () => {
  assert.equal(typeof mod.mount, 'function');
  assert.ok(mod.title.length <= 40, 'title at most 40 characters');
  assert.deepEqual(Object.keys(sandbox.window), ['PPMIExplorers'], 'no other globals');
});

test('visit codes map to the months the guide states, and nothing else is mapped', () => {
  assert.deepEqual({ ...L.VISIT_MONTHS }, { SC: -2, BL: 0, V04: 12, V06: 24, V08: 36, V10: 48, V12: 60 });
  assert.equal(L.codeForMonth(12), 'V04');
  assert.equal(L.codeForMonth(-2), null, 'SC is not looked up by month');
  assert.equal(L.codeForMonth(18), null, 'in-between visits carry no code');
  assert.equal(L.LANDMARK_DEFAULT, 30);
  assert.deepEqual({ ...L.WINDOWS }, { 5: 60, 5.5: 66 });
});

test('motor exam cadence: every 3 months in year 1, then every 6, drawn to 60 months', () => {
  assert.deepEqual(Array.from(L.motorMonths()), [0, 3, 6, 9, 12, 18, 24, 30, 36, 42, 48, 54, 60]);
});

test('rows with no timing in the guide carry no points', () => {
  for (const id of ['moca', 'dti', 'event']) {
    assert.equal(row(id).points, undefined, id);
    assert.equal(L.countRow(row(id), base), null, id);
  }
});

test('counts on a baseline axis, 0 to 5.5 years, landmark 30 months', () => {
  assert.deepEqual(pick(L.countRow(row('cog'), base)), { total: 6, upTo: 3, after: 3 });
  assert.deepEqual(pick(L.countRow(row('dat'), base)), { total: 4, upTo: 3, after: 1 });
  assert.deepEqual(pick(L.countRow(row('gmv'), base)), { total: 3, upTo: 2, after: 1 });
  assert.deepEqual(pick(L.countRow(row('t1'), base)), { total: 1, upTo: 1, after: 0 });
  assert.deepEqual(pick(L.countRow(row('motor'), base)), { total: 13, upTo: 8, after: 5 });
  assert.deepEqual(pick(L.countRow(row('csf'), base)), { total: 7, upTo: 4, after: 3 });
});

test('the screening DaTScan is counted only when chosen; the baseline-coded scan never is', () => {
  const off = { ...base, includeSC: false };
  assert.deepEqual(pick(L.countRow(row('dat'), off)), { total: 3, upTo: 2, after: 1 });
  const items = Array.from(L.countRow(row('dat'), base).items, (i) => i.code);
  assert.deepEqual(items, ['SC', 'V04', 'V06', 'V10']);
});

test('the landmark is inclusive ("data up to about 2.5 years")', () => {
  assert.equal(L.countRow(row('cog'), { ...base, landmark: 24 }).upTo, 3);
  assert.equal(L.countRow(row('cog'), { ...base, landmark: 23 }).upTo, 2);
  assert.equal(L.countRow(row('dat'), { ...base, landmark: 48 }).after, 0);
});

test('on a baseline axis both windows hold the same scheduled measurements', () => {
  assert.equal(L.compareWindows(base).length, 0);
  assert.deepEqual(pick(L.countRow(row('cog'), { ...base, windowEnd: 60 })), { total: 6, upTo: 3, after: 3 });
});

test('on a diagnosis axis the window can matter (diagnosis 18 months before baseline)', () => {
  const dx = { ...base, offset: 18 };
  // cognition at 18, 30, 42, 54, 66, 78; DaTScan at 16, 30, 42, 66; GMV at 18, 42, 66 months since diagnosis
  assert.deepEqual(pick(L.countRow(row('cog'), dx)), { total: 5, upTo: 2, after: 3 });
  assert.deepEqual(pick(L.countRow(row('dat'), dx)), { total: 4, upTo: 2, after: 2 });
  assert.deepEqual(pick(L.countRow(row('gmv'), dx)), { total: 3, upTo: 1, after: 2 });
  const diff = Object.fromEntries(Array.from(L.compareWindows(dx), (d) => [d.id, [d.w55, d.w5]]));
  assert.deepEqual(diff.cog, [5, 4]);
  assert.deepEqual(diff.dat, [4, 3]);
  assert.deepEqual(diff.gmv, [3, 2]);
  // With a 12-month gap the yearly visits land on 60 and 72, so the window does not change them.
  const dx12 = Object.fromEntries(Array.from(L.compareWindows({ ...base, offset: 12 }), (d) => [d.id, [d.w55, d.w5]]));
  assert.equal(dx12.cog, undefined);
  assert.deepEqual(dx12.motor, [12, 11]);
});

test('label stagger separates SC and BL when they would touch', () => {
  const rows = Array.from(L.staggerTags([{ x: 100, w: 30 }, { x: 112, w: 30 }, { x: 200, w: 36 }, { x: 290, w: 36 }], 4));
  assert.deepEqual(rows, [0, 1, 0, 0]);
  assert.deepEqual(Array.from(L.staggerTags([{ x: 10, w: 20 }, { x: 40, w: 20 }], 4)), [0, 0]);
});

test('axis domain covers screening and the shifted schedule', () => {
  assert.deepEqual(Array.from(L.axisDomain(0)), [-6, 70]);
  assert.deepEqual(Array.from(L.axisDomain(24)), [-6, 92]);
});
