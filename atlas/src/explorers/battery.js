/* PPMI Atlas explorer: battery
   The six PPMI cognitive tests and the MoCA, plus a Cognitive Summary Score (CSS) calculator that
   reproduces ppmi_pipeline/css.sql with the published norms of Weintraub et al. 2025
   (Mov Disord 40:468-477, doi:10.1002/mds.30111). Every input is invented; no PPMI data is used. */
(function () {
  'use strict';
  const X = (window.PPMIExplorers = window.PPMIExplorers || {});
  const NAME = 'battery';
  const SVGNS = 'http://www.w3.org/2000/svg';
  let instanceCounter = 0;
  let liveInstances = 0;

  /* ------------------------------------------------------------------------------------------
     CSS reference norms, copied exactly from ppmi_pipeline/css_reference_norms.csv
     (Weintraub et al. 2025, doi:10.1002/mds.30111). One reference regression per test:
     expected = intercept + age_linear*(age - age_center) + age_quadratic*(age - age_center)^2
              + sex_coef*sex + edu_linear*(edu - edu_center) + edu_quadratic*(edu - edu_center)^2
     sex uses the paper's codes: 1 = male, 2 = female. rmse = the residual error of the norm model.
     ------------------------------------------------------------------------------------------ */
  const NORMS = Object.freeze({
    hvlt_immediate: Object.freeze({ intercept: 28.37542, age_center: 0, age_linear: -0.05979, age_quadratic: 0, sex_coef: 1.58306, edu_center: 0, edu_linear: 0, edu_quadratic: 0, rmse: 4.32146 }),
    hvlt_delayed: Object.freeze({ intercept: 10.92487, age_center: 0, age_linear: -0.03996, age_quadratic: 0, sex_coef: 0.80139, edu_center: 0, edu_linear: 0, edu_quadratic: 0, rmse: 2.12293 }),
    jlo: Object.freeze({ intercept: 15.07467, age_center: 0, age_linear: -0.02374, age_quadratic: 0, sex_coef: -1.29422, edu_center: 0, edu_linear: 0.08678, edu_quadratic: 0, rmse: 1.77892 }),
    lns: Object.freeze({ intercept: 12.30761, age_center: 0, age_linear: -0.05359, age_quadratic: 0, sex_coef: 0, edu_center: 0, edu_linear: 0.13650, edu_quadratic: 0, rmse: 2.68988 }),
    sdmt: Object.freeze({ intercept: 76.80621, age_center: 0, age_linear: -0.47289, age_quadratic: 0, sex_coef: 0, edu_center: 0, edu_linear: 0, edu_quadratic: 0, rmse: 8.95934 }),
    semantic: Object.freeze({ intercept: 20.25284, age_center: 0, age_linear: 0, age_quadratic: 0, sex_coef: 1.71525, edu_center: 0, edu_linear: 0, edu_quadratic: 0, rmse: 5.49634 })
  });
  const MEASURES = Object.freeze(['hvlt_immediate', 'hvlt_delayed', 'jlo', 'lns', 'sdmt', 'semantic']);
  const Z_CAP = 3; // css.sql: greatest(-3.0, least(3.0, z))

  // Score ranges from guide 4.2. Semantic fluency is a count with no stated maximum.
  const SCORE_RANGES = Object.freeze({
    hvlt_immediate: [0, 36], hvlt_delayed: [0, 12], jlo: [0, 15], lns: [0, 21], sdmt: [0, 110], semantic: [0, null]
  });

  /* ---------------------------------- pure functions ---------------------------------------- */

  // css.py _css_covariates: IDA Demographics codes female 0 and male 1; the paper uses 2 and 1.
  // 'm'/'male' or numeric 1 -> 1; 'f'/'female' or numeric 0 -> 2; anything else -> null.
  function paperSexCode(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v === 1 ? 1 : v === 0 ? 2 : null;
    const s = String(v).toLowerCase();
    if (s === 'm' || s === 'male') return 1;
    if (s === 'f' || s === 'female') return 2;
    if (s.trim() === '') return null;
    const n = Number(s);
    return n === 1 ? 1 : n === 0 ? 2 : null;
  }

  // css.py _css_covariates: CASE WHEN age_years BETWEEN 18 AND 120 THEN age_years END.
  function guardAge(age) {
    return typeof age === 'number' && Number.isFinite(age) && age >= 18 && age <= 120 ? age : null;
  }

  function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

  // Covariates as css.sql receives them from the css_covariates view.
  function prepareCovariates(input) {
    const sex = input.sex === 1 || input.sex === 2 ? input.sex : null;
    return { age: guardAge(input.age), sex: sex, education: isNum(input.education) ? input.education : null };
  }

  // One css.sql term: CASE WHEN coef = 0 THEN 0 ELSE coef * value END. A NULL value gives a NULL term
  // unless the coefficient is zero, so a missing covariate only matters where its coefficient is non-zero.
  function term(coef, value) {
    if (coef === 0) return 0;
    if (!isNum(value)) return null;
    return coef * value;
  }

  // css.sql "expected": the six terms summed left to right; null if any term is null.
  function expectedScore(norm, age, sex, education) {
    const dAge = isNum(age) ? age - norm.age_center : null;
    const dEdu = isNum(education) ? education - norm.edu_center : null;
    const parts = [
      norm.intercept,
      term(norm.age_linear, dAge),
      term(norm.age_quadratic, dAge === null ? null : Math.pow(dAge, 2)),
      term(norm.sex_coef, isNum(sex) ? sex : null),
      term(norm.edu_linear, dEdu),
      term(norm.edu_quadratic, dEdu === null ? null : Math.pow(dEdu, 2))
    ];
    if (parts.some(function (p) { return p === null; })) return null;
    return parts[0] + parts[1] + parts[2] + parts[3] + parts[4] + parts[5];
  }

  // css.sql "standardized": (score - expected_score) / rmse.
  function zScore(score, expected, rmse) {
    if (!isNum(score) || !isNum(expected)) return null;
    return (score - expected) / rmse;
  }

  // css.sql "composite": greatest(-3.0, least(3.0, z)).
  function capZ(z) { return Math.max(-Z_CAP, Math.min(Z_CAP, z)); }

  // css.sql end to end for one visit: z per test, capped, then avg() over the finite z-scores,
  // kept only when all six are finite (WHERE isfinite(z) ... HAVING count(*) = 6). No rounding.
  function scoreCSS(covariates, scores, norms) {
    const N = norms || NORMS;
    const cov = covariates || {};
    const rows = MEASURES.map(function (m) {
      const n = N[m];
      const score = scores && isNum(scores[m]) ? scores[m] : null;
      const expected = expectedScore(n, cov.age, cov.sex, cov.education);
      const z = zScore(score, expected, n.rmse);
      const finite = isNum(z);
      const zUsed = finite ? capZ(z) : null;
      return { measure: m, score: score, expected: expected, rmse: n.rmse, z: finite ? z : null, zUsed: zUsed, capped: finite && zUsed !== z };
    });
    const used = rows.filter(function (r) { return r.zUsed !== null; });
    let css = null;
    if (used.length === MEASURES.length) {
      let sum = 0;
      for (let i = 0; i < used.length; i++) sum += used[i].zUsed;
      css = sum / used.length;
    }
    return { rows: rows, css: css, nFinite: used.length };
  }

  // The pipeline blanks out-of-range scores before scoring (guide 5.4). Ranges from guide 4.2.
  function cleanScore(measure, v) {
    if (v === null || v === undefined || v === '') return { value: null, status: 'missing' };
    if (!isNum(v)) return { value: null, status: 'invalid' };
    const r = SCORE_RANGES[measure];
    if (v < r[0] || (r[1] !== null && v > r[1])) return { value: null, status: 'range' };
    return { value: v, status: 'ok' };
  }

  // Invented example inputs. Example B is deliberately extreme so that two z-scores hit the cap.
  const EXAMPLES = Object.freeze({
    A: Object.freeze({ age: 64, sex: 2, education: 16, scores: Object.freeze({ hvlt_immediate: 24, hvlt_delayed: 8, jlo: 12, lns: 9, sdmt: 38, semantic: 19 }) }),
    B: Object.freeze({ age: 71, sex: 1, education: 12, scores: Object.freeze({ hvlt_immediate: 21, hvlt_delayed: 7, jlo: 14, lns: 4, sdmt: 11, semantic: 40 }) })
  });

  /* ---------------------------------- content ----------------------------------------------- */

  const SECTION_IDS = {
    '1': '1-the-worked-example-at-a-glance', '3.5': '35-why-cognition-declines-the-dual-syndrome-hypothesis',
    '4.2': '42-the-six-cognitive-tests', '4.6': '46-properties-of-these-measures-that-matter-for-modelling',
    '6.1': '61-cognition', '6.4': '64-putting-the-modalities-on-one-timeline'
  };

  const LEANS = {
    d: { label: 'D', long: 'Dopaminergic (frontostriatal)' },
    s: { label: 'S', long: 'Structural (posterior cortical)' },
    both: { label: 'Both', long: 'Both stages' },
    none: { label: 'Not in model', long: 'Not in the model or the CSS' }
  };

  // Facts from guide 1, 3.5, 4.2, 4.6, 5.6 and 6.1 unless the "added" field says otherwise.
  const TESTS = [
    {
      key: 'hvlt_immediate', name: 'HVLT-R immediate recall', short: 'HVLT-R immediate', lean: 'both',
      measures: 'Verbal learning', systems: 'Frontal encoding strategy, medial temporal lobe',
      task: 'Hears 12 words from three categories, read aloud three times. After each reading, recalls as many as possible.',
      range: '0 to 36', vars: ['HVLTRT1', 'HVLTRT2', 'HVLTRT3'], join: ' + ',
      repeat: 'Alternate forms exist to reduce practice; check which form was used.',
      watch: 'Leans on both stages because it needs a frontal encoding strategy as well as the medial temporal lobe.',
      added: 'Standard HVLT-R: four words from each category, six parallel forms, and a 24-word recognition list (Brandt 1991; Benedict et al. 1998).',
      guide: '3.5, 4.2'
    },
    {
      key: 'hvlt_delayed', name: 'HVLT-R delayed recall', short: 'HVLT-R delayed', lean: 's',
      measures: 'Verbal memory retention', systems: 'Medial temporal lobe, hippocampus',
      task: 'Free recall of the same words 20 to 25 minutes later, then a yes/no recognition list.',
      range: '0 to 12', vars: ['HVLTRDLY'], join: '',
      repeat: 'Uses the immediate-recall word list, so the same form question applies. Practice effects.',
      watch: 'Floor effects in impaired people. A bounded count, so its errors are not normal.',
      guide: '3.5, 4.2, 6.1'
    },
    {
      key: 'jlo', name: 'Benton Judgment of Line Orientation', short: 'JLO', lean: 's',
      measures: 'Visuospatial judgement', systems: 'Right parietal cortex',
      task: 'Matches the angle of two short lines to an 11-line fan (Benton et al. 1978). PPMI uses a 15-item short form.',
      range: '0 to 15', vars: ['JLO_TOTRAW'], join: '',
      repeat: 'The guide does not describe alternate forms of the 15-item version; check the data dictionary.',
      watch: 'Use JLO_TOTRAW. JLO_TOTCALC is exactly twice the raw score (a 30-item-equivalent scale), so the CSS norms no longer apply. Ceiling: most people score 12 to 15, so small changes are noisy; model it as binomial or ordinal.',
      guide: '1, 3.5, 4.2, 5.4, 6.1'
    },
    {
      key: 'lns', name: 'Letter-Number Sequencing', short: 'LNS', lean: 'd',
      measures: 'Working memory', systems: 'Dorsolateral prefrontal cortex, caudate loop',
      task: 'Hears a mix such as "T-9-A-3", then says the numbers in order and the letters in order. Seven items of three trials (Wechsler scales).',
      range: '0 to 21', vars: ['LNS_TOTRAW'], join: '',
      repeat: 'The guide describes no alternate forms; check the data dictionary.',
      watch: 'Sensitive to attention and mood. Medication shifts frontostriatal tests once participants start treatment.',
      guide: '3.5, 4.2'
    },
    {
      key: 'sdmt', name: 'Symbol Digit Modalities Test', short: 'SDMT', lean: 'd',
      measures: 'Processing speed, attention', systems: 'Frontostriatal circuits, white matter; the written form adds motor speed',
      task: 'A key pairs nine symbols with digits. Fills in digits under symbols for 90 seconds.',
      range: '0 to 110 correct', vars: ['SDMTOTAL'], join: '', extraVar: ['version', 'SDMTVRSN'],
      repeat: 'The version is recorded in SDMTVRSN; check what it codes before pooling visits.',
      watch: 'The written form needs hand speed, so it partly measures motor slowing (Turner et al. 2023). Plan sensitivity analyses that adjust for MDS-UPDRS III or drop SDMT.',
      added: 'The SDMT can also be given orally, which removes most of the hand-speed demand (Smith 1982).',
      guide: '3.5, 4.2, 6.1'
    },
    {
      key: 'semantic', name: 'Semantic fluency (animals)', short: 'Semantic fluency', lean: 's',
      measures: 'Semantic retrieval', systems: 'Temporal semantic stores plus frontal search',
      task: 'Names as many animals as possible in 60 seconds.',
      range: 'A count, no fixed maximum', vars: ['VLTANIM'], join: '',
      repeat: 'The guide describes no alternate forms. PPMI also records vegetables and fruits.',
      watch: 'Depends on education and language; moderate reliability. Yet the published CSS norm for this test has no education term.',
      added: 'An inference, to check: the norm expects about 22 to 24 words, the scale of one 60-second category, so a sum over animals, vegetables and fruits would not fit it.',
      guide: '3.5, 4.2'
    }
  ];
  const MOCA = {
    key: 'moca', name: 'Montreal Cognitive Assessment (MoCA)', lean: 'none',
    measures: 'A 30-point screen', systems: 'Attention, executive function, naming, memory, language, abstraction and orientation',
    task: 'A short screen covering seven areas, given by a rater (Nasreddine et al. 2005).',
    range: '0 to 30; 26 or more is normal on the original cut-off', vars: ['MCATOT'], join: '',
    repeat: 'The guide does not say whether PPMI alternates MoCA versions; check the data dictionary.',
    watch: 'A screen, not a domain measure, and not part of the CSS. It crowds near the top in early PD. At PPMI baseline, 22% of PD fell below the cut-off but only 9% met test-based MCI criteria (Weintraub et al. 2015).',
    added: 'The original scoring adds 1 point for 12 or fewer years of education (Nasreddine et al. 2005).',
    guide: '4.2, 4.6, 5.1, 8.1'
  };
  const TEST_BY_KEY = {};
  TESTS.forEach(function (t) { TEST_BY_KEY[t.key] = t; });
  const LEAN_ORDER = ['lns', 'sdmt', 'hvlt_immediate', 'hvlt_delayed', 'jlo', 'semantic'];

  /* ---------------------------------- formatting -------------------------------------------- */

  const MINUS = '−';
  function fmt(x, d) {
    if (!isNum(x)) return 'n/a';
    const v = Number(x.toFixed(d));
    if (v === 0) return (0).toFixed(d);
    return (v < 0 ? MINUS : '') + Math.abs(v).toFixed(d);
  }
  function fmtSigned(x, d) {
    if (!isNum(x)) return 'n/a';
    const v = Number(x.toFixed(d));
    if (v === 0) return (0).toFixed(d);
    return (v < 0 ? MINUS : '+') + Math.abs(v).toFixed(d);
  }
  // Coefficients are printed with the five decimals of css_reference_norms.csv (0.13650, not 0.1365).
  function fmtCoef(c) { return Math.abs(c).toFixed(5); }
  function fmtIn(v) { return isNum(v) ? (v < 0 ? MINUS + Math.abs(v) : String(v)) : 'n/a'; }

  // Plain-language reading of one norm row, generated from NORMS so it stays exact.
  function normSentence(n) {
    const parts = [];
    parts.push(n.age_linear !== 0 ? fmtSigned(n.age_linear, 3) + ' per year of age' : 'no age term');
    parts.push(n.sex_coef !== 0 ? 'women ' + fmtSigned(n.sex_coef, 2) + ' relative to men' : 'no sex term');
    parts.push(n.edu_linear !== 0 ? fmtSigned(n.edu_linear, 3) + ' per year of education' : 'no education term');
    if (n.age_quadratic !== 0) parts.push('age squared ' + fmtSigned(n.age_quadratic, 4));
    if (n.edu_quadratic !== 0) parts.push('education squared ' + fmtSigned(n.edu_quadratic, 4));
    return 'Expected score: ' + parts.join('; ') + '. Residual error (RMSE) ' + n.rmse.toFixed(2) + '.';
  }

  /* ---------------------------------- styles ------------------------------------------------ */

  const STYLE = `
.battery-root { font-family: var(--font-ui); color: var(--fg); font-size: 14px; line-height: 1.45; }
.battery-root *, .battery-root *::before, .battery-root *::after { box-sizing: border-box; }
.battery-root h3 { font-size: 16px; font-weight: 600; margin: 0; letter-spacing: -0.005em; }
.battery-root h4 { font-size: 15px; font-weight: 600; margin: 0; line-height: 1.3; }
.battery-root p { margin: 0; }
.battery-root button, .battery-root input, .battery-root select { font: inherit; color: var(--fg); }
.battery-root :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.battery-root .battery-lede { font-family: var(--font-body); font-size: 14.5px; line-height: 1.55; max-width: 80ch; }
.battery-root .battery-muted { color: var(--muted); }
.battery-root .battery-small { font-size: 12.5px; color: var(--muted); }
.battery-root .battery-sec { margin-top: 26px; padding-top: 18px; border-top: 1px solid var(--rule); }
.battery-root .battery-toprow { display: flex; flex-wrap: wrap; gap: 10px 22px; align-items: center; justify-content: space-between; margin: 14px 0 0; }
.battery-root .battery-sechead { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
.battery-root .battery-control { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; }
.battery-root select, .battery-root input[type="number"] { background: var(--surface); border: 1px solid var(--rule); border-radius: 6px; padding: 4px 7px; font-size: 14px; }
.battery-root select:hover, .battery-root input[type="number"]:hover { border-color: var(--axis); }
.battery-root input[type="number"] { width: 5.6em; font-variant-numeric: tabular-nums; text-align: right; }
.battery-root input[aria-invalid="true"] { border-color: var(--critical); }
.battery-root .battery-btn { background: var(--surface-2); border: 1px solid var(--rule); border-radius: 6px; padding: 5px 11px; font-size: 13px; cursor: pointer; }
.battery-root .battery-btn:hover { border-color: var(--axis); }
.battery-root .battery-btn[aria-pressed="true"] { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.battery-root .battery-link { background: none; border: 0; padding: 0; color: var(--accent); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; font-size: 13px; }
.battery-root a { color: var(--accent); text-underline-offset: 2px; }
/* lean legend and chips */
.battery-root .battery-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; font-size: 12.5px; color: var(--muted); }
.battery-root .battery-key { display: inline-flex; align-items: center; gap: 6px; }
.battery-root .battery-sw { display: inline-block; width: 12px; height: 12px; border-radius: 3px; flex: none; }
.battery-root .battery-sw-d { background: var(--accent); }
.battery-root .battery-sw-s { background: var(--accent-2); }
.battery-root .battery-sw-both { background: linear-gradient(180deg, var(--accent) 0 50%, var(--accent-2) 50% 100%); }
.battery-root .battery-sw-none { background: transparent; border: 1.5px solid var(--axis); }
.battery-root .battery-sw-cap { width: 14px; height: 0; border-top: 1.5px dashed var(--muted); border-radius: 0; }
.battery-root .battery-sw-css { width: 3px; height: 14px; background: var(--fg); border-radius: 1px; }
.battery-root .battery-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; padding: 2px 8px 2px 6px; border-radius: 999px; background: var(--surface-2); white-space: nowrap; }
/* cards */
.battery-root .battery-cards { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); margin-top: 12px; }
.battery-root.battery-w1 .battery-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.battery-root.battery-w2 .battery-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.battery-root .battery-card { position: relative; background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; padding: 14px 14px 12px; overflow: hidden; display: flex; flex-direction: column; gap: 8px; }
.battery-root .battery-card::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 3px; background: var(--axis); }
.battery-root .battery-card.battery-lean-d::before { background: var(--accent); }
.battery-root .battery-card.battery-lean-s::before { background: var(--accent-2); }
.battery-root .battery-card.battery-lean-both::before { background: linear-gradient(90deg, var(--accent) 0 50%, var(--accent-2) 50% 100%); }
.battery-root .battery-card-wide { grid-column: 1 / -1; }
.battery-root .battery-card-head { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; }
.battery-root .battery-domain { font-size: 13px; color: var(--muted); }
.battery-root .battery-dl { display: grid; gap: 7px; margin: 0; }
.battery-root .battery-pair { display: grid; grid-template-columns: 6.6em minmax(0, 1fr); gap: 10px; }
.battery-root .battery-pair dt { font-size: 12px; font-weight: 500; color: var(--muted); padding-top: 1px; }
.battery-root .battery-pair dd { margin: 0; font-size: 13.5px; }
.battery-root.battery-w2 .battery-card-wide .battery-dl { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 28px; }
.battery-root .battery-var { font-family: var(--font-mono); font-size: 12px; background: var(--surface-2); border-radius: 4px; padding: 1px 5px; white-space: nowrap; }
.battery-root .battery-added { font-size: 12.5px; color: var(--muted); border-left: 2px solid var(--rule); padding-left: 8px; }
.battery-root .battery-added b { font-weight: 600; color: var(--fg); }
.battery-root .battery-src { font-size: 12px; color: var(--muted); margin-top: auto; }
.battery-root .battery-also { font-size: 13px; color: var(--muted); margin-top: 12px; max-width: 110ch; }
/* calculator */
.battery-root .battery-calc-grid { display: grid; gap: 20px 26px; grid-template-columns: minmax(0, 1fr); grid-template-areas: "in" "chart" "table"; align-items: start; margin-top: 14px; }
.battery-root.battery-w1 .battery-calc-grid { grid-template-columns: minmax(250px, 300px) minmax(0, 1fr); grid-template-areas: "in chart" "in table"; }
.battery-root.battery-w3 .battery-calc-grid { grid-template-columns: 300px minmax(0, 1.3fr) minmax(360px, 1fr); grid-template-areas: "in chart table"; }
.battery-root .battery-inputs { grid-area: in; display: flex; flex-direction: column; gap: 14px; background: var(--tint); border-radius: 8px; padding: 14px; }
.battery-root .battery-out-chart { grid-area: chart; min-width: 0; }
.battery-root .battery-out-table { grid-area: table; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.battery-root .battery-badge { align-self: flex-start; font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 999px; border: 1px dashed var(--warn); color: var(--fg); background: var(--surface); }
.battery-root fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
.battery-root legend { font-size: 12.5px; font-weight: 600; color: var(--muted); padding: 0; margin-bottom: 6px; }
.battery-root .battery-field { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "lab inp" "hint hint" "msg msg"; column-gap: 10px; align-items: center; padding: 3px 0; }
.battery-root .battery-field label { grid-area: lab; font-size: 13.5px; }
.battery-root .battery-field input, .battery-root .battery-field select { grid-area: inp; }
.battery-root .battery-field .battery-hint { grid-area: hint; font-size: 12px; color: var(--muted); }
.battery-root .battery-field .battery-msg { grid-area: msg; font-size: 12px; color: var(--critical); }
.battery-root .battery-field .battery-msg:empty { display: none; }
.battery-root .battery-btnrow { display: flex; flex-wrap: wrap; gap: 8px; }
.battery-root .battery-radios { display: flex; flex-direction: column; gap: 4px; font-size: 13.5px; }
.battery-root .battery-radios label { display: inline-flex; gap: 8px; align-items: center; cursor: pointer; }
.battery-root .battery-hero { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 16px; row-gap: 2px; align-items: end; margin-bottom: 12px; }
.battery-root .battery-hero-label { grid-column: 1; grid-row: 1; font-size: 12.5px; font-weight: 600; color: var(--muted); }
.battery-root .battery-hero-val { grid-column: 1; grid-row: 2; font-size: 44px; font-weight: 600; line-height: 1; letter-spacing: -0.02em; }
.battery-root .battery-hero-val.is-none { font-size: 22px; color: var(--muted); }
.battery-root .battery-hero-side { grid-column: 2; grid-row: 1 / span 2; display: flex; flex-direction: column; gap: 4px; padding-bottom: 2px; }
.battery-root .battery-tag { align-self: flex-start; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--surface-2); }
.battery-root .battery-tag.is-explore { border: 1px dashed var(--warn); background: var(--surface); }
.battery-root .battery-hero-note { font-size: 12.5px; color: var(--muted); max-width: 62ch; }
.battery-root .battery-howto { font-size: 13px; color: var(--muted); margin: 0 0 8px; max-width: 80ch; }
.battery-root .battery-howto b { color: var(--fg); font-weight: 600; }
.battery-root .battery-chartbox { position: relative; margin-top: 8px; }
.battery-root .battery-svg { display: block; overflow: visible; font-family: var(--font-ui); }
.battery-root .battery-svg text { fill: var(--fg); font-size: 13px; }
.battery-root .battery-svg .battery-rowlabel { font-size: 13px; }
.battery-root .battery-svg .battery-tick { fill: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.battery-root .battery-svg .battery-axis-title { fill: var(--muted); font-size: 12px; }
.battery-root .battery-svg .battery-val { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
.battery-root .battery-svg .battery-val-note { fill: var(--muted); font-size: 12px; font-weight: 400; }
.battery-root .battery-svg .battery-csslabel { font-size: 13px; font-weight: 600; paint-order: stroke; stroke: var(--surface); stroke-width: 4px; stroke-linejoin: round; }
.battery-root .battery-svg .battery-notscored { fill: var(--muted); font-size: 12px; }
.battery-root .battery-grid { stroke: var(--grid); stroke-width: 1; }
.battery-root .battery-zero { stroke: var(--axis); stroke-width: 1; }
.battery-root .battery-cap { stroke: var(--muted); stroke-width: 1.25; stroke-dasharray: 4 3; }
.battery-root .battery-cssline { stroke: var(--fg); stroke-width: 2; pointer-events: none; }
.battery-root .battery-bar-d { fill: var(--accent); }
.battery-root .battery-bar-s { fill: var(--accent-2); }
.battery-root .battery-excess { fill: none; stroke: var(--muted); stroke-width: 1.25; stroke-dasharray: 3 2; }
.battery-root .battery-chev { fill: var(--muted); }
.battery-root .battery-rowbg { fill: transparent; }
.battery-root .battery-rowbg.is-hot { fill: var(--tint); }
.battery-root .battery-rowbg.is-focus { stroke: var(--accent); stroke-width: 2; }
.battery-root .battery-hit { fill: transparent; outline: none; }
.battery-root .battery-tip { position: absolute; z-index: 2; pointer-events: none; background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; padding: 7px 10px; font-size: 12.5px; line-height: 1.35; box-shadow: 0 6px 18px -8px var(--axis); max-width: 280px; white-space: normal; }
.battery-root .battery-tip[hidden] { display: none; }
.battery-root .battery-tip strong { font-size: 15px; font-weight: 600; }
.battery-root .battery-tip .battery-tip-name { color: var(--muted); }
.battery-root .battery-simlabel { font-size: 12px; color: var(--muted); margin-top: 6px; }
.battery-root table.battery-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.battery-root .battery-table td { font-variant-numeric: tabular-nums; }
.battery-root .battery-table caption { text-align: left; font-size: 12.5px; font-weight: 600; color: var(--muted); padding-bottom: 6px; }
.battery-root .battery-table th, .battery-root .battery-table td { padding: 5px 6px; border-bottom: 1px solid var(--grid); text-align: right; white-space: nowrap; }
.battery-root .battery-table th:first-child, .battery-root .battery-table td:first-child { text-align: left; white-space: normal; }
.battery-root .battery-table thead th { font-size: 12px; font-weight: 600; color: var(--muted); border-bottom: 1px solid var(--rule); }
.battery-root .battery-table tbody tr.is-hot { background: var(--tint); }
.battery-root .battery-table tfoot th, .battery-root .battery-table tfoot td { border-bottom: 0; border-top: 1px solid var(--rule); font-weight: 600; }
.battery-root .battery-table .battery-capnote { display: block; font-size: 12px; font-weight: 400; color: var(--muted); }
.battery-root .battery-pitfall { font-size: 13px; background: var(--tint); border-radius: 8px; padding: 9px 11px; }
.battery-root .battery-pitfall b { font-weight: 600; }
.battery-root details.battery-arith { font-size: 13px; }
.battery-root details.battery-arith summary { cursor: pointer; color: var(--fg); font-weight: 500; }
.battery-root details.battery-arith ol { margin: 8px 0 0; padding-left: 18px; display: grid; gap: 5px; }
.battery-root details.battery-arith li { font-family: var(--font-mono); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.battery-root .battery-notes { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); margin-top: 18px; }
.battery-root.battery-w1 .battery-notes { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.battery-root.battery-w2 .battery-notes { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.battery-root .battery-note { background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; padding: 10px 12px; font-size: 13px; }
.battery-root .battery-note h5 { margin: 0 0 3px; font-size: 13px; font-weight: 600; }
.battery-root .battery-note.is-key { border-color: var(--warn); }
.battery-root .battery-cite { font-size: 12.5px; color: var(--muted); margin-top: 14px; }
.battery-root .battery-guide { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; margin-top: 10px; font-size: 13px; color: var(--muted); }
@media (prefers-reduced-motion: no-preference) {
  .battery-root .battery-rowbg, .battery-root .battery-table tbody tr { transition: fill 120ms ease, background-color 120ms ease; }
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
  function setAttrs(el, attrs) {
    if (!attrs) return;
    Object.keys(attrs).forEach(function (k) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.setAttribute('class', v);
      else el.setAttribute(k, v === true ? '' : String(v));
    });
  }
  function append(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(el, k); }); return; }
    el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  // Bar with a 4px rounded data end and a square end at the baseline x0.
  function barPath(x0, x1, y, hgt, r) {
    const w = Math.abs(x1 - x0);
    if (w < 0.5) return '';
    r = Math.min(r, w, hgt / 2);
    if (x1 > x0) {
      return 'M' + x0 + ',' + y + 'H' + (x1 - r) + 'A' + r + ',' + r + ' 0 0 1 ' + x1 + ',' + (y + r) +
        'V' + (y + hgt - r) + 'A' + r + ',' + r + ' 0 0 1 ' + (x1 - r) + ',' + (y + hgt) + 'H' + x0 + 'Z';
    }
    return 'M' + x0 + ',' + y + 'H' + (x1 + r) + 'A' + r + ',' + r + ' 0 0 0 ' + x1 + ',' + (y + r) +
      'V' + (y + hgt - r) + 'A' + r + ',' + r + ' 0 0 0 ' + (x1 + r) + ',' + (y + hgt) + 'H' + x0 + 'Z';
  }

  /* ---------------------------------- mount ------------------------------------------------- */

  function mount(el, ctx) {
    const inst = ++instanceCounter;
    liveInstances++;
    const P = NAME + '-' + inst + '-';
    const ac = new AbortController();
    function on(node, type, fn) { node.addEventListener(type, fn, { signal: ac.signal }); }
    const canOpen = !!(ctx && typeof ctx.openSection === 'function');
    injectStyle();

    const state = { order: 'guide', visit: 'baseline', example: 'A' };
    const inputs = {};
    const msgs = {};
    let raf = 0;
    let lastResult = null;
    let lastCov = null;

    const root = h('div', { class: 'battery-root' });
    el.appendChild(root);

    function guideButtons(list) {
      if (!canOpen) return h('p', { class: 'battery-guide' }, 'Guide sections: ' + list.join(', '));
      const wrap = h('p', { class: 'battery-guide' }, 'Read in the guide:');
      list.forEach(function (num) {
        const b = h('button', { type: 'button', class: 'battery-link' }, num);
        on(b, 'click', function () { ctx.openSection(SECTION_IDS[num]); });
        wrap.appendChild(b);
      });
      return wrap;
    }
    function leanKey(lean, text) {
      return h('span', { class: 'battery-key' }, h('span', { class: 'battery-sw battery-sw-' + lean, 'aria-hidden': 'true' }), text);
    }
    function leanChip(lean) {
      const L = LEANS[lean];
      return h('span', { class: 'battery-chip', title: 'Predicted lean: ' + L.long },
        h('span', { class: 'battery-sw battery-sw-' + lean, 'aria-hidden': 'true' }),
        lean === 'none' ? L.label : 'Lean: ' + L.label);
    }

    /* ---- intro and order control ---- */
    const orderSel = h('select', { id: P + 'order' },
      h('option', { value: 'guide' }, 'Guide order'),
      h('option', { value: 'lean' }, 'Grouped by predicted lean'));
    on(orderSel, 'change', function () { state.order = orderSel.value; placeCards(); schedule(); });
    root.appendChild(h('p', { class: 'battery-lede' },
      'PPMI gives six cognitive tests about once a year, each by a trained rater following a fixed procedure. ' +
      'The two-dimension model lets every test load on both stages, D and S; the CSS instead averages the six normed scores into one number. ' +
      'Scores rise on retesting, especially at the first repeat, and can mask decline (guide 4.2, 4.6, 6.1).'));
    root.appendChild(h('div', { class: 'battery-toprow' },
      h('div', { class: 'battery-legend', role: 'group', 'aria-label': 'Predicted lean colours' },
        h('span', null, 'Colour = lean predicted by the dual syndrome hypothesis (3.5):'),
        leanKey('d', 'D, dopaminergic'), leanKey('s', 'S, structural'), leanKey('both', 'both')),
      h('label', { class: 'battery-control', for: P + 'order' }, 'Order tests', orderSel)));
    root.appendChild(h('p', { class: 'battery-small', style: 'margin-top:6px' },
      'The colours show the hypothesis to test, not a result.'));

    /* ---- cards ---- */
    function pair(label, value) { return h('div', { class: 'battery-pair' }, h('dt', null, label), h('dd', null, value)); }
    function varList(t) {
      const out = [];
      t.vars.forEach(function (v, i) {
        if (i > 0) out.push(t.join);
        out.push(h('code', { class: 'battery-var' }, v));
      });
      if (t.extraVar) out.push('; ' + t.extraVar[0] + ' ', h('code', { class: 'battery-var' }, t.extraVar[1]));
      return out;
    }
    function buildCard(t, wide) {
      const n = NORMS[t.key];
      const hid = P + 'card-' + t.key;
      return h('article', { class: 'battery-card battery-lean-' + t.lean + (wide ? ' battery-card-wide' : ''), 'aria-labelledby': hid, 'data-key': t.key },
        h('div', { class: 'battery-card-head' }, h('h4', { id: hid }, t.name), leanChip(t.lean)),
        h('p', { class: 'battery-domain' }, t.measures + ' · ' + t.systems),
        h('dl', { class: 'battery-dl' },
          pair('Task', t.task),
          pair('Score', [t.range + ': ', varList(t)]),
          pair('Repeat testing', t.repeat),
          pair('Watch out', t.watch),
          n ? pair('CSS norm', normSentence(n)) : pair('In the CSS', 'No.')),
        t.added ? h('p', { class: 'battery-added' }, h('b', null, 'Beyond the guide. '), t.added) : null,
        h('p', { class: 'battery-src' }, 'Guide ' + t.guide));
    }
    const cardEls = {};
    TESTS.forEach(function (t) { cardEls[t.key] = buildCard(t, false); });
    const mocaCard = buildCard(MOCA, true);
    const cardGrid = h('div', { class: 'battery-cards' });
    function orderedKeys() { return state.order === 'lean' ? LEAN_ORDER : MEASURES; }
    function placeCards() {
      orderedKeys().forEach(function (k) { cardGrid.appendChild(cardEls[k]); });
      cardGrid.appendChild(mocaCard);
    }
    placeCards();
    root.appendChild(h('section', { class: 'battery-sec', 'aria-labelledby': P + 'cards-h' },
      h('div', { class: 'battery-sechead' }, h('h3', { id: P + 'cards-h' }, 'The six tests and the MoCA'),
        h('span', { class: 'battery-small' }, 'Facts from the guide unless marked “Beyond the guide”')),
      cardGrid,
      h('p', { class: 'battery-also' },
        'Also in PPMI: clock drawing, lexical (letter) fluency, the Modified Boston Naming Test, the Trail Making Test, ' +
        'a mild cognitive impairment flag and the site investigator’s cognitive diagnosis (normal, MCI or dementia) (guide 4.2).')));

    /* ---- calculator: inputs ---- */
    const form = h('form', { class: 'battery-inputs', novalidate: true, 'aria-labelledby': P + 'calc-h' });
    on(form, 'submit', function (e) { e.preventDefault(); });
    const badge = h('p', { class: 'battery-badge', id: P + 'badge' }, 'Example values A (invented)');
    form.appendChild(badge);

    function numField(key, label, hint, attrs) {
      const id = P + key;
      const input = h('input', Object.assign({ id: id, type: 'number', 'aria-describedby': id + '-hint ' + id + '-msg' }, attrs));
      const msg = h('span', { class: 'battery-msg', id: id + '-msg' });
      inputs[key] = input; msgs[key] = msg;
      on(input, 'input', onEdit);
      return h('div', { class: 'battery-field' }, h('label', { for: id }, label), input,
        h('span', { class: 'battery-hint', id: id + '-hint' }, hint), msg);
    }
    const sexSel = h('select', { id: P + 'sex', 'aria-describedby': P + 'sex-hint' },
      h('option', { value: '2' }, 'Female'), h('option', { value: '1' }, 'Male'), h('option', { value: '' }, 'Not recorded'));
    inputs.sex = sexSel;
    on(sexSel, 'change', onEdit);
    form.appendChild(h('fieldset', null, h('legend', null, 'Person'),
      numField('age', 'Age at the visit', 'Years. css.py treats ages outside 18 to 120 as missing.', { min: 18, max: 120, step: 'any' }),
      h('div', { class: 'battery-field' }, h('label', { for: P + 'sex' }, 'Sex'), sexSel,
        h('span', { class: 'battery-hint', id: P + 'sex-hint' }, 'Paper codes: female 2, male 1 (IDA SEX 0 and 1).')),
      numField('edu', 'Education', 'Years of schooling.', { min: 0, max: 30, step: 1 })));
    const scoreFs = h('fieldset', null, h('legend', null, 'Raw scores'));
    MEASURES.forEach(function (m) {
      const t = TEST_BY_KEY[m];
      const r = SCORE_RANGES[m];
      const hint = (r[1] === null ? 'Count of animals' : r[0] + ' to ' + r[1]) + ' · ' + t.vars.join(' + ');
      const attrs = { min: r[0], step: 1 };
      if (r[1] !== null) attrs.max = r[1];
      scoreFs.appendChild(numField(m, t.short, hint, attrs));
    });
    form.appendChild(scoreFs);

    const btnA = h('button', { type: 'button', class: 'battery-btn', 'aria-pressed': 'true' }, 'Example A');
    const btnB = h('button', { type: 'button', class: 'battery-btn', 'aria-pressed': 'false' }, 'Example B: capping');
    on(btnA, 'click', function () { loadExample('A'); });
    on(btnB, 'click', function () { loadExample('B'); });
    form.appendChild(h('div', null, h('div', { class: 'battery-btnrow' }, btnA, btnB),
      h('p', { class: 'battery-small', style: 'margin-top:6px' }, 'Both are invented. B is deliberately extreme so that two z-scores reach the cap.')));

    const visitFs = h('fieldset', null, h('legend', null, 'Which visit is this?'));
    const radios = h('div', { class: 'battery-radios' });
    [['baseline', 'Baseline (as validated)'], ['later', 'A later visit (exploratory)']].forEach(function (o) {
      const id = P + 'visit-' + o[0];
      const rb = h('input', { type: 'radio', name: P + 'visit', id: id, value: o[0], checked: o[0] === 'baseline' });
      on(rb, 'change', function () { if (rb.checked) { state.visit = o[0]; schedule(); } });
      radios.appendChild(h('label', { for: id }, rb, o[1]));
    });
    visitFs.appendChild(radios);
    form.appendChild(visitFs);

    /* ---- calculator: outputs ---- */
    const heroVal = h('span', { class: 'battery-hero-val', id: P + 'css' });
    const heroTag = h('span', { class: 'battery-tag' });
    const heroNote = h('p', { class: 'battery-hero-note' });
    const hero = h('div', { class: 'battery-hero', role: 'status' },
      h('span', { class: 'battery-hero-label' }, 'Cognitive Summary Score'), heroVal,
      h('div', { class: 'battery-hero-side' }, heroTag, heroNote));

    const svg = S('svg', { class: 'battery-svg', role: 'group', 'aria-label': 'Bar chart of the six capped z-scores and the CSS' });
    const tip = h('div', { class: 'battery-tip', hidden: true, 'aria-hidden': 'true' });
    const chartBox = h('div', { class: 'battery-chartbox' }, svg, tip);
    const chartLegend = h('div', { class: 'battery-legend', style: 'margin-top:4px' },
      leanKey('d', 'D lean'), leanKey('s', 'S lean'), leanKey('both', 'both'),
      h('span', { class: 'battery-key' }, h('span', { class: 'battery-sw battery-sw-cap', 'aria-hidden': 'true' }), 'cap at ±3'),
      h('span', { class: 'battery-key' }, h('span', { class: 'battery-sw battery-sw-css', 'aria-hidden': 'true' }), 'CSS, the mean'));
    const outChart = h('div', { class: 'battery-out-chart' }, hero,
      h('p', { class: 'battery-howto' }, h('b', null, 'How to read this. '),
        'Each bar is one test’s z-score: its distance from the score expected for this age, sex and education, in units of the norm’s residual error. ' +
        'Bars stop at the dashed caps at ±3; a dotted outline shows any part cut off. The solid vertical line is the CSS, the mean of the six capped values.'),
      chartLegend, chartBox,
      h('p', { class: 'battery-simlabel' }, 'Simulated data for illustration, not PPMI data. Example values are invented.'));

    const tbody = h('tbody');
    const cssCell = h('td');
    const table = h('table', { class: 'battery-table' },
      h('caption', null, 'Scores, expected scores and z-scores'),
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Test'), h('th', { scope: 'col' }, 'Score'), h('th', { scope: 'col' }, 'Expected'),
        h('th', { scope: 'col' }, 'RMSE'), h('th', { scope: 'col' }, 'z'), h('th', { scope: 'col' }, 'z used'))),
      tbody,
      h('tfoot', null, h('tr', null, h('th', { scope: 'row', colspan: '5' }, 'CSS: mean of the six z used'), cssCell)));
    const tableRows = {};
    function buildTableRows() {
      clear(tbody);
      orderedKeys().forEach(function (m) {
        const tr = h('tr', { 'data-m': m });
        on(tr, 'pointerenter', function () { setHot(m, true); });
        on(tr, 'pointerleave', function () { setHot(m, false); });
        tableRows[m] = tr;
        tbody.appendChild(tr);
      });
    }
    buildTableRows();
    const pitfall = h('p', { class: 'battery-pitfall', 'aria-live': 'polite' });
    const arithList = h('ol');
    const arith = h('details', { class: 'battery-arith' }, h('summary', null, 'Show the arithmetic (full precision, as css.sql)'), arithList);
    const outTable = h('div', { class: 'battery-out-table' }, table, pitfall, arith);

    const calcGrid = h('div', { class: 'battery-calc-grid' }, form, outChart, outTable);

    function note(title, text, key) {
      return h('div', { class: 'battery-note' + (key ? ' is-key' : '') }, h('h5', null, title), h('p', null, text));
    }
    const doi = h('a', { href: 'https://doi.org/10.1002/mds.30111', target: '_blank', rel: 'noopener noreferrer' }, 'doi:10.1002/mds.30111');
    root.appendChild(h('section', { class: 'battery-sec', 'aria-labelledby': P + 'calc-h' },
      h('div', { class: 'battery-sechead' }, h('h3', { id: P + 'calc-h' }, 'Cognitive Summary Score calculator'),
        h('span', { class: 'battery-small' }, 'Reproduces ppmi_pipeline/css.sql with the published norms')),
      h('p', { class: 'battery-lede' },
        'Enter age, sex, education and the six raw scores. Each score becomes a z-score: the observed score minus the score expected for that age, sex and education among robust healthy controls, divided by the norm model’s residual error. Each z-score is capped at ±3, and the CSS is their equal-weight mean (guide 4.2).'),
      calcGrid,
      h('div', { class: 'battery-notes' },
        note('Validated at baseline only', 'The paper evaluated the CSS at baseline. Scores at later visits are exploratory (guide 4.2, 5.6).', true),
        note('Published norms', 'These coefficients are the paper’s, fitted on robust healthy controls. css.py can instead fit norms on PPMI’s own controls; inside cross-validation, fit them on training participants only (guide 6.1, 6.4).'),
        note('JLO scale', 'The norms are on JLO_TOTRAW (0 to 15). JLO_TOTCALC is exactly twice the raw score, so using it breaks the norms (guide 1, 5.6).'),
        note('Sex codes', 'IDA codes SEX 0 (female) and 1 (male); the paper’s norms use 2 and 1. css.py maps them before scoring (guide 5.6).'),
        note('Missing values', 'css.sql reports a CSS only when all six z-scores are finite. A missing covariate blocks only tests whose coefficient is non-zero: without education, JLO and LNS cannot be scored, so there is no CSS. The pipeline blanks out-of-range scores first (guide 5.4).'),
        note('One number hides the question', 'An equal-weight composite throws away whether tests move differently, which is exactly what the two-dimension model asks. It gives each test its own loadings (guide 6.1).')),
      h('p', { class: 'battery-cite' },
        'Norms: Weintraub D, et al. 2025. Use of robust norming to create a sensitive cognitive summary score in de novo Parkinson’s disease. Mov Disord 40:468–477. ', doi,
        '. Coefficients copied from ppmi_pipeline/css_reference_norms.csv. No rounding inside the calculation; numbers are rounded only for display.'),
      guideButtons(['1', '3.5', '4.2', '4.6', '6.1'])));

    /* ---- behaviour ---- */
    function setInputsFrom(ex) {
      inputs.age.value = String(ex.age);
      inputs.sex.value = String(ex.sex);
      inputs.edu.value = String(ex.education);
      MEASURES.forEach(function (m) { inputs[m].value = String(ex.scores[m]); });
    }
    function loadExample(k) {
      setInputsFrom(EXAMPLES[k]);
      state.example = k;
      schedule();
    }
    function onEdit() { state.example = matchExample(); schedule(); }
    function readNum(key) {
      const raw = inputs[key].value.trim();
      if (raw === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : NaN;
    }
    function matchExample() {
      const keys = Object.keys(EXAMPLES);
      for (let i = 0; i < keys.length; i++) {
        const ex = EXAMPLES[keys[i]];
        if (readNum('age') !== ex.age || inputs.sex.value !== String(ex.sex) || readNum('edu') !== ex.education) continue;
        if (MEASURES.every(function (m) { return readNum(m) === ex.scores[m]; })) return keys[i];
      }
      return null;
    }
    function readAll() {
      const ageRaw = readNum('age');
      const eduRaw = readNum('edu');
      const sexRaw = inputs.sex.value === '' ? null : Number(inputs.sex.value);
      const cov = prepareCovariates({ age: ageRaw, sex: sexRaw, education: eduRaw });
      const messages = {};
      if (ageRaw === null) messages.age = 'Missing: age-dependent tests cannot be scored.';
      else if (cov.age === null) messages.age = 'Outside 18 to 120, so css.py treats it as missing.';
      if (eduRaw === null) messages.edu = 'Missing: JLO and LNS cannot be scored.';
      else if (eduRaw < 0) messages.edu = 'Below 0. css.sql has no check here; check the entry.';
      const scores = {};
      MEASURES.forEach(function (m) {
        const v = readNum(m);
        const c = cleanScore(m, Number.isNaN(v) ? NaN : v);
        scores[m] = c.value;
        if (c.status === 'missing') messages[m] = 'Missing, so no z-score and no CSS.';
        else if (c.status === 'range') messages[m] = 'Outside the range in guide 4.2. The pipeline blanks such scores, so there is no CSS.';
        else if (c.status === 'invalid') messages[m] = 'Not a number.';
      });
      return { cov: cov, scores: scores, messages: messages, sexRaw: sexRaw };
    }
    function setHot(m, onOff) {
      const bg = svg.querySelector('.battery-rowbg[data-m="' + m + '"]');
      if (bg) bg.classList.toggle('is-hot', onOff);
      if (tableRows[m]) tableRows[m].classList.toggle('is-hot', onOff);
    }

    function render() {
      const r = readAll();
      const result = scoreCSS(r.cov, r.scores);
      lastResult = result; lastCov = r.cov;
      // messages
      ['age', 'edu'].concat(MEASURES).forEach(function (k) {
        const text = r.messages[k] || '';
        msgs[k].textContent = text;
        if (text && !/^Missing/.test(text)) inputs[k].setAttribute('aria-invalid', 'true');
        else inputs[k].removeAttribute('aria-invalid');
      });
      // badge
      badge.textContent = state.example ? 'Example values ' + state.example + ' (invented)' : 'Your values';
      btnA.setAttribute('aria-pressed', String(state.example === 'A'));
      btnB.setAttribute('aria-pressed', String(state.example === 'B'));
      // hero
      if (result.css !== null) {
        heroVal.textContent = fmtSigned(result.css, 2);
        heroVal.classList.remove('is-none');
        heroNote.textContent = 'Mean of six z-scores, each capped at ±3. Zero is the score expected for this age, sex and education in the robust-control norms; negative is below it.';
      } else {
        heroVal.textContent = 'No CSS';
        heroVal.classList.add('is-none');
        heroNote.textContent = 'css.sql needs all six z-scores to be finite; ' + result.nFinite + ' of 6 can be computed from these inputs.';
      }
      if (state.visit === 'baseline') {
        heroTag.textContent = 'Baseline: the setting the paper validated';
        heroTag.classList.remove('is-explore');
      } else {
        heroTag.textContent = 'Later visit: exploratory, and practice effects may inflate scores';
        heroTag.classList.add('is-explore');
      }
      drawChart(result);
      fillTable(result);
      fillArith(result, r.cov);
      fillPitfall(result, r);
    }

    function fillTable(result) {
      const byKey = {};
      result.rows.forEach(function (row) { byKey[row.measure] = row; });
      orderedKeys().forEach(function (m) {
        const row = byKey[m];
        const tr = tableRows[m];
        clear(tr);
        const zUsedCell = h('td', null, fmtSigned(row.zUsed, 2));
        if (row.capped) zUsedCell.appendChild(h('span', { class: 'battery-capnote' }, 'capped'));
        tr.appendChild(h('th', { scope: 'row', style: 'font-weight:500' }, TEST_BY_KEY[m].short));
        tr.appendChild(h('td', null, row.score === null ? 'n/a' : fmtIn(row.score)));
        tr.appendChild(h('td', null, fmt(row.expected, 2)));
        tr.appendChild(h('td', null, row.rmse.toFixed(2)));
        tr.appendChild(h('td', null, fmtSigned(row.z, 2)));
        tr.appendChild(zUsedCell);
      });
      cssCell.textContent = result.css === null ? 'n/a' : fmtSigned(result.css, 2);
    }

    function covText(v) { return isNum(v) ? fmtIn(v) : 'n/a'; }
    function fillArith(result, cov) {
      clear(arithList);
      result.rows.forEach(function (row) {
        const n = NORMS[row.measure];
        const bits = [fmt(n.intercept, 5)];
        function add(coef, valText) {
          if (coef === 0) return; // css.sql: CASE WHEN coef = 0 THEN 0
          bits.push((coef < 0 ? ' ' + MINUS + ' ' : ' + ') + fmtCoef(coef) + ' × ' + valText);
        }
        const ageT = n.age_center ? '(' + covText(cov.age) + ' ' + MINUS + ' ' + n.age_center + ')' : covText(cov.age);
        const eduT = n.edu_center ? '(' + covText(cov.education) + ' ' + MINUS + ' ' + n.edu_center + ')' : covText(cov.education);
        add(n.age_linear, ageT);
        add(n.age_quadratic, ageT + '²');
        add(n.sex_coef, covText(cov.sex));
        add(n.edu_linear, eduT);
        add(n.edu_quadratic, eduT + '²');
        let line = TEST_BY_KEY[row.measure].short + ': expected = ' + bits.join('') + ' = ' + fmt(row.expected, 5);
        if (row.z !== null) {
          line += '; z = (' + fmtIn(row.score) + ' ' + MINUS + ' ' + fmt(row.expected, 5) + ') ÷ ' + fmtCoef(n.rmse) + ' = ' + fmt(row.z, 5);
          if (row.capped) line += ', capped to ' + fmtSigned(row.zUsed, 0);
        } else {
          line += '; z = n/a';
        }
        arithList.appendChild(h('li', null, line));
      });
      if (result.css !== null) {
        const terms = result.rows.map(function (row) { return fmt(row.zUsed, 5); }).join(' + ').replace(/\+ −/g, '− ');
        arithList.appendChild(h('li', null, 'CSS = (' + terms + ') ÷ 6 = ' + fmt(result.css, 5)));
      } else {
        arithList.appendChild(h('li', null, 'CSS = n/a: fewer than six finite z-scores (HAVING count(*) = 6)'));
      }
    }

    function fillPitfall(result, r) {
      clear(pitfall);
      const jRow = result.rows.find(function (x) { return x.measure === 'jlo'; });
      if (jRow.score === null || jRow.expected === null) {
        pitfall.appendChild(h('b', null, 'Pitfall check. '));
        pitfall.appendChild(document.createTextNode(jRow.score === null
          ? 'Enter a JLO raw score to see what JLO_TOTCALC would do.'
          : 'JLO cannot be scored without age, sex and education, so this check is off.'));
        return;
      }
      const doubled = jRow.score * 2;
      const alt = scoreCSS(r.cov, Object.assign({}, r.scores, { jlo: doubled }));
      const altRow = alt.rows.find(function (x) { return x.measure === 'jlo'; });
      pitfall.appendChild(h('b', null, 'Pitfall check. '));
      let text = 'Entering JLO_TOTCALC (2 × ' + fmtIn(jRow.score) + ' = ' + fmtIn(doubled) + ') instead of JLO_TOTRAW gives z = ' + fmtSigned(altRow.z, 2) +
        (altRow.capped ? ', capped at ' + fmtSigned(altRow.zUsed, 0) : '');
      if (result.css !== null && alt.css !== null) text += ', and the CSS would read ' + fmtSigned(alt.css, 2) + ' instead of ' + fmtSigned(result.css, 2) + '.';
      else text += '.';
      pitfall.appendChild(document.createTextNode(text));
    }

    /* ---- chart ---- */
    function drawChart(result) {
      const W = Math.max(300, Math.floor(chartBox.getBoundingClientRect().width));
      const narrow = W < 520;
      const anyCapped = result.rows.some(function (x) { return x.capped; });
      const labelW = narrow ? 120 : 146;
      const valueW = anyCapped ? (narrow ? 96 : 112) : 62;
      const padT = 30, rowH = 34, axisH = 46;
      const plotL = labelW, plotR = W - valueW - 6, plotW = plotR - plotL;
      const D = 4.5;
      function x(z) { return plotL + (Math.max(-D, Math.min(D, z)) + D) / (2 * D) * plotW; }
      const keys = orderedKeys();
      const byKey = {};
      result.rows.forEach(function (row) { byKey[row.measure] = row; });
      const plotBottom = padT + rowH * keys.length;
      const H = plotBottom + axisH;
      clear(svg);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.setAttribute('width', W);
      svg.setAttribute('height', H);

      const gBg = S('g'), gGrid = S('g'), gBars = S('g'), gText = S('g'), gTop = S('g'), gHit = S('g');
      svg.appendChild(gBg); svg.appendChild(gGrid); svg.appendChild(gBars); svg.appendChild(gText); svg.appendChild(gTop); svg.appendChild(gHit);

      const labelStep = plotW < 300 ? 2 : 1;
      for (let t = -4; t <= 4; t++) {
        const gx = x(t);
        gGrid.appendChild(S('line', { class: t === 0 ? 'battery-zero' : 'battery-grid', x1: gx, x2: gx, y1: padT - 6, y2: plotBottom }));
        if (t % labelStep === 0 || Math.abs(t) === 3) {
          gText.appendChild(S('text', { class: 'battery-tick', x: gx, y: plotBottom + 17, 'text-anchor': 'middle' }, t === 0 ? '0' : fmtSigned(t, 0)));
        }
      }
      [-3, 3].forEach(function (c) {
        gGrid.appendChild(S('line', { class: 'battery-cap', x1: x(c), x2: x(c), y1: padT - 6, y2: plotBottom }));
      });
      gText.appendChild(S('text', { class: 'battery-axis-title', x: plotL + plotW / 2, y: plotBottom + 37, 'text-anchor': 'middle' },
        narrow ? 'z-score (0 = expected)' : 'z-score (0 = expected for this age, sex and education)'));
      gText.appendChild(S('text', { class: 'battery-axis-title', x: W - 2, y: padT - 12, 'text-anchor': 'end' }, 'z used'));

      keys.forEach(function (m, i) {
        const row = byKey[m];
        const t = TEST_BY_KEY[m];
        const y0 = padT + i * rowH, cy = y0 + rowH / 2;
        gBg.appendChild(S('rect', { class: 'battery-rowbg', 'data-m': m, x: 1, y: y0 + 1, width: W - 2, height: rowH - 2, rx: 5 }));
        gText.appendChild(S('text', { class: 'battery-rowlabel', x: labelW - 10, y: cy + 4.5, 'text-anchor': 'end', style: narrow ? 'font-size:12px' : null }, t.short));
        if (row.zUsed !== null) {
          const x0 = x(0), x1 = x(row.zUsed);
          if (t.lean === 'both') {
            gBars.appendChild(S('path', { class: 'battery-bar-d', d: barPath(x0, x1, cy - 8, 7, 3.5) }));
            gBars.appendChild(S('path', { class: 'battery-bar-s', d: barPath(x0, x1, cy + 1, 7, 3.5) }));
          } else {
            gBars.appendChild(S('path', { class: t.lean === 'd' ? 'battery-bar-d' : 'battery-bar-s', d: barPath(x0, x1, cy - 8, 16, 4) }));
          }
          if (row.capped) {
            const sgn = row.z < 0 ? -1 : 1;
            const ea = x(sgn * Z_CAP), eb = x(row.z);
            gBars.appendChild(S('rect', { class: 'battery-excess', x: Math.min(ea, eb), y: cy - 8, width: Math.max(1, Math.abs(eb - ea)), height: 16, rx: 2 }));
            if (Math.abs(row.z) > D) {
              const ex = x(sgn * D);
              gBars.appendChild(S('path', { class: 'battery-chev', d: sgn < 0
                ? 'M' + (ex - 1) + ',' + cy + 'l7,-6v12z' : 'M' + (ex + 1) + ',' + cy + 'l-7,-6v12z' }));
            }
          }
          const v = S('text', { class: 'battery-val', x: plotR + 10, y: cy + 4.5 }, fmtSigned(row.zUsed, 2));
          if (row.capped) v.appendChild(S('tspan', { class: 'battery-val-note', dx: 5 }, 'capped'));
          gText.appendChild(v);
        } else {
          gText.appendChild(S('text', { class: 'battery-notscored', x: x(0) + 8, y: cy + 4.5 }, 'not scored'));
          gText.appendChild(S('text', { class: 'battery-val', x: plotR + 10, y: cy + 4.5 }, 'n/a'));
        }
        const label = t.short + ': ' + (row.zUsed === null ? 'not scored' :
          'z used ' + fmtSigned(row.zUsed, 2) + (row.capped ? ', capped from ' + fmtSigned(row.z, 2) : '') +
          '; score ' + fmtIn(row.score) + ', expected ' + fmt(row.expected, 2));
        const hit = S('rect', { class: 'battery-hit', 'data-m': m, x: 0, y: y0, width: W, height: rowH, tabindex: '0', role: 'img', 'aria-label': label });
        on(hit, 'pointerenter', function () { showTip(m, i); });
        on(hit, 'pointerleave', function () { hideTip(m); });
        on(hit, 'focus', function () { showTip(m, i); const bg = svg.querySelector('.battery-rowbg[data-m="' + m + '"]'); if (bg) bg.classList.add('is-focus'); });
        on(hit, 'blur', function () { hideTip(m); const bg = svg.querySelector('.battery-rowbg[data-m="' + m + '"]'); if (bg) bg.classList.remove('is-focus'); });
        gHit.appendChild(hit);
      });

      if (result.css !== null) {
        const cx = x(result.css);
        gTop.appendChild(S('line', { class: 'battery-cssline', x1: cx, x2: cx, y1: padT - 6, y2: plotBottom }));
        const lx = Math.max(plotL + 34, Math.min(plotR - 34, cx));
        gTop.appendChild(S('text', { class: 'battery-csslabel', x: lx, y: padT - 12, 'text-anchor': 'middle', 'pointer-events': 'none' }, 'CSS ' + fmtSigned(result.css, 2)));
      }
      chartGeom = { x: x, padT: padT, rowH: rowH, W: W, keys: keys, byKey: byKey };
    }
    let chartGeom = null;

    function showTip(m, i) {
      if (!chartGeom) return;
      setHot(m, true);
      const row = chartGeom.byKey[m];
      const t = TEST_BY_KEY[m];
      clear(tip);
      if (row.zUsed === null) {
        tip.appendChild(h('div', null, h('strong', null, 'Not scored')));
        tip.appendChild(h('div', { class: 'battery-tip-name' }, t.short + ': a score or a needed covariate is missing.'));
      } else {
        tip.appendChild(h('div', null, h('strong', null, fmtSigned(row.zUsed, 2)), ' z used' + (row.capped ? ', capped from ' + fmtSigned(row.z, 2) : '')));
        tip.appendChild(h('div', { class: 'battery-tip-name' }, t.short + ': score ' + fmtIn(row.score) + ', expected ' + fmt(row.expected, 2) + ', RMSE ' + row.rmse.toFixed(2)));
      }
      tip.hidden = false;
      const cy = chartGeom.padT + i * chartGeom.rowH;
      const anchor = row.zUsed === null ? chartGeom.x(0) : chartGeom.x(row.zUsed);
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      const left = Math.max(0, Math.min(chartGeom.W - tw, anchor - tw / 2));
      let top = cy - th - 4;
      if (top < 0) top = cy + chartGeom.rowH + 4;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }
    function hideTip(m) { tip.hidden = true; setHot(m, false); }

    function schedule() {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; buildTableRowsIfOrderChanged(); render(); });
    }
    let tableOrder = orderedKeys().join();
    function buildTableRowsIfOrderChanged() {
      const now = orderedKeys().join();
      if (now !== tableOrder) { tableOrder = now; buildTableRows(); }
    }

    /* ---- width classes ---- */
    function applyWidth(w) {
      root.classList.toggle('battery-w1', w >= 760);
      root.classList.toggle('battery-w2', w >= 1100);
      root.classList.toggle('battery-w3', w >= 1400);
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
    setInputsFrom(EXAMPLES.A);
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
      },
      // for inspection in the harness
      get result() { return lastResult; },
      get covariates() { return lastCov; }
    };
  }

  X[NAME] = {
    title: 'The cognitive battery and the CSS',
    blurb: 'Read what each of the six tests and the MoCA asks of a participant, then score invented values with the published CSS norms.',
    mount: mount,
    // Pure functions and constants, exposed for unit tests (no extra globals).
    lib: {
      NORMS: NORMS, MEASURES: MEASURES, Z_CAP: Z_CAP, SCORE_RANGES: SCORE_RANGES, EXAMPLES: EXAMPLES, TESTS: TESTS, MOCA: MOCA,
      paperSexCode: paperSexCode, guardAge: guardAge, prepareCovariates: prepareCovariates, term: term,
      expectedScore: expectedScore, zScore: zScore, capZ: capZ, scoreCSS: scoreCSS, cleanScore: cleanScore,
      normSentence: normSentence, fmtSigned: fmtSigned, barPath: barPath
    }
  };
})();
