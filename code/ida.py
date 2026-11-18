"""Get PPMI data from LONI IDA into the data folder that data.PPMI reads.

IDA's sign-in page asks for a human check, so code cannot sign in with your password. You sign in in your browser,
and this module borrows that browser session to make the same requests IDA's own Study Data page makes:

    ida.signin()             takes your browser's IDA session (see below), checks it and keeps it in memory
    ida.offer()              lists every study file IDA offers you into data/ida/offer.csv; data.PPMI loads it as ida_files
    ida.download(ids)        downloads study files by their IDA file ID, then files them like collect()
    ida.collect()            files what you downloaded yourself: study CSVs and zips (with their PDFs), image-search CSVs, image zips
    ida.fetch("urls.txt")    downloads an image collection from the URL list that Advanced Download gives
    ida.browse("study")      opens a page of IDA in your browser

Your session: sign in to IDA in Chrome and open Download > Study Data. Open the developer tools (View > Developer >
Developer Tools), choose Network, reload the page, right-click studyData.jsp and choose Copy > Copy as cURL. Run
ida.signin() and paste it into the box, which hides what you paste; or save it as data/ida/session.txt, which
signin() reads. Firefox and Safari have the same Copy as cURL, and the request's Cookie header alone works too.
It is your sign-in for as long as the IDA session lasts: it stays in memory or in data/, which git ignores, it is
sent only to ida.loni.usc.edu, and nothing here prints it.

Nothing here reads the contents of a data file except the header line of a CSV, to tell searches from tables.
Each function returns a small DuckDB table of what it did: print it, or query it.
"""

from dataclasses import dataclass, field
from datetime import datetime
from email.message import Message
from hashlib import sha1
from pathlib import Path
import getpass
import html
import http.client
import os
import re
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
import warnings
import webbrowser
import zipfile

import duckdb

REPOSITORY = Path(__file__).resolve().parent.parent
DATA = REPOSITORY / "data"
PAGES = {
    "study": "https://ida.loni.usc.edu/pages/access/studyData.jsp?project=PPMI",
    "search": "https://ida.loni.usc.edu/pages/access/search.jsp?project=PPMI&tab=advSearch&page=SEARCH&subPage=NEW_ADV_QUERY",
    "login": "https://ida.loni.usc.edu/login.jsp?project=PPMI",
    "apply": "https://www.ppmi-info.org/access-data-specimens/download-data",
}
# The requests IDA's Study Data page makes: the page itself, one listing per category, the paths of chosen files, a file.
SITE = "https://ida.loni.usc.edu"
STUDY_PAGE = SITE + "/pages/access/studyData.jsp"
STUDY_PATHS = SITE + "/pages/ajax/getStudyData"
STUDY_FILES = SITE + "/download/files/study/"
AGENT = "Mozilla/5.0 (ImpactScholars PPMI notebooks)"
IMAGES = (".dcm", ".nii", ".nii.gz", ".img", ".hdr")
DATED = re.compile(r".+_\d{2}[A-Za-z]{3}\d{4}\.csv$")
EXPIRED = ("IDA did not accept your session: it has signed out or expired, or IDA refused the request. Sign in to IDA in "
           "your browser, copy the studyData.jsp request again and rerun ida.signin().")


@dataclass(frozen=True)
class Session:
    """Your IDA sign-in as your browser sends it. Its cookies and user agent never appear in its repr."""
    cookie: str = field(repr=False)
    agent: str = field(repr=False)
    source: str = "pasted"


_session: Session | None = None


def root(folder: str | Path | None = None) -> Path:
    return Path(folder or os.environ.get("PPMI_DATA") or DATA).expanduser()


def browse(page: str = "study") -> str:
    webbrowser.open(PAGES[page])
    return PAGES[page]


def _report(rows: list[tuple], columns: dict[str, str]) -> duckdb.DuckDBPyRelation:
    """What a function did, as a small DuckDB table."""
    db = duckdb.connect()
    db.execute("CREATE TABLE report (" + ", ".join(f'"{name}" {kind}' for name, kind in columns.items()) + ")")
    if rows:
        db.executemany(f"INSERT INTO report VALUES ({', '.join('?' * len(columns))})", rows)
    return db.table("report")


