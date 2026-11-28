export async function evaluate(base, key, scenario) {
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
    !Object.hasOwn(flag, 'feature_state_value'))) {
    throw new Error('Flagsmith returned an unexpected flag payload.');
  }
  return new Map(flags.map((flag) => [flag.feature.name, {
    enabled: flag.enabled,
    value: flag.feature_state_value,
  }]));
}
