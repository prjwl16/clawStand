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
