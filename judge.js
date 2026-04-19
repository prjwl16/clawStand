require('dotenv').config({ override: true });
const {
  RUBRIC,
  planExecution,
  productInspector,
  repoAuditor,
  pitchWriter,
} = require('./lib/agents');
const { Langfuse } = require('langfuse');

// Same client wiring as lib/langfuse.ts, duplicated here because the CLI
// doesn't go through Next.js. If keys aren't set in .env, Langfuse silently no-ops.
//
// CLI landmine: flushAsync() returns a Promise that can resolve BEFORE all
// span POSTs have hit the server. In a short-lived Node process that exits
// the instant main() returns, the in-flight requests get killed and spans
// never arrive — the trace appears in Langfuse with "No observations found".
// Fix: flushAt:1 (no batching — every event POSTs immediately) + shutdownAsync()
// at the end (waits for every pending request, not just a flush trigger).
const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
  flushAt: 1,
});

const MODEL = 'claude-sonnet-4-5-20250929';

function getFlag(name) {
  const eqArg = process.argv.find(a => a.startsWith(`--${name}=`));
  if (eqArg) return eqArg.split('=').slice(1).join('=');
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

function levelNumber(level) {
  if (!level) return 1;
  const n = parseInt(String(level).replace(/[^0-9]/g, ''), 10);
  return (n >= 1 && n <= 5) ? n : 1;
}

function computeTotal(scores) {
  let total = 0;
  let maxTotal = 0;
  for (const [key, def] of Object.entries(RUBRIC)) {
    const L = levelNumber(scores[key] && scores[key].level);
    total += (L - 1) * def.weight;
    maxTotal += 4 * def.weight;
  }
  return { total, maxTotal };
}

function looksLikeValidGithubUrl(u) {
  if (!u) return false;
  return /^https?:\/\/(www\.)?github\.com\/[^/\s]+\/[^/\s]+/i.test(u);
}

function skippedScoresFor(agentName, reason) {
  if (agentName === 'productInspector') {
    return {
      realOutputShipping: { level: 'L1', evidence: `skipped: ${reason}` },
      managementUIUsability: { level: 'L1', evidence: `skipped: ${reason}` },
      costAndLatencyOnJudgeTask: { level: 'L1', evidence: `skipped: ${reason}` },
    };
  }
  if (agentName === 'repoAuditor') {
    return {
      taskDecompositionQuality: { level: 'L1', evidence: `skipped: ${reason}` },
      observability: { level: 'L1', evidence: `skipped: ${reason}` },
      evaluationAndIterationTooling: { level: 'L1', evidence: `skipped: ${reason}` },
      agentHandoffsAndMemory: { level: 'L1', evidence: `skipped: ${reason}` },
    };
  }
  return {};
}

async function main() {
  const url = getFlag('url');
  const repo = getFlag('repo');

  if (!url) {
    console.error('Usage: node judge.js --url <url> [--repo <github-url>]');
    process.exit(1);
  }

  const trace = langfuse.trace({
    name: 'clawstand-score',
    input: { url, repo: repo || null },
    metadata: { source: 'cli' },
  });

  try {
    // ---- 1. PLANNER ----
    const plannerSpan = trace.span({
      name: 'planner',
      input: { url, repo: repo || null },
      metadata: { model: MODEL, maxTokens: 512 },
    });
    const plan = await planExecution(url, repo || null);
    plannerSpan.end({ output: plan });

    // Defensive: enforce "both agents present, known invariants" even if
    // the planner returned something off-spec.
    plan.agents = (plan.agents || []).filter(
      a => a && (a.name === 'productInspector' || a.name === 'repoAuditor')
    );
    if (!plan.agents.find(a => a.name === 'productInspector')) {
      plan.agents.unshift({ name: 'productInspector', run: true, focusInstructions: '' });
    }
    if (!plan.agents.find(a => a.name === 'repoAuditor')) {
      plan.agents.push({
        name: 'repoAuditor',
        run: !!(repo && looksLikeValidGithubUrl(repo)),
        focusInstructions: '',
        skipReason: !repo ? 'no repo provided' : undefined,
      });
    }
    plan.agents = plan.agents.map(a => {
      if (a.name === 'productInspector') return { ...a, run: true };
      if (a.name === 'repoAuditor') {
        if (!repo || !looksLikeValidGithubUrl(repo)) {
          return {
            ...a,
            run: false,
            skipReason: a.skipReason
              || (!repo ? 'no repo provided' : "repo URL doesn't match github.com/owner/name"),
          };
        }
      }
      return a;
    });

    // ---- 2. Fetch HTML ----
    const res = await fetch(url);
    const html = await res.text();

    // ---- 3. Run planned specialists ----
    const tasks = [];
    let productScores = null;
    let repoScores = null;

    for (const agent of plan.agents) {
      if (agent.name === 'productInspector') {
        if (agent.run) {
          const span = trace.span({
            name: 'productInspector',
            input: { url, htmlLength: html.length, focusInstructions: agent.focusInstructions || '' },
            metadata: { model: MODEL, maxTokens: 1024 },
          });
          tasks.push(productInspector(html, url, agent.focusInstructions).then(r => {
            span.end({ output: r });
            productScores = r;
          }));
        } else {
          productScores = skippedScoresFor('productInspector', agent.skipReason || 'skipped by planner');
        }
      }
      if (agent.name === 'repoAuditor') {
        if (agent.run) {
          const span = trace.span({
            name: 'repoAuditor',
            input: { repo: repo || null, focusInstructions: agent.focusInstructions || '' },
            metadata: { model: MODEL, maxTokens: 1024 },
          });
          tasks.push(repoAuditor(repo || null, agent.focusInstructions).then(r => {
            span.end({ output: r });
            repoScores = r;
          }));
        } else {
          repoScores = skippedScoresFor('repoAuditor', agent.skipReason || 'skipped by planner');
        }
      }
    }

    await Promise.all(tasks);

    const scores = { ...productScores, ...repoScores };
    const { total, maxTotal } = computeTotal(scores);

    // ---- 4. Pitch Writer (unchanged signature) ----
    const pitchSpan = trace.span({
      name: 'pitchWriter',
      input: { scores, total, maxTotal },
      metadata: { model: MODEL, maxTokens: 1536 },
    });
    const pitch = await pitchWriter(scores, total, maxTotal);
    pitchSpan.end({ output: pitch });

    const traceUrl = trace.getTraceUrl();
    trace.update({
      output: { total, maxTotal, verdict: pitch.verdict, planReasoning: plan.reasoning },
    });
    // shutdownAsync waits for every in-flight POST to complete before resolving.
    // Must come AFTER the final trace.update and before console.log so the
    // process doesn't exit mid-flight.
    await langfuse.shutdownAsync();

    const result = {
      scores,
      total,
      maxTotal,
      verdict: pitch.verdict,
      pitch: pitch.pitch,
      reasoning: pitch.reasoning,
      plan,
      traceUrl,
    };
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    trace.update({ output: { error: e && e.message ? e.message : String(e) } });
    await langfuse.shutdownAsync().catch(() => {});
    console.error(e);
    process.exit(1);
  }
}

main();
