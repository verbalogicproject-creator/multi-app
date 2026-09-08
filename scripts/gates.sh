#!/usr/bin/env bash
# gates.sh — the single verification entrypoint for multi-app.
#
#   scripts/gates.sh                      fast tier (no build, no browser)
#   scripts/gates.sh --tier full          fast + build + the four CDP gates
#   scripts/gates.sh --tier full --start-server
#                                         also spawn/tear down the :8050 backend
#   scripts/gates.sh --list               show the gates each tier runs
#
# Exits non-zero if any gate fails, so CI and `claude -p` can both consume it.
#
# `smoke:providers` is deliberately NOT a gate: it makes live model calls and
# spends real quota. Run it by hand against specific model ids.
#
# Deliberately NOT `set -e` — a failing gate must be recorded and reported, not
# abort the run. Every gate's exit code is captured explicitly.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

TIER=fast
START_SERVER=0
LIST=0
PORT="${PORT:-8050}"

while [ $# -gt 0 ]; do
    case "$1" in
        --tier)         TIER="${2:-fast}"; shift ;;
        --start-server) START_SERVER=1 ;;
        --list)         LIST=1 ;;
        -h|--help)      awk 'NR>1 && /^#/ {sub(/^# ?/,""); print; next} NR>1 {exit}' "$0"; exit 0 ;;
        *)              printf 'gates.sh: unknown option %s\n' "$1" >&2; exit 2 ;;
    esac
    shift
done

# Fast tier: pure logic + gates that spawn their own short-lived server.
FAST_GATES="typecheck test check:css check:auth smoke:memory"
# Full tier adds the CDP gates. Each npm script is `npm run build && node scripts/X.mjs`;
# we build ONCE and invoke the second half directly, so a full run does one build, not five.
# CDP_GATES maps gate name -> the script it runs. verify_cdp_mapping() below proves the
# mapping still matches package.json, so this shortcut cannot silently drift.
CDP_GATES="audit:ui:audit-ui check:editor:check-editor check:preview:check-preview check:pipeline:check-pipeline"

if [ "$LIST" = 1 ]; then
    printf 'fast tier:\n'; for g in $FAST_GATES; do printf '  npm run %s\n' "$g"; done
    printf 'full tier adds (after one npm run build):\n'
    for pair in $CDP_GATES; do printf '  node scripts/%s.mjs\n' "${pair##*:}"; done
    printf 'never run automatically:\n  npm run smoke:providers  (spends real quota)\n'
    exit 0
fi

case "$TIER" in fast|full) ;; *) printf 'gates.sh: --tier must be fast|full\n' >&2; exit 2 ;; esac

PASS=0; FAIL=0; FAILED_GATES=""
ok() { # ok <name> <exit-code>
    if [ "$2" -eq 0 ]; then printf 'ok    %s\n' "$1"; PASS=$((PASS+1))
    else printf 'FAIL  %s  (exit %s)\n' "$1" "$2"; FAIL=$((FAIL+1)); FAILED_GATES="$FAILED_GATES $1"; fi
}

# Proves the build-once shortcut is still equivalent to the documented npm scripts.
verify_cdp_mapping() {
    node -e '
      const pkg = require("./package.json").scripts;
      const pairs = process.argv[1].split(" ");
      let bad = [];
      for (const p of pairs) {
        const gate = p.slice(0, p.lastIndexOf(":"));
        const file = p.slice(p.lastIndexOf(":") + 1);
        const expected = `npm run build && node scripts/${file}.mjs`;
        if (pkg[gate] !== expected) bad.push(`${gate}: package.json has "${pkg[gate]}", gates.sh assumes "${expected}"`);
      }
      if (bad.length) { console.error("gates.sh CDP mapping is stale:\n  " + bad.join("\n  ")); process.exit(1); }
    ' "$CDP_GATES"
}

SERVER_PID=""
stop_server() {
    [ -n "$SERVER_PID" ] || return 0
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
    printf '      (stopped backend pid %s)\n' "$SERVER_PID"
    SERVER_PID=""
}
trap stop_server EXIT INT TERM

printf '=== multi-app gates (tier: %s) ===\n\n' "$TIER"

for g in $FAST_GATES; do
    npm run --silent "$g" >/dev/null 2>&1; ok "npm run $g" $?
done

if [ "$TIER" = full ]; then
    printf '\n--- full tier ---\n'
    verify_cdp_mapping || { printf 'FAIL  cdp-mapping-guard\n'; FAIL=$((FAIL+1)); FAILED_GATES="$FAILED_GATES cdp-mapping-guard"; }

    node -e 'import("./scripts/ui-harness.mjs").then(m=>m.findChrome())' >/dev/null 2>&1
    ok "chrome present" $?

    if [ "$START_SERVER" = 1 ]; then
        node server.js >/dev/null 2>&1 &
        SERVER_PID=$!
        for _ in $(seq 1 40); do
            curl -sf "http://localhost:${PORT}/healthz" >/dev/null 2>&1 && break
            sleep 0.5
        done
    fi
    curl -sf "http://localhost:${PORT}/healthz" >/dev/null 2>&1
    ok "backend on :${PORT}" $?

    npm run --silent build >/dev/null 2>&1; ok "npm run build" $?

    for pair in $CDP_GATES; do
        gate="${pair%:*}"; file="${pair##*:}"
        node "scripts/${file}.mjs" >/dev/null 2>&1; ok "$gate" $?
    done
fi

printf '\n=== %s passed, %s failed ===\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then printf 'failed:%s\n' "$FAILED_GATES"; exit 1; fi
exit 0
