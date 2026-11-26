import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

test('JSON reports distinguish rollout mismatches from API failures', async (t) => {
  let unavailable = false;
  const server = createServer(async (request, response) => {
    if (unavailable) {
      response.writeHead(503).end();
      return;
    }
    if (request.url === '/api/v1/flags/') {
      response.end(JSON.stringify([flag(false, 'standard')]));
      return;
    }

    let body = '';
    for await (const chunk of request) body += chunk;
    const { traits } = JSON.parse(body);
    const flags = traits[0].trait_value === 'free' ? [flag(true, 'hybrid')] : [];
    response.end(JSON.stringify({ flags }));
  }).listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');

  function flag(enabled, value) {
    return { feature: { name: 'search_v2' }, enabled, feature_state_value: value };
  }

  function run() {
    return new Promise((resolve, reject) => {
      execFile(process.execPath, ['flag-contract.mjs', 'example.contract.json', '--json'], {
        cwd: new URL('..', import.meta.url),
        env: {
          ...process.env,
          FLAGSMITH_API_URL: `http://127.0.0.1:${server.address().port}/api/v1/`,
          FLAGSMITH_ENVIRONMENT_KEY: 'example-sdk-key',
        },
      }, (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') return reject(error);
        resolve({ code: error?.code ?? 0, stdout, stderr });
      });
    });
  }

  const mismatch = await run();
  assert.equal(mismatch.code, 1);
  assert.equal(mismatch.stderr, '');
  assert.doesNotMatch(mismatch.stdout, /contract-demo-|example-sdk-key/);

  const report = JSON.parse(mismatch.stdout);
  assert.equal(report.status, 'fail');
  assert.equal(report.passed, 1);
  assert.equal(report.failed, 2);
  assert.deepEqual(report.cases.map(({ mismatches }) => mismatches), [
    [],
    [
      { flag: 'search_v2', kind: 'unexpected_value', field: 'enabled', expected: false, actual: true },
      { flag: 'search_v2', kind: 'unexpected_value', field: 'value', expected: 'standard', actual: 'hybrid' },
    ],
    [{ flag: 'search_v2', kind: 'missing_flag' }],
  ]);

  unavailable = true;
  const failure = await run();
  assert.equal(failure.code, 2);
  assert.equal(failure.stderr, '');
  assert.deepEqual(JSON.parse(failure.stdout), {
    status: 'error',
    error: 'Flagsmith returned HTTP 503.',
  });
});
