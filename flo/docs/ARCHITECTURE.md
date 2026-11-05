# flö — Architecture

## Goals that shape the design

1. **Design is structured data.** Every layer is a typed node with a stable id; nothing is a
   flattened image. The same data drives the canvas, the inspector and (later) code export.
2. **All changes are validated, reversible operations.** This is the contract that future AI
   features will use: an AI proposes ops, flö validates, previews and applies them.
3. **Local-first, no mandatory services.** IndexedDB persistence, offline-capable bundle,
   bundled fonts. AI providers will be optional plug-ins.

## Layers

```
src/
  core/         Framework-independent domain (no React, no DOM)
    schema.ts     Zod schema + types: Project, Page, DesignNode (frame, group, rect, ellipse,
                  line, text, image, icon), paints, effects, auto layout, sizing
    ops.ts        DocOp union (Zod-validated) + applyOp on an Immer draft
    validate.ts   Integrity checks: parent/child consistency, orphans, cycles, leaf children
    migrate.ts    Versioned schema migrations (schemaVersion, migrations[n] → n+1)
    fileFormat.ts .flo.json bundle (project + embedded images), untrusted-input parsing
    style.ts      DesignNode → CSS declarations (shared by renderer and future exporter)
    geometry.ts   Rect math, smart-snapping, resize math
    factory.ts    Node/page/project factories, frame presets, composite UI presets
    tree.ts       Read-only tree queries
  store/        Zustand stores
    docStore.ts   The open project + undo/redo history (Immer patches)
    history.ts    Transaction + merge logic (mergeKey coalesces gestures into one undo step)
    editorStore.ts UI state only: page, selection, tool, viewport, measured rects, guides UI
    settingsStore.ts Persisted preferences (language)
  persistence/  Dexie (IndexedDB): projects table + assets table (image blobs)
  editor/       Editor commands that translate intent into ops (insert, group, align, clipboard…),
                autosave, asset URL cache, image import
  ui/           React components: home, editor shell, canvas, panels, inspector, controls
  i18n/         Italian (default) and English dictionaries, typed keys
```

`core/` must never import from `ui/`, `store/` or React. This keeps the schema reusable by the
workflow engine, AI validation and code export.

## Document model

- `Project.nodes` is a normalized map `id → DesignNode`. Hierarchy uses `parentId` (a page id
  or node id) and ordered `childIds` (back → front).
- Containers: `frame` (fills, clip, auto layout, semantic role) and `group`. All other types
  are leaves; ops reject children on leaves.
- Positioning: `layoutPositioning: 'absolute'` uses `x/y` relative to the parent's inner
  (border) box; `'auto'` participates in the parent's auto layout (flexbox).
- Sizing per axis: `fixed`, `hug` (auto-layout frames and text) or `fill` (auto-layout
  children). Optional min/max constraints.
- `role` on frames and text records semantic intent (`nav`, `section`, `button`, `h1`…) for
  accessible code export.

## Operations, history and undo

`dispatch(ops, { mergeKey })` runs all ops inside one Immer `produceWithPatches`. If any op
throws `OpError`, the whole transaction is discarded (atomic). Patches + inverse patches are
pushed to history; consecutive transactions with the same `mergeKey` (a drag gesture, typing
in a field) collapse into one undo entry. Undo/redo restore the selection that was active.

`updateNode` merges props and re-validates the full node with the Zod schema, and refuses
structural keys (`id`, `type`, `parentId`, `childIds`) — those change only through
`insertTree`, `moveNode` and `deleteNode`, which enforce tree invariants and cycle checks.

## Rendering and interaction

The canvas renders the document as real DOM using `core/style.ts`, inside a world element
transformed by the viewport (`translate + scale`). Benefits: true flexbox auto layout, real
text metrics and fonts, and parity with exported HTML/CSS.

After each render the canvas measures every `[data-node-id]` element and stores world-space
rects in the editor store. Overlays (selection, handles, smart guides, frame labels, marquee,
rulers) are drawn in screen space from those rects, so they stay crisp at any zoom. Hit
testing uses the DOM (`closest('[data-node-id]')`, `elementsFromPoint`) plus a Figma-like
context rule for which depth a click selects.

Gestures (move, resize, draw, marquee, pan, guides) are a small state machine in
`Canvas.tsx`. Moves of auto-layout children reorder them inside the flow; dropping onto
another frame reparents while preserving world position.

## Persistence and security

- Projects are stored as validated documents in IndexedDB (Dexie); images as blobs.
- Every load from storage and every import runs `migrateProject → parseProject`
  (schema + integrity). Tampered documents are rejected, never rendered.
- Strings reaching CSS are constrained by schema (hex colors, font-family charset); text is
  rendered as React text (never HTML). Imported image payloads are restricted to
  PNG/JPEG/WebP/GIF data URLs whose type matches the asset metadata (no SVG).
- Imported projects get a new id so they cannot overwrite local projects.
- No code from project files or (future) AI output is ever executed.

## Decisions (ADRs)

See `docs/adr/`.
