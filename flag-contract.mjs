import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

const own = (object, key) => Object.hasOwn(object, key);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isScalar = (value) => value === null || ['string', 'number', 'boolean'].includes(typeof value);

function validate(suite) {
  if (!Array.isArray(suite?.cases) || !suite.cases.length) {
    throw new Error('The contract must contain at least one case.');
  }
  const names = new Set();
  for (const scenario of suite.cases) {
    const { name, identity, traits, expect } = scenario ?? {};
    if (typeof name !== 'string' || !name.trim() || names.has(name)) {
      throw new Error('Every case needs a unique name.');
    }
    names.add(name);
    if (identity !== undefined && (typeof identity !== 'string' || !identity.trim())) {
      throw new Error(`${name}: identity must be a nonempty string.`);
    }
    if (traits !== undefined &&
        (!identity || !isObject(traits) || !Object.values(traits).every(isScalar))) {
      throw new Error(`${name}: traits need an identity and scalar JSON values.`);
    }
    if (!isObject(expect) || !Object.keys(expect).length) {
      throw new Error(`${name}: specify at least one expected flag.`);
    }
    for (const [flag, checks] of Object.entries(expect)) {
      if (!flag.trim() || !isObject(checks) || !Object.keys(checks).length ||
          Object.keys(checks).some((key) => !['enabled', 'value'].includes(key)) ||
          (own(checks, 'enabled') && typeof checks.enabled !== 'boolean')) {
        throw new Error(`${name}: ${flag} needs an enabled and/or value assertion.`);
      }
    }
  }
}

async function evaluate(base, key, scenario) {
  const identity = scenario.identity;
  const headers = { 'X-Environment-Key': key };
  const request = { headers, redirect: 'error', signal: AbortSignal.timeout(10_000) };
  if (identity) {
    headers['Content-Type'] = 'application/json';
    request.method = 'POST';
    request.body = JSON.stringify({
      identifier: identity,
      transient: true,
      traits: Object.entries(scenario.traits ?? {}).map(([trait_key, trait_value]) => ({
        trait_key, trait_value, transient: true,
      })),
    });
  }
  let response;
  try {
    response = await fetch(new URL(identity ? 'identities/' : 'flags/', base), request);
  } catch {
    throw new Error('Flagsmith request failed or timed out.');
  }
  if (!response.ok) throw new Error(`Flagsmith returned HTTP ${response.status}.`);
  const body = await response.json().catch(() => null);
  const flags = identity ? body?.flags : body;
  if (!Array.isArray(flags) || flags.some((flag) =>
    typeof flag?.feature?.name !== 'string' || typeof flag.enabled !== 'boolean' ||
    !own(flag, 'feature_state_value'))) {
    throw new Error('Flagsmith returned an unexpected flag payload.');
  }
  return new Map(flags.map((flag) => [flag.feature.name, {
    enabled: flag.enabled,
    value: flag.feature_state_value,
  }]));
}

async function main() {
  const [, , filename, ...extra] = process.argv;
  if (!filename || extra.length) throw new Error('Usage: node flag-contract.mjs CONTRACT.json');
  const suite = JSON.parse(await readFile(filename, 'utf8'));
  validate(suite);
  const key = process.env.FLAGSMITH_ENVIRONMENT_KEY?.trim();
  if (!key) throw new Error('Set FLAGSMITH_ENVIRONMENT_KEY to the client-side environment key.');
  const base = new URL(process.env.FLAGSMITH_API_URL || 'http://localhost:8000/api/v1/');
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
      base.search || base.hash) {
    throw new Error('FLAGSMITH_API_URL must be an HTTP(S) base URL without credentials or parameters.');
  }
  if (!base.pathname.endsWith('/')) base.pathname += '/';

  let failed = 0;
  for (const scenario of suite.cases) {
    const actual = await evaluate(base, key, scenario);
    let mismatches = 0;
    for (const [flag, checks] of Object.entries(scenario.expect)) {
      const state = actual.get(flag);
      if (!state) {
        console.error(`  ${flag}: flag missing`);
        mismatches++;
        continue;
      }
      for (const [field, expected] of Object.entries(checks)) {
        if (!isDeepStrictEqual(state[field], expected)) {
          console.error(`  ${flag}.${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(state[field])}`);
          mismatches++;
        }
      }
    }
    const status = mismatches ? 'FAIL' : 'PASS';
    console.log(`${status} ${scenario.name}`);
    failed += Number(mismatches > 0);
  }
  console.log(`${suite.cases.length - failed}/${suite.cases.length} cases passed`);
  return failed ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 2;
}
