import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as pty from "node-pty";

export interface RunResult {
  cast: { t: number; data: string }[];
  exitCode: number | null;
  stderr: string;
  bytes: number;
  frames: number;
  durationMs: number;
  cpuMs: number;
  status: "ok" | "TIMEOUT" | "VIOLATION" | "ERROR";
  violation?: string;
  castFile?: string;
}

// AST-ish scan: block child_process / sockets / imports. No execution on violation.
export function scanViolations(code: string): string | null {
  const patterns: [RegExp, string][] = [
    [/require\s*\(\s*['"](child_process|net|dgram|cluster|worker_threads)['"]/, "child_process/socket require"],
    [/from\s+['"](child_process|net|dgram)['"]/, "child_process/socket import"],
    [/\bimport\s*\(?\s*['"]child_process['"]/, "child_process dynamic import"],
    [/child_process/, "child_process usage"],
    [/spawn\s*\(|spawnSync|exec\s*\(|execSync|execFile/, "process spawn"],
    [/net\.connect|net\.createConnection|dgram\.createSocket|fetch\s*\(|http\.request|https\.request|WebSocket/, "socket/network usage"],
    [/\brequire\s*\(\s*['"][^'"]+['"]\s*\)/, "external require (no libraries allowed)"],
    [/^\s*import\s+.+\s+from\s+['"]/m, "external import (no libraries allowed)"],
  ];
  for (const [re, label] of patterns) {
    if (re.test(code)) return label;
  }
  return null;
}

export async function runInPty(code: string, slot: string): Promise<RunResult> {
  const violation = scanViolations(code);
  if (violation) {
    return {
      cast: [], exitCode: null, stderr: "", bytes: 0, frames: 0,
      durationMs: 0, cpuMs: 0, status: "VIOLATION", violation,
    };
  }
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "glyph-"));
  const file = path.join(dir, "script.js");
  await fs.promises.writeFile(file, code);
  const cast: { t: number; data: string }[] = [];
  let bytes = 0;
  const t0 = Date.now();
  const cpu0 = process.cpuUsage();
  return new Promise((resolve) => {
    const proc = pty.spawn("node", ["--no-warnings", file], {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd: dir,
      env: { ...process.env, TERM: "xterm-256color", FORCE_COLOR: "1", NO_COLOR: undefined } as any,
    });
    let stderr = "";
    let done = false;
    const finish = (status: RunResult["status"], exitCode: number | null) => {
      if (done) return;
      done = true;
      const durationMs = Date.now() - t0;
      const cpu = process.cpuUsage(cpu0);
      const cpuMs = Math.round((cpu.user + cpu.system) / 1000);
      const castFile = writeCast(slot, cast, durationMs);
      try { proc.kill(); } catch {}
      resolve({
        cast, exitCode, stderr: stderr.slice(0, 4000), bytes,
        frames: cast.length, durationMs, cpuMs, status, castFile,
      });
    };
    proc.onData((data: string) => {
      cast.push({ t: (Date.now() - t0) / 1000, data });
      bytes += Buffer.byteLength(data);
    });
    // node-pty merges stderr into onData; capture exit separately
    proc.onExit(({ exitCode }: any) => finish("ok", exitCode ?? 0));
    // 6s hard kill
    setTimeout(() => finish("TIMEOUT", 124), 6000);
  });
}

function writeCast(slot: string, frames: { t: number; data: string }[], durationMs: number): string {
  const castsDir = path.resolve(process.cwd(), "casts");
  try { fs.mkdirSync(castsDir, { recursive: true }); } catch {}
  const name = `glyph-${slot}-${Date.now()}.cast`;
  const full = path.join(castsDir, name);
  const header = JSON.stringify({ version: 2, width: 100, height: 30, timestamp: Math.floor(Date.now() / 1000), duration: durationMs / 1000, env: { TERM: "xterm-256color" } });
  const lines = [header, ...frames.map((f) => JSON.stringify([f.t, "o", f.data]))];
  fs.writeFileSync(full, lines.join("\n"));
  return name;
}
