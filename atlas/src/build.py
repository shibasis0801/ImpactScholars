"""Build the PPMI Atlas page from the guide.

Usage: python3 atlas/src/build.py   (reads guide.html, template.html, explorers/*.js, media.json)
Writes: atlas/index.html
"""
import html
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

R = Path(__file__).resolve().parent
SRC = R / "guide.html"

src = SRC.read_text(encoding="utf-8")

# --------------------------------------------------------------------------------------------
# Diagrams: SVG ports of the three widgets in the doc (same geometry, theme tokens via --cds-*).
# --------------------------------------------------------------------------------------------
INK, QUIET, EDGE = "var(--cds-text-primary)", "var(--cds-text-secondary)", "var(--cds-chart-axis)"
GRID, TINT = "var(--cds-chart-grid)", "var(--cds-chart-reference-tint)"
C1, C2, BAD = "var(--cds-chart-categorical-1)", "var(--cds-chart-categorical-2)", "var(--cds-chart-status-critical)"


def esc(s):
    return html.escape(s, quote=False)


def t(x, y, words, size=13, weight=None, fill=INK, anchor=None):
    a = f' text-anchor="{anchor}"' if anchor else ""
    w = f' font-weight="{weight}"' if weight else ""
    return f'<text x="{x:g}" y="{y:g}" font-size="{size}"{w}{a} fill="{fill}">{esc(words)}</text>'


def marker(mid, fill):
    return (f'<marker id="{mid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" '
            f'orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="{fill}"/></marker>')


def svg_model():
    t0, tx, tw, th, cx, rx, ry = 120, 520, 216, 56, 300, 78, 36
    dy, sy, my = t0 + 82, t0 + 334, t0 + 208
    ty = [t0 + 72 * i for i in range(6)]
    o = ['<svg viewBox="0 0 760 660" role="img" aria-label="Two hidden stages, and every cognitive test may load on both" '
         'font-family="var(--font-ui)">',
         "<defs>" + marker("tp-arrow", EDGE) + marker("tp-arrow-d", C1) + marker("tp-arrow-s", C2) + "</defs>",
         t(24, 34, "Two hidden stages, and every cognitive test may load on both", 15, 600),
         t(24, 56, "Ovals are hidden stages and boxes are measurements; arrows run from a stage to what it shapes.", 11.5, fill=QUIET),
         t(24, 72, "“Predicted” marks the lean the dual syndrome hypothesis expects (section 3.5); the data decide.", 11.5, fill=QUIET),
         t(104, 108, "Imaging anchors", 11.5, 600, QUIET, "middle"),
         t(cx, 108, "Hidden stages", 11.5, 600, QUIET, "middle"),
         t(tx + 16, 108, "Cognitive tests", 11.5, 600, QUIET)]
    o.append(f'<g fill="none" stroke="{C1}" stroke-width="1.25">' + "".join(
        f'<path d="M{cx + rx} {dy}L{tx} {y + th / 2 - 6:g}" marker-end="url(#tp-arrow-d)"/>' for y in ty) + "</g>")
    o.append(f'<g fill="none" stroke="{C2}" stroke-width="1.25">' + "".join(
        f'<path d="M{cx + rx} {sy}L{tx} {y + th / 2 + 6:g}" marker-end="url(#tp-arrow-s)"/>' for y in ty) + "</g>")
    o.append(f'<rect x="24" y="{dy - 44}" width="160" height="88" rx="8" fill="none" stroke="{C1}" stroke-width="1.25"/>'
             f'<path d="M{cx - rx} {dy}H184" fill="none" stroke="{C1}" stroke-width="1.25" marker-end="url(#tp-arrow-d)"/>')
    o += [t(104, dy - 20, "DaTScan SPECT", 13, 600, anchor="middle"), t(104, dy - 4, "4 binding ratios:", 11.5, fill=QUIET, anchor="middle"),
          t(104, dy + 12, "caudate L and R,", 11.5, fill=QUIET, anchor="middle"), t(104, dy + 28, "putamen L and R", 11.5, fill=QUIET, anchor="middle")]
    o.append(f'<rect x="24" y="{sy - 36}" width="160" height="72" rx="8" fill="none" stroke="{C2}" stroke-width="1.25"/>'
             f'<path d="M{cx - rx} {sy}H184" fill="none" stroke="{C2}" stroke-width="1.25" marker-end="url(#tp-arrow-s)"/>')
    o += [t(104, sy - 12, "T1-weighted MRI", 13, 600, anchor="middle"), t(104, sy + 4, "grey-matter measures,", 11.5, fill=QUIET, anchor="middle"),
          t(104, sy + 20, "not yet chosen", 11.5, fill=QUIET, anchor="middle")]
    for yy, c, name, line in ((dy, C1, "D", "dopaminergic stage"), (sy, C2, "S", "structural stage")):
        o.append(f'<ellipse cx="{cx}" cy="{yy}" rx="{rx}" ry="{ry}" fill="{c}" fill-opacity="0.12" stroke="{c}" stroke-width="2"/>')
        o += [t(cx, yy - 2, name, 15, 600, anchor="middle"), t(cx, yy + 16, line, 11.5, anchor="middle")]
    o.append(f'<rect x="{cx - 78}" y="{my - 28}" width="156" height="56" rx="8" fill="none" stroke="{EDGE}" stroke-width="1.25"/>'
             f'<path d="M{cx} {my - 28}V{dy + ry}" fill="none" stroke="{EDGE}" stroke-width="1.25" marker-end="url(#tp-arrow)"/>'
             f'<path d="M{cx} {my + 28}V{sy - ry}" fill="none" stroke="{EDGE}" stroke-width="1.25" marker-end="url(#tp-arrow)"/>')
    o += [t(cx, my - 4, "Time, t", 13, 600, anchor="middle"), t(cx, my + 12, "years since baseline", 11.5, fill=QUIET, anchor="middle"),
          t(cx - 8, (my - 28 + dy + ry) / 2 + 4, "+ person offset δD", 11.5, anchor="end"),
          t(cx - 8, (my + 28 + sy - ry) / 2 + 4, "+ person offset δS", 11.5, anchor="end"),
          t(cx - 90, my + 4, "δD and δS correlate (Ω)", 11.5, fill=QUIET, anchor="end")]
    tests = [("Letter-Number Sequencing", "working memory · predicted D"), ("Symbol Digit Modalities", "processing speed · predicted D"),
             ("HVLT-R immediate recall", "learning · no prediction"), ("HVLT-R delayed recall", "verbal memory · predicted S"),
             ("Benton line orientation", "visuospatial · predicted S"), ("Semantic fluency", "verbal fluency · predicted S")]
    for y, (name, line) in zip(ty, tests):
        o.append(f'<rect x="{tx}" y="{y}" width="{tw}" height="{th}" rx="8" fill="none" stroke="{EDGE}" stroke-width="1.25"/>')
        o += [t(tx + 16, y + 24, name, 13, 600), t(tx + 16, y + 40, line, 11.5, fill=QUIET)]
    o.append(f'<rect x="24" y="560" width="712" height="76" rx="8" fill="{TINT}" stroke="{EDGE}" stroke-width="1.25"/>')
    o += [t(40, 584, "One-stage alternative: δD = δS, so a single clock drives everything", 13, 600),
          t(40, 604, "Primary test: which model better predicts later measurements of held-out participants", 11.5),
          t(40, 620, "Each test is also adjusted for age, sex, education, practice effects and levodopa-equivalent dose", 11.5, fill=QUIET)]
    o.append("</svg>")
    return "".join(o)


