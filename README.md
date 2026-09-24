# GLYPH／DUEL — two models, one prompt, real terminals

> Send the identical prompt to two models. Each writes a Node.js terminal animation.
> Both scripts **really execute in a PTY**, the raw ANSI byte stream is captured with
> arrival timestamps, and both replays animate **side by side** in the browser.
> The artifact is a shareable terminal GIF. The purpose: visual proof of the
> progression from an older model (A) to a newer one (B). **Everything is executed,
> never simulated.**

```
┌──────────────────────────────────────────────────────────────┐
│  BROWSER (Vite :5173)          BACKEND (Node :3001)          │
│                                                              │
│  ┌─────────┐  POST /api/glyph  ┌──────────┐  ┌────────────┐  │
│  │ CORNER A│ ────────────────▶ │ Slot A   │─▶│ Provider A │  │
│  │ CORNER B│ ────────────────▶ │ Slot B   │─▶│ Provider B │  │
│  └─────────┘  identical prompt └──────────┘  │ (Particle / │  │
│  (+fresh nonce each,                            Ollama / LM  │  │
│   in parallel)                                 Studio / …)  │  │
│                                               └────────────┘  │
│  ┌─────────┐  POST /api/run    ┌──────────────────────────┐  │
│  │ CRT  A  │ ◀──────────────── │ AST scan → node-pty PTY  │  │
│  │ CRT  B  │  cast [{t,data}]  │ 6s hard kill → .cast file│  │
│  └─────────┘                   └──────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Tech stack

| Layer    | Tech | Why |
|----------|------|-----|
| Frontend | Vite + React + TypeScript | Fast dev, `5173` with `/api` proxy to backend |
| Terminals | `@xterm/xterm` | Renders raw ANSI exactly; replay = `term.write(chunk)` per frame |
| Backend  | Node.js + TypeScript + Express (`:3001`) | Single runtime for compose + execute |
| PTY      | `node-pty` | **Real** pseudoterminal: arrival timestamps, exit codes, kill |
| Models   | plain `fetch` to OpenAI-compatible `/chat/completions` | No SDK; works with Particle.ai, Ollama, LM Studio, OpenRouter, any Custom URL |
| GIF      | [`agg`](https://github.com/asciinema/agg) | `.cast` → `.gif` for sharing |

No three.js. No canvas animation. No auth, no DB, no history.

## Quickstart

```bash
npm install
# macOS: node-pty's helper loses its exec bit via npm —
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
codesign -s - node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper

npm run dev     # backend :3001 + frontend :5173
```

Open `http://localhost:5173`, paste an API key into Corner A/B (or point a corner
at Ollama — no key needed), hit **⚡ Duel**.

CLI (no browser):

```bash
GLYPH_A_KEY=… GLYPH_B_KEY=… npm run glyph -- "a spinning ASCII cube"
```

Verification suite (no keys needed):

```bash
npm run verify
# check1 bytes: 44046 PASS   (thousands, not tens)
# check2 files: … PASS       (distinct .cast files)
# check3 timeout: TIMEOUT 6001 PASS
# check4 violation: PASS / check4b socket: PASS
```

## API

### `POST /api/glyph`

```json
{
  "prompt": "Write a single Node.js script … Output only code.",
  "slotA": { "provider": "Particle.ai", "baseUrl": "https://api.particle.ai/v1",
             "apiKey": "…", "model": "deepseek-v4-flash-0731",
             "temperature": 0, "maxTokens": 1600, "disableReasoning": true },
  "slotB": { "provider": "Ollama", "baseUrl": "http://127.0.0.1:11434/v1",
             "model": "qwen3:8b", "temperature": 0, "maxTokens": 1600 }
}
```

Returns `{ a, b, prompt }` where each side is:

```json
{ "code": "…", "rawReply": "…", "latencyMs": 812,
  "promptTokens": 120, "completionTokens": 640,
  "reasoningTokens": null, "sha256": "…", "extractionPath": "fence" }
```

Rules enforced per slot (`backend/src/glyph.ts`):

- `chat_template_kwargs: { enable_thinking: false }` is sent **only** when
  provider is Particle.ai **and** the model starts with `deepseek-`.
- `reasoningTokens` comes only from `usage.completion_tokens_details.reasoning_tokens`;
  absent → `null` → UI shows **n/a** and hides the thinking toggle. Never 0, never invented.
- `reasoning_content` (CoT text) is **never logged, displayed, or persisted** — only its token count.
- `max_tokens ≥ 900` for reasoning budgets; HTTP 200 with empty content → **one retry
  with doubled budget, cap 4000**.
- A **fresh random nonce** is appended to every prompt (defeats response caches).
- Code extraction: prefer a ```` ```js ```` fence, else fall back to a reply containing
  `process.stdout.write` or `\x1b[`; the path used is recorded.

### `POST /api/run`

```json
{ "code": "…", "slot": "A" }
```

1. **AST scan** (`scanViolations` in `backend/src/runner.ts`) rejects `child_process`,
   `net`/`dgram`/`fetch`/`WebSocket`, and any `require`/`import` — marked `VIOLATION`, never run.
2. Script is written to a temp dir and run under `node --no-warnings` in a **100×30 PTY**.
3. Every `onData` chunk is stored with its arrival timestamp: `cast: [{ t, data }]`.
4. **6s hard kill** → `status: "TIMEOUT"`, `exitCode: 124`.
5. An asciinema v2 `.cast` is written to `casts/` and returned as `castFile`.

```json
{ "cast": [{ "t": 0.042, "data": "…" }], "exitCode": 0, "stderr": "",
  "bytes": 44046, "frames": 96, "durationMs": 5012, "cpuMs": 88,
  "status": "ok", "castFile": "glyph-A-….cast" }
```

### `GET /api/models?baseUrl&apiKey`

Live model-list passthrough for the picker. **Typing a model name by hand always works**
(`deepseek-v4-flash-0731` isn't in Particle's `/models` list and still responds).
A dead local server returns its real error, e.g.
`Cannot reach http://127.0.0.1:11434 — is Ollama running? …`.

### `GET /api/casts/:name` — downloads the `.cast` file.

GIF: `agg casts/glyph-A-<ts>.cast out.gif` (the UI's "Copy GIF command" builds it).

## UI

CRT-broadcast identity: scoreboard masthead with ON AIR lamp, tale-of-the-tape config
(Corner A cyan / Corner B magenta), prompt deck with 4 presets
(spinning ASCII cube · burning fire · scrolling starfield · bar visualiser),
two CRT panes with scanlines, Play/Pause/Restart/step-frame + scrubber,
chrome-hiding **record mode** for thumbnails, per-pane stats
(model · exit · bytes · frames · duration · reasoning n/a-or-count · violation badge).

## Fork & contribute

```bash
git clone <your-fork> && cd Glyph && npm install && npm run dev
```

No keys are needed to hack on everything except live model calls
(`npm run verify` covers the runner; point both corners at Ollama for free local duels).

Ideas for new features:

- **Tournament mode** — round-robin N models, Elo table from byte/frame/vote stats.
- **Audience voting** — blind A/B vote endpoint + persisted tally (SQLite, still no auth).
- **Diff view** — token-level diff of the two scripts beside the CRTs.
- **agg in-backend** — shell out to `agg` and serve the `.gif` directly.
- **Prompt lab** — save/share prompt presets as JSON, import via URL hash.
- **Cost ledger** — per-duel token × price table from `/models` pricing metadata.
- **WebSocket streaming** — stream PTY bytes to xterm live during the run, then seal the cast.

PRs welcome — keep the invariant: **if it didn't come out of a real PTY, it doesn't go on screen.**