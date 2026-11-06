# flö — Development checklist

Legend: ✅ done and tested · 🟡 partial · ⬜ not started

## Milestone 1 — Foundation ✅

| Item | Status | Notes |
| --- | --- | --- |
| Project structure (Vite + React + strict TS + Tailwind 4) | ✅ | Single package; no monorepo needed yet |
| Product design system (dark-first tokens, controls) | ✅ | `src/index.css`, `src/ui/common/controls.tsx` |
| Application shell (top bar, left panels, canvas, inspector) | ✅ | |
| Infinite canvas: pan (wheel, Space, H, middle button), zoom (⌘/Ctrl+wheel, pinch, menu) | ✅ | |
| Frames + presets (desktop, laptop, tablet, mobile…) | ✅ | Insert panel and frame tool |
| Basic elements: rect, ellipse, line, text, image, icon | ✅ | Image placeholders and uploaded images |
| UI presets: button, input, card, navbar, hero section, container | ✅ | Editable node trees, not images |
| Selection, multi-select (shift), marquee, deep select (⌘/Ctrl) | ✅ | Context-aware click depth |
| Drag, resize (8 handles, shift aspect, alt from center) | ✅ | Pixel-grid rounding |
| Smart snapping + smart guides; rulers; ruler guides | ✅ | |
| Layer hierarchy panel: rename, hide, lock, drag-to-reorder/reparent | ✅ | |
| Pages: add, rename, delete | ✅ | |
| Properties inspector (position, size, sizing, layout, layer, typography, fill, stroke, effects, image, icon) | ✅ | Mixed values on multi-select |
| Align commands | ✅ | Toolbar + Alt shortcuts |
| Group / ungroup / frame selection; duplicate; copy/cut/paste; z-order | ✅ | |
| Inline text editing | ✅ | |
| Local persistence (IndexedDB), autosave, reload reopens project | ✅ | |
| Project management: create/open/rename/duplicate/delete/import/export | ✅ | `.flo.json` with embedded images |
| Schema versioning + migrations | ✅ | v0 → v1 migration tested |
| Italian (default) + English | ✅ | |
| Tests: unit (core, store, persistence), component, Playwright e2e | ✅ | |

**Acceptance:** a user can create and edit a simple web interface manually — verified by
`e2e/landing-page.spec.ts` (header, nav, hero with heading/text/CTA, image placeholder,
footer; edit typography, colors, spacing; reorder; resize; save; reload; reopen; continue).

### Known limitations after M1

- No rotation of layers.
- Multi-selection shows a bounding box but resize handles only appear for a single layer.
- Groups do not scale their children when resized (they behave like transparent containers).
- Rich text (mixed styles within one text layer) is not supported.
- Drag-to-reorder inside auto layout works for single layers only.
- Clipboard is in-memory (works across pages/projects in the same tab, not across tabs/apps).
- AI assistant and prototype preview buttons are visible but disabled and labelled
  "available in an upcoming version".

## Milestone 2 — Design engine ✅

| Item | Status | Notes |
| --- | --- | --- |
| Auto layout (direction, gap, padding, alignment, wrap) | ✅ | |
| Sizing fixed / hug / fill, min/max constraints | ✅ | |
| Constraints for absolute children (start/end/center/stretch/scale) | ✅ | Applied on resize and mapped to CSS |
| Design tokens: colors, text styles, spacing, radius, shadows | ✅ | Stili panel; “from selection” |
| Token bindings with central updates | ✅ | Resolved at render; editing a bound value detaches it |
| Breakpoints (desktop-first) with per-breakpoint overrides | ✅ | Breakpoint bar; preview widths; editable list |
| Components, instances, per-layer overrides | ✅ | Text, color, visibility, size/weight, icon, image |
| Variants (component sets with properties) and variant switching | ✅ | |
| Detach instance; deleting a main component detaches its instances | ✅ | No orphaned instances |
| Undo/redo + project history panel, persisted across reloads | ✅ | Restored entries are re-validated before use |
| HTML export: token CSS variables, @media overrides, expanded instances | ✅ | |
| Workflow: design system can write tokens; apply styles binds layers | ✅ | |