def svg_bg():
    lx, mx, bw, bh, lc, mc = 64, 312, 200, 56, 164, 412
    rowB, rowC, rowD, rowE = 228, 340, 436, 532

    def box(x, y):
        return f'<rect x="{x}" y="{y}" width="{bw}" height="{bh}" rx="8" fill="none" stroke="{EDGE}" stroke-width="1.25"/>'

    bar = ('<marker id="bg-bar" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto">'
           f'<path d="M7 0H10V10H7z" fill="{EDGE}"/></marker>')
    o = ['<svg viewBox="0 0 760 628" role="img" aria-label="Without dopamine, GPi and SNr over-inhibit the thalamus" font-family="var(--font-ui)">',
         "<defs>" + marker("bg-arrow", EDGE) + bar + marker("bg-arrow-da", BAD) + "</defs>",
         t(24, 34, "Without dopamine, GPi and SNr over-inhibit the thalamus", 15, 600),
         t(24, 54, "One cortico-basal ganglia-thalamic loop; the same design repeats for motor, eye, prefrontal and limbic cortex", 11.5, fill=QUIET),
         f'<path d="M24 76H52" fill="none" stroke="{EDGE}" stroke-width="1.25" marker-end="url(#bg-arrow)"/>', t(60, 80, "excites", 11.5, fill=QUIET),
         f'<path d="M120 76H148" fill="none" stroke="{EDGE}" stroke-width="1.25" stroke-dasharray="5 4" marker-end="url(#bg-bar)"/>', t(156, 80, "inhibits", 11.5, fill=QUIET),
         f'<path d="M220 76H248" fill="none" stroke="{BAD}" stroke-width="2" marker-end="url(#bg-arrow-da)"/>', t(256, 80, "dopamine, lost in PD", 11.5, fill=QUIET),
         f'<g fill="none" stroke="{EDGE}" stroke-width="1.25">'
         f'<path d="M{lc} 156V{rowB}" marker-end="url(#bg-arrow)"/><path d="M{mc} 156V{rowB}" marker-end="url(#bg-arrow)"/>'
         f'<path d="M{mx} {rowD + 28}H{lx + bw}" marker-end="url(#bg-arrow)"/>'
         f'<path d="M{lx} {rowE + 28}H32V128H48" marker-end="url(#bg-arrow)"/>'
         f'<path d="M728 156V{rowD + 28}H{mx + bw}" marker-end="url(#bg-arrow)"/></g>',
         f'<g fill="none" stroke="{EDGE}" stroke-width="1.25" stroke-dasharray="5 4">'
         f'<path d="M{lc} {rowB + bh}V{rowD}" marker-end="url(#bg-bar)"/><path d="M{mc} {rowB + bh}V{rowC}" marker-end="url(#bg-bar)"/>'
         f'<path d="M{mc} {rowC + bh}V{rowD}" marker-end="url(#bg-bar)"/><path d="M{lc} {rowD + bh}V{rowE}" marker-end="url(#bg-bar)"/></g>',
         f'<path d="M568 256H528" fill="none" stroke="{BAD}" stroke-width="2" marker-end="url(#bg-arrow-da)"/>',
         f'<rect x="48" y="100" width="696" height="56" rx="8" fill="none" stroke="{EDGE}" stroke-width="1.25"/>',
         t(396, 124, "Cerebral cortex", 13, 600, anchor="middle"), t(396, 140, "motor, prefrontal and cingulate areas", 11.5, fill=QUIET, anchor="middle"),
         f'<rect x="48" y="196" width="480" height="104" rx="8" fill="none" stroke="{EDGE}" stroke-width="1.25"/>',
         t(288, 218, "Striatum: caudate, putamen", 13, 600, anchor="middle")]
    for x, y, c, name, line in ((lx, rowB, lc, "D1 cells", "direct; dopamine excites"), (mx, rowB, mc, "D2 cells", "indirect; dopamine inhibits"),
                                (mx, rowC, mc, "GPe", "globus pallidus, external"), (lx, rowD, lc, "GPi and SNr", "output nuclei"),
                                (mx, rowD, mc, "STN", "subthalamic nucleus"), (lx, rowE, lc, "Thalamus", "relays output to cortex")):
        o += [box(x, y), t(c, y + 24, name, 13, 600, anchor="middle"), t(c, y + 40, line, 11.5, fill=QUIET, anchor="middle")]
    o += [f'<rect x="568" y="212" width="136" height="88" rx="8" fill="{BAD}" fill-opacity="0.12" stroke="{BAD}" stroke-width="2"/>',
          t(636, 236, "SNc", 13, 600, anchor="middle"), t(636, 252, "dopamine neurons;", 11.5, anchor="middle"),
          t(636, 268, "those feeding the", 11.5, anchor="middle"), t(636, 284, "putamen die first", 11.5, anchor="middle"),
          f'<rect x="312" y="{rowE}" width="392" height="72" rx="8" fill="{BAD}" fill-opacity="0.12" stroke="{BAD}" stroke-width="1.25"/>',
          t(328, rowE + 24, "When dopamine is lost", 13, 600), t(328, rowE + 40, "GPi and SNr are overactive, so thalamus and cortex are", 11.5),
          t(328, rowE + 56, "underdriven: slow, small movements (bradykinesia)", 11.5),
          t(lc - 8, 372, "direct pathway", 11.5, fill=QUIET, anchor="end"), t(mc + 8, 324, "indirect pathway", 11.5, fill=QUIET),
          t(620, rowD + 20, "hyperdirect: a fast brake", 11.5, fill=QUIET, anchor="middle"), "</svg>"]
    return "".join(o)


