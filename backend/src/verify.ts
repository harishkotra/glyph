// npm run verify — data & verification checks (no model keys needed).
import { runInPty, scanViolations } from "./runner.js";
import fs from "node:fs";

const cube = `
const frames=['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
let i=0; const t0=Date.now();
const iv=setInterval(()=>{ process.stdout.write('\\x1b[2J\\x1b[H'+frames[i++%frames.length]+' spinning cube frame '+i+'\\n'+('#'.repeat(80)+'\\n').repeat(5)); if(Date.now()-t0>5000) { clearInterval(iv); } },50);
`;
// 1. byte counts in the thousands
const r1 = await runInPty(cube, "A");
console.log("check1 bytes:", r1.bytes, r1.bytes > 1000 ? "PASS" : "FAIL");
const r2 = await runInPty(cube + "//b", "B");
// 2. different files, different frame counts (timestamps differ)
console.log("check2 files:", r1.castFile, r2.castFile, r1.castFile !== r2.castFile ? "PASS" : "FAIL");
// 3. PTY kill: infinite loop capped at 6s
const r3 = await runInPty("setInterval(()=>process.stdout.write('x'),10);", "A");
console.log("check3 timeout:", r3.status, r3.durationMs, r3.status === "TIMEOUT" && r3.durationMs < 7000 ? "PASS" : "FAIL");
// 4. AST scan blocks child_process/socket
const v = scanViolations("const cp=require('child_process'); cp.exec('ls');");
console.log("check4 violation:", v ? "PASS" : "FAIL");
const v2 = scanViolations("fetch('http://x');");
console.log("check4b socket:", v2 ? "PASS" : "FAIL");
if (!fs.existsSync("casts")) console.log("WARN: no casts dir");
