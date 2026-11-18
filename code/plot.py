"""Figures for the notebooks. Each function draws a query result as SQL shaped it and returns a matplotlib Figure.

The query does the work: filters, counts, pivots, order. These functions only read its columns and draw them.
"""

from functools import wraps

import matplotlib as mpl
import numpy as np
from matplotlib.figure import Figure

THEME = {
    "figure.dpi": 110,
    "savefig.dpi": 150,
    "font.size": 9,
    "axes.titlesize": 10,
    "axes.titleweight": "bold",
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "axes.axisbelow": True,
    "grid.alpha": 0.25,
    "legend.frameon": False,
}

PALETTE = ["#2F6DB5", "#E07A1F", "#2E8B57", "#7B4FA0", "#C0392B"]
MODALITY = {"SPECT": "#E07A1F", "MRI": "#2E8B57", "DTI": "#7B4FA0"}
COHORT = {"Parkinson's disease": "#C0392B", "Healthy control": "#2F6DB5"}
EDGES = {"participant": ("#2F6DB5", "-"), "visit": ("#E07A1F", "--"), "image": ("#7B4FA0", ":"), "built from": ("#8C8C8C", "-")}


def themed(plot):
    @wraps(plot)
    def draw(*args, **kwargs):
        with mpl.rc_context(THEME):
            return plot(*args, **kwargs)
    return draw


def number(value) -> float:
    """A cell as a float, with a missing value as 0."""
    try:
        value = float(value)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if value != value else value


def numbers(column) -> np.ndarray:
    return np.array([number(value) for value in column], dtype=float)


@themed
def availability(table) -> Figure:
    """One panel per modality: participants at each visit. Columns: modality, visit, participants, in visit order."""
    panels = {}
    for modality, visit, participants in zip(table["modality"], table["visit"], table["participants"]):
        panels.setdefault(modality, []).append((str(visit), number(participants)))
    names = sorted(panels, key=lambda modality: list(MODALITY).index(modality) if modality in MODALITY else len(MODALITY))
    names = names or ["no image searches loaded"]
    fig = Figure(figsize=(3.2 * len(names), 3.2), layout="constrained")
    for ax, modality in zip(fig.subplots(1, len(names), sharey=True, squeeze=False)[0], names):
        bars = panels.get(modality, [])
        ax.bar_label(ax.bar([visit for visit, _ in bars], [count for _, count in bars], color=MODALITY.get(modality, PALETTE[0])),
                     fmt="{:,.0f}", fontsize=7)
        ax.set_title(modality)
        ax.tick_params(axis="x", rotation=45)
        ax.grid(axis="x", visible=False)
    fig.axes[0].set_ylabel("unique participants")
    return fig


@themed
def grouped(table, title: str, ylabel: str = "participants") -> Figure:
    """Grouped bars. The first column labels the groups; every other column is one series."""
    labels, series = [str(value) for value in table[table.columns[0]]], list(table.columns[1:])
    fig = Figure(figsize=(max(6, 2.5 + 0.45 * len(labels) * len(series)), 3.2), layout="constrained")
    ax = fig.subplots()
    width = 0.8 / max(len(series), 1)
    for i, (column, color) in enumerate(zip(series, PALETTE)):
        offset = (i - (len(series) - 1) / 2) * width
        ax.bar_label(ax.bar(np.arange(len(labels)) + offset, numbers(table[column]), width, color=color, label=column),
                     fmt="{:,.0f}", fontsize=7)
    ax.set_xticks(np.arange(len(labels)), labels)
    ax.set(title=title, ylabel=ylabel)
    ax.grid(axis="x", visible=False)
    fig.legend(loc="outside lower center", ncols=max(len(series), 1))
    return fig


@themed
def counts(table, title: str, xlabel: str = "participants") -> Figure:
    """Horizontal bars, top to bottom in the table's order. Columns: label, count."""
    labels, values = [str(value) for value in table[table.columns[0]]], numbers(table[table.columns[1]])
    fig = Figure(figsize=(6.5, 1.2 + 0.4 * len(labels)), layout="constrained")
    ax = fig.subplots()
    ax.bar_label(ax.barh(labels[::-1], values[::-1], color=PALETTE[0]), fmt="{:,.0f}", padding=3)
    ax.set(title=title, xlabel=xlabel)
    ax.grid(axis="y", visible=False)
    ax.margins(x=0.12)
    return fig


@themed
def css(baseline, trend) -> Figure:
    """Baseline CSS histograms (columns: cohort, css) and the mean by year (columns: cohort, years, mean, sem)."""
    fig = Figure(figsize=(9, 3.4), layout="constrained")
    left, right = fig.subplots(1, 2)
    values, points = {}, {}
    for cohort, score in zip(baseline["cohort"], baseline["css"]):
        values.setdefault(cohort, []).append(number(score))
    for cohort, years, mean, sem in zip(trend["cohort"], trend["years"], trend["mean"], trend["sem"]):
        points.setdefault(cohort, []).append((number(years), number(mean), number(sem)))
    for cohort in dict.fromkeys([*points, *values]):
        color = COHORT.get(cohort, PALETTE[-1])
        left.hist(values.get(cohort, []), np.linspace(-3, 3, 41), density=True, histtype="stepfilled", alpha=0.4, color=color, label=cohort)
        line = points.get(cohort, [])
        right.errorbar([p[0] for p in line], [p[1] for p in line], [p[2] for p in line], color=color, marker="o", ms=4, capsize=2)
    left.set(title="Baseline CSS", xlabel="CSS (z)", ylabel="density")
    right.set(title="Mean CSS by study year (± SEM)", xlabel="years from baseline", ylabel="CSS (z)")
    fig.legend(*left.get_legend_handles_labels(), loc="outside right upper")
    return fig