def svg_plan():
    rows = [("define", 0, 1, "Define", "freeze cohort, measures, plan", ["Gate 1", "signed-off analysis plan", "and one cohort table"]),
            ("simulate", 1, 2, "Simulate and prepare", "simulation, baselines, T1 QC", ["Gate 2", "one vs two is decidable", "at the sample size;", "if not, simplify"]),
            ("fit", 2, 4, "Fit and compare", "nested CV, 2.5-year landmark", ["Gate 3", "apply the decision rule,", "lock the primary result"]),
            ("validate", 4, 5, "Validate and interpret", "milestones, NSD-ISS, genetics", ["Gate 4", "a clinician: the biology;", "a second reader: the claims"]),
            ("write", 5, 6, "Write and release", "paper, code, preprint", ["Gate 5", "committee clearance,", "then submission"])]
    X = lambda m: 236 + 52 * m
    o = ['<svg viewBox="0 0 760 480" role="img" aria-label="Each phase ends at a gate: proceed, or simplify" font-family="var(--font-ui)">',
         t(24, 34, "Each phase ends at a gate: proceed, or simplify", 15, 600),
         t(24, 54, "The six-month plan of section 12.1; each bar spans the months its phase takes", 11.5, fill=QUIET),
         t(24, 88, "Phase", 11.5, 600, QUIET), t(220, 88, "Month", 11.5, 600, QUIET, "end"), t(584, 88, "Gate criteria", 11.5, 600, QUIET)]
    o += [f'<line x1="{X(m)}" x2="{X(m)}" y1="96" y2="456" stroke="{GRID}"/>' for m in range(7)]
    o += [t(X(m - 0.5), 88, str(m), 11.5, fill=QUIET, anchor="middle") for m in range(1, 7)]
    o.append(f'<line x1="{X(0)}" x2="{X(6)}" y1="96" y2="96" stroke="{EDGE}" stroke-width="1.25"/>')
    for i, (key, a, b, name, line, gate) in enumerate(rows):
        y = 128 + 72 * i
        o.append(f'<rect x="{X(a) + 2}" y="{y - 11}" width="{X(b) - X(a) - 4}" height="14" rx="7" fill="{EDGE}" fill-opacity="0.18" stroke="{EDGE}" stroke-width="1.25"/>')
        o.append(f'<line x1="{X(b) + 10}" x2="576" y1="{y - 4}" y2="{y - 4}" stroke="{GRID}" stroke-dasharray="2 3"/>')
        o.append(f'<path d="M{X(b)} {y - 13}l9 9l-9 9l-9 -9z" fill="{C1}" fill-opacity="0.3" stroke="{C1}" stroke-width="1.5"/>')
        o += [t(24, y, name, 13, 600), t(24, y + 16, line, 11.5, fill=QUIET), t(584, y, gate[0], 13, 600)]
        o += [t(584, y + 16 * (j + 1), g, 11.5) for j, g in enumerate(gate[1:])]
    o.append("</svg>")
    return "".join(o)


