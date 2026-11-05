# AI in flö (optional)

flö works fully without AI. When you want help, connect **one** provider in
*Assistente AI → Impostazioni AI*. Nothing is called until you ask for it, and paid calls
always need your confirmation.

## What the AI can do

- **Assistant** (✦ in the top bar): describe a change ("Crea una dashboard SaaS…",
  "Rendi questa interfaccia più minimale…"). Context = current selection or page.
- **Workflow nodes**: *Analisi UX*, *Architettura informativa*, *Generatore schermate UI*,
  *Generatore componenti* (components are registered as real flö components).

The model never edits the document directly and never runs code. It returns a **plan**
(a flat JSON list of create / update / delete actions, constrained by a JSON schema), which
flö validates against the document schema, converts into regular operations with fresh ids,
dry-runs, and applies as **one undoable step** labelled `AI · …`. You then **accept** or
**reject** it (reject = undo). Invalid actions are skipped and listed.

## Ollama (local, free)

1. Install Ollama and pull a model with good JSON output, e.g. `ollama pull qwen2.5:14b`
   (on a 16 GB M2, 7–14B models are a good fit).
2. In flö choose **Ollama**, keep `http://localhost:11434`, press **Verifica connessione**
   and pick the model.
3. Browser access (CORS): Ollama accepts requests from `localhost` origins by default. If you
   serve flö from another origin, start Ollama with that origin allowed, e.g.
   `OLLAMA_ORIGINS="https://flo.example" ollama serve`.

flö sends Ollama's `format` parameter with the plan's JSON schema (structured outputs).

## Claude (paid, through a local proxy)

The Anthropic API key **never enters the browser** (not in the bundle, not in storage).
A small local process holds it:

```bash
export ANTHROPIC_API_KEY="<your Anthropic API key>"   # or: ant auth login
npm run ai-proxy                         # http://127.0.0.1:8787
```

It prints a **session token**: paste it in flö → *Impostazioni AI → Claude*. The proxy:

- listens on `127.0.0.1` only; CORS limited to `FLO_ALLOWED_ORIGINS`
  (default: localhost:5173 / 4173);
- requires the session token on every request (other web pages cannot spend your credits);
- validates requests, accepts only `claude-*` model ids;
- uses the Messages API with structured outputs (`output_config.format` json_schema),
  effort `medium`, streaming with cancellation (closing the request aborts upstream), and
  `fallbacks: "default"` so a request declined by a safety classifier is retried on
  Anthropic's recommended fallback model; refusals are reported, never faked;
- returns token usage, shown in flö with an estimated cost.

Default model: `claude-opus-5-5` (selectable: Sonnet 5.5, Haiku 5.5, Fable 5.1).
Environment variables: `FLO_PROXY_PORT`, `FLO_PROXY_TOKEN`, `FLO_ALLOWED_ORIGINS`,
`FLO_CLAUDE_MODEL`.

**Cost control:** before every Claude request flö shows the model, the estimated input
tokens and an estimated maximum cost; nothing is sent unless you confirm (you may approve
for the current browser session only).

## Adding providers

Implement `AiProvider` (`src/core/ai/provider.ts`): `check()`, `generate()` with JSON-schema
structured output, `billable`, cancellation via `AbortSignal`, and usage reporting. Register
it in `src/editor/ai.ts` and the settings dialog.