@themed
def heatmap(table, title: str, label: str = "participants") -> Figure:
    """A grid of counts. The first column labels the rows; every other column is one column of the grid."""
    rows, columns = [str(value) for value in table[table.columns[0]]], [str(column) for column in table.columns[1:]]
    values = np.array([numbers(table[column]) for column in table.columns[1:]], dtype=float).T.reshape(len(rows), len(columns))
    top = max(values.max(initial=0), 1)
    fig = Figure(figsize=(max(5, 2.6 + 0.48 * len(columns)), max(2.4, 1.2 + 0.27 * len(rows))), layout="constrained")
    ax = fig.subplots()
    image = ax.imshow(values, cmap="Blues", aspect="auto", vmin=0, vmax=top)
    for (row, column), value in np.ndenumerate(values):
        if value:
            ax.text(column, row, f"{value:,.0f}", ha="center", va="center", fontsize=6.5,
                    color="white" if value > 0.6 * top else "#1F1F1F")
    ax.set_xticks(np.arange(len(columns)), columns, rotation=40, ha="right")
    ax.set_yticks(np.arange(len(rows)), rows)
    ax.tick_params(length=0)
    ax.grid(False)
    ax.spines[:].set_visible(False)
    ax.set_title(title)
    fig.colorbar(image, ax=ax, label=label, shrink=0.8)
    return fig


@themed
def relations(nodes, edges, title: str) -> Figure:
    """Boxes in columns by layer, joined by edges. nodes: name, layer, participants. edges: source, target, kind, key."""
    names = list(nodes["name"])
    layer_of = dict(zip(names, nodes["layer"]))
    count_of = dict(zip(names, nodes["participants"]))
    links = list(zip(edges["source"], edges["target"], edges["kind"], edges["key"]))
    layers = list(dict.fromkeys(layer_of[name] for name in names))
    column = {name: layers.index(layer_of[name]) for name in names}
    order = {layer: [name for name in names if layer_of[name] == layer] for layer in layers}
    neighbours = {name: [] for name in names}
    for source, target, _, _ in links:
        neighbours[source].append(target)
        neighbours[target].append(source)
    kept = {layers[column[source]] for source, target, _, _ in links if column[source] == column[target]}
    for layer in [layer for layer in (layers[1:] + layers[-2::-1]) * 3 if layer not in kept]:
        rank = {name: i / max(len(members) - 1, 1) for members in order.values() for i, name in enumerate(members)}
        across = {name: [rank[other] for other in neighbours[name] if column[other] != column[name]] for name in order[layer]}
        order[layer].sort(key=lambda name: sum(across[name]) / len(across[name]) if across[name] else rank[name])
    tallest = max(map(len, order.values()), default=1)
    fig = Figure(figsize=(3.3 * len(layers) + 0.6, 1.2 + 0.24 * tallest), layout="constrained")
    ax = fig.subplots()
    boxes = {}
    for x, layer in enumerate(layers):
        ax.text(x, 1, layer, fontweight="bold", va="bottom")
        for k, name in enumerate(order[layer]):
            count = number(count_of.get(name))
            label = f"{name}  ({count:,.0f})" if count else name
            y = -k * (tallest - 1) / max(len(order[layer]) - 1, 1)
            boxes[name] = ax.text(x, y, label, va="center", fontsize=7, zorder=3,
                                  bbox=dict(boxstyle="round,pad=0.3", facecolor="white", edgecolor="#9A9A9A", linewidth=0.8))
    for kind, (color, style) in EDGES.items():
        part = [(source, target, key) for source, target, k, key in links if k == kind]
        for source, target, _ in part:
            step = np.sign(column[target] - column[source])
            ends = {1: ((1, 0.5), (0, 0.5)), -1: ((0, 0.5), (1, 0.5)), 0: ((1, 0.5), (1, 0.5))}[step]
            downward = boxes[target].get_position()[1] < boxes[source].get_position()[1]
            ax.annotate("", xy=ends[1], xycoords=boxes[target], xytext=ends[0], textcoords=boxes[source], zorder=1,
                        arrowprops=dict(arrowstyle="-|>" if kind == "built from" else "-", color=color, linestyle=style,
                                        lw=0.9, alpha=0.8, shrinkA=0, shrinkB=0,
                                        connectionstyle=f"arc3,rad={(-0.5 if downward else 0.5) if step == 0 else 0}"))
        if part:
            ax.plot([], [], color=color, linestyle=style, label=f"{kind}: {part[0][2]}")
    ax.set_xlim(-0.05, len(layers) - 0.15)
    ax.set_ylim(-tallest + 0.4, 1.6)
    ax.axis("off")
    ax.set_title(title)
    fig.legend(loc="outside lower center", ncols=4)
    return fig
