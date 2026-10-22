// Minimal Chrome DevTools Protocol driver: headless Chrome + Node's global WebSocket/fetch
// (Node >= 22). No dependencies. Set CHROME_PATH to override the browser binary.
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;

export async function launch({ width = 1600, height = 1000, extra = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "reloop-chrome-"));
  const proc = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
    `--window-size=${width},${height}`, "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", ...extra, "about:blank",
  ], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); }
    else if (msg.method === "Runtime.consoleAPICalled") logs.push(`[console.${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
    else if (msg.method === "Runtime.exceptionThrown") logs.push(`[exception] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const goto = async (url) => { await send("Page.navigate", { url }); await sleep(400);
    for (let i = 0; i < 100; i++) { if (await evaluate("!!window.__reloop && !!document.querySelector('canvas')")) break; await sleep(200); }
    await sleep(1200); };
  const shot = async (file) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(file, Buffer.from(r.data, "base64")); };
  const click = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); await sleep(600); };
  const close = async () => { try { await send("Browser.close"); } catch {} ws.close(); proc.kill(); };
  return { send, evaluate, goto, shot, click, sleep, logs, close };
}
