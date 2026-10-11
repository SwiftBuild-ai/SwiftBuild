# 0003 — Engineering evidence and simulation

Status: accepted.

Decision: versioned declarative scenarios, profiles and policies feed separate pure capacity and rule engines. Pair transparent analytical calculations with seeded discrete-event simulation in the current workbench. Run temporal simulations in a cancellable worker.

Unknown measurements stay unknown. Models cannot infer CPU phases, vendor capacity, cache hit ratio or write scaling from a diagram. Reports retain input fingerprints, engine versions, formulas, units, provenance and limitations. Sampling uncertainty is separate from model accuracy. Imported reports are historical until recomputed.

Consequences: explicit setup is required before meaningful simulation. Numerical reference tests and calibration documentation accompany behavior changes. Recursive routing and other unsupported behavior are explained rather than guessed. New behavior models require explicit contracts and tests.
