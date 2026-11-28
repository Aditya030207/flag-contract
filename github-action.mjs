import { spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function escapeHtml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function summarize(report, redactValues) {
  if (report.status === 'valid') {
    const unit = report.cases === 1 ? 'case' : 'cases';
    return `## Flag Contract: valid contract\n\nValidated ${report.cases} ${unit} offline.\n`;
  }
  if (report.status === 'error') {
    return '## Flag Contract: could not check contract\n\nSee the JSON report for the error.\n';
  }

  const lines = [];
  for (const scenario of report.cases) {
    lines.push(`${scenario.status.toUpperCase()} ${JSON.stringify(scenario.name)}`);
    for (const { flag, kind, field } of scenario.mismatches) {
      const detail = {
        missing_flag: 'missing flag',
        unexpected_flag: 'expected flag to be absent',
        unlisted_flag: 'returned to the client but not listed in this case',
        unexpected_value: `unexpected ${field}`,
      }[kind];
      lines.push(`  ${JSON.stringify(flag)}: ${detail}`);
    }
  }
  const total = report.passed + report.failed;
  const note = redactValues
    ? 'The JSON report omits expected and actual configuration values.'
    : 'The JSON report contains the expected and actual values.';
  return `## Flag Contract: ${report.passed}/${total} passed\n\n<pre>${escapeHtml(lines.join('\n'))}</pre>\n\n${note}\n`;
}

function escapeCommand(text) {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function annotate(report, contract) {
  if (report.status !== 'fail') return;
  const file = escapeCommand(contract).replaceAll(':', '%3A').replaceAll(',', '%2C');
  for (const [index, scenario] of report.cases.entries()) {
    for (const mismatch of scenario.mismatches) {
      const { flag, field, expected, actual, kind } = mismatch;
      const detail = kind === 'unexpected_value'
        ? field === 'enabled' ? `expected ${expected}, received ${actual}` : 'unexpected configuration value'
        : kind.replaceAll('_', ' ');
      const hint = ['unexpected_flag', 'unlisted_flag'].includes(kind)
        ? 'Check client visibility for this flag.'
        : 'Check environment defaults and matching segment overrides.';
      const message = `cases[${index}] ${JSON.stringify(scenario.name)} — ${JSON.stringify(flag)}: ${detail}. ${hint}`;
      console.log(`::error file=${file}::${escapeCommand(message)}`);
    }
  }
}

function runCli(reportPath, contract, checkOnly, redactValues) {
  const options = [['check-only', checkOnly], ['redact-values', redactValues]];
  const invalid = options.find(([, value]) => !['true', 'false'].includes(value));
  if (invalid) {
    const report = { status: 'error', error: `The ${invalid[0]} input must be true or false.` };
    writeFileSync(reportPath, JSON.stringify(report), { flag: 'wx', mode: 0o600 });
    console.error(`Flag Contract Action: ${report.error}`);
    return 2;
  }
  const descriptor = openSync(reportPath, 'wx', 0o600);
  const cli = fileURLToPath(new URL('./flag-contract.mjs', import.meta.url));
  const args = [cli, '--json'];
  if (checkOnly === 'true') args.push('--check');
  if (redactValues === 'true') args.push('--redact-values');
  if (contract) args.push('--', contract);
  let child;
  try {
    child = spawnSync(process.execPath, args, {
      stdio: ['ignore', descriptor, 'inherit'],
    });
  } finally {
    closeSync(descriptor);
  }
  if (child.error) throw child.error;
  if (child.status === null) throw new Error('The Flag Contract CLI did not finish.');
  return child.status;
}

function run() {
  const { FLAG_CONTRACT_FILE, FLAG_CONTRACT_CHECK_ONLY = 'false', FLAG_CONTRACT_REDACT_VALUES = 'false',
    GITHUB_OUTPUT, GITHUB_STEP_SUMMARY, RUNNER_TEMP } = process.env;
  if (!GITHUB_OUTPUT || !GITHUB_STEP_SUMMARY || !RUNNER_TEMP) {
    throw new Error('Flag Contract Action requires GitHub Actions runner paths.');
  }

  const reportPath = join(mkdtempSync(join(RUNNER_TEMP, 'flag-contract-')), 'report.json');
  const exitCode = runCli(reportPath, FLAG_CONTRACT_FILE, FLAG_CONTRACT_CHECK_ONLY, FLAG_CONTRACT_REDACT_VALUES);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  annotate(report, FLAG_CONTRACT_FILE);
  appendFileSync(GITHUB_OUTPUT, `report-path=${reportPath}\nstatus=${report.status}\n`);
  appendFileSync(GITHUB_STEP_SUMMARY, summarize(report, FLAG_CONTRACT_REDACT_VALUES === 'true'));
  console.log(`Flag Contract result: ${report.status}`);
  return exitCode;
}

try {
  process.exitCode = run();
} catch (error) {
  console.error(`Flag Contract Action: ${error.message}`);
  process.exitCode = 2;
}
