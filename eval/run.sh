#!/usr/bin/env bash
# Usage: bash eval/run.sh <baseline|guarded>
# Env: TASKS="T01 T08" RUNS=3 TIMEOUT=600 MAXTURNS=40
# A task scores only if all RUNS pass (same rule as the hackathon).
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:?usage: eval/run.sh baseline|guarded}"
TASKS="${TASKS:-T01 T02 T03 T04 T05 T06 T07 T08 T09}"
RUNS="${RUNS:-3}"; TIMEOUT="${TIMEOUT:-600}"; MAXTURNS="${MAXTURNS:-40}"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$REPO/runs/$MODE-$STAMP"; WORK="$HOME/flop-work/$MODE-$STAMP"
mkdir -p "$OUT" "$WORK"
RES="$OUT/results.csv"
echo "task,run,expected,verdict,detail,cost_usd,turns,seconds" > "$RES"

for T in $TASKS; do
  EXP=$(awk -v t="$T" '$1==t{print $2}' "$REPO/eval/answers.txt")
  for i in $(seq 1 "$RUNS"); do
    W=$(bash "$REPO/scripts/new-sandbox.sh" "$T" "$MODE" "$WORK")
    PROMPT="Solve the Lean task in this directory (task id in .task: $T). Read CLAUDE.md and Bench/Spec/$T.lean first, then edit Bench/Proofs/$T.lean. Finish only when 'bash scripts/lean-check.sh . $T' prints PASS."
    START=$(date +%s)
    ( cd "$W" && perl -e 'alarm shift; exec @ARGV' "$TIMEOUT" \
        claude -p "$PROMPT" --output-format json --max-turns "$MAXTURNS" \
        --permission-mode acceptEdits \
        --allowedTools "Read" "Edit" "Write" "MultiEdit" "Glob" "Grep" "Bash(lake:*)" "Bash(lean:*)" "Bash(bash scripts/lean-check.sh:*)" \
        > claude.json 2> claude.err )
    SECS=$(( $(date +%s) - START ))
    V=$(bash "$REPO/eval/verify.sh" "$REPO" "$W" "$T" "$EXP" | tail -1)
    META=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(`${j.total_cost_usd??""},${j.num_turns??""}`)}catch{console.log(",")}' "$W/claude.json")
    echo "$T,$i,$EXP,${V%%,*},${V#*,},$META,$SECS" >> "$RES"
    mkdir -p "$OUT/$T-r$i"; cp "$W/Bench/Proofs/$T.lean" "$W/claude.json" "$OUT/$T-r$i/" 2>/dev/null
    echo "[$MODE] $T run $i: $V (${SECS}s)"
  done
done
node "$REPO/eval/summary.mjs" "$RES"
