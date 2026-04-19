const Anthropic = require('@anthropic-ai/sdk');
const { z } = require('zod');
const { generateObject } = require('ai');
const { anthropic } = require('@ai-sdk/anthropic');

// ------------------------------------------------------------------
// PLANNER — decides which specialists to run and how they should
// focus, given only { url, repo } signals (no HTML/repo contents).
// Uses Vercel AI SDK generateObject() with a Zod schema.
// ------------------------------------------------------------------

const PlannedAgentSchema = z.object({
  name: z.enum(['productInspector', 'repoAuditor']),
  run: z.boolean(),
  focusInstructions: z.string(),
  skipReason: z.string().optional(),
});

// NOTE: no .min/.max on the agents array — Anthropic's structured output
// API rejects minItems/maxItems other than 0 or 1. We enforce the "exactly
// two agents, productInspector + repoAuditor" invariant in the orchestrator.
const PlanSchema = z.object({
  reasoning: z.string(),
  agents: z.array(PlannedAgentSchema),
});

function defaultPlan(url, repoUrl) {
  return {
    reasoning: 'Planner fell back to default; productInspector always runs, repoAuditor runs iff a repo is provided.',
    agents: [
      {
        name: 'productInspector',
        run: true,
        focusInstructions: '',
      },
      repoUrl
        ? { name: 'repoAuditor', run: true, focusInstructions: '' }
        : {
            name: 'repoAuditor',
            run: false,
            focusInstructions: '',
            skipReason: 'no repo provided',
          },
    ],
  };
}

async function planExecution(url, repoUrl) {
  const prompt = `You are the PLANNER for ClawStand, a hackathon submission judge. Before the specialist agents run, you decide WHICH of them to run and WHAT to tell each one to focus on — based only on what you can infer from the URL and repo patterns. You have not yet seen any HTML or repo contents.

INPUT
  Live URL:    ${url}
  GitHub repo: ${repoUrl || 'NOT_PROVIDED'}

AVAILABLE SPECIALISTS (only these two exist — do NOT invent others)
  productInspector — analyzes the rendered live product HTML.
  repoAuditor      — queries the GitHub REST API (package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml, README, last 10 commits).

RULES
  - productInspector.run must always be true.
  - repoAuditor.run must be false when no repo is provided OR when the URL doesn't look like a valid https://github.com/owner/name pattern.
  - When run === false, populate skipReason with a short sentence. Leave focusInstructions as a short note anyway (for logging).
  - Never invent new agent types. Return exactly two agents in the array, in this order: productInspector, repoAuditor.

WRITE FOCUS INSTRUCTIONS (1–2 sentences per agent) tailored to the inputs:
  - Repo name hints at Python ("py", "python", "fastapi", "django") → tell repoAuditor to emphasize pyproject.toml and requirements.txt and Python observability deps (langfuse, langsmith, opentelemetry, structlog).
  - Repo name hints at Go ("go-", "-go") → emphasize go.mod and Go tracing deps (otel, zap, zerolog).
  - Repo name hints at Rust ("-rs", "rust") → emphasize Cargo.toml.
  - Repo name hints at JS/TS or unclear → emphasize package.json for agent framework signals (langgraph, crewai, @ai-sdk, ai, langchain).
  - Repo name mentions a specific framework (langchain, crewai, agent, llm) → tell repoAuditor to verify that framework is actually wired, not just mentioned in the README.
  - Live URL is a PaaS subdomain (vercel.app, fly.io, railway.app, netlify.app, cloudflare.pages.dev) → tell productInspector to look for actual agent behavior, chat UIs, streamed responses, demo buttons.
  - Live URL is a marketing domain (plain .com, .ai, .io, no app subdomain) → tell productInspector to distinguish *described* product from *actual accessible* agent output; marketing copy alone should not score above L2 on real output shipping.
  - Live URL is github.com/... (someone passed the repo as the live URL) → tell productInspector that no deployed product is expected, score real-output-shipping and management-UI honestly at L1.

Write one short reasoning sentence explaining the plan.`;

  try {
    const { object } = await generateObject({
      model: anthropic('claude-sonnet-4-5-20250929'),
      schema: PlanSchema,
      prompt,
      maxTokens: 512,
    });
    return object;
  } catch (e) {
    console.error('[planner] fell back to default plan:', e && e.message);
    return defaultPlan(url, repoUrl);
  }
}

