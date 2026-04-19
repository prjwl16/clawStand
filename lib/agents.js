const Anthropic = require('@anthropic-ai/sdk');

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

async function productInspector(html, url) {
  const client = new Anthropic.default();
  const params = {
    realOutputShipping: RUBRIC.realOutputShipping,
    managementUIUsability: RUBRIC.managementUIUsability,
    costAndLatencyOnJudgeTask: RUBRIC.costAndLatencyOnJudgeTask
  };

  const prompt = `You are the PRODUCT INSPECTOR judging a hackathon submission against the GrowthX MaaS rubric. Focus ONLY on what is visible in the live product. Do not speculate about code or architecture.

Score these 3 rubric parameters based on the fetched HTML below:
${JSON.stringify(params, null, 2)}

URL: ${url}

HTML (truncated to 50000 chars):
${html.slice(0, 50000)}

For each of the 3 parameters, assign a level L1-L5 based ONLY on evidence visible in the rendered product. Return ONLY a JSON object with this exact shape, no markdown, no prose:

{
  "realOutputShipping": { "level": "L3", "evidence": "one sentence citing what you saw in the HTML" },
  "managementUIUsability": { "level": "L3", "evidence": "one sentence citing what you saw in the HTML" },
  "costAndLatencyOnJudgeTask": { "level": "L3", "evidence": "one sentence (infer from page weight, frameworks visible, obvious client-side cost signals)" }
}`;

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
    console.log(`[repoAuditor] GitHub API ${res.status} on ${url}`);
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

async function repoAuditor(repoUrl) {
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
  const prompt = `You are the REPO AUDITOR judging a hackathon submission against the GrowthX MaaS rubric. You are looking at a GitHub repo's metadata ONLY (no source code). Infer architecture from dependency manifests, README, and commit history. The repo may be JavaScript/TypeScript, Python, or Go — only one manifest will typically be populated, treat absent ones as "not applicable."

Language signals to look for across ecosystems:

OBSERVABILITY (deps or README mentions):
- JS/TS: langfuse, langsmith, @opentelemetry/*, pino, winston with structured logs
- Python: langfuse, langsmith, opentelemetry-*, structlog, loguru
- Go: go.opentelemetry.io/otel, uber-go/zap, rs/zerolog

TASK DECOMPOSITION + AGENT HANDOFFS (deps or README):
- JS/TS: langgraph, crewai-js, @ai-sdk/anthropic, ai, named specialist agent modules
- Python: langgraph, langchain, crewai, autogen, llama-index, anthropic, named agent files (e.g. inspector.py, auditor.py)
- Go: langchaingo, github.com/tmc/langchaingo, explicit agent packages

EVALUATION TOOLING:
- JS/TS: promptfoo, langsmith evals, vitest/jest with eval fixtures, deepeval
- Python: pytest + eval fixtures, deepeval, promptfoo, langsmith, ragas, trulens
- Go: testing package + eval suites (rare; usually L1-L2)

Commit cadence and messages → iteration maturity.

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

Return ONLY a JSON object with this exact shape, no markdown, no prose. Cite the specific manifest or README section you saw in each evidence string:

{
  "taskDecompositionQuality": { "level": "L3", "evidence": "one sentence citing deps/README" },
  "observability": { "level": "L3", "evidence": "one sentence citing deps/README" },
  "evaluationAndIterationTooling": { "level": "L3", "evidence": "one sentence citing deps/README" },
  "agentHandoffsAndMemory": { "level": "L3", "evidence": "one sentence citing deps/README" }
}`;

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  });

  return JSON.parse(stripJson(msg.content[0].text));
}

async function pitchWriter(scores, total, maxTotal) {
  const client = new Anthropic.default();
  const prompt = `You are the PITCH WRITER. You see the full rubric scores for a hackathon submission and must deliver a 60-second mentor advocacy speech — first person, punchy, spoken aloud on stage.

RUBRIC WEIGHTS (so you know what matters most; realOutputShipping dominates):
${JSON.stringify(Object.fromEntries(Object.entries(RUBRIC).map(([k, v]) => [k, { weight: v.weight, maxPoints: v.maxPoints }])), null, 2)}

SCORES:
${JSON.stringify(scores, null, 2)}

TOTAL: ${total} / ${maxTotal}

Decide: NOMINATE or CUT. The bar for NOMINATE is a submission shipping real output with at least decent supporting discipline (typically total >= 82, i.e. >= 50% of max, and realOutputShipping >= L3). Otherwise CUT.

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

module.exports = { RUBRIC, productInspector, repoAuditor, pitchWriter };
