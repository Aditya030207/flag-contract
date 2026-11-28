#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
demo_dir=$(mktemp -d)
compose_file="$demo_dir/compose.yml"
compose=(docker compose -p "flag-contract-demo-$$" -f "$compose_file")
cleanup() {
  "${compose[@]}" down --volumes >/dev/null
  rm -r -- "$demo_dir"
}
trap cleanup EXIT

flagsmith_version=2.291.0
curl -fsSL --retry 3 "https://raw.githubusercontent.com/Flagsmith/flagsmith/v${flagsmith_version}/docker-compose.yml" |
  sed -e "s|flagsmith/flagsmith:latest|flagsmith/flagsmith:${flagsmith_version}|g" \
    -e '/container_name: flagsmith_postgres/d' \
    -e 's|- 8000:8000|- "127.0.0.1::8000"|' \
    -e 's/TASK_RUN_METHOD: TASK_PROCESSOR/TASK_RUN_METHOD: SYNCHRONOUSLY/' \
    > "$compose_file"
"${compose[@]}" up -d flagsmith
host=$("${compose[@]}" port flagsmith 8000)
export FLAGSMITH_API_URL="http://$host/api/v1/"
curl -fsSL --retry 30 --retry-all-errors --retry-delay 2 --max-time 5 "http://$host/" >/dev/null

apply_stage() {
  local seed_output
  if ! seed_output=$("${compose[@]}" exec -T -e "DEMO_STAGE=$1" flagsmith \
    flagsmith shell -c 'import sys; exec(sys.stdin.read())' < demo/seed.py); then
    printf '%s\n' "$seed_output" >&2
    return 1
  fi
  FLAGSMITH_ENVIRONMENT_KEY=$(sed -n 's/^DEMO_ENVIRONMENT_KEY=//p' <<< "$seed_output" | tail -n 1)
  test -n "$FLAGSMITH_ENVIRONMENT_KEY"
  export FLAGSMITH_ENVIRONMENT_KEY
}

printf '\nBaseline · Flagsmith %s · Beta segment matches plan=beta\n' "$flagsmith_version"
apply_stage baseline
node flag-contract.mjs example.contract.json

printf '\nRegression · Beta segment now also matches plan=free\n'
apply_stage regression
status=0
regression_output=$(node flag-contract.mjs example.contract.json 2>&1) || status=$?
printf '%s\n' "$regression_output"
if [[ $status != 1 ]]; then
  printf 'Expected an audience mismatch (exit 1), got exit %s\n' "$status" >&2
  exit 1
fi
grep -Fxq 'FAIL Free users get standard search' <<< "$regression_output"
grep -Fxq '  search_v2.enabled: expected false, got true' <<< "$regression_output"
grep -Fxq '  search_v2.value: expected "standard", got "hybrid"' <<< "$regression_output"
grep -Fxq '2/3 cases passed' <<< "$regression_output"

report_status=0
summary=${GITHUB_STEP_SUMMARY:-"$demo_dir/summary.md"}
FLAG_CONTRACT_FILE=example.contract.json \
  GITHUB_OUTPUT="$demo_dir/action-output" \
  GITHUB_STEP_SUMMARY="$summary" \
  RUNNER_TEMP="$demo_dir" \
  node github-action.mjs || report_status=$?
if [[ $report_status != 1 ]]; then
  printf 'Expected the CI check to exit 1, got exit %s\n' "$report_status" >&2
  exit 1
fi
grep -Fxq 'status=fail' "$demo_dir/action-output"
grep -Fq 'Flag Contract: 2/3 passed' "$summary"
report_path=$(sed -n 's/^report-path=//p' "$demo_dir/action-output")
node --input-type=module -e '
  import assert from "node:assert/strict";
  import { readFileSync } from "node:fs";
  const report = JSON.parse(readFileSync(0, "utf8"));
  assert.equal(report.status, "fail");
  assert.equal(report.passed, 2);
  assert.equal(report.failed, 1);
  const failure = report.cases.find(({ status }) => status === "fail");
  assert.equal(failure.name, "Free users get standard search");
  assert.deepEqual(failure.mismatches.map(({ field }) => field).sort(), ["enabled", "value"]);
  console.log("CI summary and JSON report verified against live Flagsmith");
' < "$report_path"
if [[ -n ${DEMO_JSON_REPORT:-} ]]; then
  cp -- "$report_path" "$DEMO_JSON_REPORT"
fi