const RUBRIC = {
  realOutputShipping: {
    weight: 20,
    maxPoints: 80,
    root: true,
    descriptors: {
      L1: "No real output. Vaporware, mockups, or slides only. Nothing a user can interact with.",
      L2: "A toy demo exists but breaks on the first real input. Happy path only, no edge cases handled.",
      L3: "A working product that produces real output for a narrow, well-defined task. Used once or twice.",
      L4: "Product is in active use. Produces non-trivial output repeatedly. Has users beyond the team.",
      L5: "Product is shipping real output at scale. Paying users or measurable external impact. Operating in production."
    }
  },
  taskDecompositionQuality: {
    weight: 5,
    maxPoints: 20,
    descriptors: {
      L1: "Single monolithic prompt. No decomposition into steps or subtasks.",
      L2: "Rough decomposition but steps are ad-hoc, unclear boundaries between agent responsibilities.",
      L3: "Clear multi-step decomposition with named phases. Each step has a defined input/output contract.",
      L4: "Well-decomposed specialist agents with explicit handoff contracts. Steps can be tested independently.",
      L5: "Decomposition is principled, documented, and evolves based on measured failure modes. Clear rationale for each split."
    }
  },
  observability: {
    weight: 7,
    maxPoints: 28,
    descriptors: {
      L1: "No logs. No traces. You cannot tell what the agent did after the fact.",
      L2: "Console.logs scattered around. You can sort-of debug but requires re-running.",
      L3: "Structured logging of agent steps. You can reconstruct a run after the fact.",
      L4: "Full tracing with a tool like Langfuse/Langsmith. Token usage, latency, and inputs/outputs visible per step.",
      L5: "Production-grade observability. Dashboards, alerts, per-step metrics, correlation across agents, replay capability."
    }
  },
  evaluationAndIterationTooling: {
    weight: 5,
    maxPoints: 20,
    descriptors: {
      L1: "No evals. No way to tell if a change made things better or worse.",
      L2: "Ad-hoc manual testing. 'It looks good to me' is the standard.",
      L3: "A small eval set (<20 examples) run manually. Results inform prompt changes.",
      L4: "Automated eval suite with clear pass/fail metrics. Run on every prompt change.",
      L5: "Continuous evals with regression tracking, per-step metrics, and model comparison tooling. Iteration is data-driven."
    }
  },
  agentHandoffsAndMemory: {
    weight: 2,
    maxPoints: 8,
    descriptors: {
      L1: "No handoffs. No memory. Each call is stateless and disconnected.",
      L2: "Handoffs exist but state is passed as blob strings. Memory is lossy and informal.",
      L3: "Structured handoffs with typed contracts. Short-term memory within a run.",
      L4: "Durable memory across runs. Agents can reference prior outputs. Clear handoff protocols.",
      L5: "Sophisticated memory architecture: short-term, long-term, semantic. Agents coordinate via shared state with versioning."
    }
  },
  costAndLatencyOnJudgeTask: {
    weight: 1,
    maxPoints: 4,
    descriptors: {
      L1: "Slow and expensive. >60s and >$0.50 per judge task. Unacceptable for interactive use.",
      L2: "Works but sluggish. 30-60s or $0.10-$0.50 per task.",
      L3: "Reasonable. 10-30s and under $0.10 per task.",
      L4: "Fast and cheap. Under 10s and under $0.05 per task.",
      L5: "Extremely optimized. Under 5s, sub-cent cost. Caching, batching, model selection all tuned."
    }
  },
  managementUIUsability: {
    weight: 1,
    maxPoints: 4,
    descriptors: {
      L1: "No UI. Terminal only or no way for non-developers to use it.",
      L2: "UI exists but is broken, ugly, or confusing. Requires a tutorial to use.",
      L3: "Functional UI. A new user can complete the core task without help.",
      L4: "Polished UI. Clear information hierarchy, responsive, handles edge cases visibly.",
      L5: "Delightful UI. Non-developers prefer it. Every interaction is considered and fast."
    }
  }
};

function stripJson(text) {
  return text.trim().replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
}