FIGURES = {"node/8adfd081-85e6": ("fig-model", svg_model), "node/2e310107-a027": ("fig-basal-ganglia", svg_bg),
           "node/b2b99a2e-39e9": ("fig-plan", svg_plan)}

# --------------------------------------------------------------------------------------------
# Structure: headings, numbering
# --------------------------------------------------------------------------------------------
heads = [(int(m.group(1)), m.group(2), html.unescape(re.sub(r"<[^>]+>", "", m.group(3))))
         for m in re.finditer(r'<h([123]) id="([^"]+)">(.*?)</h\1>', src)]
num_to_id, sections = {}, []
for lvl, hid, text in heads:
    m = re.match(r"(\d+(?:\.\d+)?)\.?\s", text)
    if m and lvl in (2, 3):
        num_to_id[m.group(1)] = hid
    if lvl == 2:
        sections.append({"id": hid, "title": text, "num": (m.group(1) if m else ""), "subs": []})
    elif lvl == 3 and sections:
        sections[-1]["subs"].append({"id": hid, "title": text, "num": (m.group(1) if m else "")})

# --------------------------------------------------------------------------------------------
# Glossary
# --------------------------------------------------------------------------------------------
g0, s0 = src.find('<h2 id="13-glossary">'), src.find('<h2 id="sources">')
glossary = []
for row in re.findall(r"<tr>(.*?)</tr>", src[g0:s0], flags=re.S)[1:]:
    cells = re.findall(r"<td>(.*?)</td>", row, flags=re.S)
    if len(cells) != 2:
        continue
    label = html.unescape(re.sub(r"<[^>]+>", "", cells[0])).strip()
    keys = [k.strip() for k in label.split(",") if len(k.strip()) >= 2]
    glossary.append({"id": f"g{len(glossary) + 1}", "label": label, "keys": keys, "def": cells[1].strip(),
                     "code": "<code>" in cells[0]})
EXTRA_VARIANTS = {"DaTscan": ["DaTScan"], "Nested cross-validation": ["nested cross-validation"], "Landmarking": ["landmarking", "landmark"],
                  "occipital": [], "free water": ["free-water"]}
key_to_gid = {}
for g in glossary:
    for k in g["keys"]:
        key_to_gid.setdefault(k, g["id"])
        for v in EXTRA_VARIANTS.get(k, []):
            key_to_gid.setdefault(v, g["id"])
GLOSS_KEYS = sorted(key_to_gid, key=len, reverse=True)
gloss_re = re.compile(r"(?<![\w\-./])(" + "|".join(re.escape(html.escape(k, quote=False)) for k in GLOSS_KEYS) + r")(?![\w\-])")

# --------------------------------------------------------------------------------------------
# References (Sources section)
# --------------------------------------------------------------------------------------------
refs, ref_key = [], {}
cur_group = None
for m in re.finditer(r'<h3 id="([^"]+)">(.*?)</h3>|<li>(.*?)</li>', src[s0:], flags=re.S):
    if m.group(1):
        cur_group = m.group(1)
        continue
    inner = m.group(3)
    txt = html.unescape(re.sub(r"<[^>]+>", "", inner)).strip()
    rid = f"r{len(refs) + 1}"
    year = surname = None
    if cur_group == "papers":
        ym = re.search(r"\.\s((?:19|20)\d{2})\.\s", txt)
        if ym:
            year, authors = ym.group(1), txt[:ym.start()]
    elif cur_group == "books":
        ym = re.search(r",\s((?:19|20)\d{2})\.(?:\s|$)", txt)
        if ym:
            year, authors = ym.group(1), txt.split(". ")[0]
    if year:
        first = authors.split(",")[0].strip()
        parts = first.split()
        if len(parts) > 1 and re.fullmatch(r"[A-Z]{1,3}", parts[-1]):
            parts = parts[:-1]
        if parts[-2:] == ["et", "al"]:
            parts = parts[:-2]
        surname = " ".join(parts)
        ref_key[(surname, year)] = rid
    doi = re.search(r'href="([^"]+)"', inner)
    refs.append({"id": rid, "group": cur_group, "html": inner.replace("<p>", "").replace("</p>", ""), "text": txt,
                 "year": int(year) if year else None, "surname": surname, "url": html.unescape(doi.group(1)) if doi else None,
                 "cited": []})
