# PPMI atlas

`index.html` is a guide to the Parkinson's Progression Markers Initiative for anyone starting out: the study, the neuroscience, how each measurement is taken, the data and how to get it, processing by modality, the literature, the statistics, and working under the data use agreement. One research question runs through it as a worked example. The companion pane on the right holds interactive explorers built on simulated data; the page holds no PPMI participant data.

Open `index.html` in a browser. Videos and papers open in new tabs; to play them inside the page, serve the folder from the repository root and open http://localhost:8777:

```bash
python3 -m http.server 8777 --directory atlas
```

## Editing it

- `src/guide.html` is the text. Headings carry the ids that sections, cross-references and explorers use.
- `src/explorers/*.js` are the explorers; `src/CONTRACT.md` says how to write one.
- `src/template.html` and `src/tokens.css` are the page and its styles; `src/media.json` lists the talks and papers in the Watch tab.

Rebuild after any change, and run the explorer tests:

```bash
python3 atlas/src/build.py --report
node --test atlas/src/explorers/*.test.mjs
```

`--report` lists citations it could not link and headings without an explorer.
