#!/usr/bin/env node
/**
 * Eval harness for ClawStand.
 *
 *   node evals/run.js              — run all 4 cases in parallel
 *   node evals/run.js --sequential — run one at a time (kinder to API rate limits)
 *   node evals/run.js --case linear — run a single named case
 *
 * For each case, invokes `node judge.js` as a subprocess, parses the JSON on
 * stdout, and diffs it against evals/baseline.json. Prints PASS/FAIL per case
 * and a summary. Exit code 0 iff all cases pass.
 *
 * This exists so that when someone changes a prompt in lib/agents.js they can
 * run `npm run eval` and see immediately whether scoring behavior drifted.
 */

require('dotenv').config({ override: true });
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const BASELINE = JSON.parse(fs.readFileSync(path.join(__dirname, 'baseline.json'), 'utf8'));

const args = process.argv.slice(2);
const SEQUENTIAL = args.includes('--sequential');
const CASE_FILTER = (() => {
  const i = args.indexOf('--case');
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();

// ANSI colors — safe on any modern terminal, demo-projector-readable.
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function runJudge(url, repo) {
  return new Promise((resolve) => {
    const argv = ['judge.js', '--url', url];
    if (repo) argv.push('--repo', repo);
    const child = spawn('node', argv, {
      cwd: ROOT,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code !== 0) {
        return resolve({ ok: false, error: `judge.js exited ${code}: ${stderr.slice(-400)}` });
      }
      try {
        resolve({ ok: true, data: JSON.parse(stdout), stderr });
      } catch (e) {
        resolve({
          ok: false,
          error: `could not parse JSON: ${e.message}\nstdout head: ${stdout.slice(0, 300)}`,
        });
      }
    });
    child.on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

/**
 * Extract the triage tag the Product Inspector / Repo Auditor prefixes
 * onto each evidence string, e.g. "[NOT_MAAS] Linear is a CRUD...".
 */
function extractTriage(scores) {
  const productKeys = ['realOutputShipping', 'managementUIUsability', 'costAndLatencyOnJudgeTask'];
  const repoKeys = ['taskDecompositionQuality', 'observability', 'evaluationAndIterationTooling', 'agentHandoffsAndMemory'];
  const pick = (keys) => {
    for (const k of keys) {
      const ev = (scores && scores[k] && scores[k].evidence) || '';
      const m = ev.match(/^\[([A-Z_]+)\]/);
      if (m) return m[1];
    }
    return null;
  };
  return { product: pick(productKeys), repo: pick(repoKeys) };
}

function checkCase(expected, actual) {
  const issues = [];

  if (expected.verdict && actual.verdict !== expected.verdict) {
    issues.push(`verdict: expected ${expected.verdict}, got ${actual.verdict}`);
  }

  if (expected.totalRange) {
    const [min, max] = expected.totalRange;
    if (actual.total < min || actual.total > max) {
      issues.push(`total: ${actual.total} outside expected [${min}, ${max}]`);
    }
  }

  const triage = extractTriage(actual.scores);
  if (expected.productTriage && triage.product !== expected.productTriage) {
    issues.push(`product triage: expected ${expected.productTriage}, got ${triage.product || 'none'}`);
  }
  if (expected.repoTriage && triage.repo !== expected.repoTriage) {
    issues.push(`repo triage: expected ${expected.repoTriage}, got ${triage.repo || 'none'}`);
  }

  if (typeof expected.plannerRanRepoAuditor === 'boolean') {
    const auditor = actual.plan && actual.plan.agents && actual.plan.agents.find((a) => a.name === 'repoAuditor');
    const ran = !!(auditor && auditor.run === true);
    if (ran !== expected.plannerRanRepoAuditor) {
      issues.push(`planner repoAuditor.run: expected ${expected.plannerRanRepoAuditor}, got ${ran}`);
    }
  }

  return issues;
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

async function main() {
  let cases = Object.entries(BASELINE.cases);
  if (CASE_FILTER) {
    cases = cases.filter(([name]) => name === CASE_FILTER);
    if (cases.length === 0) {
      console.error(`no case named "${CASE_FILTER}" in baseline.json`);
      console.error(`available: ${Object.keys(BASELINE.cases).join(', ')}`);
      process.exit(2);
    }
  }

  console.log(`${C.bold}clawstand eval${C.reset}  ${C.dim}${cases.length} case${cases.length === 1 ? '' : 's'}, ${SEQUENTIAL ? 'sequential' : 'parallel'}${C.reset}\n`);

  const started = Date.now();
  const runOne = async ([name, c]) => {
    const t0 = Date.now();
    const res = await runJudge(c.url, c.repo);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    return { name, config: c, res, elapsed };
  };

  let results;
  if (SEQUENTIAL) {
    results = [];
    for (const entry of cases) results.push(await runOne(entry));
  } else {
    results = await Promise.all(cases.map(runOne));
  }

  const totalElapsed = ((Date.now() - started) / 1000).toFixed(1);

  let passed = 0;
  for (const r of results) {
    const label = pad(r.name, 14);
    console.log(`${C.cyan}${label}${C.reset} ${C.dim}${r.elapsed}s${C.reset}`);
    console.log(`  ${C.gray}url${C.reset}  ${r.config.url}`);
    console.log(`  ${C.gray}repo${C.reset} ${r.config.repo || C.dim + '—' + C.reset}`);

    if (!r.res.ok) {
      console.log(`  ${C.red}${C.bold}FAIL${C.reset}  run error`);
      console.log(`        ${C.red}${r.res.error.split('\n').join('\n        ')}${C.reset}\n`);
      continue;
    }

    const { verdict, total, maxTotal, plan, traceUrl } = r.res.data;
    const triage = extractTriage(r.res.data.scores);
    const planSummary = (plan && plan.agents) ? plan.agents.map((a) => `${a.name}=${a.run ? 'RUN' : 'SKIP'}`).join(', ') : 'no plan';

    console.log(`  ${C.gray}got${C.reset}  ${verdict} ${total}/${maxTotal}  ${C.dim}·${C.reset}  triage product=${triage.product || '-'}  repo=${triage.repo || '-'}`);
    console.log(`  ${C.gray}plan${C.reset} ${planSummary}`);
    if (traceUrl) {
      console.log(`  ${C.gray}trace${C.reset} ${C.dim}${String(traceUrl).replace(/\n/g, '')}${C.reset}`);
    }

    const issues = checkCase(r.config.expected, r.res.data);
    if (issues.length === 0) {
      console.log(`  ${C.green}${C.bold}PASS${C.reset}\n`);
      passed++;
    } else {
      console.log(`  ${C.red}${C.bold}FAIL${C.reset}`);
      for (const i of issues) console.log(`        ${C.red}- ${i}${C.reset}`);
      console.log();
    }
  }

  const bar = '─'.repeat(60);
  console.log(bar);
  const allPassed = passed === results.length;
  const summaryColor = allPassed ? C.green : C.red;
  console.log(
    `${summaryColor}${C.bold}${passed}/${results.length} passed${C.reset}  ${C.dim}·  wall time ${totalElapsed}s${C.reset}`
  );
  console.log(bar);

  process.exit(allPassed ? 0 : 1);
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