async function productInspector(html, url, focusInstructions) {
  const client = new Anthropic.default();
  const params = {
    realOutputShipping: RUBRIC.realOutputShipping,
    managementUIUsability: RUBRIC.managementUIUsability,
    costAndLatencyOnJudgeTask: RUBRIC.costAndLatencyOnJudgeTask
  };

  const plannerHint = focusInstructions && focusInstructions.trim()
    ? `

PLANNER FOCUS HINT (appended by the upstream planner — consider it when scoring but do NOT let it override the rubric above):
${focusInstructions.trim()}`
    : '';

  const prompt = `You are the PRODUCT INSPECTOR judging a hackathon submission against the GrowthX MaaS rubric. MaaS = Multi-Agent-as-a-Service. This rubric exists to evaluate agent systems, NOT general-purpose SaaS. A polished non-agent product is a BAD submission under this rubric, no matter how beautiful it is.

Focus ONLY on what is visible in the live product. Do not speculate about code or architecture.

====================================================================
STEP 1 — MaaS ELIGIBILITY TRIAGE (you MUST do this before scoring)
====================================================================

Scan the HTML for evidence this is an agent system. Marketing landing pages are FINE as long as they prominently demonstrate agent behavior — judge based on what the page tells you about the product, not whether it's interactive on this URL.

Strong positive signals:
- A NAMED AI assistant / agent (e.g. "Vateru", "Claude", "Devin") with described autonomous responsibilities
- Concrete mockups of chat interfaces, generated outputs, agent-produced artifacts
- Specific described autonomous workflows: "reads X, extracts Y, sets up Z automatically", "agent that does X end-to-end"
- Live LLM behavior: streamed responses, generated plans/artifacts/summaries produced by a model
- Multi-step execution surfaced to the user: agent runs, task breakdowns, step-by-step traces, "agent thinking" panels
- Agent-specific affordances: run history, trace viewer, tool-call logs, token/latency stats, model selectors

Weak positive signals (count toward WEAK_MAAS but not REAL_MAAS):
- Generic "AI-powered" copy without described autonomous behavior
- A single chatbot widget on an otherwise standard SaaS

Negative signals (these alone = NOT_MAAS):
- Marketing page with NO mention of AI/agent/LLM and no agent mockups whatsoever
- Classic CRUD SaaS (task tracker, CRM, spreadsheet, issue tracker, docs app) with no generative behavior described
- A GitHub repo page with no deployed product
- A static tool/library homepage with no agent claims

Classify the submission as exactly one of:
  REAL_MAAS  — strong positive signals: named agent + described autonomous workflows OR live agent behavior
  WEAK_MAAS  — only weak positive signals (generic AI copy, single chatbot wrapper) or AI-feature on a non-agent product
  NOT_MAAS   — no agent/LLM evidence at all, not even in marketing copy

====================================================================
STEP 2 — SCORING RULES (apply the triage verdict as a hard cap)
====================================================================

realOutputShipping  (MaaS-specific — the rubric's L5 says "AUTONOMOUSLY completes judge task end-to-end")
  - "Real output" here means OUTPUT PRODUCED BY AGENTS, not "the product works".
  - NOT_MAAS  → L1 hard. A polished non-agent SaaS ships zero agent output. Do NOT reward UX polish here.
  - WEAK_MAAS → cap at L2. An AI feature exists but does not autonomously complete end-to-end tasks.
  - REAL_MAAS → score L1-L5 on the actual evidence:
      L1: pure marketing copy with no accessible product channel anywhere on the page
      L2: accessible product channel exists (WhatsApp/Telegram link, demo button, signup CTA, embedded chat) but no evidence of real users
      L3: narrow real use is described or shown (case study, real example, used a few times)
      L4: active use beyond the team (multiple customers/users referenced, social proof, named clinics/companies)
      L5: production scale (paying users, measurable external impact, "trusted by N organizations")
    Do NOT score L1 just because the page is "marketing" — score L1 only when there's literally no way to access the agent.

costAndLatencyOnJudgeTask  (MaaS-specific — "judge task" refers to the agent's task)
  - NOT_MAAS  → L1 hard. There is no agent judge task to measure.
  - WEAK_MAAS → cap at L2.
  - REAL_MAAS → infer from streaming behavior, model choice signals, page weight, visible latency.

managementUIUsability  (NOT MaaS-specific — pure UX assessment)
  - Score L1-L5 on the full rubric regardless of MaaS triage. Beautiful non-agent UIs can still score L4-L5 here.

====================================================================

Score these 3 rubric parameters based on the fetched HTML below:
${JSON.stringify(params, null, 2)}

URL: ${url}

HTML (truncated to 50000 chars):
${html.slice(0, 50000)}

Return ONLY a JSON object with this exact shape, no markdown, no prose. Start every evidence string with the triage verdict in brackets, e.g. "[NOT_MAAS] ...":

{
  "realOutputShipping": { "level": "L1", "evidence": "[TRIAGE] one sentence citing what you saw in the HTML" },
  "managementUIUsability": { "level": "L3", "evidence": "one sentence citing what you saw in the HTML" },
  "costAndLatencyOnJudgeTask": { "level": "L1", "evidence": "[TRIAGE] one sentence" }
}${plannerHint}`;

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  });

  return JSON.parse(stripJson(msg.content[0].text));
}

