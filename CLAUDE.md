# ClawStand

## What this is

An autonomous judge for hackathon submissions. Takes a live URL (and optionally a GitHub repo URL), runs specialist agents against the GrowthX MaaS rubric, outputs L1-L5 scores per parameter and a 60-second pitch-down verdict.

## The one sentence

ClawStand scores hackathon submissions on the GrowthX MaaS rubric and writes the mentor pitch-down for each.

## The demo moment (3:45 PM today)

On stage at 4:30 PM, I paste the URL of a team that demoed before me. The agents run live. Scores appear. The pitch-down verdict is read out loud. Room reacts.

## Rubric being used

GrowthX MaaS rubric — 7 parameters, L1-L5 each, 164 max points:

1. Real output shipping (20x, max 80) — ROOT PARAMETER
2. Task decomposition quality (5x, max 20)
3. Observability (7x, max 28)
4. Evaluation and iteration tooling (5x, max 20)
5. Agent handoffs and memory (2x, max 8)
6. Cost and latency on judge task (1x, max 4)
7. Management UI usability (1x, max 4)

Full rubric descriptors are hardcoded in `rubric.ts` as a JSON constant. Do not abstract this.

## Iterations

### Iteration 0 (by 12:05 PM) — TERMINAL ONLY

`node judge.js --url https://example.com` prints scored JSON to stdout.

- Hardcoded rubric as JSON constant
- Fetch the URL's HTML (plain fetch, no headless browser)
- One Claude API call with the HTML + rubric → returns L1-L5 scores as JSON
- Print it. Done.

### Iteration 1 (by 1:05 PM) — Multi-agent split

- Product Inspector: given live URL's HTML, scores "Real output shipping" and "Management UI usability"
- Repo Auditor: given GitHub URL, fetches package.json + README via GitHub REST API, scores "Task decomposition" and "Observability"
- Pitch Writer: given all scores, writes the 60-second pitch-down verdict
- Run in parallel with Promise.all
- Still Node.js. Still terminal.

### Iteration 2 (by 2:05 PM) — Web UI, deployed

- Next.js app, single page
- Two input fields: live URL (required), GitHub URL (optional)
- One button: "Score it"
- Output: table with 7 rubric rows, L1-L5 cells, highlighted L per row
- Output: pitch-down verdict in a card below
- shadcn/ui components. Black background. No custom CSS.
- Deployed to Vercel.

### Iteration 3 (by 3:05 PM) — Langfuse + real submissions

- Wire Langfuse free tier for tracing
- Run on 2-3 real hackathon submissions (collected during lunch)
- Cache those results so the demo is instant

### Iteration 4 — DO NOT START BEFORE 2:05 CHECKPOINT

Ranking system across multiple submissions. Only if iterations 0-3 are deployed and working on a fresh browser at 2:05 PM.

## Not building (explicit cuts)

- No auth. No users. No login screen.
- No database. Everything in memory or JSON files.
- No user accounts, no saved history.
- No dark mode toggle. Dark is the only mode.
- No loading skeletons or fancy animations.
- No mobile responsiveness. Desktop only.
- No error handling beyond console.log.
- No tests.
- No Turborepo. One package.json.
- No tRPC. Fetch or Next.js server actions only.
- No Drizzle. No Postgres. No ORMs.
- No LangGraph. No CrewAI. Use Vercel AI SDK's generateObject with Zod schemas.
- No hierarchical agents. Flat parallel calls only.
- No repo cloning. GitHub REST API for metadata only (package.json, README, commits list).
- No custom domain. vercel.app URL is fine.

## Faking

- The rubric is hardcoded, not dynamic per hackathon.
- Only scoring MaaS track. Virality and Revenue not supported.
- GitHub API unauthenticated (60 req/hour). Cache aggressively.
- For the demo, pre-run and cache results for the 2-3 real submissions to avoid live API latency.

## Stack decisions (locked, do not debate)

