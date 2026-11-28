import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const read = file => JSON.parse(readFileSync(join(process.argv[2], file), 'utf8'));
const evidence = {};
for (const phase of ['baseline', 'regression', 'restored']) {
  const workspaces = read(phase + '.catalog');
  const matrix = read(phase + '.matrix');
  for (const { name, report } of matrix.environments) {
    const exposed = name === 'PRODUCTION' && phase === 'regression';
    assert.deepEqual(workspaces[name], [
      { plan: 'free', kotlin: name === 'STAGING' || exposed }, { plan: 'beta', kotlin: true },
    ]);
    assert.equal(report.failed, Number(exposed));
    if (exposed) assert.deepEqual(report.cases[0].mismatches, [{
      flag: 'AMP_enable-kotlin-server-source', kind: 'unexpected_value', field: 'enabled', expected: false, actual: true,
    }]);
  }
  evidence[phase] = { workspaces, matrix };
}
console.log(JSON.stringify(evidence));
