# One or two progression dimensions in early Parkinson's disease

A project in the Neuromatch Impact Scholars Program (2026) that I work on with Shibasis Patnaik and Tomoya Kubota as group NeuroNexus. It uses the Parkinson's Progression Markers Initiative (PPMI) and runs for six months from November 2026. This repository holds the data pipeline and the preliminary data audit behind our proposal.

## Question

Can repeated cognitive, dopaminergic and structural measurements in early Parkinson's disease be represented by one latent disease stage? Or do they need two correlated progression dimensions within the same person?

In the two-dimensional model, a dopaminergic dimension D is anchored by DaTscan specific-binding ratios in the left and right caudate and putamen. A structural dimension S is anchored or validated by grey-matter measures from T1-weighted MRI, provided the structural data pass quality checks.

- **Primary hypothesis.** A model with D and S predicts later, unseen measurements better than a one-dimensional model.
- **Secondary hypothesis.** If two dimensions are supported, the six tests of the PPMI Cognitive Summary Score (CSS) relate differently to D and S. No test is assigned to a dimension in advance, and two statistical dimensions are not automatically read as two biological mechanisms.

## Why

The CSS averages six robustly normed tests: HVLT-R immediate and delayed recall, Judgement of Line Orientation, Letter-Number Sequencing, the Symbol Digit Modalities Test and semantic fluency (Weintraub et al., 2025). It separates newly diagnosed Parkinson's disease from healthy controls well at baseline, but an average can hide change in one domain behind stability in another. The tests also behave differently over time. Turner et al. (2023) found little disease-specific decline outside Letter-Number Sequencing. Practice effects themselves predict later outcomes (Avila Pérez et al., 2025). The six tests fit a single latent factor poorly (González et al., 2025).

## My part

- **Data extraction.** I worked out which PPMI study tables and IDA image searches the project needs, and `notebooks/data.ipynb` says exactly what to download. `code/data.py` loads them into DuckDB, following the PPMI database Shibasis Patnaik set up for our group.
- **Feasibility audit.** `notebooks/audit.ipynb` covers:
  - which imaging modalities are longitudinal;
  - which processed MRI measures repeat over visits;
  - the grey-matter-volume cohort, and how much complete cognition it has at the same visits;
  - how far that cohort overlaps with longitudinal DaTscan;
  - the participant counts in our proposal.
- **Cognitive Summary Score.** The audit scores all six tests against the published robust norms and computes the CSS.
- **Proposal and presentation.** I prepared the data and feasibility results in our proposal and presentation (`slides.pdf`).

## Preliminary audit

From our downloads of September to November 2026:

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
| 6 | Robustness checks, figures, reproducible code and the Neuromatch micropublication |

## Repository

```
code/data.py            IDA downloads to DuckDB
code/plot.py            figures for the notebooks
notebooks/data.ipynb    what to download from IDA, and the data explained
notebooks/audit.ipynb   the preliminary data audit
literature/             open-access papers we build on
slides.pdf              our project presentation
```

## Running it

PPMI data are not in this repository. Apply for access at [ppmi-info.org](https://www.ppmi-info.org/access-data-specimens/download-data). Then follow `notebooks/data.ipynb` to download the study tables and image searches into `~/ppmi`, or set `PPMI_DATA` to use another folder. With Python 3.10 or newer:

```bash
pip install duckdb jupyterlab matplotlib numpy pandas
cd notebooks
jupyter lab
```

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
