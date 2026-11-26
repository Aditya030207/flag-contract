import { spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, mkdtempSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function escapeHtml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function summarize(report) {
  if (report.status === 'error') {
    return '## Flag Contract: could not check rollout\n\nSee the JSON report for the configuration or API error.\n';
  }

  const lines = [];
  for (const scenario of report.cases) {
    lines.push(`${scenario.status.toUpperCase()} ${JSON.stringify(scenario.name)}`);
    for (const { flag, kind, field } of scenario.mismatches) {
      const detail = kind === 'missing_flag' ? 'missing flag' : `unexpected ${field}`;
      lines.push(`  ${JSON.stringify(flag)}: ${detail}`);
    }
  }
  const total = report.passed + report.failed;
  return `## Flag Contract: ${report.passed}/${total} passed\n\n<pre>${escapeHtml(lines.join('\n'))}</pre>\n\nThe JSON report contains the expected and actual values.\n`;
}

function run() {
  const { FLAG_CONTRACT_FILE, GITHUB_OUTPUT, GITHUB_STEP_SUMMARY, RUNNER_TEMP } = process.env;
  if (!GITHUB_OUTPUT || !GITHUB_STEP_SUMMARY || !RUNNER_TEMP) {
    throw new Error('Flag Contract Action requires GitHub Actions runner paths.');
  }

  const reportPath = join(mkdtempSync(join(RUNNER_TEMP, 'flag-contract-')), 'report.json');
  const descriptor = openSync(reportPath, 'wx', 0o600);
  const cli = fileURLToPath(new URL('./flag-contract.mjs', import.meta.url));
  let child;
  try {
    child = spawnSync(process.execPath, [cli, ...(FLAG_CONTRACT_FILE ? [FLAG_CONTRACT_FILE] : []), '--json'], {
      stdio: ['ignore', descriptor, 'inherit'],
    });
  } finally {
    closeSync(descriptor);
  }
  if (child.error) throw child.error;
  if (child.status === null) throw new Error('The Flag Contract CLI did not finish.');

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  appendFileSync(GITHUB_OUTPUT, `report-path=${reportPath}\nstatus=${report.status}\n`);
  appendFileSync(GITHUB_STEP_SUMMARY, summarize(report));
  console.log(`Flag Contract result: ${report.status}`);
  return child.status;
}

try {
  process.exitCode = run();
} catch (error) {
  console.error(`Flag Contract Action: ${error.message}`);
  process.exitCode = 2;
}
