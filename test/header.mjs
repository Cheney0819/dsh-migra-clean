/**
 * 会话日志（zstd 多帧 / 纯文本）读写回归测试。
 *
 *   node test/header.mjs
 *
 * 只碰临时目录，不会读写真机 ~/.dsh。退出码：全 PASS → 0；否则 1。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { __test } from "../lib/index.js";

const CHECKSUM = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } };
const frame = (text) => zlib.zstdCompressSync(Buffer.from(text), CHECKSUM);
const headerLine = (cwd) =>
  JSON.stringify({ type: "session", version: 4, id: "session-abc", createdAt: 1, delegationDepth: 0, isSeeded: false, cwd });

let failed = 0;
const log = (ok, msg) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-migra-clean-header-"));
const dir = path.join(root, "proj", "session-abc");
fs.mkdirSync(dir, { recursive: true });
const logFile = path.join(dir, "session.v4.jsonl.zstd");

try {
  // 1) 首帧里除了 header 还打包了事件：改 cwd 不能把那些行吃掉
  const extra = [JSON.stringify({ type: "user/message", seq: 1 }), JSON.stringify({ type: "assistant/message", seq: 2 })];
  const firstFrame = `${headerLine("/tmp/old")}\n${extra.join("\n")}\n`;
  const tailFrame = `${JSON.stringify({ type: "later", seq: 3 })}\n`;
  fs.writeFileSync(logFile, Buffer.concat([frame(firstFrame), frame(tailFrame)]));

  const res = __test.rewriteSessionCwd(dir, "/tmp/new");
  log(res.updated === true && res.frames === 2, "改写首帧 cwd 成功且识别到 2 帧");

  const raw = fs.readFileSync(logFile);
  const { frames } = __test.scanZstdFrames(raw);
  log(frames.length === 2, "改写后帧边界没有被破坏（仍是 2 帧）");
  const plain = zlib.zstdDecompressSync(raw.subarray(frames[0].start, frames[0].end)).toString("utf8");
  const lines = plain.split("\n").filter(Boolean);
  log(lines.length === 3, `首帧内的 3 行全部保留（实际 ${lines.length} 行）`);
  log(JSON.parse(lines[0]).cwd === "/tmp/new", "header.cwd 已改成新路径");
  log(JSON.parse(lines[1]).seq === 1 && JSON.parse(lines[2]).seq === 2, "首帧内被打包的事件原样保留");
  const tailPlain = zlib.zstdDecompressSync(raw.subarray(frames[1].start, frames[1].end)).toString("utf8");
  log(JSON.parse(tailPlain.trim()).seq === 3, "后续帧内容一字未动");

  // 2) cwd 相同 → 一个字节都不写
  const before = fs.readFileSync(logFile);
  const again = __test.rewriteSessionCwd(dir, "/tmp/new");
  log(again.updated === false, "cwd 未变化时返回 updated:false");
  log(fs.readFileSync(logFile).equals(before), "cwd 未变化时文件字节不变");

  // 3) 首帧大于 64KB 探测窗口时 header 仍能读到（子会话漏搬的根因）
  const dir2 = path.join(root, "proj2", "session-big");
  fs.mkdirSync(dir2, { recursive: true });
  const filler = [];
  for (let i = 0; i < 400; i += 1) {
    filler.push(JSON.stringify({ type: "event", seq: i, payload: crypto.randomBytes(400).toString("base64") }));
  }
  const bigFrame = frame(`${headerLine("/tmp/big")}\n${filler.join("\n")}\n`);
  fs.writeFileSync(path.join(dir2, "session.v4.jsonl.zstd"), bigFrame);
  log(bigFrame.length > 65536, `构造的首帧确实超过 64KB（${bigFrame.length} 字节）`);
  const bigHeader = __test.readSessionHeaderFromDir(dir2);
  log(bigHeader !== null && bigHeader.cwd === "/tmp/big", "超大首帧的 header 仍可读取");

  // 4) 纯文本日志：只改首行
  const dir3 = path.join(root, "proj3", "session-plain");
  fs.mkdirSync(dir3, { recursive: true });
  const plainFile = path.join(dir3, "session.v4.jsonl");
  fs.writeFileSync(plainFile, `${headerLine("/tmp/plain")}\n${JSON.stringify({ seq: 9 })}\n`);
  const plainRes = __test.rewriteSessionCwd(dir3, "/tmp/plain2");
  const plainLines = fs.readFileSync(plainFile, "utf8").split("\n").filter(Boolean);
  log(plainRes.updated === true && plainLines.length === 2, "纯文本日志改首行后其余行保留");
  log(JSON.parse(plainLines[0]).cwd === "/tmp/plain2" && JSON.parse(plainLines[1]).seq === 9, "纯文本日志内容正确");

  // 5) projectKey 与宿主规则一致（分隔符折叠 + 非法字符 ~XXXX）
  log(__test.projectKey("/Users/jiee/Documents/deepseek-harness/dsh-migra-clean") === "--Users-jiee-Documents-deepseek-harness-dsh-migra-clean--", "projectKey 常规路径");
  log(__test.projectKey("/") === "--root--", "projectKey 根路径");
  log(__test.projectKey("/tmp/中文 目录") === "--tmp-~4E2D~6587~0020~76EE~5F55--", "projectKey 非 ASCII 与空格转义");
  log(__test.projectKey("/a//b::c") === "--a-b-c--", "projectKey 连续分隔符折叠");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(failed === 0 ? "DONE" : `FAILED ${failed}`);
process.exit(failed === 0 ? 0 : 1);
