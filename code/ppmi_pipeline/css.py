"""Create per-visit CSS using fixed reference coefficients or a local reference fit."""

from pathlib import Path


PROJECT = Path(__file__).resolve().parent
REFERENCE_NORMS = PROJECT / "css_reference_norms.csv"
MEASURES = ("hvlt_immediate", "hvlt_delayed", "jlo", "lns", "sdmt", "semantic")
NORM_COLUMNS = (
    "intercept", "age_center", "age_linear", "age_quadratic", "sex_coef",
    "edu_center", "edu_linear", "edu_quadratic", "rmse",
)


def _css_covariates(conn):
    # IDA Demographics codes female as 0 and male as 1. The reference models use 2 and 1.
    conn.execute("""
        CREATE OR REPLACE TEMP VIEW css_covariates AS
        SELECT patient_id, event_id, education_years,
               CASE WHEN age_years BETWEEN 18 AND 120 THEN age_years END AS age_years,
               CASE
                   WHEN lower(sex_code) IN ('m', 'male') OR try_cast(sex_code AS DOUBLE) = 1 THEN 1
                   WHEN lower(sex_code) IN ('f', 'female') OR try_cast(sex_code AS DOUBLE) = 0 THEN 2
               END AS sex
        FROM visits JOIN patients USING (patient_id)
    """)


def _fit_norms(conn, reference_ids_path):
    import numpy as np
    import statsmodels.api as sm

    reference = conn.execute("""
        WITH ids AS (
            SELECT DISTINCT regexp_replace(trim(patient_id), '^([0-9]+)\\.0+$', '\\1') AS patient_id
            FROM read_csv(?, header = true, all_varchar = true)
        )
        SELECT age_years, education_years, sex, hvlt_immediate, hvlt_delayed, jlo, lns, sdmt, semantic
        FROM ids JOIN css_covariates USING (patient_id)
        JOIN cognition_by_visit USING (patient_id, event_id)
        WHERE event_id = 'BL' AND age_years IS NOT NULL AND education_years IS NOT NULL AND sex IS NOT NULL
        ORDER BY patient_id
    """, [str(Path(reference_ids_path).expanduser().resolve())]).df()
    if reference.empty:
        raise ValueError("No baseline reference participants have the required demographics and cognitive records.")

    age_center = reference["age_years"].mean()
    edu_center = reference["education_years"].mean()
    design = reference.assign(intercept=1.0, age_linear=reference["age_years"] - age_center,
                              edu_linear=reference["education_years"] - edu_center, sex_coef=reference["sex"])
    design["age_quadratic"] = design["age_linear"] ** 2
    design["edu_quadratic"] = design["edu_linear"] ** 2
    terms = ["intercept", "age_linear", "age_quadratic", "sex_coef", "edu_linear", "edu_quadratic"]
    quadratic_for = {"age_linear": "age_quadratic", "edu_linear": "edu_quadratic"}
    fits = []
    for measure in MEASURES:
        sample = design.loc[design[measure].notna()]
        included = terms.copy()
        if len(sample) <= len(included) or np.linalg.matrix_rank(sample[included]) < len(included):
            raise ValueError(f"The baseline reference sample for {measure} cannot estimate the full model.")
        while True:
            model = sm.OLS(sample[measure].astype(float), sample[included]).fit()
            # Retain the linear term whenever the corresponding quadratic is present.
            removable = [term for term in included[1:] if quadratic_for.get(term) not in included]
            if not removable or model.pvalues[removable].max() <= 0.10:
                break
            included.remove(model.pvalues[removable].idxmax())
        fit = model.params.reindex(terms, fill_value=0).to_dict()
        fit.update(measure=measure, age_center=age_center, edu_center=edu_center, rmse=np.sqrt(model.mse_resid))
        fits.append([fit[column] for column in ("measure", *NORM_COLUMNS)])

    conn.execute("CREATE OR REPLACE TEMP TABLE css_norms (measure VARCHAR, "
                 + ", ".join(f"{column} DOUBLE" for column in NORM_COLUMNS) + ")")
    placeholders = ", ".join("?" for _ in range(len(NORM_COLUMNS) + 1))
    conn.executemany(f"INSERT INTO css_norms VALUES ({placeholders})", fits)


def _load_norms(conn, norms_path):
    norms_path = Path(norms_path).expanduser().resolve()
    casts = ", ".join(f"try_cast({col} AS DOUBLE) AS {col}" for col in NORM_COLUMNS)
    conn.execute(f"""
        CREATE OR REPLACE TEMP TABLE css_norms AS
        SELECT lower(trim(measure)) AS measure, {casts}
        FROM read_csv(?, header = true, all_varchar = true)
    """, [str(norms_path)])


def add_css_view(conn, norms_path=None, *, reference_ids_path=None, include_t1_acquisitions=False):
    """Score dual-imaging participants with either supplied or locally fitted norms."""
    if (norms_path is None) == (reference_ids_path is None):
        raise ValueError("Choose one CSS reference source: a coefficient CSV or a healthy control ID CSV.")
    _css_covariates(conn)
    if norms_path is not None:
        _load_norms(conn, norms_path)
    else:
        _fit_norms(conn, reference_ids_path)
    actual = [row[0] for row in conn.execute("SELECT measure FROM css_norms").fetchall()]
    if len(actual) != len(MEASURES) or set(actual) != set(MEASURES):
        raise ValueError(f"The CSS norms must contain one row for each measure: {', '.join(MEASURES)}")
    valid = " AND ".join(f"coalesce(isfinite({col}), false)" for col in NORM_COLUMNS)
    if conn.execute(f"SELECT count(*) FROM css_norms WHERE rmse <= 0 OR NOT ({valid})").fetchone()[0]:
        raise ValueError("CSS norms require finite numeric inputs and a positive residual RMSE for each measure.")
    if include_t1_acquisitions:
        conn.execute("""
            CREATE OR REPLACE TEMP VIEW css_imaging_participants AS
            SELECT patient_id FROM participant_lists
            WHERE n_datscan_records > 0 AND (has_t1_acquisition OR n_grey_matter_volume_records > 0)
        """)
    else:
        conn.execute("""
            CREATE OR REPLACE TEMP VIEW css_imaging_participants AS
            SELECT patient_id FROM cohort_both_imaging
        """)
    query = (PROJECT / "css.sql").read_text(encoding="utf-8")
    conn.execute(f"CREATE OR REPLACE TEMP VIEW css_scores AS {query}")
