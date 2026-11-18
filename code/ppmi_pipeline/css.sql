-- css_norms has one fitted reference regression and residual RMSE per measure.
WITH visits_to_score AS (
    SELECT b.patient_id, c.event_id, c.hvlt_immediate, c.hvlt_delayed, c.jlo, c.lns, c.sdmt, c.semantic,
           d.age_years, d.sex, d.education_years
    FROM css_imaging_participants b
    LEFT JOIN cognition_by_visit c USING (patient_id)
    LEFT JOIN css_covariates d ON b.patient_id = d.patient_id AND c.event_id = d.event_id
), expected AS (
    SELECT a.patient_id, a.event_id, a.score, n.rmse,
           n.intercept
           + CASE WHEN n.age_linear = 0 THEN 0 ELSE n.age_linear * (v.age_years - n.age_center) END
           + CASE WHEN n.age_quadratic = 0 THEN 0 ELSE n.age_quadratic * pow(v.age_years - n.age_center, 2) END
           + CASE WHEN n.sex_coef = 0 THEN 0 ELSE n.sex_coef * v.sex END
           + CASE WHEN n.edu_linear = 0 THEN 0 ELSE n.edu_linear * (v.education_years - n.edu_center) END
           + CASE WHEN n.edu_quadratic = 0 THEN 0 ELSE n.edu_quadratic * pow(v.education_years - n.edu_center, 2) END
           AS expected_score
    FROM cognitive_assessments a JOIN visits_to_score v USING (patient_id, event_id)
    JOIN css_norms n USING (measure)
), standardized AS (
    SELECT patient_id, event_id, (score - expected_score) / rmse AS z FROM expected
), composite AS (
    SELECT patient_id, event_id, avg(greatest(-3.0, least(3.0, z))) AS css
    FROM standardized WHERE isfinite(z)
    GROUP BY patient_id, event_id HAVING count(*) = 6
)
SELECT v.patient_id, v.event_id, v.hvlt_immediate, v.hvlt_delayed, v.jlo, v.lns, v.sdmt, v.semantic, c.css
FROM visits_to_score v LEFT JOIN composite c USING (patient_id, event_id);
