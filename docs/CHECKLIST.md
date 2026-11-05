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
| Tests: unit (core, store, persistence), component, Playwright e2e | ✅ | 38 unit/component, 3 Playwright e2e |

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
- Workflow mode, AI assistant and prototype preview buttons are visible but disabled and
  labelled "available in an upcoming version".

## Milestone 2 — Design engine 🟡

| Item | Status |
| --- | --- |
| Auto layout (direction, gap, padding, alignment, wrap) | ✅ (pulled into M1) |
| Sizing fixed / hug / fill, min/max constraints | ✅ (pulled into M1) |
| Undo/redo + document history (in-session) | ✅ (pulled into M1) |
| Constraints for absolute children (left/right/center/scale) | ⬜ |
| Breakpoint-specific responsive overrides + preview | ⬜ |
| Design tokens (colors, type, spacing, radius, shadows, breakpoints) | ⬜ |
| Components, instances, overrides, variants | ⬜ |
| Persistent project history panel | ⬜ |

## Milestone 3 — Workflow engine ⬜
Workflow canvas (React Flow), node registry, typed connections, execution engine,
branching, caching, design-document integration.

## Milestone 4 — AI integration ⬜
Provider registry, Ollama, optional Claude via a secure server-side proxy (keys never in the
client bundle), structured generation as validated `DocOp` patches with preview/approval.

## Milestone 5 — Prototyping ⬜
## Milestone 6 — Code export (React + TS + CSS) ⬜
`core/style.ts` already maps nodes to CSS and is designed to be shared by the exporter.

## Milestone 7 — Release preparation ⬜
PWA/offline service worker, performance (code splitting; current JS bundle ≈ 177 kB gzip),
accessibility review, security review, in-app third-party license notices, deployment.
