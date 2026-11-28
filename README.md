# Flag Contract

Flag Contract checks what your users actually receive from Flagsmith. Store expected rollout behavior in Git, run it against a self-hosted environment, and fail CI if a flag change gives the wrong audience access or returns the wrong configuration.

Run it from the command line or as a GitHub Action. The runner calls Flagsmith's SDK API for anonymous flags and for synthetic identities with transient traits. Flagsmith evaluates the rollout and segment rules. The runner compares the responses with your contract and reports mismatches.

[Watch the submitted demo](https://youtu.be/01JmOaWkK4w) · [Inspect the self-hosted CI run](https://github.com/Aditya030207/flag-contract/actions/runs/46117370602)

## Reproduce the demo

With Node.js 22+, Bash, curl, and Docker running with Compose v2:

```sh
git clone https://github.com/Aditya030207/flag-contract.git
cd flag-contract
bash demo/run.sh
```

The script starts a disposable Flagsmith 2.291.0 instance and database, creates test flags, and evaluates synthetic identities. It removes the demo containers and data at the end. The first run pulls Docker images. No Flagsmith account or existing environment key is needed.

The demo introduces deliberate failures and checks recovery. The demo catches a beta rule that includes free users and an internal flag that appears in client responses. See the [verified run and both JSON reports](https://github.com/Aditya030207/flag-contract/actions/runs/46002460299) for the recorded results.

## Independent consumer example: RudderStack’s Kotlin source

RudderStack’s [Kotlin source definition](https://github.com/rudderlabs/rudder-integrations-config/blob/c0efb7ea755acb82c82980c02c70182864c042d5/src/configurations/sources/kotlin/db-config.json) hides the integration when `AMP_enable-kotlin-server-source` is false. Our [contract](examples/rudder-kotlin.contract.json) models a rollout to invited workspaces. The flag name and hide-when rule come from upstream. The workspace traits, rollout policy, and deliberate targeting mistake are our test fixture.

Run `bash demo/run.sh` to reproduce it in a separate disposable Flagsmith project. Widening the segment enables the Kotlin gate for a standard workspace. The Action identifies the failing contract file, case, and observed boolean. Restoring the segment makes both cases pass. This checks the SDK response that drives the gate; the RudderStack web app and production environment are outside the demo.

## Workspace catalog and pull-request preview

Open the [interactive catalog](https://aditya030207.github.io/flag-contract/). Choose **Widen production** and watch the Kotlin source appear in the standard workspace. Staging permits that audience and passes. Production requires an invitation and fails. **Restore rollout** brings both contracts back to green. The hosted catalog replays SDK evaluations and contract reports from the disposable CI run. The HTTP source is an always-visible example card.

For a live catalog on your own machine, use `bash demo/run.sh --catalog`. After the checks finish, open the printed localhost URL. **Refresh SDK responses** evaluates both workspaces against the running instance. Press Ctrl-C to stop and remove the demo containers and database.

To rehearse a proposed Kotlin rollout, edit [demo/rollout.json](demo/rollout.json) in a PR. Each environment lists the plans receiving the feature. The existing PR workflow applies that file to two disposable Flagsmith environments and runs the matrix. Changing production to `["free", "beta"]` fails the check, names the standard workspace in the job summary and annotates the expected contract. See the [demonstration PR](https://github.com/Aditya030207/flag-contract/pull/1).

## Check multiple environments

An [environment manifest](examples/environments.json) maps uppercase environment names to contract files relative to the manifest. Each contract describes what that environment should return. Set `FLAGSMITH_STAGING_KEY` and `FLAGSMITH_PRODUCTION_KEY` to client SDK keys. Use `FLAGSMITH_API_URL` for a shared server or `FLAGSMITH_STAGING_URL` and `FLAGSMITH_PRODUCTION_URL` for separate servers.

```sh
flag-contract --matrix examples/environments.json --check
flag-contract --matrix examples/environments.json --json
```

The combined report preserves each environment's cases, mismatches and errors. The exit code is 2 if any environment cannot be evaluated, 1 for an assertion failure, and 0 when all pass. Use `--redact-values` when sharing remote configuration reports. For the GitHub Action, set `matrix: 'true'`, pass the manifest as `contract`, provide the named keys in the step's `env`, and use the `api-url` input for a shared server.

## Use your own Flagsmith instance

1. Run [self-hosted Flagsmith](https://docs.flagsmith.com/deployment-self-hosting/hosting-guides/docker) and create a project.
2. Select or create a test environment, then create a feature called `search_v2`. In that environment, set enabled to false and value to `standard`.
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

### Catch newly exposed flags

With v0.5.0 or newer, add `"onlyExpectedFlags": true` to a case to check the complete set of flags that audience receives. For example, if your mobile client should receive only `search_v2`, the case below fails as soon as any other flag appears in its SDK response, even a disabled one.

```json
{
  "name": "Public client receives only the search flag",
  "onlyExpectedFlags": true,
  "expect": { "search_v2": { "present": true } }
}
```

The report gives the name of each extra flag and the mismatch kind `unlisted_flag`, and omits its configuration value. To require an empty client response, use `"expect": {}` with this option. Cases that omit the option continue to check only the flags they name. The [client surface contract](examples/client-surface.contract.json) checks both anonymous visitors and a beta identity in the Docker demo.

### Validate and run a contract

For editor validation, copy [contract.schema.json](contract.schema.json) into your repo and set your contract's `"$schema"` to its relative path. Validate a contract before you have access to Flagsmith:

```sh
node flag-contract.mjs example.contract.json --check
```

This also catches duplicate case names. It needs no SDK key or network connection and exits `0` when valid or `2` for invalid input.

Use repeatable `--case` options to rerun selected cases by exact name. By default, the runner evaluates the whole contract in file order.

List the case names before connecting to Flagsmith. Add `--json` for a machine-readable list.

```sh
node flag-contract.mjs example.contract.json --list-cases
node flag-contract.mjs example.contract.json --case 'Free users get standard search'
```

To use the CLI without cloning this repo, install the package from the GitHub release. It has no npm runtime dependencies.

```sh
npm install --global https://github.com/Aditya030207/flag-contract/releases/download/v0.6.0/aditya030207-flag-contract-0.6.0.tgz
curl -fsSLO https://raw.githubusercontent.com/Aditya030207/flag-contract/v0.6.0/example.contract.json
curl -fsSLO https://raw.githubusercontent.com/Aditya030207/flag-contract/v0.6.0/contract.schema.json
flag-contract example.contract.json --check
```

Node.js 22+ is required.

Run the same file in CI against each environment by setting the API URL and environment key in the corresponding job. Exit status `0` means all cases passed, `1` means a mismatch, and `2` means a configuration or API error.

Use `--json` to capture a report while keeping the same exit statuses:

```sh
node flag-contract.mjs example.contract.json --json > flag-contract-report.json
```

A completed report includes `status` (`pass` or `fail`), pass/fail counts, and each named case's mismatches. Missing and unexpectedly visible flags use `missing_flag` and `unexpected_flag`, respectively. Unexpected flag fields include the expected and actual values. An interrupted run returns `status: "error"` with the error message in a separate report shape. Reports omit identity identifiers, traits, and the SDK key. Use synthetic cases and treat reported configuration values as data when sharing CI artifacts.

When sharing a report, use `--redact-values` with the CLI, or `redact-values: 'true'` with the Action. A configuration value mismatch retains its flag name and field, and replaces the expected and actual values with `"redacted": true`. Case names and enabled-state mismatches remain visible. The checks and exit codes are the same.

## Run as a GitHub Action

Add a contract to your repository and place these steps in your workflow after checkout. Set `FLAGSMITH_API_URL` as a repository variable and `FLAGSMITH_ENVIRONMENT_KEY` as a secret. Use a runner that can reach your Flagsmith instance.

```yaml
- name: Check rollout
  id: flag-contract
  uses: Aditya030207/flag-contract@v0.6.0
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

To validate contracts in pull requests without an environment key, use the Action with `check-only: 'true'` and omit `api-url` and `environment-key`. A valid contract produces the `valid` status and a JSON report with its case count. Run the live check separately against a reachable Flagsmith instance to verify flag behavior.

## Hackathon demo

The [submitted video](https://youtu.be/01JmOaWkK4w) includes output from the self-hosted workflow.

| Scenario | Baseline | Deliberate regression | After restoring the configuration |
| --- | --- | --- | --- |
| Beta search rollout | All 3 cases passed | Widening the beta segment changed both the flag state and its value for free users | All 3 cases passed |
| RudderStack Kotlin source gate | Both synthetic workspaces passed | The standard workspace unexpectedly received the enabled flag | Both cases passed |
| Internal flag visibility | Both client cases passed | Making the internal flag client-visible caused both client cases to fail | Both client cases passed |

Open the [self-hosted demo workflow runs](https://github.com/Aditya030207/flag-contract/actions/workflows/self-hosted.yml) to download the JSON evidence from a successful run. The `flag-contract-demo-report` artifact shows the targeting mismatches, and `flag-contract-visibility-report` shows the unexpected flag returned to both clients. The artifacts capture the deliberately failing checks. The workflow passes when it detects those failures and confirms recovery.

## Flagsmith integration

`flag-contract.mjs` uses the same SDK endpoints and transient trait fields as the [Flagsmith JavaScript client](https://github.com/Flagsmith/flagsmith-js-client/blob/main/flagsmith-core.ts). Flagsmith evaluates the targeting rules and returns `enabled` and `feature_state_value`. The CLI compares those outputs to the contract and never needs a management API key. The demo fixture uses the pinned release's [segment models](https://github.com/Flagsmith/flagsmith/blob/v2.291.0/api/segments/models.py) and [feature models](https://github.com/Flagsmith/flagsmith/blob/v2.291.0/api/features/models.py) to seed the disposable instance.
