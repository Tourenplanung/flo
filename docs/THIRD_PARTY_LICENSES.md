# Third-party licenses

flö's own source code is proprietary (see `/LICENSE`). It uses the following third-party
packages under their respective licenses. Licenses of transitive dependencies are included in
each package in `node_modules`.

## Runtime (shipped in the application bundle)

| Package | Version | License |
| --- | --- | --- |
| react, react-dom | 19.1.1 | MIT |
| zustand | 5.0.8 | MIT |
| immer | 10.1.3 | MIT |
| zod | 4.6.7 | MIT |
| dexie | 4.0.11 | Apache-2.0 |
| @xyflow/react (React Flow) | 12.12.0 | MIT |
| lucide-react | 0.544.0 | ISC |
| @babel/parser (+ @babel/types) | 7.29.9 | MIT |
| @fontsource-variable/inter (Inter typeface) | 5.2.6 | OFL-1.1 |
| @fontsource-variable/space-grotesk | 5.2.8 | OFL-1.1 |
| @fontsource-variable/playfair-display | 5.2.6 | OFL-1.1 |
| @fontsource-variable/jetbrains-mono | 5.2.6 | OFL-1.1 |

Fonts under the SIL Open Font License may be bundled and used in proprietary software; the
font files themselves must not be sold on their own and keep their license.

## Local AI proxy (`server/`, not part of the web bundle)

| Package | Version | License |
| --- | --- | --- |
| @anthropic-ai/sdk | 1.1.0 | Apache-2.0 |
| zod | 4.6.7 | MIT |

## Development only (not shipped)

| Package | License |
| --- | --- |
| typescript | Apache-2.0 |
| vite, @vitejs/plugin-react | MIT |
| tailwindcss, @tailwindcss/vite | MIT |
| vitest, jsdom | MIT |
| @testing-library/* | MIT |
| fake-indexeddb | Apache-2.0 |
| @playwright/test | Apache-2.0 |
| @types/* | MIT |

Apache-2.0 requires attribution when redistributing. The production bundle includes Dexie
(Apache-2.0); the minifier does **not** keep its license header, so this file (or an
equivalent notices page in the app) must ship with any public deployment.
Release preparation (Milestone 7) will add an in-app "Licenses" view generated from this list.

## Test fixtures

`src/core/__tests__/fixtures/button.tsx.txt` is adapted from shadcn/ui (MIT License,
Copyright (c) 2023 shadcn) and is used only as importer test input; it is not shipped.
