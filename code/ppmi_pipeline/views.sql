CREATE VIEW cognition_by_visit AS
SELECT patient_id, event_id, min(assessment_month) AS first_assessment_month,
       max(assessment_month) AS last_assessment_month,
       max(score) FILTER (measure = 'hvlt_immediate') AS hvlt_immediate,
       max(score) FILTER (measure = 'hvlt_delayed') AS hvlt_delayed,
       max(score) FILTER (measure = 'jlo') AS jlo,
       max(score) FILTER (measure = 'lns') AS lns,
       max(score) FILTER (measure = 'sdmt') AS sdmt,
       max(score) FILTER (measure = 'semantic') AS semantic,
       count(score) AS scores_present, count(score) = 6 AS complete_six
FROM cognitive_assessments GROUP BY patient_id, event_id;

CREATE VIEW usable_datscan AS
SELECT * FROM datscan_scans WHERE is_eligible_datscan AND sbr_regions > 0;

CREATE VIEW usable_structural AS
SELECT * FROM structural_scans WHERE gm_volume IS NOT NULL;

CREATE VIEW visit_coverage AS
SELECT v.*, coalesce(c.scores_present, 0) AS cognitive_scores_present,
       coalesce(c.complete_six, false) AS has_six_tests,
       EXISTS (FROM usable_datscan d WHERE d.patient_id = v.patient_id AND d.event_id = v.event_id) AS has_datscan,
       EXISTS (FROM usable_structural s WHERE s.patient_id = v.patient_id AND s.event_id = v.event_id) AS has_structural
FROM visits v LEFT JOIN cognition_by_visit c USING (patient_id, event_id);

CREATE VIEW patient_coverage AS
WITH visit_counts AS (
    SELECT patient_id, count(*) AS n_visits,
           count(*) FILTER (cognitive_scores_present > 0) AS n_cognitive_visits,
           count(*) FILTER (has_six_tests) AS n_six_test_visits,
           count(*) FILTER (has_datscan) AS n_datscan_visits,
           count(*) FILTER (has_structural) AS n_structural_visits,
           count(*) FILTER (has_six_tests AND has_datscan AND has_structural) AS n_same_event_all_visits
    FROM visit_coverage GROUP BY patient_id
), dat_counts AS (
    SELECT patient_id, count(*) AS n_supplied_datscan_records,
           count(*) FILTER (usable) AS n_datscan_records,
           count(DISTINCT scan_month) FILTER (usable) AS n_datscan_months,
           min(scan_month) FILTER (usable) AS first_datscan_month,
           max(scan_month) FILTER (usable) AS last_datscan_month,
           count(DISTINCT event_id) FILTER (usable AND sbr_regions = 4) AS n_four_sbr_visits
    FROM (SELECT *, is_eligible_datscan AND sbr_regions > 0 AS usable FROM datscan_scans)
    GROUP BY patient_id
), mri_counts AS (
    SELECT patient_id, count(*) AS n_supplied_structural_records,
           count(gm_volume) AS n_structural_records,
           count(DISTINCT scan_month) FILTER (gm_volume IS NOT NULL) AS n_structural_months,
           min(scan_month) FILTER (gm_volume IS NOT NULL) AS first_structural_month,
           max(scan_month) FILTER (gm_volume IS NOT NULL) AS last_structural_month
    FROM structural_scans GROUP BY patient_id
)
SELECT p.patient_id, p.cohort, p.enrollment_status, p.sex_code,
       coalesce(v.n_visits, 0) AS n_visits,
       coalesce(v.n_cognitive_visits, 0) AS n_cognitive_visits,
       coalesce(v.n_six_test_visits, 0) AS n_six_test_visits,
       coalesce(v.n_datscan_visits, 0) AS n_datscan_visits,
       coalesce(d.n_four_sbr_visits, 0) AS n_four_sbr_visits,
       coalesce(v.n_structural_visits, 0) AS n_structural_visits,
       coalesce(v.n_same_event_all_visits, 0) AS n_same_event_all_visits,
       coalesce(d.n_supplied_datscan_records, 0) AS n_supplied_datscan_records,
       coalesce(m.n_supplied_structural_records, 0) AS n_supplied_structural_records,
       coalesce(d.n_datscan_records, 0) AS n_datscan_records,
       coalesce(m.n_structural_records, 0) AS n_structural_records,
       coalesce(d.n_datscan_months, 0) AS n_datscan_months,
       coalesce(m.n_structural_months, 0) AS n_structural_months,
       d.first_datscan_month, d.last_datscan_month, m.first_structural_month, m.last_structural_month