- Framework: Next.js 14 app router
- AI SDK: Vercel AI SDK (`ai` + `@ai-sdk/anthropic`)
- Model: claude-sonnet-4-5-20250929 (use latest Sonnet available)
- Schema validation: Zod
- UI: shadcn/ui + Tailwind
- Deploy: Vercel
- Observability: Langfuse (iteration 3 only)
- Language: TypeScript

## Rules for you, Claude Code

- Write ugly code. Hardcode things. Use `any` if typing is slow.
- Do not refactor working code.
- Do not install packages without telling me why in one line.
- Do not create files beyond what's needed for the current iteration.
- Do not suggest "nice to haves." I will ignore them.
- When I ask for a feature, build the minimum version. Not the good version.
- If I ask for something not in this file, push back once, then do it if I insist.

## Current state (as of end of Iteration 3)

Iterations 0, 1, 2, 3 are SHIPPED and working. Iteration 4 NOT started.

**Live at https://clawstand.vercel.app** — production alias on Vercel. GitHub-connected; pushing to `main` auto-deploys in ~25-30s.

### Files

CLI (Iteration 0 + 1 — still works):
- `judge.js` — CLI entry + orchestrator. Parses `--url` / `--repo`, fetches HTML, runs agents, computes weighted total, prints JSON. Require path updated from `./agents` to `./lib/agents` when I2 moved the module — otherwise unchanged.

App (Iteration 2):
- `app/layout.tsx` — root layout. Inter (sans) + JetBrains Mono via `next/font/google`. Metadata.
- `app/page.tsx` — the single-page UI. Client component. Contains the `SAMPLE` constant (ClawStand self-score, CUT at 68/164) rendered before any real run.
- `app/globals.css` — Tailwind base + minimal scrollbar/selection tint. Nothing decorative.
- `app/api/score/route.ts` — POST `/api/score`. Orchestrates the 3-agent pipeline, wraps every run in a Langfuse trace, returns the locked JSON shape.

Components (shadcn/ui — hand-written, no CLI):
- `components/ui/button.tsx` — filled acid / ghost / outline variants. Sizes default / sm / lg / xl.
- `components/ui/input.tsx` — boxed filled input, mono font, `rounded-md`, focus ring in acid.
- `components/ui/card.tsx` — minimal wrapper. Currently unused by page.tsx but kept for future.
- `components/ui/badge.tsx` — small pill with variants (default / acid / filled).

Lib:
- `lib/agents.js` — MOVED from root in I2. `RUBRIC` + `productInspector` + `repoAuditor` + `pitchWriter`. I3 rewrote the Product Inspector prompt to include MaaS eligibility triage (see below).
- `lib/agents.d.ts` — TS declaration shim so `.ts` files can import the `.js` module cleanly. Only changes if the agent function signatures change.
- `lib/rubric-meta.ts` — display metadata for the UI (`RUBRIC_ORDER`, `RUBRIC_LABELS`, `levelNumber` helper). Kept separate from `agents.js` so the agent file stays untouched per the "do not refactor" rule.
- `lib/langfuse.ts` — Langfuse client singleton. **Uses named import** (`import { Langfuse } from "langfuse"`) — the default export is a browser-only client and will fail on the server.
- `lib/utils.ts` — `cn()` helper (`clsx` + `tailwind-merge`) used by all shadcn components.

Configs (Iteration 2):
- `next.config.js`, `tsconfig.json`, `postcss.config.js`, `tailwind.config.ts`, `next-env.d.ts`.

Env:
- `.env` — local. Must contain `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`.
- `.env.example` — template with all five keys.

### Stack deviation (IMPORTANT — updated)

The stack section above says "Vercel AI SDK (`ai` + `@ai-sdk/anthropic`) + Zod + generateObject".
**What actually shipped: `@anthropic-ai/sdk` directly, across all iterations including I2 and I3.** This was intentional — Iteration 0 shipped that way and rewriting for the UI was not worth the time. The spec is wrong; reality wins. Do NOT rewrite to Vercel AI SDK / Zod unless someone explicitly asks.

