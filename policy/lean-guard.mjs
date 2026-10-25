// Failproof policies for a Lean proving agent.
// Active only when copied into <sandbox>/.failproofai/policies/ (scripts/new-sandbox.sh does this).
import { customPolicies, allow, deny, instruct } from "failproofai";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const LOCKED = [
  /(^|\/)Bench\/Spec\//,
  /(^|\/)lakefile\.(toml|lean)$/,
  /(^|\/)lean-toolchain$/,
  /(^|\/)scripts\//,
  /(^|\/)stubs\//,
  /(^|\/)\.failproofai\//,
  /(^|\/)CLAUDE\.md$/,
  /(^|\/)\.task$/,
];
const LOCKED_IN_SHELL = /(Bench\/Spec|lakefile|lean-toolchain|scripts\/|stubs\/|\.failproofai|CLAUDE\.md|\.task\b)/;
const SHELL_WRITE = /(>|\btee\b|\bsed\s+-i|\bperl\s+-\w*i|\bmv\b|\bcp\b|\brm\b|\btruncate\b|\bchmod\b|\bln\b|git\s+(checkout|restore|reset|apply)|\bpython3?\b|\bnode\s+-e)/;
const SHELL_WRITES_LEAN = /((>|\btee\s+)\s*\S*\.lean\b|\b(sed|perl)\s+-\w*i\b.*\.lean\b|\b(cp|mv)\b.*\.lean\b)/;
const CHEATS = /\b(sorry|admit|native_decide|implemented_by|extern|unsafe|axiom|opaque|ofReduceBool|skipKernelTC)\b/;
const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const MAX_STOP_BLOCKS = 4;

