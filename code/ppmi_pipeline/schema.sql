-- Run against the raw_* staging tables created by sources.py.
CREATE MACRO clean_text(x) AS (
    CASE WHEN upper(trim(x)) NOT IN ('', 'NA', 'N/A', 'NULL', 'NAN') THEN trim(x) END
);
-- One spelling per participant: IDA exports can write the same PATNO as 3001 or 3001.0.
CREATE MACRO participant_id(x) AS regexp_replace(clean_text(x), '^([0-9]+)\.0+$', '\1');
CREATE MACRO event_code(x) AS upper(clean_text(x));
CREATE MACRO date_value(x) AS coalesce(
    try_cast(clean_text(x) AS TIMESTAMP),
    try_strptime(clean_text(x), ['%m/%Y', '%Y-%m', '%m/%d/%Y', '%d-%b-%Y'])
);
CREATE MACRO month_value(x) AS (
    CASE WHEN year(date_value(x)) BETWEEN 1900 AND 2099
         THEN date_trunc('month', date_value(x))::DATE END
);
CREATE MACRO number_value(x) AS (
    CASE WHEN isfinite(try_cast(clean_text(x) AS DOUBLE)) THEN try_cast(x AS DOUBLE) END
);
CREATE MACRO integer_score(x, lo, hi) AS (
    CASE WHEN number_value(x) BETWEEN lo AND hi AND trunc(number_value(x)) = number_value(x)
         THEN number_value(x)::INTEGER END
);

CREATE TEMP TABLE participant_status AS
SELECT DISTINCT participant_id(patno) AS patient_id, clean_text(cohort_definition) AS cohort,
       clean_text(enroll_status) AS enrollment_status, number_value(enroll_age) AS enrollment_age,
       month_value(enroll_date) AS enrollment_month
FROM raw_status WHERE participant_id(patno) IS NOT NULL;

CREATE TEMP TABLE demographics AS
SELECT DISTINCT participant_id(patno) AS patient_id, clean_text(sex) AS sex_code, clean_text(handed) AS handedness_code
FROM raw_demographics WHERE participant_id(patno) IS NOT NULL
QUALIFY dense_rank() OVER (PARTITION BY participant_id(patno) ORDER BY date_value(last_update) DESC NULLS LAST) = 1;

CREATE TEMP TABLE education AS
SELECT DISTINCT participant_id(patno) AS patient_id, number_value(educyrs) AS education_years
FROM raw_education
WHERE participant_id(patno) IS NOT NULL AND number_value(educyrs) BETWEEN 0 AND 40
QUALIFY dense_rank() OVER (
    PARTITION BY participant_id(patno) ORDER BY date_value(infodt) DESC NULLS LAST, date_value(last_update) DESC NULLS LAST
) = 1;

CREATE TABLE age_at_visit AS
SELECT DISTINCT participant_id(patno) AS patient_id, event_code(event_id) AS event_id,
       number_value(age_at_visit) AS age_years, month_value(infodt) AS visit_month
FROM raw_age WHERE participant_id(patno) IS NOT NULL AND event_code(event_id) IS NOT NULL;

-- Keep repeated measurements before resolving a single score per measure and event.
CREATE TABLE cognitive_assessment_records AS
WITH hvlt AS (
    SELECT *, integer_score(hvltrt1, 0, 12) + integer_score(hvltrt2, 0, 12)
                   + integer_score(hvltrt3, 0, 12) AS immediate,
              integer_score(hvltrdly, 0, 12) AS delayed
    FROM raw_hvlt
), scores AS (
    SELECT patno, event_id, infodt, last_update, 'hvlt_immediate' AS measure, immediate AS score,
           NULL::VARCHAR AS test_version FROM hvlt
    UNION ALL SELECT patno, event_id, infodt, last_update, 'hvlt_delayed', delayed, NULL FROM hvlt
    UNION ALL SELECT patno, event_id, infodt, last_update, 'jlo', integer_score(jlo_totraw, 0, 15), clean_text(bentonversion) FROM raw_jlo
    UNION ALL SELECT patno, event_id, infodt, last_update, 'lns', integer_score(lns_totraw, 0, 21), NULL FROM raw_lns
    UNION ALL SELECT patno, event_id, infodt, last_update, 'sdmt', integer_score(sdmtotal, 0, 110), clean_text(sdmtvrsn) FROM raw_sdmt
    UNION ALL SELECT patno, event_id, infodt, last_update, 'semantic', integer_score(vltanim, 0, 2147483647), NULL FROM raw_semantic
)
SELECT DISTINCT participant_id(patno) AS patient_id, event_code(event_id) AS event_id, measure, score,
       test_version, clean_text(infodt) AS source_date, month_value(infodt) AS assessment_month,
       date_value(last_update) AS updated_at
