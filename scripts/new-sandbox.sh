#!/usr/bin/env bash
# Usage: bash scripts/new-sandbox.sh <Txx> [guarded|baseline] [dest_root]
# Makes a clean, isolated copy for one task. Run `claude` inside it.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
T="$1"; MODE="${2:-guarded}"; ROOT="${3:-$HOME/flop-work}"
[ -f "$REPO/stubs/$T.lean" ] || { echo "unknown task $T"; exit 1; }
W="$ROOT/$T-$MODE-$(date +%H%M%S)-$$"
mkdir -p "$W"
rsync -a --exclude runs --exclude eval --exclude policy --exclude .git --exclude .lake \
  --exclude .check --exclude .failproofai --exclude .claude "$REPO/" "$W/"
cp "$REPO/stubs/$T.lean" "$W/Bench/Proofs/$T.lean"
echo "$T" > "$W/.task"
if [ "$MODE" = guarded ]; then
  mkdir -p "$W/.failproofai/policies"
  cp "$REPO/policy/lean-guard.mjs" "$W/.failproofai/policies/lean-guard.policies.mjs"
fi
( cd "$W" && PATH="$HOME/.elan/bin:$PATH" lake build "Bench.Spec.$T" >/dev/null 2>&1 || true )
echo "$W"
