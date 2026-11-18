-- Schema of the persisted tables and views, including exact DuckDB types.
SELECT table_name, ordinal_position, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'main'
ORDER BY table_name, ordinal_position;

-- Availability for the full set of supplied exports, including missing and repeat measurements.
SELECT * FROM availability_summary;
SELECT * FROM patient_coverage ORDER BY patient_id;
SELECT * FROM visit_coverage ORDER BY patient_id, first_observed_month, event_id;

-- Counts for the four cohort exports.
SELECT 'six_tests' AS cohort, count(*) AS participants FROM cohort_six_tests
UNION ALL SELECT 'datscan', count(*) FROM cohort_datscan
UNION ALL SELECT 'structural', count(*) FROM cohort_structural
UNION ALL SELECT 'all_three', count(*) FROM cohort_all_three;

-- All six scores at every complete visit.
SELECT patient_id, event_id, first_assessment_month, last_assessment_month,
       hvlt_immediate, hvlt_delayed, jlo, lns, sdmt, semantic
FROM cognition_by_visit WHERE complete_six
ORDER BY patient_id, first_assessment_month, event_id;

-- Three modalities at two or more shared events, regardless of scan month.
SELECT patient_id, n_same_event_all_visits FROM cohort_all_three
WHERE n_same_event_all_visits >= 2
ORDER BY n_same_event_all_visits DESC, patient_id;

-- Join a structured exam to its source event without pooling repeated exams.
SELECT e.patient_id, e.event_id, e.assessment_month, e.total_score, e.medication_state_code, v.age_years
FROM neurological_exams e LEFT JOIN visits v USING (patient_id, event_id)
WHERE e.exam = 'MDS-UPDRS III'
ORDER BY e.patient_id, e.assessment_month, e.event_id;

-- All available selected participants' imaging visits.
SELECT * FROM longitudinal_datscan ORDER BY patient_id, scan_month, sbr_method;
SELECT * FROM longitudinal_structural ORDER BY patient_id, scan_month;
