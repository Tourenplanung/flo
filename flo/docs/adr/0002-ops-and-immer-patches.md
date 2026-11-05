# ADR 0002 — Validated operations with Immer patches for history

**Status:** accepted (Milestone 1)

**Decision.** All mutations are `DocOp`s (Zod-validated, serializable). The store applies
them in an Immer `produceWithPatches` transaction and stores patches/inverse patches for
undo/redo. Gestures coalesce through a `mergeKey`.

**Why.** Ops give a narrow, auditable surface for future AI agents and workflows (they emit
ops, never arbitrary code). Immer patches give exact inverses without hand-writing an inverse
for every op, and structural sharing keeps React re-renders cheap.

**Consequences.** Ops only need forward implementations. History entries are patch lists,
which can later be persisted for project history / execution records.
