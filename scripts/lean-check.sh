#!/usr/bin/env bash
# Usage: bash scripts/lean-check.sh <project_dir> <Txx>
# Prints "PASS: proof|refutation" (exit 0) or "FAIL: reason" (exit 1).
set -u
export PATH="$HOME/.elan/bin:$PATH"
DIR="$1"; T="$2"
cd "$DIR" || { echo "FAIL: cannot cd to $DIR"; exit 1; }
F="Bench/Proofs/$T.lean"
[ -f "$F" ] || { echo "FAIL: missing $F"; exit 1; }

# Record the verdict for this exact file content, so the stop policy can answer in milliseconds.
HASH=$( (shasum -a 256 "$F" 2>/dev/null || sha256sum "$F") | cut -d' ' -f1)
trap 'rc=$?; mkdir -p .check; if [ $rc -eq 0 ]; then echo "PASS $HASH"; else echo "FAIL $HASH"; fi > ".check/$T.status"' EXIT

STRIPPED=$(perl -0pe 's{/-.*?-/}{}gs; s{--[^\n]*}{}g' "$F")

BAD=$(printf '%s\n' "$STRIPPED" | perl -ne 'print "$1\n" while /\b(sorry|admit|native_decide|implemented_by|extern|unsafe|axiom|opaque|ofReduceBool|skipKernelTC)\b/g' | sort -u | tr '\n' ' ')
[ -n "$BAD" ] && { echo "FAIL: forbidden tokens in $F: $BAD"; exit 1; }

BADIMP=$(printf '%s\n' "$STRIPPED" | perl -ne 'print "$1 " if /^\s*import\s+(?!Bench\.Spec\.)(\S+)/')
[ -n "$BADIMP" ] && { echo "FAIL: only Bench.Spec.* imports allowed, found: $BADIMP"; exit 1; }

HAS_P=$(printf '%s\n' "$STRIPPED" | perl -ne 'print 1 if /^\s*theorem\s+proof\b/')
HAS_R=$(printf '%s\n' "$STRIPPED" | perl -ne 'print 1 if /^\s*theorem\s+refutation\b/')
if [ -n "$HAS_P" ] && [ -n "$HAS_R" ]; then echo "FAIL: define only one of proof / refutation"; exit 1
elif [ -n "$HAS_P" ]; then KIND=proof; TYPE="Bench.$T.Statement"
elif [ -n "$HAS_R" ]; then KIND=refutation; TYPE="¬ Bench.$T.Statement"
else echo "FAIL: no theorem named proof or refutation"; exit 1; fi

OUT=$(lake build "Bench.Proofs.$T" 2>&1) || {
  echo "$OUT" | grep -E -A6 'error' | head -60
  echo "FAIL: build error in $F"; exit 1; }

mkdir -p .check
CHK=".check/$T.lean"
cat > "$CHK" <<LEAN
import Bench.Proofs.$T
example : $TYPE := Bench.$T.$KIND
#print axioms Bench.$T.$KIND
LEAN
OUT=$(lake env lean "$CHK" 2>&1); RC=$?
if [ $RC -ne 0 ] || echo "$OUT" | grep -q 'error'; then
  echo "$OUT" | head -30
  echo "FAIL: $KIND does not have type $TYPE"; exit 1; fi

AX=$(echo "$OUT" | perl -ne 'print "$1" if /depends on axioms: \[(.*)\]/' | tr ',' ' ')
for a in $AX; do
  case "$a" in propext|Classical.choice|Quot.sound) ;;
    *) echo "FAIL: non-standard axiom used: $a"; exit 1 ;;
  esac
done
echo "PASS: $KIND"
