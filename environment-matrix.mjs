import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function runMatrix(filename, options) {
  const { environments } = JSON.parse(await readFile(filename, 'utf8'));
  if (!Array.isArray(environments) || !environments.length) throw new Error('Specify at least one environment.');
  const names = new Set();
  for (const { name, contract } of environments) {
    if (typeof name !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(name) || names.has(name) ||
        typeof contract !== 'string' || !contract.trim()) {
      throw new Error('Each environment needs a unique uppercase name and a contract path.');
    }
    names.add(name);
  }

  const results = [];
  let exitCode = 0;
  for (const { name, contract } of environments) {
    const args = [fileURLToPath(new URL('./flag-contract.mjs', import.meta.url)), '--json'];
    if (options.check) args.push('--check');
    if (options['redact-values']) args.push('--redact-values');
    args.push('--', resolve(dirname(filename), contract));
    const child = spawnSync(process.execPath, args, {
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
      env: {
        FLAGSMITH_ENVIRONMENT_KEY: process.env['FLAGSMITH_' + name + '_KEY'] || '',
        FLAGSMITH_API_URL: process.env['FLAGSMITH_' + name + '_URL'] || process.env.FLAGSMITH_API_URL || '',
      },
    });
    if (child.error || child.status === null) throw new Error('Could not complete ' + name + '.');
    const report = JSON.parse(child.stdout);
    results.push({ name, contract, report });
    exitCode = Math.max(exitCode, child.status);
  }
  const status = ['pass', 'fail', 'error'][exitCode];
  if (options.json) {
    console.log(JSON.stringify({ status: options.check && !exitCode ? 'valid' : status, environments: results }, null, 2));
  } else {
    for (const { name, report } of results) {
      console.log(name + '  ' + report.status.toUpperCase());
      if (report.error) console.log('  ' + report.error);
      if (Array.isArray(report.cases)) for (const c of report.cases) {
        console.log('  ' + c.status.toUpperCase() + ' ' + c.name);
        for (const m of c.mismatches) console.log('    ' + JSON.stringify(m));
      }
    }
  }
  return exitCode;
}
