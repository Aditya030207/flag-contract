import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const cases = [
  {
    name: 'validates a contract without Flagsmith credentials',
    contract: 'example.contract.json',
    checkOnly: 'true',
    exitCode: 0,
    report: { status: 'valid', cases: 3 },
    summary: /Validated 3 cases offline/,
  },
  {
    name: 'publishes a report for an invalid check-only input',
    contract: 'example.contract.json',
    checkOnly: 'typo',
    exitCode: 2,
    report: { status: 'error', error: 'The check-only input must be true or false.' },
    summary: /could not check contract/,
  },
];

for (const { name, contract, checkOnly, exitCode, report, summary } of cases) {
  test(`Action ${name}`, (t) => {
    const temp = mkdtempSync(join(tmpdir(), 'flag-contract-action-test-'));
    t.after(() => rmSync(temp, { recursive: true, force: true }));
    const outputPath = join(temp, 'output');
    const summaryPath = join(temp, 'summary');
    const result = spawnSync(process.execPath, ['github-action.mjs'], {
      cwd: new URL('..', import.meta.url),
      env: {
        FLAG_CONTRACT_FILE: contract,
        FLAG_CONTRACT_CHECK_ONLY: checkOnly,
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: summaryPath,
        RUNNER_TEMP: temp,
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, exitCode, result.stderr);
    const output = readFileSync(outputPath, 'utf8');
    const reportPath = /^report-path=(.+)$/m.exec(output)?.[1];
    assert.ok(reportPath);
    assert.ok(output.split('\n').includes(`status=${report.status}`));
    assert.deepEqual(JSON.parse(readFileSync(reportPath, 'utf8')), report);
    assert.match(readFileSync(summaryPath, 'utf8'), summary);
  });
}