function parseRepoUrl(repoUrl) {
  const parts = repoUrl.replace(/\.git$/, '').replace(/\/$/, '').split('/');
  const repo = parts[parts.length - 1];
  const owner = parts[parts.length - 2];
  return { owner, repo };
}

async function ghFetch(url) {
  const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'clawstand' };
  if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.error(`[repoAuditor] GitHub API ${res.status} on ${url}`);
    return { __error: `${res.status}` };
  }
  return await res.json();
}

function decodeContent(payload) {
  if (!payload || payload.__error || !payload.content) return '';
  try {
    return Buffer.from(payload.content, payload.encoding || 'base64').toString('utf-8');
  } catch (e) {
    return '';
  }
}

async function repoAuditor(repoUrl, focusInstructions) {
  const params = {
    taskDecompositionQuality: RUBRIC.taskDecompositionQuality,
    observability: RUBRIC.observability,
    evaluationAndIterationTooling: RUBRIC.evaluationAndIterationTooling,
    agentHandoffsAndMemory: RUBRIC.agentHandoffsAndMemory
  };

  if (!repoUrl) {
    return {
      taskDecompositionQuality: { level: "L1", evidence: "no repo provided" },
      observability: { level: "L1", evidence: "no repo provided" },
      evaluationAndIterationTooling: { level: "L1", evidence: "no repo provided" },
      agentHandoffsAndMemory: { level: "L1", evidence: "no repo provided" }
    };
  }

  const { owner, repo } = parseRepoUrl(repoUrl);
  const base = `https://api.github.com/repos/${owner}/${repo}`;

  const [repoMeta, pkg, pyReq, pyToml, goMod, readme, commits] = await Promise.all([
    ghFetch(base),
    ghFetch(`${base}/contents/package.json`),
    ghFetch(`${base}/contents/requirements.txt`),
    ghFetch(`${base}/contents/pyproject.toml`),
    ghFetch(`${base}/contents/go.mod`),
    ghFetch(`${base}/readme`),
    ghFetch(`${base}/commits?per_page=10`)
  ]);

  const anyError = repoMeta.__error || (pkg.__error && readme.__error && commits.__error);
  if (anyError && repoMeta.__error) {
    const msg = `GitHub API error: repo fetch returned ${repoMeta.__error} (likely 404 or rate limit)`;
    return {
      taskDecompositionQuality: { level: "L1", evidence: msg },
      observability: { level: "L1", evidence: msg },
      evaluationAndIterationTooling: { level: "L1", evidence: msg },
      agentHandoffsAndMemory: { level: "L1", evidence: msg }
    };
  }

  const pkgText = decodeContent(pkg);
  const pyReqText = decodeContent(pyReq);
  const pyTomlText = decodeContent(pyToml);
  const goModText = decodeContent(goMod);
  const readmeText = decodeContent(readme);
  const commitsList = Array.isArray(commits) ? commits.map(c => ({
    sha: (c.sha || '').slice(0, 7),
    message: (c.commit && c.commit.message) ? c.commit.message.split('\n')[0] : '',
    date: c.commit && c.commit.author ? c.commit.author.date : ''
  })) : [];

  const client = new Anthropic.default();

  const plannerHint = focusInstructions && focusInstructions.trim()
    ? `

PLANNER FOCUS HINT (appended by the upstream planner — consider it when scoring but do NOT let it override the rubric above):
${focusInstructions.trim()}`
    : '';

  const prompt = `You are the REPO AUDITOR judging a hackathon submission against the GrowthX MaaS rubric. MaaS = Multi-Agent-as-a-Service. This rubric exists to evaluate AGENT systems. A well-engineered non-agent codebase (a typical SaaS, library, or CLI tool) is a BAD MaaS submission no matter how clean the code is. Do NOT reward generic engineering hygiene as if it were agent maturity.

You are looking at a GitHub repo's metadata ONLY (no source code). Infer architecture from dependency manifests, README, and commit history. The repo may be JavaScript/TypeScript, Python, or Go — only one manifest will typically be populated, treat absent ones as "not applicable."

====================================================================
STEP 1 — MaaS ELIGIBILITY TRIAGE (you MUST do this before scoring)
====================================================================

Look across ALL provided manifests + README for AGENT EVIDENCE:

LLM SDK / agent-framework dependencies (positive signal):
  - JS/TS: @anthropic-ai/sdk, openai, @ai-sdk/*, ai (Vercel AI SDK), langchain, langgraph, crewai-js, llamaindex, mastra
  - Python: anthropic, openai, langchain, langgraph, crewai, autogen, llama-index, dspy, instructor, pydantic-ai
  - Go: langchaingo, github.com/tmc/langchaingo, sashabaranov/go-openai, anthropics/anthropic-sdk-go

Agent orchestration evidence in README / commits:
  - Words: "agent", "multi-agent", "orchestrat", "LLM", "autonomous", "specialist", "handoff", "tool calling"
  - Architecture diagrams describing agent roles
  - Named agent files in repo description (e.g. "inspector", "auditor", "writer", "planner")

Classify the repo as exactly one of:
  REAL_MAAS  — multiple LLM-calling agents OR a real orchestration framework + named specialist agents
  WEAK_MAAS  — exactly one LLM SDK dependency wrapped in a normal app, no orchestration, no multiple agents
  NOT_MAAS   — zero LLM dependencies, zero agent references anywhere; it's a generic web app, library, CLI, or game

====================================================================
STEP 2 — SCORING RULES (ALL FOUR PARAMETERS HERE ARE MaaS-SPECIFIC)
====================================================================

If NOT_MAAS → return L1 for ALL FOUR parameters. Evidence must explicitly cite the absence of LLM/agent dependencies. Do NOT hand out L3 for "good code structure" or "has tests" — those are not MaaS signals.

If WEAK_MAAS → cap ALL FOUR parameters at L2.

If REAL_MAAS → score L1-L5 normally, but enforce these per-parameter caps:

  taskDecompositionQuality
    - Requires MULTIPLE named specialist agents with defined input/output contracts.
    - One LLM call (even if well-structured) = L1-L2 maximum.
    - L4-L5 needs explicit agent modules with documented handoff contracts.

  agentHandoffsAndMemory
    - Requires observable state passed BETWEEN agents.
    - A single agent = L1 by definition (nothing to hand off to).
    - L3+ requires structured handoffs (typed payloads, shared memory store).

  observability  (STRICT — agent observability only)
    - L3+ REQUIRES agent-specific observability tooling: langfuse, langsmith, braintrust, arize, weights & biases (W&B traces), phoenix (arize-phoenix), helicone, traceloop / openllmetry.
    - General APM tools (Datadog, Sentry, New Relic, Grafana) do NOT count for L3+.
    - General logging libs (pino, winston, bunyan, structlog, loguru, zap, zerolog) do NOT count for L3+.
    - Code-level console.log / print does NOT count.
    - Without an agent-observability dep → cap at L2.

  evaluationAndIterationTooling
    - Requires LLM/agent eval frameworks: promptfoo, langsmith evals, deepeval, ragas, trulens, openai/evals, inspect-ai, braintrust evals.
    - Plain unit tests (vitest/jest/pytest/go test) without eval fixtures cap at L2.
    - L4-L5 requires automated eval runs visible in commits or CI.

====================================================================

Score these 4 rubric parameters:
${JSON.stringify(params, null, 2)}

REPO: ${repoUrl}
PRIMARY LANGUAGE (per GitHub): ${repoMeta.language || 'unknown'}
DEFAULT BRANCH: ${repoMeta.default_branch || 'unknown'}
STARS: ${repoMeta.stargazers_count || 0}
DESCRIPTION: ${repoMeta.description || ''}

--- package.json (JS/TS, empty if not found) ---
${pkgText.slice(0, 8000)}

--- requirements.txt (Python, empty if not found) ---
${pyReqText.slice(0, 4000)}

--- pyproject.toml (Python, empty if not found) ---
${pyTomlText.slice(0, 4000)}

--- go.mod (Go, empty if not found) ---
${goModText.slice(0, 4000)}

--- README (truncated) ---
${readmeText.slice(0, 15000)}

--- Last 10 commits ---
${JSON.stringify(commitsList, null, 2)}

Return ONLY a JSON object with this exact shape, no markdown, no prose. Cite the specific manifest or README section in each evidence string. Start every evidence string with the triage verdict in brackets, e.g. "[NOT_MAAS] ...":

{
  "taskDecompositionQuality": { "level": "L1", "evidence": "[TRIAGE] one sentence citing deps/README" },
  "observability": { "level": "L1", "evidence": "[TRIAGE] one sentence citing deps/README" },
  "evaluationAndIterationTooling": { "level": "L1", "evidence": "[TRIAGE] one sentence citing deps/README" },
  "agentHandoffsAndMemory": { "level": "L1", "evidence": "[TRIAGE] one sentence citing deps/README" }
}${plannerHint}`;

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  });

  return JSON.parse(stripJson(msg.content[0].text));
}