BOOK_NAMES = {"Purves", "Blumenfeld", "Kandel", "McElreath", "Fitzmaurice", "Rizopoulos"}
book_ref = {r["surname"]: r["id"] for r in refs if r["group"] == "books" and r["surname"] in BOOK_NAMES}

NAME = r"(?:(?:van|von|Van|Di|de|Avila)\s)?[A-ZÀ-Ý][\w’\-]+(?:\s(?:Pérez))?"
cite_re = re.compile(
    r"(?<![\w>])(?P<name>" + NAME + r")(?P<mid>\set\sal\.|(?:,\s[A-ZÀ-Ý][\w\-]+)*\s(?:&amp;|and)\s(?:(?:van|Van|Den|de)\s)*[A-ZÀ-Ý][\w\-]+)?,?\s(?P<years>(?:19|20)\d{2}(?:,\s(?:19|20)\d{2})*)(?!\d)")
book_re = re.compile(r"(?<![\w>])(" + "|".join(sorted(book_ref)) + r")(?![\w])") if book_ref else None

# --------------------------------------------------------------------------------------------
# Text transforms
# --------------------------------------------------------------------------------------------
TAG = re.compile(r"(<[^>]+>)")
VOID = {"input", "br", "img", "hr"}
xref_re = re.compile(r"(?<![\w.])((?:[Ss]ections?|§)\s)(\d{1,2}(?:\.\d)?)((?:(?:,\s|\s(?:and|or|to)\s)\d{1,2}(?:\.\d)?)*)")
xref_log, cite_log, unknown_cites = [], Counter(), Counter()


def link_xrefs(text, ctx):
    def one(m):
        before = text[max(0, m.start() - 16):m.start()]
        after = text[m.end():m.end() + 24]
        if "notebook" in before or "notebook" in after or "Supplementary" in before:
            xref_log.append(("skip", before + m.group(0) + after))
            return m.group(0)
        def num_link(n):
            hid = num_to_id.get(n)
            return f'<a class="xref" href="#{hid}" data-x="{hid}">{n}</a>' if hid else n
        rest = re.sub(r"\d{1,2}(?:\.\d)?", lambda k: num_link(k.group(0)), m.group(3))
        xref_log.append(("link", m.group(0)))
        return m.group(1) + num_link(m.group(2)) + rest
    return xref_re.sub(one, text)


ALIASES = [(re.compile(r"(?<![\w>])PPMI 2011(?!\d)"), ("Marek", "2011")),
           (re.compile(r"Hoehn and Yahr(?: stages)? \(1967\)"), ("Hoehn", "1967")),
           (re.compile(r"Gelman, Hill &amp; Vehtari"), ("Gelman", "2020")),
           (re.compile(r"(?<![\w>])James et al\.(?=,\s*$)"), ("James", "2023")),
           (re.compile(r"Little &amp; Rubin"), ("Little", "2019")),
           (re.compile(r"(?<![\w>])Brown(?=,\s*$)"), ("Brown", "2015"))]


def link_cites(text, ctx):
    for rx, key in ALIASES:
        r = ref_key.get(key)
        if not r:
            continue
        def al(m, r=r):
            ctx["cited"].add(r)
            cite_log[r] += 1
            return f'<a class="cite" href="#ref-{r}" data-ref="{r}">{m.group(0)}</a>'
        text = rx.sub(al, text)

    def one(m):
        name = m.group("name")
        years = re.findall(r"(?:19|20)\d{2}", m.group("years"))
        hits = [(y, ref_key.get((name, y))) for y in years]
        if not any(r for _, r in hits):
            if re.match(r"[A-Z]", name) and name not in {"Since", "In", "By", "The", "From", "Until", "Version", "April", "September", "November", "August"}:
                unknown_cites[name + " " + m.group("years")] += 1
            return m.group(0)
        first_y, first_r = hits[0]
        lead = m.group(0)[: m.start("years") - m.start()] + first_y
        out = []
        for i, (y, r) in enumerate(hits):
            label = lead if i == 0 else y
            if r:
                out.append(f'<a class="cite" href="#ref-{r}" data-ref="{r}">{label}</a>')
                ctx["cited"].add(r)
                cite_log[r] += 1
            else:
                out.append(label)
        return ", ".join(out)
    text = cite_re.sub(one, text)
    if book_re:
        def bk(m):
            r = book_ref[m.group(1)]
            ctx["cited"].add(r)
            cite_log[r] += 1
            return f'<a class="cite" href="#ref-{r}" data-ref="{r}">{m.group(1)}</a>'
        text = book_re.sub(bk, text)
    return text


