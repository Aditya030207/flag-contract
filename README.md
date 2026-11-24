# Flag Contract

Flag Contract checks what your users actually receive from Flagsmith. Store expected rollout behavior in Git, run it against a self-hosted environment, and fail CI if a flag change gives the wrong audience access or returns the wrong configuration.

The runner calls Flagsmith's SDK API for anonymous flags and for synthetic identities with transient traits. Flagsmith evaluates the rollout and segment rules. The runner compares the responses with your contract and reports mismatches.

## Try the example

1. Run [self-hosted Flagsmith](https://docs.flagsmith.com/deployment-self-hosting/hosting-guides/docker) and create a project.
2. In its demo environment, create a feature called `search_v2` with enabled set to false and value set to `standard`.
3. Create a segment that matches the trait `plan` exactly to `beta`. Add a segment override for `search_v2` with enabled set to true and value set to `hybrid`.
4. With Node.js 22 or newer, run the following command using the environment's **client-side** SDK key. Keep keys in your local environment or CI secrets.

```sh
export FLAGSMITH_API_URL=http://localhost:8000/api/v1/
export FLAGSMITH_ENVIRONMENT_KEY=your_client_environment_key
node flag-contract.mjs example.contract.json
```

Change the segment rule to also match `plan=free` and rerun. The free-user case should fail. Restore the original rule and rerun to show it passing.

## Write your own contract

Each case has a unique `name` and an `expect` map keyed by feature name. Each feature can assert `enabled`, `value`, or both. An omitted `identity` checks the environment defaults. Set an `identity` and optional scalar `traits` to evaluate a synthetic participant. Values are compared as returned by the SDK API, including string versus number differences. Use dedicated synthetic IDs and avoid real user data in contracts.

Run the same file in CI against each environment by setting the API URL and environment key in the corresponding job. Exit status `0` means all cases passed, `1` means a mismatch, and `2` means a configuration or API error.

## Hackathon demo

Show the passing suite, widen the segment in the Flagsmith dashboard, show the free-user failure, then restore the segment and rerun. Explain that this catches audience-level changes even when the environment default stays the same.
