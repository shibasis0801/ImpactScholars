# One or two progression dimensions in early Parkinson's disease

A starting point for research with the Parkinson's Progression Markers Initiative (PPMI). It holds code that files your IDA downloads and puts every table behind one SQL interface, notebooks that show what data exists and how the tables relate, a guide to the study and the science (the PPMI atlas), and a preliminary data audit for one research question, set out below.

New to PPMI or to this code? [Getting started](#getting-started) goes from a fresh clone to SQL over your own download, and the [PPMI atlas](#the-atlas) explains the study, the science and the data.

## Question

Can repeated cognitive, dopaminergic and structural measurements in early Parkinson's disease be represented by one latent disease stage? Or do they need two correlated progression dimensions within the same person?

In the two-dimensional model, a dopaminergic dimension D is anchored by DaTscan specific-binding ratios in the left and right caudate and putamen. A structural dimension S is anchored or validated by grey-matter measures from T1-weighted MRI, provided the structural data pass quality checks.

- **Primary hypothesis.** A model with D and S predicts later, unseen measurements better than a one-dimensional model.
- **Secondary hypothesis.** If two dimensions are supported, the six tests of the PPMI Cognitive Summary Score (CSS) relate differently to D and S. No test is assigned to a dimension in advance, and two statistical dimensions are not automatically read as two biological mechanisms.

## Why

The CSS averages six robustly normed tests: HVLT-R immediate and delayed recall, Judgement of Line Orientation, Letter-Number Sequencing, the Symbol Digit Modalities Test and semantic fluency (Weintraub et al., 2025). It separates newly diagnosed Parkinson's disease from healthy controls well at baseline, but an average can hide change in one domain behind stability in another. The tests also behave differently over time. Turner et al. (2023) found little disease-specific decline outside Letter-Number Sequencing. Practice effects themselves predict later outcomes (Avila Pérez et al., 2025). The six tests fit a single latent factor poorly (González et al., 2025).

## Preliminary audit

`notebooks/audit.ipynb` checks whether PPMI can support the question. It covers which imaging modalities are longitudinal, which processed MRI measures repeat over visits, the grey-matter-volume cohort and how much complete cognition it has at the same visits, how far that cohort overlaps with longitudinal DaTscan, and how many participants contribute repeated measurements to each domain. It also scores all six tests against the published robust norms and computes the Cognitive Summary Score.

Run on downloads from September to November 2026, it found:

| Participants with repeated measurements | N |
|---|---|
| Complete six-test cognition | 1,112 |
| DaTscan | 865 |
| Processed grey-matter volume (GMV) | 137 |
| All three domains | 82 |

- DaTscan is concentrated at screening and months 12, 24 and 48, and processed GMV at baseline and months 24 and 48. The analysis therefore uses actual scan and assessment dates rather than assuming nominal visits line up.
- **SPECT** was the most longitudinal imaging modality: 1,133 participants had it at two or more of its main visits, 859 at three and 349 at all four. **Diffusion MRI** followed with 442, 249 and 91, and **T1 MRI** with about 327, 207 and 92.
- Of 136 participants with GMV and complete cognition at two or more visits, 132 also had DaTscan at two or more visits.

## Plan

| Months | Work |
|---|---|
| 1–2 | Finalise inclusion criteria, reproduce the published CSS, and check structural MRI quality and missing data |
| 3–4 | Fit the one- and two-stage models, compare prediction on held-out participants, and run the planned sensitivity analyses |
| 5 | Compare with the CSS and simpler imaging summaries, and test prediction of later motor and cognitive-functional outcomes |
| 6 | Robustness checks, figures, reproducible code and a short paper |

## Repository

```
atlas/index.html          the PPMI atlas: the study, the science, the data and the methods
atlas/src/                its sources; python3 atlas/src/build.py rebuilds it
code/catalog.csv          every kind of data IDA offers, with format, keys and file name
code/data.py              loads your IDA downloads into one DuckDB connection
code/ida.py               opens IDA, files your downloads, fetches image collections
code/ppmi_pipeline/       the clean layer: typed tables, coverage views and cohort lists
code/plot.py              figures for the notebooks
notebooks/atlas.ipynb     fetches the whole data set from IDA, step by step, and checks it
notebooks/dataset.ipynb   what data exists, what you have, and how to get the rest
notebooks/schema.ipynb    how the tables relate: keys, shared participants, visits, lineage
notebooks/data.ipynb      what to download from IDA, and the data explained
notebooks/audit.ipynb     the preliminary data audit
literature/               open-access papers cited below
```

## Getting started

PPMI data are not in this repository. Apply for access at [ppmi-info.org](https://www.ppmi-info.org/access-data-specimens/download-data) and accept the data use agreement; everyone who works with participant-level data needs their own approval.

1. **Install**, with Python 3.10 or newer:

   ```bash
   git clone https://github.com/shibasis0801/ImpactScholars.git
   cd ImpactScholars
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   ```

2. **See what exists.** Open `notebooks/dataset.ipynb` with `.venv/bin/jupyter lab notebooks/dataset.ipynb`. It lists everything IDA offers from `code/catalog.csv`, marks what this project uses, and compares that with what you have downloaded.

3. **Download.** Run `notebooks/atlas.ipynb` on your own machine. It lists every file the project uses, opens the right IDA page for each step, waits while you tick and download there, then files and checks what arrived. Run it again at any time: it asks only for what is still missing. IDA has no programming interface for study data, so the ticking happens in the browser. Underneath, `ida.collect()` files the downloads from your Downloads folder into the data folder, and `ida.fetch("urls.txt")` downloads an image collection from IDA's *Advanced Download* URL list.

4. **Query.** `data.PPMI()` loads everything into one DuckDB connection:

   ```python
   import sys; sys.path.append("code")
   import data
   p = data.PPMI()
   p.sql("SELECT COHORT_DEFINITION, count(*) AS participants FROM participant_status GROUP BY ALL")
   p.sql("SELECT * FROM clean.availability_summary")
   ```

   or from a shell:

   ```bash
   .venv/bin/python code/data.py                                    # what is loaded
   .venv/bin/python code/data.py "SELECT count(*) FROM clean.patients"
   .venv/bin/python code/data.py --export ~/ppmi/ppmi.duckdb        # both layers in one file, for any SQL client
   ```

5. **Map it.** `notebooks/schema.ipynb` shows how the tables join, which participants and visits they share, and how the clean layer is built from the raw tables.

### Where the data lives

Downloads stay outside the repository, in `~/ppmi` or the folder named by `PPMI_DATA`:

```
~/ppmi/
  study/       study-data CSVs as IDA names them, such as Participant_Status_10Nov2026.csv,
               and the Curated Data Cut workbook
  imaging/     image-search exports (idaSearch_*.csv)
  images/      unpacked DICOM and NIfTI files
  docs/        PDFs that came in a zip of study tables, such as the LEDD method
  downloads/   the original zips, and image collections fetched from a URL list
```

`ida.collect()` reads your Downloads folder, or the folder named by `IDA_DOWNLOADS`.

### The SQL interface

One in-memory DuckDB connection holds two layers. Nothing is written to disk unless you export it.

| Layer | What it holds |
|---|---|
| raw | Every downloaded table as IDA ships it, named after its file in lower case: `Letter_-_Number_Sequencing_10Nov2026.csv` becomes `letter_number_sequencing`, and the newest download of a table wins. Columns are text; the macros `num(x)`, `ppmi_date(x)` and `visit(event)` convert them. Also `images` (image searches), `image_files` (downloaded scans), `catalog`, and the `cognition` view, which stacks the six cognitive tests. |
| `clean` | Typed, deduplicated tables from `code/ppmi_pipeline`, keyed by `patient_id` and `event_id`: `clean.patients`, `clean.visits`, `clean.cognitive_assessments`, `clean.datscan_scans`, `clean.structural_scans`, coverage views and cohort lists. See [its README](code/ppmi_pipeline/README.md). |

`p.tables()` lists the tables and `p.schema()` every column in both layers.

### The atlas

`atlas/index.html` is a guide to PPMI for anyone starting out: the study, the neuroscience, how each measurement is taken, the data (its section 5 goes with `atlas.ipynb` and `dataset.ipynb`), the literature, the statistics and working under the data use agreement, with interactive explorers. Open it in a browser, or serve it so that its videos and papers open inside the page:

```bash
python3 -m http.server 8777 --directory atlas
```

Then open http://localhost:8777.

### Data rules

The PPMI data use agreement does not allow participant-level data to be shared, and it forbids applying AI tools to individual-level PPMI data. Keep raw data, participant identifiers and individual results out of version control.

The notebooks include reviewed aggregate tables and static plots so their results are visible on GitHub. Preserve these outputs when committing. To refresh them, run the notebooks locally with authorised data access, review the outputs for participant-level information, and save the notebooks before committing and pushing. GitHub displays the saved results; it does not execute cells or refresh results when the code or downloads change.

If setup warns that image-search exports were skipped because required columns are missing, empty imaging tables and plots mean coverage is unavailable from those exports, rather than that PPMI has no images. The historical counts in the narrative may differ from a newer saved run.

## Data and references

Data used in the preparation of this work were obtained between September and November 2026 from the Parkinson's Progression Markers Initiative (PPMI) database ([www.ppmi-info.org/access-data-specimens/download-data](https://www.ppmi-info.org/access-data-specimens/download-data)), RRID:SCR_006431. For up-to-date information on the study, visit [www.ppmi-info.org](https://www.ppmi-info.org). PPMI, a public-private partnership, is funded by the Michael J. Fox Foundation for Parkinson's Research and funding partners.

Papers marked PDF are in `literature/`.

- Avila Pérez, S., Koppelmans, V., Duff, K. M., & Ruitenberg, M. F. L. (2025). One-year practice effects predict long-term cognitive outcomes in Parkinson's disease. *Journal of Parkinson's Disease, 15*(4), 858–867. [10.1177/1877718X251339585](https://doi.org/10.1177/1877718X251339585) (PDF)
- Caspell-Garcia, C., Simuni, T., Tosun-Turgut, D., et al. (2017). Multiple modality biomarker prediction of cognitive impairment in prospectively followed de novo Parkinson disease. *PLOS ONE, 12*(5), e0175674. [10.1371/journal.pone.0175674](https://doi.org/10.1371/journal.pone.0175674) (PDF)
- González, D. A., Karstens, A. J., Patel, S. E. S., Fleisher, J. E., & Goetz, C. G. (2025). The Parkinson's disease cognitive composite: Lessons forgotten from preclinical Alzheimer's cognitive composites. *Movement Disorders, 40*(7), 1442–1443. [10.1002/mds.30246](https://doi.org/10.1002/mds.30246) (PDF)
- Iddi, S., Li, D., Aisen, P. S., et al. (2018). Estimating the evolution of disease in the Parkinson's Progression Markers Initiative. *Neurodegenerative Diseases, 18*(4), 173–190. [10.1159/000488780](https://doi.org/10.1159/000488780)
- Marek, K., Jennings, D., Lasch, S., et al. (2011). The Parkinson Progression Marker Initiative (PPMI). *Progress in Neurobiology, 95*(4), 629–635. [10.1016/j.pneurobio.2011.09.005](https://doi.org/10.1016/j.pneurobio.2011.09.005)
- Turner, T. H., Lench, D. H., Adams, R., Wilson, S., Marsicano, C., & Rodriguez-Porcel, F. (2023). Are standardized tests sensitive to early cognitive change in Parkinson's disease? *Psychopharmacology Bulletin, 53*(1), 19–29. [10.64719/pb.4458](https://doi.org/10.64719/pb.4458)
- Weintraub, D., Brumm, M. C., Kurth, R., York, M. K., & Parkinson's Progression Markers Initiative. (2025). Use of robust norming to create a sensitive cognitive summary score in de novo Parkinson's disease: An illustrative example. *Movement Disorders, 40*(3), 468–477. [10.1002/mds.30111](https://doi.org/10.1002/mds.30111) (PDF)
- Wen, C., Xing, Y., Zhou, H., et al. (2026). Cognitive trajectories in early Parkinson's disease: A multimodal MRI study of brain structure and cognitive decline. *Neurobiology of Disease, 225*, 107407. [10.1016/j.nbd.2026.107407](https://doi.org/10.1016/j.nbd.2026.107407) (PDF)
