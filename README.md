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

Use `{ "present": false }` to check that the SDK response omits a flag, even if the flag would be disabled when returned. This is useful for checking that a [server-side-only flag](https://docs.flagsmith.com/managing-flags/core-management) stays out of client responses. Use `{ "present": true }` to require a flag without asserting its state. See the [visibility contract](examples/visibility.contract.json) for anonymous and identified examples.

For editor validation, copy [contract.schema.json](contract.schema.json) into your repo and set your contract's `"$schema"` to its relative path. Validate a contract before you have access to Flagsmith:

```sh
node flag-contract.mjs example.contract.json --check
```

This also catches duplicate case names. It needs no SDK key or network connection and exits `0` when valid or `2` for invalid input.

Use repeatable `--case` options to rerun selected cases by exact name. By default, the runner evaluates the whole contract in file order.

```sh
node flag-contract.mjs example.contract.json --case 'Free users get standard search'
```

To use the CLI without cloning this repo, install the package from the GitHub release. It has no npm runtime dependencies.

```sh
npm install --global https://github.com/Aditya030207/flag-contract/releases/download/v0.4.0/aditya030207-flag-contract-0.4.0.tgz
flag-contract example.contract.json --check
```

Use your own contract file, or [download the example](example.contract.json) and its [schema](contract.schema.json). Node.js 22+ is required.

Run the same file in CI against each environment by setting the API URL and environment key in the corresponding job. Exit status `0` means all cases passed, `1` means a mismatch, and `2` means a configuration or API error.

Use `--json` to capture a report while keeping the same exit statuses:

```sh
node flag-contract.mjs example.contract.json --json > flag-contract-report.json
```

A completed report includes `status` (`pass` or `fail`), pass/fail counts, and each named case's mismatches. Missing and unexpectedly visible flags use `missing_flag` and `unexpected_flag`, respectively. Unexpected flag fields include the expected and actual values. An interrupted run returns `status: "error"` with the error message in a separate report shape. Reports omit identity identifiers, traits, and the SDK key. Use synthetic cases and treat reported configuration values as data when sharing CI artifacts.

## Run as a GitHub Action

Add a contract to your repository and place these steps in your workflow after checkout. Set `FLAGSMITH_API_URL` as a repository variable and `FLAGSMITH_ENVIRONMENT_KEY` as a secret. Use a runner that can reach your Flagsmith instance.

```yaml
- name: Check rollout
  id: flag-contract
  uses: Aditya030207/flag-contract@v0.4.0
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

To validate contracts in pull requests without an environment key, use the current Action from `main` with `check-only: 'true'` and omit `api-url` and `environment-key`. A valid contract produces the `valid` status and a JSON report with its case count. Run the live check separately against a reachable Flagsmith instance to verify flag behavior.

## Hackathon demo

Download the [demo video from the v0.4.0 release](https://github.com/Aditya030207/flag-contract/releases/tag/v0.4.0) or inspect the [passing integration run and its reports](https://github.com/Aditya030207/flag-contract/actions/runs/45878945428). The run used self-hosted Flagsmith 2.291.0 and exercised both scenarios:

| Scenario | Baseline | Deliberate regression | After restoring the configuration |
| --- | --- | --- | --- |
| Beta search rollout | All 3 cases passed | Widening the beta segment changed both the flag state and its value for free users | All 3 cases passed |
| Internal flag visibility | Both client cases passed | Making the internal flag client-visible caused both client cases to fail | Both client cases passed |

To replay the same sequence locally, use Node.js 22+, Docker Compose v2, Bash, and curl:

```sh
bash demo/run.sh
```

The script also verifies a second scenario by making a sample internal flag client-visible, checking that both client cases detect it, and restoring the original setting. It starts a disposable instance with its own database and an available loopback port, uses the official Compose setup, and removes the demo instance and data when the run ends.

## Flagsmith integration

`flag-contract.mjs` uses the same SDK endpoints and transient trait fields as the [Flagsmith JavaScript client](https://github.com/Flagsmith/flagsmith-js-client/blob/main/flagsmith-core.ts). Flagsmith evaluates the targeting rules and returns `enabled` and `feature_state_value`. The CLI compares those outputs to the contract and never needs a management API key. The demo fixture uses the pinned release's [segment models](https://github.com/Flagsmith/flagsmith/blob/v2.291.0/api/segments/models.py) and [feature models](https://github.com/Flagsmith/flagsmith/blob/v2.291.0/api/features/models.py) to seed the disposable instance.