Node interop quirk (unchanged): `const Anthropic = require('@anthropic-ai/sdk'); new Anthropic.default();` — the `.default` is required because of CommonJS/ESM interop. Do not remove it.

Installed dependencies:
- Runtime: `@anthropic-ai/sdk`, `dotenv`, `langfuse`, `next@14.2.35`, `react@18`, `react-dom@18`
- UI primitives: `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`
- Dev: `typescript`, `@types/*`, `tailwindcss`, `postcss`, `autoprefixer`

Font choice landmine: **Geist is NOT available in `next/font/google` on Next 14.x** — it needs the separate `geist` npm package. We use Inter (sans) + JetBrains Mono (mono) from `next/font/google` instead. If someone tries to switch to Geist and the build fails, this is why.

### Deployment

- Vercel project: `prjwl16s-projects/clawstand`, GitHub-connected to `github.com/prjwl16/clawStand`.
- Production URL: https://clawstand.vercel.app (aliased; the unique deployment URLs require team auth).
- Auto-deploy: any push to `main` triggers a build. Typical wall time 25-30s.
- Manual deploy from CLI: `vercel --prod --yes` (works, but uploads local working-tree files — be careful not to ship uncommitted changes).

Vercel env vars (Production + Development scopes — NOT Preview, which got stuck on an interactive git-branch prompt when adding; fix in dashboard if branch deploys are ever needed):
- `ANTHROPIC_API_KEY` — required
- `GITHUB_TOKEN` — optional but critical. Unauthenticated GitHub API rate-limits after ~8 runs (7 requests per audit). With a token: 5000 req/hr.
- `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` — required for I3 tracing. Without them, `lib/langfuse.ts` constructs a client with `undefined` keys and fails SILENTLY at flush time (no crash, no traces). If traces aren't appearing in the dashboard, check these first.

Route-level config in `app/api/score/route.ts`:
- `export const runtime = "nodejs"` — the Anthropic SDK, Buffer decoding, and GitHub REST all need the Node runtime, not Edge.
- `export const maxDuration = 60` — three LLM calls can push 30-40s; the default 10s kills the request.

### Iteration 2 — UI design decisions (locked)

Design doctrine: ONE accent color. Acid lime `#DDFF00`. Everything else lives on the black→white axis. Do not add green/red/blue variants without being asked.

Verdict encoding:
- `NOMINATE` → `bg-acid` + `text-black` (loud, celebratory)
- `CUT` → `bg-fg` (white) + `text-bg` (black) (cold, sterile — NOT red)
- Required-field asterisk → `text-acid` (indicator, not error)
- Error box → neutral `border-line` + small `text-acid` "Error" label
- Selected L1-L5 pill → `bg-acid text-black font-semibold`
- Unselected L1-L5 pill → `border-line text-muted`

Typography (Inter only — single sans):
- Tagline (`h1`): `font-bold`, `text-5xl sm:text-6xl lg:text-7xl`, `leading-[0.98]`, `tracking-tight`, forced two-line break via `<br />`
- Total score: `font-extrabold`, `text-7xl sm:text-8xl lg:text-9xl`, `tabular-nums`
- Verdict word in banner: `font-bold`, `text-5xl sm:text-6xl`, `tracking-tight`
- Param names: `font-medium text-[15px]`
- Labels: `font-medium text-sm`
- Body: `font-normal`
- Mono (JetBrains Mono) is used ONLY for: input field values + evidence text in the rubric table + small utility metadata lines (elapsed time, weight chip, the Langfuse trace link).

Corners: `rounded-md` (6px) on inputs, buttons, cards, banner, level pills. No `rounded-xl` anywhere — the design is sharp, not soft.

Sample self-score: hardcoded `SAMPLE` constant in `app/page.tsx`. Honest CUT at 68/164 (realOutputShipping L3, decomposition L4, observability L2, evals L1, memory L2, cost L3, UI L3). Shown before any real run under the headline "Here's ClawStand scoring itself." This is critical for passers-by who walk up without interacting — the page must explain itself at a glance.

### Iteration 3 — Langfuse observability

