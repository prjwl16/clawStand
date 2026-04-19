require('dotenv').config({ override: true });
const { RUBRIC, productInspector, repoAuditor, pitchWriter } = require('./lib/agents');

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

async function main() {
  const url = getFlag('url');
  const repo = getFlag('repo');

  if (!url) {
    console.error('Usage: node judge.js --url <url> [--repo <github-url>]');
    process.exit(1);
  }

  try {
    const res = await fetch(url);
    const html = await res.text();

    const [productScores, repoScores] = await Promise.all([
      productInspector(html, url),
      repoAuditor(repo)
    ]);

    const scores = { ...productScores, ...repoScores };
    const { total, maxTotal } = computeTotal(scores);

    const pitch = await pitchWriter(scores, total, maxTotal);

    const result = {
      scores,
      total,
      maxTotal,
      verdict: pitch.verdict,
      pitch: pitch.pitch,
      reasoning: pitch.reasoning
    };

    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main();
