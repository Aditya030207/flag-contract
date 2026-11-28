import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { evaluate } from '../flagsmith-sdk.mjs';

const root = new URL('../', import.meta.url);
async function snapshot() {
  const targets = JSON.parse(await readFile(new URL('examples/environments.json', root))).environments;
  const result = {};
  for (const { name, contract } of targets) {
    const suite = JSON.parse(await readFile(new URL('examples/' + contract, root)));
    const workspaces = [];
    for (const scenario of suite.cases) {
      const flags = await evaluate(process.env.FLAGSMITH_API_URL, process.env['FLAGSMITH_' + name + '_KEY'], scenario);
      workspaces.push({ plan: scenario.traits.plan, kotlin: flags.get('AMP_enable-kotlin-server-source')?.enabled === true });
    }
    result[name] = workspaces;
  }
  return result;
}

if (process.argv[2] === '--serve') {
  const evidence = await readFile(process.argv[3]);
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === '/live.json') {
        const body = JSON.stringify(await snapshot());
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(body);
      } else if (pathname === '/evidence.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(evidence);
      } else if (pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(await readFile(new URL('docs/index.html', root)));
      } else res.writeHead(404).end();
    } catch {
      res.writeHead(502).end('Flagsmith evaluation unavailable');
    }
  });
  server.listen(Number(process.env.CATALOG_PORT || 4173), '127.0.0.1', () => console.log('Catalog at http://127.0.0.1:' + server.address().port + '/?live'));
} else {
  console.log(JSON.stringify(await snapshot()));
}
