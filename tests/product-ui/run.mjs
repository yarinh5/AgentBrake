import { fork, spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
let fixture;
let browser;
async function cleanup() {
  if (browser && browser.exitCode === null) { const ended = once(browser, "exit"); browser.kill(); await ended; }
  if (fixture && fixture.exitCode === null) {
    const ended = once(fixture, "exit"); fixture.send("close");
    let timeout;
    try { await Promise.race([ended, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error("Fixture cleanup timeout")), 10_000); })]); }
    catch { fixture.kill(); await ended; }
    finally { clearTimeout(timeout); }
  }
}
process.once("SIGINT", () => void cleanup().finally(() => process.exit(130)));
process.once("SIGTERM", () => void cleanup().finally(() => process.exit(143)));
try {
 for (const managed of process.argv.includes("--managed-only") ? [true] : [false, true]) {
  fixture = fork(fileURLToPath(new URL("./fixture.ts", import.meta.url)), managed ? ["--managed"] : [], { cwd: root, execArgv: ["--import", "tsx"], windowsHide: true, stdio: ["ignore", "inherit", "inherit", "ipc"] });
  let ready = false;
  for (let index = 0; index < 150; index++) {
    if (fixture.exitCode !== null) throw Error("Fixture exited before readiness");
    try { const response = await fetch("http://127.0.0.1:44215/api/health", { signal: AbortSignal.timeout(300) }); if (response.status === 200) { ready = true; break; } }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) throw Error("Standalone dashboard fixture failed readiness");
  browser = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "tests/product-ui/playwright.config.ts", managed ? "managed.spec.ts" : "workflows.spec.ts", ...process.argv.slice(2).filter(arg => arg !== "--managed-only")], { cwd: root, windowsHide: true, stdio: "inherit" });
  const [code] = await once(browser, "exit"); process.exitCode = code ?? 1;
  await cleanup();
  if (process.exitCode) break;
 }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await cleanup(); }
