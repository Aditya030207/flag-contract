# Flag Contract

Flag Contract checks what your users actually receive from Flagsmith. Store expected rollout behavior in Git, run it against a self-hosted environment, and fail CI if a flag change gives the wrong audience access or returns the wrong configuration.

Run it from the command line or as a GitHub Action. The runner calls Flagsmith's SDK API for anonymous flags and for synthetic identities with transient traits. Flagsmith evaluates the rollout and segment rules. The runner compares the responses with your contract and reports mismatches.

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

Use `--json` to capture a report while keeping the same exit statuses:

```sh
node flag-contract.mjs example.contract.json --json > flag-contract-report.json
```

A completed report includes `status` (`pass` or `fail`), pass/fail counts, and each named case's mismatches. Missing flags have `kind: "missing_flag"`. Unexpected flag fields include the expected and actual values. An interrupted run returns `status: "error"` with the error message in a separate report shape. Reports omit identity identifiers, traits, and the SDK key. Use synthetic cases and treat reported configuration values as data when sharing CI artifacts.

## Run as a GitHub Action

Add a contract to your repository and place these steps in your workflow after checkout. Set `FLAGSMITH_API_URL` as a repository variable and `FLAGSMITH_ENVIRONMENT_KEY` as a secret. Use a runner that can reach your Flagsmith instance.

```yaml
- name: Check rollout
  id: flag-contract
  uses: Aditya030207/flag-contract@v0.2.0
  with:
    contract: flag-contract.json
    api-url: ${{ vars.FLAGSMITH_API_URL }}
    environment-key: ${{ secrets.FLAGSMITH_ENVIRONMENT_KEY }}
- name: Save the report
  if: ${{ always() && steps.flag-contract.outputs.report-path != '' }}
  uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f
  with:
    name: flag-contract-report
    path: ${{ steps.flag-contract.outputs.report-path }}
```

The check writes a case-by-case GitHub job summary and fails the job when a case fails or the API cannot be evaluated. The upload step uses `always()` so the report is available for investigating failures. Run the check after applying candidate targeting rules to a staging or disposable Flagsmith environment.

## Hackathon demo

The [recorded live run](https://github.com/Aditya030207/flag-contract/actions/runs/45328399501) used self-hosted Flagsmith 2.291.0. The baseline passed all three cases. Widening the beta segment produced two mismatches for free users, while anonymous and beta cases still passed. Restoring the segment brought the suite back to three passes.

To replay the same sequence locally, use Node.js 22+, Docker Compose v2, Bash, and curl:

```sh
bash demo/run.sh
```

The script starts a disposable instance with its own database and an available loopback port. It uses the official Compose setup and removes that demo instance and its data when the run ends.

## Flagsmith integration

`flag-contract.mjs` uses the same SDK endpoints and transient trait fields as the [Flagsmith JavaScript client](https://github.com/Flagsmith/flagsmith-js-client/blob/main/flagsmith-core.ts). Flagsmith evaluates the targeting rules and returns `enabled` and `feature_state_value`. The CLI compares those outputs to the contract and never needs a management API key. The demo fixture uses the pinned release's [segment models](https://github.com/Flagsmith/flagsmith/blob/v2.291.0/api/segments/models.py) and [feature models](https://github.com/Flagsmith/flagsmith/blob/v2.291.0/api/features/models.py) to seed the disposable instance.
