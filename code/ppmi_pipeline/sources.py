"""Map IDA export headers to the text columns consumed by schema.sql."""

from dataclasses import dataclass, field
from pathlib import Path
import re


@dataclass(frozen=True)
class Source:
    prefixes: tuple[str, ...]
    required: str
    optional: str = ""
    aliases: dict[str, tuple[str, ...]] = field(default_factory=dict)
    strict: bool = True


SOURCES = {
    "status": Source(("Participant_Status",), "patno cohort_definition", "enroll_status enroll_age enroll_date"),
    "demographics": Source(("Demographics",), "patno sex", "handed last_update",
                           {"last_update": ("update_stamp",)}),
    "education": Source(("Socio_Economics", "Socioeconomics"), "patno educyrs", "infodt last_update",
                        {"last_update": ("update_stamp",)}),
    "age": Source(("Age_at_Visit",), "patno event_id age_at_visit", "infodt", {"age_at_visit": ("age",)}),
    "motor": Source(("MDS_UPDRS_Part_III", "MDS_UPDRS_Part_3"), "patno event_id np3tot",
                    "infodt nhy pdstate rec_id"),
    "moca": Source(("Montreal_Cognitive_Assessment", "Montreal_Cognitive_Assessment_MoCA", "MoCA"),
                   "patno event_id mcatot", "infodt rec_id"),
    "hvlt": Source(("Hopkins_Verbal_Learning_Test_Revised",), "patno event_id hvltrt1 hvltrt2 hvltrt3 hvltrdly",
                   "infodt last_update"),
    "jlo": Source(("Benton_Judgement_of_Line_Orientation", "Benton_Judgment_of_Line_Orientation"),
                   "patno event_id jlo_totraw", "infodt bentonversion last_update"),
    "lns": Source(("Letter_Number_Sequencing",), "patno event_id lns_totraw", "infodt last_update"),
    "sdmt": Source(("Symbol_Digit_Modalities_Test",), "patno event_id sdmtotal", "infodt sdmtvrsn last_update"),
    "semantic": Source(("Modified_Semantic_Fluency",), "patno event_id vltanim", "infodt last_update"),
    "xing": Source(("Xing_Core_Lab_Quant_SBR",),
                   "patno event_id datscan_date datscan_analyzed caudate_l_ref_cwm caudate_r_ref_cwm putamen_l_ref_cwm putamen_r_ref_cwm",
                   "imageid datscan_ligand rec_id", {"imageid": ("image_id",)}),
    "invicro": Source(("DaTScan_SBR_Analysis",),
                      "patno event_id datscan_date datscan_caudate_l datscan_caudate_r datscan_putamen_l datscan_putamen_r",
                      "imageid datscan_ligand datscan_analyzed rec_id", {"imageid": ("image_id",)}),
    "gmv": Source(("Grey_Matter_Volume", "Gray_Matter_Volume"), "patno event_id gm_volume",
                  "imageid mridate units", {"imageid": ("image_id",)}),
    "mri_acquisition": Source(("Xing_Core_Lab_MRI_Acquisition_Metadata", "MRI_Acquisition_Metadata"),
                              "patno mri_seq_t1_weighted", "event_id mri_scan_date mri_image_acceptable",
                              {"mri_scan_date": ("infodt",)}),
    # Optional inputs: a file without the required headers is skipped instead of stopping the build.
    "ledd": Source(("LEDD_Concomitant_Medication_Log",), "patno ledtrt ledd startdt stopdt",
                   "event_id rec_id leddstrmg leddose leddosfrq", strict=False),
    "biospecimen": Source(("Current_Biospecimen_Analysis_Results",), "patno event_id testname testvalue",
                          "units type projectid", strict=False),
}


def normalized(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def source_for(table_name):
    """Return the SOURCES key whose IDA file name normalizes to table_name, or None."""
    return next((key for key, source in SOURCES.items()
                 if any(normalized(prefix) == table_name for prefix in source.prefixes)), None)


def input_files(roots):
    paths = set()
    for root in roots:
        if not root.is_dir():
            raise ValueError(f"Input directory does not exist: {root}")
        paths.update(p.resolve() for p in root.rglob("*") if p.is_file() and p.suffix.lower() == ".csv")

    sources = {}
    for key, source in SOURCES.items():
        prefixes = [normalized(prefix) for prefix in source.prefixes]
        matches = sorted(p for p in paths if any(
            re.fullmatch(re.escape(prefix) + r"(?:_\d{2}[a-z]{3}\d{4})?", normalized(p.stem))
            for prefix in prefixes
        ))
        if len(matches) > 1:
            files = ", ".join(p.name for p in matches)
            raise ValueError(f"Multiple exports for {key}: {files}. Use one release per table.")
        if matches:
            sources[key] = matches[0]
    if not sources:
        raise ValueError("No supported IDA CSV exports found. See README.md for source filenames.")
    return sources


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def stage(conn, inputs):
    conn.execute("""CREATE TABLE source_manifest (
        source_key VARCHAR PRIMARY KEY, filename VARCHAR, status VARCHAR, input_rows BIGINT
    )""")
    for key, source in SOURCES.items():
        item = inputs.get(key)
        if isinstance(item, Path):
            conn.execute("""CREATE OR REPLACE TEMP TABLE incoming AS
                SELECT * FROM read_csv(?, header = true, all_varchar = true)
            """, [str(item)])
        elif item is not None:
            conn.register("incoming_frame", item)
            conn.execute("CREATE OR REPLACE TEMP TABLE incoming AS SELECT * FROM incoming_frame")
            conn.unregister("incoming_frame")

        if item is None:
            headers = {}
        else:
            columns = [desc[0] for desc in conn.execute("SELECT * FROM incoming LIMIT 0").description]
            headers = {normalized(col): col for col in columns}
            if len(headers) != len(columns):
                raise ValueError(f"{key} has ambiguous column names")

        required = source.required.split()
        select = []
        missing = []
        for col in required + source.optional.split():
            aliases = (col,) + source.aliases.get(col, ())
            if col == "event_id":
                aliases += ("clinical_event",)
            actual = next((headers[name] for name in aliases if name in headers), None)
            if actual is None and col in required:
                missing.append(col.upper())
            expr = "NULL" if actual is None else identifier(actual)
            select.append(f"CAST({expr} AS VARCHAR) AS {col}")
        status = "missing" if item is None else "loaded"
        if item is not None and missing:
            if source.strict:
                raise ValueError(f"{key} is missing required headers: {', '.join(missing)}")
            status = f"skipped: no {', '.join(missing)} column"

        tail = "WHERE false" if item is None else "FROM incoming" + ("" if status == "loaded" else " WHERE false")
        conn.execute(f"CREATE TEMP TABLE raw_{key} AS SELECT {', '.join(select)} {tail}")
        count = conn.execute(f"SELECT count(*) FROM raw_{key}").fetchone()[0]
        conn.execute("INSERT INTO source_manifest VALUES (?, ?, ?, ?)", [
            key, item.name if isinstance(item, Path) else (f"{key} (DataFrame)" if item is not None else None),
            status, count,
        ])
