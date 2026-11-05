# flö

**AI-native visual interface design studio** — proprietary software. See [LICENSE](LICENSE).

flö is a web-based UI/UX design tool. Interfaces are stored as structured, fully editable
documents (never flattened images). It is local-first: no account, no server and no paid
API are required. Italian is the default language; English is available.

## Status

Milestone 1 (Foundation) is complete. See [docs/CHECKLIST.md](docs/CHECKLIST.md) for the
roadmap and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.

## Requirements

- Node.js 22+ and npm 10+ (developed on macOS Apple Silicon; works on Linux).
- `.npmrc` sets `legacy-peer-deps=true` to work around an npm 10 resolver crash with
  Vitest 4's optional peers.

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm run typecheck` | Strict TypeScript check |
| `npm test` | Unit and component tests (Vitest + Testing Library) |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm run e2e` | End-to-end tests (Playwright; builds must exist: run `npm run build` first) |

On a fresh machine, install the Playwright browser once with `npx playwright install chromium`.

## Using the editor

- **Home**: create, open, rename, duplicate, delete, import and export projects (`.flo.json`).
- **Tools**: `V` select · `H`/Space pan · `F` frame · `R` rectangle · `O` ellipse · `L` line · `T` text.
- **Insert panel**: device frames, shapes, image placeholders, UI presets (button, input, card,
  navigation, hero section, container) and icons — all inserted as editable layer trees.
- **Auto layout**: select a frame → *Auto layout* → vertical/horizontal, gap, padding, alignment;
  children can be *Fixed*, *Hug* or *Fill*.
- **Canvas**: click selects within the current context, double-click drills in / edits text,
  `Ctrl/⌘`+click selects deep. Drag to move (with smart guides), handles to resize, drag from the
  rulers to create guides. Dragging a layer onto a frame moves it inside.
- Everything is undoable (`⌘Z` / `⌘⇧Z`) and autosaved to IndexedDB.
