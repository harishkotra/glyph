import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Terminal } from "@xterm/xterm";

type Frame = { t: number; data: string };
type RunRes = {
  cast: Frame[]; exitCode: number | null; stderr: string; bytes: number;
  frames: number; durationMs: number; cpuMs: number; status: string;
  violation?: string; castFile?: string;
};
type GlyphOne = {
  code: string; rawReply: string; latencyMs: number; promptTokens: number | null;
  completionTokens: number | null; reasoningTokens: number | null; sha256: string;
  extractionPath: string; error?: string;
};

const PRESETS = [
  "Write a single Node.js script that animates the terminal for 5 seconds using ONLY raw ANSI escape codes. No libraries, no dependencies, no external processes. Output only code. Subject: a spinning ASCII cube",
  "Write a single Node.js script that animates the terminal for 5 seconds using ONLY raw ANSI escape codes. No libraries, no dependencies, no external processes. Output only code. Subject: a burning fire made of characters",
  "Write a single Node.js script that animates the terminal for 5 seconds using ONLY raw ANSI escape codes. No libraries, no dependencies, no external processes. Output only code. Subject: a scrolling starfield",
  "Write a single Node.js script that animates the terminal for 5 seconds using ONLY raw ANSI escape codes. No libraries, no dependencies, no external processes. Output only code. Subject: a pulsing audio-style bar visualiser",
];
const PRESET_LABELS = ["spinning ASCII cube", "burning fire", "scrolling starfield", "bar visualiser"];

const PROVIDERS: Record<string, { base: string; key: boolean }> = {
  "Particle.ai": { base: "https://api.particle.ai/v1", key: true },
  Ollama: { base: "http://127.0.0.1:11434/v1", key: false },
  "LM Studio": { base: "http://127.0.0.1:1234/v1", key: false },
  OpenRouter: { base: "https://openrouter.ai/api/v1", key: true },
  Custom: { base: "", key: true },
};

interface SlotCfg { provider: string; baseUrl: string; apiKey: string; model: string; }
const DEFAULTS: SlotCfg[] = [
  { provider: "Particle.ai", baseUrl: "https://api.particle.ai/v1", apiKey: "", model: "deepseek-v4-flash-0731" },
  { provider: "Particle.ai", baseUrl: "https://api.particle.ai/v1", apiKey: "", model: "deepseek-v4.1-flash" },
];

function loadCfg(): { slots: SlotCfg[]; temperature: number; maxTokens: number; disableReasoning: boolean; prompt: string } {
  try {
    const raw = localStorage.getItem("glyph-cfg");
    if (raw) return JSON.parse(raw);
  } catch {}
  return { slots: DEFAULTS, temperature: 0, maxTokens: 1600, disableReasoning: false, prompt: PRESETS[0] };
}

