/* PPMI Atlas explorer: "DaTScan: what the binding ratios mean".
   Plain ES2020, no build step, no libraries, no network. Registers window.PPMIExplorers.datscan.
   Every number here comes from a small illustrative simulation, never from PPMI data. */
(function () {
  'use strict';

  const NAME = 'datscan';
  const X = (window.PPMIExplorers = window.PPMIExplorers || {});
  const SVGNS = 'http://www.w3.org/2000/svg';
  let instanceCount = 0;
  let liveInstances = 0;

  /* ==================================================================
   * 1. Illustrative binding model and SBR maths (pure; tested in datscan.test.mjs)
   * ================================================================== */
  const PARAMS = Object.freeze({
    // Healthy SBR at age 40 on the occipital-reference scale (illustrative values).
    e40: Object.freeze({ caudate: 3.5, putamen: 2.7 }),
    // Guide 4.3: binding falls about 8% per decade in healthy ageing (van Dyck et al. 1995),
    // fairly evenly across caudate and putamen (van Dyck et al. 2002). Applied as a straight line:
    // each decade removes 8% of the age-40 value.
    agePerDecade: 0.08,
    // Disease: remaining fraction at a striatal point = floor + (1 - floor) * exp(-lambda * v * S).
    floor: 0.15,      // measured binding bottoms out here, as a fraction of expected (illustrative)
    lambda: 0.2,      // per year of disease (illustrative)
    t0: 8.5,          // years-equivalent of loss already present at motor onset (illustrative)
    vCaudate: 0.25,   // vulnerability of the caudate
    vPutAnt: 0.45,    // vulnerability at the front of the putamen; it rises linearly to 1 at the back
    // Counts (mean counts per voxel, arbitrary units). Target = background * (1 + SBR on the occipital scale).
    background: 100,
    ref: Object.freeze({ occ: 100, cwm: 115 }), // 115 is an arbitrary illustrative offset, not a measured one
    band: Object.freeze([0.8, 1.2]),            // illustrative healthy range around the expected value
    dCut: 0.75,                                  // NSD-ISS D: lowest putamen below 75% of expected (Dam et al. 2024; guide 2.2, 6.2)
    yearsMax: 10,
  });

  const REGIONS = Object.freeze(['L_caudate', 'L_putamen', 'R_caudate', 'R_putamen']);
  const REGION_NAME = Object.freeze({ L_caudate: 'Left caudate', L_putamen: 'Left putamen', R_caudate: 'Right caudate', R_putamen: 'Right putamen' });
  const METHOD = Object.freeze({
    occ: { name: 'Occipital cortex', lab: 'Invicro archive', short: 'occipital' },
    cwm: { name: 'Cerebral white matter', lab: 'XingImaging, since November 2024', short: 'white matter' },
  });

  // SBR = target / reference - 1 (guide 4.3)
  function sbrFromCounts(target, reference) { return target / reference - 1; }

  // Expected healthy SBR for a region at an age, on the occipital scale.
  function expectedOcc(kind, age, p) {
    p = p || PARAMS;
    return p.e40[kind] * (1 - p.agePerDecade * (age - 40) / 10);
  }
  function countsFromOcc(sbrOcc, p) { p = p || PARAMS; return p.background * (1 + sbrOcc); }
  // The same simulated scan quantified against another reference region.
  function toMethod(sbrOcc, method, p) { p = p || PARAMS; return sbrFromCounts(countsFromOcc(sbrOcc, p), p.ref[method]); }

  function vPutamen(u, p) { p = p || PARAMS; return p.vPutAnt + (1 - p.vPutAnt) * u; } // u: 0 front, 1 back
  function localFraction(v, S, p) { p = p || PARAMS; return p.floor + (1 - p.floor) * Math.exp(-p.lambda * v * S); }
  // Mean over the whole putamen (u uniform on [0, 1]), in closed form.
  function putamenFraction(S, p) {
    p = p || PARAMS;
    const x = p.lambda * S, a = p.vPutAnt, b = 1 - p.vPutAnt;
    const m = x * b < 1e-9 ? Math.exp(-x * a) : Math.exp(-x * a) * (1 - Math.exp(-x * b)) / (x * b);
    return p.floor + (1 - p.floor) * m;
  }
  function caudateFraction(S, p) { p = p || PARAMS; return localFraction(p.vCaudate, S, p); }
  // Disease severity (years-equivalent) in one hemisphere. Contralateral = opposite the more affected limbs.
  function severity(years, contralateral, asym, p) { p = p || PARAMS; return (p.t0 + years) * (contralateral ? 1 : 1 - asym); }

  // What the eye sees on one side: posterior putamen relative to the caudate (illustrative cut-offs).
  function shapeOf(fPost, fCaud) {
    const r = fPost / fCaud;
    if (r >= 0.66) return { key: 'comma', text: 'comma' };
    if (r >= 0.42) return { key: 'fading', text: 'comma, tail fading' };
    return { key: 'fullstop', text: 'full stop' };
  }

  /* o = { years, asym (0..0.6), worse: 'right'|'left' (more affected limbs), age, method: 'occ'|'cwm', healthy } */
  function scan(o, p) {
    p = p || PARAMS;
    const contraSide = o.worse === 'right' ? 'L' : 'R';
    const out = { regions: {}, sides: {}, contraSide: contraSide, method: o.method };
    for (const side of ['L', 'R']) {
      const contra = side === contraSide;
      const S = o.healthy ? 0 : severity(o.years, contra, o.asym, p);
      const f = o.healthy ? { caudate: 1, putamen: 1 } : { caudate: caudateFraction(S, p), putamen: putamenFraction(S, p) };
      const post = o.healthy ? 1 : localFraction(vPutamen(0.9, p), S, p);
      out.sides[side] = { S: S, contra: contra, fCaud: f.caudate, fPost: post, shape: shapeOf(post, f.caudate) };
      for (const kind of ['caudate', 'putamen']) {
        const key = side + '_' + kind;
        const eOcc = expectedOcc(kind, o.age, p);
        const sOcc = eOcc * f[kind];
        const target = countsFromOcc(sOcc, p);
        const reference = p.ref[o.method];
        const sbr = sbrFromCounts(target, reference);
        const expected = toMethod(eOcc, o.method, p);
        out.regions[key] = {
          key: key, side: side, kind: kind, contra: contra, fraction: f[kind],
          sbrOcc: sOcc, target: target, reference: reference, sbr: sbr, expected: expected,
          pct: sbr / expected, belowD: sbr / expected < p.dCut,
          other: toMethod(sOcc, o.method === 'occ' ? 'cwm' : 'occ', p),
        };
      }
    }
    const R = out.regions;
    const mean = (a, b) => (a + b) / 2;
    const ms = (R.L_caudate.sbr + R.L_putamen.sbr + R.R_caudate.sbr + R.R_putamen.sbr) / 4;
    const msE = (R.L_caudate.expected + R.L_putamen.expected + R.R_caudate.expected + R.R_putamen.expected) / 4;
    out.summary = {
      meanStriatum: ms, meanStriatumPct: ms / msE,
      pcL: R.L_putamen.sbr / R.L_caudate.sbr, pcR: R.R_putamen.sbr / R.R_caudate.sbr,
      pcHealthy: R.L_putamen.expected / R.L_caudate.expected,
      asymPut: (R.L_putamen.sbr - R.R_putamen.sbr) / mean(R.L_putamen.sbr, R.R_putamen.sbr),
      contraPut: R[contraSide + '_putamen'],
    };
    return out;
  }

  // Percent of expected through time for the four regions plus the posterior putamen (opposite side).
  function timeCourse(o, p) {
    p = p || PARAMS;
    const rows = [];
    const eP = expectedOcc('putamen', o.age, p), eC = expectedOcc('caudate', o.age, p);
    const pctOf = (fraction, eOcc) => toMethod(eOcc * fraction, o.method, p) / toMethod(eOcc, o.method, p);
    for (let i = 0; i <= 100; i++) {
      const t = (i / 100) * p.yearsMax;
      const Sc = severity(t, true, o.asym, p), Si = severity(t, false, o.asym, p);
      rows.push({
        t: t,
        putC: pctOf(putamenFraction(Sc, p), eP), putI: pctOf(putamenFraction(Si, p), eP),
        cauC: pctOf(caudateFraction(Sc, p), eC), cauI: pctOf(caudateFraction(Si, p), eC),
        postC: pctOf(localFraction(vPutamen(0.9, p), Sc, p), eP),
      });
    }
    return { rows: rows, floorPct: pctOf(p.floor, eP) };
  }

  /* ==================================================================
   * 2. Schematic geometry (mm; patient's left hemisphere, drawn on the viewer's right).
   *    Simple smooth shapes, no anatomy beyond the comma.
   * ================================================================== */
  const GEO = Object.freeze({
    caudate: [[4, -19], [8.5, -24.5], [13.5, -22.5], [14.5, -15], [13, -7.5], [9.5, -3.5], [6.5, -5.5], [4.5, -11]],
    putamen: [[16.5, -17], [20.5, -20.5], [25, -17], [28.5, -8], [30, 2], [29.5, 11], [27, 17.5], [24.5, 16], [23, 9], [21, 0], [18.5, -8], [16, -13]],
    putAxis: [[20.5, -19.5], [27.3, 17.2]],   // front to back, for the colour gradient
    brain: { cx: 0, cy: 6, rx: 66, ry: 84 },
    fov: { x0: -72, x1: 72, y0: -80, y1: 92 },
    occY: 60,                                  // the occipital cap is drawn behind this line
  });

  /* ==================================================================
   * 3. Styles
   * ================================================================== */
  const CSS = `
.datscan-root{font-family:var(--font-ui);color:var(--fg);font-size:14px;line-height:1.45}
.datscan-root *,.datscan-root *::before,.datscan-root *::after{box-sizing:border-box}
.datscan-root :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.datscan-layout{display:flex;flex-direction:column;gap:14px}
.datscan-col{display:contents}
.datscan-root.datscan-is-wide .datscan-layout{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(400px,1fr);gap:18px;align-items:start}
.datscan-root.datscan-is-wide .datscan-col{display:flex;flex-direction:column;gap:14px;min-width:0}
.datscan-controls{order:1}.datscan-slices{order:2}.datscan-formula{order:3}.datscan-bars{order:4}.datscan-summary{order:5}.datscan-time{order:6}
.datscan-card{background:var(--surface);border:1px solid var(--rule);border-radius:10px;padding:14px 16px;margin:0;min-width:0}
.datscan-notes{margin-top:14px}
.datscan-h{font-size:15px;font-weight:600;margin:0 0 6px}
.datscan-howto{font-size:13px;color:var(--muted);margin:0 0 10px}
.datscan-howto b{color:var(--fg);font-weight:600}
.datscan-sim{font-size:12px;color:var(--muted);margin:8px 0 0;font-style:italic}
.datscan-hint{font-size:12px;color:var(--muted);margin:4px 0 0;line-height:1.45}
.datscan-cgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px 22px}
.datscan-ctrl-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.datscan-ctrl-head label,.datscan-legend-t{font-size:13px;font-weight:600}
.datscan-ctrl output{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--accent)}
.datscan-range{width:100%;margin:6px 0 0;accent-color:var(--accent);cursor:pointer}
.datscan-scale{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.datscan-fs{border:none;margin:0;padding:0;min-width:0}
.datscan-fs legend{padding:0;font-size:13px;font-weight:600;margin-bottom:6px}
.datscan-radios{display:flex;flex-wrap:wrap;gap:6px 14px}
.datscan-radios.datscan-stack{flex-direction:column;gap:6px}
.datscan-radio{display:flex;gap:7px;align-items:flex-start;font-size:13px;cursor:pointer}
.datscan-radio input,.datscan-check input{accent-color:var(--accent);margin:2px 0 0;width:15px;height:15px;flex:none;cursor:pointer}
.datscan-radio small{display:block;color:var(--muted);font-size:12px}
.datscan-check{display:flex;gap:8px;align-items:flex-start;font-size:13px;font-weight:600;cursor:pointer}
.datscan-slicegrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.datscan-slicecap{font-size:13px;font-weight:600;margin:0 0 4px}
.datscan-slicecap span{font-weight:400;color:var(--muted)}
.datscan-slicehost svg{display:block;width:100%;height:auto;overflow:visible}
.datscan-shape{font-size:12px;color:var(--fg);margin:4px 0 0}
.datscan-shape b{font-weight:600}
.datscan-cbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:var(--muted)}
.datscan-cbar svg{display:block}
.datscan-formula-row{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin-bottom:10px}
.datscan-formula-row label{font-size:13px;font-weight:600}
.datscan-select{font:500 13px var(--font-ui);color:var(--fg);background:var(--surface);border:1px solid var(--axis);border-radius:7px;padding:5px 8px;cursor:pointer}
.datscan-eq{font-family:var(--font-mono);font-size:15px;line-height:1.7;background:var(--tint);border:1px solid var(--rule);border-radius:8px;padding:10px 12px;overflow-x:auto;white-space:nowrap}
.datscan-eq .datscan-big{font-size:20px;font-weight:600;color:var(--accent)}
.datscan-eq .datscan-mut{color:var(--muted)}
.datscan-facts{margin:10px 0 0;padding:0;list-style:none;font-size:13px}
.datscan-facts li{margin:5px 0;line-height:1.45}
.datscan-num{font-variant-numeric:tabular-nums;font-weight:600}
.datscan-flag{display:inline-block;font-size:12px;font-weight:600;padding:1px 7px;border-radius:999px;border:1px solid currentColor;margin-left:4px}
.datscan-flag.datscan-low{color:var(--critical)}
.datscan-flag.datscan-ok{color:var(--good)}
.datscan-chart svg{display:block;overflow:visible}
.datscan-legend{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12px;color:var(--muted);margin-top:8px}
.datscan-legend span{display:inline-flex;align-items:center;gap:6px}
.datscan-legend svg{flex:none}
.datscan-table{width:100%;border-collapse:collapse;font-size:13px}
.datscan-table th{text-align:left;font-weight:500;color:var(--muted);padding:6px 10px 6px 0;vertical-align:top;border-top:1px solid var(--rule)}
.datscan-table td{padding:6px 0;vertical-align:top;border-top:1px solid var(--rule)}
.datscan-table tr:first-child th,.datscan-table tr:first-child td{border-top:none}
.datscan-link{font:600 12px/1.2 var(--font-ui);color:var(--accent);background:none;border:none;padding:2px 0;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.datscan-links{display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:10px}
.datscan-notes summary{cursor:pointer;font-size:13px;font-weight:600}
.datscan-notes p{font-family:var(--font-body);font-size:13px;line-height:1.55;margin:8px 0 0;max-width:90ch}
.datscan-notes pre{font-family:var(--font-mono);font-size:12px;line-height:1.6;background:var(--tint);border:1px solid var(--rule);border-radius:8px;padding:10px 12px;margin:10px 0 0;overflow-x:auto;color:var(--fg)}
.datscan-root svg text{font-family:var(--font-ui);font-size:12px;fill:var(--muted)}
.datscan-root svg .datscan-t-tick{font-variant-numeric:tabular-nums}
.datscan-root svg .datscan-t-lab{fill:var(--fg);font-size:12px}
.datscan-root svg .datscan-t-strong{fill:var(--fg);font-size:13px;font-weight:600}
.datscan-root svg .datscan-t-crit{fill:var(--critical);font-weight:600}
.datscan-root svg .datscan-t-halo{paint-order:stroke;stroke:var(--surface);stroke-width:3px;stroke-linejoin:round}
.datscan-hit{cursor:pointer}
.datscan-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
`;

  function ensureStyle() {
    if (document.getElementById('style-' + NAME)) return;
    const s = document.createElement('style');
    s.id = 'style-' + NAME;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ==================================================================
   * 4. Helpers
   * ================================================================== */
  function svgEl(tag, attrs, parent) {
    const n = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function svgText(parent, x, y, str, cls, anchor) {
    const t = svgEl('text', { x: r1(x), y: r1(y) }, parent);
    if (cls) t.setAttribute('class', cls);
    if (anchor) t.setAttribute('text-anchor', anchor);
    t.textContent = str;
    return t;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function pct(v) { return Math.round(v * 100) + '%'; }
  function f2(v) { return v.toFixed(2); }
  function pathFrom(pts) {
    let d = '';
    for (let i = 0; i < pts.length; i++) d += (i ? 'L' : 'M') + r1(pts[i][0]) + ',' + r1(pts[i][1]);
    return d;
  }
  // Closed Catmull-Rom spline through points, as cubic Beziers.
  function closedSpline(pts) {
    const n = pts.length;
    let d = 'M' + r1(pts[0][0]) + ',' + r1(pts[0][1]);
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += 'C' + r1(c1[0]) + ',' + r1(c1[1]) + ' ' + r1(c2[0]) + ',' + r1(c2[1]) + ' ' + r1(p2[0]) + ',' + r1(p2[1]);
    }
    return d + 'Z';
  }
  // Perceptually ordered scale built from the tokens: surface-2 (none) -> accent -> accent deepened with fg.
  function bindColor(v) {
    v = clamp(v, 0, 1);
    if (v <= 0.75) return 'color-mix(in oklab, var(--accent) ' + (v / 0.75 * 100).toFixed(1) + '%, var(--surface-2))';
    return 'color-mix(in oklab, var(--fg) ' + ((v - 0.75) / 0.25 * 38).toFixed(1) + '%, var(--accent))';
  }
  const COLOR_MAX = 3.0; // top of the colour scale (SBR on the occipital scale), about a healthy caudate at 60

  /* ==================================================================
   * 5. Mount
   * ================================================================== */
  function mount(el, ctx) {
    ensureStyle();
    liveInstances++;
    const uid = ++instanceCount;
    const id = (s) => NAME + '-' + s + '-' + uid;
    const openSection = (sid) => { if (ctx && typeof ctx.openSection === 'function') ctx.openSection(sid); };

    const state = { years: 2, asym: 0.3, worse: 'right', age: 60, method: 'occ', blur: true, region: 'L_putamen' };
    let regionTouched = false;
    let raf = 0, layoutRaf = 0;
    let slices = null, widths = { slices: 0, bars: 0, time: 0 };

    const root = document.createElement('div');
    root.className = NAME + '-root';
    el.appendChild(root);
    root.innerHTML = template(id);
    const q = (s) => root.querySelector(s);
    const ui = {
      years: q('#' + id('years')), yearsOut: q('#' + id('years-out')),
      asym: q('#' + id('asym')), asymOut: q('#' + id('asym-out')),
      age: q('#' + id('age')), ageOut: q('#' + id('age-out')),
      blur: q('#' + id('blur')), region: q('#' + id('region')),
      sliceHosts: [q('#' + id('slice-h')), q('#' + id('slice-p'))],
      sliceCaps: [q('#' + id('cap-h')), q('#' + id('cap-p'))],
      shapes: [q('#' + id('shape-h')), q('#' + id('shape-p'))],
      refNote: q('#' + id('refnote')), cbar: q('#' + id('cbar')),
      eq: q('#' + id('eq')), facts: q('#' + id('facts')),
      bars: q('#' + id('bars')), barLegend: q('#' + id('bar-legend')),
      summary: q('#' + id('summary')),
      time: q('#' + id('time')), timeLegend: q('#' + id('time-legend')),
      live: q('#' + id('live')),
    };
    buildColorbar();

    /* ---------- events ---------- */
    function onInput(e) {
      const t = e.target;
      if (t === ui.years) state.years = Number(t.value);
      else if (t === ui.asym) state.asym = Number(t.value) / 100;
      else if (t === ui.age) state.age = Number(t.value);
      else return;
      schedule();
    }
    function onChange(e) {
      const t = e.target;
      if (t.name === id('worse')) {
        state.worse = t.value;
        if (!regionTouched) { state.region = (t.value === 'right' ? 'L' : 'R') + '_putamen'; ui.region.value = state.region; }
      } else if (t.name === id('method')) state.method = t.value;
      else if (t === ui.blur) state.blur = t.checked;
      else if (t === ui.region) { state.region = t.value; regionTouched = true; }
      else return;
      if (t === ui.blur) buildSlices();
      schedule();
    }
    function onClick(e) {
      const sec = e.target.closest('[data-section]');
      if (sec && root.contains(sec)) { openSection(sec.getAttribute('data-section')); return; }
      const hit = e.target.closest('[data-region]');
      if (hit && root.contains(hit)) {
        state.region = hit.getAttribute('data-region');
        regionTouched = true;
        ui.region.value = state.region;
        schedule();
      }
    }
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('click', onClick);

    const ro = new ResizeObserver(() => { if (!layoutRaf) layoutRaf = requestAnimationFrame(relayout); });
    ro.observe(el);

    function relayout() {
      layoutRaf = 0;
      const w = el.clientWidth || el.getBoundingClientRect().width || 900;
      root.classList.toggle(NAME + '-is-wide', w >= 1100);
      const sw = Math.floor(ui.sliceHosts[1].clientWidth);
      if (sw > 0 && sw !== widths.slices) { widths.slices = sw; buildSlices(); }
      widths.bars = Math.floor(ui.bars.clientWidth);
      widths.time = Math.floor(ui.time.clientWidth);
      render();
    }
    function schedule() {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; render(); });
    }

    /* ---------- slices ---------- */
    function buildSlices() {
      const W = Math.max(200, widths.slices || ui.sliceHosts[1].clientWidth || 300);
      const fov = GEO.fov, s = W / (fov.x1 - fov.x0);
      const H = Math.round((fov.y1 - fov.y0) * s);
      const P = (x, y) => [(x - fov.x0) * s, (y - fov.y0) * s];
      const made = [];
      ['h', 'p'].forEach((kind, k) => {
        const host = ui.sliceHosts[k];
        clear(host);
        const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img' }, host);
        const defs = svgEl('defs', {}, svg);
        const blurId = id('blur-' + kind), hatchId = id('hatch-' + kind);
        const filt = svgEl('filter', { id: blurId, x: '-60%', y: '-60%', width: '220%', height: '220%', 'color-interpolation-filters': 'sRGB' }, defs);
        // SPECT resolution about 1 cm (guide 4.3): FWHM 10 mm, so sigma = 10 / 2.355 mm
        svgEl('feGaussianBlur', { stdDeviation: r1((10 / 2.355) * s) }, filt);
        const pat = svgEl('pattern', { id: hatchId, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
        svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: 'var(--muted)', 'stroke-width': 1.3, 'stroke-opacity': 0.55 }, pat);
        const grads = {};
        for (const side of ['L', 'R']) {
          const sg = side === 'L' ? 1 : -1;
          const a = P(sg * GEO.putAxis[0][0], GEO.putAxis[0][1]), b = P(sg * GEO.putAxis[1][0], GEO.putAxis[1][1]);
          const g = svgEl('linearGradient', { id: id('g-' + kind + side), gradientUnits: 'userSpaceOnUse', x1: r1(a[0]), y1: r1(a[1]), x2: r1(b[0]), y2: r1(b[1]) }, defs);
          const stops = [];
          for (let i = 0; i <= 5; i++) stops.push(svgEl('stop', { offset: (i / 5).toFixed(2) }, g));
          grads[side] = stops;
        }
        // brain outline (nonspecific background), midline
        const bc = P(GEO.brain.cx, GEO.brain.cy);
        svgEl('ellipse', { cx: r1(bc[0]), cy: r1(bc[1]), rx: r1(GEO.brain.rx * s), ry: r1(GEO.brain.ry * s), fill: 'var(--surface-2)', stroke: 'var(--axis)', 'stroke-width': 1 }, svg);
        const m0 = P(0, GEO.brain.cy - GEO.brain.ry + 6), m1 = P(0, GEO.occY - 4);
        svgEl('line', { x1: r1(m0[0]), y1: r1(m0[1]), x2: r1(m1[0]), y2: r1(m1[1]), stroke: 'var(--axis)', 'stroke-width': 0.8, 'stroke-dasharray': '3 4' }, svg);
        // occipital reference cap
        const occG = svgEl('g', {}, svg);
        const dy = (GEO.occY - GEO.brain.cy) / GEO.brain.ry;
        const hx = GEO.brain.rx * Math.sqrt(1 - dy * dy);
        const c0 = P(-hx, GEO.occY), c1 = P(hx, GEO.occY);
        svgEl('path', { d: 'M' + r1(c0[0]) + ',' + r1(c0[1]) + 'A' + r1(GEO.brain.rx * s) + ',' + r1(GEO.brain.ry * s) + ' 0 0 0 ' + r1(c1[0]) + ',' + r1(c1[1]) + 'Z', fill: 'url(#' + hatchId + ')', stroke: 'var(--muted)', 'stroke-width': 1, 'stroke-dasharray': '4 3' }, occG);
        const ol = P(0, GEO.occY + 15);
        svgText(occG, ol[0], ol[1], W >= 250 ? 'Occipital reference' : 'Reference', 'datscan-t-lab datscan-t-halo', 'middle');
        // striatal shapes
        const blurG = svgEl('g', {}, svg);
        if (state.blur) blurG.setAttribute('filter', 'url(#' + blurId + ')');
        const shapes = {}, outlines = {};
        const outG = svgEl('g', {}, svg);
        const hitG = svgEl('g', {}, svg);
        for (const side of ['L', 'R']) {
          const sg = side === 'L' ? 1 : -1;
          for (const kindR of ['caudate', 'putamen']) {
            const pts = GEO[kindR].map((q2) => P(sg * q2[0], q2[1]));
            const d = closedSpline(pts);
            const key = side + '_' + kindR;
            shapes[key] = svgEl('path', { d: d, fill: kindR === 'putamen' ? 'url(#' + id('g-' + kind + side) + ')' : 'var(--accent)' }, blurG);
            outlines[key] = svgEl('path', { d: d, fill: 'none', stroke: 'var(--fg)', 'stroke-width': 0.8, 'stroke-opacity': 0.45 }, outG);
            if (kind === 'p') {
              const hit = svgEl('path', { d: d, fill: 'transparent', class: NAME + '-hit', 'data-region': key }, hitG);
              const tt = svgEl('title', {}, hit);
              tt.textContent = REGION_NAME[key] + ' (click to show its SBR maths)';
            }
          }
        }
        const yMid = P(0, -2)[1];
        svgText(svg, 4, yMid, 'R', 'datscan-t-strong', 'start');
        svgText(svg, W - 4, yMid, 'L', 'datscan-t-strong', 'end');
        made.push({ svg: svg, grads: grads, shapes: shapes, outlines: outlines, occ: occG, blurG: blurG });
      });
      slices = made;
    }

    function paintSlices(res) {
      if (!slices) return;
      const sel = state.region;
      [res.healthy, res.pd].forEach((r, k) => {
        const sl = slices[k];
        for (const side of ['L', 'R']) {
          const sd = r.sides[side];
          const eP = expectedOcc('putamen', state.age), eC = expectedOcc('caudate', state.age);
          sl.shapes[side + '_caudate'].style.fill = bindColor((eC * sd.fCaud) / COLOR_MAX);
          sl.grads[side].forEach((stop, i) => {
            const u = i / 5;
            const f = sd.S === 0 ? 1 : localFraction(vPutamen(u), sd.S);
            stop.style.stopColor = bindColor((eP * f) / COLOR_MAX);
          });
        }
        for (const key of REGIONS) {
          const on = k === 1 && key === sel;
          sl.outlines[key].setAttribute('stroke-width', on ? 2.2 : 0.8);
          sl.outlines[key].setAttribute('stroke-opacity', on ? 1 : 0.45);
        }
        sl.occ.style.display = state.method === 'occ' ? '' : 'none';
        sl.svg.setAttribute('aria-label', (k === 0 ? 'Healthy striatum, age ' + state.age : 'PD striatum, ' + yearsText(state.years) + ' after motor onset') +
          ': right side ' + r.sides.R.shape.text + ', left side ' + r.sides.L.shape.text + '. Simulated.');
      });
      ui.sliceCaps[0].innerHTML = 'Healthy <span>age ' + state.age + '</span>';
      ui.sliceCaps[1].innerHTML = 'PD <span>' + yearsText(state.years) + ' after motor onset, age ' + state.age + '</span>';
      ui.shapes[0].innerHTML = shapeLine(res.healthy);
      ui.shapes[1].innerHTML = shapeLine(res.pd);
      ui.refNote.textContent = state.method === 'occ'
        ? 'Hatched: the occipital reference region (schematic). Changing the reference changes the numbers, never the image.'
        : 'Reference: cerebral white matter, not drawn in this schematic slice. Changing the reference changes the numbers, never the image.';
    }
    function shapeLine(r) {
      return 'Right: <b>' + r.sides.R.shape.text + '</b> &middot; Left: <b>' + r.sides.L.shape.text + '</b>';
    }
    function yearsText(y) { return (y === 1 ? '1 year' : (Number.isInteger(y) ? y : y.toFixed(1)) + ' years'); }

    function buildColorbar() {
      const host = ui.cbar;
      const w = 150, h = 12;
      const svg = svgEl('svg', { width: w, height: h, viewBox: '0 0 ' + w + ' ' + h, 'aria-hidden': 'true' });
      const gid = id('cbar-g');
      const g = svgEl('linearGradient', { id: gid, x1: 0, y1: 0, x2: 1, y2: 0 }, svgEl('defs', {}, svg));
      for (let i = 0; i <= 8; i++) { const st = svgEl('stop', { offset: (i / 8).toFixed(3) }, g); st.style.stopColor = bindColor(i / 8); }
      svgEl('rect', { x: 0, y: 0, width: w, height: h, rx: 3, fill: 'url(#' + gid + ')', stroke: 'var(--rule)' }, svg);
      const row = document.createElement('span');
      row.style.cssText = 'display:inline-flex;align-items:center;gap:8px';
      const a = document.createElement('span'); a.textContent = 'low';
      const b = document.createElement('span'); b.textContent = 'high';
      row.appendChild(a); row.appendChild(svg); row.appendChild(b);
      const c = document.createElement('span'); c.textContent = 'Colour: illustrative local binding, same scale in both slices';
      host.appendChild(row); host.appendChild(c);
    }

    /* ---------- SBR maths card ---------- */
    function paintFormula(pd) {
      const r = pd.regions[state.region];
      const m = METHOD[state.method], other = METHOD[state.method === 'occ' ? 'cwm' : 'occ'];
      const tag = r.contra ? ' (opposite the more affected limbs)' : '';
      ui.eq.innerHTML =
        '<div><span class="datscan-mut">SBR</span> = target &divide; reference &minus; 1</div>' +
        '<div><span class="datscan-mut">&nbsp;&nbsp;&nbsp;&nbsp;</span>= ' + r.target.toFixed(1) + ' &divide; ' + r.reference.toFixed(1) + ' &minus; 1 = <span class="datscan-big">' + f2(r.sbr) + '</span></div>';
      ui.facts.innerHTML =
        '<li><b>' + REGION_NAME[r.key] + tag + '</b>, ' + m.short + ' reference. Counts are mean counts per voxel in illustrative units.</li>' +
        '<li>Expected for a healthy ' + state.age + '-year-old: <span class="datscan-num">' + f2(r.expected) + '</span>, so this region is at <span class="datscan-num">' + pct(r.pct) + '</span> of expected.</li>' +
        '<li>NSD-ISS D, as PPMI applies it: the lowest putamen below 75% of expected (Dam et al. 2024). This scan: ' + ((pd.regions.L_putamen.belowD || pd.regions.R_putamen.belowD) ? '<span class="datscan-flag datscan-low">D positive</span>' : '<span class="datscan-flag datscan-ok">D negative</span>') + (/putamen/.test(r.key) ? '' : '. The caudate does not count toward it.') + '</li>' +
        '<li>Same simulated scan with the ' + other.short + ' reference: SBR <span class="datscan-num">' + f2(r.other) + '</span>. The two methods put values on different scales: never pool them (guide 2.4, 5.6).</li>';
    }

    /* ---------- bars ---------- */
    function paintBars(pd) {
      const host = ui.bars;
      clear(host);
      const W = Math.max(300, widths.bars || host.clientWidth || 420);
      const labW = Math.min(140, Math.max(108, W * 0.24)), valW = 112, rowH = 40, top = 6, axisH = 34;
      const x0 = labW, x1 = W - valW;
      const axisMax = state.method === 'occ' ? 4.5 : 3.5;
      const sx = (v) => x0 + (clamp(v, 0, axisMax) / axisMax) * (x1 - x0);
      const order = ['L_caudate', 'L_putamen', 'R_caudate', 'R_putamen'];
      const H = top + order.length * rowH + axisH;
      const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': 'Regional SBRs against the age-expected band, simulated' }, host);
      for (let t = 0; t <= axisMax + 1e-9; t += 0.5) {
        const major = Math.abs(t - Math.round(t)) < 1e-9;
        svgEl('line', { x1: r1(sx(t)), x2: r1(sx(t)), y1: top, y2: top + order.length * rowH, stroke: 'var(--grid)', 'stroke-width': major ? 1 : 0.6 }, svg);
        if (major) svgText(svg, sx(t), top + order.length * rowH + 16, String(t), 'datscan-t-tick', 'middle');
      }
      svgText(svg, (x0 + x1) / 2, H - 2, 'SBR (' + METHOD[state.method].short + ' reference)', '', 'middle');
      order.forEach((key, i) => {
        const r = pd.regions[key];
        const y = top + i * rowH, yc = y + rowH / 2;
        if (key === state.region) svgEl('rect', { x: 0, y: y + 2, width: W, height: rowH - 4, rx: 6, fill: 'var(--tint)' }, svg);
        svgText(svg, 6, yc - 2, REGION_NAME[key], 'datscan-t-strong', 'start');
        svgText(svg, 6, yc + 13, r.contra ? 'opposite side' : 'same side', '', 'start');
        // healthy band, expected tick, 75% line
        svgEl('rect', { x: r1(sx(r.expected * PARAMS.band[0])), y: yc - 11, width: r1(sx(r.expected * PARAMS.band[1]) - sx(r.expected * PARAMS.band[0])), height: 22, rx: 3, fill: 'var(--accent)', 'fill-opacity': 0.12 }, svg);
        svgEl('rect', { x: x0, y: yc - 5, width: r1(Math.max(1.5, sx(r.sbr) - x0)), height: 10, rx: 2, fill: 'var(--accent)' }, svg);
        svgEl('line', { x1: r1(sx(r.expected)), x2: r1(sx(r.expected)), y1: yc - 13, y2: yc + 13, stroke: 'var(--fg)', 'stroke-width': 2 }, svg);
        svgEl('line', { x1: r1(sx(r.expected * PARAMS.dCut)), x2: r1(sx(r.expected * PARAMS.dCut)), y1: yc - 13, y2: yc + 13, stroke: 'var(--critical)', 'stroke-width': 1.6, 'stroke-dasharray': '3 2' }, svg);
        svgText(svg, x1 + 10, yc - 2, f2(r.sbr), 'datscan-t-strong datscan-t-tick', 'start');
        svgText(svg, x1 + 10, yc + 13, pct(r.pct) + ' of expected', r.belowD ? 'datscan-t-crit datscan-t-tick' : 'datscan-t-tick', 'start');
        const hit = svgEl('rect', { x: 0, y: y, width: W, height: rowH, fill: 'transparent', class: NAME + '-hit', 'data-region': key }, svg);
        svgEl('title', {}, hit).textContent = REGION_NAME[key] + ': show its SBR maths';
      });
      if (!ui.barLegend.childNodes.length) {
        const add = (draw, text) => { const s = document.createElement('span'); const sv = svgEl('svg', { width: 22, height: 14, 'aria-hidden': 'true' }, s); draw(sv); s.appendChild(document.createTextNode(text)); ui.barLegend.appendChild(s); };
        add((sv) => svgEl('rect', { x: 0, y: 4, width: 22, height: 6, rx: 1, fill: 'var(--accent)' }, sv), 'Simulated SBR');
        add((sv) => svgEl('rect', { x: 0, y: 0, width: 22, height: 14, rx: 2, fill: 'var(--accent)', 'fill-opacity': 0.12 }, sv), 'Illustrative healthy range (expected ± 20%)');
        add((sv) => svgEl('line', { x1: 11, x2: 11, y1: 0, y2: 14, stroke: 'var(--fg)', 'stroke-width': 2 }, sv), 'Expected for age');
        add((sv) => svgEl('line', { x1: 11, x2: 11, y1: 0, y2: 14, stroke: 'var(--critical)', 'stroke-width': 1.6, 'stroke-dasharray': '3 2' }, sv), '75% of expected (NSD-ISS D cut-off, lowest putamen)');
      }
    }

    /* ---------- summaries (guide 6.2) ---------- */
    function paintSummary(pd) {
      const s = pd.summary;
      const contraName = pd.contraSide === 'L' ? 'Left' : 'Right';
      const ai = s.asymPut;
      const aiTxt = Math.abs(ai) < 0.005 ? '0% (symmetric)' : (ai > 0 ? '+' : '−') + Math.round(Math.abs(ai) * 100) + '% (' + (ai < 0 ? 'left' : 'right') + ' lower)';
      ui.summary.innerHTML =
        '<tr><th>Mean striatum SBR</th><td><span class="datscan-num">' + f2(s.meanStriatum) + '</span> (' + pct(s.meanStriatumPct) + ' of expected)</td></tr>' +
        '<tr><th>Putamen-to-caudate ratio</th><td>left <span class="datscan-num">' + f2(s.pcL) + '</span>, right <span class="datscan-num">' + f2(s.pcR) + '</span>; healthy <span class="datscan-num">' + f2(s.pcHealthy) + '</span>. It falls as the posterior-first loss bites.</td></tr>' +
        '<tr><th>Asymmetry index, putamen</th><td>(left &minus; right) / mean = <span class="datscan-num">' + aiTxt + '</span></td></tr>' +
        '<tr><th>Contralateral putamen</th><td>' + contraName + ': <span class="datscan-num">' + f2(s.contraPut.sbr) + '</span> (' + pct(s.contraPut.pct) + ' of expected). It carries the most signal early.</td></tr>';
    }

    /* ---------- time course (floor effect) ---------- */
    const SERIES = [
      { key: 'putC', name: 'Putamen, contra', color: 'var(--accent)', dash: '', w: 2.4 },
      { key: 'putI', name: 'Putamen, ipsi', color: 'var(--accent)', dash: '7 4', w: 2 },
      { key: 'postC', name: 'Posterior putamen, contra', color: 'var(--accent)', dash: '1.5 3', w: 1.6 },
      { key: 'cauC', name: 'Caudate, contra', color: 'var(--fg)', dash: '', w: 2.2 },
      { key: 'cauI', name: 'Caudate, ipsi', color: 'var(--fg)', dash: '7 4', w: 1.8 },
    ];
    function paintTime() {
      const host = ui.time;
      clear(host);
      const tc = timeCourse(state);
      const W = Math.max(300, widths.time || host.clientWidth || 520);
      const labelRoom = W >= 520 ? 156 : 0;
      const H = 268, m = { l: 44, r: 12 + labelRoom, t: 14, b: 40 };
      const sx = (v) => m.l + (v / PARAMS.yearsMax) * (W - m.l - m.r);
      const sy = (v) => H - m.b - (clamp(v, 0, 1.1) / 1.1) * (H - m.t - m.b);
      const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': 'Percent of age-expected binding against years since motor onset, simulated' }, host);
      // floor zone
      svgEl('rect', { x: m.l, y: r1(sy(tc.floorPct)), width: r1(W - m.l - m.r), height: r1(sy(0) - sy(tc.floorPct)), fill: 'var(--critical)', 'fill-opacity': 0.08 }, svg);
      svgText(svg, m.l + 6, sy(tc.floorPct) + 13, 'floor (illustrative)', '', 'start');
      for (const v of [0, 0.25, 0.5, 0.75, 1]) {
        svgEl('line', { x1: m.l, x2: W - m.r, y1: r1(sy(v)), y2: r1(sy(v)), stroke: v === 0.75 ? 'var(--critical)' : 'var(--grid)', 'stroke-width': v === 0.75 ? 1.4 : 1, 'stroke-dasharray': v === 0.75 ? '4 3' : '' }, svg);
        svgText(svg, m.l - 6, sy(v) + 4, pct(v), v === 0.75 ? 'datscan-t-tick datscan-t-crit' : 'datscan-t-tick', 'end');
      }
      svgEl('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: 'var(--axis)' }, svg);
      for (let t = 0; t <= 10; t += 2) {
        svgEl('line', { x1: r1(sx(t)), x2: r1(sx(t)), y1: H - m.b, y2: H - m.b + 4, stroke: 'var(--axis)' }, svg);
        svgText(svg, sx(t), H - m.b + 17, String(t), 'datscan-t-tick', 'middle');
      }
      svgText(svg, (m.l + W - m.r) / 2, H - 4, 'Years since motor onset', '', 'middle');
      // current year
      const xc = sx(state.years);
      svgEl('line', { x1: r1(xc), x2: r1(xc), y1: m.t, y2: H - m.b, stroke: 'var(--accent)', 'stroke-width': 1, 'stroke-opacity': 0.6 }, svg);
      for (const se of SERIES) {
        svgEl('path', { d: pathFrom(tc.rows.map((r) => [sx(r.t), sy(r[se.key])])), fill: 'none', stroke: se.color, 'stroke-width': se.w, 'stroke-dasharray': se.dash, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      }
      const idx = Math.round((state.years / PARAMS.yearsMax) * 100);
      const cur = tc.rows[idx];
      for (const se of SERIES) svgEl('circle', { cx: r1(xc), cy: r1(sy(cur[se.key])), r: 3.6, fill: se.color, stroke: 'var(--surface)', 'stroke-width': 1.5 }, svg);
      // direct labels at the right end, nudged apart
      if (labelRoom) {
        const last = tc.rows[tc.rows.length - 1];
        const labs = SERIES.map((se) => ({ se: se, y: sy(last[se.key]) + 4 })).sort((a, b) => a.y - b.y);
        for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 14) labs[i].y = labs[i - 1].y + 14;
        const over = labs[labs.length - 1].y - (H - m.b + 2);
        if (over > 0) for (const l of labs) l.y -= over;
        for (const l of labs) {
          const t = svgText(svg, W - m.r + 8, l.y, l.se.name, 'datscan-t-lab', 'start');
          if (l.se.key.startsWith('put') || l.se.key === 'postC') t.style.fill = 'var(--accent)';
        }
      }
      // legend only when the chart is too narrow for direct labels
      clear(ui.timeLegend);
      ui.timeLegend.style.display = labelRoom ? 'none' : '';
      if (!labelRoom) for (const se of SERIES) {
        const s = document.createElement('span');
        const sv = svgEl('svg', { width: 26, height: 10, 'aria-hidden': 'true' }, s);
        svgEl('path', { d: 'M1,5L25,5', stroke: se.color, 'stroke-width': se.w, 'stroke-dasharray': se.dash, 'stroke-linecap': 'round' }, sv);
        s.appendChild(document.createTextNode(se.name));
        ui.timeLegend.appendChild(s);
      }
    }

    /* ---------- render ---------- */
    function render() {
      ui.yearsOut.textContent = yearsText(state.years);
      ui.asymOut.textContent = Math.round(state.asym * 100) + '%';
      ui.ageOut.textContent = String(state.age);
      const base = { years: state.years, asym: state.asym, worse: state.worse, age: state.age, method: state.method };
      const res = { healthy: scan(Object.assign({ healthy: true }, base)), pd: scan(Object.assign({ healthy: false }, base)) };
      paintSlices(res);
      paintFormula(res.pd);
      paintBars(res.pd);
      paintSummary(res.pd);
      paintTime();
      const low = REGIONS.filter((k) => res.pd.regions[k].belowD).map((k) => REGION_NAME[k].toLowerCase());
      const dPos = res.pd.regions.L_putamen.belowD || res.pd.regions.R_putamen.belowD;
      ui.live.textContent = 'PD at ' + yearsText(state.years) + ': ' + (low.length ? 'below 75% of expected in ' + low.join(', ') : 'no region below 75% of expected') + '; NSD-ISS D ' + (dPos ? 'positive' : 'negative') + ' (lowest putamen).';
    }

    relayout();

    return {
      destroy() {
        if (raf) cancelAnimationFrame(raf);
        if (layoutRaf) cancelAnimationFrame(layoutRaf);
        ro.disconnect();
        root.removeEventListener('input', onInput);
        root.removeEventListener('change', onChange);
        root.removeEventListener('click', onClick);
        if (root.parentNode) root.parentNode.removeChild(root);
        liveInstances = Math.max(0, liveInstances - 1);
        if (!liveInstances) { const s = document.getElementById('style-' + NAME); if (s) s.remove(); }
      },
    };
  }

  /* ==================================================================
   * 6. Static markup (no user data is ever interpolated)
   * ================================================================== */
  function template(id) {
    const n = NAME;
    const regionOpts = REGIONS.map((k) => '<option value="' + k + '"' + (k === 'L_putamen' ? ' selected' : '') + '>' + REGION_NAME[k] + '</option>').join('');
    return '' +
'<div class="' + n + '-layout">' +
  '<div class="' + n + '-col">' +
    '<section class="' + n + '-card ' + n + '-slices" aria-label="Schematic slices">' +
      '<p class="' + n + '-howto"><b>How to read this:</b> a schematic axial slice through both striata, front of the head at the top, patient&rsquo;s right on your left (radiological convention). Colour shows illustrative binding. Click a region to see its maths.</p>' +
      '<div class="' + n + '-slicegrid">' +
        '<div><p class="' + n + '-slicecap" id="' + id('cap-h') + '"></p><div class="' + n + '-slicehost" id="' + id('slice-h') + '"></div><p class="' + n + '-shape" id="' + id('shape-h') + '"></p></div>' +
        '<div><p class="' + n + '-slicecap" id="' + id('cap-p') + '"></p><div class="' + n + '-slicehost" id="' + id('slice-p') + '"></div><p class="' + n + '-shape" id="' + id('shape-p') + '"></p></div>' +
      '</div>' +
      '<div class="' + n + '-cbar" id="' + id('cbar') + '"></div>' +
      '<p class="' + n + '-hint">A normal striatum looks like a comma on each side; loss of putamen signal turns it into a full stop (guide 4.3). Loss runs from the back of the putamen forwards and is worse opposite the more affected limbs (guide 3.2). The shape words use illustrative cut-offs on the back of the putamen relative to the caudate.</p>' +
      '<p class="' + n + '-hint" id="' + id('refnote') + '"></p>' +
      '<p class="' + n + '-sim">Simulated data for illustration, not PPMI data</p>' +
    '</section>' +
    '<section class="' + n + '-card ' + n + '-summary" aria-label="Regional summaries">' +
      '<h3 class="' + n + '-h">Summaries worth computing (guide 6.2)</h3>' +
      '<table class="' + n + '-table"><tbody id="' + id('summary') + '"></tbody></table>' +
      '<p class="' + n + '-hint">Hemisphere matters: in PPMI, left-predominant putamen loss went with worse attention and processing speed, right-predominant loss with worse motor signs (Fiorenzato et al. 2021, guide 8.3).</p>' +
      '<p class="' + n + '-sim">Simulated data for illustration, not PPMI data</p>' +
    '</section>' +
    '<section class="' + n + '-card ' + n + '-time" aria-label="Time course">' +
      '<p class="' + n + '-howto"><b>How to read this:</b> each line is a region&rsquo;s binding as a percentage of the value expected for a healthy person of the same age; contra means opposite the more affected limbs, ipsi the same side. The vertical line is your years slider; the red dashed line is 75% of expected, the NSD-ISS D cut-off, which applies to the lowest putamen.</p>' +
      '<div class="' + n + '-chart" id="' + id('time') + '"></div>' +
      '<div class="' + n + '-legend" id="' + id('time-legend') + '"></div>' +
      '<p class="' + n + '-hint">The floor effect: putamen binding falls fast early, then flattens near a floor within a few years, so later loss barely moves it (guide 4.6). Pathology agrees: dorsal putamen terminals are almost gone by about four years after diagnosis (Kordower et al. 2013, guide 3.1). The caudate keeps falling and carries most of the information about later stages (guide 6.2).</p>' +
      '<p class="' + n + '-sim">Simulated data for illustration, not PPMI data</p>' +
    '</section>' +
  '</div>' +
  '<div class="' + n + '-col">' +
    '<section class="' + n + '-card ' + n + '-controls" aria-label="Controls">' +
      '<div class="' + n + '-cgrid">' +
        '<div class="' + n + '-ctrl">' +
          '<div class="' + n + '-ctrl-head"><label for="' + id('years') + '">Years since motor onset</label><output id="' + id('years-out') + '" for="' + id('years') + '"></output></div>' +
          '<input class="' + n + '-range" type="range" id="' + id('years') + '" min="0" max="10" step="0.5" value="2">' +
          '<div class="' + n + '-scale"><span>0</span><span>10 years</span></div>' +
        '</div>' +
        '<div class="' + n + '-ctrl">' +
          '<div class="' + n + '-ctrl-head"><label for="' + id('age') + '">Age</label><output id="' + id('age-out') + '" for="' + id('age') + '"></output></div>' +
          '<input class="' + n + '-range" type="range" id="' + id('age') + '" min="40" max="85" step="1" value="60">' +
          '<div class="' + n + '-scale"><span>40</span><span>85</span></div>' +
          '<p class="' + n + '-hint">Healthy binding falls about 8% per decade (van Dyck et al. 1995), fairly evenly in caudate and putamen (van Dyck et al. 2002; guide 4.3). Here: a straight 8% of the age-40 value per decade.</p>' +
        '</div>' +
        '<fieldset class="' + n + '-fs ' + n + '-ctrl">' +
          '<legend>More affected limbs</legend>' +
          '<div class="' + n + '-radios">' +
            '<label class="' + n + '-radio"><input type="radio" name="' + id('worse') + '" id="' + id('worse-right') + '" value="right" checked>Right</label>' +
            '<label class="' + n + '-radio"><input type="radio" name="' + id('worse') + '" id="' + id('worse-left') + '" value="left">Left</label>' +
          '</div>' +
          '<div class="' + n + '-ctrl-head" style="margin-top:10px"><label for="' + id('asym') + '">Asymmetry</label><output id="' + id('asym-out') + '" for="' + id('asym') + '"></output></div>' +
          '<input class="' + n + '-range" type="range" id="' + id('asym') + '" min="0" max="60" step="5" value="30">' +
          '<div class="' + n + '-scale"><span>symmetric</span><span>strongly one-sided</span></div>' +
          '<p class="' + n + '-hint">The hemisphere opposite the more affected limbs loses more, because each hemisphere controls the opposite side of the body (guide 3.2). Brain-first PD tends to be more asymmetric, body-first more symmetric (guide 3.1).</p>' +
        '</fieldset>' +
        '<fieldset class="' + n + '-fs ' + n + '-ctrl">' +
          '<legend>Reference region</legend>' +
          '<div class="' + n + '-radios ' + n + '-stack">' +
            '<label class="' + n + '-radio"><input type="radio" name="' + id('method') + '" id="' + id('method-occ') + '" value="occ" checked><span>Occipital cortex<small>Invicro archive, the original pipeline</small></span></label>' +
            '<label class="' + n + '-radio"><input type="radio" name="' + id('method') + '" id="' + id('method-cwm') + '" value="cwm"><span>Cerebral white matter<small>XingImaging core lab, since November 2024</small></span></label>' +
          '</div>' +
          '<p class="' + n + '-hint">Occipital and white-matter references give different numbers for the same scan. Never pool values from the two methods (guide 2.4, 4.3, 6.2).</p>' +
        '</fieldset>' +
        '<label class="' + n + '-check" for="' + id('blur') + '"><input type="checkbox" id="' + id('blur') + '" checked>Blur the slices to SPECT resolution (about 1 cm)</label>' +
      '</div>' +
    '</section>' +
    '<section class="' + n + '-card ' + n + '-formula" aria-label="SBR maths">' +
      '<div class="' + n + '-formula-row"><label for="' + id('region') + '">SBR maths for</label><select class="' + n + '-select" id="' + id('region') + '">' + regionOpts + '</select></div>' +
      '<div class="' + n + '-eq" id="' + id('eq') + '"></div>' +
      '<ul class="' + n + '-facts" id="' + id('facts') + '"></ul>' +
      '<p class="' + n + '-hint">NSD-ISS D criterion, as PPMI applies it: the lowest putamen binding ratio below 75% of the value expected for age and sex (Simuni et al. 2024; Dam et al. 2024; guide 2.2, 6.2). The 75% line is drawn on every region for comparison, but only the putamen counts. Expected values here use age only, not sex.</p>' +
      '<p class="' + n + '-sim">Simulated data for illustration, not PPMI data</p>' +
    '</section>' +
    '<section class="' + n + '-card ' + n + '-bars" aria-label="Regional SBRs">' +
      '<p class="' + n + '-howto"><b>How to read this:</b> each bar is one region&rsquo;s SBR; the shaded band is an illustrative healthy range for this age, the dark tick the expected value, the red dashed tick 75% of it. Opposite side means opposite the more affected limbs.</p>' +
      '<div class="' + n + '-chart" id="' + id('bars') + '"></div>' +
      '<div class="' + n + '-legend" id="' + id('bar-legend') + '"></div>' +
      '<p class="' + n + '-sim">Simulated data for illustration, not PPMI data</p>' +
      '<p class="' + n + '-sr" id="' + id('live') + '" aria-live="polite"></p>' +
    '</section>' +
  '</div>' +
'</div>' +
'<details class="' + n + '-card ' + n + '-notes">' +
  '<summary>How the simulation works, and its sources</summary>' +
  '<p>Every number on this page is simulated. Healthy expected SBRs on the occipital scale are 3.5 (caudate) and 2.7 (putamen) at age 40, falling by 8% of that value per decade: the guide&rsquo;s figure of about 8% per decade (van Dyck et al. 1995), applied evenly to caudate and putamen (van Dyck et al. 2002). Women have higher binding on average (guide 4.3); this sketch has no sex term.</p>' +
  '<pre>' +
'remaining fraction at a point = floor + (1 &minus; floor) &middot; exp(&minus;&lambda; &middot; v &middot; S)\n' +
'floor = 0.15, &lambda; = 0.2 per year\n' +
'S = (8.5 + years since motor onset) &middot; h      h = 1 opposite the worse limbs, 1 &minus; asymmetry on the other side\n' +
'v = 0.25 in the caudate; in the putamen v rises from 0.45 at the front to 1 at the back\n' +
'region SBR (occipital scale) = expected for age &middot; mean remaining fraction over the region\n' +
'counts: target = 100 &middot; (1 + SBR), occipital reference = 100, white-matter reference = 115\n' +
'SBR = target / reference &minus; 1;   % of expected = SBR / expected SBR, both with the same reference' +
  '</pre>' +
  '<p>The curve shape follows the guide: fast early loss that slows towards a floor, roughly exponential (guide 6.2), starting in the posterior putamen and worse opposite the more affected limbs (guide 3.2). The constants were set by eye so that about two years after motor onset the contralateral putamen sits near a third of expected and the mean striatum near 55 to 60%, close to the guide&rsquo;s summary of PPMI&rsquo;s baseline (Marek et al. 2018: 68% lower contralateral putamen and 45% lower mean striatal SBR than controls). The white-matter offset (115 against 100) is arbitrary: the guide gives no size or direction, and the real difference must be estimated on scans quantified both ways (guide 6.2). The blur is drawn only; the numbers are not degraded by partial volume, noise, motion or equipment (guide 4.3).</p>' +
  '<div class="' + n + '-links"><button type="button" class="' + n + '-link" data-section="43-datscan-spect">DaTScan SPECT, guide 4.3</button>' +
  '<button type="button" class="' + n + '-link" data-section="62-datscan">DaTScan processing, guide 6.2</button>' +
  '<button type="button" class="' + n + '-link" data-section="46-properties-of-these-measures-that-matter-for-modelling">Floors and ceilings, guide 4.6</button></div>' +
'</details>';
  }

  X[NAME] = {
    title: 'DaTScan: what the binding ratios mean',
    blurb: 'Age a simulated patient and watch the putamen fade from comma to full stop, with live SBR maths, age-expected bands and the putamen floor.',
    mount: mount,
    _model: {
      PARAMS: PARAMS, REGIONS: REGIONS, sbrFromCounts: sbrFromCounts, expectedOcc: expectedOcc, countsFromOcc: countsFromOcc,
      toMethod: toMethod, vPutamen: vPutamen, localFraction: localFraction, putamenFraction: putamenFraction,
      caudateFraction: caudateFraction, severity: severity, shapeOf: shapeOf, scan: scan, timeCourse: timeCourse,
      closedSpline: closedSpline, bindColor: bindColor, GEO: GEO,
    },
  };
})();
