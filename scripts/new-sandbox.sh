#!/usr/bin/env bash
# Usage: bash scripts/new-sandbox.sh <Txx> [guarded|baseline] [dest_root]
# Makes a clean, isolated copy for one task. Run `claude` inside it.
#
# Allowlist, not denylist: only the files below are copied. Anything else in the
# repo (logs, reports, results, tests, README) can reveal answers, so it must never
# reach the agent. scripts/selftest.sh fails if a sandbox contains anything extra.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
T="$1"; MODE="${2:-guarded}"; ROOT="${3:-$HOME/flop-work}"
[ -f "$REPO/stubs/$T.lean" ] || { echo "unknown task $T"; exit 1; }
W="$ROOT/$T-$MODE-$(date +%H%M%S)-$$"
mkdir -p "$W/Bench/Spec" "$W/Bench/Proofs" "$W/scripts"
cp "$REPO"/Bench/Spec/*.lean "$W/Bench/Spec/"
cp "$REPO"/stubs/*.lean "$W/Bench/Proofs/"          # stubs, never the repo's Bench/Proofs
cp "$REPO/scripts/lean-check.sh" "$W/scripts/"
cp "$REPO/lakefile.toml" "$REPO/lean-toolchain" "$REPO/CLAUDE.md" "$W/"
[ -f "$REPO/lake-manifest.json" ] && cp "$REPO/lake-manifest.json" "$W/"
echo "$T" > "$W/.task"
if [ "$MODE" = guarded ]; then
  mkdir -p "$W/.failproofai/policies"
  cp "$REPO/policy/lean-guard.mjs" "$W/.failproofai/policies/lean-guard.policies.mjs"
fi
( cd "$W" && PATH="$HOME/.elan/bin:$PATH" lake build "Bench.Spec.$T" >/dev/null 2>&1 || true )
echo "$W"
