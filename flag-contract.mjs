#!/usr/bin/env node
import { evaluate } from './flagsmith-sdk.mjs';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual, parseArgs } from 'node:util';

const own = (object, key) => Object.hasOwn(object, key);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isScalar = (value) => value === null || ['string', 'number', 'boolean'].includes(typeof value);

function validate(suite) {
  if (!Array.isArray(suite?.cases) || !suite.cases.length) {
    throw new Error('The contract must contain at least one case.');
  }
  const names = new Set();
  for (const scenario of suite.cases) {
    const { name, identity, traits, expect, onlyExpectedFlags } = scenario ?? {};
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
    if (onlyExpectedFlags !== undefined && typeof onlyExpectedFlags !== 'boolean') {
      throw new Error(`${name}: onlyExpectedFlags must be a boolean.`);
    }
    if (!isObject(expect) || (!onlyExpectedFlags && !Object.keys(expect).length)) {
      throw new Error(`${name}: specify at least one expected flag.`);
    }
    for (const [flag, checks] of Object.entries(expect)) {
      if (!flag.trim() || !isObject(checks) || !Object.keys(checks).length ||
          Object.keys(checks).some((key) => !['present', 'enabled', 'value'].includes(key)) ||
          (own(checks, 'present') && typeof checks.present !== 'boolean') ||
          (own(checks, 'enabled') && typeof checks.enabled !== 'boolean')) {
        throw new Error(`${name}: ${flag} needs a present, enabled, or value assertion.`);
      }
      if (checks.present === false && Object.keys(checks).length > 1) {
        throw new Error(`${name}: ${flag} cannot assert enabled or value when present is false.`);
      }
    }
  }
}

async function main(args, json) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      matrix: { type: 'boolean' },
      check: { type: 'boolean' },
      json: { type: 'boolean' },
      case: { type: 'string', multiple: true },
      'list-cases': { type: 'boolean' },
      'redact-values': { type: 'boolean' },
    },
  });
  if (positionals.length !== 1) {
    throw new Error('Usage: flag-contract CONTRACT.json [--case NAME] [--check | --list-cases] [--json] [--redact-values]');
  }
  if (values.check && values['list-cases']) {
    throw new Error('Use either --check or --list-cases.');
  }
  const [filename] = positionals;
  if (values.matrix) {
    if (values.case || values['list-cases']) throw new Error('Case selection applies to a single contract.');
    const { runMatrix } = await import('./environment-matrix.mjs');
    return runMatrix(filename, values);
  }
  const suite = JSON.parse(await readFile(filename, 'utf8'));
  validate(suite);
  const requested = new Set(values.case);
  const scenarios = requested.size ? suite.cases.filter(({ name }) => requested.has(name)) : suite.cases;
  if (requested.size && scenarios.length !== requested.size) {
    for (const { name } of scenarios) requested.delete(name);
    throw new Error(`Unknown case names: ${[...requested].map((name) => JSON.stringify(name)).join(', ')}.`);
  }
  if (values['list-cases']) {
    const cases = scenarios.map(({ name }) => name);
    console.log(json ? JSON.stringify({ status: 'listed', cases }) : cases.join('\n'));
    return 0;
  }
  if (values.check) {
    const count = scenarios.length;
    console.log(json ? JSON.stringify({ status: 'valid', cases: count }) :
      `Contract is valid (${count} ${count === 1 ? 'case' : 'cases'}).`);
    return 0;
  }
  const key = process.env.FLAGSMITH_ENVIRONMENT_KEY?.trim();
  if (!key) throw new Error('Set FLAGSMITH_ENVIRONMENT_KEY to the client-side environment key.');
  const base = new URL(process.env.FLAGSMITH_API_URL || 'http://localhost:8000/api/v1/');
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
      base.search || base.hash) {
    throw new Error('FLAGSMITH_API_URL must be an HTTP(S) base URL without credentials or parameters.');
  }
  if (!base.pathname.endsWith('/')) base.pathname += '/';

  const cases = [];
  const redactValues = values['redact-values'];
  for (const scenario of scenarios) {
    const actual = await evaluate(base, key, scenario);
    const mismatches = [];
    for (const [flag, checks] of Object.entries(scenario.expect)) {
      const state = actual.get(flag);
      if (checks.present === false) {
        if (state) mismatches.push({ flag, kind: 'unexpected_flag' });
        continue;
      }
      if (!state) {
        mismatches.push({ flag, kind: 'missing_flag' });
        continue;
      }
      for (const [field, expected] of Object.entries(checks)) {
        if (field === 'present') continue;
        if (!isDeepStrictEqual(state[field], expected)) {
          const detail = field === 'value' && redactValues
            ? { redacted: true }
            : { expected, actual: state[field] };
          mismatches.push({ flag, kind: 'unexpected_value', field, ...detail });
        }
      }
    }
    if (scenario.onlyExpectedFlags) {
      for (const flag of [...actual.keys()].sort()) {
        if (!own(scenario.expect, flag)) mismatches.push({ flag, kind: 'unlisted_flag' });
      }
    }
    const status = mismatches.length ? 'fail' : 'pass';
    cases.push({ name: scenario.name, status, mismatches });
    if (!json) {
      for (const mismatch of mismatches) {
        const { flag, kind, field, expected, actual: received, redacted } = mismatch;
        if (kind === 'missing_flag') {
          console.error(`  ${flag}: flag missing`);
        } else if (kind === 'unexpected_flag') {
          console.error(`  ${flag}: expected flag to be absent, but it was returned`);
        } else if (kind === 'unlisted_flag') {
          console.error(`  ${flag}: returned to the client but not listed in this case`);
        } else if (redacted) {
          console.error(`  ${flag}.${field}: unexpected value (redacted)`);
        } else {
          console.error(`  ${flag}.${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(received)}`);
        }
      }
      console.log(`${status.toUpperCase()} ${scenario.name}`);
    }
  }
  const failed = cases.filter(({ status }) => status === 'fail').length;
  const passed = cases.length - failed;
  if (json) {
    console.log(JSON.stringify({ status: failed ? 'fail' : 'pass', passed, failed, cases }, null, 2));
  } else {
    console.log(`${passed}/${cases.length} cases passed`);
  }
  return failed ? 1 : 0;
}

const args = process.argv.slice(2);
const endOfOptions = args.indexOf('--');
const json = (endOfOptions === -1 ? args : args.slice(0, endOfOptions)).includes('--json');
try {
  process.exitCode = await main(args, json);
} catch (error) {
  if (json) {
    console.log(JSON.stringify({ status: 'error', error: error.message }));
  } else {
    console.error(`ERROR: ${error.message}`);
  }
  process.exitCode = 2;
}