const cwdOf = (ctx) => ctx.session?.cwd ?? ctx.cwd ?? process.cwd();
const strip = (s) => s.replace(/\/-[\s\S]*?-\//g, "").replace(/--[^\n]*/g, "");
const newText = (ctx) => {
  const i = ctx.toolInput ?? {};
  if (ctx.toolName === "Write") return String(i.content ?? "");
  if (ctx.toolName === "Edit") return String(i.new_string ?? "");
  if (ctx.toolName === "MultiEdit") return (i.edits ?? []).map((e) => e.new_string ?? "").join("\n");
  return String(i.new_source ?? "");
};
const pathOf = (ctx) => String(ctx.toolInput?.file_path ?? ctx.toolInput?.notebook_path ?? "");

// 1. The goalposts can't move: spec, build config, checker, and policies are read-only.
customPolicies.add({
  name: "lean-lock-spec",
  description: "Block edits to the theorem statements, build config, checker and policies",
  match: { events: ["PreToolUse"] },
  fn: async (ctx) => {
    if (EDIT_TOOLS.has(ctx.toolName)) {
      const p = pathOf(ctx);
      if (LOCKED.some((re) => re.test(p)))
        return deny(`${p} is read-only. The statement is fixed: prove it or refute it in Bench/Proofs/<T>.lean. Never weaken the spec.`);
      return allow();
    }
    if (ctx.toolName === "Bash") {
      const cmd = String(ctx.toolInput?.command ?? "");
      if (LOCKED_IN_SHELL.test(cmd) && SHELL_WRITE.test(cmd))
        return deny("This shell command could modify locked files (spec, build config, checker, policies). Read them with the Read tool; edit only Bench/Proofs/<T>.lean.");
      if (SHELL_WRITES_LEAN.test(cmd))
        return deny("Edit Lean files with the Edit/Write tools, not shell redirection.");
    }
    return allow();
  },
});

// 2. No escape hatches in the proof file.
customPolicies.add({
  name: "lean-no-cheats",
  description: "Block sorry/admit/axiom/native_decide and similar in proof files",
  match: { events: ["PreToolUse"] },
  fn: async (ctx) => {
    if (!EDIT_TOOLS.has(ctx.toolName)) return allow();
    if (!/(^|\/)Bench\/Proofs\/.*\.lean$/.test(pathOf(ctx))) return allow();
    const m = strip(newText(ctx)).match(CHEATS);
    if (m)
      return deny(
        `'${m[1]}' is not allowed in proof files. It does not count as a proof. ` +
        `To inspect goals, use a scratch file outside Bench/Proofs. If you believe the claim is false, ` +
        `replace 'theorem proof : Statement' with 'theorem refutation : ¬ Statement' and prove that.`
      );
    return allow();
  },
});

// 3. Can't declare victory without a kernel-checked, axiom-clean result.
// Failproof gives policy functions ~10s and treats a timeout as allow(), so this must be fast:
// scripts/lean-check.sh caches "PASS <sha256>" per file; a fresh check runs only with an 8s budget.
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const cachedPass = (cwd, t) => {
  try {
    const st = readFileSync(join(cwd, ".check", `${t}.status`), "utf8").trim();
    return st === `PASS ${sha256(join(cwd, "Bench", "Proofs", `${t}.lean`))}`;
  } catch { return false; }
};

customPolicies.add({
  name: "lean-verify-before-stop",
  description: "Deny stopping until scripts/lean-check.sh passes for the task",
  match: { events: ["Stop"] },
  fn: async (ctx) => {
    const cwd = cwdOf(ctx);
    const taskFile = join(cwd, ".task");
    if (!existsSync(taskFile)) return allow();
    const tasks = readFileSync(taskFile, "utf8").trim().split(/\s+/).filter(Boolean);
    const ctrDir = join(cwd, ".check");
    const ctr = join(ctrDir, "stop-blocks");
    let n = 0;
    try { n = parseInt(readFileSync(ctr, "utf8"), 10) || 0; } catch {}

    const failures = [];
    for (const t of tasks) {
      if (cachedPass(cwd, t)) continue;
      let out = "";
      try {
        execFileSync("bash", [join(cwd, "scripts", "lean-check.sh"), cwd, t], {
          encoding: "utf8", timeout: 8000,
          env: { ...process.env, PATH: `${homedir()}/.elan/bin:${process.env.PATH ?? ""}` },
        });
      } catch (e) {
        out = e.killed || e.signal ? "(check did not finish in time)" : String(e.stdout ?? "") + String(e.stderr ?? "");
      }
      if (!cachedPass(cwd, t)) failures.push(`${t}: ${out.slice(-1200) || "not verified"}`);
    }
    if (failures.length === 0 || n >= MAX_STOP_BLOCKS) return allow();
    mkdirSync(ctrDir, { recursive: true });
    writeFileSync(ctr, String(n + 1));
    return deny(
      `Not done. scripts/lean-check.sh fails (block ${n + 1}/${MAX_STOP_BLOCKS}):\n${failures.join("\n")}\n` +
      `Run 'bash scripts/lean-check.sh . <T>' yourself and fix the proof until it prints PASS. ` +
      `If the claim is false, switch to 'theorem refutation : ¬ Statement'.`
    );
  },
});

// 4. Correct, don't just block: turn common Lean failure output into a targeted hint.
const HINTS = [
  [/omega could not prove the goal/, /\^|\*\s*\w/, "omega is linear arithmetic only: it treats x ^ k and x * y as opaque atoms. Rewrite powers with Nat.pow_succ / Nat.pow_zero, or do induction or case analysis first so the remaining goal is linear."],
  [/maximum recursion depth|deterministic\) timeout|maxHeartbeats/, null, "Evaluation blew up. Use decide only on small closed goals; for symbolic goals use induction, simp lemmas or omega instead of unfolding."],
  [/unknown (identifier|constant) '([^']+)'/, null, "That name is not in core Lean (there is no Mathlib here). Find what exists with #check or exact?, or prove the lemma yourself."],
  [/FAIL: non-standard axiom used/, null, "The result depends on a non-standard axiom. Remove native_decide or anything that compiles to Lean.ofReduceBool; use decide or a real proof."],
];
const outputOf = (ctx) => {
  const r = ctx.toolResponse ?? ctx.toolOutput ?? ctx.payload?.tool_response ?? ctx.toolResult ?? "";
  return typeof r === "string" ? r : JSON.stringify(r);
};

customPolicies.add({
  name: "lean-failure-hints",
  description: "After a failed Lean build or check, add a targeted hint to the agent's next prompt",
  match: { events: ["PostToolUse"] },
  fn: async (ctx) => {
    if (ctx.toolName !== "Bash") return allow();
    if (!/\b(lake|lean)\b|lean-check\.sh/.test(String(ctx.toolInput?.command ?? ""))) return allow();
    const out = outputOf(ctx);
    const hits = HINTS.filter(([re, also]) => re.test(out) && (!also || also.test(out))).map(([, , h]) => h);
    return hits.length ? instruct(`Lean hint: ${hits.join(" ")}`) : allow();
  },
});