def mark_terms(text, ctx):
    def one(m):
        raw = m.group(1)
        key = html.unescape(raw)
        gid = key_to_gid.get(key)
        if not gid or gid in ctx["seen"]:
            return raw
        ctx["seen"].add(gid)
        ctx["terms"][gid] += 1
        return f'<span class="term" data-g="{gid}" tabindex="0">{raw}</span>'
    return gloss_re.sub(one, text)


def transform(body, sec_id, ctx):
    """Walk text nodes; skip inside a, code, headings, pre, figure, svg, th."""
    out, stack = [], []
    skip = {"a", "code", "h1", "h2", "h3", "pre", "figure", "figcaption", "svg", "th", "time", "span"}
    for tok in TAG.split(body):
        if not tok:
            continue
        if tok.startswith("<"):
            m = re.match(r"<\s*(/)?\s*([a-zA-Z0-9]+)", tok)
            if m:
                name = m.group(2).lower()
                if m.group(1):
                    while stack and stack[-1] != name:
                        stack.pop()
                    if stack:
                        stack.pop()
                elif name not in VOID and not tok.endswith("/>"):
                    stack.append(name)
                if name == "h3" and not m.group(1):
                    ctx["seen"] = set()
            out.append(tok)
            continue
        if any(s in skip for s in stack):
            out.append(tok)
            continue
        tok = link_xrefs(tok, ctx)
        if ctx["link_cites"]:
            parts = TAG.split(link_cites(tok, ctx))
            tok = "".join(p if p.startswith("<") else p for p in parts)
        if ctx["mark_terms"]:
            parts = TAG.split(tok)
            inside_a = False
            buf = []
            for p in parts:
                if p.startswith("<a "):
                    inside_a = True
                elif p.startswith("</a"):
                    inside_a = False
                elif not p.startswith("<") and not inside_a:
                    p = mark_terms(p, ctx)
                buf.append(p)
            tok = "".join(buf)
        out.append(tok)
    return "".join(out)


def code_terms(body, ctx):
    def one(m):
        key = html.unescape(m.group(1))
        gid = key_to_gid.get(key)
        if not gid:
            return m.group(0)
        ctx["terms"][gid] += 1
        return f'<code class="term" data-g="{gid}" tabindex="0">{m.group(1)}</code>'
    return re.sub(r"<code>([^<]{2,24})</code>", one, body)


# --------------------------------------------------------------------------------------------
# Assemble
# --------------------------------------------------------------------------------------------
h1_end = src.find("</h1>") + 5
first_h2 = src.find("<h2 ")
cover = src[:first_h2]
DATE = re.search(r'<time data-atom="date" datetime="([^"]+)">', cover).group(1)
LONG_DATE = datetime.strptime(DATE, "%Y-%m-%d").strftime("%-d %B %Y")
cover = re.sub(r'<time data-atom="date" datetime="([^"]+)">[^<]*</time>', rf'<time datetime="\1">{LONG_DATE}</time>', cover)

chunks = re.split(r'(?=<h2 id=")', src[first_h2:])
term_counts = Counter()
sections_html = []
for ch in chunks:
    if not ch.strip():
        continue
    hid = re.match(r'<h2 id="([^"]+)"', ch).group(1)
    is_gloss, is_src = hid == "13-glossary", hid == "sources"
    ctx = {"seen": set(), "terms": term_counts, "cited": set(), "link_cites": not is_src and not is_gloss,
           "mark_terms": not is_src and not is_gloss}
    # figures
    def fig(m):
        fid, fn = FIGURES[m.group(1)]
        return f'<figure class="fig" id="{fid}">{fn()}<figcaption>{m.group(2)}</figcaption></figure>'
    ch = re.sub(r'<figure data-embed="([^"]+)"><figcaption>(.*?)</figcaption></figure>', fig, ch, flags=re.S)
    # math
    ch = re.sub(r'<pre><code class="language-latex">(.*?)</code></pre>',
                lambda m: f'<div class="math" data-tex="{html.escape(html.unescape(m.group(1)), quote=True)}"><pre class="tex">{m.group(1)}</pre></div>', ch, flags=re.S)
    # tables
    ch = ch.replace("<table>", '<div class="tbl"><table>').replace("</table>", "</table></div>")
    # external links
    ch = re.sub(r'<a href="(https?://[^"]+)">', r'<a href="\1" target="_blank" rel="noopener noreferrer">', ch)
    if not is_src and not is_gloss:
        ch = code_terms(ch, ctx)
    ch = transform(ch, hid, ctx)
    # current H3 for backlinks: approximate by scanning the chunk per h3
    for r in ctx["cited"]:
        pass
    if is_src:
        # give each reference an anchor id
        idx = iter(refs)
        def li(m):
            r = next(idx)
            return f'<li id="ref-{r["id"]}" data-ref="{r["id"]}">'
        ch = re.sub(r"<li>", li, ch)
    if is_gloss:
        gi = iter(glossary)
        def tr(m):
            g = next(gi)
            return f'<tr id="gl-{g["id"]}">'
        rows_split = ch.split("<tbody>")
        if len(rows_split) == 2:
            rows_split[1] = re.sub(r"<tr>", tr, rows_split[1])
            ch = "<tbody>".join(rows_split)
    sections_html.append(f'<section class="sec" data-sec="{hid}">{ch}</section>')

