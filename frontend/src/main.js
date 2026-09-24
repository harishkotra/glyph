import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Terminal } from "@xterm/xterm";
const PRESETS = [
    "Write a single Node.js script that animates the terminal for 5 seconds using ONLY raw ANSI escape codes. No libraries, no dependencies, no external processes. Output only code. Subject: a spinning ASCII cube",
    "Write a single Node.js script that animates the terminal for 5 seconds using ONLY raw ANSI escape codes. No libraries, no dependencies, no external processes. Output only code. Subject: a burning fire made of characters",
    "Write a single Node.js script that animates the terminal for 5 seconds using ONLY raw ANSI escape codes. No libraries, no dependencies, no external processes. Output only code. Subject: a scrolling starfield",
    "Write a single Node.js script that animates the terminal for 5 seconds using ONLY raw ANSI escape codes. No libraries, no dependencies, no external processes. Output only code. Subject: a pulsing audio-style bar visualiser",
];
const PRESET_LABELS = ["spinning ASCII cube", "burning fire", "scrolling starfield", "bar visualiser"];
const PROVIDERS = {
    "Particle.ai": { base: "https://api.particle.ai/v1", key: true },
    Ollama: { base: "http://127.0.0.1:11434/v1", key: false },
    "LM Studio": { base: "http://127.0.0.1:1234/v1", key: false },
    OpenRouter: { base: "https://openrouter.ai/api/v1", key: true },
    Custom: { base: "", key: true },
};
const DEFAULTS = [
    { provider: "Particle.ai", baseUrl: "https://api.particle.ai/v1", apiKey: "", model: "deepseek-v4-flash-0731" },
    { provider: "Particle.ai", baseUrl: "https://api.particle.ai/v1", apiKey: "", model: "deepseek-v4.1-flash" },
];
function loadCfg() {
    try {
        const raw = localStorage.getItem("glyph-cfg");
        if (raw)
            return JSON.parse(raw);
    }
    catch { }
    return { slots: DEFAULTS, temperature: 0, maxTokens: 1600, disableReasoning: false, prompt: PRESETS[0] };
}
function SlotEditor({ label, corner, cfg, onChange }) {
    const [models, setModels] = useState([]);
    const [err, setErr] = useState("");
    const refresh = async (baseUrl, apiKey) => {
        setErr("");
        if (!baseUrl)
            return;
        try {
            const r = await fetch(`/api/models?baseUrl=${encodeURIComponent(baseUrl)}&apiKey=${encodeURIComponent(apiKey)}`);
            const j = await r.json();
            if (!r.ok)
                throw new Error(j.error || r.statusText);
            setModels(j.models ?? []);
        }
        catch (e) {
            setErr(e.message);
        }
    };
    return (_jsxs("div", { className: `slot ${corner}`, children: [_jsxs("div", { className: "slot-head", children: [_jsx("span", { className: "chip" }), _jsxs("h3", { children: ["CORNER ", label] })] }), _jsxs("label", { children: ["Provider ", _jsx("select", { value: cfg.provider, onChange: (e) => {
                            const p = e.target.value;
                            const base = PROVIDERS[p]?.base ?? "";
                            const next = { ...cfg, provider: p, ...(base ? { baseUrl: base } : {}) };
                            onChange(next);
                            refresh(next.baseUrl, next.apiKey);
                        }, children: Object.keys(PROVIDERS).map((p) => _jsx("option", { children: p }, p)) })] }), _jsxs("label", { children: ["Base URL ", _jsx("input", { value: cfg.baseUrl, onChange: (e) => onChange({ ...cfg, baseUrl: e.target.value }) })] }), _jsxs("label", { children: ["API Key ", _jsx("input", { type: "password", value: cfg.apiKey, placeholder: PROVIDERS[cfg.provider]?.key ? "key required" : "no key needed", onChange: (e) => onChange({ ...cfg, apiKey: e.target.value }) })] }), _jsxs("label", { children: ["Model ", _jsx("input", { list: `models-${label}`, value: cfg.model, placeholder: "type model name by hand", onChange: (e) => onChange({ ...cfg, model: e.target.value }) })] }), _jsx("datalist", { id: `models-${label}`, children: models.map((m) => _jsx("option", { value: m }, m)) }), _jsx("button", { className: "mini", onClick: () => refresh(cfg.baseUrl, cfg.apiKey), children: "\u21BB Refresh models" }), err && _jsx("div", { className: "err", children: err })] }));
}
function TermPane({ title, color, run, glyph, stderrCrash }) {
    const ref = useRef(null);
    const termRef = useRef(null);
    const [prog, setProg] = useState(0); // frame index
    const [playing, setPlaying] = useState(false);
    const timer = useRef(null);
    useEffect(() => {
        const t = new Terminal({
            cols: 100, rows: 30, scrollback: 0,
            fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
            theme: { background: "#050604", foreground: "#e8e8f0", cursor: color },
        });
        t.open(ref.current);
        termRef.current = t;
        // Fit 100x30 into the pane without ever cropping: derive font size
        // from measured width (advance ≈ 0.602em) and height.
        const fit = () => {
            const el = ref.current;
            if (!el || !termRef.current)
                return;
            const w = el.clientWidth - 16; // xterm 8px padding each side
            const size = Math.max(5, Math.min(12, Math.floor(w / 60.2)));
            termRef.current.options.fontSize = size;
        };
        fit();
        const ro = new ResizeObserver(fit);
        if (ref.current)
            ro.observe(ref.current);
        return () => { ro.disconnect(); t.dispose(); termRef.current = null; };
    }, []);
    const renderUpTo = (idx) => {
        const t = termRef.current;
        if (!t || !run)
            return;
        t.clear();
        for (let i = 0; i <= idx && i < run.cast.length; i++)
            t.write(run.cast[i].data);
        if (stderrCrash && idx >= (run?.cast.length ?? 0) - 1)
            t.write("\r\n\x1b[31m" + stderrCrash.slice(0, 2000) + "\x1b[0m");
        setProg(idx);
    };
    useEffect(() => {
        setProg(0);
        setPlaying(false);
        termRef.current?.clear();
        if (run && run.cast.length)
            renderUpTo(run.cast.length - 1);
        // eslint-disable-next-line
    }, [run?.castFile]);
    const play = () => {
        if (!run?.cast.length)
            return;
        setPlaying(true);
        termRef.current?.clear();
        let i = 0;
        let last = 0;
        const step = () => {
            if (!termRef.current || !run)
                return;
            if (i >= run.cast.length) {
                setPlaying(false);
                return;
            }
            const f = run.cast[i];
            termRef.current.write(f.data);
            setProg(i);
            const delay = Math.max(0, Math.min(500, ((f.t - last) * 1000)));
            last = f.t;
            i++;
            timer.current = setTimeout(step, delay);
        };
        step();
    };
    const pause = () => { clearTimeout(timer.current); setPlaying(false); };
    const restart = () => { pause(); termRef.current?.clear(); setProg(0); };
    const violation = run?.status === "VIOLATION";
    const max = Math.max(0, (run?.cast.length ?? 1) - 1);
    const stats = [
        ["exit", run?.exitCode == null ? "—" : String(run.exitCode)],
        ["bytes", run?.bytes == null ? "—" : String(run.bytes)],
        ["frames", run?.frames == null ? "—" : String(run.frames)],
        ["dur ms", run?.durationMs == null ? "—" : String(run.durationMs)],
        ["reason", glyph?.reasoningTokens == null ? "n/a" : String(glyph.reasoningTokens)],
        ["status", run?.status ?? "—"],
    ];
    return (_jsxs("div", { className: `pane side-${title.startsWith("A") ? "a" : "b"}`, children: [_jsxs("div", { className: "pane-top", children: [_jsx("span", { className: "fighter", children: title }), _jsx("span", { className: "sha", children: glyph?.sha256?.slice(0, 10) ?? "" })] }), _jsx("dl", { className: "stats", children: stats.map(([k, v]) => _jsxs("div", { className: "stat", children: [_jsx("dt", { children: k }), _jsx("dd", { title: v, children: v })] }, k)) }), violation && _jsx("div", { className: "badge-row", children: _jsxs("span", { className: "badge", children: ["VIOLATION \u00B7 ", run?.violation] }) }), _jsx("div", { className: "screen", ref: ref }), _jsxs("div", { className: "controls", children: [!playing ? _jsx("button", { onClick: play, children: "Play" }) : _jsx("button", { onClick: pause, children: "Pause" }), _jsx("button", { onClick: restart, children: "Restart" }), _jsx("button", { onClick: () => renderUpTo(Math.max(0, prog - 1)), children: "\u25C0 frame" }), _jsx("button", { onClick: () => renderUpTo(Math.min(max, prog + 1)), children: "frame \u25B6" }), _jsx("input", { type: "range", min: 0, max: max, value: prog, onChange: (e) => { pause(); renderUpTo(Number(e.target.value)); } }), run?.castFile && _jsx("a", { className: "dl", href: `/api/casts/${run.castFile}`, download: true, children: _jsx("button", { children: "Download .cast" }) })] })] }));
}
function App() {
    const saved = useRef(loadCfg()).current;
    const [slots, setSlots] = useState(saved.slots);
    const [temperature, setTemperature] = useState(saved.temperature);
    const [maxTokens, setMaxTokens] = useState(saved.maxTokens);
    const [disableReasoning, setDisableReasoning] = useState(saved.disableReasoning);
    const [prompt, setPrompt] = useState(saved.prompt);
    const [state, setState] = useState("idle");
    const [glyphs, setGlyphs] = useState({ a: null, b: null });
    const [runs, setRuns] = useState({ A: null, B: null });
    const [split, setSplit] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        localStorage.setItem("glyph-cfg", JSON.stringify({ slots, temperature, maxTokens, disableReasoning, prompt }));
    }, [slots, temperature, maxTokens, disableReasoning, prompt]);
    const run = async () => {
        setError("");
        setState("composing");
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
            if (!r.ok)
                throw new Error(j.error || "compose failed");
            setGlyphs({ a: j.a, b: j.b });
            setState("running");
            const [ra, rb] = await Promise.all([
                fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: j.a.code, slot: "A" }) }).then((x) => x.json()),
                fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: j.b.code, slot: "B" }) }).then((x) => x.json()),
            ]);
            setRuns({ A: ra, B: rb });
            setState("finished");
        }
        catch (e) {
            setError(e.message);
            setState("error");
        }
    };
    const aggCmd = (f) => f ? `agg ${f} out.gif` : "agg <file.cast> out.gif";
    const copyJSON = () => navigator.clipboard.writeText(JSON.stringify({ glyphs, runs: { A: { ...runs.A, cast: `(${runs.A?.cast.length} frames)` }, B: { ...runs.B, cast: `(${runs.B?.cast.length} frames)` } } }, null, 2));
    return (_jsxs("div", { className: split ? "app split" : "app", children: [!split && (_jsxs(_Fragment, { children: [_jsxs("header", { className: "masthead", children: [_jsxs("div", { className: "brand", children: [_jsxs("h1", { children: ["GLYPH", _jsx("span", { className: "sep", children: " / " }), "DUEL"] }), _jsx("span", { className: "tagline", children: "two models \u00B7 one prompt \u00B7 real ptys" })] }), _jsx("div", { className: "airbox", children: _jsxs("span", { className: `lamp ${state === "running" || state === "composing" ? "on" : "idle"}`, children: [_jsx("span", { className: "dot" }), state === "running" || state === "composing" ? "on air" : state] }) })] }), _jsx("div", { className: "ticker", children: "identical prompt \u2192 both slots concurrently \u2192 raw ansi bytes captured with arrival timestamps \u2192 replayed frame-for-frame \u00B7 nothing is simulated" }), _jsxs("div", { className: "tape", children: [_jsx(SlotEditor, { label: "A", corner: "corner-a", cfg: slots[0], onChange: (c) => setSlots([c, slots[1]]) }), _jsx("div", { className: "versus", children: "VS" }), _jsx(SlotEditor, { label: "B", corner: "corner-b", cfg: slots[1], onChange: (c) => setSlots([slots[0], c]) })] }), _jsxs("div", { className: "deck", children: [_jsxs("div", { className: "knobs", children: [_jsxs("label", { className: "knob", children: ["Temperature ", _jsx("input", { type: "number", step: "0.1", value: temperature, onChange: (e) => setTemperature(Number(e.target.value)) })] }), _jsxs("label", { className: "knob", children: ["Max tokens ", _jsx("input", { type: "number", value: maxTokens, onChange: (e) => setMaxTokens(Number(e.target.value)) })] }), _jsxs("label", { className: "knob", children: [_jsx("input", { type: "checkbox", checked: disableReasoning, onChange: (e) => setDisableReasoning(e.target.checked) }), " Disable reasoning"] })] }), _jsx("textarea", { rows: 4, value: prompt, onChange: (e) => setPrompt(e.target.value) }), _jsx("div", { className: "row presets", children: PRESET_LABELS.map((l, i) => _jsx("button", { onClick: () => setPrompt(PRESETS[i]), children: l }, l)) }), _jsxs("div", { className: "actions", children: [_jsx("button", { className: "big", onClick: run, children: "\u26A1 Duel" }), _jsx("button", { onClick: () => setSplit(true), children: "Record mode" }), _jsx("button", { onClick: copyJSON, children: "Copy results JSON" }), _jsx("button", { onClick: () => navigator.clipboard.writeText(aggCmd(runs.A?.castFile)), children: "Copy GIF command" }), _jsx("span", { className: "spacer" }), _jsxs("span", { className: "state-readout", children: ["state: ", _jsx("b", { children: state })] })] })] }), error && _jsx("div", { className: "err", children: error })] })), split && _jsx("button", { onClick: () => setSplit(false), children: "Exit record mode" }), _jsxs("div", { className: "stage", children: [_jsx(TermPane, { title: `A · ${slots[0].model}`, color: "#00e5ff", run: runs.A, glyph: glyphs.a, stderrCrash: runs.A?.stderr ?? "" }), _jsx(TermPane, { title: `B · ${slots[1].model}`, color: "#ff3df0", run: runs.B, glyph: glyphs.b, stderrCrash: runs.B?.stderr ?? "" })] }), !split && (_jsxs("div", { className: "codes", children: [_jsxs("details", { children: [_jsxs("summary", { children: ["code A (", glyphs.a?.extractionPath, ") ", glyphs.a?.latencyMs, "ms"] }), _jsx("pre", { children: glyphs.a?.code })] }), _jsxs("details", { children: [_jsxs("summary", { children: ["code B (", glyphs.b?.extractionPath, ") ", glyphs.b?.latencyMs, "ms"] }), _jsx("pre", { children: glyphs.b?.code })] })] })), !split && (_jsxs("footer", { className: "colophon", children: [_jsxs("span", { children: ["Built by ", _jsx("a", { href: "https://harishkotra.me", children: "Harish Kotra" })] }), _jsxs("span", { children: ["Checkout my other builds at ", _jsx("a", { href: "https://dailybuild.xyz", children: "dailybuild.xyz" })] })] }))] }));
}
createRoot(document.getElementById("root")).render(_jsx(App, {}));