def _header(path: Path) -> list[str]:
    with path.open(encoding="utf-8-sig", errors="replace") as file:
        return [column.strip().strip('"').lower() for column in file.readline().split(",")]


def _is_search(columns: list[str]) -> bool:
    return bool({"subject id", "subject"} & set(columns)) and bool({"visit", "modality", "image data id", "image id"} & set(columns))


def _is_curated(name: str) -> bool:
    return name.startswith("PPMI_Curated_Data_Cut") and name.lower().endswith((".xlsx", ".xls"))


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


def _unpack(path: Path, folder: Path, move: bool) -> tuple[str, str, str] | None:
    """Unpack an IDA zip: images into images/, or study tables into study/ with their PDFs into docs/; then keep the zip
    under downloads/. None, and the zip left alone, when it holds neither."""
    with zipfile.ZipFile(path) as archive:
        members = [member for member in archive.namelist() if not member.endswith("/")]
        images = [member for member in members if _is_image(member)]
        tables = [member for member in members if DATED.match(Path(member).name) or _is_curated(Path(member).name)]
        documents = [member for member in members if member.lower().endswith(".pdf")] if tables else []
        if images:
            written = _extract(archive, images, folder / "images", flatten=False)
            unpacked = ("images", f"unpacked {len(written)} of {len(images)} files", "images")
        elif tables:
            written = _extract(archive, tables, folder / "study", flatten=True)
            action = f"unpacked {len(written)} of {len(tables)} tables"
            if documents:
                papers = _extract(archive, documents, folder / "docs", flatten=True)
                action += f" and {len(papers)} of {len(documents)} documents"
            unpacked = ("study tables", action, "study and docs" if documents else "study")
        else:
            return None
    _archive(path, folder, move)
    return unpacked


