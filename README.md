# flö

**AI-native visual interface design studio** — proprietary software. See [LICENSE](LICENSE).

flö is a web-based UI/UX design tool. Interfaces are stored as structured, fully editable
documents (never flattened images). It is local-first: no account, no server and no paid
API are required. Italian is the default language; English is available.

## Status

Milestones 1–4 (foundation, design engine, workflow engine, optional AI) are complete. See [docs/CHECKLIST.md](docs/CHECKLIST.md) for the
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
| `npm run ai-proxy` | Optional local Claude proxy (see [docs/AI.md](docs/AI.md)) |
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
- **Design system** (*Stili* tab): color, text, spacing, radius and shadow tokens; bind them from
  the inspector (◇ pickers). Editing a token restyles everything bound to it.
- **Components** (*Componenti* tab / inspector): turn a frame into a component, create instances,
  override text/colors/visibility inside instances (double-click), group variants
  (`Stato=Hover`) and switch them per instance; detach when needed.
- **Responsive**: the breakpoint bar above the canvas previews Tablet/Mobile; edits made while a
  breakpoint is active become overrides for that width and below. Constraints pin absolute
  layers to edges/center or stretch/scale them with their frame.
- Everything is undoable (`⌘Z` / `⌘⇧Z`), listed in the *Cronologia* tab, and autosaved to
  IndexedDB together with the history.

## Workflow mode

Switch **Design ↔ Workflow** in the top bar.

- Start from a template (*Dal brief al design*, *Verifica design esistente*, *Esplora varianti
  di stile*) or an empty workflow; add nodes from the palette and connect compatible ports
  (colors show port types).
- **Esegui tutto** runs the graph; ▶ on a node runs it and its dependencies. Results are cached;
  changing a parameter marks downstream nodes as outdated.
- Design-producing nodes create real, editable frames: use **Apri nel canvas** to edit them.
- AI nodes are marked and stay unavailable until an AI provider is configured.

## AI (optional)

✦ in the top bar opens the design assistant. Connect **Ollama** (local, free) or **Claude**
(paid, via a local proxy that keeps the API key off the browser). Every change the AI
proposes is validated, applied as one undoable step and can be accepted or rejected; paid
calls always ask for confirmation. Setup: [docs/AI.md](docs/AI.md).
