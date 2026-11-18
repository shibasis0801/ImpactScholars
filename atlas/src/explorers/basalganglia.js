/* PPMI Atlas explorer: "Basal ganglia loop: a rate-model sandbox".
   Plain ES2020, no build step, no libraries, no network. Registers window.PPMIExplorers.basalganglia.
   The rate model below is a teaching cartoon of the classic box model (Albin et al. 1989; DeLong 1990)
   with the hyperdirect pathway (Nambu et al. 2002). Every number it produces is simulated. */
(function () {
  'use strict';

  const NAME = 'basalganglia';
  const X = (window.PPMIExplorers = window.PPMIExplorers || {});
  const SVGNS = 'http://www.w3.org/2000/svg';
  let instanceCount = 0;
  let liveInstances = 0;

  /* ==================================================================
   * 1. The rate model (pure functions, unit-tested in basalganglia.test.mjs)
   *    One number per nucleus: its mean firing rate, scaled so that the
   *    healthy steady state is exactly 1 (shown as 100%).
   *    Units are linear-threshold: rate = [summed input]+ = max(0, input).
   * ================================================================== */
  const PARAMS = Object.freeze({
    wTC: 0.25,   // thalamus -> cortex (excitatory)
    wCS: 1.5,    // cortex -> striatal projection neurons (gain); threshold = wCS - 1
    kD1: 0.5,    // dopamine raises the cortical gain of D1 (direct-pathway) neurons
    kD2: 0.5,    // dopamine lowers the cortical gain of D2 (indirect-pathway) neurons
    wD2E: 0.6,   // D2 neurons -| GPe
    wCSTN: 0.4,  // cortex -> STN (hyperdirect)
    wES: 1.5,    // GPe -| STN
    wSG: 0.4,    // STN -> GPi/SNr
    wD1G: 0.4,   // D1 neurons -| GPi/SNr
    wGT: 1.0,    // GPi/SNr -| thalamus
    rhoL: 0.6,   // levodopa restores this fraction of the missing dopamine signal
    uDBS: 0.7,   // STN DBS (cartoon) removes this fraction of STN output
    pulseAmp: 1.6, pulseOn: 1, pulseOff: 2.5, tEnd: 15, dt: 0.02,
  });
  const KEYS = Object.freeze(['C', 'D1', 'D2', 'E', 'S', 'G', 'T']);

  function relu(x) { return x > 0 ? x : 0; }

  // Constant inputs chosen so that every rate equals 1 when dopamine is normal and nothing is switched on.
  function baseInputs(p) {
    return { C: 1 - p.wTC, th: p.wCS - 1, E: 1 + p.wD2E, S: 1 - p.wCSTN + p.wES, G: 1 - p.wSG + p.wD1G, T: 1 + p.wGT };
  }

  // Dopamine signal reaching striatal receptors (1 = healthy). Levodopa restores part of what is missing.
  function dopamineSignal(d, levodopa, p) {
    p = p || PARAMS;
    return d + (levodopa ? p.rhoL * (1 - d) : 0);
  }

  // Right-hand side: the rate each population would settle at, given the current rates r.
  function targetRates(r, o, pulse, p) {
    const b = baseInputs(p);
    const da = dopamineSignal(o.dopamine, o.levodopa, p);
    const stnOut = (o.dbs ? 1 - p.uDBS : 1) * r.S;
    return {
      C: relu(b.C + p.wTC * r.T),
      D1: relu(p.wCS * (1 + p.kD1 * (da - 1)) * r.C - b.th),
      D2: relu(p.wCS * (1 + p.kD2 * (1 - da)) * r.C - b.th),
      E: relu(b.E - p.wD2E * r.D2),
      S: relu(b.S + p.wCSTN * r.C + pulse - p.wES * r.E),
      G: relu(b.G + p.wSG * stnOut - p.wD1G * r.D1),
      T: relu(b.T - p.wGT * r.G),
    };
  }

  function decorate(r, o, p) {
    r.da = dopamineSignal(o.dopamine, o.levodopa, p);
    r.Sout = (o.dbs ? 1 - p.uDBS : 1) * r.S;
    return r;
  }

  // Steady state of tau dr/dt = -r + [input]+, by damped fixed-point iteration from the healthy state.
  function steadyState(o, p) {
    p = p || PARAMS;
    const r = { C: 1, D1: 1, D2: 1, E: 1, S: 1, G: 1, T: 1 };
    for (let i = 0; i < 4000; i++) {
      const f = targetRates(r, o, 0, p);
      let change = 0;
      for (const k of KEYS) {
        const v = r[k] + 0.5 * (f[k] - r[k]);
        const dv = Math.abs(v - r[k]);
        if (dv > change) change = dv;
        r[k] = v;
      }
      if (change < 1e-11) break;
    }
    return decorate(r, o, p);
  }

  // Time course after a brief extra cortical input onto STN (the hyperdirect "brake"). Euler, all tau = 1.
  function simulatePulse(o, p) {
    p = p || PARAMS;
    const n = Math.round(p.tEnd / p.dt);
    const base = steadyState(o, p);
    const r = {};
    for (const k of KEYS) r[k] = base[k];
    const out = { t: new Array(n + 1), states: new Array(n + 1), base: base, on: p.pulseOn, off: p.pulseOff };
    for (let i = 0; i <= n; i++) {
      const t = i * p.dt;
      const pulse = t >= p.pulseOn && t < p.pulseOff ? p.pulseAmp : 0;
      out.t[i] = t;
      out.states[i] = decorate(Object.assign({ P: pulse }, r), o, p);
      const f = targetRates(r, o, pulse, p);
      for (const k of KEYS) r[k] += p.dt * (f[k] - r[k]);
    }
    return out;
  }

  // Plain-language bands for thalamocortical drive (illustrative cut-offs, not clinical scores).
  const BANDS = Object.freeze([
    { lo: 0, hi: 0.5, key: 'akinesia', motor: 'Severe', generic: 'Severe', tone: 'critical',
      say: 'Severely slowed: movement is hard to start (akinesia)' },
    { lo: 0.5, hi: 0.75, key: 'bradykinesia', motor: 'Slow', generic: 'Low', tone: 'critical',
      say: 'Slowed: slow, small movements (bradykinesia)' },
    { lo: 0.75, hi: 0.92, key: 'mild', motor: 'Mild', generic: 'Mild dip', tone: 'warn',
      say: 'Mildly slowed' },
    { lo: 0.92, hi: 1.15, key: 'normal', motor: 'Normal', generic: 'Normal', tone: 'good',
      say: 'Normal vigour' },
    { lo: 1.15, hi: Infinity, key: 'excess', motor: 'Excess', generic: 'Excess', tone: 'warn',
      say: 'Excess: in the rate model, too little GPi/SNr output goes with involuntary movement (DeLong 1990)' },
  ]);
  const G_MIN = 0.25, G_MAX = 1.5; // range drawn by the vigour gauge
  function vigourBand(v) {
    for (const b of BANDS) if (v < b.hi) return b;
    return BANDS[BANDS.length - 1];
  }

  /* ==================================================================
   * 2. Content from the guide (section 3.3 table; 3.2; 3.5; 4.1; 5.1; 8.3)
   * ================================================================== */
  const LOOPS = [
    {
      id: 'motor', name: 'Motor', cortex: 'Motor and supplementary motor cortex', target: 'Posterior putamen',
      fn: 'Movement scaling, habits', output: 'movement',
      measure: 'Putamen DaTScan SBR. Its loss should track motor signs, rated on MDS-UPDRS Part III (guide 3.3, 4.1).',
      extra: 'Posterior putamen also supports habits; PD erodes habitual control first (Redgrave et al. 2010, guide 3.3).',
      loss: 'Hit first and hardest: the ventrolateral SNc tier, lost first, projects to the dorsal and posterior putamen (guide 3.2).',
      link: ['43-datscan-spect', 'DaTScan SPECT, guide 4.3'],
    },
    {
      id: 'oculo', name: 'Oculomotor', cortex: 'Frontal eye fields', target: 'Body of the caudate',
      fn: 'Eye movements', output: 'eye movements',
      measure: 'Not among the worked example’s measures. The caudate SBR averages this territory together with the associative ones.',
      extra: '',
      loss: 'Caudate: relatively spared early (guide 3.2).',
      link: ['43-datscan-spect', 'DaTScan SPECT, guide 4.3'],
    },
    {
      id: 'dlpfc', name: 'Dorsolateral prefrontal', cortex: 'Dorsolateral prefrontal cortex', target: 'Dorsolateral caudate head',
      fn: 'Working memory, planning, set-shifting', output: 'working memory, planning and set-shifting',
      measure: 'Caudate DaTScan SBR. Its loss should track executive and working-memory problems, which Letter-Number Sequencing picks up (guide 3.3); Symbol Digit Modalities also leans dopaminergic (guide 3.5).',
      extra: 'In PPMI, 22% of patients already had bilateral caudate loss at baseline, and it predicted more cognitive impairment (Pasquini et al. 2019, guide 8.3).',
      loss: 'Caudate: relatively spared early; it carries most of the information about later stages (guide 3.2, 6.2).',
      link: ['42-the-six-cognitive-tests', 'The six cognitive tests, guide 4.2'],
    },
    {
      id: 'lofc', name: 'Lateral orbitofrontal', cortex: 'Lateral orbitofrontal cortex', target: 'Ventromedial caudate',
      fn: 'Flexibility, reward updating', output: 'flexibility and reward updating',
      measure: 'No direct test in PPMI’s six-test battery; the caudate SBR is the nearest DaTScan measure.',
      extra: 'Levodopa dosed for the depleted dorsal striatum can "overdose" the relatively intact ventral striatum and impair flexible learning (Gotham et al. 1988; Cools 2006; guide 3.5).',
      loss: 'Relatively spared early (guide 3.2).',
      link: ['35-why-cognition-declines-the-dual-syndrome-hypothesis', 'Dual syndrome hypothesis, guide 3.5'],
    },
    {
      id: 'acc', name: 'Anterior cingulate', cortex: 'Anterior cingulate, medial orbitofrontal', target: 'Ventral striatum',
      fn: 'Motivation, emotion', output: 'motivation and emotion',
      measure: 'Not measured directly: PPMI’s DaTScan tables give left and right caudate and putamen SBRs only (guide 5.4).',
      extra: '',
      loss: 'Ventral striatum (limbic territory): relatively spared early (guide 3.2).',
      link: ['32-the-nigrostriatal-dopamine-system', 'Nigrostriatal system, guide 3.2'],
    },
  ];

  /* ==================================================================
   * 3. Styles (one <style id="style-basalganglia">, scoped to the root class)
   * ================================================================== */
  const CSS = `
.basalganglia-root{font-family:var(--font-ui);color:var(--fg);font-size:14px;line-height:1.45}
.basalganglia-root *,.basalganglia-root *::before,.basalganglia-root *::after{box-sizing:border-box}
.basalganglia-root :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.basalganglia-layout{display:flex;flex-direction:column;gap:14px}
.basalganglia-col,.basalganglia-colr{display:contents}
.basalganglia-root.basalganglia-is-wide .basalganglia-layout{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(360px,1fr);gap:18px;align-items:start}
.basalganglia-root.basalganglia-is-wide .basalganglia-col,.basalganglia-root.basalganglia-is-wide .basalganglia-colr{display:flex;flex-direction:column;gap:14px;min-width:0}
.basalganglia-root.basalganglia-is-ultra .basalganglia-layout{grid-template-columns:minmax(0,1.45fr) minmax(300px,.85fr) minmax(330px,1fr)}
.basalganglia-root.basalganglia-is-ultra .basalganglia-colr{display:contents}
.basalganglia-controls{order:1}.basalganglia-loops{order:2}.basalganglia-figure{order:3}.basalganglia-readouts{order:4}
.basalganglia-sweep{order:5}.basalganglia-pulse{order:6}.basalganglia-loopcard{order:7}
.basalganglia-card{background:var(--surface);border:1px solid var(--rule);border-radius:10px;padding:14px 16px;margin:0;min-width:0}
.basalganglia-model{margin-top:14px}
.basalganglia-h{font-size:13px;font-weight:600;margin:0 0 8px;letter-spacing:.01em}
.basalganglia-howto{font-size:13px;color:var(--muted);margin:0 0 10px}
.basalganglia-howto b{color:var(--fg);font-weight:600}
.basalganglia-sim{font-size:12px;color:var(--muted);margin:8px 0 0;font-style:italic}
.basalganglia-hint{font-size:12px;color:var(--muted);margin:3px 0 0;line-height:1.4}
.basalganglia-seg{position:relative;display:flex;flex-wrap:wrap;gap:6px}
.basalganglia-segin{position:absolute;left:0;top:0;opacity:0;width:1px;height:1px;margin:0;pointer-events:none}
.basalganglia-seglab{display:inline-block;padding:5px 12px;border:1px solid var(--rule);border-radius:999px;font-size:13px;cursor:pointer;background:var(--surface);color:var(--fg);user-select:none;-webkit-user-select:none}
.basalganglia-seglab:hover{border-color:var(--axis)}
.basalganglia-segin:checked+.basalganglia-seglab{background:var(--fg);color:var(--surface);border-color:var(--fg)}
.basalganglia-segin:focus-visible+.basalganglia-seglab{outline:2px solid var(--accent);outline-offset:2px}
.basalganglia-label{font-size:13px;font-weight:600;margin:0 0 8px}
.basalganglia-ctrl{margin:0 0 14px}
.basalganglia-ctrl-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.basalganglia-ctrl-head label{font-size:13px;font-weight:600}
.basalganglia-ctrl output{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--accent)}
.basalganglia-range{width:100%;margin:6px 0 0;accent-color:var(--accent);cursor:pointer}
.basalganglia-scale{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.basalganglia-check{display:flex;gap:8px;align-items:flex-start;margin:0 0 10px}
.basalganglia-check input{margin:3px 0 0;accent-color:var(--accent);width:16px;height:16px;flex:none;cursor:pointer}
.basalganglia-check label{font-size:13px;font-weight:600;cursor:pointer}
.basalganglia-btnrow{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin-top:4px}
.basalganglia-btn{font:600 13px/1 var(--font-ui);padding:8px 14px;border-radius:8px;border:1px solid var(--axis);background:var(--surface-2);color:var(--fg);cursor:pointer}
.basalganglia-btn:hover{border-color:var(--fg)}
.basalganglia-btn:active{transform:translateY(1px)}
.basalganglia-status{font-size:12px;color:var(--fg);margin:6px 0 0;min-height:1.4em}
.basalganglia-readgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px 22px}
.basalganglia-meter+.basalganglia-meter{margin-top:12px}
.basalganglia-mhead{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.basalganglia-mname{font-size:13px;font-weight:600}
.basalganglia-mval{font-size:22px;font-weight:600;font-variant-numeric:tabular-nums}
.basalganglia-bar{position:relative;height:10px;border-radius:5px;background:var(--surface-2);margin:6px 0 3px}
.basalganglia-bar>i{position:absolute;left:0;top:0;bottom:0;border-radius:5px;background:var(--fg);opacity:.7}
.basalganglia-bar>b{position:absolute;left:50%;top:-4px;bottom:-4px;width:2px;margin-left:-1px;background:var(--fg)}
.basalganglia-bscale{position:relative;display:flex;justify-content:space-between;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.basalganglia-bscale span.basalganglia-mid{position:absolute;left:50%;transform:translateX(-50%)}
.basalganglia-msay{font-size:12px;color:var(--muted);margin:4px 0 0}
.basalganglia-gwrap{position:relative;margin:30px 0 4px}
.basalganglia-gtrack{display:flex;height:16px;border-radius:8px;overflow:hidden}
.basalganglia-gseg{height:100%;opacity:.42}
.basalganglia-gseg.basalganglia-on{opacity:1}
.basalganglia-glabs{display:flex;font-size:12px;color:var(--muted);margin-top:4px}
.basalganglia-glabs span{overflow:hidden;white-space:nowrap;text-overflow:clip;text-align:center}
.basalganglia-glabs span.basalganglia-on{color:var(--fg);font-weight:600}
.basalganglia-gmark{position:absolute;top:-27px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;pointer-events:none}
.basalganglia-gmark span{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1}
.basalganglia-gmark i{display:block;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid var(--fg);margin-top:3px}
.basalganglia-gsay{font-size:15px;font-weight:600;margin:6px 0 0}
.basalganglia-gsay.basalganglia-tone-critical{color:var(--critical)}.basalganglia-gsay.basalganglia-tone-warn{color:var(--warn)}.basalganglia-gsay.basalganglia-tone-good{color:var(--good)}
.basalganglia-charts{display:flex;flex-wrap:wrap;gap:12px 14px}
.basalganglia-chart{flex:1 1 220px;min-width:0}
.basalganglia-chart svg,.basalganglia-pulsehost svg{display:block;overflow:visible}
.basalganglia-legend{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12px;color:var(--muted);margin-top:6px}
.basalganglia-legend span{display:inline-flex;align-items:center;gap:6px}
.basalganglia-figure{padding-bottom:12px}
.basalganglia-diagram-host{width:100%}
.basalganglia-diagram-host svg{display:block;overflow:visible}
.basalganglia-key{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12px;color:var(--muted);margin-top:8px}
.basalganglia-key span{display:inline-flex;align-items:center;gap:6px}
.basalganglia-key svg{flex:none;overflow:visible}
.basalganglia-root svg text{font-family:var(--font-ui);font-size:12px;fill:var(--muted)}
.basalganglia-root svg .basalganglia-t-node{font-size:13px;font-weight:600;fill:var(--fg)}
.basalganglia-root svg .basalganglia-t-val{font-size:12px;fill:var(--fg);font-variant-numeric:tabular-nums}
.basalganglia-root svg .basalganglia-t-area{font-size:12px;fill:var(--fg)}
.basalganglia-root svg .basalganglia-t-halo{paint-order:stroke;stroke:var(--surface);stroke-width:3px;stroke-opacity:.55;stroke-linejoin:round}
.basalganglia-root svg .basalganglia-t-edge{font-size:12px;fill:var(--muted);font-style:italic}
.basalganglia-root svg .basalganglia-t-title{font-size:13px;font-weight:600;fill:var(--fg)}
.basalganglia-root svg .basalganglia-t-tick{font-size:12px;fill:var(--muted);font-variant-numeric:tabular-nums}
.basalganglia-root svg .basalganglia-t-dop{font-size:12px;fill:var(--accent);font-weight:600}
.basalganglia-root svg .basalganglia-t-dbs{font-size:12px;fill:var(--warn);font-weight:600}
.basalganglia-loopcard h3{font-size:15px;margin:0 0 8px;font-weight:600}
.basalganglia-dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;margin:0;font-size:13px}
.basalganglia-dl dt{color:var(--muted);font-weight:500}
.basalganglia-dl dd{margin:0;font-family:var(--font-body);line-height:1.5}
.basalganglia-dl dd.basalganglia-ui{font-family:var(--font-ui);font-weight:600}
.basalganglia-link{font:600 12px/1.2 var(--font-ui);color:var(--accent);background:none;border:none;padding:2px 0;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.basalganglia-links{display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:10px}
.basalganglia-model summary{cursor:pointer;font-size:13px;font-weight:600}
.basalganglia-model p{font-family:var(--font-body);font-size:13px;line-height:1.55;margin:8px 0 0;max-width:88ch}
.basalganglia-model pre{font-family:var(--font-mono);font-size:12px;line-height:1.6;background:var(--tint);border:1px solid var(--rule);border-radius:8px;padding:10px 12px;margin:10px 0 0;overflow-x:auto;color:var(--fg)}
.basalganglia-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
`;

  function ensureStyle() {
    if (document.getElementById('style-' + NAME)) return;
    const s = document.createElement('style');
    s.id = 'style-' + NAME;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ==================================================================
   * 4. Small DOM and SVG helpers
   * ================================================================== */
  function svgEl(tag, attrs, parent) {
    const n = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function svgText(parent, x, y, str, cls, anchor) {
    const t = svgEl('text', { x: r1(x), y: r1(y), class: cls || '' }, parent);
    if (anchor) t.setAttribute('text-anchor', anchor);
    t.textContent = str;
    return t;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function pct(v) { return Math.round(v * 100) + '%'; }
  function mixFg(p) { return 'color-mix(in oklab, var(--fg) ' + p.toFixed(1) + '%, var(--surface))'; }
  function mixAccent(p) { return 'color-mix(in oklab, var(--accent) ' + p.toFixed(1) + '%, var(--surface))'; }
  function arrowFor(v) { return v > 1.02 ? ' ↑' : v < 0.98 ? ' ↓' : ''; }
  function pathFrom(pts) {
    let d = '';
    for (let i = 0; i < pts.length; i++) d += (i ? 'L' : 'M') + r1(pts[i][0]) + ',' + r1(pts[i][1]);
    return d;
  }

  // Polyline ending in an arrowhead (excitatory) or a flat bar (inhibitory), sized from the stroke width.
  function edgeGeometry(pts, kind, sw) {
    const n = pts.length;
    const a = pts[n - 2], b = pts[n - 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, px = -uy, py = ux;
    let end, cap, barW = 0;
    if (kind === 'exc') {
      const L = 6 + 1.6 * sw, H = 3.6 + 1.15 * sw;
      const bx = b[0] - ux * L, by = b[1] - uy * L;
      end = [bx + ux * 1.2, by + uy * 1.2];
      cap = r1(b[0]) + ',' + r1(b[1]) + ' ' + r1(bx + px * H) + ',' + r1(by + py * H) + ' ' + r1(bx - px * H) + ',' + r1(by - py * H);
    } else {
      const H = 6.5 + 1.3 * sw;
      barW = Math.max(2.6, 0.95 * sw);
      const cx = b[0] - ux * barW / 2, cy = b[1] - uy * barW / 2;
      end = [b[0] - ux * barW * 0.9, b[1] - uy * barW * 0.9];
      cap = 'M' + r1(cx + px * H) + ',' + r1(cy + py * H) + 'L' + r1(cx - px * H) + ',' + r1(cy - py * H);
    }
    return { d: pathFrom(pts.slice(0, n - 1).concat([end])), cap: cap, barW: barW };
  }

  /* ==================================================================
   * 5. Circuit layout (computed for the real pixel width so text stays 12 to 13 px)
   * ================================================================== */
  function layoutDiagram(Wpx) {
    const W = clamp(Wpx, 480, 960);
    const ox = Math.max(0, (Wpx - W) / 2);
    const nw = Math.round(clamp(W * 0.2, 104, 150));
    const nh = 46;
    const xL = ox + W * 0.29, xR = ox + W * 0.71, xMid = ox + W * 0.5;
    const xS = (xL + xMid) / 2 + 12;
    const xH = xR + nw / 2 + Math.max(34, W * 0.07);
    const xRet = ox + 18;
    const cx0 = ox + W * 0.12;
    const ctxBox = { x: cx0, y: 14, w: xH + 26 - cx0, h: 60 };
    const yStr = 160, yE = 262, ySTN = 372, yT = 470;
    const node = (cx, cy, w, h) => ({ cx: cx, cy: cy, w: w, h: h, l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2 });
    const N = {
      C: node(ctxBox.x + ctxBox.w / 2, ctxBox.y + ctxBox.h / 2, ctxBox.w, ctxBox.h),
      D1: node(xL, yStr, nw, nh),
      D2: node(xR, yStr, nw, nh),
      E: node(xR, yE, nw, nh),
      S: node(xR, ySTN, nw, nh),
      G: node(xL, ySTN, nw, nh),
      T: node(xL, yT, nw, nh),
      SNc: node(xS, yE, 102, nh),
    };
    const g = 2;
    const E = [
      { id: 'c_d1', kind: 'exc', pts: [[xL, N.C.b], [xL, N.D1.t - g]] },
      { id: 'c_d2', kind: 'exc', pts: [[xR, N.C.b], [xR, N.D2.t - g]] },
      { id: 'c_stn', kind: 'exc', pts: [[xH, N.C.b], [xH, ySTN], [N.S.r + g, ySTN]] },
      { id: 'd1_g', kind: 'inh', pts: [[xL, N.D1.b], [xL, N.G.t - g]] },
      { id: 'd2_e', kind: 'inh', pts: [[xR, N.D2.b], [xR, N.E.t - g]] },
      { id: 'e_s', kind: 'inh', pts: [[xR, N.E.b], [xR, N.S.t - g]] },
      { id: 's_g', kind: 'exc', pts: [[N.S.l, ySTN], [N.G.r + g, ySTN]] },
      { id: 'g_t', kind: 'inh', pts: [[xL, N.G.b], [xL, N.T.t - g]] },
      { id: 't_c', kind: 'exc', pts: [[N.T.l, yT], [xRet, yT], [xRet, N.C.cy], [N.C.l - g, N.C.cy]] },
      { id: 'snc_d1', kind: 'exc', dop: true, pts: [[N.SNc.l + 20, N.SNc.t], [N.D1.r - 22, N.D1.b + g]] },
      { id: 'snc_d2', kind: 'inh', dop: true, pts: [[N.SNc.r - 18, N.SNc.t], [N.D2.l + 22, N.D2.b + g]] },
    ];
    return {
      width: Wpx, height: 506, N: N, E: E, nw: nw,
      group: { x: N.D1.l - 12, y: 106, w: N.D2.r + 12 - (N.D1.l - 12), h: 106 },
      xL: xL, xR: xR, xH: xH, xRet: xRet, ySTN: ySTN, yT: yT,
      labels: {
        direct: [xL - 8, (N.D1.b + N.G.t) / 2 + 30],
        indirect: [xR + 8, N.E.t - 9],
        hyper: [xH + 14, (N.C.b + ySTN) / 2],
        ret: [xRet + 14, (N.C.cy + yT) / 2 + 30],
      },
    };
  }

  /* ==================================================================
   * 6. Mount
   * ================================================================== */
  function mount(el, ctx) {
    ensureStyle();
    liveInstances++;
    const uid = ++instanceCount;
    const id = (s) => NAME + '-' + s + '-' + uid;
    const openSection = (sid) => { if (ctx && typeof ctx.openSection === 'function') ctx.openSection(sid); };
    const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    const state = { dopamine: 1, levodopa: false, dbs: false, loop: 'motor' };
    let raf = 0, layoutRaf = 0, anim = null, brakeSig = '', lastBandKey = '';
    let diagram = null, pulseRefs = null;
    const sweepCache = new Map();

    const root = document.createElement('div');
    root.className = NAME + '-root';
    el.appendChild(root);
    root.innerHTML = template(id);
    const q = (s) => root.querySelector(s);

    const ui = {
      dop: q('#' + id('dopamine')), dopOut: q('#' + id('dopamine-out')),
      ldopa: q('#' + id('levodopa')), dbs: q('#' + id('dbs')), brake: q('#' + id('brake')),
      status: q('#' + id('brake-status')),
      gpiVal: q('#' + id('gpi-val')), gpiBar: q('#' + id('gpi-bar')), gpiSay: q('#' + id('gpi-say')),
      thVal: q('#' + id('th-val')), thBar: q('#' + id('th-bar')), thSay: q('#' + id('th-say')),
      gTitle: q('#' + id('g-title')), gTrack: q('#' + id('g-track')), gLabs: q('#' + id('g-labs')),
      gMark: q('#' + id('g-mark')), gMarkVal: q('#' + id('g-markval')), gSay: q('#' + id('g-say')), gNote: q('#' + id('g-note')),
      live: q('#' + id('live')),
      diagramHost: q('.' + NAME + '-diagram-host'),
      sweepA: q('#' + id('sweep-a')), sweepB: q('#' + id('sweep-b')), sweepLegend: q('#' + id('sweep-legend')),
      pulseHost: q('#' + id('pulse-host')),
      loopCard: q('#' + id('loopcard')),
      model: q('.' + NAME + '-model'),
    };

    buildKey(q('#' + id('key')));
    buildGauge();

    /* ---------- events ---------- */
    function onDopamine() { state.dopamine = Number(ui.dop.value) / 100; stopAnim(); schedule(); }
    function onLdopa() { state.levodopa = ui.ldopa.checked; stopAnim(); schedule(); }
    function onDbs() { state.dbs = ui.dbs.checked; stopAnim(); schedule(); }
    function onLoop(e) {
      if (!e.target || e.target.name !== id('loop')) return;
      state.loop = e.target.value;
      renderLoopCard();
      schedule();
    }
    function onBrake() { startBrake(); }
    function onLinkClick(e) {
      const b = e.target.closest('[data-section]');
      if (b && root.contains(b)) openSection(b.getAttribute('data-section'));
    }
    ui.dop.addEventListener('input', onDopamine);
    ui.ldopa.addEventListener('change', onLdopa);
    ui.dbs.addEventListener('change', onDbs);
    ui.brake.addEventListener('click', onBrake);
    root.addEventListener('change', onLoop);
    root.addEventListener('click', onLinkClick);

    /* ---------- responsive layout ---------- */
    const ro = new ResizeObserver(() => {
      if (layoutRaf) return;
      layoutRaf = requestAnimationFrame(relayout);
    });
    ro.observe(el);

    let widths = { dia: 0, sweep: 0, pulse: 0 };
    function relayout() {
      layoutRaf = 0;
      const w = el.clientWidth || el.getBoundingClientRect().width || 900;
      root.classList.toggle(NAME + '-is-wide', w >= 1100);
      root.classList.toggle(NAME + '-is-ultra', w >= 1400);
      const dia = Math.floor(ui.diagramHost.clientWidth);
      if (dia > 0 && dia !== widths.dia) { widths.dia = dia; diagram = buildDiagram(dia); }
      widths.sweep = Math.floor(ui.sweepA.parentNode.clientWidth);
      widths.pulse = Math.floor(ui.pulseHost.clientWidth);
      render(true);
    }

    function schedule() {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; render(true); });
    }

    /* ---------- diagram ---------- */
    function buildDiagram(W) {
      const svgOld = ui.diagramHost.querySelector('svg');
      if (svgOld) svgOld.remove();
      const L = layoutDiagram(W);
      const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + L.height, width: W, height: L.height, role: 'img', 'aria-labelledby': id('dia-title') + ' ' + id('dia-desc') });
      const title = svgEl('title', { id: id('dia-title') }, svg);
      title.textContent = 'Basal ganglia loop: direct, indirect and hyperdirect pathways';
      const desc = svgEl('desc', { id: id('dia-desc') }, svg);

      // striatum group box with the loop's striatal territory as a tab label
      svgEl('rect', { x: L.group.x, y: L.group.y, width: L.group.w, height: L.group.h, rx: 12, fill: 'none', stroke: 'var(--rule)', 'stroke-width': 1.2, 'stroke-dasharray': '2 3' }, svg);
      const tabG = svgEl('g', {}, svg);
      const tabRect = svgEl('rect', { y: L.group.y - 10, height: 20, rx: 10, fill: 'var(--surface)', stroke: 'var(--rule)' }, tabG);
      const tabText = svgText(tabG, (L.xL + L.xR) / 2, L.group.y + 4.5, '', NAME + '-t-edge', 'middle');
      tabText.style.fontStyle = 'normal';

      // edges
      const edgeLayer = svgEl('g', {}, svg);
      const edges = {};
      for (const e of L.E) {
        const color = e.dop ? 'var(--accent)' : 'var(--fg)';
        const g = svgEl('g', {}, edgeLayer);
        const path = svgEl('path', { fill: 'none', stroke: color, 'stroke-linejoin': 'round', 'stroke-linecap': 'butt' }, g);
        path.style.strokeOpacity = e.dop ? '0.95' : '0.78';
        const cap = e.kind === 'exc'
          ? svgEl('polygon', { fill: color, stroke: 'none' }, g)
          : svgEl('path', { fill: 'none', stroke: color, 'stroke-linecap': 'butt' }, g);
        if (e.kind === 'exc') cap.style.fillOpacity = e.dop ? '0.95' : '0.85'; else cap.style.strokeOpacity = e.dop ? '0.95' : '0.85';
        edges[e.id] = { def: e, path: path, cap: cap, sw: -1 };
      }
      // edge labels
      const lab = L.labels;
      svgText(svg, lab.direct[0], lab.direct[1], 'direct', NAME + '-t-edge', 'end');
      svgText(svg, lab.indirect[0], lab.indirect[1], 'indirect', NAME + '-t-edge', 'start');
      const th = svgText(svg, lab.hyper[0], lab.hyper[1], 'hyperdirect', NAME + '-t-edge', 'middle');
      th.setAttribute('transform', 'rotate(90 ' + r1(lab.hyper[0]) + ' ' + r1(lab.hyper[1]) + ')');
      const tr = svgText(svg, lab.ret[0], lab.ret[1], 'thalamus to cortex', NAME + '-t-edge', 'middle');
      tr.setAttribute('transform', 'rotate(-90 ' + r1(lab.ret[0]) + ' ' + r1(lab.ret[1]) + ')');

      // nodes
      const nodes = {};
      const names = { D1: 'Striatum D1', D2: 'Striatum D2', E: 'GPe', S: 'STN', G: 'GPi/SNr', T: 'Thalamus' };
      for (const k of ['D1', 'D2', 'E', 'S', 'G', 'T']) {
        const n = L.N[k];
        const g = svgEl('g', {}, svg);
        const rect = svgEl('rect', { x: r1(n.l), y: r1(n.t), width: n.w, height: n.h, rx: 9, stroke: 'var(--axis)', 'stroke-width': 1 }, g);
        svgText(g, n.cx, n.cy - 4, names[k], NAME + '-t-node ' + NAME + '-t-halo', 'middle');
        const val = svgText(g, n.cx, n.cy + 14, '100%', NAME + '-t-val ' + NAME + '-t-halo', 'middle');
        nodes[k] = { rect: rect, val: val };
      }
      // cortex
      {
        const n = L.N.C;
        const g = svgEl('g', {}, svg);
        const rect = svgEl('rect', { x: r1(n.l), y: r1(n.t), width: r1(n.w), height: n.h, rx: 11, stroke: 'var(--axis)', 'stroke-width': 1 }, g);
        const t1 = svgText(g, n.cx, n.cy - 5, '', NAME + '-t-node ' + NAME + '-t-halo', 'middle');
        const tsC = svgEl('tspan', {}, t1); tsC.textContent = 'Cortex';
        const tsV = svgEl('tspan', { class: NAME + '-t-val', dx: 8 }, t1);
        const area = svgText(g, n.cx, n.cy + 14, '', NAME + '-t-area ' + NAME + '-t-halo', 'middle');
        nodes.C = { rect: rect, val: tsV, area: area };
      }
      // SNc (dopamine source)
      {
        const n = L.N.SNc;
        const g = svgEl('g', {}, svg);
        const rect = svgEl('rect', { x: r1(n.l), y: r1(n.t), width: n.w, height: n.h, rx: 9, stroke: 'var(--accent)', 'stroke-width': 1.2 }, g);
        svgText(g, n.cx, n.cy - 4, 'SNc', NAME + '-t-node ' + NAME + '-t-halo', 'middle');
        const val = svgText(g, n.cx, n.cy + 14, '', NAME + '-t-val ' + NAME + '-t-halo', 'middle');
        nodes.SNc = { rect: rect, val: val };
        // levodopa badge
        const lg = svgEl('g', {}, svg);
        const bw = 112;
        svgEl('rect', { x: r1(n.cx - bw / 2), y: r1(n.b + 10), width: bw, height: 22, rx: 11, fill: 'var(--surface)', stroke: 'var(--accent)', 'stroke-width': 1.2, 'stroke-dasharray': '3 2' }, lg);
        const lt = svgText(lg, n.cx, n.b + 25.5, '', NAME + '-t-dop', 'middle');
        nodes.ldopa = { g: lg, text: lt };
      }
      // DBS electrode glyph on STN
      {
        const n = L.N.S;
        const g = svgEl('g', {}, svg);
        const x0 = n.r - 10, y0 = n.t - 52, x1 = n.r - 30, y1 = n.t + 12;
        svgEl('line', { x1: r1(x0), y1: r1(y0), x2: r1(x1), y2: r1(y1), stroke: 'var(--warn)', 'stroke-width': 4, 'stroke-linecap': 'round' }, g);
        for (let i = 0; i < 3; i++) {
          const f = 0.62 + i * 0.13;
          const cx = x0 + (x1 - x0) * f, cy = y0 + (y1 - y0) * f;
          svgEl('circle', { cx: r1(cx), cy: r1(cy), r: 3.6, fill: 'var(--surface)', stroke: 'var(--warn)', 'stroke-width': 1.6 }, g);
        }
        svgText(g, x0 + 6, y0 + 4, 'DBS', NAME + '-t-dbs', 'start');
        nodes.dbs = { g: g };
      }
      ui.diagramHost.appendChild(svg);
      return { svg: svg, L: L, edges: edges, nodes: nodes, tabRect: tabRect, tabText: tabText, desc: desc };
    }

    function setEdge(e, sw) {
      if (Math.abs(e.sw - sw) < 0.02) return;
      e.sw = sw;
      const geo = edgeGeometry(e.def.pts, e.def.kind, sw);
      e.path.setAttribute('d', geo.d);
      e.path.style.strokeWidth = sw.toFixed(2) + 'px';
      if (e.def.kind === 'inh') {
        e.path.style.strokeDasharray = (5 + sw).toFixed(1) + ' ' + (3.5 + 0.6 * sw).toFixed(1);
        e.cap.setAttribute('d', geo.cap);
        e.cap.style.strokeWidth = geo.barW.toFixed(2) + 'px';
      } else {
        e.cap.setAttribute('points', geo.cap);
      }
    }

    function edgeWidth(ratio) { return clamp(2.4 * ratio, 0.9, 9.5); }

    function paintDiagram(r, o) {
      if (!diagram) return;
      const nd = diagram.nodes, ed = diagram.edges;
      const loop = LOOPS.find((l) => l.id === state.loop) || LOOPS[0];
      const P = r.P || 0;
      for (const k of ['D1', 'D2', 'E', 'S', 'G', 'T']) {
        nd[k].rect.style.fill = mixFg(clamp(4 + 20 * r[k], 3, 52));
        nd[k].val.textContent = pct(r[k]) + arrowFor(r[k]);
      }
      nd.C.rect.style.fill = mixFg(clamp(4 + 20 * r.C, 3, 52));
      nd.C.val.textContent = pct(r.C) + arrowFor(r.C);
      nd.C.area.textContent = loop.cortex;
      nd.SNc.rect.style.fill = mixAccent(clamp(6 + 40 * o.dopamine, 4, 50));
      nd.SNc.val.textContent = 'dopamine ' + pct(o.dopamine);
      nd.ldopa.g.style.display = o.levodopa ? '' : 'none';
      nd.ldopa.text.textContent = '+ levodopa: ' + pct(r.da);
      nd.dbs.g.style.display = o.dbs ? '' : 'none';
      // striatal territory tab
      if (diagram.tabText.textContent !== loop.target) {
        diagram.tabText.textContent = loop.target;
        let tw = loop.target.length * 6.6;
        try { tw = diagram.tabText.getComputedTextLength(); } catch (err) { /* not rendered yet */ }
        const cx = (diagram.L.xL + diagram.L.xR) / 2;
        diagram.tabRect.setAttribute('x', r1(cx - tw / 2 - 10));
        diagram.tabRect.setAttribute('width', r1(tw + 20));
      }
      setEdge(ed.c_d1, edgeWidth(r.C));
      setEdge(ed.c_d2, edgeWidth(r.C));
      setEdge(ed.c_stn, edgeWidth((PARAMS.wCSTN * r.C + P) / PARAMS.wCSTN));
      setEdge(ed.d1_g, edgeWidth(r.D1));
      setEdge(ed.d2_e, edgeWidth(r.D2));
      setEdge(ed.e_s, edgeWidth(r.E));
      setEdge(ed.s_g, edgeWidth(r.Sout));
      setEdge(ed.g_t, edgeWidth(r.G));
      setEdge(ed.t_c, edgeWidth(r.T));
      setEdge(ed.snc_d1, edgeWidth(r.da));
      setEdge(ed.snc_d2, edgeWidth(r.da));
      diagram.desc.textContent = 'Dopamine ' + pct(o.dopamine) + (o.levodopa ? ' with levodopa' : '') + (o.dbs ? ', STN stimulation on' : '') +
        '. Activity relative to health: cortex ' + pct(r.C) + ', striatal D1 neurons ' + pct(r.D1) + ', D2 neurons ' + pct(r.D2) +
        ', GPe ' + pct(r.E) + ', STN ' + pct(r.S) + ', GPi/SNr ' + pct(r.G) + ', thalamus ' + pct(r.T) + '.';
    }

    /* ---------- key ---------- */
    function buildKey(host) {
      const item = (draw, text) => {
        const s = document.createElement('span');
        const svg = svgEl('svg', { width: 34, height: 14, viewBox: '0 0 34 14', 'aria-hidden': 'true' }, s);
        draw(svg);
        s.appendChild(document.createTextNode(text));
        host.appendChild(s);
      };
      item((svg) => {
        svgEl('path', { d: 'M2,7L24,7', stroke: 'var(--fg)', 'stroke-width': 2.4, 'stroke-opacity': 0.8 }, svg);
        svgEl('polygon', { points: '32,7 22,1.5 22,12.5', fill: 'var(--fg)', 'fill-opacity': 0.85 }, svg);
      }, 'Solid arrow: excites');
      item((svg) => {
        svgEl('path', { d: 'M2,7L29,7', stroke: 'var(--fg)', 'stroke-width': 2.4, 'stroke-dasharray': '7.4 4.9', 'stroke-opacity': 0.8 }, svg);
        svgEl('path', { d: 'M31,0L31,14', stroke: 'var(--fg)', 'stroke-width': 2.8 }, svg);
      }, 'Dashed line, flat bar: inhibits');
      item((svg) => {
        svgEl('path', { d: 'M2,7L24,7', stroke: 'var(--accent)', 'stroke-width': 2.4 }, svg);
        svgEl('polygon', { points: '32,7 22,1.5 22,12.5', fill: 'var(--accent)' }, svg);
      }, 'Blue: dopamine from SNc, exciting D1 and inhibiting D2 neurons');
      item((svg) => {
        [10, 24, 44].forEach((p, i) => svgEl('rect', { x: 1 + i * 11, y: 1, width: 10, height: 12, rx: 2, stroke: 'var(--axis)', 'stroke-width': 1, style: 'fill:' + mixFg(p) }, svg));
      }, 'Fill: less, normal, more activity than in health');
    }

    /* ---------- gauge ---------- */
    function gaugePos(v) { return clamp((v - G_MIN) / (G_MAX - G_MIN), 0, 1) * 100; }
    function buildGauge() {
      clear(ui.gTrack); clear(ui.gLabs);
      for (const b of BANDS) {
        const lo = Math.max(b.lo, G_MIN), hi = Math.min(b.hi, G_MAX);
        const w = ((hi - lo) / (G_MAX - G_MIN)) * 100;
        const seg = document.createElement('i');
        seg.className = NAME + '-gseg';
        seg.style.width = w + '%';
        seg.style.background = 'color-mix(in oklab, var(--' + b.tone + ') 55%, var(--surface))';
        seg.dataset.key = b.key;
        ui.gTrack.appendChild(seg);
        const lab = document.createElement('span');
        lab.style.width = w + '%';
        lab.dataset.key = b.key;
        ui.gLabs.appendChild(lab);
      }
    }
    function paintGauge(v, loop) {
      const band = vigourBand(v);
      const motor = loop.id === 'motor';
      ui.gTitle.textContent = motor ? 'Movement vigour' : 'Loop output, ' + loop.name.toLowerCase() + ' loop';
      ui.gMark.style.left = gaugePos(v).toFixed(2) + '%';
      ui.gMarkVal.textContent = pct(v);
      for (const seg of ui.gTrack.children) seg.classList.toggle(NAME + '-on', seg.dataset.key === band.key);
      for (const lab of ui.gLabs.children) {
        const b = BANDS.find((x) => x.key === lab.dataset.key);
        lab.textContent = motor ? b.motor : b.generic;
        lab.classList.toggle(NAME + '-on', b.key === band.key);
      }
      ui.gSay.textContent = motor ? band.say : band.generic + ' drive to ' + loop.cortex.toLowerCase();
      ui.gSay.className = NAME + '-gsay ' + NAME + '-tone-' + band.tone;
      ui.gNote.textContent = motor
        ? 'Plain-language bands on thalamocortical drive (illustrative cut-offs, not clinical scores).'
        : 'Same circuit logic, different content: for this loop, read the gauge as the drive behind ' + loop.output + ', not movement.';
      return band;
    }

    /* ---------- meters ---------- */
    function paintMeters(r) {
      ui.gpiVal.textContent = pct(r.G);
      ui.gpiBar.style.width = clamp(r.G / 2, 0, 1) * 100 + '%';
      ui.gpiSay.textContent = r.G > 1.02 ? 'Up ' + pct(r.G - 1) + ' on health: GPi/SNr holds the thalamus down harder.'
        : r.G < 0.98 ? 'Down ' + pct(1 - r.G) + ' on health: GPi/SNr releases the thalamus.' : 'At its healthy level.';
      ui.thVal.textContent = pct(r.T);
      ui.thBar.style.width = clamp(r.T / 2, 0, 1) * 100 + '%';
      ui.thSay.textContent = r.T < 0.98 ? 'Down ' + pct(1 - r.T) + ' on health: weaker drive back to cortex.'
        : r.T > 1.02 ? 'Up ' + pct(r.T - 1) + ' on health: stronger drive back to cortex.' : 'At its healthy level.';
    }

    /* ---------- charts ---------- */
    function sweepFor(levodopa, dbs) {
      const key = (levodopa ? 'L' : '') + (dbs ? 'D' : '');
      if (sweepCache.has(key)) return sweepCache.get(key);
      const pts = [];
      for (let i = 0; i <= 45; i++) {
        const d = 0.1 + i * 0.02;
        pts.push({ d: d, r: steadyState({ dopamine: d, levodopa: levodopa, dbs: dbs }) });
      }
      sweepCache.set(key, pts);
      return pts;
    }

    function axisChart(svg, w, h, m, xd, yd) {
      clear(svg);
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      svg.setAttribute('width', w);
      svg.setAttribute('height', h);
      const sx = (v) => m.l + ((v - xd[0]) / (xd[1] - xd[0])) * (w - m.l - m.r);
      const sy = (v) => h - m.b - ((v - yd[0]) / (yd[1] - yd[0])) * (h - m.t - m.b);
      return { sx: sx, sy: sy };
    }

    function drawSweepChart(svg, w, key, title, cur, o) {
      const h = 178, m = { l: 42, r: 10, t: 26, b: 38 };
      const { sx, sy } = axisChart(svg, w, h, m, [0.1, 1], [0.4, 1.6]);
      svgText(svg, 0, 14, title, NAME + '-t-title', 'start');
      for (const yv of [0.5, 1, 1.5]) {
        svgEl('line', { x1: m.l, x2: w - m.r, y1: r1(sy(yv)), y2: r1(sy(yv)), stroke: yv === 1 ? 'var(--muted)' : 'var(--grid)', 'stroke-width': 1, 'stroke-dasharray': yv === 1 ? '1.5 3' : '' }, svg);
        svgText(svg, m.l - 6, sy(yv) + 4, pct(yv), NAME + '-t-tick', 'end');
      }
      svgEl('line', { x1: m.l, x2: w - m.r, y1: h - m.b, y2: h - m.b, stroke: 'var(--axis)' }, svg);
      const roomy = w - m.l - m.r >= 300;
      for (const xv of [0.1, 0.25, 0.5, 0.75, 1]) {
        svgEl('line', { x1: r1(sx(xv)), x2: r1(sx(xv)), y1: h - m.b, y2: h - m.b + 4, stroke: 'var(--axis)' }, svg);
        if (roomy || xv === 0.1 || xv === 0.5 || xv === 1) svgText(svg, sx(xv), h - m.b + 17, pct(xv), NAME + '-t-tick', 'middle');
      }
      svgText(svg, (m.l + w - m.r) / 2, h - 3, 'Dopamine (% of healthy)', NAME + '-t-tick', 'middle');
      const treated = o.levodopa || o.dbs;
      const base = sweepFor(false, false);
      const line = (pts, dash, color, sw) => svgEl('path', { d: pathFrom(pts.map((p) => [sx(p.d), sy(clamp(p.r[key], 0.4, 1.6))])), fill: 'none', stroke: color, 'stroke-width': sw, 'stroke-dasharray': dash, 'stroke-linejoin': 'round' }, svg);
      if (treated) {
        line(base, '6 4', 'var(--axis)', 1.8);
        line(sweepFor(o.levodopa, o.dbs), '', 'var(--fg)', 2.2);
      } else {
        line(base, '', 'var(--fg)', 2.2);
      }
      const xv = sx(o.dopamine), yv = sy(clamp(cur[key], 0.4, 1.6));
      svgEl('line', { x1: r1(xv), x2: r1(xv), y1: m.t, y2: h - m.b, stroke: 'var(--accent)', 'stroke-width': 1, 'stroke-opacity': 0.55 }, svg);
      svgEl('circle', { cx: r1(xv), cy: r1(yv), r: 5, fill: 'var(--fg)', stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
      const lx = xv > (m.l + w - m.r) / 2 ? xv - 9 : xv + 9;
      svgText(svg, lx, yv - 9, pct(cur[key]), NAME + '-t-title', xv > (m.l + w - m.r) / 2 ? 'end' : 'start');
    }

    function drawSweeps(cur, o) {
      const hostW = Math.max(240, widths.sweep || ui.sweepA.parentNode.clientWidth || 480);
      const two = hostW >= 470;
      const cw = two ? Math.floor((hostW - 14) / 2) : hostW;
      drawSweepChart(ui.sweepA, cw, 'G', 'GPi/SNr output', cur, o);
      drawSweepChart(ui.sweepB, cw, 'T', 'Thalamocortical drive', cur, o);
      const tname = o.levodopa && o.dbs ? 'levodopa and STN stimulation' : o.levodopa ? 'levodopa' : o.dbs ? 'STN stimulation' : '';
      ui.sweepLegend.innerHTML = '';
      const add = (dash, color, text) => {
        const s = document.createElement('span');
        const svg = svgEl('svg', { width: 26, height: 10, 'aria-hidden': 'true' }, s);
        svgEl('path', { d: 'M1,5L25,5', stroke: color, 'stroke-width': dash === '1.5 3' ? 1.2 : 2.2, 'stroke-dasharray': dash }, svg);
        s.appendChild(document.createTextNode(text));
        ui.sweepLegend.appendChild(s);
      };
      if (tname) { add('', 'var(--fg)', 'With ' + tname); add('6 4', 'var(--axis)', 'No treatment'); } else add('', 'var(--fg)', 'No treatment');
      add('1.5 3', 'var(--muted)', 'Healthy level (100%)');
      const s = document.createElement('span');
      const svg = svgEl('svg', { width: 12, height: 12, 'aria-hidden': 'true' }, s);
      svgEl('circle', { cx: 6, cy: 6, r: 4.5, fill: 'var(--fg)' }, svg);
      s.appendChild(document.createTextNode('Your slider setting'));
      ui.sweepLegend.appendChild(s);
    }

    const PULSE_PANELS = [
      { key: 'S', title: 'STN', y: [0, 3], ticks: [1, 2] },
      { key: 'G', title: 'GPi/SNr', y: [0, 2], ticks: [1, 1.5] },
      { key: 'T', title: 'Thalamus', y: [0, 1.5], ticks: [0.5, 1] },
    ];
    function drawPulse(o) {
      const sim = simulatePulse(o);
      const host = ui.pulseHost;
      clear(host);
      const w = Math.max(260, widths.pulse || host.clientWidth || 400);
      const hdr = 18, ph = 62, gap = 10, m = { l: 46, r: 14 }, axisH = 38;
      const h = PULSE_PANELS.length * (hdr + ph + gap) - gap + axisH;
      const svg = svgEl('svg', { viewBox: '0 0 ' + w + ' ' + h, width: w, height: h, role: 'img', 'aria-label': 'Response of STN, GPi/SNr and thalamus to a brief hyperdirect pulse, simulated' }, host);
      const xd = [0, PARAMS.tEnd];
      const sx = (v) => m.l + ((v - xd[0]) / (xd[1] - xd[0])) * (w - m.l - m.r);
      const cursors = [];
      PULSE_PANELS.forEach((pn, i) => {
        const top = i * (hdr + ph + gap);
        const y0 = top + hdr, y1 = y0 + ph;
        const sy = (v) => y1 - ((clamp(v, pn.y[0], pn.y[1]) - pn.y[0]) / (pn.y[1] - pn.y[0])) * ph;
        svgText(svg, 0, top + 13, pn.title, NAME + '-t-title', 'start');
        svgEl('rect', { x: r1(sx(sim.on)), y: y0, width: r1(sx(sim.off) - sx(sim.on)), height: ph, fill: 'var(--tint)', stroke: 'var(--rule)' }, svg);
        svgEl('rect', { x: m.l, y: y0, width: w - m.l - m.r, height: ph, fill: 'none', stroke: 'var(--grid)' }, svg);
        for (const tv of pn.ticks) {
          svgEl('line', { x1: m.l, x2: w - m.r, y1: r1(sy(tv)), y2: r1(sy(tv)), stroke: tv === 1 ? 'var(--muted)' : 'var(--grid)', 'stroke-dasharray': tv === 1 ? '1.5 3' : '' }, svg);
          svgText(svg, m.l - 6, sy(tv) + 4, pct(tv), NAME + '-t-tick', 'end');
        }
        const pts = sim.states.map((st, j) => [sx(sim.t[j]), sy(st[pn.key])]);
        svgEl('path', { d: pathFrom(pts.filter((_, j) => j % 2 === 0 || j === pts.length - 1)), fill: 'none', stroke: 'var(--fg)', 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);
        // extreme point: peak for STN and GPi/SNr, trough for thalamus
        let best = 0;
        for (let j = 1; j < sim.states.length; j++) {
          const v = sim.states[j][pn.key], bv = sim.states[best][pn.key];
          if (pn.key === 'T' ? v < bv : v > bv) best = j;
        }
        const bx = sx(sim.t[best]), by = sy(sim.states[best][pn.key]);
        svgEl('circle', { cx: r1(bx), cy: r1(by), r: 3.5, fill: 'var(--fg)' }, svg);
        // peaks: label up and to the right (the line falls away); troughs: down and to the right
        const ly = pn.key === 'T' ? Math.min(by + 15, y1 - 2) : Math.max(by - 6, y0 - 3);
        svgText(svg, bx + 6, ly, pct(sim.states[best][pn.key]), NAME + '-t-tick', 'start');
        const cur = svgEl('line', { x1: m.l, x2: m.l, y1: y0, y2: y1, stroke: 'var(--accent)', 'stroke-width': 1.5 }, svg);
        cur.style.display = 'none';
        cursors.push(cur);
      });
      const yAx = PULSE_PANELS.length * (hdr + ph + gap) - gap + 2;
      for (const tv of [0, 3, 6, 9, 12, 15]) {
        svgEl('line', { x1: r1(sx(tv)), x2: r1(sx(tv)), y1: yAx, y2: yAx + 4, stroke: 'var(--axis)' }, svg);
        svgText(svg, sx(tv), yAx + 17, String(tv), NAME + '-t-tick', 'middle');
      }
      svgText(svg, (m.l + w - m.r) / 2, h - 2, 'Model time (in time constants)', NAME + '-t-tick', 'middle');
      pulseRefs = { sim: sim, cursors: cursors, sx: sx };
      return sim;
    }

    /* ---------- loop card ---------- */
    function renderLoopCard() {
      const l = LOOPS.find((x) => x.id === state.loop) || LOOPS[0];
      const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      ui.loopCard.innerHTML =
        '<h3>' + esc(l.name) + ' loop</h3>' +
        '<dl class="' + NAME + '-dl">' +
        '<dt>Cortex</dt><dd class="' + NAME + '-ui">' + esc(l.cortex) + '</dd>' +
        '<dt>Striatal target</dt><dd class="' + NAME + '-ui">' + esc(l.target) + '</dd>' +
        '<dt>Function</dt><dd class="' + NAME + '-ui">' + esc(l.fn) + '</dd>' +
        '<dt>In the worked example</dt><dd>' + esc(l.measure) + (l.extra ? ' ' + esc(l.extra) : '') + '</dd>' +
        '<dt>Dopamine loss in PD</dt><dd>' + esc(l.loss) + '</dd>' +
        '</dl>' +
        '<div class="' + NAME + '-links">' +
        '<button type="button" class="' + NAME + '-link" data-section="33-the-basal-ganglia-circuits">Basal ganglia circuits, guide 3.3</button>' +
        '<button type="button" class="' + NAME + '-link" data-section="' + l.link[0] + '">' + esc(l.link[1]) + '</button>' +
        '</div>' +
        '<p class="' + NAME + '-hint">The circuit and the model are the same for every loop (Alexander, DeLong &amp; Strick 1986); only the cortical area and striatal territory change.</p>';
    }

    /* ---------- render ---------- */
    function currentOpts() { return { dopamine: state.dopamine, levodopa: state.levodopa, dbs: state.dbs }; }

    function render(full) {
      const o = currentOpts();
      const ss = steadyState(o);
      const loop = LOOPS.find((l) => l.id === state.loop) || LOOPS[0];
      ui.dopOut.textContent = pct(o.dopamine);
      if (!anim) {
        paintDiagram(ss, o);
        paintMeters(ss);
        const band = paintGauge(ss.T, loop);
        if (band.key !== lastBandKey) {
          lastBandKey = band.key;
          ui.live.textContent = (loop.id === 'motor' ? 'Movement vigour: ' + band.say : 'Loop output: ' + band.generic) + '. GPi/SNr ' + pct(ss.G) + ', thalamus ' + pct(ss.T) + '.';
        }
      }
      if (full) {
        drawSweeps(ss, o);
        drawPulse(o);
      }
      // the brake summary describes the settings it was run with; clear it once they change
      if (brakeSig && !anim && brakeSig !== JSON.stringify(o)) { brakeSig = ''; ui.status.textContent = ''; }
    }

    /* ---------- hyperdirect brake ---------- */
    function brakeSummary(sim) {
      let gMax = 0, tMin = 9, sMax = 0;
      for (const s of sim.states) { if (s.G > gMax) gMax = s.G; if (s.T < tMin) tMin = s.T; if (s.S > sMax) sMax = s.S; }
      return 'Brake: STN peaked at ' + pct(sMax) + ', GPi/SNr rose from ' + pct(sim.base.G) + ' to ' + pct(gMax) +
        ', thalamus fell from ' + pct(sim.base.T) + ' to ' + pct(tMin) + ', then all recovered.' +
        (state.dbs ? ' With DBS on, STN output is mostly blocked, so the brake is weak.' : '');
    }
    function startBrake() {
      stopAnim();
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      render(true); // bring everything up to date with the controls before the pulse starts
      const sim = pulseRefs.sim;
      brakeSig = JSON.stringify(currentOpts());
      const summary = brakeSummary(sim);
      if (reduceMotion()) {
        ui.status.textContent = summary + ' (Animation skipped: reduced motion is on.)';
        return;
      }
      ui.status.textContent = summary;
      const total = 3000;
      const t0 = performance.now();
      const o = currentOpts();
      const loop = LOOPS.find((l) => l.id === state.loop) || LOOPS[0];
      anim = { id: 0 };
      const step = (now) => {
        if (!anim) return;
        const f = clamp((now - t0) / total, 0, 1);
        const i = Math.min(sim.states.length - 1, Math.round(f * (sim.states.length - 1)));
        const s = sim.states[i];
        paintDiagram(s, o);
        paintMeters(s);
        paintGauge(s.T, loop);
        if (pulseRefs) {
          const x = r1(pulseRefs.sx(sim.t[i]));
          for (const c of pulseRefs.cursors) { c.style.display = ''; c.setAttribute('x1', x); c.setAttribute('x2', x); }
        }
        if (f < 1) anim.id = requestAnimationFrame(step);
        else { anim = null; hideCursors(); render(false); }
      };
      anim.id = requestAnimationFrame(step);
    }
    function hideCursors() { if (pulseRefs) for (const c of pulseRefs.cursors) c.style.display = 'none'; }
    function stopAnim() {
      if (anim) { cancelAnimationFrame(anim.id); anim = null; hideCursors(); }
    }

    /* ---------- first paint ---------- */
    renderLoopCard();
    relayout();

    return {
      destroy() {
        stopAnim();
        if (raf) cancelAnimationFrame(raf);
        if (layoutRaf) cancelAnimationFrame(layoutRaf);
        ro.disconnect();
        ui.dop.removeEventListener('input', onDopamine);
        ui.ldopa.removeEventListener('change', onLdopa);
        ui.dbs.removeEventListener('change', onDbs);
        ui.brake.removeEventListener('click', onBrake);
        root.removeEventListener('change', onLoop);
        root.removeEventListener('click', onLinkClick);
        if (root.parentNode) root.parentNode.removeChild(root);
        liveInstances = Math.max(0, liveInstances - 1);
        if (!liveInstances) { const s = document.getElementById('style-' + NAME); if (s) s.remove(); }
      },
    };
  }

  /* ==================================================================
   * 7. Static markup (no user data is ever interpolated)
   * ================================================================== */
  function template(id) {
    const radios = LOOPS.map((l, i) =>
      '<input type="radio" class="' + NAME + '-segin" name="' + id('loop') + '" id="' + id('loop-' + l.id) + '" value="' + l.id + '"' + (i === 0 ? ' checked' : '') + '>' +
      '<label class="' + NAME + '-seglab" for="' + id('loop-' + l.id) + '">' + l.name + '</label>').join('');
    const n = NAME;
    return '' +
'<div class="' + n + '-layout">' +
  '<div class="' + n + '-col">' +
    '<section class="' + n + '-card ' + n + '-loops">' +
      '<div class="' + n + '-label" id="' + id('loop-label') + '">Parallel loop (Alexander, DeLong &amp; Strick 1986)</div>' +
      '<div class="' + n + '-seg" role="radiogroup" aria-labelledby="' + id('loop-label') + '">' + radios + '</div>' +
    '</section>' +
    '<figure class="' + n + '-card ' + n + '-figure">' +
      '<p class="' + n + '-howto"><b>How to read this:</b> each box is a nucleus. Stronger fill means it fires more than in health (100%), paler means less; thicker lines carry more signal.</p>' +
      '<div class="' + n + '-diagram-host"></div>' +
      '<div class="' + n + '-key" id="' + id('key') + '"></div>' +
      '<p class="' + n + '-sim">Simulated data for illustration, not PPMI data. A cartoon of the classic rate model (Albin et al. 1989; DeLong 1990; Nambu et al. 2002).</p>' +
    '</figure>' +
    '<section class="' + n + '-card ' + n + '-loopcard" id="' + id('loopcard') + '" aria-live="polite"></section>' +
  '</div>' +
  '<div class="' + n + '-colr">' +
  '<div class="' + n + '-col">' +
    '<section class="' + n + '-card ' + n + '-controls" aria-label="Controls">' +
      '<div class="' + n + '-ctrl">' +
        '<div class="' + n + '-ctrl-head"><label for="' + id('dopamine') + '">Striatal dopamine signal</label><output id="' + id('dopamine-out') + '" for="' + id('dopamine') + '">100%</output></div>' +
        '<input class="' + n + '-range" type="range" id="' + id('dopamine') + '" min="10" max="100" step="1" value="100">' +
        '<div class="' + n + '-scale"><span>10%</span><span>100% = healthy</span></div>' +
        '<p class="' + n + '-hint">Drag left to remove dopamine. This is the signal at the receptors, not a count of surviving terminals.</p>' +
      '</div>' +
      '<div class="' + n + '-check"><input type="checkbox" id="' + id('levodopa') + '"><div><label for="' + id('levodopa') + '">Levodopa</label>' +
        '<p class="' + n + '-hint">Partial restoration: in this cartoon it gives back 60% of the missing dopamine signal.</p></div></div>' +
      '<div class="' + n + '-check"><input type="checkbox" id="' + id('dbs') + '"><div><label for="' + id('dbs') + '">STN deep brain stimulation</label>' +
        '<p class="' + n + '-hint">In this cartoon DBS simply blocks 70% of STN output. Real DBS is not an off switch: it works partly by disrupting abnormal beta-band (13 to 30 Hz) synchrony in these loops (guide 3.3).</p></div></div>' +
      '<div class="' + n + '-btnrow"><button type="button" class="' + n + '-btn" id="' + id('brake') + '">Hyperdirect brake</button>' +
        '<span class="' + n + '-hint">A brief cortical pulse onto STN: the fast brake (Nambu et al. 2002).</span></div>' +
      '<p class="' + n + '-status" id="' + id('brake-status') + '" aria-live="polite"></p>' +
    '</section>' +
    '<section class="' + n + '-card ' + n + '-readouts" aria-label="Readouts">' +
      '<div class="' + n + '-readgrid">' +
        '<div>' +
          '<div class="' + n + '-meter"><div class="' + n + '-mhead"><span class="' + n + '-mname">GPi/SNr output</span><span class="' + n + '-mval" id="' + id('gpi-val') + '">100%</span></div>' +
            '<div class="' + n + '-bar"><i id="' + id('gpi-bar') + '"></i><b></b></div>' +
            '<div class="' + n + '-bscale"><span>0</span><span class="basalganglia-mid">healthy</span><span>200%</span></div>' +
            '<p class="' + n + '-msay" id="' + id('gpi-say') + '"></p></div>' +
          '<div class="' + n + '-meter"><div class="' + n + '-mhead"><span class="' + n + '-mname">Thalamocortical drive</span><span class="' + n + '-mval" id="' + id('th-val') + '">100%</span></div>' +
            '<div class="' + n + '-bar"><i id="' + id('th-bar') + '"></i><b></b></div>' +
            '<div class="' + n + '-bscale"><span>0</span><span class="basalganglia-mid">healthy</span><span>200%</span></div>' +
            '<p class="' + n + '-msay" id="' + id('th-say') + '"></p></div>' +
        '</div>' +
        '<div class="' + n + '-gauge">' +
          '<div class="' + n + '-mname" id="' + id('g-title') + '">Movement vigour</div>' +
          '<div class="' + n + '-gwrap"><div class="' + n + '-gmark" id="' + id('g-mark') + '"><span id="' + id('g-markval') + '">100%</span><i></i></div>' +
            '<div class="' + n + '-gtrack" id="' + id('g-track') + '"></div></div>' +
          '<div class="' + n + '-glabs" id="' + id('g-labs') + '"></div>' +
          '<p class="' + n + '-gsay" id="' + id('g-say') + '"></p>' +
          '<p class="' + n + '-hint" id="' + id('g-note') + '"></p>' +
        '</div>' +
      '</div>' +
      '<p class="' + n + '-sr" id="' + id('live') + '" aria-live="polite"></p>' +
    '</section>' +
  '</div>' +
  '<div class="' + n + '-col">' +
    '<section class="' + n + '-card ' + n + '-sweep" aria-label="Dopamine sweep">' +
      '<p class="' + n + '-howto"><b>How to read this:</b> each curve sweeps dopamine from 10% to 100% under the current treatment; the dot is your slider. As dopamine falls, GPi/SNr rises and thalamic drive falls.</p>' +
      '<div class="' + n + '-charts"><div class="' + n + '-chart"><svg id="' + id('sweep-a') + '" role="img" aria-label="GPi/SNr output against dopamine, simulated"></svg></div>' +
        '<div class="' + n + '-chart"><svg id="' + id('sweep-b') + '" role="img" aria-label="Thalamocortical drive against dopamine, simulated"></svg></div></div>' +
      '<div class="' + n + '-legend" id="' + id('sweep-legend') + '"></div>' +
      '<p class="' + n + '-sim">Simulated data for illustration, not PPMI data</p>' +
    '</section>' +
    '<section class="' + n + '-card ' + n + '-pulse" aria-label="Hyperdirect brake time course">' +
      '<p class="' + n + '-howto"><b>How to read this:</b> what a brief cortical pulse onto STN (shaded) does at the current settings. Dots mark the peak or trough; press Hyperdirect brake to play it on the circuit.</p>' +
      '<div class="' + n + '-pulsehost" id="' + id('pulse-host') + '"></div>' +
      '<p class="' + n + '-sim">Simulated data for illustration, not PPMI data</p>' +
    '</section>' +
  '</div>' +
  '</div>' +
'</div>' +
'<details class="' + n + '-card ' + n + '-model">' +
  '<summary>Model: equations, parameters and limits (a cartoon)</summary>' +
  '<p>Each nucleus is one number, its mean firing rate, scaled so that its healthy steady state is 1 (shown as 100%). Real rates differ a lot between nuclei: striatal projection neurons are nearly silent at rest, while GPi neurons fire fast and tonically. Each unit is linear-threshold: its rate is its summed input, or zero if that sum is negative, written [x]+ = max(0, x). The diagram and readouts show the steady state of &tau; dr/dt = &minus;r + [input]+ (every &tau; = 1); the brake chart runs the same equations through time.</p>' +
  '<pre>' +
'&delta;    = d + 0.6 &middot; L &middot; (1 &minus; d)          dopamine signal; d = slider, L = levodopa (0 or 1)\n' +
'Ctx  = [0.75 + 0.25 &middot; Thal]+\n' +
'D1   = [1.5 &middot; (1 + 0.5 &middot; (&delta; &minus; 1)) &middot; Ctx &minus; 0.5]+   dopamine raises D1 gain\n' +
'D2   = [1.5 &middot; (1 + 0.5 &middot; (1 &minus; &delta;)) &middot; Ctx &minus; 0.5]+   dopamine lowers D2 gain\n' +
'GPe  = [1.6 &minus; 0.6 &middot; D2]+\n' +
'STN  = [2.1 + 0.4 &middot; Ctx + P(t) &minus; 1.5 &middot; GPe]+\n' +
'GPi  = [1.0 + 0.4 &middot; (1 &minus; 0.7 &middot; DBS) &middot; STN &minus; 0.4 &middot; D1]+   (GPi stands for GPi/SNr)\n' +
'Thal = [2.0 &minus; 1.0 &middot; GPi]+' +
  '</pre>' +
  '<p>P(t) is the hyperdirect pulse: 1.6 from t = 1 to 2.5, otherwise 0. DBS is 0 or 1. The constants make every rate exactly 1 when &delta; = 1 and nothing is switched on. All weights are illustrative, picked so that 10% dopamine gives roughly the pattern of the classic model (DeLong 1990): GPe down about a quarter, STN and GPi/SNr up by a third to a half, thalamus down by almost half. Readouts: GPi/SNr output is GPi; thalamocortical drive is Thal; the vigour bands (below 50%, 50 to 75%, 75 to 92%, 92 to 115%, above 115%) are illustrative labels on Thal, not clinical scores.</p>' +
  '<p>What the cartoon leaves out: STN to GPe and GPe to GPi connections, striatal interneurons, thalamostriatal input, spike timing and beta-band oscillations, synaptic plasticity, the compensation that keeps early disease silent (guide 3.2), and levodopa&rsquo;s time course. It explains slowness, not rest tremor, and its DBS is an off switch, which real DBS is not (guide 3.3).</p>' +
  '<div class="' + n + '-links"><button type="button" class="' + n + '-link" data-section="33-the-basal-ganglia-circuits">Basal ganglia circuits, guide 3.3</button>' +
  '<button type="button" class="' + n + '-link" data-section="32-the-nigrostriatal-dopamine-system">Nigrostriatal dopamine system, guide 3.2</button></div>' +
'</details>';
  }

  X[NAME] = {
    title: 'Basal ganglia loop: a rate-model sandbox',
    blurb: 'Lower dopamine, add levodopa or STN stimulation, or pull the hyperdirect brake, and watch GPi/SNr output and thalamic drive in a cartoon rate model.',
    mount: mount,
    _model: { PARAMS: PARAMS, KEYS: KEYS, baseInputs: baseInputs, dopamineSignal: dopamineSignal, targetRates: targetRates, steadyState: steadyState, simulatePulse: simulatePulse, vigourBand: vigourBand, BANDS: BANDS, LOOPS: LOOPS, edgeGeometry: edgeGeometry, layoutDiagram: layoutDiagram },
  };
})();