**Acceptance:** users can create reusable and responsive layouts — verified by
`e2e/design-system.spec.ts` and `src/core/__tests__/designEngine.test.ts`.

### Known limitations after M2

- Breakpoint preview resizes top-level frames wider than the breakpoint (“screens”);
  smaller top-level frames keep their size.
- Instance overrides cover content and appearance (text, colors, visibility, size, weight,
  icon, image); layout inside an instance follows the main component.
- Overrides are one level deep for nested instances (inner instances follow their own main).
- Constraints apply to absolute children of frames/groups; while a breakpoint is active,
  children adapt through CSS only (stored positions refer to the base layout).

## Milestone 3 — Workflow engine ✅

| Item | Status | Notes |
| --- | --- | --- |
| Workflow canvas (React Flow): add, connect, move, delete nodes | ✅ | Palette click or drag-and-drop |
| Node registry with typed ports and validated parameters | ✅ | 25 node kinds in 6 categories |
| Typed connections + dependency validation (no cycles, one link per input) | ✅ | Enforced in ops, not only UI |
| Execution engine: run all / run up to a node / force re-run | ✅ | Topological order |
| Caching of intermediate results, stale detection, regenerate downstream | ✅ | Persisted in IndexedDB |
| Branching (Branch, Condition, Merge, Compare variants) | ✅ | Inactive branches are skipped |
| Output previews (sitemap, styles, reports, design, code) | ✅ | Report issues jump to the layer |
| Design document integration (read existing frames, create editable frames) | ✅ | One undoable step per node run |
| Workflow templates (3 built-in) + save as template + duplicate as branch | ✅ | |
| Execution history | ✅ | Last 300 runs per project |
| Deterministic nodes: brief, screenshot/reference, existing design, sitemap, user flow, wireframe, design system, apply styles, responsive adapter, accessibility/consistency/responsive checks, canvas output, HTML/CSS export | ✅ | |
| AI nodes: UX analysis, information architecture, component generator, UI screen generator | 🟡 | Present, marked "requires AI provider"; enabled in M4 |
| Interactive prototype, React export nodes | 🟡 | Present, marked "coming soon" (M5, M6) |

**Acceptance:** a workflow creates and modifies real, editable design elements — verified by
`e2e/workflow.spec.ts` (brief → sitemap → wireframe → design system → styled → mobile →
checks → HTML export; cache, persistence, regeneration without duplicates) and
`src/core/__tests__/workflow.test.ts`.

### Known limitations after M3

- Sitemap and user flow are written by hand (or taken from bullet lists in the brief);
  deriving them from free text needs AI (M4).
- Apply styles uses rule-based mapping from semantic roles (button, header, card…); designs
  without roles get only generic colors/fonts.
- Responsive adapter produces separate variant frames; true breakpoint overrides of a single
  frame arrive with the responsive engine (M2 remainder).
- HTML export embeds images as data URLs and loads Google Fonts for bundled families.

## Milestone 4 — AI integration ✅

| Item | Status | Notes |
| --- | --- | --- |
| Provider registry / interface (check, generate, billable, cancel, usage) | ✅ | `src/core/ai/provider.ts` |
| Ollama provider (local, JSON-schema structured output) | ✅ | Browser → Ollama HTTP API |
| Claude provider through a secure local proxy | ✅ | `server/claude-proxy.ts`; key never in the browser |
| Cost authorization before every paid call | ✅ | Estimate shown; optional per-session approval |
| AI design operations as a validated plan → document ops | ✅ | Flat JSON schema; dry-run; invalid actions skipped and listed |
| Preview, accept/reject, history trace (`AI · …`) | ✅ | Reject = undo |
| Conversational assistant (selection or page context) | ✅ | Cancel in-flight requests |
| Workflow AI nodes: UX analysis, information architecture, UI screen generator, component generator | ✅ | Unavailable (not faked) without a provider |
| Settings panel with connection test and model choice | ✅ | |

**Acceptance:** a connected AI provider can generate or modify editable UI screens —
verified by `e2e/ai.spec.ts` (providers mocked at the network level: Ollama API and the local
proxy) and `src/core/__tests__/ai.test.ts`, `server/claude-proxy.test.ts`.

