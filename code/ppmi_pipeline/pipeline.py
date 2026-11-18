"""Build the cleaned PPMI tables in DuckDB, in memory or as a database file with CSV and chart exports."""

import argparse
import os
import re
from pathlib import Path
from tempfile import TemporaryDirectory

import duckdb

if __package__:
    from .sources import SOURCES, input_files, stage
else:
    from sources import SOURCES, input_files, stage


PROJECT = Path(__file__).resolve().parent
COHORTS = ("cohort_six_tests", "cohort_datscan", "cohort_structural", "cohort_all_three")
CSV_EXPORTS = {
    **dict.fromkeys(COHORTS, "patient_id"),
    "patients": "patient_id",
    "visits": "patient_id, first_observed_month, event_id",
    "neurological_exams": "ALL",
    "cognition_by_visit": "patient_id, first_assessment_month, event_id",
    "availability_summary": "coverage",
    "patient_coverage": "patient_id",
    "visit_coverage": "patient_id, first_observed_month, event_id",
    "datscan_scans": "ALL",
    "structural_scans": "ALL",
    "longitudinal_datscan": "patient_id, scan_month, event_id, sbr_method, image_id, record_id",
    "longitudinal_structural": "patient_id, scan_month, event_id, image_id",
    "medications": "ALL",
    "ledd_by_visit": "patient_id, visit_month, event_id",
    "biospecimen_results": "ALL",
    "source_manifest": "source_key",
}


def _check_grain(conn, table, keys):
    duplicates = conn.execute(f"""SELECT count(*) FROM (
        SELECT {keys} FROM {table} GROUP BY {keys} HAVING count(*) > 1
    )""").fetchone()[0]
    if duplicates:
        raise ValueError(f"{table} has {duplicates} conflicting groups for ({keys}). Resolve the source records first.")


def populate(conn, inputs, *, release="unspecified"):
    """Stage the inputs and create every cleaned table and view in conn.

    inputs maps a key of sources.SOURCES to a CSV path or a DataFrame; missing keys become empty tables.
    """
    conn.execute("CREATE TABLE dataset_info (release VARCHAR)")
    conn.execute("INSERT INTO dataset_info VALUES (?)", [release])
    stage(conn, inputs)
    conn.execute((PROJECT / "schema.sql").read_text(encoding="utf-8"))
    for table, keys in (
        ("patients", "patient_id"),
        ("visits", "patient_id, event_id"),
        ("cognitive_assessments", "patient_id, event_id, measure"),
    ):
        _check_grain(conn, table, keys)
        conn.execute(f"ALTER TABLE {table} ADD PRIMARY KEY ({keys})")
    conn.execute((PROJECT / "views.sql").read_text(encoding="utf-8"))
    return conn


def lineage():
    """Return (source, target) pairs read from schema.sql and views.sql, in build order. A source is raw:<SOURCES key> or a clean name."""
    created, edges = {}, set()
    for name in ("schema.sql", "views.sql"):
        text = re.sub(r"--[^\n]*", "", (PROJECT / name).read_text(encoding="utf-8"))
        for statement in text.split(";"):
            match = re.search(r"CREATE\s+(TEMP\s+)?(?:TABLE|VIEW)\s+(\w+)", statement, re.I)
            if match:
                created[match[2]] = bool(match[1])
                edges |= {(used, match[2]) for used in re.findall(r"\b(?:FROM|JOIN|UNPIVOT)\s+(\w+)", statement, re.I)}
    known = set(created) | {f"raw_{key}" for key in SOURCES}
    edges = {(a, b) for a, b in edges if a in known and a != b}
    for temp in [name for name, is_temp in created.items() if is_temp]:
        inbound, outbound = {a for a, b in edges if b == temp}, {b for a, b in edges if a == temp}
        edges = {(a, b) for a, b in edges if temp not in (a, b)} | {(a, b) for a in inbound for b in outbound}
    position = {name: i for i, name in enumerate(created)}
    return sorted(((f"raw:{a[4:]}" if a.startswith("raw_") else a, b) for a, b in edges), key=lambda pair: (position[pair[1]], pair[0]))


def build_connection(inputs, *, release="unspecified"):
    """Return an in-memory DuckDB connection holding the cleaned tables. Nothing is written to disk."""
    return populate(duckdb.connect(config={"threads": 2}), inputs, release=release)


def _save_charts(conn, destination):
    try:
        from .charts import save_charts
    except ImportError:
        try:
            from charts import save_charts
        except ImportError:
            print("Charts skipped: install altair and vl-convert-python to export them.")
            return
    save_charts(conn, destination)


def _write_database(inputs, destination, release):
    with duckdb.connect(str(destination / "ppmi.duckdb"), config={"threads": 2}) as conn:
        populate(conn, inputs, release=release)
        for table, order in CSV_EXPORTS.items():
            conn.execute(f"COPY (SELECT * FROM {table} ORDER BY {order}) TO ? (FORMAT CSV, HEADER)",
                         [str(destination / f"{table}.csv")])
        _save_charts(conn, destination)


def _build(inputs, output, release):
    output = Path(output).expanduser().resolve()
    if PROJECT.parent.parent in (output, *output.parents):
        raise ValueError("Write builds outside the repository: they hold participant-level data.")
    if output.exists():
        raise FileExistsError(f"Choose a new output directory: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    # Keep the staging directory private and publish only a complete build.
    with TemporaryDirectory(prefix=".ppmi-", dir=output.parent) as staging:
        destination = Path(staging) / "result"
        destination.mkdir(mode=0o700)
        _write_database(inputs, destination, release)
        if output.exists():
            raise FileExistsError(f"Choose a new output directory: {output}")
        destination.rename(output)
    return output


def build_dataset(input_roots, output, *, release="unspecified"):
    """Import supported IDA CSVs from directories selected by the local investigator."""
    roots = [Path(root).expanduser().resolve() for root in input_roots]
    return _build(input_files(roots), output, release=release)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("build", help="Build from locally approved IDA CSV exports")
    build.add_argument("--input", required=True, action="append", type=Path)
    build.add_argument("--output", required=True, type=Path)
    build.add_argument("--release", default="unspecified")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        output = build_dataset(args.input, args.output, release=args.release)
    except (ValueError, OSError, duckdb.Error) as error:
        parser.exit(1, f"{error}\n")
    print(output)


if __name__ == "__main__":
    main()