def collect(source: str | Path | None = None, folder: str | Path | None = None,
            since: datetime | None = None, move: bool = True) -> duckdb.DuckDBPyRelation:
    """File IDA downloads from source (IDA_DOWNLOADS, or ~/Downloads) into study/, imaging/, images/ and docs/ of the data folder.

    Study CSVs keep IDA's names, PDFs that come in a zip of study tables go to docs/, zips are unpacked and then kept
    under downloads/, and other files are left alone.
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
        elif _is_curated(name):
            report.append((name, "curated data cut", _place(path, folder / "study", move), "study"))
        elif name.lower().endswith(".zip") and zipfile.is_zipfile(path):
            unpacked = _unpack(path, folder, move)
            if unpacked:
                report.append((name, *unpacked))
    return _report(report, {"file": "VARCHAR", "kind": "VARCHAR", "action": "VARCHAR", "into": "VARCHAR"})


def _filename(response, url: str) -> str:
    header = Message()
    header["content-disposition"] = response.headers.get("Content-Disposition", "")
    return Path(header.get_filename() or urllib.parse.unquote(urllib.parse.urlparse(url).path)).name or "download.zip"


def _download(url: str, folder: Path, retries: int, label: str | None = None, headers: dict | None = None) -> Path:
    key = sha1(url.encode()).hexdigest()[:16]
    partial, receipt = folder / f".{key}.part", folder / f".{key}.done"
    if receipt.exists() and (folder / receipt.read_text()).exists():
        return folder / receipt.read_text()
    for attempt in range(retries):
        done = partial.stat().st_size if partial.exists() else 0
        request = urllib.request.Request(url, headers={**(headers or {}), **({"Range": f"bytes={done}-"} if done else {})})
        try:
            with _OPENER.open(request, timeout=120) as response:
                start = done if response.status == 206 else 0
                with partial.open("ab" if start else "wb") as sink:
                    shutil.copyfileobj(response, sink, 1 << 20)
                length = response.headers.get("Content-Length")
                if length is not None and partial.stat().st_size < start + int(length):
                    raise ConnectionError(f"Transfer of {label or url} stopped early")
                final = folder / _filename(response, url)
            partial.rename(final)
            if zipfile.is_zipfile(final):
                receipt.write_text(final.name)
            return final
        except (OSError, http.client.HTTPException) as error:
            if attempt == retries - 1:
                if label:
                    raise ConnectionError(f"Could not download {label} ({type(error).__name__})") from None
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Could not download {label or url}")


def _is_page(path: Path) -> bool:
    """True when a download is an HTML page, as IDA sends instead of a file when the session has ended."""
    with path.open("rb") as file:
        start = file.read(512).lstrip().lower()
    return start.startswith((b"<!doctype html", b"<html")) and path.suffix.lower() not in (".html", ".htm")


def fetch(urls: str | Path | list[str], folder: str | Path | None = None, retries: int = 5) -> duckdb.DuckDBPyRelation:
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
        if not zipfile.is_zipfile(path):
            size = path.stat().st_size
            path.unlink()
            warnings.warn(f"{path.name} is not a zip archive, so IDA sent a page instead of data: the link may have expired. "
                          "Save a new URL list in IDA and run fetch again.")
            report.append((path.name, size, 0))
            continue
        with zipfile.ZipFile(path) as archive:
            unpacked = len(_extract(archive, [m for m in archive.namelist() if _is_image(m)], folder / "images", flatten=False))
        report.append((path.name, path.stat().st_size, unpacked))
    return _report(report, {"file": "VARCHAR", "bytes": "BIGINT", "images unpacked": "BIGINT"})


def _quoted(option: str) -> str:
    return option + r"""\s+\$?(['"])(.*?)(?<!\\)\1"""


def _parse_session(text: str, source: str) -> Session:
    """The cookies and user agent in a request copied as cURL, or in a Cookie header."""
    text = text.replace("\\\r\n", " ").replace("\\\n", " ")
    found = (re.search(_quoted(r"(?:^|\s)(?:-b|--cookie)"), text, re.S)
             or re.search(r"""(?:-H|--header)\s+\$?(['"])cookie:\s*(.*?)(?<!\\)\1""", text, re.S | re.I))
    cookie = found[2] if found else None
    if cookie is None:
        line = re.search(r"^\s*cookie:\s*(.+?)\s*$", text, re.I | re.M)
        pairs = re.fullmatch(r"\s*([^\s=;]+=[^;\n]*)(;\s*[^\s=;]+=[^;\n]*)*;?\s*", text)
        cookie = line[1] if line else text.strip() if pairs else None
    if not cookie or "=" not in cookie:
        raise ValueError("No cookies found in what you gave. Copy the studyData.jsp request as cURL, or its Cookie header, "
                         "and run ida.signin() again.")
    agent = (re.search(r"""(?:-H|--header)\s+\$?(['"])user-agent:\s*(.*?)(?<!\\)\1""", text, re.S | re.I)
             or re.search(_quoted(r"(?:^|\s)(?:-A|--user-agent)"), text, re.S))
    return Session(cookie.strip(), agent[2].strip() if agent else AGENT, source)


class _CookieStaysHome(urllib.request.HTTPRedirectHandler):
    """Follow redirects, but never carry the IDA cookie to another host."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None and urllib.parse.urlparse(newurl).hostname != urllib.parse.urlparse(req.full_url).hostname:
            new.remove_header("Cookie")
        return new


_OPENER = urllib.request.build_opener(_CookieStaysHome)


def _headers(session: Session | None, form: bool = False) -> dict[str, str]:
    if session is None:
        return {}
    headers = {"Cookie": session.cookie, "User-Agent": session.agent, "Referer": f"{STUDY_PAGE}?project=PPMI"}
    if form:
        headers |= {"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "Origin": SITE,
                    "X-Requested-With": "XMLHttpRequest"}
    return headers


def _ask(url: str, session: Session, form: str | None = None, retries: int = 3) -> str:
    """One request to IDA with your session; the page or answer it sends, as text."""
    data = None if form is None else form.encode()
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, data=data, headers=_headers(session, form is not None))
            with _OPENER.open(request, timeout=120) as response:
                return response.read().decode(response.headers.get_content_charset() or "utf-8", errors="replace")
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                raise PermissionError(EXPIRED) from None
            failure = f"IDA answered {error.code}"
        except (OSError, http.client.HTTPException) as error:
            failure = f"IDA could not be reached ({type(error).__name__})"
        if attempt == retries - 1:
            raise ConnectionError(f"{failure} for {urllib.parse.urlparse(url).path}") from None
        time.sleep(2 ** attempt)
    raise RuntimeError("unreachable")


def signed_in() -> bool:
    """True once signin() has taken a session that IDA accepted."""
    return _session is not None


def _signed(session: Session | None = None) -> Session:
    if session or _session:
        return session or _session
    raise PermissionError("Run ida.signin() first: it takes your browser's IDA session.")


def _check(page: str) -> str:
    if "studyDataForm" not in page:
        raise PermissionError(EXPIRED)
    return page


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment.replace('\\"', '"')))).strip()


TREE = re.compile(r'\.addCategory\(\s*"([^"]*)"\s*,\s*"((?:[^"\\]|\\.)*)"|\.addSubCategory\(\s*"([^"]*)"\s*,\s*"((?:[^"\\]|\\.)*)"')
ITEM = re.compile(r"""<input\b[^>]*\bname=["']downloadItem["'][^>]*>""", re.I)


def _tree(page: str) -> tuple[dict[str, str], dict[str, tuple[str, str]]]:
    """The categories {id: name} and sub-categories {id: (category id, name)} of the Study Data menu."""
    categories, subcategories, current = {}, {}, None
    for match in TREE.finditer(page):
        if match[1] is not None:
            current = match[1]
            categories[current] = _text(match[2])
        elif current is not None:
            subcategories[match[3]] = (current, _text(match[4]))
    return categories, subcategories


def _items(page: str) -> list[tuple[str, str, str, str | None]]:
    """The files a Study Data page lists: (file ID, sub-category ID, name, version date)."""
    found = list(ITEM.finditer(page))
    items = []
    for match, following in zip(found, found[1:] + [None]):
        file_id = re.search(r"""\bid=["']([^"']+)["']""", match[0])
        subcategory = re.search(r"""\bclass=["']([^"']*)["']""", match[0])
        rest = page[match.end():following.start() if following else match.end() + 4000]
        name = re.search(r"<a\b[^>]*>(.*?)</a>", rest, re.S | re.I)
        version = re.search(r"Version:(?:\s|&nbsp;|\xa0)*(\d{4}-\d{2}-\d{2})", rest)
        if file_id and name:
            items.append((file_id[1], subcategory[1] if subcategory else "", _text(name[1]), version[1] if version else None))
    return items


def signin(text: str | None = None, folder: str | Path | None = None) -> duckdb.DuckDBPyRelation:
    """Take your browser's IDA session: pasted into a hidden box, given as text, or saved as data/ida/session.txt.

    signin() checks the session by opening Study Data with it, then keeps it in memory for offer() and download().
    """
    global _session
    saved = root(folder) / "ida" / "session.txt"
    if text is None and saved.exists():
        text, source = saved.read_text(encoding="utf-8", errors="replace"), f"ida/{saved.name}"
    elif text is None:
        text, source = getpass.getpass("Paste the studyData.jsp request copied as cURL, or its Cookie header: "), "pasted"
    else:
        source = "given"
    session = _parse_session(text, source)
    categories, subcategories = _tree(_check(_ask(f"{STUDY_PAGE}?project=PPMI", session)))
    _session = session
    return _report([("signed in", source, len(categories), len(subcategories))],
                   {"session": "VARCHAR", "from": "VARCHAR", "categories": "BIGINT", "sub-categories": "BIGINT"})


def offer(folder: str | Path | None = None, pause: float = 0.5, session: Session | None = None) -> duckdb.DuckDBPyRelation:
    """List every study file IDA offers you, category by category, into data/ida/offer.csv, and return the list.

    It opens each category of Download > Study Data as the page's ALL link does, and any sub-category that listing
    left out on its own; pause is the wait between requests, in seconds.
    """
    session = _signed(session)
    categories, subcategories = _tree(_check(_ask(f"{STUDY_PAGE}?project=PPMI", session)))
    if not categories:
        raise ValueError("IDA's Study Data page has no category menu that this module recognises.")
    files, seen = {}, set()

    def take(page: str, category: str) -> None:
        for file_id, subcategory, name, version in _items(_check(page)):
            seen.add(subcategory)
            owner, label = subcategories.get(subcategory, (category, ""))
            files.setdefault(file_id, (file_id, name, categories.get(owner, ""), label, version))

    for category in categories:
        time.sleep(pause)
        take(_ask(f"{STUDY_PAGE}?categoryId={category}", session, form="itemDesc="), category)
    for subcategory, (category, _) in subcategories.items():
        if subcategory not in seen:
            time.sleep(pause)
            take(_ask(f"{STUDY_PAGE}?categoryId={category}&subCategoryId={subcategory}", session, form="itemDesc="), category)
    listing = _report(sorted(files.values(), key=lambda row: (row[2], row[3], row[1])),
                      {"file_id": "VARCHAR", "name": "VARCHAR", "group": "VARCHAR", "subgroup": "VARCHAR", "updated": "DATE"})
    target = root(folder) / "ida" / "offer.csv"
    target.parent.mkdir(parents=True, exist_ok=True)
    listing.write_csv(str(target), header=True)
    return listing


def _file_downloads(landing: Path, folder: Path) -> dict[str, str]:
    """File what download() fetched: zips unpacked as collect() unpacks them, tables into study/, PDFs into docs/.
    A file whose name is already there is the same download again, so the new copy is removed."""
    filed = {}
    for path in sorted(landing.iterdir()):
        if not path.is_file() or path.name.startswith("."):
            continue
        suffix = path.suffix.lower()
        if suffix == ".zip" and zipfile.is_zipfile(path):
            unpacked = _unpack(path, folder, move=True)
            filed[path.name] = f"{unpacked[1]} into {unpacked[2]}" if unpacked else "left in downloads/ida: it holds no tables or images"
            continue
        target = "study" if suffix in (".csv", ".xlsx", ".xls") else "docs" if suffix == ".pdf" else None
        if target is None:
            filed[path.name] = "left in downloads/ida"
        elif (folder / target / path.name).exists():
            path.unlink()
            filed[path.name] = f"already in {target}, so the new copy was removed"
        else:
            filed[path.name] = f"{_place(path, folder / target, True)} into {target}"
    return filed


def download(file_ids, folder: str | Path | None = None, batch: int = 10, retries: int = 5,
             session: Session | None = None) -> duckdb.DuckDBPyRelation:
    """Download study files by their IDA file ID with your session, then file them into study/ and docs/.

    file_ids is any list of IDs, such as p.column("SELECT file_id FROM available WHERE ..."); a value holding several
    IDs separated by commas counts as each of them. IDA answers each batch with the paths of its files, and each path
    is downloaded in turn. If IDA has signed you out, sign in again, run ida.signin() and rerun.
    """
    session = _signed(session)
    folder = root(folder)
    ids = list(dict.fromkeys(part.strip() for value in file_ids for part in str(value).split(",") if part.strip()))
    columns = {"file IDs": "VARCHAR", "file": "VARCHAR", "result": "VARCHAR"}
    if not ids:
        return _report([], columns)
    landing = folder / "downloads" / "ida"
    landing.mkdir(parents=True, exist_ok=True)
    fetched, empty = [], []
    for start in range(0, len(ids), batch):
        chunk = ids[start:start + batch]
        answer = _ask(STUDY_PATHS, session, form="fileId~=" + "~".join(chunk))
        paths = [html.unescape(path) for path in re.findall(r"""<path\b[^>]*\bname=["']([^"']+)["']""", answer)]
        if not paths:
            if "studyData" not in answer:
                raise PermissionError(EXPIRED)
            empty.append((", ".join(chunk), "", "IDA sent no file for these IDs"))
            continue
        for path in paths:
            name = Path(path).name
            got = _download(STUDY_FILES + urllib.parse.quote(path.lstrip("/"), safe="/"), landing, retries, label=name,
                            headers=_headers(session))
            if got.suffix.lower() in (".html", ".htm", ".jsp") or _is_page(got):
                got.unlink()
                raise PermissionError(EXPIRED)
            fetched.append((", ".join(chunk), got.name))
    filed = _file_downloads(landing, folder)
    return _report([(chunk, name, filed.get(name, "downloaded")) for chunk, name in fetched] + empty, columns)