redacted_status=0
FLAG_CONTRACT_FILE=example.contract.json \
  FLAG_CONTRACT_REDACT_VALUES=true \
  GITHUB_OUTPUT="$demo_dir/redacted-output" \
  GITHUB_STEP_SUMMARY="$summary" \
  RUNNER_TEMP="$demo_dir" \
  node github-action.mjs || redacted_status=$?
test "$redacted_status" = 1
redacted_path=$(sed -n 's/^report-path=//p' "$demo_dir/redacted-output")
node --input-type=module -e '
  import assert from "node:assert/strict";
  import { readFileSync } from "node:fs";
  const report = JSON.parse(readFileSync(0, "utf8"));
  assert.equal(report.status, "fail");
  assert.equal(report.failed, 1);
  const failure = report.cases.find(({ status }) => status === "fail");
  assert.deepEqual(failure.mismatches.find(({ field }) => field === "value"), {
    flag: "search_v2", kind: "unexpected_value", field: "value", redacted: true,
  });
' < "$redacted_path"
grep -Fq 'The JSON report omits expected and actual configuration values.' "$summary"

printf '\nRestored · Beta segment matches plan=beta again\n'
apply_stage restored
node flag-contract.mjs example.contract.json

printf '\nVisibility · Internal ranking flag is server-side only\n'
node flag-contract.mjs examples/visibility.contract.json
node flag-contract.mjs examples/client-surface.contract.json

printf '\nExposure regression · Internal flag is now client-visible\n'
apply_stage exposed
visibility_status=0
visibility=$(node flag-contract.mjs examples/visibility.contract.json --json) || visibility_status=$?
test "$visibility_status" = 1
node --input-type=module -e '
  import assert from "node:assert/strict";
  import { readFileSync } from "node:fs";
  const report = JSON.parse(readFileSync(0, "utf8"));
  assert.equal(report.failed, 2);
  for (const check of report.cases) {
    assert.deepEqual(check.mismatches, [{ flag: "internal_ranker", kind: "unexpected_flag" }]);
  }
  console.log("Unexpected visibility detected for anonymous and identified clients");
' <<< "$visibility"
if [[ -n ${DEMO_VISIBILITY_JSON_REPORT:-} ]]; then
  printf '%s\n' "$visibility" > "$DEMO_VISIBILITY_JSON_REPORT"
fi

# The client surface contract contains only the public flag name.
surface_status=0
FLAG_CONTRACT_FILE=examples/client-surface.contract.json \
  GITHUB_OUTPUT="$demo_dir/surface-output" GITHUB_STEP_SUMMARY="$summary" RUNNER_TEMP="$demo_dir" \
  node github-action.mjs || surface_status=$?
test "$surface_status" = 1
surface_report=$(sed -n 's/^report-path=//p' "$demo_dir/surface-output")
node --input-type=module -e '
  import assert from "node:assert/strict";
  import { readFileSync } from "node:fs";
  const report = JSON.parse(readFileSync(0, "utf8"));
  assert.equal(report.failed, 2);
  for (const scenario of report.cases) {
    assert.deepEqual(scenario.mismatches, [{ flag: "internal_ranker", kind: "unlisted_flag" }]);
  }
' < "$surface_report"
grep -Fq 'returned to the client but not listed in this case' "$summary"

printf '\nVisibility restored · Internal flag is server-side only again\n'
apply_stage restored
node flag-contract.mjs examples/visibility.contract.json
node flag-contract.mjs examples/client-surface.contract.json

consumer=examples/rudder-kotlin.contract.json
printf '\nConsumer fixture: RudderStack Kotlin source gate (synthetic workspaces)\n'
apply_stage consumer-baseline
node flag-contract.mjs "$consumer"
printf '\nInjected change: widen the invited segment to standard workspaces\n'
apply_stage consumer-regression
consumer_status=0
FLAG_CONTRACT_FILE="$consumer" GITHUB_OUTPUT="$demo_dir/consumer-output" \
  GITHUB_STEP_SUMMARY="$summary" RUNNER_TEMP="$demo_dir" \
  node github-action.mjs > "$demo_dir/consumer-log" || consumer_status=$?
cat "$demo_dir/consumer-log"
test "$consumer_status" = 1
grep -Fq "::error file=$consumer::cases[0]" "$demo_dir/consumer-log"
grep -Fq 'expected false, received true' "$demo_dir/consumer-log"
printf '\nRestored: only invited workspaces receive the enabled gate\n'
apply_stage consumer-restored
node flag-contract.mjs "$consumer"
