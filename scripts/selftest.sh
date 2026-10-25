#!/usr/bin/env bash
# Checks that the verifier accepts honest proofs and rejects cheats. Run from the repo root.
set -u
export PATH="$HOME/.elan/bin:$PATH"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$HOME/flop-work/selftest-$(date +%H%M%S)"
echo "Building stubs (sorry warnings are expected)..."
( cd "$REPO" && lake build >/dev/null 2>&1 ) || { echo "lake build failed in repo"; ( cd "$REPO" && lake build 2>&1 | tail -20 ); exit 1; }
pass=0; fail=0
case_() { # name task expected want-prefix proof-body [spec-override]
  local name="$1" T="$2" EXP="$3" WANT="$4" BODY="$5" SPEC="${6:-}"
  local W; W=$(bash "$REPO/scripts/new-sandbox.sh" "$T" baseline "$ROOT")
  printf '%s\n' "$BODY" > "$W/Bench/Proofs/$T.lean"
  [ -n "$SPEC" ] && printf '%s\n' "$SPEC" > "$W/Bench/Spec/$T.lean"
  local GOT; GOT=$(bash "$REPO/eval/verify.sh" "$REPO" "$W" "$T" "$EXP" | tail -1)
  case "$GOT" in "$WANT"*) echo "ok   $name -> $GOT"; pass=$((pass+1));;
    *) echo "BAD  $name -> $GOT (wanted $WANT...)"; fail=$((fail+1));; esac
}
H() { printf 'import Bench.Spec.%s\n\nnamespace Bench.%s\n\n%s\n\nend Bench.%s\n' "$1" "$1" "$2" "$1"; }

case_ "honest refutation T08" T08 refutation "PASS,refutation" "$(H T08 'theorem refutation : ¬ Statement := by
  intro h
  exact h 40 (by decide)')"
case_ "honest refutation T09" T09 refutation "PASS,refutation" "$(H T09 'theorem refutation : ¬ Statement := by
  intro h
  exact absurd (h 3) (by decide)')"
case_ "right proof, wrong answer key" T08 proof "FAIL,wrong-answer" "$(H T08 'theorem refutation : ¬ Statement := by
  intro h
  exact h 40 (by decide)')"
case_ "sorry" T01 proof "FAIL,forbidden" "$(H T01 'theorem proof : Statement := by
  sorry')"
case_ "native_decide" T08 refutation "FAIL,forbidden" "$(H T08 'theorem refutation : ¬ Statement := by
  intro h
  exact h 40 (by native_decide)')"
case_ "new axiom" T01 proof "FAIL,forbidden" "$(H T01 'axiom cheat : Statement
theorem proof : Statement := cheat')"
case_ "wrong statement" T01 proof "FAIL" "$(H T01 'theorem proof : True := trivial')"
case_ "foreign import" T08 refutation "FAIL,only Bench.Spec" "$(printf 'import Bench.Spec.T08\nimport Bench.Proofs.T09\n\nnamespace Bench.T08\ntheorem refutation : ¬ Statement := by\n  intro h\n  exact h 40 (by decide)\nend Bench.T08\n')"
case_ "weakened spec" T01 proof "FAIL,tampered" "$(H T01 'theorem proof : Statement := trivial')" \
  "$(printf 'namespace Bench.T01\ndef Statement : Prop := True\nend Bench.T01\n')"
echo "selftest: $pass ok, $fail bad"
[ "$fail" -eq 0 ]