FROM patients p
LEFT JOIN visit_counts v USING (patient_id)
LEFT JOIN dat_counts d USING (patient_id)
LEFT JOIN mri_counts m USING (patient_id);

CREATE VIEW participant_lists AS
WITH measured_events AS (
    SELECT patient_id, event_id, count(DISTINCT measure) AS measures
    FROM cognitive_assessment_records WHERE score IS NOT NULL GROUP BY patient_id, event_id
), measured_participants AS (
    SELECT patient_id, count(*) AS n_cognitive_visits,
           count(*) FILTER (measures = 6) AS n_six_test_visits
    FROM measured_events GROUP BY patient_id
)
SELECT p.patient_id, p.cohort, p.enrollment_status,
       coalesce(c.n_cognitive_visits, 0) AS n_cognitive_visits,
       coalesce(c.n_six_test_visits, 0) AS n_six_test_visits,
       p.n_datscan_records,
       EXISTS (FROM mri_acquisitions m WHERE m.patient_id = p.patient_id AND m.has_t1_acquisition)
           AS has_t1_acquisition,
       p.n_structural_records AS n_grey_matter_volume_records
FROM patient_coverage p LEFT JOIN measured_participants c USING (patient_id);

CREATE VIEW cohort_six_tests AS SELECT * FROM patient_coverage WHERE n_six_test_visits > 0;
CREATE VIEW cohort_datscan AS SELECT * FROM patient_coverage WHERE n_datscan_records > 0;
CREATE VIEW cohort_structural AS SELECT * FROM patient_coverage WHERE n_structural_records > 0;
CREATE VIEW cohort_both_imaging AS
SELECT * FROM patient_coverage WHERE n_datscan_records > 0 AND n_structural_records > 0;
CREATE VIEW cohort_all_three AS
SELECT * FROM cohort_both_imaging WHERE n_six_test_visits > 0;

CREATE VIEW availability_summary AS
SELECT 'Participants in supplied exports' AS coverage, count(*) AS participants FROM patient_coverage
UNION ALL SELECT 'Any cognitive score', count(DISTINCT patient_id) FROM cognitive_assessment_records WHERE score IS NOT NULL
UNION ALL SELECT 'All six scores at one event', count(*) FROM cohort_six_tests
UNION ALL SELECT 'All six scores at two or more events', count(*) FROM cohort_six_tests WHERE n_six_test_visits >= 2
UNION ALL SELECT 'Any supplied DaTScan record', count(*) FROM patient_coverage WHERE n_supplied_datscan_records > 0
UNION ALL SELECT 'Usable DaTScan', count(*) FROM cohort_datscan
UNION ALL SELECT 'Usable DaTScan in two or more months', count(*) FROM cohort_datscan WHERE n_datscan_months >= 2
UNION ALL SELECT 'Any supplied structural MRI record', count(*) FROM patient_coverage WHERE n_supplied_structural_records > 0
UNION ALL SELECT 'Usable structural MRI', count(*) FROM cohort_structural
UNION ALL SELECT 'Usable structural MRI in two or more months', count(*) FROM cohort_structural WHERE n_structural_months >= 2
UNION ALL SELECT 'Both imaging modalities', count(*) FROM cohort_both_imaging
UNION ALL SELECT 'Both imaging modalities and six cognitive scores', count(*) FROM cohort_all_three
UNION ALL SELECT 'All three modalities at a shared event', count(*) FROM cohort_all_three WHERE n_same_event_all_visits > 0;

