import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

function run(...extra) {
  const result = spawnSync(process.execPath, ['flag-contract.mjs', '--matrix', '--json', 'examples/environments.json', ...extra], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { FLAGSMITH_ENVIRONMENT_KEY: 'single-env-key' },
  });
  return [result.status, JSON.parse(result.stdout)];
}

test('validates each referenced environment contract offline', () => {
  const [code, report] = run('--check');
  assert.equal(code, 0);
  assert.deepEqual(report.environments.map(t => [t.name, t.report.status, t.report.cases]), [
    ['STAGING', 'valid', 2], ['PRODUCTION', 'valid', 2],
  ]);
});

test('reports both missing named environment keys and keeps single-environment credentials isolated', () => {
  const [code, report] = run();
  assert.equal(code, 2);
  assert.equal(report.status, 'error');
  assert.equal(report.environments.length, 2);
  for (const target of report.environments) assert.match(target.report.error, /environment key/i);
});