- `lib/langfuse.ts`: singleton `Langfuse` client wired to env vars. Uses **named import** (see landmine above).
- Every POST to `/api/score` creates a trace `clawstand-score` with three child spans:
  - `productInspector` — input: `{ url, htmlLength }`, output: scores
  - `repoAuditor` — input: `{ repo }`, output: scores
  - `pitchWriter` — input: `{ scores, total, maxTotal }`, output: `{ verdict, pitch, reasoning }`
  - Each span carries `{ model: "claude-sonnet-4-5-20250929", maxTokens }` in metadata.
- `await langfuse.flushAsync()` is called before every early-return AND in the final `catch` — serverless functions freeze after response, so flush synchronously or traces are lost.
- `trace.getTraceUrl()` is returned as `traceUrl` in the API response.
- UI renders a subtle `TRACED VIA LANGFUSE · view 3 agent spans ↗` link under the pitch card. Conditionally rendered — only when `traceUrl` is present. The `SAMPLE` constant has no `traceUrl`, so the sample card intentionally doesn't show the link.

### Product Inspector — MaaS eligibility triage (I3 prompt update)

The Product Inspector prompt was rewritten to classify submissions BEFORE scoring:
- `REAL_MAAS` — named agent + described autonomous workflows OR live agent behavior in the HTML. Scores L1-L5 on the actual evidence.
- `WEAK_MAAS` — only weak positive signals (generic "AI-powered" copy, single chatbot widget on a non-agent product). Caps `realOutputShipping` and `costAndLatencyOnJudgeTask` at L2.
- `NOT_MAAS` — no agent/LLM evidence at all, not even in marketing copy. Hard-caps both at L1.

`managementUIUsability` is explicitly NOT affected by the triage — a polished non-agent SaaS can still score L4-L5 on UX.

Evidence strings from the Product Inspector now sometimes carry a `[NOT_MAAS]` or `[REAL_MAAS]` prefix — this is intentional, it's not a bug.

This is a prompt-level change only; no code enforces the caps. The LLM is trusted to respect them.

### CLI contract

```
node judge.js --url <live-url> [--repo <github-url>]
```

- `--url` is MANDATORY. Even for submissions without a deployed product (CLI tools, Python scripts, libraries), pass the repo URL as `--url`. The Product Inspector will honestly score L1 on `realOutputShipping` and `managementUIUsability` when it sees GitHub's repo page, which is the correct rubric outcome (no live product = L1).
- `--repo` is optional. If omitted, the four repo-scored parameters return L1 with evidence `"no repo provided"`.

### Agent responsibilities (locked)

| Agent | Scores these rubric params |
|---|---|
| Product Inspector | `realOutputShipping`, `managementUIUsability`, `costAndLatencyOnJudgeTask` |
| Repo Auditor | `taskDecompositionQuality`, `observability`, `evaluationAndIterationTooling`, `agentHandoffsAndMemory` |
| Pitch Writer | `verdict` ("NOMINATE" / "CUT"), `pitch` (60-sec speech), `reasoning` (one paragraph) |

Inspector + Auditor run in parallel via `Promise.all`. Pitch Writer runs AFTER both complete, sequentially, given combined scores + total.

### Repo Auditor — multi-language support

Fetches 7 GitHub REST endpoints in parallel per run (all public, no auth needed but use token to lift rate limit):

1. `GET /repos/{owner}/{repo}` — metadata (language, stars, description, default_branch)
2. `GET /repos/{owner}/{repo}/contents/package.json` — JS/TS manifest
3. `GET /repos/{owner}/{repo}/contents/requirements.txt` — Python manifest
4. `GET /repos/{owner}/{repo}/contents/pyproject.toml` — Python (modern) manifest
5. `GET /repos/{owner}/{repo}/contents/go.mod` — Go manifest
6. `GET /repos/{owner}/{repo}/readme` — README (any filename)
7. `GET /repos/{owner}/{repo}/commits?per_page=10` — recent commits