-- Require two dated observations in a comparable series before selecting a participant.
CREATE VIEW longitudinal_patients AS
WITH dat_regions AS (
    UNPIVOT usable_datscan ON caudate_l, caudate_r, putamen_l, putamen_r INTO NAME region VALUE sbr
), repeated_series AS (
    SELECT patient_id, 'datscan' AS modality, count(DISTINCT scan_month) AS n_months
    FROM dat_regions GROUP BY patient_id, sbr_method, region HAVING n_months >= 2
    UNION ALL
    SELECT patient_id, 'structural', count(DISTINCT scan_month) AS n_months
    FROM usable_structural GROUP BY patient_id, volume_unit HAVING n_months >= 2
), candidates AS (
    SELECT patient_id, modality, max(n_months) AS repeated_months FROM repeated_series GROUP BY patient_id, modality
), paired AS (
    SELECT patient_id, min(repeated_months) AS paired_months
    FROM candidates GROUP BY patient_id HAVING count(*) = 2
)
SELECT c.*, p.paired_months IS NOT NULL AS repeated_both,
       row_number() OVER (PARTITION BY c.modality ORDER BY
           (p.paired_months IS NOT NULL) DESC, (v.n_six_test_visits > 0) DESC,
           p.paired_months DESC NULLS LAST,
           CASE WHEN p.paired_months IS NULL THEN c.repeated_months END DESC, c.patient_id) AS sample_rank
FROM candidates c LEFT JOIN paired p USING (patient_id) JOIN patient_coverage v USING (patient_id);

CREATE VIEW longitudinal_datscan AS
SELECT d.* FROM usable_datscan d JOIN longitudinal_patients l USING (patient_id)
WHERE l.modality = 'datscan' AND l.sample_rank <= 2;

CREATE VIEW longitudinal_structural AS
SELECT s.* FROM usable_structural s JOIN longitudinal_patients l USING (patient_id)
WHERE l.modality = 'structural' AND l.sample_rank <= 2;

-- LEDD at each visit, from the drugs taken in the visit's first observed month. A drug that starts or stops in that
-- month counts, a missing start month means before enrolment and a missing stop month means still taken. A COMT
-- inhibitor adds its fraction of the levodopa LEDD taken with it. The view stays empty until the medication log loads.
CREATE VIEW ledd_by_visit AS
WITH taken AS (
    SELECT v.patient_id, v.event_id, m.ledd_mg, m.levodopa_fraction, m.is_levodopa
    FROM visits v JOIN medications m USING (patient_id)
    WHERE coalesce(m.start_month <= v.first_observed_month, true)
      AND coalesce(m.stop_month >= v.first_observed_month, true)
), totals AS (
    SELECT patient_id, event_id, sum(ledd_mg) AS fixed_ledd, sum(ledd_mg) FILTER (is_levodopa) AS levodopa_ledd,
           sum(levodopa_fraction) AS levodopa_fractions, count(*) AS n_drugs,
           count(*) FILTER (ledd_mg IS NULL AND levodopa_fraction IS NULL) AS n_without_ledd
    FROM taken GROUP BY patient_id, event_id
)
SELECT v.patient_id, v.event_id, v.first_observed_month AS visit_month,
       coalesce(t.fixed_ledd, 0) + coalesce(t.levodopa_fractions, 0) * coalesce(t.levodopa_ledd, 0) AS ledd_total,
       coalesce(t.levodopa_ledd, 0) AS levodopa_ledd, coalesce(t.n_drugs, 0) AS n_drugs,
       coalesce(t.n_without_ledd, 0) AS n_without_ledd
FROM visits v LEFT JOIN totals t USING (patient_id, event_id)
WHERE v.first_observed_month IS NOT NULL AND EXISTS (FROM medications);
