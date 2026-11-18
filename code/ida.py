"""Get PPMI data from LONI IDA into the folder that data.PPMI reads.

IDA has no programming interface for Study Data, so the browser does the ticking and this module does the rest:

    ida.browse("study")      opens Download > Study Data in your browser, signed in with your own account
    ida.collect()            files what you downloaded: study CSVs and zips, image-search CSVs, image zips
    ida.fetch("urls.txt")    downloads an image collection from the URL list that Advanced Download gives

Nothing here reads the contents of a data file except the header line of a CSV, to tell searches from tables.
"""

from datetime import datetime
from email.message import Message
from hashlib import sha1
from pathlib import Path
import http.client
import os
import re
import shutil
import time
import urllib.parse
import urllib.request
import warnings
import webbrowser
import zipfile

import pandas as pd

PAGES = {
    "study": "https://ida.loni.usc.edu/pages/access/studyData.jsp?project=PPMI",
    "search": "https://ida.loni.usc.edu/pages/access/search.jsp?project=PPMI&tab=advSearch&page=SEARCH&subPage=NEW_ADV_QUERY",
    "login": "https://ida.loni.usc.edu/login.jsp?project=PPMI",
    "apply": "https://www.ppmi-info.org/access-data-specimens/download-data",
}
IMAGES = (".dcm", ".nii", ".nii.gz", ".img", ".hdr")
DATED = re.compile(r".+_\d{2}[A-Za-z]{3}\d{4}\.csv$")


def root(folder: str | Path | None = None) -> Path:
    return Path(folder or os.environ.get("PPMI_DATA", "~/ppmi")).expanduser()


def browse(page: str = "study") -> str:
    webbrowser.open(PAGES[page])
    return PAGES[page]


def _header(path: Path) -> list[str]:
    with path.open(encoding="utf-8-sig", errors="replace") as file:
        return [column.strip().strip('"').lower() for column in file.readline().split(",")]


def _is_search(columns: list[str]) -> bool:
    return bool({"subject id", "subject"} & set(columns)) and bool({"visit", "modality", "image data id", "image id"} & set(columns))


def _is_image(name: str) -> bool:
    return name.lower().endswith(IMAGES)


def _extract(archive: zipfile.ZipFile, members: list[str], target: Path, flatten: bool) -> list[Path]:
    written = []
    for member in members:
        destination = (target / (Path(member).name if flatten else member)).resolve()
        if target.resolve() not in destination.parents:
            raise ValueError(f"Refusing to unpack {member} outside {target}")
        if destination.exists():
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        with archive.open(member) as source, destination.open("wb") as sink:
            shutil.copyfileobj(source, sink)
        written.append(destination)
    return written


def _place(path: Path, target: Path, move: bool) -> str:
    destination = target / path.name
    if destination.exists():
        return "already there"
    target.mkdir(parents=True, exist_ok=True)
    (shutil.move if move else shutil.copy2)(path, destination)
    return "moved" if move else "copied"


def _archive(path: Path, folder: Path, move: bool) -> None:
    if move:
        (folder / "downloads").mkdir(parents=True, exist_ok=True)
        shutil.move(path, folder / "downloads" / path.name)


def collect(source: str | Path | None = None, folder: str | Path | None = None,
            since: datetime | None = None, move: bool = True) -> pd.DataFrame:
    """File IDA downloads from source (IDA_DOWNLOADS, or ~/Downloads) into study/, imaging/ and images/ of the data folder.

    Study CSVs keep IDA's names, zips are unpacked and then kept under downloads/, other files are left alone.
    """
    source = Path(source or os.environ.get("IDA_DOWNLOADS", Path.home() / "Downloads")).expanduser()
    folder = root(folder)
    report = []
    try:
        entries = sorted(source.iterdir())
    except OSError as error:
        warnings.warn(f"Cannot read {source} ({error.strerror}). Allow access to it, or pass the folder you downloaded into.")
        entries = []
    for path in entries:
        if not path.is_file() or (since and datetime.fromtimestamp(path.stat().st_mtime) < since):
            continue
        name = path.name
        if name.lower().endswith(".csv"):
            if _is_search(_header(path)):
                report.append((name, "image search", _place(path, folder / "imaging", move), "imaging"))
            elif DATED.match(name):
                report.append((name, "study table", _place(path, folder / "study", move), "study"))
        elif name.lower().endswith((".xlsx", ".xls")) and name.startswith("PPMI_Curated_Data_Cut"):
            report.append((name, "curated data cut", _place(path, folder / "study", move), "study"))
        elif name.lower().endswith(".zip") and zipfile.is_zipfile(path):
            with zipfile.ZipFile(path) as archive:
                members = [member for member in archive.namelist() if not member.endswith("/")]
                images = [member for member in members if _is_image(member)]
                tables = [member for member in members if DATED.match(Path(member).name)]
                if images:
                    written = _extract(archive, images, folder / "images", flatten=False)
                    report.append((name, "images", f"unpacked {len(written)} of {len(images)} files", "images"))
                elif tables:
                    written = _extract(archive, tables, folder / "study", flatten=True)
                    report.append((name, "study tables", f"unpacked {len(written)} of {len(tables)} tables", "study"))
                else:
                    continue
            _archive(path, folder, move)
    return pd.DataFrame(report, columns=["file", "kind", "action", "into"])


def _filename(response, url: str) -> str:
    header = Message()
    header["content-disposition"] = response.headers.get("Content-Disposition", "")
    return Path(header.get_filename() or urllib.parse.unquote(urllib.parse.urlparse(url).path)).name or "download.zip"


def _download(url: str, folder: Path, retries: int) -> Path:
    key = sha1(url.encode()).hexdigest()[:16]
    partial, receipt = folder / f".{key}.part", folder / f".{key}.done"
    if receipt.exists() and (folder / receipt.read_text()).exists():
        return folder / receipt.read_text()
    for attempt in range(retries):
        done = partial.stat().st_size if partial.exists() else 0
        request = urllib.request.Request(url, headers={"Range": f"bytes={done}-"} if done else {})
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                start = done if response.status == 206 else 0
                with partial.open("ab" if start else "wb") as sink:
                    shutil.copyfileobj(response, sink, 1 << 20)
                length = response.headers.get("Content-Length")
                if length is not None and partial.stat().st_size < start + int(length):
                    raise ConnectionError(f"Transfer of {url} stopped early")
                final = folder / _filename(response, url)
            partial.rename(final)
            receipt.write_text(final.name)
            return final
        except (OSError, http.client.HTTPException):
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Could not download {url}")


def fetch(urls: str | Path | list[str], folder: str | Path | None = None, retries: int = 5) -> pd.DataFrame:
    """Download every URL in an IDA Advanced Download list, resuming broken transfers, and unpack the images.

    In IDA: Search > Advanced Search, Add to Collection, then Data Collections > Advanced Download and save the URL list.
    """
    if not isinstance(urls, list):
        urls = re.findall(r"https?://\S+", Path(urls).expanduser().read_text())
    folder = root(folder)
    downloads = folder / "downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    report = []
    for url in urls:
        path = _download(url, downloads, retries)
        unpacked = 0
        if zipfile.is_zipfile(path):
            with zipfile.ZipFile(path) as archive:
                unpacked = len(_extract(archive, [m for m in archive.namelist() if _is_image(m)], folder / "images", flatten=False))
        report.append((path.name, path.stat().st_size, unpacked))
    return pd.DataFrame(report, columns=["file", "bytes", "images unpacked"])