FROM scores WHERE participant_id(patno) IS NOT NULL AND event_code(event_id) IS NOT NULL;

CREATE TABLE cognitive_assessments AS
WITH preferred AS (
    SELECT * FROM cognitive_assessment_records
    QUALIFY dense_rank() OVER (
        PARTITION BY patient_id, event_id, measure
        ORDER BY (score IS NOT NULL) DESC, date_value(source_date) DESC NULLS LAST, updated_at DESC NULLS LAST
    ) = 1
)
SELECT patient_id, event_id, measure,
       CASE WHEN count(DISTINCT score) = 1 THEN min(score) END AS score,
       CASE WHEN count(DISTINCT test_version) = 1 THEN min(test_version) END AS test_version,
       min(source_date) AS source_date, min(assessment_month) AS assessment_month
FROM preferred GROUP BY patient_id, event_id, measure;

CREATE TABLE neurological_exams AS
WITH exams AS (
    SELECT patno, event_id, infodt, rec_id, 'MDS-UPDRS III' AS exam,
           integer_score(np3tot, 0, 132) AS total_score, number_value(nhy) AS hoehn_yahr,
           clean_text(pdstate) AS medication_state_code
    FROM raw_motor
    UNION ALL
    SELECT patno, event_id, infodt, rec_id, 'MoCA', integer_score(mcatot, 0, 30), NULL, NULL FROM raw_moca
)
SELECT DISTINCT participant_id(patno) AS patient_id, event_code(event_id) AS event_id, exam, total_score,
       hoehn_yahr, medication_state_code, clean_text(rec_id) AS record_id,
       clean_text(infodt) AS source_date, month_value(infodt) AS assessment_month
FROM exams WHERE participant_id(patno) IS NOT NULL;

CREATE TABLE datscan_scans AS
WITH scans AS (
    SELECT patno, event_id, imageid, rec_id, datscan_date, datscan_ligand, datscan_analyzed,
           'xing_cwm' AS sbr_method, caudate_l_ref_cwm AS caudate_l, caudate_r_ref_cwm AS caudate_r,
           putamen_l_ref_cwm AS putamen_l, putamen_r_ref_cwm AS putamen_r
    FROM raw_xing
    UNION ALL
    SELECT patno, event_id, imageid, rec_id, datscan_date, datscan_ligand, datscan_analyzed,
           'invicro_occipital', datscan_caudate_l, datscan_caudate_r, datscan_putamen_l, datscan_putamen_r
    FROM raw_invicro
), scored AS (
    SELECT DISTINCT participant_id(patno) AS patient_id, event_code(event_id) AS event_id,
           clean_text(imageid) AS image_id, clean_text(rec_id) AS record_id,
           clean_text(datscan_date) AS source_date, month_value(datscan_date) AS scan_month,
           clean_text(datscan_ligand) AS ligand, clean_text(datscan_analyzed) AS analyzed_code,
           sbr_method, number_value(caudate_l) AS caudate_l, number_value(caudate_r) AS caudate_r,
           number_value(putamen_l) AS putamen_l, number_value(putamen_r) AS putamen_r
    FROM scans WHERE participant_id(patno) IS NOT NULL
)
SELECT *, (caudate_l IS NOT NULL)::INTEGER + (caudate_r IS NOT NULL)::INTEGER
            + (putamen_l IS NOT NULL)::INTEGER + (putamen_r IS NOT NULL)::INTEGER AS sbr_regions,
       -- Exclude only an explicitly different tracer or an explicitly unanalyzed scan; a blank flag is kept.
       coalesce(regexp_matches(ligand, '(?i)dat\s*scan|ioflupane|fp[- ]?cit'), true)
           AND NOT coalesce(lower(analyzed_code) IN ('no', 'n', 'false') OR lower(analyzed_code) LIKE 'not %'
                            OR number_value(analyzed_code) = 0, false)
           AS is_eligible_datscan
