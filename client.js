window.__ModuleLoader__.load({
  id: "dsh-migra-clean",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    let react;
    try {
      react = require("react");
    } catch {
      react = window.React;
    }

    exports.name = "dsh-migra-clean";
    exports.inject = ["slots"];

    // React 不可用时保持空实现，绝不让插槽条目崩溃（崩溃会整块变白）
    if (!react || typeof react.createElement !== "function") {
      exports.apply = function () {};
      return module.exports;
    }
    // 兜底：工厂里任何一句抛错都不能让整个 web boot 判成 import failed
    // （那会让宿主直接弹「应用无法启动」）。先把可用的空壳交出去，再试图装真身。
    try {

    const h = react.createElement;
    const useState = react.useState;
    const useEffect = react.useEffect;
    const useLayoutEffect = react.useLayoutEffect || react.useEffect;
    const useMemo = react.useMemo;
    const useRef = react.useRef;

    // ------------------------------------------------------------------
    // 轻量 store：右键菜单 / 模态框 / Toast 都由 shell.overlay 渲染，
    // 不再往 document.body 里塞节点，卸载时随上下文一起消失。
    // ------------------------------------------------------------------

    const EMPTY_STATE = { menu: null, dialog: null, toasts: [] };
    let state = EMPTY_STATE;
    const listeners = new Set();
    // 插件自己的客户端上下文：迁移成功后要借它拿 uiWorkspace 做「原地重挂」
    let activeCtx = null;

    function publish(patch) {
      state = typeof patch === "function" ? patch(state) : { ...state, ...patch };
      for (const fn of [...listeners]) {
        try {
          fn();
        } catch {}
      }
    }

    function subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }

    function useStore() {
      const [snapshot, setSnapshot] = useState(state);
      useEffect(() => {
        const off = subscribe(() => setSnapshot(state));
        setSnapshot(state);
        return off;
      }, []);
      return snapshot;
    }

    let toastSeed = 0;
    function toast(message, tone = "info") {
      const id = ++toastSeed;
      publish((s) => ({ ...s, toasts: [...s.toasts, { id, message, tone }].slice(-4) }));
      const ttl = tone === "error" ? 4800 : tone === "warn" ? 3800 : 2600;
      setTimeout(() => {
        publish((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }));
      }, ttl);
    }

    function closeMenu() {
      if (state.menu) publish({ menu: null });
    }

    function closeDialog(value) {
      const dialog = state.dialog;
      publish({ dialog: null });
      if (dialog && typeof dialog.resolve === "function") dialog.resolve(value);
    }

    function openConfirm(config) {
      closeDialog(false);
      return new Promise((resolve) => {
        publish({ dialog: { kind: "confirm", resolve, ...config } });
      });
    }

    function openMove(config) {
      closeDialog(false);
      return new Promise((resolve) => {
        publish({ dialog: { kind: "move", resolve, ...config } });
      });
    }

    // ------------------------------------------------------------------
    // HTTP 小工具
    // ------------------------------------------------------------------

    async function readJson(res) {
      let data = null;
      try {
        data = await res.json();
      } catch {
        throw new Error(`服务器返回了非 JSON 响应（HTTP ${res.status}）`);
      }
      return data;
    }

    async function getJson(url) {
      const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
      return readJson(res);
    }

    async function postJson(url, body) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return readJson(res);
    }

    function formatBytes(bytes) {
      if (!bytes || bytes < 0) return "空会话";
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    function formatTime(ms) {
      if (!ms || isNaN(Number(ms))) return "";
      try {
        const date = new Date(ms);
        const now = Date.now();
        const diff = now - ms;
        if (diff >= 0 && diff < 60 * 1000) return "刚刚";
        if (diff >= 0 && diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
        if (diff >= 0 && diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
        return date.toLocaleString();
      } catch {
        return "";
      }
    }

    // ------------------------------------------------------------------
    // 图标
    // ------------------------------------------------------------------

    function Icon({ name, size = 14 }) {
      const common = {
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
        style: { flex: "none", display: "block" },
      };
      if (name === "folder") {
        return h("svg", common, h("path", { d: "M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" }));
      }
      if (name === "trash") {
        return h(
          "svg",
          common,
          h("path", { d: "M4 6h16" }),
          h("path", { d: "M9.5 6V4.2h5V6" }),
          h("path", { d: "M6.5 6l.8 13a1 1 0 0 0 1 .95h7.4a1 1 0 0 0 1-.95L17.5 6" })
        );
      }
      if (name === "copy") {
        return h(
          "svg",
          common,
          h("rect", { x: 9, y: 9, width: 11, height: 11, rx: 2.5 }),
          h("path", { d: "M15 6.5V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1.5" })
        );
      }
      if (name === "search") {
        return h("svg", common, h("circle", { cx: 11, cy: 11, r: 6.5 }), h("path", { d: "M16 16l4 4" }));
      }
      return null;
    }

    // 路径过长时保留尾部两级目录，避免把最有用的信息截掉
    function shortenPath(value) {
      if (typeof value !== "string" || value.length <= 46) return value;
      const parts = value.split("/").filter(Boolean);
      const tail = parts.slice(-2).join("/");
      return `\u2026/${tail}`;
    }

    // ------------------------------------------------------------------
    // 样式：只用 host 的 --dsw-alias-* 令牌，浅色/深色主题自动跟随
    // ------------------------------------------------------------------

    const CSS = `
.dsh-migra-clean-menu{position:fixed;z-index:2147483000;min-width:190px;padding:4px;border-radius:10px;
  background:var(--dsw-alias-bg-overlay, #24242b);color:var(--dsw-alias-label-primary, #e6e6e6);
  border:1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.14));
  box-shadow:0 14px 32px rgba(0,0,0,.22);
  font-size:13px;line-height:1.4;animation:dsh-migra-clean-pop .1s ease-out}
.dsh-migra-clean-menu-item,.dsh-migra-clean-menuitem{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:6px;
  background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer}
.dsh-migra-clean-menu-item:hover,.dsh-migra-clean-menu-item:focus-visible,
.dsh-migra-clean-menuitem:hover,.dsh-migra-clean-menuitem:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}
.dsh-migra-clean-menu-item[data-tone="danger"]{color:var(--dsw-alias-state-error-primary)}
.dsh-migra-clean-menu-item[data-tone="danger"]:hover,.dsh-migra-clean-menu-item[data-tone="danger"]:focus-visible,
.dsh-migra-clean-menuitem[data-tone="danger"]:hover,.dsh-migra-clean-menuitem[data-tone="danger"]:focus-visible{background:var(--dsw-alias-interactive-bg-hover-danger)}
.dsh-migra-clean-menuitem[data-tone="danger"]{color:var(--dsw-alias-state-error-primary)}
.dsh-migra-clean-menu-divider{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l1)}

/* 拖拽：可落点提示 + 当前悬停目标 */
[data-row-key^="workspace:"][data-dsh-migra-clean-dropzone="true"]{outline:1px dashed var(--dsw-alias-border-l2);outline-offset:-2px;border-radius:8px}
[data-row-key^="workspace:"][data-dsh-migra-clean-drop="true"]{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;border-radius:8px;
  background:var(--dsw-alias-interactive-bg-hover)}
[data-dsh-migra-clean-dragging="true"]{cursor:grabbing !important}

.dsh-migra-clean-header-btn{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border-radius:6px;
  border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);
  font:inherit;font-size:12px;cursor:pointer;transition:background .12s,color .12s}
.dsh-migra-clean-header-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsh-migra-clean-header-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}

.dsh-migra-clean-scrim{position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;
  padding:24px;background:var(--dsw-alias-bg-mask-1, rgba(0,0,0,.45));backdrop-filter:saturate(120%) blur(2px);
  pointer-events:auto;animation:dsh-migra-clean-fade .12s ease-out}
/* 卡片外壳：细发丝边 + 柔和投影。浅色主题下 brand-primary 是近黑色，
   所以这里不再用重描边/重投影，避免糊成一块黑。 */
.dsh-migra-clean-dialog{width:min(520px,100%);max-height:min(84vh,680px);display:flex;flex-direction:column;padding:22px 22px 18px;
  box-sizing:border-box;border-radius:18px;background:var(--dsw-alias-bg-layer-1, #fff);color:var(--dsw-alias-label-primary, #111);
  border:1px solid var(--dsw-alias-border-l2, rgba(15,17,21,.1));
  box-shadow:0 20px 48px rgba(15,17,21,.18),0 1px 2px rgba(15,17,21,.06);
  font-size:13px;animation:dsh-migra-clean-rise .16s cubic-bezier(.16,1,.3,1)}
.dsh-migra-clean-dialog-head{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:600;letter-spacing:.2px}
/* 图标做成一枚淡底圆角牌，比裸图标耐看 */
.dsh-migra-clean-dialog-head svg{flex:none;box-sizing:content-box;padding:6px;border-radius:10px;opacity:1;
  background:color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent)}
.dsh-migra-clean-dialog-desc{margin-top:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);white-space:pre-line}
.dsh-migra-clean-dialog-meta{margin-top:12px;display:flex;flex-wrap:wrap;gap:8px}
/* 信息胶囊：淡底、无硬边，超长路径省略 */
.dsh-migra-clean-chip{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:11.5px;line-height:1.6;padding:3px 9px;border-radius:8px;
  background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border:1px solid transparent}
.dsh-migra-clean-dialog-error{margin-top:12px;padding:9px 11px;border-radius:10px;font-size:12px;line-height:1.55;
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  border:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 26%, transparent);
  color:var(--dsw-alias-state-error-primary)}
/* 搜索框：淡底 + 聚焦时一圈柔和描边，不甩纯黑边框 */
.dsh-migra-clean-search-wrap{position:relative;margin:16px 0 10px;display:flex;align-items:center}
.dsh-migra-clean-search-wrap svg{position:absolute;left:11px;color:var(--dsw-alias-label-caption);pointer-events:none}
.dsh-migra-clean-search{width:100%;height:36px;padding:0 12px 0 33px;border-radius:10px;
  background:var(--dsw-alias-bg-module-platform);border:1px solid transparent;color:var(--dsw-alias-label-primary);
  font:inherit;font-size:13px;transition:box-shadow .15s ease}
.dsh-migra-clean-search::placeholder{color:var(--dsw-alias-label-caption)}
.dsh-migra-clean-search:focus{outline:none;border-color:transparent;
  box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent)}
.dsh-migra-clean-list{flex:1;min-height:132px;overflow:auto;display:flex;flex-direction:column;gap:2px;
  padding-right:4px;margin-bottom:8px}
/* 工作区行：选中态改成淡色底 + 左侧主色竖条，替掉浅色主题下扎眼的纯黑描边 */
.dsh-migra-clean-ws{position:relative;display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px 9px 12px;
  border-radius:10px;border:1px solid transparent;background:transparent;color:inherit;font:inherit;text-align:left;
  cursor:pointer;transition:background .12s ease,box-shadow .12s ease}
.dsh-migra-clean-ws:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-migra-clean-ws[data-active="true"]{border-color:transparent;
  background:color-mix(in srgb, var(--dsw-alias-brand-primary) 7%, transparent);
  box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent)}
.dsh-migra-clean-ws[data-active="true"]::before{content:"";position:absolute;left:5px;top:50%;transform:translateY(-50%);
  width:3px;height:18px;border-radius:999px;background:var(--dsw-alias-brand-primary)}
.dsh-migra-clean-ws[data-current="true"]{cursor:default;opacity:.7}
.dsh-migra-clean-ws[data-current="true"]:hover{background:transparent}
.dsh-migra-clean-ws-main{flex:1;min-width:0}
.dsh-migra-clean-ws-title{display:flex;align-items:center;gap:6px;font-weight:600;font-size:13.5px;
  color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-migra-clean-ws-path{margin-top:3px;font-size:11.5px;color:var(--dsw-alias-label-tertiary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-migra-clean-tag{flex:none;font-size:11px;line-height:1.6;padding:1px 7px;border-radius:7px;
  background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border:1px solid transparent}
/* 说明块：淡底卡片（不再是一圈空框）；固定高度 100px（ready/current/idle 三态严格同高）：
   hover 切 active 时高度不变，弹窗垂直居中不会位移，避免边界抖动。 */
.dsh-migra-clean-preview{display:flex;flex-direction:column;justify-content:center;gap:6px;
  padding:11px 12px;border-radius:12px;margin-bottom:2px;background:var(--dsw-alias-bg-module-platform);
  box-sizing:border-box;height:100px;min-height:100px;max-height:100px;overflow:hidden;
  border:1px solid transparent;transition:background .12s ease}
.dsh-migra-clean-preview[data-state="ready"]{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 5%, var(--dsw-alias-bg-module-platform))}
.dsh-migra-clean-preview-note{font-size:11px;line-height:1.55;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis}
.dsh-migra-clean-preview-flag{flex:none;font-size:10.5px;line-height:1.5;padding:1px 6px;border-radius:6px;
  background:transparent;border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));
  color:var(--dsw-alias-label-secondary,#6b7280)}
.dsh-migra-clean-preview-row{display:flex;align-items:baseline;gap:8px;min-width:0;font-size:12px}
.dsh-migra-clean-preview-label{flex:none;color:var(--dsw-alias-label-secondary)}
.dsh-migra-clean-preview-arrow{flex:none;font-weight:700;color:var(--dsw-alias-brand-primary)}
.dsh-migra-clean-preview-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;
  color:var(--dsw-alias-label-primary);word-break:break-all}
.dsh-migra-clean-empty{padding:22px 12px;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary)}
/* 页脚：去掉那条贯穿的分隔线（浅色主题下像一道划痕），靠留白分层 */
.dsh-migra-clean-dialog-foot{display:flex;justify-content:flex-end;gap:8px;padding-top:16px}
.dsh-migra-clean-btn{padding:8px 16px;border-radius:10px;font:inherit;font-size:13px;font-weight:500;cursor:pointer;
  border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-primary);
  transition:background .12s,box-shadow .12s,opacity .12s}
.dsh-migra-clean-btn[data-variant="ghost"]{color:var(--dsw-alias-label-secondary)}
.dsh-migra-clean-btn[data-variant="ghost"]:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-migra-clean-btn[data-variant="primary"]{background:var(--dsw-alias-brand-primary);
  color:var(--dsw-alias-label-primary-inverted,var(--dsw-alias-bg-layer-1));box-shadow:0 1px 2px rgba(15,17,21,.14)}
.dsh-migra-clean-btn[data-variant="primary"]:not(:disabled):hover{background:var(--dsw-alias-button-primary-hover,#43454a)}
.dsh-migra-clean-btn[data-variant="danger"]{background:var(--dsw-alias-state-error-primary);
  color:#fff;box-shadow:0 1px 2px rgba(236,19,19,.2)}
.dsh-migra-clean-btn:not(:disabled):active{transform:translateY(.5px)}
.dsh-migra-clean-btn:disabled{opacity:.45;cursor:default}
.dsh-migra-clean-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}

.dsh-migra-clean-toasts{position:fixed;right:16px;bottom:16px;z-index:2147483002;display:flex;flex-direction:column;
  align-items:flex-end;gap:8px;pointer-events:none}
.dsh-migra-clean-toast{display:flex;align-items:flex-start;gap:8px;max-width:320px;padding:8px 12px;border-radius:10px;
  background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);
  box-shadow:0 8px 24px rgba(0,0,0,.16);color:var(--dsw-alias-label-primary);
  font-size:12.5px;line-height:1.5;pointer-events:auto;animation:dsh-migra-clean-rise .16s ease-out}
.dsh-migra-clean-toast-dot{flex:none;width:6px;height:6px;margin-top:6px;border-radius:50%;
  background:var(--dsw-alias-state-idle-primary)}
.dsh-migra-clean-toast[data-tone="success"] .dsh-migra-clean-toast-dot{background:var(--dsw-alias-state-success-primary)}
.dsh-migra-clean-toast[data-tone="error"] .dsh-migra-clean-toast-dot{background:var(--dsw-alias-state-error-primary)}
.dsh-migra-clean-toast[data-tone="warn"] .dsh-migra-clean-toast-dot{background:var(--dsw-alias-state-warn-primary)}
.dsh-migra-clean-toast[data-tone="info"] .dsh-migra-clean-toast-dot{background:var(--dsw-alias-brand-primary)}

@keyframes dsh-migra-clean-pop{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
@keyframes dsh-migra-clean-fade{from{opacity:0}to{opacity:1}}
@keyframes dsh-migra-clean-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@media (prefers-reduced-motion: reduce){
  .dsh-migra-clean-menu,.dsh-migra-clean-scrim,.dsh-migra-clean-dialog,.dsh-migra-clean-toast{animation:none !important}
}
`;

    const STYLE_VERSION = "1.4.3";

    // 关键：宿主 HMR 重新求值客户端模块时，旧实例的 ctx.effect cleanup 会在
    // 新实例之后执行，直接删掉它。修复：每次 ensureStyles() 都创建一个独立的新
    // 样式表（带随机 uid），cleanup 只删自己那个。旧版本残留（旧 id/旧 attribute）仍然清掉。
    const STYLE_UID = `${STYLE_VERSION}-${Math.random().toString(36).slice(2, 8)}`;

    // 宿主 dsh-client-modules 的样式簿记（claimStyles/removeOwnedStyles）会把所有
    // 没有 data-plugin 属性的 <style> 认领给「下一个加载的模块」，并在那个模块热更时
    // 把它连带删除 —— 改另一个插件会清掉我们的样式表，弹窗就裸奔了。
    // 修复：插入时就打上 data-plugin=dsh-migra-clean 归属：别人不会认领，只有我们
    // 自己被热更时宿主才回收，而我们自己的 apply 随即重建（下面 uid 独立样式表）。
    const STYLE_OWNER = "dsh-migra-clean";

    let cachedStyleEl = null;

    function ensureStyles() {
      // 快速路径：本 uid 节点已缓存且仍在 DOM 树中，直接返回，避免反复 querySelector
      if (cachedStyleEl && cachedStyleEl.isConnected) {
        return cachedStyleEl;
      }
      // 幂等：本 uid 已在场就直接返回，避免 OverlayHost 反复挂载时重复插入
      const existing = document.head.querySelector(`style[data-dsh-migra-clean-css="${STYLE_UID}"]`);
      if (existing) {
        // 兜底：归属属性万一被外部改动，补回去
        if (existing.getAttribute("data-plugin") !== STYLE_OWNER) {
          existing.setAttribute("data-plugin", STYLE_OWNER);
        }
        cachedStyleEl = existing;
        return existing;
      }
      // 清掉旧版本遗留的（旧 id、旧 attribute、以及 data-dsh-migra-clean-css 但不是本 uid）
      for (const stale of Array.from(document.querySelectorAll(
        "style[data-dsh-migra-clean-css], style[data-dsh-del-css], style[data-dsh-del], style#dsh-del-styles"
      ))) {
        if (stale.getAttribute("data-dsh-migra-clean-css") !== STYLE_UID) stale.remove();
      }
      const style = document.createElement("style");
      style.setAttribute("data-dsh-migra-clean-css", STYLE_UID);
      style.setAttribute("data-plugin", STYLE_OWNER);
      style.textContent = CSS;
      document.head.appendChild(style);
      cachedStyleEl = style;
      return style;
    }

    function injectStyles() {
      const style = ensureStyles();
      return () => {
        style.remove();
      };
    }

    // ------------------------------------------------------------------
    // Toast 栈
    // ------------------------------------------------------------------

    function Toasts({ toasts }) {
      return h(
        "div",
        { className: "dsh-migra-clean-toasts", role: "status", "aria-live": "polite" },
        toasts.map((item) =>
          h(
            "div",
            { key: item.id, className: "dsh-migra-clean-toast", "data-tone": item.tone || "info" },
            h("span", { className: "dsh-migra-clean-toast-dot" }),
            h("span", null, item.message)
          )
        )
      );
    }

    // ------------------------------------------------------------------
    // 右键菜单
    // ------------------------------------------------------------------

    let menuSeed = 0;

    function ContextMenu({ menu }) {
      const ref = useRef(null);
      const [pos, setPos] = useState({ left: menu.x, top: menu.y });

      useLayoutEffect(() => {
        const node = ref.current;
        if (!node) return;
        const rect = node.getBoundingClientRect();
        const margin = 8;
        const left = Math.max(margin, Math.min(menu.x, window.innerWidth - rect.width - margin));
        const top = Math.max(margin, Math.min(menu.y, window.innerHeight - rect.height - margin));
        setPos({ left, top });
        const first = node.querySelector("button");
        if (first && typeof first.focus === "function") {
          // preventScroll: 避免聚焦时触发浏览器自动滚动，进而导致捕获阶段的 scroll 监听直接自杀
          first.focus({ preventScroll: true });
        }
      }, [menu.x, menu.y]);

      useEffect(() => {
        const openedAt = Date.now();
        const onPointerDown = (event) => {
          // 忽略唤起瞬间（120ms内）同一手势残余的 pointerdown（如 Mac 触控板两指微差着陆或按键回弹）
          if (Date.now() - openedAt < 120) return;
          if (!ref.current || !ref.current.contains(event.target)) closeMenu();
        };
        const onKeyDown = (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeMenu();
          }
        };
        const onWheel = (event) => {
          // 只有用户在菜单外部滚动滚轮/触控板双指滑动时才关闭；绝不监听捕获阶段的 DOM scroll（防止鼠标滑过会话行时因 title 跑马灯 scrollLeft 或子容器微动导致菜单暴毙）
          if (ref.current && ref.current.contains(event.target)) return;
          if (Date.now() - openedAt < 250) return;
          closeMenu();
        };
        const onResize = () => closeMenu();
        const timer = setTimeout(() => document.addEventListener("pointerdown", onPointerDown, true), 0);
        document.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("resize", onResize);
        window.addEventListener("wheel", onWheel, { passive: true });
        return () => {
          clearTimeout(timer);
          document.removeEventListener("pointerdown", onPointerDown, true);
          document.removeEventListener("keydown", onKeyDown, true);
          window.removeEventListener("resize", onResize);
          window.removeEventListener("wheel", onWheel, { passive: true });
        };
      }, []);

      const run = (fn) => (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        fn();
      };

      return h(
        "div",
        {
          ref,
          className: "dsh-migra-clean-menu",
          role: "menu",
          "aria-label": "会话操作",
          // 只内联动态位置；静态样式全部交给 CSS（带兜底色，即使 token 缺失也不裸奔）
          style: {
            left: pos.left,
            top: pos.top,
          },
        },
        h(
          "button",
          { type: "button", role: "menuitem", className: "dsh-migra-clean-menu-item", onClick: run(() => runMove(menu.sessionId, menu.title)) },
          h(Icon, { name: "folder" }),
          h("span", null, "移动到工作区…")
        ),
        h(
          "button",
          {
            type: "button",
            role: "menuitem",
            className: "dsh-migra-clean-menu-item",
            onClick: run(() => {
              const text = menu.sessionId || "";
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(
                  () => toast("已复制会话 ID", "success"),
                  () => toast("复制失败：浏览器未授予剪贴板权限", "error")
                );
              } else {
                toast("复制失败：当前环境不支持剪贴板", "error");
              }
            }),
          },
          h(Icon, { name: "copy" }),
          h("span", null, "复制会话 ID")
        ),
        h("div", { className: "dsh-migra-clean-menu-divider", role: "separator" }),
        h(
          "button",
          {
            type: "button",
            role: "menuitem",
            className: "dsh-migra-clean-menu-item",
            "data-tone": "danger",
            onClick: run(() => runDelete(menu.sessionId, menu.title)),
          },
          h(Icon, { name: "trash" }),
          h("span", null, "删除会话")
        )
      );
    }

    // ------------------------------------------------------------------
    // 模态框骨架：焦点陷阱、Esc、焦点归还
    // ------------------------------------------------------------------

    function DialogFrame({ title, icon, danger, onClose, footer, children }) {
      const frameRef = useRef(null);
      const closeRef = useRef(onClose);
      closeRef.current = onClose;

      useEffect(() => {
        const previous = document.activeElement;
        const node = frameRef.current;
        const preferred = node?.querySelector("[data-autofocus]") || node?.querySelector("button,input");
        if (preferred && typeof preferred.focus === "function") preferred.focus();

        const onKeyDown = (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeRef.current();
            return;
          }
          if (event.key !== "Tab" || !node) return;
          const focusables = Array.from(
            node.querySelectorAll('button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])')
          );
          if (focusables.length === 0) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        };

        document.addEventListener("keydown", onKeyDown, true);
        return () => {
          document.removeEventListener("keydown", onKeyDown, true);
          if (previous && typeof previous.focus === "function") previous.focus();
        };
      }, []);

      return h(
        "div",
        {
          className: "dsh-migra-clean-scrim",
          // 内联兜底：即使样式表因任何原因没生效，弹窗也必须是全屏居中、可读、可点
          style: {
            background: "rgba(0,0,0,.45)",
          },
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) closeRef.current();
          },
        },
        h(
          "div",
          {
            ref: frameRef,
            className: "dsh-migra-clean-dialog",
            // 内联只保留 font：CSS 里没有它，且弹窗必须可读；其余全部由 CSS 承担
            style: {
              font: "13px/1.45 system-ui, -apple-system, sans-serif",
            },
            role: "dialog",
            "aria-modal": "true",
            "aria-label": title,
          },
          h(
            "div",
            { className: "dsh-migra-clean-dialog-head" },
            h(Icon, { name: icon || "trash", size: 16 }),
            h("span", { style: danger ? { color: "var(--dsw-alias-state-error-primary)" } : undefined }, title)
          ),
          children,
          h("div", { className: "dsh-migra-clean-dialog-foot" }, footer)
        )
      );
    }

    // ------------------------------------------------------------------
    // 删除确认
    // ------------------------------------------------------------------

    function ConfirmDialog({ dialog }) {
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);

      const confirm = async () => {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
          await dialog.onConfirm();
          closeDialog(true);
        } catch (err) {
          setError(err && err.message ? err.message : String(err));
          setBusy(false);
        }
      };

      const meta = Array.isArray(dialog.meta) ? dialog.meta.filter(Boolean) : [];

      return h(
        DialogFrame,
        {
          title: dialog.title || "确认操作",
          icon: "trash",
          danger: Boolean(dialog.danger),
          onClose: () => {
            if (!busy) closeDialog(false);
          },
          footer: [
            h(
              "button",
              {
                key: "cancel",
                type: "button",
                className: "dsh-migra-clean-btn",
                "data-variant": "ghost",
                "data-autofocus": true,
                disabled: busy,
                onClick: () => closeDialog(false),
              },
              "取消"
            ),
            h(
              "button",
              {
                key: "ok",
                type: "button",
                className: "dsh-migra-clean-btn",
                "data-variant": dialog.danger === false ? "primary" : "danger",
                disabled: busy,
                onClick: confirm,
              },
              busy ? "处理中…" : dialog.confirmLabel || "确认"
            ),
          ],
        },
        h("div", { className: "dsh-migra-clean-dialog-desc" }, dialog.description || ""),
        meta.length ? h("div", { className: "dsh-migra-clean-dialog-meta" }, meta.map((text, i) => h("span", { key: i, className: "dsh-migra-clean-chip" }, text))) : null,
        error ? h("div", { className: "dsh-migra-clean-dialog-error" }, error) : null
      );
    }

    // ------------------------------------------------------------------
    // 移动到工作区
    // ------------------------------------------------------------------

    function MoveDialog({ dialog }) {
      const [loading, setLoading] = useState(true);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const [payload, setPayload] = useState(null);
      const [query, setQuery] = useState("");
      const [active, setActive] = useState(0);
      const listRef = useRef(null);
      const navScrollRef = useRef(false);

      // 标题兜底：调用方没给标题（例如只从会话头部按钮进来）时，优先用工作区返回的会话元信息，必要时向宿主再问一次
      const [fallbackTitle, setFallbackTitle] = useState("");
      useEffect(() => {
        let alive = true;
        const existing = (dialog.sessionTitle || "").trim() || (payload && payload.session && payload.session.title);
        if (!existing) {
          getJson(`/api/dsh-migra-clean/info?sessionId=${encodeURIComponent(dialog.sessionId)}`)
            .then((data) => {
              if (alive && data && data.ok && data.title) setFallbackTitle(String(data.title).trim());
            })
            .catch(() => {});
        }
        return () => {
          alive = false;
        };
      }, [dialog.sessionId, dialog.sessionTitle, payload]);

      useEffect(() => {
        let alive = true;
        setLoading(true);
        getJson(`/api/dsh-migra-clean/workspaces?sessionId=${encodeURIComponent(dialog.sessionId)}`)
          .then((data) => {
            if (!alive) return;
            if (!data || data.ok === false) throw new Error((data && data.error) || "读取工作区列表失败");
            setPayload(data);
            setError(null);
          })
          .catch((err) => {
            if (alive) setError(err && err.message ? err.message : String(err));
          })
          .finally(() => {
            if (alive) setLoading(false);
          });
        return () => {
          alive = false;
        };
      }, [dialog.sessionId]);

      const currentId = payload ? payload.currentWorkspaceId : null;
      const items = (payload && payload.workspaces) || [];
      const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return items;
        return items.filter((w) => `${w.title || ""} ${w.path || ""}`.toLowerCase().includes(q));
      }, [items, query]);

      useEffect(() => {
        const firstSelectable = filtered.findIndex((w) => w.id !== currentId);
        setActive(firstSelectable >= 0 ? firstSelectable : 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [query, currentId, items.length]);

      // 只有键盘导航才滚动：悬停时滚动会把指针甩到相邻行，形成 hover→scroll→hover 的抖动死循环
      useEffect(() => {
        if (!navScrollRef.current) return;
        navScrollRef.current = false;
        const node = listRef.current && listRef.current.querySelector(`[data-index="${active}"]`);
        if (node && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "nearest" });
      }, [active]);

      const move = async (explicit) => {
        // 点击某一行时显式传入目标，避免 setState 异步导致用上旧的 active 索引
        const target = explicit && explicit.id ? explicit : filtered[active];
        if (!target || target.id === currentId || busy) return;
        setBusy(true);
        setError(null);
        try {
          const data = await postJson("/api/dsh-migra-clean/move", {
            sessionId: dialog.sessionId,
            targetWorkspaceId: target.id,
          });
          if (!data || data.ok === false) throw new Error((data && data.error) || "迁移失败");
          closeDialog(data);
        } catch (err) {
          setError(err && err.message ? err.message : String(err));
          setBusy(false);
        }
      };

      const onKeyDown = (event) => {
        if (loading || busy || filtered.length === 0) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          navScrollRef.current = true;
          const step = event.key === "ArrowDown" ? 1 : -1;
          setActive((prev) => {
            let next = prev;
            for (let i = 0; i < filtered.length; i++) {
              next = (next + step + filtered.length) % filtered.length;
              if (filtered[next].id !== currentId) break;
            }
            return next;
          });
        } else if (event.key === "Enter") {
          event.preventDefault();
          // active 是数组索引，过滤条件变化后 setActive 还没落地时不能盲目
          // 用 filtered[active]；优先当前项，否则取过滤后第一个可迁移项。
          const selected = filtered[active];
          const target = selected && selected.id !== currentId
            ? selected
            : filtered.find((w) => w.id !== currentId);
          if (target) move(target);
        }
      };

      const activeItem = filtered[active];
      const sessionCwd = payload && payload.session && payload.session.cwd;

      return h(
        DialogFrame,
        {
          title: "移动到其他工作区",
          icon: "folder",
          onClose: () => {
            if (!busy) closeDialog(false);
          },
          footer: [
            h(
              "button",
              {
                key: "cancel",
                type: "button",
                className: "dsh-migra-clean-btn",
                "data-variant": "ghost",
                disabled: busy,
                onClick: () => closeDialog(false),
              },
              "取消"
            ),
            h(
              "button",
              {
                key: "ok",
                type: "button",
                className: "dsh-migra-clean-btn",
                "data-variant": "primary",
                disabled: busy || loading || !activeItem || activeItem.id === currentId,
                onClick: () => move(),
              },
              busy ? "迁移中…" : "确认移动"
            ),
          ],
        },
        h(
          "div",
          { className: "dsh-migra-clean-dialog-desc" },
          (() => {
            const shown =
              (dialog.sessionTitle || "").trim() ||
              (payload && payload.session && (payload.session.title || "").trim()) ||
              fallbackTitle;
            return shown ? `会话：“${shown}”` : "会话：未命名会话";
          })()
        ),
        h(
          "div",
          { className: "dsh-migra-clean-dialog-meta" },
          sessionCwd ? h("span", { className: "dsh-migra-clean-chip" }, `当前目录 ${sessionCwd}`) : null,
          payload && payload.currentWorkspaceId
            ? h(
                "span",
                { className: "dsh-migra-clean-chip" },
                `所在工作区 ${(items.find((w) => w.id === payload.currentWorkspaceId) || {}).title || "未分组"}`
              )
            : h("span", { className: "dsh-migra-clean-chip" }, "尚未归属任何工作区")
        ),
        h(
          "div",
          { className: "dsh-migra-clean-search-wrap", onKeyDown },
          h(Icon, { name: "search", size: 13 }),
          h("input", {
            className: "dsh-migra-clean-search",
            type: "search",
            value: query,
            placeholder: "搜索工作区名称或路径…",
            "data-autofocus": true,
            autoComplete: "off",
            spellCheck: false,
            onChange: (event) => setQuery(event.target.value),
          })
        ),
        h(
          "div",
          { className: "dsh-migra-clean-list", ref: listRef, onKeyDown },
          loading
            ? h("div", { className: "dsh-migra-clean-empty" }, "正在读取工作区…")
            : filtered.length === 0
              ? h("div", { className: "dsh-migra-clean-empty" }, items.length === 0 ? "还没有其他工作区" : "没有匹配的工作区")
              : filtered.map((w, index) => {
                  const isCurrent = w.id === currentId;
                  return h(
                    "button",
                    {
                      key: w.id,
                      type: "button",
                      className: "dsh-migra-clean-ws",
                      "data-index": index,
                      "data-active": index === active ? "true" : "false",
                      "data-current": isCurrent ? "true" : "false",
                      "aria-current": isCurrent ? "true" : undefined,
                      onClick: () => {
                        if (isCurrent || busy) return;
                        setActive(index);
                        move(w);
                      },
                      // 悬停不切到「当前」行，且相同索引避免重复重渲染
                      onMouseEnter: () => {
                        if (!isCurrent && active !== index) setActive(index);
                      },
                    },
                    h(
                      "div",
                      { className: "dsh-migra-clean-ws-main" },
                      h(
                        "div",
                        { className: "dsh-migra-clean-ws-title" },
                        h("span", { style: { overflow: "hidden", textOverflow: "ellipsis" } }, w.title || "未命名工作区"),
                        w.isDefault ? h("span", { className: "dsh-migra-clean-tag" }, "默认") : null,
                        isCurrent ? h("span", { className: "dsh-migra-clean-tag" }, "当前") : null
                      ),
                      h("div", { className: "dsh-migra-clean-ws-path" }, w.path || "")
                    ),
                    h("span", { className: "dsh-migra-clean-tag" }, `${w.sessionCount || 0} 会话`)
                  );
                })
        ),
        h(
          "div",
          {
            className: "dsh-migra-clean-preview",
            "data-state": activeItem ? (activeItem.id === currentId ? "current" : "ready") : "idle",
          },
          activeItem && activeItem.id !== currentId
            ? [
                h(
                  "div",
                  { key: "row", className: "dsh-migra-clean-preview-row" },
                  h("span", { className: "dsh-migra-clean-preview-label" }, "迁移后 cwd"),
                  h("span", { className: "dsh-migra-clean-preview-arrow" }, "\u2192"),
                  h(
                    "code",
                    { className: "dsh-migra-clean-preview-path", title: activeItem.path || "" },
                    activeItem.path ? shortenPath(activeItem.path) : "（该工作区无路径）"
                  )
                ),
                h(
                  "div",
                  { key: "note", className: "dsh-migra-clean-preview-note" },
                  "此后命令与产物都落在上面这个目录；旧产物留在原处，日志会搬入该工作区。"
                ),
              ]
            : activeItem
              ? h("div", { className: "dsh-migra-clean-preview-note" }, "该会话已经在这个工作区，无需迁移。")
              : h(
                  "div",
                  { className: "dsh-migra-clean-preview-note" },
                  "选中工作区后这里会显示迁移后的执行目录；会话日志随之搬入该目录，聊天记录完整保留。"
                )
        ),
        error ? h("div", { className: "dsh-migra-clean-dialog-error" }, error) : null
      );
    }

    // ------------------------------------------------------------------
    // shell.overlay 宿主
    // ------------------------------------------------------------------

    function OverlayHost() {
      const snapshot = useStore();
      // 双保险：每次渲染都幂等确认样式表在场（无依赖数组）。
      // 只在挂载时补一次不够：样式表若被宿主 HMR 簿记删掉，菜单/弹窗打开时
      // 会走这里的状态更新重渲染，正好把样式自愈回来，不用等刷新页面。
      useEffect(() => {
        ensureStyles();
      });
      const { menu, dialog, toasts } = snapshot;
      return h(
        react.Fragment,
        null,
        menu ? h(ContextMenu, { key: "menu-" + (menu.id || menu.sessionId), menu }) : null,
        dialog
          ? dialog.kind === "move"
            ? h(MoveDialog, { key: "move", dialog })
            : h(ConfirmDialog, { key: "confirm", dialog })
          : null,
        h(Toasts, { key: "toasts", toasts })
      );
    }

    // ------------------------------------------------------------------
    // 业务流程
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // 拖拽到工作区：会话行 → 工作区行（或该工作区的分组区域）
    //
    // 宿主自己用 HTML5 拖拽做「同工作区内排序」，跨分组会被 sameGroupDrag 挡掉；
    // 而且空白会话 / 归档会话根本不带 draggable。所以这里做两条通道：
    //   1) 原生 draggable 行 —— 捕获阶段接管 dragover/drop；
    //   2) 不可拖的行 —— 指针按下 + 位移阈值自建拖拽。
    // 两条通道共用同一套落点判定与高亮，落点只会是工作区行，绝不干扰宿主排序。
    // ------------------------------------------------------------------

    const WORKSPACE_ROW_SELECTOR = '[data-row-key^="workspace:"]';
    const SESSION_ROW_SELECTOR = '[data-row-key^="session:"]';
    const WORKSPACE_PREFIX = "workspace:";
    const SESSION_PREFIX = "session:";
    const DRAG_THRESHOLD_PX = 6;

    let dragState = null;
    let dragToken = 0;
    // 工作区归属信息缓存：拖拽开始时同步拿到「当前工作区」，不必等一次 HTTP 往返
    const WORKSPACE_META_TTL_MS = 20000;
    const workspaceMetaCache = new Map(); // sessionId -> { at, currentWorkspaceId }
    let workspaceMarks = [];             // [{ id, row }] 拖拽期间预取，避免每次都 querySelectorAll
    let pointerRaf = 0;                  // pointermove 合帧，避免每次事件都做 elementFromPoint
    let pointerTimer = 0;                // rAF 兜底定时器（后台标签页 rAF 可能不触发）
    let pointerScheduled = false;
    let lastPointer = null;
    let pointerDrag = null;
    let swallowClickUntil = 0;

    function rowKeyValue(row, prefix) {
      const key = row && typeof row.getAttribute === "function" ? row.getAttribute("data-row-key") : "";
      return typeof key === "string" && key.startsWith(prefix) ? key.slice(prefix.length) : null;
    }

    function workspaceRowForId(workspaceId) {
      for (const row of document.querySelectorAll(WORKSPACE_ROW_SELECTOR)) {
        if (rowKeyValue(row, WORKSPACE_PREFIX) === workspaceId) return row;
      }
      return null;
    }

    function resolveWorkspaceIdFromTarget(target) {
      if (!target || typeof target.closest !== "function") return null;
      const row = target.closest(WORKSPACE_ROW_SELECTOR);
      if (row) return rowKeyValue(row, WORKSPACE_PREFIX);
      const group = target.closest('[role="group"]');
      if (group) {
        let node = group.previousElementSibling;
        while (node) {
          const id = rowKeyValue(node, WORKSPACE_PREFIX);
          if (id) return id;
          node = node.previousElementSibling;
        }
      }
      return null;
    }

    let activeDropRow = null;

    function clearDragMarks() {
      activeDropRow = null;
      for (const el of document.querySelectorAll("[data-dsh-migra-clean-drop], [data-dsh-migra-clean-dropzone]")) {
        el.removeAttribute("data-dsh-migra-clean-drop");
        el.removeAttribute("data-dsh-migra-clean-dropzone");
      }
      if (document.body) document.body.removeAttribute("data-dsh-migra-clean-dragging");
    }

    function markDropzones(currentWorkspaceId) {
      workspaceMarks = [];
      for (const row of document.querySelectorAll(WORKSPACE_ROW_SELECTOR)) {
        const id = rowKeyValue(row, WORKSPACE_PREFIX);
        if (!id) continue;
        workspaceMarks.push({ id, row });
        if (id === currentWorkspaceId) continue;
        row.setAttribute("data-dsh-migra-clean-dropzone", "true");
      }
    }

    /**
     * 只摘掉某一个工作区行的落点标记。
     * 归属信息是异步补全的，补全后没必要为一行重扫整棵 DOM（旧实现是重跑一遍
     * markDropzones，等于每次拖拽两次全量 querySelectorAll + 全量属性写）。
     */
    function unmarkDropzone(workspaceId) {
      if (!workspaceId) return;
      const mark = workspaceMarks.find((m) => m.id === workspaceId);
      const row = mark ? mark.row : workspaceRowForId(workspaceId);
      if (row) row.removeAttribute("data-dsh-migra-clean-dropzone");
    }

    function beginDrag(sessionId, title) {
      const token = ++dragToken;
      dragState = { sessionId, title: title || "", currentWorkspaceId: null, targetId: null };
      if (document.body) document.body.setAttribute("data-dsh-migra-clean-dragging", "true");

      // 先标记落点（不依赖网络），再补全「当前工作区」归属
      markDropzones(null);
      const cached = workspaceMetaCache.get(sessionId);
      const fresh = cached && Date.now() - cached.at < WORKSPACE_META_TTL_MS;
      if (fresh) {
        // 命中缓存：直接用，不再发请求（这里曾被写成「命中仍然发请求、只是忽略结果」，等于白缓存）
        dragState.currentWorkspaceId = cached.currentWorkspaceId || null;
        unmarkDropzone(dragState.currentWorkspaceId);
        return dragState;
      }

      const warm = (always) => {
        getJson(`/api/dsh-migra-clean/workspaces?sessionId=${encodeURIComponent(sessionId)}`)
          .then((data) => {
            if (!data || data.ok === false) return;
            const currentWorkspaceId = data.currentWorkspaceId || null;
            if (workspaceMetaCache.size >= 512) workspaceMetaCache.clear();
            workspaceMetaCache.set(sessionId, { at: Date.now(), currentWorkspaceId });
            if (!always) return;
            if (!dragState || token !== dragToken) return;
            dragState.currentWorkspaceId = currentWorkspaceId;
            unmarkDropzone(currentWorkspaceId);
          })
          .catch(() => {});
      };
      warm(true);
      return dragState;
    }

    /** 清除当前落点高亮与 targetId；不触碰 dragState 本身。 */
    function clearDropTarget() {
      if (activeDropRow) {
        activeDropRow.removeAttribute("data-dsh-migra-clean-drop");
        activeDropRow = null;
      } else {
        for (const mark of workspaceMarks) mark.row.removeAttribute("data-dsh-migra-clean-drop");
      }
      if (dragState) dragState.targetId = null;
    }

    /** 设定/清除落点高亮；返回该落点是否可接收。 */
    function setDropTarget(workspaceId) {
      if (!dragState) return false;
      if (!workspaceId || (dragState.currentWorkspaceId && workspaceId === dragState.currentWorkspaceId)) {
        clearDropTarget();
        return false;
      }
      if (dragState.targetId !== workspaceId) {
        clearDropTarget();
        dragState.targetId = workspaceId;
        const mark = workspaceMarks.find((m) => m.id === workspaceId);
        const row = mark ? mark.row : workspaceRowForId(workspaceId);
        if (row) {
          row.setAttribute("data-dsh-migra-clean-drop", "true");
          activeDropRow = row;
        }
      }
      return true;
    }

    function finishDrag() {
      const state = dragState;
      dragState = null;
      dragToken += 1;
      pointerDrag = null;
      if (pointerRaf) {
        cancelAnimationFrame(pointerRaf);
        pointerRaf = 0;
      }
      if (pointerTimer) {
        clearTimeout(pointerTimer);
        pointerTimer = 0;
      }
      pointerScheduled = false;
      clearDragMarks();
      workspaceMarks = [];
      return state;
    }

    // ---- 迁移成功后的主视图处置 ----
    //
    // 为什么不再整页刷新：迁移时后端会 quiesce 掉宿主里的活会话，宿主随即广播
    // session/disposed → api-session/removed，客户端那份 Session 实例被
    // handleRemoved() 永久置 removed=true（输入框从此只读），而只有换一个新实例
    // 才能清掉这个标记。uiWorkspace.clearMain() 会释放 mainView 引用 → 客户端
    // retireScope → manager.drop 掉旧实例；紧接着 openSession() 重新 retain，
    // 拿到的就是干净实例，并会按新 cwd 重新从磁盘拉历史。
    // 侧边栏分组本来就走 domain/changed 增量，从来不需要刷新。

    /** 本浏览器主视图当前显示的会话 ID；拿不到返回 null。 */
    function currentMainSessionId() {
      const ctx = activeCtx;
      if (!ctx || typeof ctx.get !== "function") return null;
      try {
        const ui = ctx.get("uiWorkspace", false);
        if (!ui) return null;
        const selection = ui.selection;
        if (selection && typeof selection.getSnapshot === "function") {
          const snapshot = selection.getSnapshot();
          if (snapshot && typeof snapshot.sessionId === "string") return snapshot.sessionId;
        }
        const reference = ui.mainReference;
        if (reference && typeof reference.sessionId === "string") return reference.sessionId;
      } catch {}
      return null;
    }

    /**
     * 当前主视图是否就是该会话，或它的子智能体会话。删除/迁移父会话时，
     * 宿主会级联 dispose 子会话；只比较精确 ID 会漏掉“正在看子会话”的情况。
     */
    function currentMainDescendsFrom(sessionId) {
      const current = currentMainSessionId();
      if (!current) return false;
      if (current === sessionId) return true;
      const ctx = activeCtx;
      if (!ctx || typeof ctx.get !== "function") return false;
      try {
        const sessions = ctx.get("sessions", false);
        const manager = sessions && (sessions.manager || sessions);
        let cursor = current;
        const seen = new Set();
        while (cursor && !seen.has(cursor)) {
          seen.add(cursor);
          const address = manager?.subagentAddress?.(cursor);
          if (!address || !address.parentSessionId) return false;
          if (address.parentSessionId === sessionId) return true;
          cursor = address.parentSessionId;
        }
      } catch {}
      return false;
    }

    /** 把主视图上的会话原地重挂一次（丢弃被 removed 污染的旧实例）。 */
    function remountMainSession(sessionId) {
      const ctx = activeCtx;
      if (!ctx || typeof ctx.get !== "function") return false;
      try {
        const ui = ctx.get("uiWorkspace", false);
        if (!ui || typeof ui.clearMain !== "function" || typeof ui.openSession !== "function") return false;
        ui.clearMain();
        ui.openSession(sessionId);
        return true;
      } catch (err) {
        console.warn("[dsh-migra-clean] 原地重挂会话失败:", err);
        return false;
      }
    }

    /**
     * 重挂之后确认「旧实例真的被换掉了」。
     * 客户端 Session 的 removed 标记一旦置位就不会自己复位，只有旧实例被引用计数
     * 归零后丢弃、再重新 materialize 才会消失；如果还有别的视图（右侧栏等）持有它，
     * 重挂等于白挂，这时候必须让调用方走兜底。
     */
    function isClientSessionRemoved(sessionId) {
      const ctx = activeCtx;
      if (!ctx || typeof ctx.get !== "function") return false;
      try {
        const sessions = ctx.get("sessions", false);
        const manager = sessions && sessions.manager;
        if (!manager) return false;
        const map = manager.sessions;
        const session = map && typeof map.get === "function" ? map.get(sessionId) : null;
        return Boolean(session && session.removed);
      } catch {
        return false;
      }
    }

    /**
     * 迁移成功后收尾：只有「本浏览器正在看这个会话」才需要处理——
     * 其它会话的客户端实例没有被 removed 广播污染，点它反而会把用户正在看的
     * 会话顶掉（旧实现就是这个毛病）。
     */
    function afterMoveSession(sessionId, wasLive) {
      // 当前主视图可能是被移动会话本身，也可能是它的子智能体会话（子会话会
      // 随父会话一起 quiesce）。两种情况都必须重挂当前视图。
      const currentId = currentMainSessionId();
      if (!currentId || !currentMainDescendsFrom(sessionId)) return;
      if (remountMainSession(currentId) && !isClientSessionRemoved(currentId)) return;
      // 走到这里只有两种可能：宿主太老没有 uiWorkspace，或者这个会话还被别的视图
      // （右侧栏等）持有、引用计数没归零所以旧实例没被丢弃。此时活会话确实会卡死
      // 输入框，只能退回整页刷新。
      if (wasLive) setTimeout(() => window.location.reload(), 700);
    }

    async function moveToWorkspace(sessionId, title, workspaceId) {
      if (!sessionId || !workspaceId) return;
      toast(title ? `正在移动「${title}」…` : "正在移动会话…", "info");
      try {
        const data = await postJson("/api/dsh-migra-clean/move", { sessionId, targetWorkspaceId: workspaceId });
        if (!data || data.ok === false) throw new Error((data && data.error) || "迁移失败");
        if (data.noop) {
          toast(data.message || "该会话已在此工作区", "info");
          return;
        }
        workspaceMetaCache.delete(sessionId);
        const extra = data.movedChildren ? `（含 ${data.movedChildren} 个子会话）` : "";
        toast(`已移至【${data.targetWorkspaceTitle}】${extra}`, "success");
        afterMoveSession(sessionId, data.wasLive);
      } catch (err) {
        toast(err && err.message ? err.message : "迁移失败", "error");
      }
    }

    // ---- 通道 1：原生 HTML5 拖拽 ----
    function onDragStartCapture(event) {
      const row = event.target && typeof event.target.closest === "function" ? event.target.closest(SESSION_ROW_SELECTOR) : null;
      if (!row) return;
      const sessionId = rowKeyValue(row, SESSION_PREFIX);
      if (!sessionId) return;
      const titleNode = row.querySelector('[class*="title"]');
      beginDrag(sessionId, (titleNode && titleNode.textContent ? titleNode.textContent : "").trim());
    }

    function onDragOverCapture(event) {
      if (!dragState) return;
      const workspaceId = resolveWorkspaceIdFromTarget(event.target);
      if (!workspaceId) {
        clearDropTarget();
        return;
      }
      if (!setDropTarget(workspaceId)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    }

    function onDropCapture(event) {
      if (!dragState) return;
      const state = dragState;
      // 只信 drop 事件实际命中的工作区。targetId 只用于高亮，不能用于落点，
      // 否则“先悬停 B、再滑到 A/空白处、最后松手”会错误迁移到 B。
      const workspaceId = resolveWorkspaceIdFromTarget(event.target);
      const sameWorkspace = Boolean(workspaceId) && workspaceId === state.currentWorkspaceId;
      finishDrag();
      if (!workspaceId) return;
      event.preventDefault();
      event.stopPropagation();
      swallowClickUntil = Date.now() + 400;
      if (sameWorkspace) {
        toast("该会话已在这个工作区", "info");
        return;
      }
      moveToWorkspace(state.sessionId, state.title, workspaceId);
    }

    function onDragEndCapture() {
      if (!dragState) return;
      finishDrag();
    }

    // ---- 通道 2：指针拖拽（空白/归档会话也能拖） ----
    function onPointerDownCapture(event) {
      if (event.button !== 0) return;
      if (event.target && typeof event.target.closest === "function") {
        if (event.target.closest('button, input, textarea, select, [role="button"]')) return;
      }
      const row = event.target && typeof event.target.closest === "function" ? event.target.closest(SESSION_ROW_SELECTOR) : null;
      if (!row) return;
      if (row.getAttribute("draggable") === "true") return; // 交给通道 1
      const sessionId = rowKeyValue(row, SESSION_PREFIX);
      if (!sessionId) return;
      const titleNode = row.querySelector('[class*="title"]');
      pointerDrag = {
        sessionId,
        title: (titleNode && titleNode.textContent ? titleNode.textContent : "").trim(),
        startX: event.clientX,
        startY: event.clientY,
        active: false,
      };
    }

    function flushPointerHighlight() {
      pointerScheduled = false;
      if (pointerRaf) {
        cancelAnimationFrame(pointerRaf);
        pointerRaf = 0;
      }
      if (pointerTimer) {
        clearTimeout(pointerTimer);
        pointerTimer = 0;
      }
      if (!pointerDrag || !pointerDrag.active || !lastPointer) return;
      const under = document.elementFromPoint(lastPointer.x, lastPointer.y);
      const workspaceId = resolveWorkspaceIdFromTarget(under);
      if (workspaceId) setDropTarget(workspaceId);
    }

    function schedulePointerHighlight() {
      if (pointerScheduled) return;
      pointerScheduled = true;
      pointerRaf = requestAnimationFrame(flushPointerHighlight);
      // 后台标签页 / 无头环境里 rAF 可能长时间不触发，补一个定时器保证状态最终一致
      pointerTimer = setTimeout(flushPointerHighlight, 32);
    }

    function onPointerMoveCapture(event) {
      if (!pointerDrag) return;
      if (!pointerDrag.active) {
        const dx = event.clientX - pointerDrag.startX;
        const dy = event.clientY - pointerDrag.startY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
        pointerDrag.active = true;
        beginDrag(pointerDrag.sessionId, pointerDrag.title);
      }
      if (event.cancelable) event.preventDefault();
      lastPointer = { x: event.clientX, y: event.clientY };
      // 合帧：pointermove 每秒可达上百次，elementFromPoint 会强制布局，必须节流
      schedulePointerHighlight();
    }

    function onPointerUpCapture(event) {
      if (!pointerDrag) return;
      const state = pointerDrag;
      pointerDrag = null;
      if (!state.active) return; // 没超过阈值：普通点击，原样放行
      const under = document.elementFromPoint(event.clientX, event.clientY);
      // 与 onDropCapture 同理：松手位置必须实际落在可接收的工作区行上。
      const workspaceId = resolveWorkspaceIdFromTarget(under);
      const currentId = dragState ? dragState.currentWorkspaceId : null;
      finishDrag();
      swallowClickUntil = Date.now() + 400;
      if (!workspaceId) return;
      if (workspaceId === currentId) {
        toast("该会话已在这个工作区", "info");
        return;
      }
      moveToWorkspace(state.sessionId, state.title, workspaceId);
    }

    function onPointerCancelCapture() {
      if (!pointerDrag) return;
      pointerDrag = null;
      finishDrag();
    }

    /** 拖拽成功落点后，吞掉紧随其后的那次 click（否则会顺带打开会话）。 */
    function onClickCaptureGuard(event) {
      if (Date.now() > swallowClickUntil) return;
      swallowClickUntil = 0;
      // 只吞会话行上的点击——拖拽落点在工作区行，拖拽后的合法点击（点工作区行、工具栏等）不应被吞
      const row = event.target && typeof event.target.closest === "function" ? event.target.closest(SESSION_ROW_SELECTOR) : null;
      if (!row) return;
      event.stopPropagation();
      event.preventDefault();
    }

    /** 从侧边栏行兜底读标题：优先用调用方给的，其次用 DOM 里用户看到的那行文字。 */
    function rowTitleOf(sessionId) {
      try {
        const row = document.querySelector(`[data-row-key="session:${sessionId}"]`);
        if (!row) return "";
        const node = row.querySelector('[class*="title"]') || row.querySelector("span");
        return node && node.textContent ? node.textContent.trim() : "";
      } catch {
        return "";
      }
    }

    async function runMove(sessionId, displayTitle) {
      if (!sessionId) return;
      const result = await openMove({ sessionId, sessionTitle: (displayTitle || "").trim() || rowTitleOf(sessionId) });
      if (!result) return;
      if (result.noop) {
        toast(result.message || "该会话已在此工作区", "info");
        return;
      }
      const extra = result.movedChildren ? `（含 ${result.movedChildren} 个子会话）` : "";
      toast(`已移至【${result.targetWorkspaceTitle}】${extra}`, "success");
      workspaceMetaCache.delete(sessionId);
      afterMoveSession(sessionId, result.wasLive);
    }

    async function runDelete(sessionId, displayTitle) {
      if (!sessionId) return;
      let info = null;
      try {
        const data = await getJson(`/api/dsh-migra-clean/info?sessionId=${encodeURIComponent(sessionId)}`);
        if (data && data.ok) info = data;
      } catch {}

      const meta = [];
      if (info) {
        meta.push(formatBytes(info.bytes));
        if (info.updatedAt) meta.push(`最后活动 ${formatTime(info.updatedAt)}`);
        meta.push(info.running ? "正在生成" : info.live ? "会话已打开" : "未打开");
        if (!info.persisted) meta.push("尚未落盘");
      }

      const title = displayTitle || (info && info.title) || "该会话";
      const confirmed = await openConfirm({
        title: "彻底删除会话",
        description: `“${title}”的聊天记录、索引与缓存将被物理抹除，无法恢复。\n项目工作区里生成的文件不会被改动。`,
        meta,
        confirmLabel: "彻底删除",
        danger: true,
        onConfirm: async () => {
          const data = await postJson("/api/dsh-migra-clean", { sessionId });
          if (!data || data.ok === false) throw new Error((data && data.error) || "删除失败");
        },
      });
      if (!confirmed) return;
      toast("会话已彻底删除", "success");
      switchToSafeSession(sessionId);
    }

    // 删除的正是当前选中会话（或它的子树）时，切到一个安全位置，避免停在已消失的页面
    function switchToSafeSession(deletedSessionId) {
      try {
        const isCurrent = currentMainDescendsFrom(deletedSessionId);
        const selected = document.querySelector(
          `[data-row-key="session:${deletedSessionId}"][aria-selected="true"]`
        );
        const inUrl = (window.location.href || "").includes(deletedSessionId);
        if (!isCurrent && !selected && !inUrl) return;

        // 优先通过 uiWorkspace 清除当前主视图，释放对已删除会话的引用
        const ui = activeCtx && typeof activeCtx.get === "function" ? activeCtx.get("uiWorkspace", false) : null;
        if (ui && typeof ui.clearMain === "function") {
          ui.clearMain();
        }

        const newSessionBtn = document.querySelector(
          'button[aria-label*="新会话"], button[aria-label*="New session"], [data-action="new-session"]'
        );
        if (newSessionBtn && typeof newSessionBtn.click === "function") {
          newSessionBtn.click();
          return;
        }
        const otherRow = document.querySelector(
          `[data-row-key^="session:"]:not([data-row-key="session:${deletedSessionId}"])`
        );
        if (otherRow && typeof otherRow.click === "function") otherRow.click();
      } catch {}
    }

    // ------------------------------------------------------------------
    // 插槽条目
    // ------------------------------------------------------------------

    function makeMenuItem({ id, order, label, icon, tone, action }) {
      const Component = (props) => {
        const { sessionId, displayTitle, useMenuOpenState } = props || {};
        const useMenuOpen = typeof useMenuOpenState === "function" ? useMenuOpenState : () => [false, () => {}];
        const menuOpen = useMenuOpen();
        const setMenuOpen = Array.isArray(menuOpen) ? menuOpen[1] : null;
        return h(
          "button",
          {
            type: "button",
            role: "menuitem",
            className: "dsh-migra-clean-menuitem",
            "data-tone": tone || undefined,
            onClick: (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (typeof setMenuOpen === "function") setMenuOpen(false);
              action(sessionId, displayTitle);
            },
          },
          h(Icon, { name: icon }),
          h("span", null, label)
        );
      };
      return { id, order, Component };
    }

    function HeaderMoveButton(props) {
      const sessionId = props && props.sessionId;
      if (!sessionId) return null;
      return h(
        "button",
        {
          type: "button",
          className: "dsh-migra-clean-header-btn",
          title: "移动此会话到其他工作区",
          "aria-label": "移动此会话到其他工作区",
          onClick: () => runMove(sessionId, ""),
        },
        h(Icon, { name: "folder", size: 12 }),
        h("span", null, "移动")
      );
    }

    // ------------------------------------------------------------------
    // 挂载
    // ------------------------------------------------------------------

    exports.apply = function (ctx) {
      activeCtx = ctx;
      ctx.effect(() => {
        const removeStyles = injectStyles();
        return () => {
          removeStyles();
          listeners.clear();
          state = EMPTY_STATE;
          if (activeCtx === ctx) activeCtx = null;
        };
      }, "dsh-migra-clean: overlay");

      ctx.effect(() => {
        const onBlur = () => {
          if (dragState || pointerDrag) finishDrag();
        };
        window.addEventListener("blur", onBlur);
        document.addEventListener("dragstart", onDragStartCapture, true);
        document.addEventListener("dragover", onDragOverCapture, true);
        document.addEventListener("drop", onDropCapture, true);
        document.addEventListener("dragend", onDragEndCapture, true);
        document.addEventListener("pointerdown", onPointerDownCapture, true);
        document.addEventListener("pointermove", onPointerMoveCapture, true);
        document.addEventListener("pointerup", onPointerUpCapture, true);
        document.addEventListener("pointercancel", onPointerCancelCapture, true);
        document.addEventListener("click", onClickCaptureGuard, true);
        return () => {
          window.removeEventListener("blur", onBlur);
          document.removeEventListener("dragstart", onDragStartCapture, true);
          document.removeEventListener("dragover", onDragOverCapture, true);
          document.removeEventListener("drop", onDropCapture, true);
          document.removeEventListener("dragend", onDragEndCapture, true);
          document.removeEventListener("pointerdown", onPointerDownCapture, true);
          document.removeEventListener("pointermove", onPointerMoveCapture, true);
          document.removeEventListener("pointerup", onPointerUpCapture, true);
          document.removeEventListener("pointercancel", onPointerCancelCapture, true);
          document.removeEventListener("click", onClickCaptureGuard, true);
          dragState = null;
          pointerDrag = null;
          clearDragMarks();
        };
      }, "dsh-migra-clean: drag-to-workspace");

      ctx.effect(() => {
        const onContextMenu = (event) => {
          let target = event.target;
          let row = target && typeof target.closest === "function" ? target.closest('[data-row-key^="session:"]') : null;
          // 若气泡提示（HoverCard/Tooltip）等浮层正好处在鼠标指针下方，穿透浮层命中底下的会话行
          if (!row && typeof document.elementsFromPoint === "function") {
            const elements = document.elementsFromPoint(event.clientX, event.clientY);
            for (const el of elements) {
              const candidate = el && typeof el.closest === "function" ? el.closest('[data-row-key^="session:"]') : null;
              if (candidate) {
                row = candidate;
                break;
              }
            }
          }
          if (!row) return;
          const rowKey = row.getAttribute("data-row-key") || "";
          if (!rowKey.startsWith("session:")) return;
          const sessionId = rowKey.slice("session:".length);
          if (!sessionId) return;
          event.preventDefault();
          event.stopPropagation();
          const titleNode = row.querySelector('[class*="title"]');
          const title = (titleNode && titleNode.textContent ? titleNode.textContent : "").trim();
          publish({ menu: { id: ++menuSeed, x: event.clientX, y: event.clientY, sessionId, title } });
        };
        document.addEventListener("contextmenu", onContextMenu, true);
        return () => document.removeEventListener("contextmenu", onContextMenu, true);
      }, "dsh-migra-clean: contextmenu");

      const slots = ctx.slots;
      if (!slots || typeof slots.inject !== "function" || typeof slots.register !== "function") {
        console.warn("[dsh-migra-clean] slots 服务不可用，跳过 UI 注册");
        return;
      }

      try {
        slots.inject("shell.overlay", () =>
          slots.register({ name: "shell.overlay", id: "dsh-migra-clean-overlay", order: 200 }, OverlayHost)
        );
      } catch (err) {
        console.warn("[dsh-migra-clean] 注册浮层失败:", err);
      }

      const moveItem = makeMenuItem({
        id: "dsh-migra-clean-move-item",
        order: 998,
        label: "移动到工作区…",
        icon: "folder",
        action: (sessionId, displayTitle) => runMove(sessionId, displayTitle),
      });
      const deleteItem = makeMenuItem({
        id: "dsh-migra-clean-session-item",
        order: 999,
        label: "删除会话",
        icon: "trash",
        tone: "danger",
        action: (sessionId, displayTitle) => runDelete(sessionId, displayTitle),
      });

      for (const item of [moveItem, deleteItem]) {
        try {
          slots.inject("sidebar.workspaces.session.menu.item", () =>
            slots.register({ name: "sidebar.workspaces.session.menu.item", id: item.id, order: item.order }, item.Component)
          );
        } catch (err) {
          console.warn(`[dsh-migra-clean] 注册菜单项 ${item.id} 失败:`, err);
        }
      }

      try {
        slots.inject("conversation.session.header.actions", () =>
          slots.register(
            { name: "conversation.session.header.actions", id: "dsh-migra-clean-header-move-btn", order: 850 },
            HeaderMoveButton
          )
        );
      } catch (err) {
        console.warn("[dsh-migra-clean] 注册会话头部按钮失败:", err);
      }
    };

    } catch (err) {
      try {
        console.error("[dsh-migra-clean] 客户端模块初始化失败（插件已降级为空壳，不影响启动）", err);
      } catch {}
      exports.apply = function () {};
    }

    return module.exports;
  },
});
