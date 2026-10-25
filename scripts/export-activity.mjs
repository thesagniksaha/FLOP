// Export failproof's policy activity for this project into the repo.
// Usage: node scripts/export-activity.mjs [--all] [--since 2026-10-25T18:00]
// Writes results/activity-<stamp>.jsonl (raw rows) and results/ACTIVITY-<stamp>.md (summary).
// By default keeps only events whose cwd is this repo or ~/flop-work (our sandboxes).
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = process.env.FAILPROOFAI_HOME ?? join(homedir(), ".failproofai");
const DIR = join(HOME, "hook-activity");
const args = process.argv.slice(2);
const all = args.includes("--all");
const sinceArg = args[args.indexOf("--since") + 1];
const since = args.includes("--since") ? Date.parse(sinceArg) : 0;
const roots = [REPO, join(homedir(), "flop-work"), join(homedir(), "fplean-work")]; // fplean-work: sandboxes made before the rename

if (!existsSync(DIR)) { console.error(`No activity folder at ${DIR}`); process.exit(1); }
const rows = [];
for (const f of readdirSync(DIR).filter((n) => n.endsWith(".jsonl"))) {
  for (const line of readFileSync(join(DIR, f), "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch {}
  }
}
const seen = new Set();
const kept = rows
  .filter((r) => r.timestamp >= since)
  .filter((r) => all || roots.some((p) => String(r.cwd ?? "").startsWith(p)))
  .filter((r) => { const k = `${r.timestamp}|${r.sessionId}|${r.eventType}|${r.toolName}|${r.decision}`; if (seen.has(k)) return false; seen.add(k); return true; })
  .sort((a, b) => a.timestamp - b.timestamp);

const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const out = join(REPO, "results"); mkdirSync(out, { recursive: true });
writeFileSync(join(out, `activity-${stamp}.jsonl`), kept.map((r) => JSON.stringify(r)).join("\n") + "\n");

const count = (key) => kept.reduce((m, r) => { const k = key(r) ?? "(none)"; m[k] = (m[k] ?? 0) + 1; return m; }, {});
const table = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`).join("\n");
const t = (ms) => new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
const short = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").replace(/\|/g, "/"); return s.length > n ? s.slice(0, n) + "…" : s; };
const where = (cwd) => String(cwd ?? "").replace(homedir(), "~");
const fired = kept.filter((r) => r.decision !== "allow");
const sessions = count((r) => r.sessionId?.slice(0, 8));

const md = `# failproof activity export

Exported ${t(Date.now())} from \`${DIR.replace(homedir(), "~")}\`.
Scope: ${all ? "all events" : "events in this repo and its sandboxes"}${since ? `, since ${sinceArg}` : ""}.
${kept.length} events, ${fired.length} deny/instruct, ${Object.keys(sessions).length} sessions.

## Decisions
| Decision | Count |
|---|---|
${table(count((r) => r.decision))}

## Policies that denied or instructed
| Policy | Count |
|---|---|
${table(fired.reduce((m, r) => { const k = r.policyName ?? "(none)"; m[k] = (m[k] ?? 0) + 1; return m; }, {}))}

## Events
| Event | Count |
|---|---|
${table(count((r) => r.eventType))}

## Every deny and instruct
| Time (IST) | Decision | Event | Tool | Policy | Reason | Session | Sandbox |
|---|---|---|---|---|---|---|---|
${fired.map((r) => `| ${t(r.timestamp)} | ${r.decision} | ${r.eventType} | ${r.toolName ?? "-"} | ${short(r.policyName, 50)} | ${short(r.reason, 140)} | ${r.sessionId?.slice(0, 8) ?? "-"} | ${short(where(r.cwd).split("/").slice(-1)[0], 40)} |`).join("\n") || "| (none) |||||||"}

Raw rows: \`results/activity-${stamp}.jsonl\`
`;
writeFileSync(join(out, `ACTIVITY-${stamp}.md`), md);
console.log(`${kept.length} events (${fired.length} deny/instruct) -> results/ACTIVITY-${stamp}.md and results/activity-${stamp}.jsonl`);
