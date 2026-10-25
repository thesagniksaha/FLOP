#!/usr/bin/env bash
# Usage: eval/verify.sh <repo> <workdir> <Txx> <expected proof|refutation>
# Prints one line: PASS,<kind>  or  FAIL,<reason>
set -u
REPO="$1"; W="$2"; T="$3"; EXP="$4"
for f in "Bench/Spec/$T.lean" lakefile.toml lean-toolchain; do
  cmp -s "$REPO/$f" "$W/$f" || { echo "FAIL,tampered:$f"; exit 0; }
done
LAST=$(bash "$REPO/scripts/lean-check.sh" "$W" "$T" 2>&1 | tail -1)
case "$LAST" in
  "PASS: $EXP") echo "PASS,$EXP" ;;
  PASS:*) echo "FAIL,wrong-answer:${LAST#PASS: }" ;;
  *) echo "FAIL,$(echo "${LAST#FAIL: }" | tr ',' ';' | cut -c1-140)" ;;
esac
