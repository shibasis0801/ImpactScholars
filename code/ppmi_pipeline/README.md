# The clean layer

This package turns PPMI study tables from LONI IDA into typed, deduplicated DuckDB tables, coverage views and cohort lists. `data.PPMI()` builds it into the `clean` schema of the same connection as the raw tables, so most people never call it directly:

```python
import sys; sys.path.append("code")
import data
p = data.PPMI()
p.sql("SELECT * FROM clean.availability_summary")
```

`notebooks/schema.ipynb` draws how each clean table is built from the raw tables, read from [schema.sql](schema.sql) and [views.sql](views.sql). [queries.sql](queries.sql) has standalone examples.

The PPMI data use agreement prohibits applying AI tools to individual-level PPMI data. Keep participant-level CSVs, DuckDB files, charts and notebook outputs out of version control and away from AI tools. [PPMI Data Use Agreement](https://www.ppmi-info.org/sites/default/files/docs/ppmi-data-use-agreement.pdf)

## Input files

The loader finds tables by file name, ignoring punctuation and case and accepting IDA's release suffix such as `_10Nov2026`. `data.PPMI()` passes it the newest download of each table. A missing table produces a `missing` entry in `clean.source_manifest` and leaves its clean tables empty; a table with missing required headers stops the build. [IDA study data](https://ida.loni.usc.edu/pages/access/studyData.jsp?project=PPMI), [PPMI Data Dictionary and Code List](https://www.ppmi-info.org/access-data-specimens/guidance-resources)

| Input | File stems or IDA label | Main fields |
| --- | --- | --- |
| Enrollment | `Participant_Status` | `PATNO`, `COHORT_DEFINITION`, enrollment status, age, and month when supplied |
| Demographics | `Demographics` | `PATNO`, `SEX`, `HANDED`, `LAST_UPDATE` when supplied |
| Education | `Socio_Economics` | `PATNO`, `EDUCYRS`, optional assessment and update timestamps |
| Visit age | `Age_at_Visit` | `PATNO`, `EVENT_ID`, `AGE_AT_VISIT` or `AGE`, optional `INFODT` |
| Motor exam | `MDS-UPDRS_Part_III` | `NP3TOT`, `NHY`, `PDSTATE`, `REC_ID`, `INFODT` |
| Cognitive screen | `Montreal_Cognitive_Assessment_(MoCA)` | `MCATOT`, `REC_ID`, `INFODT` |
| Six cognitive scores | `Hopkins_Verbal_Learning_Test_Revised`, `Benton_Judgement_of_Line_Orientation`, `Letter_Number_Sequencing`, `Symbol_Digit_Modalities_Test`, `Modified_Semantic_Fluency` | `HVLTRT1` + `HVLTRT2` + `HVLTRT3`, `HVLTRDLY`, `JLO_TOTRAW`, `LNS_TOTRAW`, `SDMTOTAL`, `VLTANIM` |
| DaTScan SBRs | `Xing_Core_Lab_-_Quant_SBR` and optional `DaTScan_SBR_Analysis` | `DATSCAN_DATE`, four regional SBRs, analyzed status and ligand when supplied |
| Structural MRI | `Grey_Matter_Volume` | `IMAGEID`, `MRIDATE`, `GM_VOLUME`, optional `UNITS` |
| MRI acquisition | `Xing_Core_Lab_-_MRI_acquisition_metadata` | `PATNO`, `EVENT_ID`, `MRI_SCAN_DATE`, `MRI_SEQ_T1_WEIGHTED`, `MRI_IMAGE_ACCEPTABLE` |

## Cleaning rules

The cognitive columns are raw scores. Immediate recall requires three valid trials. Delayed recall, JLO, LNS and SDMT use their raw integer scales, and Semantic is the count of animals named. Invalid values become `NULL`. The build keeps distinct normalized cognitive records and uses the latest valid score per visit and measure for scoring, using the update timestamp to break ties on assessment date. Unresolved score ties stay blank. Participant lists count a measure if any valid score was recorded. Visits keep all age observations in `age_at_visit` and report a single age only where the reported ages agree.

Assessments are identified by `PATNO` and `EVENT_ID` or `CLINICAL_EVENT`. The loader trims each `PATNO` and stores a whole number written with a decimal, such as `3001.0`, as `3001`, so one participant keeps one ID across tables. Other spellings, such as a leading zero, are kept as written. Scan rows with a participant ID are kept even if their visit code is blank. Dates are stored at month precision, so a stored day of `01` is a month marker. Study schedules vary by cohort, and one visit can hold measurements from different months. [PPMI Data User Guide](https://www.ppmi-info.org/sites/default/files/docs/PPMI%20Data%20User%20Guide.pdf)

DaTScan coverage uses eligible scans with at least one finite regional SBR. Xing uses the cerebral white matter reference and archived Invicro the occipital reference; both methods are labeled and kept as separate series. A scan is excluded only when its ligand names another tracer or its analyzed flag is negative (`No`, `N`, `False`, `0`, or text starting with `Not`). A blank ligand or analyzed flag is kept, for compatibility with older PPMI rows. Grey matter volume coverage uses positive finite values, and `volume_unit` stays blank when the source gives no unit. These are exported quantitative measures; nothing here processes DICOM or NIfTI images. [MJFF PIE DaTScan source mapping](https://github.com/MJFF-ResearchCommunity/PIE/blob/main/pie/imaging/labels.py)

## Tables and views

| Table or view | Grain and use |
| --- | --- |
| `dataset_info`, `source_manifest` | Build origin and input inventory |
| `patients` | One row per `patient_id`, with enrollment and demographics where available |
| `visits` | One row per `patient_id, event_id`, with age and the range of observed source months |
| `age_at_visit` | Distinct normalized visit age observations, including disagreements within an event |
| `neurological_exams` | One row per distinct MDS-UPDRS III or MoCA record, with exam and medication state where applicable |
| `cognitive_assessment_records` | Distinct normalized score records, including repeat assessments within an event |
| `cognitive_assessments` | One row per `patient_id, event_id, measure`, with score, test version when available, and assessment month |
| `cognition_by_visit` | Six raw scores across columns, with `scores_present` and `complete_six` |
| `datscan_scans`, `structural_scans` | Scan measurements by participant, with dates, provenance, and available image IDs |
| `mri_acquisitions` | MRI acquisition records, including the T1 flag and image acceptability code when present |
| `participant_lists` | One row per participant with cognitive coverage, DaTScan SBR coverage, and separate T1 acquisition and grey matter volume fields |
| `visit_coverage`, `patient_coverage` | Modality coverage at every recorded event and for every participant, with usable scan date ranges and repeat counts |
| `availability_summary` | Participant counts by data availability, including modality overlap and longitudinal coverage |
| `cohort_six_tests` | Participants with at least one event containing all six valid cognitive scores |
| `cohort_datscan`, `cohort_structural` | Participants with at least one usable measurement for the respective modality |
| `cohort_both_imaging` | Participants with at least one usable measurement from each imaging modality anywhere in their record |
| `cohort_all_three` | Participants in all three cohorts. Use `n_same_event_all_visits` when the analysis requires shared events. |
| `longitudinal_patients`, `longitudinal_datscan`, `longitudinal_structural` | Usable scans at every available visit for up to two selected participants per modality |

## Cognitive Summary Score

[css.py](css.py) scores the CSS of Weintraub et al. for participants with both kinds of imaging. It loads `css_reference_norms.csv`, transcribed from the paper's Supplementary Table 1 with the reported coefficient and residual RMSE precision; the retained models use age and education in their original units, so the CSV uses zero centers. IDA codes `SEX` 0 and 1 map to the study's codes 2 and 1. CSS needs all six scores and the demographics used by their models, and the study evaluated it at baseline only, so treat later visits as exploratory. [Weintraub et al.](https://doi.org/10.1002/mds.30111) · [Supplementary Table 1](https://www.medrxiv.org/content/10.1101/2024.07.08.24310076v1.full.pdf)

```python
from ppmi_pipeline import css
p.db.execute("USE clean")
css.add_css_view(p.db, css.PROJECT / "css_reference_norms.csv")
scores = p.sql("SELECT * FROM css_scores")
p.db.execute("USE memory")
```

## A dated copy on disk

`python code/data.py --export ~/ppmi/ppmi-2026-11-18.duckdb` saves the raw tables and the clean layer to one DuckDB file. For CSV exports of the clean layer, run the build from `code/`, giving it folders that hold one download of each table:

```bash
python -m ppmi_pipeline.pipeline build --input ~/ppmi/study --output ~/ppmi/builds/2026-11-18 --release 10Nov2026
```

It writes `ppmi.duckdb`, one CSV for each of the four cohorts, and CSVs for patients, visits, neurological exams, cognitive scores by visit, all supplied scan records, participant and visit coverage, and source availability. A cohort with no members has a header-only CSV. With `altair` and `vl-convert-python` installed it also saves HTML charts of coverage and of up to two longitudinal participants per imaging modality. The output folder must be new and outside the repository, and the build stops if an input folder holds two downloads of the same table.