# backlinks per H3: recompute by scanning the final html
content = "".join(sections_html)
cur_sec = None
for m in re.finditer(r'<h[23] id="([^"]+)"|data-ref="(r\d+)"', content):
    if m.group(1):
        cur_sec = m.group(1)
    elif cur_sec not in ("sources",) and cur_sec is not None:
        rid = m.group(2)
        r = refs[int(rid[1:]) - 1]
        if cur_sec not in r["cited"]:
            r["cited"].append(cur_sec)
# The Sources list items themselves carry data-ref; drop self-citations from the sources section
for r in refs:
    r["cited"] = [c for c in r["cited"] if c not in ("sources", "ppmi-documents-and-pages", "books", "papers")]

# paragraph ids for search and deep links
pid = 0
def add_pid(m):
    global pid
    pid += 1
    return f'<{m.group(1)} data-pid="p{pid}"{m.group(2)}>'
content = re.sub(r"<(p|li)((?:\s[^>]*)?)>", add_pid, content)

# --------------------------------------------------------------------------------------------
# Explorer map (heading id -> explorers, first = primary)
# --------------------------------------------------------------------------------------------
EXPLORE = {
    "1-the-worked-example-at-a-glance": ["twoclock"], "the-model-in-plain-words": ["twoclock"], "decisions-to-make-in-order": ["twoclock", "schedule"],
    "2-ppmi": ["schedule"], "21-design-and-history": ["schedule"], "22-cohorts": ["schedule"], "23-visits-and-the-schedule": ["schedule"],
    "24-imaging": ["datscan", "schedule"], "25-clinical-and-biospecimen-data": ["schedule"], "26-getting-and-using-the-data": ["schedule"],
    "3-the-neuroscience": ["basalganglia"], "31-what-goes-wrong": ["basalganglia", "datscan"], "32-the-nigrostriatal-dopamine-system": ["datscan", "basalganglia"],
    "33-the-basal-ganglia-circuits": ["basalganglia"], "34-beyond-dopamine": ["basalganglia", "battery"],
    "35-why-cognition-declines-the-dual-syndrome-hypothesis": ["battery", "twoclock"], "36-the-clinical-picture-in-one-paragraph": ["basalganglia"],
    "37-where-to-read-more": ["literature"],
    "4-how-each-measurement-is-taken": ["battery"], "41-clinical-scales": ["battery"], "42-the-six-cognitive-tests": ["battery"],
    "43-datscan-spect": ["datscan"], "44-structural-mri": ["twoclock"], "45-biospecimens": ["schedule"],
    "46-properties-of-these-measures-that-matter-for-modelling": ["pooling", "missing"],
    "5-the-data-we-have": ["schedule"], "51-what-ppmi-offers": ["schedule"], "52-getting-the-data": ["schedule"], "53-one-sql-interface": ["schedule"],
    "54-the-clean-layer": ["schedule"], "55-counting-what-you-have": ["missing", "schedule"], "56-caveats-to-keep-in-mind": ["missing", "schedule"], "57-the-repository-and-its-notebooks": ["schedule"],
    "6-processing-and-analysis-by-modality": ["battery"], "61-cognition": ["battery"], "62-datscan": ["datscan"],
    "63-structural-mri": ["twoclock"], "64-putting-the-modalities-on-one-timeline": ["schedule", "twoclock"],
    "65-preprocessing-from-raw-downloads-to-tables": ["schedule", "missing"], "66-preprocessing-images": ["datscan", "schedule"],
    "67-free-and-open-source-tools": ["literature"], "68-platforms-and-where-to-get-help": ["literature"],
    "7-other-ppmi-data-worth-adding": ["literature"],
    "8-the-literature": ["literature"], "81-the-ppmi-cohort-and-cognition": ["literature", "battery"], "82-theory-of-cognitive-decline-in-pd": ["literature", "basalganglia"],
    "83-dopamine-imaging-and-cognition": ["literature", "datscan"], "84-structural-and-diffusion-mri": ["literature"],
    "85-subtypes-and-progression-models-in-pd": ["literature", "twoclock"], "86-methods-borrowed-from-alzheimers-research": ["literature", "twoclock"],
    "87-biological-definitions-and-staging": ["literature", "datscan"], "88-strategies-in-this-literature-and-what-to-take-from-them": ["literature"],
    "9-strengthening-the-worked-example": ["twoclock"], "91-what-is-strong": ["twoclock"], "92-pitfalls-to-avoid": ["twoclock", "schedule"],
    "93-risks-in-the-science-itself": ["twoclock", "missing"], "94-how-to-sharpen-it": ["twoclock", "leakage"],
    "10-statistics-and-modelling-you-need": ["pooling"], "101-foundations": ["pooling"], "102-longitudinal-data-and-mixed-effects-models": ["pooling", "missing"],
    "103-latent-variable-models": ["twoclock"], "104-disease-progression-models": ["twoclock"],
    "105-model-comparison-and-validation": ["leakage"], "106-causal-thinking-just-enough": ["missing"], "107-reading-path": ["literature"],
    "11-data-science-practice": ["leakage"], "111-tools": ["leakage"], "112-reproducibility": ["leakage"], "113-validation-hygiene": ["leakage"],
    "114-working-under-the-dua": ["schedule"], "115-working-together": ["literature"],
    "12-running-a-ppmi-project": ["twoclock"], "121-the-plan-by-phase": ["twoclock", "pooling"],
    "122-questions-to-settle": ["twoclock"], "123-a-four-week-reading-plan": ["pooling", "literature"],
    "13-glossary": ["literature"], "sources": ["literature"], "ppmi-documents-and-pages": ["literature"],
    "books": ["literature"], "papers": ["literature"],
}
missing_map = [h[1] for h in heads if h[0] > 1 and h[1] not in EXPLORE]