FROM scored;

CREATE TABLE structural_scans AS
SELECT DISTINCT participant_id(patno) AS patient_id, event_code(event_id) AS event_id,
       clean_text(imageid) AS image_id, clean_text(mridate) AS source_date, month_value(mridate) AS scan_month,
       CASE WHEN number_value(gm_volume) > 0 THEN number_value(gm_volume) END AS gm_volume,
       clean_text(units) AS volume_unit
FROM raw_gmv WHERE participant_id(patno) IS NOT NULL;

CREATE TABLE mri_acquisitions AS
SELECT DISTINCT participant_id(patno) AS patient_id, event_code(event_id) AS event_id,
       month_value(mri_scan_date) AS scan_month,
       CASE WHEN lower(clean_text(mri_seq_t1_weighted)) IN ('yes', 'y', 'true')
                   OR number_value(mri_seq_t1_weighted) = 1 THEN true
            WHEN lower(clean_text(mri_seq_t1_weighted)) IN ('no', 'n', 'false')
                   OR number_value(mri_seq_t1_weighted) = 0 THEN false END AS has_t1_acquisition,
       clean_text(mri_image_acceptable) AS image_acceptable_code
FROM raw_mri_acquisition WHERE participant_id(patno) IS NOT NULL;

CREATE TABLE visits AS
WITH observed AS (
    SELECT patient_id, event_id, visit_month AS observed_month FROM age_at_visit
    UNION ALL SELECT patient_id, event_id, assessment_month FROM cognitive_assessment_records
    UNION ALL SELECT patient_id, event_id, assessment_month FROM neurological_exams
    UNION ALL SELECT patient_id, event_id, scan_month FROM datscan_scans
    UNION ALL SELECT patient_id, event_id, scan_month FROM structural_scans
    UNION ALL SELECT patient_id, event_id, scan_month FROM mri_acquisitions
), event_ranges AS (
    SELECT patient_id, event_id, min(observed_month) AS first_observed_month,
           max(observed_month) AS last_observed_month
    FROM observed WHERE event_id IS NOT NULL GROUP BY patient_id, event_id
), event_ages AS (
    SELECT patient_id, event_id,
           CASE WHEN count(DISTINCT age_years) = 1 THEN min(age_years) END AS age_years
    FROM age_at_visit GROUP BY patient_id, event_id
)
SELECT e.*, a.age_years FROM event_ranges e LEFT JOIN event_ages a USING (patient_id, event_id);

CREATE TABLE patients AS
WITH known AS (
    SELECT patient_id FROM participant_status
    UNION SELECT patient_id FROM demographics
    UNION SELECT patient_id FROM education
    UNION SELECT patient_id FROM visits
    UNION SELECT patient_id FROM neurological_exams
    UNION SELECT patient_id FROM datscan_scans
    UNION SELECT patient_id FROM structural_scans
    UNION SELECT patient_id FROM mri_acquisitions
)
SELECT k.patient_id, s.cohort, s.enrollment_status, s.enrollment_age, s.enrollment_month,
       d.sex_code, d.handedness_code, e.education_years
FROM known k LEFT JOIN participant_status s USING (patient_id)
LEFT JOIN demographics d USING (patient_id) LEFT JOIN education e USING (patient_id);
