"""Pure cost engine (spec 022 R3–R5).

Nothing in this package performs I/O, reads a clock or touches the network.
Dates, rules and seeds are inputs. Deterministic amounts are integer øre
(`Ore`); floats appear only inside the Monte Carlo arrays (`montecarlo.py`)
and are rounded back to øre once on output.
"""

from .run import run_scenario

__all__ = ["run_scenario"]