async function pitchWriter(scores, total, maxTotal, opts) {
  const client = new Anthropic.default();
  const o = opts || {};
  const trackName = (o.trackName || 'MaaS').toString();
  const rubric = o.rubric || RUBRIC;
  const rootKey = o.rootKey || 'realOutputShipping';
  const nomThreshold = typeof o.nomThreshold === 'number' ? o.nomThreshold : Math.floor(maxTotal * 0.5);
  const prompt = `You are the PITCH WRITER. You see the full rubric scores for a hackathon submission on the ${trackName} track and must deliver a 60-second mentor advocacy speech — first person, punchy, spoken aloud on stage.

TRACK: ${trackName}

RUBRIC WEIGHTS (so you know what matters most; the root parameter dominates):
${JSON.stringify(Object.fromEntries(Object.entries(rubric).map(([k, v]) => [k, { weight: v.weight, maxPoints: v.maxPoints, root: !!v.root }])), null, 2)}

SCORES:
${JSON.stringify(scores, null, 2)}

TOTAL: ${total} / ${maxTotal}

Decide: NOMINATE or CUT. The bar for NOMINATE is a submission with strong performance on the root parameter (${rootKey} >= L3) AND total >= ${nomThreshold} (i.e. >= 50% of max). Otherwise CUT.

Return ONLY a JSON object with this exact shape, no markdown, no prose:

{
  "verdict": "NOMINATE",
  "pitch": "60-second spoken mentor advocacy — first person, punchy, specific references to the scores. No filler. Reads aloud in ~60 seconds (roughly 150 words).",
  "reasoning": "one paragraph explaining the verdict and the key rubric signals behind it"
}`;

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1536,
    messages: [{ role: 'user', content: prompt }]
  });

  return JSON.parse(stripJson(msg.content[0].text));
}

