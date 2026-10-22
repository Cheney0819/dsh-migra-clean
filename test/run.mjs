/**
 * 跑 test/drag.test.html：用本机 Chrome 无头模式加载，抓取页面内的断言输出。
 *
 *   node test/run.mjs
 *
 * 退出码：全部 PASS → 0；出现 FAIL / THREW / 未完成 → 1。
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const page = "file://" + path.join(here, "drag.test.html");

const CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const chrome = CANDIDATES.find((p) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
});

if (!chrome) {
  console.error("找不到 Chrome；可用 CHROME_PATH=/path/to/chrome node test/run.mjs 指定");
  process.exit(1);
}

execFile(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--window-size=900,700",
    // 无头页面默认被视为隐藏标签页，setTimeout 会被降频到 ~1s，导致断言推进极慢
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--virtual-time-budget=15000",
    "--dump-dom",
    page,
  ],
  { maxBuffer: 32 * 1024 * 1024 },
  (err, stdout) => {
    if (err && !stdout) {
      console.error("Chrome 启动失败:", err.message);
      process.exit(1);
    }
    const match = stdout.match(/<pre id="out"[^>]*>([\s\S]*?)<\/pre>/);
    if (!match) {
      console.error("没有抓到断言输出，页面可能没跑起来");
      process.exit(1);
    }
    const text = match[1]
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    console.log(text.trim());
    const failed = /FAIL|THREW/.test(text) || !/DONE/.test(text);
    process.exit(failed ? 1 : 0);
  },
);
