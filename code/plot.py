"""Figures for the notebooks: every function takes tidy data and returns a matplotlib Figure."""

from functools import wraps

import matplotlib as mpl
import numpy as np
import pandas as pd
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
ORDER = {event: rank for rank, event in enumerate(["SC", "BL", "V04", "V06", "V08", "V10", "V12"])}


def themed(plot):
    @wraps(plot)
    def draw(*args, **kwargs):
        with mpl.rc_context(THEME):
            return plot(*args, **kwargs)
    return draw


@themed
def availability(table: pd.DataFrame) -> Figure:
    panels = sorted(set(table.modality), key=lambda modality: list(MODALITY).index(modality) if modality in MODALITY else len(MODALITY)) or ["no image searches loaded"]
    fig = Figure(figsize=(3.2 * len(panels), 3.2), layout="constrained")
    for ax, modality in zip(fig.subplots(1, len(panels), sharey=True, squeeze=False)[0], panels):
        part = table[table.modality == modality].sort_values("event", key=lambda events: events.map(ORDER).fillna(len(ORDER)))
        ax.bar_label(ax.bar(part.visit, part.participants, color=MODALITY.get(modality, PALETTE[0])), fmt="{:,.0f}", fontsize=7)
        ax.set_title(modality)
        ax.tick_params(axis="x", rotation=45)
        ax.grid(axis="x", visible=False)
    fig.axes[0].set_ylabel("unique participants")
    return fig


@themed
def grouped(table: pd.DataFrame, title: str, ylabel: str = "participants") -> Figure:
    fig = Figure(figsize=(max(6, 2.5 + 0.45 * table.size), 3.2), layout="constrained")
    ax = fig.subplots()
    width = 0.8 / max(len(table.columns), 1)
    for i, (column, color) in enumerate(zip(table.columns, PALETTE)):
        offset = (i - (len(table.columns) - 1) / 2) * width
        ax.bar_label(ax.bar(np.arange(len(table)) + offset, table[column].fillna(0), width, color=color, label=column), fmt="{:,.0f}", fontsize=7)
    ax.set_xticks(np.arange(len(table)), table.index)
    ax.set(title=title, ylabel=ylabel)
    ax.grid(axis="x", visible=False)
    fig.legend(loc="outside lower center", ncols=len(table.columns))
    return fig


@themed
def counts(values: pd.Series, title: str) -> Figure:
    fig = Figure(figsize=(6.5, 1.2 + 0.4 * len(values)), layout="constrained")
    ax = fig.subplots()
    ax.bar_label(ax.barh(values.index.astype(str)[::-1], values.to_numpy()[::-1], color=PALETTE[0]), fmt="{:,.0f}", padding=3)
    ax.set(title=title, xlabel="participants")
    ax.grid(axis="y", visible=False)
    ax.margins(x=0.12)
    return fig


@themed
def css(scores: pd.DataFrame) -> Figure:
    fig = Figure(figsize=(9, 3.4), layout="constrained")
    left, right = fig.subplots(1, 2)
    for cohort, part in scores.groupby("cohort"):
        color = COHORT.get(cohort, PALETTE[-1])
        left.hist(part.css[part.years == 0], np.linspace(-3, 3, 41), density=True, histtype="stepfilled", alpha=0.4, color=color, label=cohort)
        trend = part.groupby("years").css.agg(["mean", "sem"])
        right.errorbar(trend.index, trend["mean"], trend["sem"], color=color, marker="o", ms=4, capsize=2)
    left.set(title="Baseline CSS", xlabel="CSS (z)", ylabel="density")
    right.set(title="Mean CSS by study year (± SEM)", xlabel="years from baseline", ylabel="CSS (z)")
    fig.legend(*left.get_legend_handles_labels(), loc="outside right upper")
    return fig


EDGES = {"participant": ("#2F6DB5", "-"), "visit": ("#E07A1F", "--"), "image": ("#7B4FA0", ":"), "built from": ("#8C8C8C", "-")}