const RUBRIC_VIRALITY = {
  impressionsAndViews: {
    weight: 1,
    maxPoints: 4,
    descriptors: {
      L1: "Under 100",
      L2: "101 to 1k",
      L3: "1k to 2.5k",
      L4: "2.5k to 5k",
      L5: "5k to 7.5k+"
    }
  },
  reactionsAndComments: {
    weight: 2,
    maxPoints: 8,
    descriptors: {
      L1: "Under 3",
      L2: "3-10",
      L3: "11-25",
      L4: "26-50",
      L5: "51-100+"
    }
  },
  amplificationQuality: {
    weight: 3,
    maxPoints: 12,
    descriptors: {
      L1: "None",
      L2: "1-2 peer builders engaging",
      L3: "3+ peer builders OR 1 sub-10k-follower founder",
      L4: "1 notable 10k+ founder/operator reshare",
      L5: "Multiple notables, PH feature, press, or investor amplification"
    }
  },
  visitorsToProduct: {
    weight: 10,
    maxPoints: 40,
    descriptors: {
      L1: "Under 10",
      L2: "11-50",
      L3: "51-250",
      L4: "251-1000",
      L5: "1000+"
    }
  },
  signupsOrMeaningfulActions: {
    weight: 25,
    maxPoints: 100,
    root: true,
    descriptors: {
      L1: "Up to 5",
      L2: "6-25",
      L3: "26-100",
      L4: "101-250",
      L5: "251-1000+"
    }
  }
};