### Known limitations after M4

- Real model quality was not measured in this environment (no Ollama/Anthropic access in
  CI); tests use recorded plan fixtures. Small local models may return plans with skipped
  actions — they are reported, never applied blindly.
- Vision inputs (screenshot/reference images) are not sent to models yet.
- The assistant's preview is applied to the document (as one undoable step) rather than shown
  in a separate overlay; rejecting is only possible while it is the latest change.
- One provider active at a time.

## Milestone 5 — Prototyping ✅

| Item | Status | Notes |
| --- | --- | --- |
| Interactions on any layer: trigger (click, hover) → action | ✅ | Schema v4, stable id references |
| Actions: navigate (with transition), back, open overlay, close overlay, show/hide layer | ✅ | Overlay position, outside click, dim |
| Transitions: instant, dissolve, slide left/right/up/down (+ duration) | ✅ | Reversed when going back |
| Prototype start screen | ✅ | Per project |
| Connection arrows on the canvas for the selection | ✅ | Dashed for overlays |
| Navigable preview (▶ or ⇧P): history, back (←), restart (R), screen picker, Esc | ✅ | Clicking empty areas flashes hotspots |
| Interactions inside components work in every instance | ✅ | Targets scoped to the instance |
| References cleaned up when screens/layers are deleted; remapped on duplicate | ✅ | |
| Workflow “Prototipo interattivo” node | ✅ | Opens the player on the input design |

**Acceptance:** users can navigate between designed screens — verified by
`e2e/prototype.spec.ts` and `src/core/__tests__/prototype.test.ts`.

### Known limitations after M5

- No application logic (variables, conditions, forms, scrolling regions, smart animate).
- The player shows the base layout (breakpoint overrides are not previewed in the player).
- Interactions are not exported to HTML yet (Milestone 6).

## Milestone 6 — Code export (React + TS + CSS) ✅

| Item | Status | Notes |
| --- | --- | --- |
| React + TypeScript project (Vite) as .zip | ✅ | Top bar → Esporta, or workflow node |
| One component per screen; semantic HTML (header, nav, section, h1…, button, a) | ✅ | |
| Reusable React components from flö components; instance overrides as typed props | ✅ | texts / visible / images / styles; instance interactions via `rootProps` |
| Shared CSS engine with the canvas and HTML export (flexbox auto layout) | ✅ | `core/export/styles.ts` |
| Design tokens → CSS custom properties (`src/styles/tokens.css`) | ✅ | |
| Responsive: breakpoint overrides → @media; screens are fluid up to their width | ✅ | |
| Prototype in code: navigation (hash routing), back, overlays, show/hide, transitions | ✅ | `src/prototype.tsx`; reduced-motion respected |
| Assets packaged in `public/assets/` with predictable paths | ✅ | |
| Accessible interactive elements (button/role, tabIndex, Enter/Space, focus ring) | ✅ | |
| Basic accessibility validation shipped as `ACCESSIBILITY.md` | ✅ | WCAG contrast, alt text, touch targets, headings |
| HTML/CSS single-page export from the top bar | ✅ | |

**Acceptance:** a generated React project builds and runs independently — verified by
`e2e/react-export.spec.ts`, which designs a landing page, downloads the zip, runs
`npm install` + `npm run build` (`tsc --noEmit && vite build`) on it, serves the build and
navigates the prototype; `src/core/__tests__/reactExport.test.ts` type-checks generated code
in strict mode.

### Known limitations after M6

- Class names are generated (`home-1`, …) and layout values are absolute pixels from the
  design; the code is a clean starting point, not hand-written idiomatic CSS.
- Icon overrides on instances and variant switching at runtime are not exported.
- Fonts are loaded from Google Fonts in the generated `index.html` (bundled families only).
- Tailwind CSS and other frameworks are not offered yet.

## Milestone 7 — Release preparation ⬜
PWA/offline service worker, performance (main JS ≈ 228 kB gzip; workflow view lazy-loaded),
accessibility review, security review, in-app third-party license notices, deployment.

## Test totals

82 unit/component tests (Vitest) · 11 end-to-end tests (Playwright), including a test that
installs, builds and runs an exported React project.
