"""Market model (spec 022 R7): cohorts, empirical-Bayes price model, retention
curves, drift and backtest. Pure: no I/O here except `bundle.py`, which
writes the derived bundle. `predict.value_path` is the engine's entry point.
"""

from .predict import value_path

__all__ = ["value_path"]
