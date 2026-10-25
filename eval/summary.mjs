// Usage: node eval/summary.mjs runs/<mode>-<stamp>/results.csv [more.csv ...]
import { readFileSync } from "node:fs";
for (const file of process.argv.slice(2)) {
  const rows = readFileSync(file, "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
  const by = {};
  let cost = 0, costN = 0;
  for (const [task, , exp, verdict, detail, c] of rows) {
    (by[task] ??= { exp, runs: [] }).runs.push(verdict === "PASS" ? "✓" : `✗(${detail})`);
    if (c) { cost += Number(c); costN++; }
  }
  const tasks = Object.keys(by);
  const solved = tasks.filter((t) => by[t].runs.every((r) => r === "✓"));
  console.log(`\n${file}`);
  for (const t of tasks) console.log(`  ${t} [${by[t].exp}] ${by[t].runs.join(" ")}`);
  console.log(`  score: ${solved.length}/${tasks.length} tasks pass every run`);
  if (costN) console.log(`  avg cost/run: $${(cost / costN).toFixed(4)}`);
}
