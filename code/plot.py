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
