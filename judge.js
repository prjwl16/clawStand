require('dotenv').config({ override: true });
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

async function main() {
  const urlArg = process.argv.find(a => a.startsWith('--url='));
  const urlFlagIdx = process.argv.indexOf('--url');
  const url = urlArg ? urlArg.split('=')[1] : (urlFlagIdx !== -1 ? process.argv[urlFlagIdx + 1] : null);

  if (!url) {
    console.error('Usage: node judge.js --url <url>');
    process.exit(1);
  }

  try {
    const res = await fetch(url);
    const html = await res.text();

    const client = new Anthropic.default();

    const prompt = `You are judging a hackathon submission against the GrowthX MaaS rubric. Below is the rubric followed by the raw HTML of the submission's live URL.

RUBRIC:
${JSON.stringify(RUBRIC, null, 2)}

URL: ${url}

HTML (truncated to 50000 chars):
${html.slice(0, 50000)}

For each of the 7 parameters, assign a level L1-L5 based on the evidence in the HTML. Return ONLY a JSON object with this exact shape, no markdown, no prose:

{
  "realOutputShipping": { "level": "L3", "evidence": "one sentence" },
  "taskDecompositionQuality": { "level": "L3", "evidence": "one sentence" },
  "observability": { "level": "L3", "evidence": "one sentence" },
  "evaluationAndIterationTooling": { "level": "L3", "evidence": "one sentence" },
  "agentHandoffsAndMemory": { "level": "L3", "evidence": "one sentence" },
  "costAndLatencyOnJudgeTask": { "level": "L3", "evidence": "one sentence" },
  "managementUIUsability": { "level": "L3", "evidence": "one sentence" }
}`;

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = msg.content[0].text.trim();
    const jsonStr = text.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
    const result = JSON.parse(jsonStr);

    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main();
