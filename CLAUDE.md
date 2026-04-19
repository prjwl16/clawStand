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

## Current state (as of end of Iteration 1)

Iterations 0 and 1 are SHIPPED and working. Iterations 2, 3, 4 NOT started.

### Files

- `judge.js` — CLI entry + orchestrator. Parses `--url` / `--repo`, fetches HTML, runs agents, computes weighted total, prints JSON.
- `agents.js` — Exports `RUBRIC` constant + three async functions: `productInspector`, `repoAuditor`, `pitchWriter`. The RUBRIC lives here, not in a separate `rubric.ts` (the original spec mentioned `rubric.ts` — ignore that, it was pre-implementation speculation).
- `.env` — Must contain `ANTHROPIC_API_KEY` and (optionally but strongly recommended) `GITHUB_TOKEN`.
- `.env.example` — template.

No other files. Do not add more until an iteration demands it.

### Stack deviation (IMPORTANT)

The stack section above says "Vercel AI SDK (`ai` + `@ai-sdk/anthropic`) + Zod + generateObject". **Iteration 0 shipped using `@anthropic-ai/sdk` directly**, and Iteration 1 inherited that. The Next.js UI in Iteration 2 should still use Vercel AI SDK + Zod (per the spec). The terminal `judge.js` can stay on raw Anthropic SDK — do not rewrite it.

Node interop quirk: `const Anthropic = require('@anthropic-ai/sdk'); new Anthropic.default();` — the `.default` is required because of CommonJS/ESM interop. Do not remove it.

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

### Output shape (locked — do not change)

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
  "reasoning": "..."
}
```

The Iteration 2 Next.js UI must consume exactly this shape.