404s on missing manifests are EXPECTED and logged as `[repoAuditor] GitHub API 404 on <url>`. This is not an error; a JS project just won't have `go.mod`. The LLM is told "empty if not found" and treats absent manifests as N/A.

If the repo metadata fetch (endpoint 1) itself fails (404 / rate limit / private repo), the auditor short-circuits and returns L1 for all four params with evidence explaining why. It does not crash.

Supported languages: **JS/TS, Python, Go**. Do not add more without being asked — Rust, Java, Ruby, etc. are explicit non-goals for now.

### GitHub auth

- Unauthenticated: 60 req/hr (each judge run uses 7 → hits rate limit after ~8 runs).
- With `GITHUB_TOKEN` (classic PAT, no scopes needed for public repos): 5000 req/hr.
- Token is picked up automatically via `process.env.GITHUB_TOKEN` in `agents.js:ghFetch`. No flag needed.
- If rate limit is hit, the 403 is logged and all repo-scored params fall back to L1 with a rate-limit message. Not a crash.

### Scoring math (locked)

- Per-param points: `(L - 1) * weight` where `L ∈ {1, 2, 3, 4, 5}`.
- Max per param: `4 * weight`.
- Total max: `4 * (20+5+7+5+2+1+1) = 164`.
- Implementation: `judge.js:computeTotal`. The `levelNumber` helper coerces `"L3"` strings to integer 3, and defaults to 1 on any malformed/missing level string (this is defensive — we've seen the LLM return `"level": "Level 3"` once).

### Nomination threshold (Pitch Writer heuristic)

The Pitch Writer is told: `NOMINATE` requires `total >= 82` (≥50%) AND `realOutputShipping >= L3`. Otherwise `CUT`. This is a prompt-level heuristic, not a hard code gate — if the Pitch Writer wants to nominate something at 81 because of exceptional evidence, it can. Don't convert this to a deterministic rule unless asked; the current soft heuristic is intentional.

### Model

All three agents use `claude-sonnet-4-5-20250929` via the `@anthropic-ai/sdk` messages API. Per-agent `max_tokens`: Inspector 1024, Auditor 1024, Pitch 1536. Do not change model without being asked.

### Output shape (locked — do not change without updating the UI)

The CLI (`judge.js`) still emits the original 6-field shape. The API route (`/api/score`) additionally returns `inputs` and `traceUrl`:

```json
{
  "scores": {
    "realOutputShipping":       { "level": "L3", "evidence": "..." },
    "taskDecompositionQuality": { "level": "L3", "evidence": "..." },
    "observability":            { "level": "L3", "evidence": "..." },
    "evaluationAndIterationTooling": { "level": "L3", "evidence": "..." },
    "agentHandoffsAndMemory":   { "level": "L3", "evidence": "..." },
    "costAndLatencyOnJudgeTask":{ "level": "L3", "evidence": "..." },
    "managementUIUsability":    { "level": "L3", "evidence": "..." }
  },
  "total": 82,
  "maxTotal": 164,
  "verdict": "NOMINATE",
  "pitch": "...",
  "reasoning": "...",
  "inputs": { "url": "https://...", "repo": "https://github.com/..." | null },
  "traceUrl": "https://cloud.langfuse.com/trace/..."
}
```

`app/page.tsx` types `traceUrl` as optional (`traceUrl?: string`) because the local `SAMPLE` constant doesn't carry one — anything coming from `/api/score` in production always has it.

### Demo-day checklist (2:05 PM)

Before starting Iteration 4, verify on a **fresh browser tab, no cookies**:
1. https://clawstand.vercel.app loads and shows the self-score sample under "Here's ClawStand scoring itself."
2. Typing a URL and clicking "Score it" runs through all 4 loading phases, lands on a real result, and the `TRACED VIA LANGFUSE ↗` link appears under the pitch card.
3. That link opens a Langfuse trace with 3 child spans (productInspector, repoAuditor, pitchWriter), each with visible input/output.
4. The CLI still works: `node judge.js --url https://example.com` prints JSON to stdout.

If any of those four are broken, fix before starting I4.
