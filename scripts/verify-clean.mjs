#!/usr/bin/env node
/**
 * 会话残留检查器 —— 用来验证「彻底删除」到底删干净了没有。
 *
 *   node scripts/verify-clean.mjs session-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 *
 * 退出码 0 = 未发现残留；1 = 发现残留（会逐条列出位置）。
 *
 * 检查范围（宿主真正会按会话 id 落盘的地方）：
 *   1. ~/.dsh/sessions/<project>/<id>/            会话日志目录（.jsonl.zstd + .lock）
 *   2. ~/.dsh/storages/session_projcache/sessions/<id>.json   投影缓存文件
 *   3. ~/.dsh/storages/session_projcache/**        投影缓存服务表里残留的 id
 *   4. ~/.dsh/storages/workspace.json              工作区列表里残留的 id
 *   5. 会话索引 SQLite（若存在）                    persisted_sessions / temp.live_sessions
 *   6. 其他插件自己的存储（cost-meter 等）          只报告，不计入失败
 *
 * 不在判定范围内（设计如此）：
 *   - ~/.dsh/attachments/：内容是「按哈希寻址」的共享对象，多个会话可能引用同一份，
 *     删会话不能删对象，否则会误伤其它会话。这里只统计数量，不改、不删。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const sessionId = process.argv[2];
if (!sessionId) {
  console.error("用法: node scripts/verify-clean.mjs <sessionId>");
  process.exit(2);
}
if (!/^[A-Za-z0-9._:-]+$/.test(sessionId)) {
  console.error(`拒绝: 会话 id 含可疑字符: ${sessionId}`);
  process.exit(2);
}

const HOME = os.homedir();
const DSH = process.env.DSH_HOME ? path.resolve(process.env.DSH_HOME) : path.join(HOME, ".dsh");
const hits = [];
const notes = [];

function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

function encodeSegment(raw) {
  if (raw.length === 0) throw new Error("cannot encode an empty path segment");
  if (raw === ".") return "~002E";
  if (raw === "..") return "~002E~002E";
  let encoded = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) encoded += ch;
    else encoded += "~" + code.toString(16).toUpperCase().padStart(4, "0");
  }
  return encoded;
}

/** 1. 会话日志目录 */
function checkSessionDirs() {
  const root = path.join(DSH, "sessions");
  if (!exists(root)) return;
  const encodedId = encodeSegment(sessionId);
  for (const project of fs.readdirSync(root)) {
    const dirA = path.join(root, project, sessionId);
    const dirB = path.join(root, project, encodedId);
    if (exists(dirA)) hits.push(`会话目录: ${dirA}`);
    else if (exists(dirB)) hits.push(`会话目录: ${dirB}`);
  }
}

/** 2. 投影缓存文件 */
function checkProjcacheFile() {
  const file = path.join(DSH, "storages", "session_projcache", "sessions", `${sessionId}.json`);
  if (exists(file)) hits.push(`投影缓存文件: ${file}`);
}

/** 3. 投影缓存服务表 —— 逐文件按 id 精确匹配（避免大文件全量读入） */
function checkProjcacheTables() {
  const root = path.join(DSH, "storages", "session_projcache");
  if (!exists(root)) return;
  const needleA = `"${sessionId}"`;
  const needleB = `:${sessionId}`;
  const walk = (dir, depth) => {
    if (depth > 3) return;
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, name.name);
      if (name.isDirectory()) {
        walk(p, depth + 1);
        continue;
      }
      if (p.includes(`${sessionId}.json`)) continue;
      let text;
      try {
        if (fs.statSync(p).size > 32 * 1024 * 1024) continue;
        text = fs.readFileSync(p, "utf8");
      } catch {
        continue;
      }
      if (text.includes(needleA) || text.includes(needleB)) hits.push(`投影缓存表引用: ${p}`);
    }
  };
  walk(root, 0);
}

/** 4. workspace.json */
function checkWorkspaceJson() {
  const file = path.join(DSH, "storages", "workspace.json");
  if (!exists(file)) return;
  const text = fs.readFileSync(file, "utf8");
  if (text.includes(sessionId)) hits.push(`工作区列表引用: ${file}`);
}

/** 5. 会话索引 SQLite（路径按候选探测，找到才查） */
async function checkSqlite() {
  const candidates = [
    process.env.DSH_SESSION_SEARCH_DB,
    path.join(DSH, "storages", "session-search.sqlite"),
    path.join(DSH, "storages", "sessions.sqlite"),
    path.join(DSH, "cache", "session-search.sqlite"),
  ].filter(Boolean);
  const found = candidates.find((p) => exists(p));
  if (!found) {
    notes.push("未找到会话索引 SQLite（可能配置为 :memory:），跳过该项");
    return;
  }
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    notes.push(`node:sqlite 不可用，跳过 ${found}`);
    return;
  }
  try {
    const db = new DatabaseSync(found, { readOnly: true });
    for (const table of ["persisted_sessions", "temp.live_sessions"]) {
      try {
        const row = db.prepare(`SELECT count(*) AS n FROM ${table} WHERE id = ?`).get(sessionId);
        if (row && row.n > 0) hits.push(`SQLite ${table}: ${found}（${row.n} 行）`);
      } catch {
        /* 表不存在则跳过 */
      }
    }
    db.close();
  } catch (err) {
    notes.push(`读取 ${found} 失败: ${err.message}`);
  }
}

/** 6. 其它插件的会话级存储：只报告 */
function reportForeignStores() {
  const storages = path.join(DSH, "storages");
  if (!exists(storages)) return;
  for (const name of fs.readdirSync(storages, { withFileTypes: true })) {
    if (!name.isDirectory() || name.name === "session_projcache") continue;
    const dir = path.join(storages, name.name);
    let hit = false;
    const walk = (d, depth) => {
      if (hit || depth > 3) return;
      let entries;
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          walk(p, depth + 1);
          continue;
        }
        if (p.includes(sessionId)) {
          hit = true;
          return;
        }
      }
    };
    walk(dir, 0);
    if (hit) notes.push(`其它插件存储里仍有该会话痕迹（不属于本插件职责）: ${dir}`);
  }
}

/** 附件统计（共享对象，不判定） */
function reportAttachments() {
  const objects = path.join(DSH, "attachments", "v1", "objects");
  if (!exists(objects)) return;
  let count = 0;
  for (const shard of fs.readdirSync(objects)) {
    const dir = path.join(objects, shard);
    try {
      if (fs.statSync(dir).isDirectory()) count += fs.readdirSync(dir).length;
    } catch {
      /* ignore */
    }
  }
  notes.push(`附件库共有 ${count} 个内容寻址对象（共享，按设计不随会话删除）`);
}

checkSessionDirs();
checkProjcacheFile();
checkProjcacheTables();
checkWorkspaceJson();
await checkSqlite();
reportForeignStores();
reportAttachments();

console.log(`检查会话: ${sessionId}`);
if (hits.length === 0) console.log("✅ 未发现残留");
else {
  console.log(`❌ 发现 ${hits.length} 处残留:`);
  for (const h of hits) console.log(`   - ${h}`);
}
if (notes.length) {
  console.log("\n备注:");
  for (const n of notes) console.log(`   · ${n}`);
}
process.exit(hits.length === 0 ? 0 : 1);
