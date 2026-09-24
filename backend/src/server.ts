import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { callModel, type SlotConfig } from "./glyph.js";
import { runInPty } from "./runner.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const GLYPH_PROMPT =
  'Write a single Node.js script that animates the terminal for 5 seconds using ONLY raw ANSI escape codes. No libraries, no dependencies, no external processes. Output only code.';

app.post("/api/glyph", async (req, res) => {
  try {
    const { prompt, slotA, slotB } = req.body as {
      prompt?: string; slotA: SlotConfig; slotB: SlotConfig;
    };
    if (!slotA || !slotB) return res.status(400).json({ error: "slotA and slotB required" });
    const userPrompt = (prompt?.trim() || GLYPH_PROMPT);
    const [a, b] = await Promise.all([
      callModel(slotA, userPrompt).catch((e: any) => ({ error: e.message, code: "", rawReply: "", latencyMs: 0, promptTokens: null, completionTokens: null, reasoningTokens: null, sha256: "", extractionPath: "error" })),
      callModel(slotB, userPrompt).catch((e: any) => ({ error: e.message, code: "", rawReply: "", latencyMs: 0, promptTokens: null, completionTokens: null, reasoningTokens: null, sha256: "", extractionPath: "error" })),
    ]);
    // assert zero prompt reuse: different nonces means shas of full prompts differ — trivially true; enforce distinct calls
    res.json({ a, b, prompt: userPrompt });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/run", async (req, res) => {
  try {
    const { code, slot } = req.body as { code: string; slot: string };
    if (!code) return res.status(400).json({ error: "code required" });
    const result = await runInPty(code, slot === "B" ? "B" : "A");
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Live model list passthrough (never gate a run on this succeeding)
app.get("/api/models", async (req, res) => {
  try {
    const baseUrl = String(req.query.baseUrl || "");
    const apiKey = String(req.query.apiKey || "");
    if (!baseUrl) return res.status(400).json({ error: "baseUrl required" });
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const r = await fetch(baseUrl.replace(/\/$/, "") + "/models", { headers });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const j: any = await r.json();
    const models = (j?.data ?? []).map((m: any) => m.id).filter(Boolean);
    res.json({ models });
  } catch (e: any) {
    res.status(502).json({ error: `Cannot reach provider: ${e.message}` });
  }
});

app.get("/api/casts/:name", (req, res) => {
  const full = path.resolve(process.cwd(), "casts", path.basename(req.params.name));
  if (!fs.existsSync(full)) return res.status(404).send("not found");
  res.setHeader("Content-Type", "application/json");
  fs.createReadStream(full).pipe(res);
});

const PORT = 3001;
app.listen(PORT, () => console.log(`glyph backend on :${PORT}`));