const RUBRIC_REVENUE = {
  signups: {
    weight: 20,
    maxPoints: 80,
    root: true,
    descriptors: {
      L1: "0",
      L2: "1-25",
      L3: "26-100",
      L4: "101-250",
      L5: "251+"
    }
  },
  liveProductQuality: {
    weight: 8,
    maxPoints: 32,
    descriptors: {
      L1: "Broken",
      L2: "Rough MVP, happy path only",
      L3: "Working, does what it claims",
      L4: "Polished, noticeably better than alternatives",
      L5: "10x product, magical onboarding"
    }
  },
  revenueGenerated: {
    weight: 4,
    maxPoints: 16,
    descriptors: {
      L1: "$0",
      L2: "Up to $25",
      L3: "$25-$100",
      L4: "$100-$500",
      L5: "$500+"
    }
  },
  waitlist: {
    weight: 4,
    maxPoints: 16,
    descriptors: {
      L1: "0",
      L2: "1-50",
      L3: "51-250",
      L4: "251-1000",
      L5: "1000+"
    }
  },
  painPointSeverity: {
    weight: 2,
    maxPoints: 8,
    descriptors: {
      L1: "Cannot name a specific user",
      L2: "Vague persona",
      L3: "Named user, 1-2 conversations",
      L4: "Named user, 3+ conversations with quotes",
      L5: "5+ conversations, 'can I pay for this now' moment"
    }
  },
  som: {
    weight: 2,
    maxPoints: 8,
    descriptors: {
      L1: "No math",
      L2: "Math wrong unit/multiplication",
      L3: "Users × ACV correct, under ₹10cr",
      L4: "Users × ACV correct, ₹10cr-₹1000cr",
      L5: "Users × ACV correct, over ₹1000cr"
    }
  },
  rightToWin: {
    weight: 2,
    maxPoints: 8,
    descriptors: {
      L1: "Team could be anyone",
      L2: "Generic interest in space",
      L3: "Some domain exposure",
      L4: "Direct operator experience",
      L5: "Deep founder-market fit, unfair advantage visible in build"
    }
  },
  whyNow: {
    weight: 1,
    maxPoints: 4,
    descriptors: {
      L1: "Could have been built 5 years ago",
      L2: "Riding general trends",
      L3: "Clear tailwind in last 2 years",
      L4: "Specific unlock in last 12 months",
      L5: "Window opened under 6 months ago, visible in product"
    }
  },
  moatAndDefensibility: {
    weight: 1,
    maxPoints: 4,
    descriptors: {
      L1: "Copyable in a weekend",
      L2: "Thin, first-mover only",
      L3: "Workflow lock-in, integrations, taste",
      L4: "Data flywheel, network effects, switching costs",
      L5: "Compounding moat: proprietary data + network effects"
    }
  }
};

async function viralityJudge({ url, html, stats, repoUrl }) {
  const client = new Anthropic.default();
  const s = stats || {};
  const statsBlock = {
    impressions: s.impressions !== undefined ? s.impressions : 'NOT_REPORTED',
    reactions: s.reactions !== undefined ? s.reactions : 'NOT_REPORTED',
    visitors: s.visitors !== undefined ? s.visitors : 'NOT_REPORTED',
    signups: s.signups !== undefined ? s.signups : 'NOT_REPORTED',
    amplification: s.amplification !== undefined ? s.amplification : 'NOT_REPORTED'
  };

  const prompt = `You are the VIRALITY JUDGE scoring a hackathon submission against the GrowthX VIRALITY rubric. Virality is NOT "the product is good" — it's "the launch artifact made people share, visit, and sign up". The ROOT parameter is signupsOrMeaningfulActions (weight 25).

CRITICAL CONCEPT — PERSONAL SHAREABLE ARTIFACT:
Virality requires a Spotify-Wrapped-style PERSONAL SHAREABLE ARTIFACT: something that, when a user uses the product, produces a personalized result they WANT to post. If the product has no such artifact visible in the HTML (no "share your result", no generated card/image/URL per user, no personalized output worth posting), note this in evidence — it is a conceptual ceiling on how viral this submission can be, regardless of the numbers reported.

RUBRIC (5 parameters, 164 max):
${JSON.stringify(RUBRIC_VIRALITY, null, 2)}

SELF-REPORTED STATS (from the team):
${JSON.stringify(statsBlock, null, 2)}

URL: ${url}
REPO: ${repoUrl || 'NOT_PROVIDED'}

HTML (truncated to 40000 chars):
${(html || '').slice(0, 40000)}

SCORING RULES:
- For numeric parameters (impressionsAndViews, reactionsAndComments, visitorsToProduct, signupsOrMeaningfulActions): fit the reported stat into the exact L1-L5 bucket above.
- If a stat is NOT_REPORTED: return L1 with evidence "no [stat name] reported by team".
- For amplificationQuality: judge from the amplification string (who engaged/reshared) combined with any social proof visible in HTML (testimonials, PH badges, press mentions, investor logos).
- Evidence strings MUST be ≤ 180 chars and cite the stat number or the HTML signal.
- If no personal shareable artifact is visible in HTML, append a short "[no shareable artifact]" note in at least one evidence string — it caps real upside.

Return ONLY a JSON object with this exact shape, no markdown, no prose:

{
  "impressionsAndViews": { "level": "L1", "evidence": "one sentence citing stat or HTML signal" },
  "reactionsAndComments": { "level": "L1", "evidence": "one sentence" },
  "amplificationQuality": { "level": "L1", "evidence": "one sentence" },
  "visitorsToProduct": { "level": "L1", "evidence": "one sentence" },
  "signupsOrMeaningfulActions": { "level": "L1", "evidence": "one sentence" }
}`;

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1536,
    messages: [{ role: 'user', content: prompt }]
  });

  return JSON.parse(stripJson(msg.content[0].text));
}

