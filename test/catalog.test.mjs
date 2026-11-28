import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { test } from 'node:test';

test('serves the catalog at its printed live URL', { timeout: 10_000 }, async (t) => {
  const server = spawn(process.execPath, ['demo/catalog.mjs', '--serve', 'docs/evidence.json'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, CATALOG_PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const exited = once(server, 'exit');
  t.after(async () => {
    server.kill();
    await exited;
  });
  const output = createInterface({ input: server.stdout });
  const [address] = await Promise.race([once(output, 'line'), exited]);
  assert.match(address, /^Catalog at http:\/\/127\.0\.0\.1:\d+\/\?live$/);
  const url = address.slice('Catalog at '.length);

  const page = await fetch(url, { signal: AbortSignal.timeout(3000) });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Flag Contract/);
  const evidence = await fetch(new URL('evidence.json', url), { signal: AbortSignal.timeout(3000) });
  assert.equal(evidence.status, 200);
  assert.ok((await evidence.json()).baseline);
});
