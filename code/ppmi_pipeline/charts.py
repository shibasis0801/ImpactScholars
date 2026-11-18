"""Small DuckDB query results feed the Altair charts."""

import altair as alt


def coverage_chart(conn):
    data = conn.sql("""
        SELECT 'Six tests' AS cohort, count(*) AS participants FROM cohort_six_tests
        UNION ALL SELECT 'DaTScan', count(*) FROM cohort_datscan
        UNION ALL SELECT 'Structural MRI', count(*) FROM cohort_structural
        UNION ALL SELECT 'All three', count(*) FROM cohort_all_three
    """).df()
    return alt.Chart(data, title="Participant coverage").mark_bar().encode(
        x=alt.X("participants:Q", title="Participants"),
        y=alt.Y("cohort:N", title=None, sort=["Six tests", "DaTScan", "Structural MRI", "All three"]),
        tooltip=["cohort:N", "participants:Q"],
    ).properties(width=420, height=150)


def datscan_chart(conn):
    data = conn.sql("""
        WITH regional AS (
            UNPIVOT longitudinal_datscan ON caudate_l, caudate_r, putamen_l, putamen_r INTO NAME region VALUE sbr
        )
        SELECT patient_id, scan_month, region, sbr_method, avg(sbr) AS sbr, count(*) AS records
        FROM regional WHERE scan_month IS NOT NULL GROUP BY ALL ORDER BY ALL
    """).df()
    if data.empty:
        return None
    return alt.Chart(data).mark_line(point=True).encode(
        x=alt.X("scan_month:T", title="Scan month"), y=alt.Y("sbr:Q", title="Specific binding ratio"),
        color=alt.Color("region:N", title="Region"), strokeDash=alt.StrokeDash("sbr_method:N", title="Method"),
        tooltip=["patient_id:N", alt.Tooltip("scan_month:T", format="%Y-%m"), "region:N", "sbr_method:N",
                 alt.Tooltip("sbr:Q", format=".3f"), "records:Q"],
    ).properties(width=330, height=190).facet(column="patient_id:N", title="DaTScan regional SBR by month")


def structural_chart(conn):
    data = conn.sql("""
        SELECT patient_id, scan_month, coalesce(volume_unit, 'Unit unspecified') AS unit,
               avg(gm_volume) AS gm_volume, count(*) AS records
        FROM longitudinal_structural WHERE scan_month IS NOT NULL GROUP BY ALL ORDER BY ALL
    """).df()
    if data.empty:
        return None
    return alt.Chart(data).mark_line(point=True).encode(
        x=alt.X("scan_month:T", title="Scan month"),
        y=alt.Y("gm_volume:Q", title="Grey matter volume", scale=alt.Scale(zero=False)),
        tooltip=["patient_id:N", alt.Tooltip("scan_month:T", format="%Y-%m"), "unit:N",
                 alt.Tooltip("gm_volume:Q", format=",.1f"), "records:Q"],
    ).properties(width=330, height=190).facet(
        row="unit:N", column="patient_id:N", title="Structural MRI grey matter volume by month"
    ).resolve_scale(y="independent")


def save_charts(conn, output):
    for filename, make_chart in (
        ("coverage.html", coverage_chart),
        ("longitudinal_datscan.html", datscan_chart),
        ("longitudinal_structural.html", structural_chart),
    ):
        chart = make_chart(conn)
        if chart is not None:
            chart.save(output / filename, inline=True)