async function revenueJudge({ url, html, stats, repoUrl }) {
  const client = new Anthropic.default();
  const s = stats || {};
  const statsBlock = {
    signups: s.signups !== undefined ? s.signups : 'NOT_REPORTED',
    revenueUSD: s.revenueUSD !== undefined ? s.revenueUSD : 'NOT_REPORTED',
    waitlist: s.waitlist !== undefined ? s.waitlist : 'NOT_REPORTED'
  };

  const prompt = `You are the REVENUE JUDGE scoring a hackathon submission against the GrowthX REVENUE rubric. The ROOT parameter is signups (weight 20). Revenue here is about BUILDING A REAL BUSINESS — signups, paying users, product quality, market sizing, founder-market fit.

WHAT COUNTS AS REVENUE:
- Revenue = money paid for the PRODUCT, not services/consulting/agency work.
- If stats.revenueUSD > 0 but the HTML clearly shows a services/agency/consulting business (hourly rates, "book a call to start", custom project pricing), cap revenueGenerated at L2 and note this in evidence.

RUBRIC (9 parameters, 176 max):
${JSON.stringify(RUBRIC_REVENUE, null, 2)}

SELF-REPORTED STATS (from the team):
${JSON.stringify(statsBlock, null, 2)}

URL: ${url}
REPO: ${repoUrl || 'NOT_PROVIDED'}

HTML (truncated to 40000 chars):
${(html || '').slice(0, 40000)}

SCORING RULES:
- Numeric params (signups, revenueGenerated, waitlist): use self-reported stats directly. Fit the number into the exact L1-L5 bucket. If missing: return L1 with evidence "no [X] reported".
- Judgment params (liveProductQuality, painPointSeverity, som, rightToWin, whyNow, moatAndDefensibility): infer from the HTML landing page + copy. Be STRICT. L3 is the default when unclear. L4-L5 requires specific evidence cited from the HTML.
  * liveProductQuality: judge from UX polish, onboarding clarity, visible functionality described on the page.
  * painPointSeverity: look for named users, quotes, testimonials, specific personas with concrete problems.
  * som: look for stated market math; if absent → L1 "no math".
  * rightToWin: look for founder bios, domain signals, "built by X who did Y".
  * whyNow: look for recent-unlock references (new AI capability, new regulation, new platform).
  * moatAndDefensibility: look for stated moat — data flywheel, network effects, integrations, proprietary data.
- Evidence strings ≤ 180 chars, cite the HTML signal or stat number.

Return ONLY a JSON object with this exact shape, no markdown, no prose:

{
  "signups": { "level": "L1", "evidence": "one sentence" },
  "liveProductQuality": { "level": "L3", "evidence": "one sentence citing HTML" },
  "revenueGenerated": { "level": "L1", "evidence": "one sentence" },
  "waitlist": { "level": "L1", "evidence": "one sentence" },
  "painPointSeverity": { "level": "L3", "evidence": "one sentence citing HTML" },
  "som": { "level": "L1", "evidence": "one sentence citing HTML" },
  "rightToWin": { "level": "L3", "evidence": "one sentence citing HTML" },
  "whyNow": { "level": "L3", "evidence": "one sentence citing HTML" },
  "moatAndDefensibility": { "level": "L3", "evidence": "one sentence citing HTML" }
}`;

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1536,
    messages: [{ role: 'user', content: prompt }]
  });

  return JSON.parse(stripJson(msg.content[0].text));
}

module.exports = { RUBRIC, RUBRIC_VIRALITY, RUBRIC_REVENUE, planExecution, productInspector, repoAuditor, pitchWriter, viralityJudge, revenueJudge };
