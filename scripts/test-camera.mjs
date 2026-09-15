import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import ts from "typescript";

// Uses an installed Chrome/Edge and synthetic canvas streams, never a real camera.
const root = fileURLToPath(new URL("../", import.meta.url));
const executable = [process.env.CAMERA_TEST_BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/chromium", "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((value) => value && existsSync(value));
if (!executable) throw new Error("Set CAMERA_TEST_BROWSER to an installed Chrome/Chromium/Edge executable.");

const files = new Map();
for (const [url, file] of [["/src/lib/camera-guard", "src/lib/camera-guard.ts"], ["/tests.js", "scripts/camera-guard.browser.ts"]]) {
  const source = await readFile(path.join(root, file), "utf8");
  files.set(url, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText);
}
const server = createServer((request, response) => {
  if (files.has(request.url)) {
    response.writeHead(200, { "Content-Type": "text/javascript" });
    response.end(files.get(request.url));
  } else {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<!doctype html><title>Camera tests</title>");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const profile = await mkdtemp(path.join(tmpdir(), "videosystem-camera-test-"));
let browser;
let socket;
try {
  browser = spawn(executable, ["--headless=new", "--no-first-run", "--no-default-browser-check",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    "--autoplay-policy=no-user-gesture-required", "--remote-debugging-port=0",
    "--user-data-dir=" + profile, "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  const websocketUrl = await new Promise((resolve, reject) => {
    let log = "";
    const timeout = setTimeout(() => reject(new Error("Browser startup timed out")), 15000);
    browser.on("error", reject);
    browser.stderr.on("data", (chunk) => {
      log += chunk.toString();
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    browser.on("exit", (code) => { clearTimeout(timeout); reject(new Error("Browser exited: " + code)); });
  });
  socket = new WebSocket(websocketUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const callback = pending.get(message.id);
    if (callback) {
      pending.delete(message.id);
      message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result);
    }
    if (message.method === "Runtime.consoleAPICalled") {
      console.log(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await send("Target.createTarget", { url: origin });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, sessionId);
  const result = await send("Runtime.evaluate", {
    expression: "import(" + JSON.stringify(origin + "/tests.js") + ").then(module => module.runTests())",
    awaitPromise: true, returnByValue: true, timeout: 110000,
  }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  console.log("Camera browser tests passed: " + result.result.value.length);
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) {
    const exited = new Promise((resolve) => browser.once("exit", resolve));
    browser.kill();
    await exited;
  }
  await new Promise((resolve) => server.close(resolve));
  // Only the unique temporary profile created above is removed.
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => console.warn("Temporary browser profile remains at " + profile));
}