function SlotEditor({ label, corner, cfg, onChange }: { label: string; corner: string; cfg: SlotCfg; onChange: (c: SlotCfg) => void }) {
  const [models, setModels] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const refresh = async (baseUrl: string, apiKey: string) => {
    setErr("");
    if (!baseUrl) return;
    try {
      const r = await fetch(`/api/models?baseUrl=${encodeURIComponent(baseUrl)}&apiKey=${encodeURIComponent(apiKey)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      setModels(j.models ?? []);
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <div className={`slot ${corner}`}>
      <div className="slot-head"><span className="chip" /><h3>CORNER {label}</h3></div>
      <label>Provider <select value={cfg.provider} onChange={(e) => {
        const p = e.target.value;
        const base = PROVIDERS[p]?.base ?? "";
        const next = { ...cfg, provider: p, ...(base ? { baseUrl: base } : {}) };
        onChange(next); refresh(next.baseUrl, next.apiKey);
      }}>
        {Object.keys(PROVIDERS).map((p) => <option key={p}>{p}</option>)}
      </select></label>
      <label>Base URL <input value={cfg.baseUrl} onChange={(e) => onChange({ ...cfg, baseUrl: e.target.value })} /></label>
      <label>API Key <input type="password" value={cfg.apiKey} placeholder={PROVIDERS[cfg.provider]?.key ? "key required" : "no key needed"} onChange={(e) => onChange({ ...cfg, apiKey: e.target.value })} /></label>
      <label>Model <input list={`models-${label}`} value={cfg.model} placeholder="type model name by hand" onChange={(e) => onChange({ ...cfg, model: e.target.value })} /></label>
      <datalist id={`models-${label}`}>{models.map((m) => <option key={m} value={m} />)}</datalist>
      <button className="mini" onClick={() => refresh(cfg.baseUrl, cfg.apiKey)}>↻ Refresh models</button>
      {err && <div className="err">{err}</div>}
    </div>
  );
}

function TermPane({ title, color, run, glyph, stderrCrash }: { title: string; color: string; run: RunRes | null; glyph: GlyphOne | null; stderrCrash: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [prog, setProg] = useState(0); // frame index
  const [playing, setPlaying] = useState(false);
  const timer = useRef<any>(null);

  useEffect(() => {
    const t = new Terminal({
      cols: 100, rows: 30, scrollback: 0,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      theme: { background: "#050604", foreground: "#e8e8f0", cursor: color },
    });
    t.open(ref.current!);
    termRef.current = t;
    // Fit 100x30 into the pane without ever cropping: derive font size
    // from measured width (advance ≈ 0.602em) and height.
    const fit = () => {
      const el = ref.current;
      if (!el || !termRef.current) return;
      const w = el.clientWidth - 16; // xterm 8px padding each side
      const size = Math.max(5, Math.min(12, Math.floor(w / 60.2)));
      termRef.current.options.fontSize = size;
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (ref.current) ro.observe(ref.current);
    return () => { ro.disconnect(); t.dispose(); termRef.current = null; };
  }, []);

  const renderUpTo = (idx: number) => {
    const t = termRef.current; if (!t || !run) return;
    t.clear();
    for (let i = 0; i <= idx && i < run.cast.length; i++) t.write(run.cast[i].data);
    if (stderrCrash && idx >= (run?.cast.length ?? 0) - 1) t.write("\r\n\x1b[31m" + stderrCrash.slice(0, 2000) + "\x1b[0m");
    setProg(idx);
  };

  useEffect(() => {
    setProg(0);
    setPlaying(false);
    termRef.current?.clear();
    if (run && run.cast.length) renderUpTo(run.cast.length - 1);
    // eslint-disable-next-line
  }, [run?.castFile]);

  const play = () => {
    if (!run?.cast.length) return;
    setPlaying(true);
    termRef.current?.clear();
    let i = 0; let last = 0;
    const step = () => {
      if (!termRef.current || !run) return;
      if (i >= run.cast.length) { setPlaying(false); return; }
      const f = run.cast[i];
      termRef.current.write(f.data);
      setProg(i);
      const delay = Math.max(0, Math.min(500, ((f.t - last) * 1000)));
      last = f.t; i++;
      timer.current = setTimeout(step, delay);
    };
    step();
  };
  const pause = () => { clearTimeout(timer.current); setPlaying(false); };
  const restart = () => { pause(); termRef.current?.clear(); setProg(0); };

  const violation = run?.status === "VIOLATION";
  const max = Math.max(0, (run?.cast.length ?? 1) - 1);
  const stats: [string, string][] = [
    ["exit", run?.exitCode == null ? "—" : String(run.exitCode)],
    ["bytes", run?.bytes == null ? "—" : String(run.bytes)],
    ["frames", run?.frames == null ? "—" : String(run.frames)],
    ["dur ms", run?.durationMs == null ? "—" : String(run.durationMs)],
    ["reason", glyph?.reasoningTokens == null ? "n/a" : String(glyph.reasoningTokens)],
    ["status", run?.status ?? "—"],
  ];
  return (
    <div className={`pane side-${title.startsWith("A") ? "a" : "b"}`}>
      <div className="pane-top">
        <span className="fighter">{title}</span>
        <span className="sha">{glyph?.sha256?.slice(0, 10) ?? ""}</span>
      </div>
      <dl className="stats">
        {stats.map(([k, v]) => <div className="stat" key={k}><dt>{k}</dt><dd title={v}>{v}</dd></div>)}
      </dl>
      {violation && <div className="badge-row"><span className="badge">VIOLATION · {run?.violation}</span></div>}
      <div className="screen" ref={ref} />
      <div className="controls">
        {!playing ? <button onClick={play}>Play</button> : <button onClick={pause}>Pause</button>}
        <button onClick={restart}>Restart</button>
        <button onClick={() => renderUpTo(Math.max(0, prog - 1))}>◀ frame</button>
        <button onClick={() => renderUpTo(Math.min(max, prog + 1))}>frame ▶</button>
        <input type="range" min={0} max={max} value={prog} onChange={(e) => { pause(); renderUpTo(Number(e.target.value)); }} />
        {run?.castFile && <a className="dl" href={`/api/casts/${run.castFile}`} download><button>Download .cast</button></a>}
      </div>
    </div>
  );
}

function App() {
  const saved = useRef(loadCfg()).current;
  const [slots, setSlots] = useState<SlotCfg[]>(saved.slots);
  const [temperature, setTemperature] = useState(saved.temperature);
  const [maxTokens, setMaxTokens] = useState(saved.maxTokens);
  const [disableReasoning, setDisableReasoning] = useState(saved.disableReasoning);
  const [prompt, setPrompt] = useState(saved.prompt);
  const [state, setState] = useState("idle");
  const [glyphs, setGlyphs] = useState<{ a: GlyphOne | null; b: GlyphOne | null }>({ a: null, b: null });
  const [runs, setRuns] = useState<{ A: RunRes | null; B: RunRes | null }>({ A: null, B: null });
  const [split, setSplit] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    localStorage.setItem("glyph-cfg", JSON.stringify({ slots, temperature, maxTokens, disableReasoning, prompt }));
  }, [slots, temperature, maxTokens, disableReasoning, prompt]);

  const run = async () => {
    setError(""); setState("composing");
    try {
      const r = await fetch("/api/glyph", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          slotA: { ...slots[0], temperature, maxTokens, disableReasoning },
          slotB: { ...slots[1], temperature, maxTokens, disableReasoning },
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "compose failed");
      setGlyphs({ a: j.a, b: j.b });
      setState("running");
      const [ra, rb] = await Promise.all([
        fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: j.a.code, slot: "A" }) }).then((x) => x.json()),
        fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: j.b.code, slot: "B" }) }).then((x) => x.json()),
      ]);
      setRuns({ A: ra, B: rb });
      setState("finished");
    } catch (e: any) {
      setError(e.message); setState("error");
    }
  };

  const aggCmd = (f?: string) => f ? `agg ${f} out.gif` : "agg <file.cast> out.gif";
  const copyJSON = () => navigator.clipboard.writeText(JSON.stringify({ glyphs, runs: { A: { ...runs.A, cast: `(${runs.A?.cast.length} frames)` }, B: { ...runs.B, cast: `(${runs.B?.cast.length} frames)` } } }, null, 2));

  return (
    <div className={split ? "app split" : "app"}>
      {!split && (
        <>
          <header className="masthead">
            <div className="brand">
              <h1>GLYPH<span className="sep"> / </span>DUEL</h1>
              <span className="tagline">two models · one prompt · real ptys</span>
            </div>
            <div className="airbox">
              <span className={`lamp ${state === "running" || state === "composing" ? "on" : "idle"}`}>
                <span className="dot" />{state === "running" || state === "composing" ? "on air" : state}
              </span>
            </div>
          </header>
          <div className="ticker">identical prompt → both slots concurrently → raw ansi bytes captured with arrival timestamps → replayed frame-for-frame · nothing is simulated</div>
          <div className="tape">
            <SlotEditor label="A" corner="corner-a" cfg={slots[0]} onChange={(c) => setSlots([c, slots[1]])} />
            <div className="versus">VS</div>
            <SlotEditor label="B" corner="corner-b" cfg={slots[1]} onChange={(c) => setSlots([slots[0], c])} />
          </div>
          <div className="deck">
            <div className="knobs">
              <label className="knob">Temperature <input type="number" step="0.1" value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} /></label>
              <label className="knob">Max tokens <input type="number" value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} /></label>
              <label className="knob"><input type="checkbox" checked={disableReasoning} onChange={(e) => setDisableReasoning(e.target.checked)} /> Disable reasoning</label>
            </div>
            <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <div className="row presets">
              {PRESET_LABELS.map((l, i) => <button key={l} onClick={() => setPrompt(PRESETS[i])}>{l}</button>)}
            </div>
            <div className="actions">
              <button className="big" onClick={run}>⚡ Duel</button>
              <button onClick={() => setSplit(true)}>Record mode</button>
              <button onClick={copyJSON}>Copy results JSON</button>
              <button onClick={() => navigator.clipboard.writeText(aggCmd(runs.A?.castFile))}>Copy GIF command</button>
              <span className="spacer" />
              <span className="state-readout">state: <b>{state}</b></span>
            </div>
          </div>
          {error && <div className="err">{error}</div>}
        </>
      )}
      {split && <button onClick={() => setSplit(false)}>Exit record mode</button>}
      <div className="stage">
        <TermPane title={`A · ${slots[0].model}`} color="#00e5ff" run={runs.A} glyph={glyphs.a} stderrCrash={runs.A?.stderr ?? ""} />
        <TermPane title={`B · ${slots[1].model}`} color="#ff3df0" run={runs.B} glyph={glyphs.b} stderrCrash={runs.B?.stderr ?? ""} />
      </div>
      {!split && (
        <div className="codes">
          <details><summary>code A ({glyphs.a?.extractionPath}) {glyphs.a?.latencyMs}ms</summary><pre>{glyphs.a?.code}</pre></details>
          <details><summary>code B ({glyphs.b?.extractionPath}) {glyphs.b?.latencyMs}ms</summary><pre>{glyphs.b?.code}</pre></details>
        </div>
      )}
      {!split && (
        <footer className="colophon">
          <span>Built by <a href="https://harishkotra.me">Harish Kotra</a></span>
          <span>Checkout my other builds at <a href="https://dailybuild.xyz">dailybuild.xyz</a></span>
        </footer>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
