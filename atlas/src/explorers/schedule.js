/* PPMI Atlas explorer: schedule
   The original PPMI visit schedule as the guide summarises it (guide 2.3, 4.6, 5.6),
   placed on the worked example's analysis time axis with the 0 to 5 or 0 to 5.5 year window and the 2.5-year landmark
   (guide 1, 6.4, 10.5). Only timings the guide states are drawn; the rest are marked "check the schedule
   of activities". No PPMI participant data is used. */
(function () {
  'use strict';
  const X = (window.PPMIExplorers = window.PPMIExplorers || {});
  const NAME = 'schedule';
  const SVGNS = 'http://www.w3.org/2000/svg';
  let instanceCounter = 0;
  let liveInstances = 0;

  /* ---------------------------------- schedule facts ---------------------------------------- */

  // Visit codes the guide maps to months: SC "typically about 60 days before baseline", BL = 0, and the
  // "common code-to-month mapping in original-protocol data" V04 = 12 ... V12 = 60 (guide 2.3, 13).
  const VISIT_MONTHS = Object.freeze({ SC: -2, BL: 0, V04: 12, V06: 24, V08: 36, V10: 48, V12: 60 });
  const LANDMARK_DEFAULT = 30; // "about 2.5 years" (guide 6.4, 10.5, 13)
  const WINDOWS = Object.freeze({ '5': 60, '5.5': 66 }); // 0 to 5 or 0 to 5.5 years, guide 1

  function codeForMonth(m) {
    const keys = Object.keys(VISIT_MONTHS);
    for (let i = 0; i < keys.length; i++) if (VISIT_MONTHS[keys[i]] === m && keys[i] !== 'SC') return keys[i];
    return null;
  }
  function pts(codes) { return codes.map(function (c) { return { m: VISIT_MONTHS[c], code: c }; }); }
  function monthsPts(months) { return months.map(function (m) { return { m: m, code: codeForMonth(m) }; }); }
  // "Motor exam every 3 months in year 1, then every 6 months" (guide 2.3). The guide maps codes only up
  // to V12 = 60 months, so the series is drawn to 60 and later months are left to the schedule of activities.
  function motorMonths() {
    const out = [];
    for (let m = 0; m <= 12; m += 3) out.push(m);
    for (let m = 18; m <= 60; m += 6) out.push(m);
    return out;
  }

  const ROWS = [
    {
      id: 'cog', label: 'Six cognitive tests', noun: 'cognitive visits', short: 'Six tests', tone: 'ink', group: 'cognition', on: true,
      points: pts(['BL', 'V04', 'V06', 'V08', 'V10', 'V12']),
      role: 'Each test loads on D and on S.',
      schedule: 'Yearly from baseline: BL, V04 (12 months), V06 (24), V08 (36), V10 (48) and V12 (60). Cognition starts at BL, not SC.',
      notes: 'Scores rise on retesting, most at the first repeat, and can mask decline.',
      source: 'Guide 2.3, 4.2, 4.6, 5.6, 6.1'
    },
    {
      id: 'moca', label: 'MoCA', short: 'MoCA', tone: 'ink', group: 'cognition', on: true, unknown: true,
      role: 'A screen; not in the model or the CSS.',
      schedule: 'The guide does not give the MoCA’s timing. Check the schedule of activities.',
      source: 'Guide 4.2, 5.4'
    },
    {
      id: 'dat', label: 'DaTScan', noun: 'DaTScans', short: 'DaTScan', tone: 'accent', group: 'imaging', on: true,
      points: pts(['SC', 'V04', 'V06', 'V10']).concat([{ m: 0, code: 'BL', occasional: true }]),
      role: 'Anchors the dopaminergic stage D.',
      schedule: 'In PD at screening (SC, about 2 months before baseline), then V04 (12 months), V06 (24) and V10 (48). The hollow dot is the small set of baseline-coded scans, not part of the main series.',
      notes: 'Align screening scans with baseline by date, not by code. Never pool the Xing and Invicro SBR tables.',
      source: 'Guide 2.3, 2.4, 4.6, 5.6, 6.2'
    },
    {
      id: 't1', label: 'MRI T1 scan', noun: 'T1 scans', short: 'T1 MRI', tone: 'accent2', group: 'imaging', on: true,
      points: pts(['BL']), band: { from: 4, text: 'repeated in a subset: months not in the guide, check the schedule of activities', shortText: 'repeats: check schedule' },
      role: 'Raw T1 is the route to a regional S (option B).',
      schedule: 'Baseline for everyone, repeated in a subset. The guide does not give the repeat months: check the schedule of activities.',
      notes: 'A T1 acquisition flag says a scan exists, not that it passed quality control or was processed.',
      source: 'Guide 2.3, 5.6, 6.3'
    },
    {
      id: 'gmv', label: 'Grey matter volume', noun: 'grey matter volumes', short: 'GM volume', tone: 'accent2', group: 'imaging', on: true,
      points: pts(['BL', 'V06', 'V10']),
      role: 'Processed MRI: option A anchor for S, exploratory.',
      schedule: 'Processed total grey matter volume at BL, V06 (24 months) and V10 (48).',
      notes: 'One number per scan, with no head-size measure, quality flags or software record.',
      source: 'Guide 1, 2.3, 4.6, 5.6, 6.3'
    },
    {
      id: 'dti', label: 'DTI', short: 'DTI', tone: 'accent2', group: 'imaging', on: false, unknown: true,
      role: 'Option C for S: free water in the posterior substantia nigra.',
      schedule: 'The guide does not give the DTI months. Check the schedule of activities.',
      source: 'Guide 2.4, 6.3'
    },
    {
      id: 'motor', label: 'Motor exam', noun: 'motor exams', short: 'Motor exam', tone: 'muted', group: 'context', on: true,
      points: monthsPts(motorMonths()), after: { from: 60, text: 'after 60 months: check', shortText: 'check' },
      role: 'Context: SDMT sensitivity analyses adjust for MDS-UPDRS III.',
      schedule: 'Every 3 months in year 1, then every 6 months. The guide labels only the 12, 24, 36, 48 and 60-month visits, so the visits between them carry no code here. It does not say whether the 6-month cadence continues after 60 months.',
      notes: 'Treated participants are examined OFF or ON medication (PDSTATE); never mix the two states in one trajectory.',
      source: 'Guide 2.3 (Marek et al. 2018), 4.1, 6.1'
    },
    {
      id: 'csf', label: 'CSF', noun: 'CSF samples', short: 'CSF', tone: 'muted', group: 'context', on: false,
      points: monthsPts([0, 6, 12, 24, 36, 48, 60]),
      role: 'Not in the current model.',
      schedule: 'At baseline, 6 and 12 months, then yearly.',
      source: 'Guide 2.3 (Marek et al. 2018)'
    },
    {
      id: 'event', label: 'Other codes', short: 'Other codes', tone: 'muted', group: 'context', on: true, eventBand: true,
      role: 'Codes without a month.',
      schedule: 'U (unscheduled visits), R (remote assessments), LOG (running logs such as medications), and in older data ST (start of symptomatic therapy) and PW (premature withdrawal). None has a scheduled month in the guide.',
      source: 'Guide 2.3, 13'
    }
  ];
  const CODES_LANE = {
    id: 'codes', label: 'Visit codes', short: 'Codes', on: true,
    role: 'Join key for records from one visit.',
    schedule: 'The guide maps SC to about 2 months before baseline, BL to 0, and in original-protocol data V04 = 12, V06 = 24, V08 = 36, V10 = 48 and V12 = 60 months. Confirm against the schedule of activities before relying on any code.',
    notes: 'Visit codes are not fully reliable: the User Guide calls best practice for EVENT_ID in longitudinal analysis “under review”. Use dates for time and codes only to join records from the same visit.',
    source: 'Guide 2.3, 13'
  };
  const ROW_BY_ID = {};
  ROWS.forEach(function (r) { ROW_BY_ID[r.id] = r; });
  ROW_BY_ID.codes = CODES_LANE;

  /* ---------------------------------- pure functions ---------------------------------------- */

  // A point's time on the chosen axis: months since baseline, or since diagnosis when offset > 0.
  function pointTime(p, offset) { return p.m + offset; }

  // In the window [0, windowEnd] months. The screening DaTScan (about -2 months) may be counted with
  // baseline imaging when includeSC is set; the guide leaves that alignment open (guide 1, 5.6).
  function isCounted(p, t, o) {
    if (t > o.windowEnd) return false;
    if (t >= 0) return true;
    return p.code === 'SC' && !!o.includeSC;
  }

  // Scheduled measurements one participant can have: in the window, up to and including the landmark
  // ("data up to about 2.5 years", guide 10.5), and after it. Occasional points are not counted.
  function countRow(row, o) {
    if (!row || !row.points) return null;
    const items = [];
    row.points.forEach(function (p) {
      if (p.occasional) return;
      const t = pointTime(p, o.offset || 0);
      if (isCounted(p, t, o)) items.push({ code: p.code, m: p.m, t: t });
    });
    let upTo = 0;
    items.forEach(function (it) { if (it.t <= o.landmark) upTo++; });
    return { total: items.length, upTo: upTo, after: items.length - upTo, items: items };
  }

  // Rows whose count changes between the two candidate windows.
  function compareWindows(o, rows) {
    const list = rows || ROWS;
    const out = [];
    list.forEach(function (r) {
      if (!r.points) return;
      const a = countRow(r, Object.assign({}, o, { windowEnd: WINDOWS['5'] })).total;
      const b = countRow(r, Object.assign({}, o, { windowEnd: WINDOWS['5.5'] })).total;
      if (a !== b) out.push({ id: r.id, label: r.label, noun: r.noun || r.label, w5: a, w55: b });
    });
    return out;
  }

  // Greedy stagger: each label goes in the first row where it does not touch the previous one.
  // items must be sorted by x; each has x (centre) and w (width). Returns a row index per item.
  function staggerTags(items, gap) {
    const ends = [];
    return items.map(function (it) {
      const left = it.x - it.w / 2;
      let r = 0;
      while (r < ends.length && ends[r] + gap > left) r++;
      ends[r] = it.x + it.w / 2;
      return r;
    });
  }

  function axisDomain(offset) { return [-6, Math.max(70, 60 + offset + 8)]; }

  /* ---------------------------------- styles ------------------------------------------------ */

  const STYLE = `
.schedule-root { font-family: var(--font-ui); color: var(--fg); font-size: 14px; line-height: 1.45; }
.schedule-root *, .schedule-root *::before, .schedule-root *::after { box-sizing: border-box; }
.schedule-root h3 { font-size: 16px; font-weight: 600; margin: 0; }
.schedule-root h4 { font-size: 15px; font-weight: 600; margin: 0; }
.schedule-root p { margin: 0; }
.schedule-root button, .schedule-root input, .schedule-root select { font: inherit; color: var(--fg); }
.schedule-root :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.schedule-root input[type="checkbox"], .schedule-root input[type="radio"], .schedule-root input[type="range"] { accent-color: var(--accent); }
.schedule-root .schedule-lede { font-family: var(--font-body); font-size: 14.5px; line-height: 1.55; max-width: 82ch; margin-bottom: 14px; }
.schedule-root .schedule-small { font-size: 12.5px; color: var(--muted); }
.schedule-root .schedule-main { display: grid; gap: 18px 26px; grid-template-columns: minmax(0, 1fr); grid-template-areas: "ctrl" "chart" "insp"; align-items: start; }
.schedule-root.schedule-w2 .schedule-main { grid-template-columns: 270px minmax(0, 1fr); grid-template-areas: "ctrl chart" "ctrl insp"; }
.schedule-root.schedule-w3 .schedule-main { grid-template-columns: 270px minmax(0, 1fr) 300px; grid-template-areas: "ctrl chart insp"; }
.schedule-root .schedule-controls { grid-area: ctrl; display: grid; gap: 14px 22px; grid-template-columns: minmax(0, 1fr); background: var(--tint); border-radius: 8px; padding: 14px; align-content: start; }
.schedule-root.schedule-w0:not(.schedule-w2) .schedule-controls { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.schedule-root fieldset { border: 0; margin: 0; padding: 0; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.schedule-root legend { font-size: 12.5px; font-weight: 600; color: var(--muted); padding: 0; margin-bottom: 4px; }
.schedule-root .schedule-opt { display: flex; gap: 8px; align-items: flex-start; font-size: 13.5px; cursor: pointer; }
.schedule-root .schedule-opt input { margin: 3px 0 0; flex: none; }
.schedule-root .schedule-opt.is-disabled { color: var(--muted); cursor: default; }
.schedule-root .schedule-sub { font-size: 12px; color: var(--muted); font-weight: 600; margin-top: 4px; }
.schedule-root .schedule-range { display: grid; grid-template-columns: minmax(0, 1fr); gap: 3px; font-size: 13.5px; }
.schedule-root .schedule-range input { width: 100%; margin: 0; }
.schedule-root .schedule-range output { font-weight: 600; }
.schedule-root .schedule-btn { align-self: flex-start; background: var(--surface-2); border: 1px solid var(--rule); border-radius: 6px; padding: 4px 10px; font-size: 13px; cursor: pointer; }
.schedule-root .schedule-btn:hover { border-color: var(--axis); }
.schedule-root .schedule-btn:disabled { opacity: 0.55; cursor: default; }
.schedule-root .schedule-chartcol { grid-area: chart; min-width: 0; }
.schedule-root .schedule-howto { font-size: 13px; color: var(--muted); max-width: 86ch; margin-bottom: 8px; }
.schedule-root .schedule-howto b { color: var(--fg); font-weight: 600; }
.schedule-root .schedule-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; font-size: 12.5px; color: var(--muted); margin-bottom: 6px; }
.schedule-root .schedule-key { display: inline-flex; align-items: center; gap: 6px; }
.schedule-root .schedule-key b { color: var(--fg); font-weight: 600; }
.schedule-root .schedule-sw { display: inline-block; flex: none; }
.schedule-root .schedule-sw-window { width: 16px; height: 12px; background: var(--tint); border: 1px solid var(--rule); border-radius: 2px; }
.schedule-root .schedule-sw-landmark { width: 0; height: 14px; border-left: 2px dashed var(--fg); }
.schedule-root .schedule-sw-occ { width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid var(--accent); background: var(--surface); }
.schedule-root .schedule-sw-band { width: 22px; height: 10px; border-radius: 5px; background: var(--surface-2); border: 1px dashed var(--axis); }
.schedule-root .schedule-sw-out { width: 10px; height: 10px; border-radius: 50%; background: var(--fg); opacity: 0.3; }
.schedule-root .schedule-chartbox { position: relative; }
.schedule-root .schedule-svg { display: block; overflow: visible; font-family: var(--font-ui); }
.schedule-root .schedule-svg text { fill: var(--fg); font-size: 13px; }
.schedule-root .schedule-svg .schedule-lanelabel { font-size: 13px; }
.schedule-root .schedule-svg .schedule-lane.is-hot .schedule-lanelabel { font-weight: 600; }
.schedule-root .schedule-svg .schedule-tick { fill: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.schedule-root .schedule-svg .schedule-ytick { fill: var(--muted); font-size: 12px; }
.schedule-root .schedule-svg .schedule-axis-title { fill: var(--muted); font-size: 12px; }
.schedule-root .schedule-svg .schedule-lmtext { fill: var(--fg); font-size: 12px; font-weight: 500; }
.schedule-root .schedule-svg .schedule-bandtext { fill: var(--muted); font-size: 12px; }
.schedule-root .schedule-svg .schedule-tagtext { font-family: var(--font-mono); font-size: 12px; fill: var(--fg); }
.schedule-root .schedule-window { fill: var(--tint); }
.schedule-root .schedule-winedge { stroke: var(--axis); stroke-width: 1; }
.schedule-root .schedule-grid { stroke: var(--grid); stroke-width: 1; }
.schedule-root .schedule-axis { stroke: var(--axis); stroke-width: 1; }
.schedule-root .schedule-tickline { stroke: var(--axis); stroke-width: 1; }
.schedule-root .schedule-landmark { stroke: var(--fg); stroke-width: 1.5; stroke-dasharray: 5 4; pointer-events: none; }
.schedule-root .schedule-lanebg { fill: transparent; stroke: none; }
.schedule-root .schedule-lane { outline: none; }
.schedule-root .schedule-lane.is-hot .schedule-lanebg { stroke: var(--axis); stroke-width: 1; }
.schedule-root .schedule-lane:focus-visible .schedule-lanebg { stroke: var(--accent); stroke-width: 2; }
.schedule-root .schedule-dot { stroke: var(--surface); stroke-width: 2; }
.schedule-root .schedule-tone-ink { fill: var(--fg); }
.schedule-root .schedule-tone-accent { fill: var(--accent); }
.schedule-root .schedule-tone-accent2 { fill: var(--accent-2); }
.schedule-root .schedule-tone-muted { fill: var(--muted); }
.schedule-root .schedule-dot.is-out { opacity: 0.3; }
.schedule-root .schedule-occ { fill: var(--surface); stroke: var(--accent); stroke-width: 1.5; }
.schedule-root .schedule-band { fill: var(--surface-2); stroke: var(--axis); stroke-width: 1; stroke-dasharray: 3 3; }
.schedule-root .schedule-tag { fill: var(--surface-2); stroke: var(--rule); stroke-width: 1; }
.schedule-root .schedule-tag.is-out { opacity: 0.45; }
.schedule-root .schedule-insp { grid-area: insp; min-width: 0; background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.schedule-root .schedule-insp .schedule-role { font-size: 13px; color: var(--muted); }
.schedule-root .schedule-insp dl { margin: 0; display: grid; gap: 7px; }
.schedule-root .schedule-insp dt { font-size: 12px; font-weight: 600; color: var(--muted); }
.schedule-root .schedule-insp dd { margin: 0; font-size: 13.5px; }
.schedule-root .schedule-sec { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--rule); }
.schedule-root .schedule-sechead { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
.schedule-root .schedule-tablewrap { overflow-x: auto; }
.schedule-root table.schedule-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.schedule-root .schedule-table caption { text-align: left; font-size: 12.5px; color: var(--muted); padding-bottom: 6px; }
.schedule-root .schedule-table th, .schedule-root .schedule-table td { padding: 6px 8px; border-bottom: 1px solid var(--grid); text-align: left; vertical-align: top; }
.schedule-root .schedule-table thead th { font-size: 12px; font-weight: 600; color: var(--muted); border-bottom: 1px solid var(--rule); }
.schedule-root .schedule-table td.schedule-num { text-align: right; width: 5.5em; font-variant-numeric: tabular-nums; }
.schedule-root .schedule-table th.schedule-num { text-align: right; }
.schedule-root .schedule-table td.schedule-check { color: var(--muted); }
.schedule-root .schedule-swrow { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 7px; vertical-align: 0; }
.schedule-root .schedule-insight { margin-top: 10px; font-size: 13.5px; display: grid; gap: 6px; max-width: 100ch; }
.schedule-root .schedule-grid2 { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); }
.schedule-root.schedule-w1 .schedule-grid2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.schedule-root.schedule-w2 .schedule-grid2 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.schedule-root .schedule-codes { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.schedule-root.schedule-w1 .schedule-codes { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.schedule-root.schedule-w2 .schedule-codes { grid-template-columns: repeat(8, minmax(0, 1fr)); }
.schedule-root .schedule-code { background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; padding: 9px 10px; font-size: 13px; display: flex; flex-direction: column; gap: 3px; }
.schedule-root .schedule-code code { font-family: var(--font-mono); font-size: 13px; font-weight: 600; }
.schedule-root .schedule-code .schedule-when { font-size: 12px; color: var(--muted); }
.schedule-root .schedule-note { background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; padding: 10px 12px; font-size: 13px; }
.schedule-root .schedule-note h5 { margin: 0 0 3px; font-size: 13px; font-weight: 600; }
.schedule-root .schedule-note.is-key { border-color: var(--warn); }
.schedule-root .schedule-illus { margin-top: 8px; }
.schedule-root .schedule-illus svg { display: block; max-width: none; overflow: visible; }
.schedule-root .schedule-guide { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; margin-top: 14px; font-size: 13px; color: var(--muted); }
.schedule-root .schedule-link { background: none; border: 0; padding: 0; color: var(--accent); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; font-size: 13px; }
@media (prefers-reduced-motion: no-preference) {
  .schedule-root .schedule-dot, .schedule-root .schedule-tag { transition: opacity 150ms ease; }
}
`;

  function injectStyle() {
    if (document.getElementById('style-' + NAME)) return;
    const st = document.createElement('style');
    st.id = 'style-' + NAME;
    st.textContent = STYLE;
    document.head.appendChild(st);
  }

  /* ---------------------------------- DOM helpers ------------------------------------------- */

  function setAttrs(el, attrs) {
    if (!attrs) return;
    Object.keys(attrs).forEach(function (k) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      el.setAttribute(k, v === true ? '' : String(v));
    });
  }
  function append(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(el, k); }); return; }
    el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  }
  function h(tag, attrs) {
    const el = document.createElement(tag);
    setAttrs(el, attrs);
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function S(tag, attrs) {
    const el = document.createElementNS(SVGNS, tag);
    setAttrs(el, attrs);
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  const MINUS = '−';
  function fmtMonth(t) { return t < 0 ? MINUS + Math.abs(t) : String(t); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function fmtYears(t) { const y = t / 12; return (Number.isInteger(y) ? String(y) : y.toFixed(1)); }

  const SECTION_IDS = {
    '2.3': '23-visits-and-the-schedule', '2.4': '24-imaging', '4.6': '46-properties-of-these-measures-that-matter-for-modelling',
    '6.2': '62-datscan', '6.4': '64-putting-the-modalities-on-one-timeline', '10.5': '105-model-comparison-and-validation'
  };

  /* ---------------------------------- mount ------------------------------------------------- */

  function mount(el, ctx) {
    const inst = ++instanceCounter;
    liveInstances++;
    const P = NAME + '-' + inst + '-';
    const ac = new AbortController();
    function on(node, type, fn) { node.addEventListener(type, fn, { signal: ac.signal }); }
    const canOpen = !!(ctx && typeof ctx.openSection === 'function');
    injectStyle();

    const state = { origin: 'baseline', dxGap: 12, windowKey: '5.5', landmark: LANDMARK_DEFAULT, includeSC: true, show: {}, focus: 'cog' };
    ROWS.forEach(function (r) { state.show[r.id] = r.on; });
    state.show.codes = true;
    let raf = 0;

    function opts() {
      return { offset: state.origin === 'diagnosis' ? state.dxGap : 0, windowEnd: WINDOWS[state.windowKey], landmark: state.landmark, includeSC: state.includeSC };
    }

    const root = h('div', { class: 'schedule-root' });
    el.appendChild(root);
    root.appendChild(h('p', { class: 'schedule-lede' },
      'PPMI measures each modality on its own schedule: cognition yearly, DaTScan at screening, 12, 24 and 48 months, and processed MRI at baseline, 24 and 48 months, so measurements rarely coincide (guide 4.6). ' +
      'Here they sit on the worked example’s time axis, with the analysis window and the 2.5-year landmark it validates at. The schedule is the original protocol (Marek et al. 2018) as the guide gives it.'));

    /* ---- controls ---- */
    const controls = h('form', { class: 'schedule-controls', 'aria-label': 'Schedule controls', novalidate: true });
    on(controls, 'submit', function (e) { e.preventDefault(); });

    function radio(name, value, label, checked, onPick) {
      const id = P + name + '-' + String(value).replace('.', '_');
      const input = h('input', { type: 'radio', id: id, name: P + name, value: value, checked: checked });
      on(input, 'change', function () { if (input.checked) { onPick(value); schedule(); } });
      return h('label', { class: 'schedule-opt', for: id }, input, h('span', null, label));
    }
    // time axis
    const gapInput = h('input', { type: 'range', id: P + 'gap', min: 0, max: 24, step: 1, value: state.dxGap, disabled: true, 'aria-describedby': P + 'gap-note' });
    const gapOut = h('output', { for: P + 'gap', id: P + 'gap-out' }, state.dxGap + ' months');
    const gapLabel = h('label', { for: P + 'gap', class: 'schedule-opt is-disabled', id: P + 'gap-label' }, 'Diagnosis before baseline: ', gapOut);
    const gapWrap = h('div', { class: 'schedule-range' },
      gapLabel,
      gapInput,
      h('span', { class: 'schedule-small', id: P + 'gap-note' }, 'Illustrative value. Diagnosis can precede baseline by up to two years (guide 6.4).'));
    on(gapInput, 'input', function () { state.dxGap = Number(gapInput.value); gapOut.textContent = state.dxGap + ' months'; schedule(); });
    function setOrigin(v) {
      state.origin = v;
      gapInput.disabled = v !== 'diagnosis';
      gapLabel.classList.toggle('is-disabled', v !== 'diagnosis');
    }
    controls.appendChild(h('fieldset', null, h('legend', null, 'Time measured from'),
      radio('origin', 'baseline', 'Baseline', true, setOrigin),
      radio('origin', 'diagnosis', 'Diagnosis', false, setOrigin),
      gapWrap,
      h('span', { class: 'schedule-small' }, 'Still to decide (guide 1).')));
    // window
    controls.appendChild(h('fieldset', null, h('legend', null, 'Analysis window'),
      radio('window', '5', '0 to 5 years', false, function (v) { state.windowKey = v; }),
      radio('window', '5.5', '0 to 5.5 years', true, function (v) { state.windowKey = v; }),
      h('span', { class: 'schedule-small' }, 'Still to decide (guide 1, 9.2).')));
    // landmark
    const lmInput = h('input', { type: 'range', id: P + 'lm', min: 6, max: 60, step: 1, value: state.landmark });
    const lmOut = h('output', { for: P + 'lm', id: P + 'lm-out' });
    const lmReset = h('button', { type: 'button', class: 'schedule-btn' }, 'Back to 2.5 years');
    on(lmInput, 'input', function () { state.landmark = Number(lmInput.value); schedule(); });
    on(lmReset, 'click', function () { state.landmark = LANDMARK_DEFAULT; lmInput.value = String(LANDMARK_DEFAULT); schedule(); });
    const scBox = h('input', { type: 'checkbox', id: P + 'sc', checked: true });
    on(scBox, 'change', function () { state.includeSC = scBox.checked; schedule(); });
    controls.appendChild(h('fieldset', null, h('legend', null, 'Landmark'),
      h('div', { class: 'schedule-range' }, h('label', { for: P + 'lm' }, 'Estimate stages from data up to ', lmOut), lmInput),
      lmReset,
      h('label', { class: 'schedule-opt', for: P + 'sc', style: 'margin-top:6px' }, scBox,
        h('span', null, 'Count the screening DaTScan with baseline imaging (it sits about 2 months before baseline)'))));
    // show
    const showFs = h('fieldset', null, h('legend', null, 'Show'));
    function showBox(id, label) {
      const cid = P + 'show-' + id;
      const box = h('input', { type: 'checkbox', id: cid, checked: !!state.show[id] });
      on(box, 'change', function () { state.show[id] = box.checked; if (box.checked) state.focus = id; schedule(); });
      return h('label', { class: 'schedule-opt', for: cid }, box, h('span', null, label));
    }
    showFs.appendChild(showBox('codes', 'Visit codes'));
    showFs.appendChild(h('span', { class: 'schedule-sub' }, 'Cognition'));
    showFs.appendChild(showBox('cog', 'Six cognitive tests'));
    showFs.appendChild(showBox('moca', 'MoCA'));
    showFs.appendChild(h('span', { class: 'schedule-sub' }, 'Imaging'));
    showFs.appendChild(showBox('dat', 'DaTScan'));
    showFs.appendChild(showBox('t1', 'MRI T1 scan'));
    showFs.appendChild(showBox('gmv', 'Grey matter volume (processed)'));
    showFs.appendChild(showBox('dti', 'DTI'));
    showFs.appendChild(h('span', { class: 'schedule-sub' }, 'Context'));
    showFs.appendChild(showBox('motor', 'Motor exam (MDS-UPDRS)'));
    showFs.appendChild(showBox('csf', 'CSF'));
    showFs.appendChild(showBox('event', 'Codes without a month'));
    controls.appendChild(showFs);

    /* ---- chart column ---- */
    const legWindow = h('b');
    const legLandmark = h('b');
    const svg = S('svg', { class: 'schedule-svg', role: 'group', 'aria-label': 'Visit schedule by measurement on the analysis time axis' });
    const chartBox = h('div', { class: 'schedule-chartbox' }, svg);
    const chartCol = h('div', { class: 'schedule-chartcol' },
      h('p', { class: 'schedule-howto' }, h('b', null, 'How to read this. '),
        'Each row is one measurement; dots mark the months the protocol schedules it. Faded dots fall outside the shaded analysis window. ' +
        'Pale dashed bands mark timings the guide does not give. Held-out participants’ stages are estimated from data left of the dashed landmark; their later data, to its right, are scored.'),
      h('div', { class: 'schedule-legend' },
        h('span', { class: 'schedule-key' }, h('span', { class: 'schedule-sw schedule-sw-window', 'aria-hidden': 'true' }), 'Window ', legWindow),
        h('span', { class: 'schedule-key' }, h('span', { class: 'schedule-sw schedule-sw-landmark', 'aria-hidden': 'true' }), 'Landmark ', legLandmark),
        h('span', { class: 'schedule-key' }, h('span', { class: 'schedule-sw schedule-sw-out', 'aria-hidden': 'true' }), 'outside the window'),
        h('span', { class: 'schedule-key' }, h('span', { class: 'schedule-sw schedule-sw-occ', 'aria-hidden': 'true' }), 'occasional, not counted'),
        h('span', { class: 'schedule-key' }, h('span', { class: 'schedule-sw schedule-sw-band', 'aria-hidden': 'true' }), 'check the schedule of activities')),
      chartBox);

    const insp = h('aside', { class: 'schedule-insp', 'aria-live': 'polite', 'aria-label': 'Details for the selected row' });

    root.appendChild(h('div', { class: 'schedule-main' }, controls, chartCol, insp));

    /* ---- counts table ---- */
    const tbody = h('tbody');
    const insight = h('div', { class: 'schedule-insight', 'aria-live': 'polite' });
    root.appendChild(h('section', { class: 'schedule-sec', 'aria-labelledby': P + 'count-h' },
      h('div', { class: 'schedule-sechead' }, h('h3', { id: P + 'count-h' }, 'Repeated measurements one participant can have'),
        h('span', { class: 'schedule-small' }, 'Upper bounds from the schedule, not counts of real participants')),
      h('div', { class: 'schedule-tablewrap' }, h('table', { class: 'schedule-table' },
        h('caption', null, 'Scheduled measurements inside the window, split at the landmark. The table follows the Show choices.'),
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Measurement'), h('th', { scope: 'col' }, 'Scheduled in the window (code, month)'),
          h('th', { scope: 'col', class: 'schedule-num' }, 'At most'), h('th', { scope: 'col', class: 'schedule-num' }, 'Up to landmark'),
          h('th', { scope: 'col', class: 'schedule-num' }, 'After it'), h('th', { scope: 'col' }, 'Role in the model'))),
        tbody)),
      insight));

    /* ---- notes on time, codes, illustration ---- */
    function note(title, text, key) {
      return h('div', { class: 'schedule-note' + (key ? ' is-key' : '') }, h('h5', null, title), h('p', null, text));
    }
    const illus = buildIllustration();
    root.appendChild(h('section', { class: 'schedule-sec', 'aria-labelledby': P + 'time-h' },
      h('div', { class: 'schedule-sechead' }, h('h3', { id: P + 'time-h' }, 'How time is recorded')),
      h('div', { class: 'schedule-grid2' },
        note('Dates are rounded to the month', 'PPMI rounds dates to the month to protect privacy, so the pipeline works at month precision. The axis above is in whole months for that reason (guide 2.3, 5.4).', true),
        h('div', { class: 'schedule-note is-key' }, h('h5', null, 'One visit can span months'),
          h('p', null, 'A shared visit code can hold measurements dated in different months, so an MRI and the cognitive tests of one visit may be months apart (guide 5.6).'),
          illus),
        note('Screening versus baseline', 'DaTScan starts at SC, about two months before cognition and MRI start at BL. Align them by date, not by code (guide 5.6, 6.2).'),
        note('Codes join; dates time', 'Visit codes are not fully reliable. Use dates for time, and codes only to join records from the same visit (guide 2.3).'),
        note('Asynchrony is fine', 'In a joint model with a shared latent stage, every observation enters at its own time. “Same-visit” filters throw data away (guide 6.4).'),
        note('Original protocol only', 'This is the original schedule (Marek et al. 2018). The expansion protocol started on 1 July 2020 (guide 2.1) and has its own schedule of activities, which the guide does not summarise.'))));

    const codes = [
      ['SC', 'Screening', 'About −2 months (typically about 60 days before BL)'],
      ['BL', 'Baseline, formal study entry', 'Month 0 on a baseline axis'],
      ['V01, V02, …', 'Scheduled follow-ups', 'Mapped: V04 12, V06 24, V08 36, V10 48, V12 60'],
      ['R', 'Remote assessments', 'No month in the guide'],
      ['U', 'Unscheduled visits', 'No month in the guide'],
      ['LOG', 'Running logs, such as medications', 'No month in the guide'],
      ['ST', 'Start of symptomatic therapy (older data)', 'No month in the guide'],
      ['PW', 'Premature withdrawal (older data)', 'No month in the guide']
    ];
    const codeGrid = h('div', { class: 'schedule-codes' });
    codes.forEach(function (c) {
      codeGrid.appendChild(h('div', { class: 'schedule-code' }, h('code', null, c[0]), h('span', null, c[1]), h('span', { class: 'schedule-when' }, c[2])));
    });
    const guideRow = canOpen ? h('p', { class: 'schedule-guide' }, 'Read in the guide:') : h('p', { class: 'schedule-guide' }, 'Guide sections: 2.3, 2.4, 4.6, 6.2, 6.4, 10.5');
    if (canOpen) {
      ['2.3', '2.4', '4.6', '6.2', '6.4', '10.5'].forEach(function (num) {
        const b = h('button', { type: 'button', class: 'schedule-link' }, num);
        on(b, 'click', function () { ctx.openSection(SECTION_IDS[num]); });
        guideRow.appendChild(b);
      });
    }
    root.appendChild(h('section', { class: 'schedule-sec', 'aria-labelledby': P + 'codes-h' },
      h('div', { class: 'schedule-sechead' }, h('h3', { id: P + 'codes-h' }, 'Visit codes (EVENT_ID)'),
        h('span', { class: 'schedule-small' }, 'Guide 2.3 and glossary. Confirm any code against the schedule of activities.')),
      codeGrid, guideRow));

    function buildIllustration() {
      // Illustrative only: one visit code holding a cognitive month and an MRI month. Drawn at 1:1 (240 px)
      // so its 12 px labels are never scaled down.
      const W = 240, Hh = 96;
      const xm = function (m) { return 28 + (m - 23) * 62; };
      const s = S('svg', { width: W, height: Hh, viewBox: '0 0 ' + W + ' ' + Hh, role: 'img', 'aria-label': 'Illustration: one visit code, V06, holding a cognitive test dated month 24 and an MRI dated month 25' });
      s.appendChild(S('rect', { class: 'schedule-band', x: xm(24) - 22, y: 6, width: xm(25) - xm(24) + 44, height: 52, rx: 8 }));
      s.appendChild(S('text', { class: 'schedule-tagtext', x: (xm(24) + xm(25)) / 2, y: 21, 'text-anchor': 'middle' }, 'event V06'));
      s.appendChild(S('circle', { class: 'schedule-dot schedule-tone-ink', cx: xm(24), cy: 40, r: 6 }));
      s.appendChild(S('circle', { class: 'schedule-dot schedule-tone-accent2', cx: xm(25), cy: 40, r: 6 }));
      s.appendChild(S('text', { class: 'schedule-bandtext', x: xm(24) - 28, y: 44, 'text-anchor': 'end' }, 'cognition'));
      s.appendChild(S('text', { class: 'schedule-bandtext', x: xm(25) + 28, y: 44 }, 'MRI'));
      s.appendChild(S('line', { class: 'schedule-axis', x1: 2, x2: W - 2, y1: 70, y2: 70 }));
      for (let m = 23; m <= 26; m++) {
        s.appendChild(S('line', { class: 'schedule-tickline', x1: xm(m), x2: xm(m), y1: 70, y2: 75 }));
        s.appendChild(S('text', { class: 'schedule-tick', x: xm(m), y: 90, 'text-anchor': 'middle' }, m === 23 ? 'month 23' : String(m)));
      }
      return h('div', { class: 'schedule-illus' }, s, h('p', { class: 'schedule-small', style: 'margin-top:4px' }, 'Illustrative, not PPMI data.'));
    }

    /* ---- chart drawing ---- */
    function laneList() {
      const list = [];
      if (state.show.codes) list.push('codes');
      ROWS.forEach(function (r) { if (state.show[r.id]) list.push(r.id); });
      return list;
    }
    function laneSummary(id, o) {
      const r = ROW_BY_ID[id];
      if (id === 'codes') return 'Visit codes: SC at about minus 2 months, BL at 0, V04 12, V06 24, V08 36, V10 48, V12 60.';
      if (r.unknown || r.eventBand) return r.label + ': ' + r.schedule;
      const c = countRow(r, o);
      return r.label + ': scheduled at ' + r.points.filter(function (p) { return !p.occasional; }).map(function (p) { return (p.code ? p.code + ' ' : '') + 'month ' + fmtMonth(pointTime(p, o.offset)); }).join(', ') +
        '. ' + c.total + ' in the window, ' + c.upTo + ' up to the landmark.';
    }

    function drawChart() {
      const o = opts();
      const W = Math.max(320, Math.floor(chartBox.getBoundingClientRect().width));
      const narrow = W < 620;
      const labelW = narrow ? 88 : 150;
      const padR = 10;
      const dom = axisDomain(o.offset);
      const tMin = dom[0], tMax = dom[1];
      const plotL = labelW, plotR = W - padR, plotW = plotR - plotL;
      const ppm = plotW / (tMax - tMin);
      function x(t) { return plotL + (t - tMin) * ppm; }
      const lanes = laneList();
      const topH = 28, rowH = 32;

      let tags = null, codesH = 0;
      if (lanes.indexOf('codes') >= 0) {
        tags = Object.keys(VISIT_MONTHS).map(function (c) { return { code: c, t: VISIT_MONTHS[c] + o.offset }; })
          .sort(function (a, b) { return a.t - b.t; });
        tags.forEach(function (it) { it.x = x(it.t); it.w = it.code.length * 7.3 + 12; });
        const idx = staggerTags(tags, 4);
        tags.forEach(function (it, i) { it.row = idx[i]; });
        codesH = (Math.max.apply(null, idx) + 1) * 23 + 9;
      }
      let y = topH;
      const geom = lanes.map(function (id) {
        const hh = id === 'codes' ? codesH : rowH;
        const g = { id: id, y0: y, h: hh };
        y += hh;
        return g;
      });
      const plotTop = topH, plotBottom = Math.max(y, topH + 20);
      const H = plotBottom + 50;
      clear(svg);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.setAttribute('width', W);
      svg.setAttribute('height', H);

      const gBack = S('g'), gGrid = S('g'), gLanes = S('g'), gTop = S('g');
      svg.appendChild(gBack); svg.appendChild(gGrid); svg.appendChild(gLanes); svg.appendChild(gTop);

      // analysis window
      gBack.appendChild(S('rect', { class: 'schedule-window', x: x(0), y: plotTop - 2, width: x(o.windowEnd) - x(0), height: plotBottom - plotTop + 2 }));
      [0, o.windowEnd].forEach(function (t) {
        gBack.appendChild(S('line', { class: 'schedule-winedge', x1: x(t), x2: x(t), y1: plotTop - 2, y2: plotBottom }));
      });
      // gridlines at the mapped visit months (shift with the origin)
      const codesBottom = lanes[0] === 'codes' ? plotTop + codesH : plotTop;
      Object.keys(VISIT_MONTHS).forEach(function (c) {
        const gx = x(VISIT_MONTHS[c] + o.offset);
        gGrid.appendChild(S('line', { class: 'schedule-grid', x1: gx, x2: gx, y1: codesBottom - 4, y2: plotBottom }));
      });
      // month axis: a tick per month, longer every 6, labels every 6 or 12 with years beneath
      gGrid.appendChild(S('line', { class: 'schedule-axis', x1: plotL, x2: plotR, y1: plotBottom, y2: plotBottom }));
      const labelEvery = ppm * 6 >= 34 ? 6 : 12;
      for (let t = Math.ceil(tMin); t <= Math.floor(tMax); t++) {
        const major = t % 6 === 0;
        if (!major && ppm < 3) continue;
        gGrid.appendChild(S('line', { class: 'schedule-tickline', x1: x(t), x2: x(t), y1: plotBottom, y2: plotBottom + (major ? 6 : 3) }));
        if (t % labelEvery === 0 && t >= 0) {
          gGrid.appendChild(S('text', { class: 'schedule-tick', x: x(t), y: plotBottom + 19, 'text-anchor': 'middle' }, fmtMonth(t)));
          if (t % 12 === 0 && t >= 0) gGrid.appendChild(S('text', { class: 'schedule-ytick', x: x(t), y: plotBottom + 33, 'text-anchor': 'middle' }, fmtYears(t) + ' y'));
        }
      }
      // the window end gets its own year label only when it clears the neighbouring labels
      if (o.windowEnd % 12 !== 0 && ppm * 6 >= 34) {
        gGrid.appendChild(S('text', { class: 'schedule-ytick', x: x(o.windowEnd), y: plotBottom + 33, 'text-anchor': 'middle' }, fmtYears(o.windowEnd) + ' y'));
      }
      gGrid.appendChild(S('text', { class: 'schedule-axis-title', x: plotL - 8, y: plotBottom + 19, 'text-anchor': 'end' }, 'months'));
      gGrid.appendChild(S('text', { class: 'schedule-axis-title', x: plotL - 8, y: plotBottom + 33, 'text-anchor': 'end' }, 'years'));
      gGrid.appendChild(S('text', { class: 'schedule-axis-title', x: plotR, y: plotBottom + 47, 'text-anchor': 'end' },
        (state.origin === 'diagnosis' ? 'Time since diagnosis' : 'Time since baseline') + ', whole months (dates are rounded to the month)'));

      // lanes
      geom.forEach(function (g) {
        const id = g.id;
        const row = ROW_BY_ID[id];
        const cy = g.y0 + g.h / 2;
        const lane = S('g', { class: 'schedule-lane' + (state.focus === id ? ' is-hot' : ''), tabindex: '0', role: 'img', 'aria-label': laneSummary(id, o), 'data-id': id });
        lane.appendChild(S('rect', { class: 'schedule-lanebg', x: 1, y: g.y0 + 1, width: W - 2, height: g.h - 2, rx: 5 }));
        lane.appendChild(S('text', { class: 'schedule-lanelabel', x: labelW - 10, y: cy + 4.5, 'text-anchor': 'end' }, narrow ? row.short : row.label));
        if (id === 'codes') {
          tags.forEach(function (it) {
            const ty = g.y0 + 6 + it.row * 23;
            const out = it.t > o.windowEnd || (it.t < 0 && !(it.code === 'SC' && o.includeSC));
            const tg = S('g', null, S('title', null, it.code + ': month ' + fmtMonth(it.t)));
            tg.appendChild(S('rect', { class: 'schedule-tag' + (out ? ' is-out' : ''), x: it.x - it.w / 2, y: ty, width: it.w, height: 18, rx: 4 }));
            tg.appendChild(S('text', { class: 'schedule-tagtext', x: it.x, y: ty + 13, 'text-anchor': 'middle' }, it.code));
            lane.appendChild(tg);
          });
        } else if (row.unknown || row.eventBand) {
          const bx0 = row.eventBand ? x(tMin) + 4 : x(o.offset);
          const bx1 = plotR - 4;
          lane.appendChild(S('rect', { class: 'schedule-band', x: bx0, y: cy - 9, width: Math.max(0, bx1 - bx0), height: 18, rx: 9 }));
          const full = row.eventBand ? 'U, R, LOG, ST, PW: no scheduled month in the guide' : 'timing not in the guide: check the schedule of activities';
          const short = row.eventBand ? 'U, R, LOG, ST, PW: no month' : 'check the schedule of activities';
          const txt = fitText([full, short, 'check schedule'], bx1 - bx0 - 16);
          if (txt) lane.appendChild(S('text', { class: 'schedule-bandtext', x: (bx0 + bx1) / 2, y: cy + 4, 'text-anchor': 'middle' }, txt));
        } else {
          if (row.band) {
            const bx0 = x(row.band.from + o.offset), bx1 = plotR - 4;
            if (bx1 - bx0 > 24) {
              lane.appendChild(S('rect', { class: 'schedule-band', x: bx0, y: cy - 9, width: bx1 - bx0, height: 18, rx: 9 }));
              const txt = fitText([row.band.text, row.band.shortText, 'check'], bx1 - bx0 - 16);
              if (txt) lane.appendChild(S('text', { class: 'schedule-bandtext', x: (bx0 + bx1) / 2, y: cy + 4, 'text-anchor': 'middle' }, txt));
            }
          }
          if (row.after) {
            const bx0 = x(row.after.from + o.offset) + 9, bx1 = plotR - 4;
            if (bx1 - bx0 > 20) {
              lane.appendChild(S('rect', { class: 'schedule-band', x: bx0, y: cy - 9, width: bx1 - bx0, height: 18, rx: 9 }));
              const txt = fitText([row.after.text, row.after.shortText], bx1 - bx0 - 12);
              if (txt) lane.appendChild(S('text', { class: 'schedule-bandtext', x: (bx0 + bx1) / 2, y: cy + 4, 'text-anchor': 'middle' }, txt));
            }
          }
          row.points.forEach(function (p) {
            const t = pointTime(p, o.offset);
            if (t < tMin || t > tMax) return;
            const what = row.label + (p.code ? ' at ' + p.code : '') + ', month ' + fmtMonth(t) + (p.occasional ? ' (occasional, not counted)' : '');
            if (p.occasional) {
              lane.appendChild(S('circle', { class: 'schedule-occ', cx: x(t), cy: cy, r: 4.5 }, S('title', null, what)));
            } else {
              const inW = isCounted(p, t, o);
              lane.appendChild(S('circle', { class: 'schedule-dot schedule-tone-' + row.tone + (inW ? '' : ' is-out'), cx: x(t), cy: cy, r: 5 },
                S('title', null, what + (inW ? '' : ' (outside the window)'))));
            }
          });
        }
        on(lane, 'pointerenter', function () { focusLane(id); });
        on(lane, 'focus', function () { focusLane(id); });
        gLanes.appendChild(lane);
      });

      // landmark: the line sits under the lanes so bands and dots stay readable; its labels sit on top
      const lx = x(o.landmark);
      gGrid.appendChild(S('line', { class: 'schedule-landmark', x1: lx, x2: lx, y1: 4, y2: plotBottom }));
      const leftRoom = lx - 7 - plotL, rightRoom = plotR - (lx + 7);
      const lt = fitText(['data used to estimate stages', 'estimate stages', 'estimate'], leftRoom);
      const rt = fitText(['later data predicted and scored', 'later data scored', 'scored'], rightRoom);
      if (lt) gTop.appendChild(S('text', { class: 'schedule-lmtext', x: lx - 7, y: 16, 'text-anchor': 'end' }, '← ' + lt));
      if (rt) gTop.appendChild(S('text', { class: 'schedule-lmtext', x: lx + 7, y: 16 }, rt + ' →'));
    }
    // Pick the longest text that fits an estimated width (12 px UI font, about 6.4 px per character).
    function fitText(options, room) {
      for (let i = 0; i < options.length; i++) if (options[i] && (options[i].length + 2) * 6.4 <= room) return options[i];
      return '';
    }

    function focusLane(id) {
      if (state.focus === id) return;
      state.focus = id;
      svg.querySelectorAll('.schedule-lane').forEach(function (n) { n.classList.toggle('is-hot', n.getAttribute('data-id') === id); });
      fillInspector();
    }

    /* ---- inspector ---- */
    function fillInspector() {
      const o = opts();
      const id = state.show[state.focus] ? state.focus : laneList()[0];
      clear(insp);
      if (!id) { insp.appendChild(h('p', { class: 'schedule-small' }, 'Turn on a row under Show.')); return; }
      const r = ROW_BY_ID[id];
      insp.appendChild(h('h4', null, r.label));
      insp.appendChild(h('p', { class: 'schedule-role' }, r.role));
      const dl = h('dl');
      dl.appendChild(h('dt', null, 'Schedule'));
      dl.appendChild(h('dd', null, r.schedule));
      if (r.points) {
        const c = countRow(r, o);
        dl.appendChild(h('dt', null, 'On this axis'));
        dl.appendChild(h('dd', null, c.total + ' in the window, ' + c.upTo + ' up to the landmark, ' + c.after + ' after it.'));
      }
      if (r.notes) { dl.appendChild(h('dt', null, 'Watch out')); dl.appendChild(h('dd', null, r.notes)); }
      dl.appendChild(h('dt', null, 'Source'));
      dl.appendChild(h('dd', null, r.source));
      insp.appendChild(dl);
      insp.appendChild(h('p', { class: 'schedule-small' }, 'Hover or focus a row in the chart to see its details.'));
    }

    /* ---- table and insight ---- */
    const TONE_VAR = { ink: 'var(--fg)', accent: 'var(--accent)', accent2: 'var(--accent-2)', muted: 'var(--muted)' };
    function fillTable() {
      const o = opts();
      clear(tbody);
      ROWS.forEach(function (r) {
        if (!state.show[r.id] || r.eventBand) return;
        const tr = h('tr');
        tr.appendChild(h('th', { scope: 'row', style: 'font-weight:500' },
          h('span', { class: 'schedule-swrow', style: 'background:' + TONE_VAR[r.tone], 'aria-hidden': 'true' }), r.label));
        if (!r.points) {
          tr.appendChild(h('td', { class: 'schedule-check', colspan: '4' }, 'Not in the guide: check the schedule of activities'));
        } else {
          const c = countRow(r, o);
          const list = c.items.map(function (it) { return (it.code ? it.code + ' ' : '') + fmtMonth(it.t); }).join(', ');
          let extra = '';
          if (r.id === 't1') extra = '; repeats in a subset (months not in the guide)';
          if (r.id === 'motor') extra = '; visits after V12 not in the guide';
          tr.appendChild(h('td', null, (list || 'none') + extra));
          tr.appendChild(h('td', { class: 'schedule-num' }, r.id === 't1' ? c.total + ' + ?' : String(c.total)));
          tr.appendChild(h('td', { class: 'schedule-num' }, String(c.upTo)));
          tr.appendChild(h('td', { class: 'schedule-num' }, r.id === 't1' ? c.after + ' + ?' : String(c.after)));
        }
        tr.appendChild(h('td', null, r.role));
        tbody.appendChild(tr);
      });
      if (!tbody.firstChild) tbody.appendChild(h('tr', null, h('td', { colspan: '6', class: 'schedule-check' }, 'Turn on a measurement under Show.')));
    }

    function fillInsight() {
      const o = opts();
      clear(insight);
      const cog = countRow(ROW_BY_ID.cog, o), dat = countRow(ROW_BY_ID.dat, o), gmv = countRow(ROW_BY_ID.gmv, o);
      insight.appendChild(h('p', null,
        'With the landmark at ' + o.landmark + ' months, a held-out participant on this schedule contributes at most ' +
        plural(cog.upTo, 'cognitive visit', 'cognitive visits') + ', ' + plural(dat.upTo, 'DaTScan', 'DaTScans') + ' and ' +
        plural(gmv.upTo, 'grey matter volume', 'grey matter volumes') + ' up to it. ' +
        'The models are then scored on at most ' + cog.after + ', ' + dat.after + ' and ' + gmv.after + ' later measurements of these three.'));
      const diff = compareWindows(o);
      if (diff.length === 0) {
        insight.appendChild(h('p', null, 'On this time axis both windows hold the same scheduled measurements. They differ only for measurements dated after 60 months, such as a 60-month visit held late.'));
      } else {
        insight.appendChild(h('p', null, 'On this time axis the window matters. Moving from 0 to 5.5 years to 0 to 5 years drops ' +
          diff.map(function (d) { return d.noun + ' from ' + d.w55 + ' to ' + d.w5; }).join('; ') + '.'));
      }
      if (o.offset === 0 && !o.includeSC) {
        insight.appendChild(h('p', null, 'Without the screening scan, a participant has at most ' + dat.total + ' DaTScans in the window, the first at 12 months.'));
      }
    }

    function render() {
      const o = opts();
      legWindow.textContent = '0 to ' + state.windowKey + ' years';
      legLandmark.textContent = o.landmark + ' months (' + fmtYears(o.landmark) + ' years)';
      lmOut.textContent = o.landmark + ' months (' + fmtYears(o.landmark) + ' years)';
      lmReset.disabled = o.landmark === LANDMARK_DEFAULT;
      if (!state.show[state.focus]) state.focus = laneList()[0] || 'cog';
      drawChart();
      fillInspector();
      fillTable();
      fillInsight();
    }
    function schedule() {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; render(); });
    }

    function applyWidth(w) {
      root.classList.toggle('schedule-w0', w >= 520);
      root.classList.toggle('schedule-w1', w >= 760);
      root.classList.toggle('schedule-w2', w >= 1100);
      root.classList.toggle('schedule-w3', w >= 1400);
    }
    let lastW = -1;
    const ro = new ResizeObserver(function (entries) {
      const w = Math.round(entries[0].contentRect.width);
      if (w === lastW) return;
      lastW = w;
      applyWidth(w);
      schedule();
    });
    ro.observe(el);
    applyWidth(el.getBoundingClientRect().width);
    render();

    return {
      destroy: function () {
        ro.disconnect();
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        ac.abort();
        if (root.parentNode) root.parentNode.removeChild(root);
        liveInstances = Math.max(0, liveInstances - 1);
        if (liveInstances === 0) {
          const st = document.getElementById('style-' + NAME);
          if (st && st.parentNode) st.parentNode.removeChild(st);
        }
      }
    };
  }

  X[NAME] = {
    title: 'PPMI visits and the analysis time axis',
    blurb: 'See when PPMI schedules each measurement, where the analysis window and 2.5-year landmark fall, and how many repeats each modality can give.',
    mount: mount,
    // Pure functions and data, exposed for unit tests (no extra globals).
    lib: {
      VISIT_MONTHS: VISIT_MONTHS, WINDOWS: WINDOWS, LANDMARK_DEFAULT: LANDMARK_DEFAULT, ROWS: ROWS, ROW_BY_ID: ROW_BY_ID,
      motorMonths: motorMonths, codeForMonth: codeForMonth, pointTime: pointTime, isCounted: isCounted,
      countRow: countRow, compareWindows: compareWindows, staggerTags: staggerTags, axisDomain: axisDomain
    }
  };
})();
