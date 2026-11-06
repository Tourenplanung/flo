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

## Design engine (Milestone 2)

- **Schema v3** adds `project.tokens`, `project.breakpoints`, and on every node `constraints`,
  `bindings` (token references) and `responsive` (breakpoint id → overridden properties).
  Frames may carry `component` (main component with variant set/properties); the `instance`
  node type references a main component and stores per-layer `overrides`.
- **Resolution, not duplication** (`core/resolve.ts`, `core/instance.ts`): what you see is
  computed at render/export time — breakpoint cascade (desktop-first) → token bindings →
  instance expansion. Changing a token, a main component or a breakpoint override therefore
  updates every use immediately, with nothing to sync.
- **Instances are leaves** in the stored tree; their layers are *virtual* (`instanceId__sourceId`)
  so they can be rendered, measured, selected and overridden but never structurally edited.
- **One write path** (`editor/actions.ts → writeOps`): edits become instance overrides,
  responsive overrides (when a breakpoint is active) or base updates, and editing a
  token-bound value detaches that binding.
- **Invariants enforced by ops**: bindings must reference existing tokens; overrides must
  produce valid nodes; instances may not (directly or transitively) contain their own
  component; deleting a main component or a token bakes the current values into users.
- **History persistence**: undo/redo patches are saved with the project (size-capped);
  restored entries are re-validated with the full schema before being applied.

## Workflow engine (Milestone 3)

```
core/workflow/
  catalog.ts     Node kinds: category, typed ports, Zod param schemas, UI field specs,
                 availability ('ready' | 'ai' | 'planned')
  graph.ts       Connection validation (port types, single input, no cycles), topo order
  engine.ts      runWorkflow(): topological execution, caching, statuses, history records
  runners.ts     Implementation of every 'ready' node
  wireframe.ts / styling.ts / responsive.ts / checks.ts / htmlExport.ts   deterministic generators
  templates.ts   Built-in templates + re-id cloning for user templates and branches
```

- **Workflows live in the project document** (`project.workflows`, schema v2) and change only
  through validated ops (`createWorkflow`, `addWorkflowNodes`, `addWorkflowEdge`, …), so they
  are undoable, autosaved and validated on load/import like the design itself.
- **Execution state is separate**: statuses in `store/workflowStore.ts`; per-node output cache
  and execution history in IndexedDB (`runCache`, `executions` tables).
- **Cache keys** hash node kind + params + inputs. Design inputs are fingerprinted from the
  *current* content of their frames, so editing a design by hand invalidates downstream checks.
- **Nodes that write to the document** (wireframe, apply styles, responsive adapter) apply their
  changes as one undoable transaction and remember the frames they generated; re-running
  replaces those frames instead of duplicating them.
- **No fake AI**: AI nodes (UX analysis, information architecture, component/UI generators)
  report "unavailable" until a provider exists (Milestone 4); planned nodes (prototype, React
  export) say so explicitly.
- The engine is framework-independent; the UI supplies an `EngineHost` (document access,
  `dispatch`, asset data URLs, icon SVG rendering).
- UI: React Flow canvas (`ui/workflow/`), loaded lazily so the design editor stays light.

## AI integration (Milestone 4)

```
core/ai/
  provider.ts        AiProvider interface, errors, cost estimate
  providers/ollama.ts  Browser → Ollama HTTP API (structured `format`)
  providers/claude.ts  Browser → local proxy (session token; no API key in the browser)
  plan.ts            AI plan schema (flat, non-recursive JSON schema) → validated DocOps
  agent.ts           Context outline, prompts, runDesignAgent()
server/claude-proxy.ts  Node proxy using @anthropic-ai/sdk (127.0.0.1, CORS allowlist, token)
editor/ai.ts         Active provider, cost confirmation, generateWithConsent()
ui/ai/               Assistant panel, settings dialog, cost confirmation dialog
```

The AI output contract is the plan: the model can only propose create/update/delete
actions with typed, bounded properties. `planToOps` resolves references, builds nodes with the
regular factories, and dry-runs every action against the document (invalid ones are
rejected individually). The result is one labelled, undoable transaction — the same path as
any manual edit. Workflow AI nodes use the same plan pipeline through the `EngineHost.ai`
capability, and are `unavailable` when no provider is configured. See `docs/AI.md`.

## Prototyping (Milestone 5)

- **Schema v4**: every node has `interactions` (trigger + action, referencing screens/layers by
  id) and the project has `prototype.startFrameId`. Ops validate destinations (top-level frames)
  and targets, prune references when layers are deleted, and remap them when a subtree is
  duplicated (`core/clone.ts`).
- **Player engine** (`core/prototype.ts`): a pure state machine — screen, history, overlay stack,
  visibility overrides, last transition — so behaviour is unit-tested without a browser.
- **Player UI** (`ui/prototype/PrototypePlayer.tsx`) renders screens with the same `nodeStyle`
  and token/instance resolution as the canvas; CSS keyframes provide the transitions.

## Code export (Milestone 6)

```
core/export/styles.ts  StyleBuilder: nodeStyle + tokens (CSS vars) + breakpoint @media (shared by HTML and React)
core/export/react.ts   exportReactProject(): screens, components, prototype runtime, assets, a11y report
core/export/zip.ts     Dependency-free ZIP writer (stored)
core/export/icons.ts   flö icon → lucide-react component names
```

Generated project: `src/screens/*` (one component + CSS per top-level frame),
`src/components/*` (one per main component; instances pass `texts`, `visible`, `images`,
`styles`, `rootProps`), `src/prototype.tsx` (navigation, overlays, show/hide, transitions,
hash routing), `src/styles/tokens.css`, `public/assets/*`, `ACCESSIBILITY.md`, `README.md`.
Text is emitted as JavaScript string literals and attributes via `JSON.stringify`, so design
content can never inject markup or code into the generated project.

## React import from GitHub

```
core/importers/github.ts      URL parsing, read-only GitHub REST client (commit-pinned, size limits), import resolution
core/importers/reactImport.ts Babel AST → symbolic evaluator → element tree → flö layers
core/importers/tailwind.ts    Tailwind utilities / inline styles → StyleSpec (mobile + desktop)
editor/githubImport.ts        fetch dependencies, convert, place on the “Libreria GitHub” page (one transaction)
ui/editor/GithubImportDialog  URL/token → file picker → component picker → report
```

The importer never executes imported code: it walks the AST and evaluates only pure
expressions (literals, props, `cn/clsx/cva`, array `.map` over constants, conditionals) with a
step budget; everything else becomes a named placeholder. Raw HTML, scripts and event
handlers are dropped. The parser chunk is lazy-loaded. Imported components keep their origin
in `component.source` (repo, path, commit, license).

## Persistence and security

- Projects are stored as validated documents in IndexedDB (Dexie); images as blobs.
- Every load from storage and every import runs `migrateProject → parseProject`
  (schema + integrity). Tampered documents are rejected, never rendered.
- Strings reaching CSS are constrained by schema (hex colors, font-family charset); text is
  rendered as React text (never HTML). Imported image payloads are restricted to
  PNG/JPEG/WebP/GIF data URLs whose type matches the asset metadata (no SVG).
- Imported projects get a new id so they cannot overwrite local projects.
- No code from project files, GitHub imports or AI output is ever executed. Workflow node kinds and
  parameters are validated against the catalog; unknown kinds are rejected.
- Exported HTML escapes all user text and attribute values.
- AI: provider credentials never reach the browser (Claude via local proxy with session
  token); model output is data validated into ops, never executed; paid calls need consent.

## Decisions (ADRs)

See `docs/adr/`.