@themed
def heatmap(table: pd.DataFrame, title: str, label: str = "participants") -> Figure:
    values = table.fillna(0).to_numpy(dtype=float)
    top = max(values.max(), 1)
    fig = Figure(figsize=(max(5, 2.6 + 0.48 * table.shape[1]), max(2.4, 1.2 + 0.27 * table.shape[0])), layout="constrained")
    ax = fig.subplots()
    image = ax.imshow(values, cmap="Blues", aspect="auto", vmin=0, vmax=top)
    for (row, column), value in np.ndenumerate(values):
        if value:
            ax.text(column, row, f"{value:,.0f}", ha="center", va="center", fontsize=6.5,
                    color="white" if value > 0.6 * top else "#1F1F1F")
    ax.set_xticks(np.arange(table.shape[1]), table.columns.astype(str), rotation=40, ha="right")
    ax.set_yticks(np.arange(table.shape[0]), table.index.astype(str))
    ax.tick_params(length=0)
    ax.grid(False)
    ax.spines[:].set_visible(False)
    ax.set_title(title)
    fig.colorbar(image, ax=ax, label=label, shrink=0.8)
    return fig


@themed
def relations(nodes: pd.DataFrame, edges: pd.DataFrame, title: str) -> Figure:
    layers = list(dict.fromkeys(nodes.layer))
    column = {name: layers.index(layer) for name, layer in nodes.layer.items()}
    order = {layer: list(nodes.index[nodes.layer == layer]) for layer in layers}
    neighbours = {name: [] for name in nodes.index}
    for source, target in zip(edges.source, edges.target):
        neighbours[source].append(target)
        neighbours[target].append(source)
    kept = {layers[column[source]] for source, target in zip(edges.source, edges.target) if column[source] == column[target]}
    for layer in [layer for layer in (layers[1:] + layers[-2::-1]) * 3 if layer not in kept]:
        rank = {name: i / max(len(members) - 1, 1) for members in order.values() for i, name in enumerate(members)}
        across = {name: [rank[other] for other in neighbours[name] if column[other] != column[name]] for name in order[layer]}
        order[layer].sort(key=lambda name: sum(across[name]) / len(across[name]) if across[name] else rank[name])
    tallest = max(map(len, order.values()))
    fig = Figure(figsize=(3.3 * len(layers) + 0.6, 1.2 + 0.24 * tallest), layout="constrained")
    ax = fig.subplots()
    boxes = {}
    for x, layer in enumerate(layers):
        ax.text(x, 1, layer, fontweight="bold", va="bottom")
        for k, name in enumerate(order[layer]):
            count = nodes.participants.get(name)
            label = f"{name}  ({count:,.0f})" if pd.notna(count) and count else name
            y = -k * (tallest - 1) / max(len(order[layer]) - 1, 1)
            boxes[name] = ax.text(x, y, label, va="center", fontsize=7, zorder=3,
                                  bbox=dict(boxstyle="round,pad=0.3", facecolor="white", edgecolor="#9A9A9A", linewidth=0.8))
    for kind, (color, style) in EDGES.items():
        part = edges[edges.kind == kind]
        for source, target in zip(part.source, part.target):
            step = np.sign(column[target] - column[source])
            ends = {1: ((1, 0.5), (0, 0.5)), -1: ((0, 0.5), (1, 0.5)), 0: ((1, 0.5), (1, 0.5))}[step]
            downward = boxes[target].get_position()[1] < boxes[source].get_position()[1]
            ax.annotate("", xy=ends[1], xycoords=boxes[target], xytext=ends[0], textcoords=boxes[source], zorder=1,
                        arrowprops=dict(arrowstyle="-|>" if kind == "built from" else "-", color=color, linestyle=style,
                                        lw=0.9, alpha=0.8, shrinkA=0, shrinkB=0,
                                        connectionstyle=f"arc3,rad={(-0.5 if downward else 0.5) if step == 0 else 0}"))
        if len(part):
            ax.plot([], [], color=color, linestyle=style, label=f"{kind}: {part.key.iloc[0]}")
    ax.set_xlim(-0.05, len(layers) - 0.15)
    ax.set_ylim(-tallest + 0.4, 1.6)
    ax.axis("off")
    ax.set_title(title)
    fig.legend(loc="outside lower center", ncols=4)
    return fig
