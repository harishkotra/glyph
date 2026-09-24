// npm run glyph -- "prompt" — runs the same comparison, prints both animations sequentially.
import { callModel, type SlotConfig } from "./glyph.js";
import { runInPty } from "./runner.js";

const prompt = process.argv.slice(2).join(" ") ||
  "Write a single Node.js script that animates the terminal for 5 seconds using ONLY raw ANSI escape codes. No libraries, no dependencies, no external processes. Output only code.";

const slotA: SlotConfig = {
  provider: "Particle.ai",
  baseUrl: process.env.GLYPH_A_BASE ?? "https://api.particle.ai/v1",
  apiKey: process.env.GLYPH_A_KEY,
  model: process.env.GLYPH_A_MODEL ?? "deepseek-v4-flash-0731",
  temperature: 0, maxTokens: 1600,
};
const slotB: SlotConfig = {
  provider: "Particle.ai",
  baseUrl: process.env.GLYPH_B_BASE ?? "https://api.particle.ai/v1",
  apiKey: process.env.GLYPH_B_KEY,
  model: process.env.GLYPH_B_MODEL ?? "deepseek-v4.1-flash",
  temperature: 0, maxTokens: 1600,
};

for (const [name, slot] of [["A", slotA], ["B", slotB]] as const) {
  console.log(`\n=== Slot ${name}: ${slot.model} ===`);
  const g = await callModel(slot, prompt);
  if (g.error || !g.code) { console.error("compose failed:", g.error); continue; }
  console.log(`sha=${g.sha256.slice(0, 12)} latency=${g.latencyMs}ms reasoning=${g.reasoningTokens ?? "n/a"}`);
  const r = await runInPty(g.code, name);
  console.log(`status=${r.status} exit=${r.exitCode} bytes=${r.bytes} frames=${r.frames} duration=${r.durationMs}ms cast=${r.castFile}`);
  // replay sequentially in the user's own terminal
  let last = 0;
  for (const f of r.cast) {
    await new Promise((r2) => setTimeout(r2, Math.max(0, (f.t - last) * 1000)));
    process.stdout.write(f.data);
    last = f.t;
  }
  if (r.stderr) process.stderr.write("\n[stderr] " + r.stderr + "\n");
  console.log(`\n--- end slot ${name} ---`);
}
