# PPMI Atlas: explorer contract

The atlas is a single-page study workspace built for a wide monitor. The guide text is shown as two-page
spreads; on the right a companion pane mounts one interactive explorer at a time, chosen by the section
being read. Everything an explorer simulates is synthetic. The page holds no PPMI participant data.

## Files
- Explorer: `atlas/src/explorers/<name>.js`, one file per explorer, plain ES2020, no build step.
- Tests: `atlas/src/explorers/<name>.test.mjs`, run with `node --test atlas/src/explorers/`.
- Tokens: `atlas/src/tokens.css` (the page defines the same tokens).
- Test page: `atlas/src/harness.html?m=<name>&w=900&theme=light`, opened as a file:// URL.
- Register a new explorer in the list in `atlas/src/build.py`, then map it to sections in `EXPLORE`.

## Module shape
```js
(function () {
  const X = (window.PPMIExplorers = window.PPMIExplorers || {});
  X['<name>'] = {
    title: 'Short title',                 // pane header, at most 40 characters
    blurb: 'One sentence: what the reader can do here.',
    mount(el, ctx) { /* build into el */ return { destroy() { /* remove listeners, observers */ } }; }
  };
})();
```
- `el` is an empty block element. Its width is 560 to 1500 px and changes when the reader resizes panes:
  watch it with a ResizeObserver. Height is not fixed: lay out top to bottom; the pane scrolls.
- `ctx` = `{ synthetic: true, openSection(id) }`. `openSection(id)` asks the page to show a guide section
  (ids below). Optional.
- The only global you may create is the registration above. No external libraries, no network requests,
  no alert/confirm/prompt. localStorage is optional and must be wrapped in try/catch.
- Prefix every class and element id with `<name>-`. Inject at most one `<style id="style-<name>">`
  (check whether it exists first). Keep CSS specific to your root element.

## Look and feel
- Colours and type only through these CSS custom properties (they switch for dark mode automatically):
  `--bg --surface --surface-2 --fg --muted --rule --axis --grid --tint --accent --accent-2 --critical --good --warn --font-ui --font-body --font-mono`.
  `--accent` (blue) = the dopaminergic stage D and anything DaTScan. `--accent-2` (orange) = the structural
  stage S and anything MRI. `--critical` = loss or error. In SVG use `fill="var(--fg)"` style values.
  Never hard-code a hex colour.
- UI text in `--font-ui`; explanatory sentences may use `--font-body`. Text at least 12 px; chart labels
  12 to 13 px; numbers with `font-variant-numeric: tabular-nums`.
- Controls: native inputs (range, select, checkbox, radio, button) with visible labels, each with a unique
  id prefixed by the module name; `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`.
- Charts: SVG via document.createElementNS. Redraw on input inside requestAnimationFrame. Canvas only if
  you draw more than 2,000 marks; then read colours with getComputedStyle at draw time and redraw when
  `matchMedia('(prefers-color-scheme: dark)')` changes or `data-theme` on <html> changes.
- Randomness: a seeded PRNG (mulberry32) plus Box-Muller. Deterministic first render; a "New sample"
  button changes the seed.
- Every view of simulated data carries the small label "Simulated data for illustration, not PPMI data".
- At 560 px stack controls above charts; at 1100 px and wider, put controls beside charts or show small
  multiples.
- Respect prefers-reduced-motion. No emoji. Plain, short labels; a one-line "How to read this" above
  each chart. Write like a careful neuroscientist or statistician talking to a smart newcomer.

## Facts
- `atlas/src/guide.html` is the source of truth for facts, terms and notation. A fact that is not in the
  guide must be standard textbook knowledge; say "illustrative" for any made-up number or curve shape.

## Data rule
The PPMI data use agreement bans applying AI tools to individual-level PPMI data. Explorers never read
PPMI files; they simulate. If you build one with an AI assistant, give it the guide and this contract,
never the data folder, a DuckDB file or a notebook with outputs.

## Section ids for ctx.openSection
1-the-worked-example-at-a-glance, 23-visits-and-the-schedule, 24-imaging, 32-the-nigrostriatal-dopamine-system,
33-the-basal-ganglia-circuits, 34-beyond-dopamine, 35-why-cognition-declines-the-dual-syndrome-hypothesis,
42-the-six-cognitive-tests, 43-datscan-spect, 44-structural-mri, 46-properties-of-these-measures-that-matter-for-modelling,
61-cognition, 62-datscan, 63-structural-mri, 64-putting-the-modalities-on-one-timeline,
102-longitudinal-data-and-mixed-effects-models, 103-latent-variable-models,
104-disease-progression-models, 105-model-comparison-and-validation, 113-validation-hygiene

## Checks before you finish
1. `node --check atlas/src/explorers/<name>.js` and `node --test atlas/src/explorers/`.
2. Open the harness at w=600 and w=1300, light and dark, and fix what looks wrong.
3. Rebuild with `python3 atlas/src/build.py --report` and check that no heading lacks an explorer.