# Topic lanes for the literature explorer, from where each reference is cited
LANES = [("ppmi", "PPMI and staging"), ("neuro", "Neuroscience"), ("imaging", "Imaging"),
         ("cognition", "Cognition"), ("models", "Progression models"), ("stats", "Statistics")]
def lane_of(sec):
    n = next((s["num"] for s in sections for x in [s] + s["subs"] if x["id"] == sec), None)
    num = None
    for s in sections:
        if s["id"] == sec:
            num = s["num"]
        for x in s["subs"]:
            if x["id"] == sec:
                num = x["num"] or s["num"]
    if not num:
        return None
    top = num.split(".")[0]
    if num in ("4.2", "6.1", "8.1", "3.5", "8.2"):
        return "cognition"
    if num in ("8.5", "8.6", "10.4"):
        return "models"
    if num in ("8.7",) or top in ("2", "5", "7"):
        return "ppmi"
    if top == "3":
        return "neuro"
    if top in ("4", "6") or num in ("8.3", "8.4"):
        return "imaging"
    if top in ("10", "11"):
        return "stats"
    if top in ("1", "9", "12"):
        return "models"
    return None
for r in refs:
    lanes = Counter(l for l in (lane_of(c) for c in r["cited"]) if l)
    r["lane"] = lanes.most_common(1)[0][0] if lanes else ("stats" if r["group"] == "books" and r["surname"] not in ("Purves", "Blumenfeld", "Kandel") else
                                                          "neuro" if r["group"] == "books" else None)

media = []
mp = R / "media.json"
if mp.exists():
    try:
        media = json.loads(mp.read_text())
    except Exception as e:
        print("media.json unreadable:", e)

DATA = {
    "doc": {"date": LONG_DATE},
    "sections": sections, "glossary": glossary, "refs": refs, "explore": EXPLORE, "lanes": LANES, "media": media,
}

explorer_js = []
for name in ["twoclock", "basalganglia", "datscan", "pooling", "missing", "leakage", "battery", "schedule"]:
    p = R / "explorers" / f"{name}.js"
    if p.exists():
        explorer_js.append(f"/* ---- explorer: {name} ---- */\n" + p.read_text(encoding="utf-8"))
    else:
        print("explorer missing:", name)

tpl = (R / "template.html").read_text(encoding="utf-8")
page = (tpl.replace("<!--__COVER__-->", cover)
           .replace("<!--__CONTENT__-->", content)
           .replace("/*__DATA__*/null", json.dumps(DATA, ensure_ascii=False).replace("</", "<\\/"))
           .replace("/*__EXPLORERS__*/", "\n".join(explorer_js).replace("</script", "<\\/script")))
if "--report" in sys.argv:
    print("sections", len(sections), "glossary", len(glossary), "refs", len(refs), "keyed refs", len(ref_key))
    print("xrefs linked", sum(1 for k, _ in xref_log if k == "link"), "skipped", [s for k, s in xref_log if k == "skip"])
    print("cites linked", sum(cite_log.values()), "distinct refs cited", len(cite_log))
    print("refs never cited:", [r["surname"] + " " + str(r["year"]) for r in refs if r["year"] and not r["cited"]])
    print("unknown cite-like strings:", unknown_cites.most_common(40))
    print("terms marked", sum(term_counts.values()), "distinct", len(term_counts))
    print("headings without explorer map:", missing_map)
    print("page bytes", len(page.encode()))

out = R.parent / "index.html"
out.write_text('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
               '<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body>\n' + page + '\n</body>\n</html>\n',
               encoding="utf-8")
print(out)
