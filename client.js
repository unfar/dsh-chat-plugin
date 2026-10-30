/**
 * dsh-chat-plugin — 浏览器端（client.js）。
 *
 * 一个自包含的 IM 式聊天面板，同时挂到三个位置：
 *   1. sidebar.panellist  — 左侧栏「dsh Chat」面板图标（keyed by id: chat）
 *   2. main               — 点击左侧栏后打开的整页聊天（keyed panel: chat）
 *   3. settings.section   — 设置里同样可找到「dsh Chat」
 *
 * 所有数据都来自 Host 的 HTTP API（/dsh-chat-plugin/api），不依赖任何注入的
 * slot props；因此面板在主界面和设置里行为一致。
 *
 * Plain JavaScript, no JSX, no imports — 用 React.createElement 构建元素。
 */

window.__ModuleLoader__.load({
  id: "dsh-chat-plugin",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require("react");
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback } = React;

    // ── 常量 ──────────────────────────────────────────────────────────────
    const API_BASE = "/dsh-chat-plugin/api";
    const POLL_INTERVAL_MS = 1500;
    const MAX_TEXT_LENGTH = 800;
    const MAX_WINDOW = 200;
    const NEAR_BOTTOM_PX = 80;

    // ── 文案（Simplified Chinese；集中在这里，方便以后接 i18n）─────────────
    const STRINGS = {
      title: "dsh Chat",
      subtitle: "dsh 之间的信使，人与 agent 都能收发消息",
      statusOnline: "已连接",
      statusConnecting: "连接中…",
      statusError: "连接失败",
      statusOff: "未连接",
      encrypted: "🔒 端到端加密",
      plain: "🔓 明文",
      settings: "设置",
      settingsTitle: "房间设置",
      room: "房间",
      roomName: "房间名",
      roomPlaceholder: "lobby",
      peers: "成员",
      online: "在线",
      offline: "离线",
      lastSeen: "最后出现",
      you: "我",
      noPeers: "还没有发现其他人",
      empty: "还没有消息，发送第一条吧",
      placeholder: "输入消息，Enter 发送，Shift+Enter 换行",
      placeholderShort: "输入消息…",
      send: "发送",
      sending: "发送中…",
      sendingFailed: "发送失败",
      jumpToBottom: "回到底部",
      loading: "连接中…",
      retrying: "正在重试…",
      unreachable: "无法连接 Host 端",
      hostMissing:
        "Host 端未加载：请确认 dsh-chat-plugin 插件已在当前 profile 中启用（会自动重试）。",
      offlineTitle: "无法连接 Host 端",
      offlineHint: "插件启用后会自动恢复；也可以点右上角设置检查房间配置。",
      hostMissingSend: "Host 端未加载，消息未发送。",
      hostMissingSave: "Host 端未加载，设置未保存。",
      relayError: "中继连接异常",
      nickname: "昵称",
      nicknameHint: "留空则使用主机名",
      passphrase: "房间口令（可选，设置后端到端加密）",
      passphraseSet: "已设置，留空保持不变",
      passphraseEmpty: "未设置，留空保持不变",
      clearPassphrase: "清除已保存的口令",
      relayKind: "中继类型",
      relayNtfy: "公共 ntfy.sh（零部署）",
      relayCustom: "自建中继（relay.mjs）",
      relayUrl: "中继地址",
      relayUrlPlaceholder: "https://ntfy.sh",
      save: "保存并重连",
      saving: "保存中…",
      saved: "已保存并重连",
      saveFailed: "保存失败",
      collapse: "收起",
      lobbyHint:
        "公共大厅：房间名和口令相同的 dsh 会进入同一个房间，建议设置口令。",
      agentAutoReply: "启用 agent 自动回复（@chat 触发）",
      agentAutoReplyHint:
        "开启后，房间里有人发「@chat …」时，本机会用一个后台 agent 会话自动回复；默认关闭。",
      agentOn: "自动回复",
      agentBusy: "agent 正在回复…",
      today: "今天",
      yesterday: "昨天",
      anonymous: "匿名",
      messagesAria: "聊天消息",
      composerAria: "消息输入框",
      invite: "邀请",
      inviteTitle: "邀请对方加入",
      inviteHint:
        "把这段邀请码发给对方，让对方粘贴到「加入房间」里即可。邀请码包含房间口令，只发给信得过的人。",
      inviteCopy: "复制邀请码",
      inviteCopied: "已复制",
      inviteClose: "关闭",
      inviteLoading: "生成邀请码…",
      joinTitle: "加入别人的房间",
      joinPlaceholder: "粘贴邀请码，例如 dshchat1:…",
      joinButton: "加入",
      joining: "加入中…",
      joinFailed: "加入失败",
      onboardingTitle: "开始和另一台 dsh 聊天",
      onboardingText:
        "你们需要先进入同一个房间：把邀请码发给对方，或粘贴对方发来的邀请码。",
      onboardingOr: "或者",
      typing: "正在输入…",
      friends: "好友",
      friendsTitle: "好友与发现",
      discover: "发现",
      discoverHint: "开启后会出现在公共发现目录，装了插件的人可以搜到你并发起连接。",
      discoverOff: "未出现在公共目录",
      discoverToggle: "出现在公共发现目录（别人可找到我）",
      discoverSearch: "搜索昵称或 ID…",
      discoverEmpty: "暂时没发现其他人。让对方也打开「发现」，或直接发邀请码。",
      contacts: "通讯录",
      contactsEmpty: "还没有联系人。去「发现」里找一个人，或粘贴邀请码加入房间。",
      connect: "连接",
      connecting: "连接中…",
      joinRoom: "切换",
      remove: "删除",
      accept: "接受",
      dismiss: "忽略",
      requestTitle: "连接请求",
      requestBody: " 想和你聊天",
      selfTag: "我",
      findFriends: "发现好友",
      onlineNow: "在线",
      lastSeenShort: "最近",
      newChat: "新建群聊",
      newChatTitle: "创建一个群聊",
      newChatHint: "创建后会生成随机房间名和口令，用邀请码把朋友拉进来。",
      chatName: "群聊名称",
      chatNamePlaceholder: "例如：项目协作",
      create: "创建",
      creating: "创建中…",
      currentChat: "当前会话",
      rename: "保存名称",
      leaveChat: "退出当前会话",
      leaveConfirm: "确定退出这个会话？聊天记录仍保留在本机。",
      unreadDot: "未读",
      notifications: "桌面通知",
      notificationsHint: "页面在后台时收到新消息，弹系统通知（需浏览器授权）。",
      notificationsDenied: "通知权限被拒绝",
      notificationsEnabled: "通知已开启",
    };

    /** 取中文文案；未知 key 原样返回，永不抛错。 */
    const t = (key) => (Object.prototype.hasOwnProperty.call(STRINGS, key) ? STRINGS[key] : String(key));

    // ── 小工具（纯函数，无 hooks）────────────────────────────────────────
    function safeArray(value) {
      return Array.isArray(value) ? value : [];
    }

    function pad2(value) {
      return value < 10 ? "0" + value : String(value);
    }

    function lastMessageSeq(messages) {
      const list = safeArray(messages);
      for (let index = list.length - 1; index >= 0; index -= 1) {
        const seq = Number(list[index] && list[index].seq);
        if (Number.isFinite(seq) && seq > 0) return seq;
      }
      return 0;
    }

    function ymdOf(date) {
      return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
    }

    /** HH:MM（本地时区）；无效时间返回空串。 */
    function formatTime(value) {
      const date = new Date(Number(value));
      if (Number.isNaN(date.getTime())) return "";
      return pad2(date.getHours()) + ":" + pad2(date.getMinutes());
    }

    /** 气泡 hover 用的完整时间。 */
    function fullTimeTitle(value) {
      const date = new Date(Number(value));
      if (Number.isNaN(date.getTime())) return "";
      try {
        return date.toLocaleString("zh-CN", { hour12: false });
      } catch (error) {
        return "";
      }
    }

    /** 日期分隔标签：今天 / 昨天 / M月D日 / Y年M月D日。 */
    function dayLabel(value) {
      const date = new Date(Number(value));
      if (Number.isNaN(date.getTime())) return "";
      const now = new Date();
      const target = ymdOf(date);
      if (target === ymdOf(now)) return t("today");
      const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      if (target === ymdOf(yesterday)) return t("yesterday");
      if (date.getFullYear() === now.getFullYear()) {
        return date.getMonth() + 1 + "月" + date.getDate() + "日";
      }
      return date.getFullYear() + "年" + (date.getMonth() + 1) + "月" + date.getDate() + "日";
    }

    /** 由 peer id 稳定映射到一个头像颜色（两种主题下都够醒目）。 */
    function avatarColor(seed) {
      const text = String(seed == null ? "" : seed);
      let hash = 0;
      for (let index = 0; index < text.length; index += 1) {
        hash = (hash * 31 + text.charCodeAt(index)) % 360000;
      }
      return "hsl(" + (hash % 360) + ", 58%, 42%)";
    }

    /** 昵称首字（对 emoji / 中文都安全）。 */
    function initialsOf(nick) {
      const text = String(nick == null ? "" : nick).trim();
      if (!text) return "?";
      const first = Array.from(text)[0];
      return first ? first.toUpperCase() : "?";
    }

    function shortId(value) {
      return String(value == null ? "" : value).slice(0, 6);
    }

    // ── HTTP API ─────────────────────────────────────────────────────────
    /**
     * 统一请求：返回已解析 JSON；错误带上 code 供 UI 分类：
     *   network | missing（404，Host 半未加载）| http | parse | api
     */
    async function request(path, options) {
      let response;
      try {
        response = await fetch(API_BASE + path, options || {});
      } catch (error) {
        if (error && error.name === "AbortError") throw error;
        const networkError = new Error(t("unreachable"));
        networkError.code = "network";
        throw networkError;
      }

      let data = null;
      try {
        data = await response.json();
      } catch (error) {
        data = null;
      }

      if (response.status === 404) {
        const missingError = new Error((data && data.error) || "Host 端未加载");
        missingError.code = "missing";
        throw missingError;
      }
      if (!response.ok) {
        const httpError = new Error((data && data.error) || "请求失败（HTTP " + response.status + "）");
        httpError.code = "http";
        throw httpError;
      }
      if (!data || typeof data !== "object") {
        const parseError = new Error("Host 端返回了无法解析的数据");
        parseError.code = "parse";
        throw parseError;
      }
      if (data.ok === false) {
        const apiError = new Error(data.error || "请求失败");
        apiError.code = "api";
        throw apiError;
      }
      return data;
    }

    /** 把 Host 快照收敛成 UI 可安全渲染的形状（数组缺失/类型错误都不崩）。 */
    function normalizeSnapshot(raw) {
      if (!raw || typeof raw !== "object") return null;
      const messages = safeArray(raw.messages).filter(
        (message) => message && typeof message === "object",
      );
      const peers = safeArray(raw.peers).filter((peer) => peer && typeof peer === "object");
      const me = raw.me && typeof raw.me === "object" ? raw.me : {};
      const relay = raw.relay && typeof raw.relay === "object" ? raw.relay : {};
      const settings = raw.settings && typeof raw.settings === "object" ? raw.settings : null;
      const latestSeq =
        typeof raw.latestSeq === "number" && Number.isFinite(raw.latestSeq)
          ? raw.latestSeq
          : lastMessageSeq(messages);
      return {
        me: {
          id: String(me.id == null ? "" : me.id),
          nick: String(me.nick == null ? "" : me.nick),
        },
        room: typeof raw.room === "string" ? raw.room : "",
        relay: {
          kind: relay.kind === "custom" ? "custom" : "ntfy",
          url: typeof relay.url === "string" ? relay.url : "",
          encrypted: relay.encrypted === true,
        },
        connected: raw.connected === true,
        lastError:
          typeof raw.lastError === "string" && raw.lastError.length > 0 ? raw.lastError : null,
        peers,
        messages,
        latestSeq,
        unread: Number(raw.unread) || 0,
        agentUnread: Number(raw.agentUnread) || 0,
        lastReadSeq: Number(raw.lastReadSeq) || 0,
        typing: safeArray(raw.typing).filter((peer) => peer && typeof peer === "object"),
        agent:
          raw.agent && typeof raw.agent === "object"
            ? {
                autoReply: raw.agent.autoReply === true,
                busy: raw.agent.busy === true,
                lastError:
                  typeof raw.agent.lastError === "string" && raw.agent.lastError
                    ? raw.agent.lastError
                    : null,
                replies: Number(raw.agent.replies) || 0,
              }
            : { autoReply: false, busy: false, lastError: null, replies: 0 },
        settings,
      };
    }

    /** 设置表单草稿：优先用 Host 的 settings，缺失时从快照推导。 */
    function formFromSnapshot(snapshot) {
      const settings = (snapshot && snapshot.settings) || {};
      const relay = (snapshot && snapshot.relay) || {};
      const me = (snapshot && snapshot.me) || {};
      return {
        nickname:
          typeof settings.nickname === "string"
            ? settings.nickname
            : String(me.nick == null ? "" : me.nick),
        room:
          typeof settings.room === "string" && settings.room
            ? settings.room
            : String((snapshot && snapshot.room) || "lobby"),
        passphrase: "",
        clearPassphrase: false,
        passphraseSet: settings.passphraseSet === true || relay.encrypted === true,
        relayKind:
          settings.relayKind === "custom" || relay.kind === "custom" ? "custom" : "ntfy",
        relayUrl:
          typeof settings.relayUrl === "string" && settings.relayUrl
            ? settings.relayUrl
            : String(relay.url || ""),
        agentAutoReply: settings.agentAutoReply === true,
      };
    }

    /** 只把用户真正改过的值发给 Host；省略的字段保持当前配置。 */
    function buildConfigPayload(form) {
      const payload = {};
      payload.nickname = typeof form.nickname === "string" ? form.nickname.trim() : "";
      const room = typeof form.room === "string" ? form.room.trim() : "";
      if (room) payload.room = room;
      if (form.clearPassphrase === true) {
        payload.passphrase = "";
      } else if (typeof form.passphrase === "string" && form.passphrase.length > 0) {
        payload.passphrase = form.passphrase;
      }
      payload.relayKind = form.relayKind === "custom" ? "custom" : "ntfy";
      const relayUrl = typeof form.relayUrl === "string" ? form.relayUrl.trim() : "";
      if (relayUrl) payload.relayUrl = relayUrl;
      payload.agentAutoReply = form.agentAutoReply === true;
      return payload;
    }

    /** 乐观地把刚发送的消息并入本地窗口（随后 refresh 会用服务端快照覆盖）。 */
    function appendMessage(snapshot, message) {
      if (!snapshot || !message || typeof message !== "object") return snapshot;
      const current = safeArray(snapshot.messages).filter(
        (item) =>
          item &&
          !(message.id != null && item.id === message.id) &&
          !(message.seq != null && item.seq === message.seq),
      );
      const next = current.concat([message]);
      next.sort((left, right) => (Number(left.seq) || 0) - (Number(right.seq) || 0));
      const windowed = next.length > MAX_WINDOW ? next.slice(next.length - MAX_WINDOW) : next;
      const seq = Number(message.seq);
      return {
        ...snapshot,
        messages: windowed,
        latestSeq: Math.max(Number(snapshot.latestSeq) || 0, Number.isFinite(seq) ? seq : 0),
      };
    }

    // ── 样式 ──────────────────────────────────────────────────────────────
    const CSS = `

.dchat-root {
  --dchat-bg: var(--dsw-alias-bg-base, #ffffff);
  --dchat-layer-1: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.06));
  --dchat-layer-2: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.12));
  --dchat-overlay: var(--dsw-alias-bg-overlay, #ffffff);
  --dchat-border-l1: var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.16));
  --dchat-border-l2: var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.3));
  --dchat-brand: var(--dsw-alias-brand-primary, #3b6ef5);
  --dchat-brand-fg: var(--dsw-alias-bg-base, #ffffff);
  --dchat-label: var(--dsw-alias-label-primary, currentColor);
  --dchat-label-2: var(--dsw-alias-label-secondary, rgba(127, 127, 127, 0.95));
  --dchat-ok: var(--dsw-alias-state-success-primary, #2ea043);
  --dchat-err: var(--dsw-alias-state-error-primary, #d1242f);
  --dchat-warn: var(--dsw-alias-state-warn-primary, #bf8700);
  --dchat-hover: rgba(127, 127, 127, 0.12);
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  color: var(--dchat-label);
  background: var(--dchat-bg);
  font-size: 13px;
  line-height: 1.45;
  overflow: hidden;
}

/* ── Telegram 式双栏骨架 ─────────────────────────────────────────── */
.dchat-layout {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
}
.dchat-side {
  width: 268px;
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--dchat-border-l1);
  background: var(--dchat-layer-1);
}
.dchat-in-settings .dchat-side {
  display: none;
}
.dchat-side-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--dchat-border-l1);
}
.dchat-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--dchat-brand);
  flex: none;
}
.dchat-side-title {
  flex: 1 1 auto;
  font-size: 14px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.dchat-side-search {
  padding: 8px 10px 6px;
}
.dchat-side-search .dchat-input {
  width: 100%;
  box-sizing: border-box;
  height: 32px;
  border-radius: 10px;
  background: var(--dchat-layer-2);
  border: 1px solid transparent;
  padding: 0 10px;
}
.dchat-side-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 6px 8px;
}
.dchat-side-empty {
  padding: 18px 10px;
  font-size: 11.5px;
  color: var(--dchat-label-2);
  text-align: center;
}
.dchat-chat-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.dchat-chat-row:hover {
  background: var(--dchat-hover);
}
.dchat-chat-row.active {
  background: color-mix(in srgb, var(--dchat-brand) 14%, transparent);
}
.dchat-chat-avatar {
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.dchat-chat-avatar.is-room {
  background: var(--dchat-layer-2);
  color: var(--dchat-label-2);
}
.dchat-chat-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.dchat-chat-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dchat-chat-preview {
  font-size: 11.5px;
  color: var(--dchat-label-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dchat-chat-time {
  flex: none;
  font-size: 10.5px;
  color: var(--dchat-label-2);
}
.dchat-side-actions {
  display: flex;
  gap: 6px;
}
.dchat-side-actions .dchat-discover-btn:last-child {
  width: 34px;
  flex: none;
  font-size: 15px;
  line-height: 1;
}
.dchat-side-actions .dchat-discover-btn:first-child {
  flex: 1 1 auto;
}
.dchat-chat-avatar.is-group {
  background: color-mix(in srgb, var(--dchat-brand) 18%, transparent);
  color: var(--dchat-brand);
  font-size: 15px;
  font-weight: 500;
}
.dchat-chat-meta {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
}
.dchat-chat-unread {
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  box-sizing: border-box;
  border-radius: 9px;
  background: var(--dchat-brand);
  color: var(--dchat-brand-fg);
  font-size: 10px;
  line-height: 17px;
  font-weight: 600;
  text-align: center;
}
.dchat-ticks {
  font-size: 9.5px;
  color: var(--dchat-label-2);
}
.dchat-ticks.read {
  color: var(--dchat-brand);
}
.dchat-settings-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.dchat-settings-row .dchat-input {
  flex: 1 1 auto;
  min-width: 0;
}
.dchat-side-foot {
  border-top: 1px solid var(--dchat-border-l1);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dchat-discover-btn {
  width: 100%;
  height: 32px;
  border: 1px solid var(--dchat-border-l2);
  border-radius: 10px;
  background: transparent;
  color: var(--dchat-label);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dchat-discover-btn:hover {
  background: var(--dchat-hover);
}
.dchat-side-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--dchat-label-2);
}
.dchat-main {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* ── 顶部：头像 + 名称 + 在线状态 ────────────────────────────────── */
.dchat-main-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--dchat-border-l1);
  background: var(--dchat-bg);
}
.dchat-head-avatar {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
}
.dchat-head-text {
  flex: 1 1 auto;
  min-width: 0;
}
.dchat-head-name {
  font-size: 14px;
  font-weight: 650;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dchat-head-agent {
  font-size: 11px;
  opacity: 0.8;
}
.dchat-head-sub {
  font-size: 11.5px;
  color: var(--dchat-label-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dchat-head-tools {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}
.dchat-icon-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--dchat-label-2);
  cursor: pointer;
}
.dchat-icon-btn:hover {
  background: var(--dchat-hover);
  color: var(--dchat-label);
}
.dchat-icon-btn[aria-expanded="true"] {
  color: var(--dchat-brand);
}
.dchat-icon-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  box-sizing: border-box;
  border-radius: 8px;
  background: var(--dchat-err);
  color: #fff;
  font-size: 9px;
  line-height: 15px;
  font-weight: 600;
  text-align: center;
  box-shadow: 0 0 0 2px var(--dchat-bg);
}
.dchat-icon-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* ── 成员条（群聊时显示） ─────────────────────────────────────── */
.dchat-peers {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--dchat-border-l1);
  overflow-x: auto;
  scrollbar-width: none;
}
.dchat-peers::-webkit-scrollbar {
  display: none;
}
.dchat-peer {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  font-size: 11.5px;
  color: var(--dchat-label-2);
}
.dchat-peer-nick {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dchat-peer-state {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dchat-border-l2);
}
.dchat-peer-state.online {
  background: var(--dchat-ok);
}
.dchat-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 9.5px;
  font-weight: 600;
  flex: none;
}
.dchat-me {
  margin-left: auto;
  flex: none;
  font-size: 11px;
  color: var(--dchat-label-2);
}
.dchat-peers-empty {
  font-size: 11.5px;
  color: var(--dchat-label-2);
}
.dchat-agent-badge {
  flex: none;
  font-size: 10.5px;
  padding: 1px 8px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--dchat-brand) 14%, transparent);
  border: 1px solid var(--dchat-border-l1);
  color: var(--dchat-label-2);
  white-space: nowrap;
}

/* ── 消息区 ──────────────────────────────────────────────────── */
.dchat-body {
  flex: 1 1 auto;
  position: relative;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.dchat-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  scroll-behavior: smooth;
}
.dchat-list::-webkit-scrollbar {
  width: 8px;
}
.dchat-list::-webkit-scrollbar-thumb {
  background: var(--dchat-border-l2);
  border-radius: 8px;
}
.dchat-day {
  align-self: center;
  margin: 8px 0 10px;
  padding: 3px 10px;
  border-radius: 12px;
  background: var(--dchat-layer-2);
  font-size: 10.5px;
  color: var(--dchat-label-2);
}
.dchat-row {
  display: flex;
  min-width: 0;
  margin: 1px 0;
}
.dchat-row.theirs {
  justify-content: flex-start;
}
.dchat-row.mine {
  justify-content: flex-end;
}
.dchat-stack {
  display: flex;
  flex-direction: column;
  max-width: min(74%, 560px);
}
.dchat-row.mine .dchat-stack {
  align-items: flex-end;
}
.dchat-meta-nick {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 0 0 2px 2px;
}
.dchat-meta-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.dchat-nick {
  font-size: 11px;
  font-weight: 600;
  color: var(--dchat-label-2);
}
.dchat-bubble {
  padding: 7px 11px 6px;
  border-radius: 14px;
  font-size: 13px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--dchat-layer-2);
  color: var(--dchat-label);
  width: fit-content;
}
.dchat-row.theirs .dchat-bubble {
  border-bottom-left-radius: 5px;
}
.dchat-row.mine .dchat-bubble {
  background: var(--dchat-brand);
  color: var(--dchat-brand-fg);
  border-bottom-right-radius: 5px;
}
.dchat-row.grouped .dchat-bubble {
  border-top-left-radius: 14px;
}
.dchat-row.theirs.grouped .dchat-bubble {
  border-top-left-radius: 6px;
}
.dchat-row.mine.grouped .dchat-bubble {
  border-top-right-radius: 6px;
}
.dchat-time {
  font-size: 10px;
  color: var(--dchat-label-2);
  opacity: 0.75;
  margin: 2px 4px 0;
}
.dchat-row.mine .dchat-time {
  text-align: right;
}
.dchat-jump {
  position: absolute;
  right: 16px;
  bottom: 10px;
  border: 1px solid var(--dchat-border-l2);
  background: var(--dchat-overlay);
  color: var(--dchat-label);
  border-radius: 14px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
}

/* ── 输入区 ──────────────────────────────────────────────────── */
.dchat-composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 14px 12px;
  border-top: 1px solid var(--dchat-border-l1);
  background: var(--dchat-bg);
}
.dchat-input {
  font-family: inherit;
  color: var(--dchat-label);
  background: var(--dchat-layer-1);
  border: 1px solid var(--dchat-border-l1);
  border-radius: 18px;
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.4;
  outline: none;
}
.dchat-input:focus {
  border-color: color-mix(in srgb, var(--dchat-brand) 60%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dchat-brand) 14%, transparent);
}
.dchat-input::placeholder {
  color: var(--dchat-label-2);
}
.dchat-composer textarea.dchat-input {
  flex: 1 1 auto;
  box-sizing: border-box;
  height: 36px;
  min-height: 36px;
  max-height: 132px;
  resize: none;
  overflow-y: auto;
  border-radius: 18px;
}
.dchat-logo svg {
  flex: none;
}
.dchat-send {
  flex: none;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background: var(--dchat-brand);
  color: var(--dchat-brand-fg);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}
.dchat-send:disabled {
  opacity: 0.45;
  cursor: default;
}
.dchat-send svg {
  margin: 0 auto;
}
.dchat-send-text {
  font-size: 15px;
  line-height: 1;
}
.dchat-send-error {
  padding: 0 16px 6px;
  font-size: 11.5px;
  color: var(--dchat-err);
}

/* ── 状态 / 横幅 ─────────────────────────────────────────────── */
.dchat-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dchat-border-l2);
}
.dchat-dot.on {
  background: var(--dchat-ok);
}
.dchat-dot.wait {
  background: var(--dchat-warn);
}
.dchat-dot.err {
  background: var(--dchat-err);
}
.dchat-dot.off {
  background: var(--dchat-border-l2);
}
.dchat-banner {
  margin: 6px 14px 0;
  padding: 6px 10px;
  border: 1px solid var(--dchat-border-l1);
  border-radius: 9px;
  font-size: 11.5px;
  color: var(--dchat-label-2);
  background: var(--dchat-layer-1);
}
.dchat-request {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 14px 0;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--dchat-brand) 30%, var(--dchat-border-l1));
  border-radius: 10px;
  background: color-mix(in srgb, var(--dchat-brand) 8%, transparent);
}
.dchat-request-text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dchat-request-actions {
  display: flex;
  gap: 6px;
  flex: none;
}
.dchat-typing {
  color: var(--dchat-brand);
}

/* ── 通用按钮 ───────────────────────────────────────────────── */
.dchat-btn {
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 9px;
  background: var(--dchat-brand);
  color: var(--dchat-brand-fg);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.dchat-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.dchat-btn.ghost {
  background: transparent;
  border: 1px solid var(--dchat-border-l2);
  color: var(--dchat-label);
}
.dchat-small-btn {
  flex: none;
  height: 26px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: var(--dchat-brand);
  color: var(--dchat-brand-fg);
  font-family: inherit;
  font-size: 11.5px;
  cursor: pointer;
}
.dchat-small-btn.ghost {
  background: transparent;
  border-color: var(--dchat-border-l2);
  color: var(--dchat-label-2);
}
.dchat-small-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

/* ── 设置面板 ───────────────────────────────────────────────── */
.dchat-settings {
  margin: 6px 14px 0;
  border: 1px solid var(--dchat-border-l1);
  border-radius: 12px;
  background: var(--dchat-layer-1);
  padding: 12px;
}
.dchat-settings-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.dchat-settings-title {
  font-size: 13px;
  font-weight: 650;
}
.dchat-settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px 12px;
}
.dchat-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11.5px;
  color: var(--dchat-label-2);
}
.dchat-field-full {
  grid-column: 1 / -1;
}
.dchat-field .dchat-input {
  border-radius: 9px;
  padding: 7px 10px;
  font-size: 12.5px;
}
.dchat-check {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--dchat-label);
}
.dchat-check input {
  accent-color: var(--dchat-brand);
}
.dchat-hint {
  font-size: 11px;
  color: var(--dchat-label-2);
  padding: 2px 0 0;
}
.dchat-hint-inline {
  margin: 2px 0 0 22px;
}
.dchat-settings-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}
.dchat-notice {
  font-size: 11.5px;
}
.dchat-notice.ok {
  color: var(--dchat-ok);
}
.dchat-notice.err {
  color: var(--dchat-err);
}

/* ── 空态 / 离线 / 加载 ─────────────────────────────────────── */
.dchat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin: auto;
  padding: 32px 16px;
  color: var(--dchat-label-2);
  font-size: 12.5px;
  text-align: center;
}
.dchat-empty-title {
  font-size: 14px;
  font-weight: 650;
  color: var(--dchat-label);
}
.dchat-empty-hint {
  font-size: 11.5px;
  max-width: 320px;
}
.dchat-empty-hint-sm {
  font-size: 11px;
  opacity: 0.75;
}
.dchat-empty-actions {
  display: flex;
  gap: 8px;
}
.dchat-empty-or {
  font-size: 11px;
  opacity: 0.65;
}
.dchat-empty-error {
  font-size: 11.5px;
  color: var(--dchat-err);
}
.dchat-join {
  display: flex;
  gap: 8px;
  width: 100%;
  max-width: 380px;
}
.dchat-join .dchat-input {
  flex: 1 1 auto;
  min-width: 0;
  border-radius: 10px;
}
.dchat-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 1 1 auto;
  color: var(--dchat-label-2);
  font-size: 12px;
}
.dchat-spinner {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--dchat-border-l2);
  border-top-color: var(--dchat-brand);
  animation: dchat-spin 0.8s linear infinite;
}
@keyframes dchat-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── 弹层：邀请 / 发现 ─────────────────────────────────────── */
.dchat-invite,
.dchat-friends {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.35);
}
.dchat-friends {
  justify-content: center;
}
.dchat-invite-card,
.dchat-friends-card {
  width: min(460px, 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--dchat-border-l2);
  border-radius: 14px;
  background: var(--dchat-overlay);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.3);
  overflow-y: auto;
}
.dchat-friends-card {
  width: min(420px, 100%);
}
.dchat-invite-head,
.dchat-friends-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.dchat-invite-title {
  font-size: 13px;
  font-weight: 650;
}
.dchat-invite-code {
  width: 100%;
  box-sizing: border-box;
  border-radius: 9px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 1.5;
  word-break: break-all;
  resize: none;
  padding: 9px 10px;
}
.dchat-invite-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.dchat-invite-error {
  font-size: 11.5px;
  color: var(--dchat-err);
}
.dchat-friends-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}
.dchat-friends-title {
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--dchat-label-2);
  opacity: 0.8;
}
.dchat-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  cursor: pointer;
}
.dchat-toggle input {
  accent-color: var(--dchat-brand);
}
.dchat-search {
  width: 100%;
  box-sizing: border-box;
  border-radius: 10px;
  padding: 7px 10px;
}
.dchat-dir-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border-radius: 9px;
}
.dchat-dir-row:hover {
  background: var(--dchat-hover);
}
.dchat-dir-info {
  flex: 1 1 auto;
  min-width: 0;
}
.dchat-dir-nick {
  font-size: 12.5px;
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dchat-dir-id {
  font-size: 10.5px;
  opacity: 0.55;
}
.dchat-dir-meta {
  font-size: 10.5px;
  opacity: 0.65;
}

/* ── 窄屏 ───────────────────────────────────────────────────── */
@media (max-width: 620px) {
  .dchat-side {
    width: 200px;
  }
  .dchat-side-search,
  .dchat-side-foot {
    display: none;
  }
}

`;

    // ── 图标（内联 SVG，不依赖任何 icon 包）──────────────────────────────
    function PanelIcon(props) {
      const ownerProps = props || {};
      const requestedSize = Number(ownerProps.size);
      const size = Number.isFinite(requestedSize) && requestedSize > 0 ? requestedSize : 18;
      const active = ownerProps.active === true;
      const color = active ? "var(--dsw-alias-brand-primary, #3b6ef5)" : "currentColor";
      // 侧边栏图标自己做一份轻量未读轮询（5s），面板打开时会立刻清零。
      const [unread, setUnread] = useState(0);
      useEffect(() => {
        let alive = true;
        let timer = null;
        const tick = async () => {
          try {
            const data = await request("/state", {
              method: "GET",
              headers: { accept: "application/json" },
              cache: "no-store",
            });
            if (alive && data) setUnread(Number(data.unread) || 0);
          } catch (error) {
            /* Host 半没装/未就绪时保持静默 */
          }
        };
        tick();
        timer = setInterval(tick, 5000);
        return () => {
          alive = false;
          if (timer) clearInterval(timer);
        };
      }, []);
      return h(
        "span",
        { className: "dchat-icon-wrap", style: { position: "relative", display: "inline-flex" } },
        h(
          "svg",
          {
            viewBox: "0 0 24 24",
            width: size,
            height: size,
            fill: "none",
            stroke: color,
            strokeWidth: 1.7,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            "aria-hidden": "true",
            focusable: "false",
            style: { display: "block", flex: "none", color: color },
          },
          h("rect", { key: "back", x: 13, y: 3.4, width: 7.4, height: 6.2, rx: 2.1 }),
          h("rect", { key: "front", x: 3.6, y: 8.8, width: 10.6, height: 7.6, rx: 2.4 }),
          h("path", { key: "tail", d: "M7.4 16.4v3.2l3.3-3.2" }),
        ),
        unread > 0
          ? h(
              "span",
              {
                className: "dchat-icon-badge",
                "aria-label": unread + " 条未读消息",
                title: unread + " 条未读消息",
              },
              unread > 99 ? "99+" : String(unread),
            )
          : null,
      );
    }

    const SEND_ICON = h(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: 16,
        height: 16,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.9,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
        focusable: "false",
        style: { display: "block" },
      },
      h("path", { key: "up", d: "M12 19V5" }),
      h("path", { key: "arrow", d: "M6 11l6-6 6 6" }),
    );

    const PEOPLE_ICON = h(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: 16,
        height: 16,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.6,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
        focusable: "false",
        style: { display: "block" },
      },
      h("circle", { key: "a", cx: 9, cy: 8, r: 3.1 }),
      h("path", { key: "b", d: "M3.5 19c.6-3.4 2.9-5.2 5.5-5.2s4.9 1.8 5.5 5.2" }),
      h("path", { key: "c", d: "M15.6 5.2a2.9 2.9 0 0 1 0 5.6" }),
      h("path", { key: "d", d: "M17.2 14.3c2 .7 3.2 2.3 3.6 4.7" }),
    );

    /** 面板内的品牌小图标（带 unread 角标的 PanelIcon 只给侧边栏 slot 用）。 */
    function BrandMark(props) {
      const size = Number(props && props.size) || 18;
      return h(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: size,
          height: size,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.7,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
          focusable: "false",
          style: { display: "block" },
        },
        h("rect", { key: "back", x: 13, y: 3.4, width: 7.4, height: 6.2, rx: 2.1 }),
        h("rect", { key: "front", x: 3.6, y: 8.8, width: 10.6, height: 7.6, rx: 2.4 }),
        h("path", { key: "tail", d: "M7.4 16.4v3.2l3.3-3.2" }),
      );
    }

    const INVITE_ICON = h(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: 16,
        height: 16,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.6,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
        focusable: "false",
        style: { display: "block" },
      },
      h("circle", { key: "a", cx: 9, cy: 8, r: 3 }),
      h("circle", { key: "b", cx: 17, cy: 10, r: 2.4 }),
      h("path", { key: "c", d: "M3.5 19c.6-3.2 2.9-5 5.5-5s4.9 1.8 5.5 5" }),
      h("path", { key: "d", d: "M15.5 14.6c2-.4 3.8.8 4.3 3.4" }),
    );

    const SETTINGS_ICON = h(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: 16,
        height: 16,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.6,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
        focusable: "false",
        style: { display: "block" },
      },
      h("circle", { key: "hub", cx: 12, cy: 12, r: 3 }),
      h("path", {
        key: "cog",
        d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
      }),
    );

    const COLLAPSE_ICON = h(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: 16,
        height: 16,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
        focusable: "false",
        style: { display: "block" },
      },
      h("path", { key: "chevron", d: "M6 14.5l6-6 6 6" }),
    );

    // ── 子组件 ────────────────────────────────────────────────────────────
    /** 单条消息：别人的在左侧带头像点 + 昵称，自己的在右侧。 */
    function MessageRow(props) {
      const message = props.message || {};
      const mine = props.mine === true;
      const grouped = props.grouped === true;
      const showTime = props.showTime !== false;
      const text = message.text == null ? "" : String(message.text);
      const nick = String(message.nick || shortId(message.from) || t("anonymous"));
      const color = avatarColor(message.from == null ? nick : message.from);
      return h(
        "div",
        { className: "dchat-row " + (mine ? "mine" : "theirs") + (grouped ? " grouped" : "") },
        h(
          "div",
          { className: "dchat-stack" },
          mine || grouped
            ? null
            : h(
                "div",
                { className: "dchat-meta-nick" },
                h("span", {
                  className: "dchat-meta-dot",
                  style: { background: color },
                  "aria-hidden": "true",
                }),
                h("span", { className: "dchat-nick" }, nick),
              ),
          h("div", { className: "dchat-bubble", title: fullTimeTitle(message.ts) }, text),
          showTime
            ? h(
                "div",
                { className: "dchat-time" },
                formatTime(message.ts),
                mine
                  ? h(
                      "span",
                      { className: "dchat-ticks" + (props.readByPeer === true ? " read" : "") },
                      props.readByPeer === true ? " ✓✓" : " ✓",
                    )
                  : null,
              )
            : null,
        ),
      );
    }

    /** 空消息列表的占位。 */
    function ChatEmpty(props) {
      const options = props || {};
      return h(
        "div",
        { className: "dchat-empty" },
        h(
          "svg",
          {
            width: 40,
            height: 40,
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.3,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            "aria-hidden": "true",
            focusable: "false",
            style: { opacity: 0.55, display: "block" },
          },
          h("rect", { key: "bubble", x: 3, y: 4.5, width: 18, height: 12.5, rx: 3 }),
          h("path", { key: "tail", d: "M8 17v3.4l3.6-3.4" }),
        ),
        h("div", { className: "dchat-empty-title" }, t("onboardingTitle")),
        h("div", { className: "dchat-empty-hint" }, t("onboardingText")),
        h(
          "div",
          { className: "dchat-empty-actions" },
          h(
            "button",
            { type: "button", className: "dchat-btn", onClick: options.onInvite },
            "🔗 " + t("invite"),
          ),
          h(
            "button",
            { type: "button", className: "dchat-btn ghost", onClick: options.onFindFriends },
            "🧭 " + t("findFriends"),
          ),
        ),
        h("div", { className: "dchat-empty-or" }, t("onboardingOr")),
        h(
          "div",
          { className: "dchat-join" },
          h("input", {
            className: "dchat-input",
            type: "text",
            value: options.joinCode || "",
            placeholder: t("joinPlaceholder"),
            "aria-label": t("joinTitle"),
            onChange: (event) => options.onJoinCode && options.onJoinCode(event.target.value),
            onKeyDown: (event) => {
              if (event.key === "Enter" && options.onJoin) options.onJoin();
            },
          }),
          h(
            "button",
            {
              type: "button",
              className: "dchat-btn",
              disabled: options.joining === true || !options.joinCode,
              onClick: options.onJoin,
            },
            options.joining ? t("joining") : t("joinButton"),
          ),
        ),
        options.joinError
          ? h("div", { className: "dchat-empty-error" }, "⚠️ " + options.joinError)
          : null,
        h("div", { className: "dchat-empty-hint dchat-empty-hint-sm" }, t("empty")),
      );
    }

    /** 还没连上 Host 端时的占位（不是错误页，恢复后自动消失）。 */
    function OfflinePlaceholder() {
      return h(
        "div",
        { className: "dchat-empty" },
        h(
          "svg",
          {
            width: 40,
            height: 40,
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.3,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            "aria-hidden": "true",
            focusable: "false",
            style: { opacity: 0.55, display: "block" },
          },
          h("rect", { key: "bubble", x: 3, y: 4.5, width: 18, height: 12.5, rx: 3 }),
          h("path", { key: "tail", d: "M8 17v3.4l3.6-3.4" }),
          h("path", { key: "slash", d: "M4 20L20 4" }),
        ),
        h("div", null, t("offlineTitle")),
        h("div", { className: "dchat-empty-hint" }, t("offlineHint")),
      );
    }

    /** 连接状态文案与颜色。 */
    function statusOf(snapshot, hostMissing, loadError) {
      if (hostMissing) return { className: "off", text: t("statusOff") };
      if (!snapshot) {
        if (loadError) return { className: "err", text: t("statusError") };
        return { className: "wait", text: t("statusConnecting") };
      }
      if (snapshot.connected === true) return { className: "on", text: t("statusOnline") };
      if (snapshot.lastError) return { className: "err", text: t("statusError") };
      return { className: "off", text: t("statusOff") };
    }

    // ── 主面板 ────────────────────────────────────────────────────────────
    /**
     * 自包含聊天面板。
     * 在 settings.section 里渲染时 Host 会额外传 `close`，据此加一点卡片外观；
     * 其余 slot props 一律忽略（所有数据都从 API 拉）。
     */
    function ChatPanel(props) {
      const inSettings = Boolean(props && typeof props.close === "function");

      const [snapshot, setSnapshot] = useState(null);
      const [loadError, setLoadError] = useState("");
      const [hostMissing, setHostMissing] = useState(false);
      const [draft, setDraft] = useState("");
      const [sending, setSending] = useState(false);
      const [sendError, setSendError] = useState("");
      const [settingsOpen, setSettingsOpen] = useState(false);
      const [form, setForm] = useState(null);
      const [saving, setSaving] = useState(false);
      const [saveNotice, setSaveNotice] = useState(null);
      const [showJump, setShowJump] = useState(false);
      const [inviteOpen, setInviteOpen] = useState(false);
      const [invite, setInvite] = useState("");
      const [inviteLoading, setInviteLoading] = useState(false);
      const [inviteError, setInviteError] = useState("");
      const [copied, setCopied] = useState(false);
      const [joinCode, setJoinCode] = useState("");
      const [joining, setJoining] = useState(false);
      const [joinError, setJoinError] = useState("");
      const [friendsOpen, setFriendsOpen] = useState(false);
      const [social, setSocial] = useState(null);
      const [socialError, setSocialError] = useState("");
      const [discoverQuery, setDiscoverQuery] = useState("");
      const [connectingId, setConnectingId] = useState("");
      const [socialBusy, setSocialBusy] = useState("");
      const [chats, setChats] = useState(null);
      const [createOpen, setCreateOpen] = useState(false);
      const [newChatTitle, setNewChatTitle] = useState("");
      const [chatTitleDraft, setChatTitleDraft] = useState("");
      const [notifyEnabled, setNotifyEnabled] = useState(false);
      const [notifyError, setNotifyError] = useState("");

      const mountedRef = useRef(true);
      const pollingRef = useRef(false);
      const pollAbortRef = useRef(null);
      const sendingRef = useRef(false);
      const savingRef = useRef(false);
      const listRef = useRef(null);
      const textareaRef = useRef(null);
      const nearBottomRef = useRef(true);
      const didScrollRef = useRef(false);
      const lastSeqRef = useRef(0);
      const lastReadSentRef = useRef(0);
      const typingSentRef = useRef(0);
      const lastNotifiedSeqRef = useRef(0);
      const notifyEnabledRef = useRef(false);
      const forceScrollRef = useRef(false);
      const toastTimerRef = useRef(null);

      const messages = snapshot ? safeArray(snapshot.messages) : [];
      const peers = snapshot ? safeArray(snapshot.peers) : [];
      const me = snapshot ? snapshot.me : null;
      const relay = snapshot ? snapshot.relay : null;
      const peersOnline = peers.filter((peer) => peer && peer.online === true).length;
      const latestSeq =
        snapshot && typeof snapshot.latestSeq === "number"
          ? snapshot.latestSeq
          : lastMessageSeq(messages);

      /** 拉一次 /state；上一轮未结束时直接跳过。 */
      const refresh = useCallback(async () => {
        if (pollingRef.current) return;
        pollingRef.current = true;
        const controller = new AbortController();
        pollAbortRef.current = controller;
        try {
          const data = await request("/state", {
            method: "GET",
            headers: { accept: "application/json" },
            cache: "no-store",
            signal: controller.signal,
          });
          if (!mountedRef.current) return;
          const next = normalizeSnapshot(data);
          if (next) {
            // 面板可见 = 用户正在看，把人的已读游标推到最新（侧边栏角标随之清空）。
            // 页面在后台时不算已读，留角标提醒。
            const visible = typeof document === "undefined" || document.visibilityState !== "hidden";
            if (visible && next.latestSeq > lastReadSentRef.current) {
              const seq = next.latestSeq;
              lastReadSentRef.current = seq;
              next.unread = 0;
              next.lastReadSeq = Math.max(Number(next.lastReadSeq) || 0, seq);
              void request("/read", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ seq }),
              }).catch(() => {
                /* 标记失败不打断聊天 */
              });
            }
            setSnapshot(next);
          }
          setHostMissing(false);
          setLoadError("");
        } catch (error) {
          if (error && error.name === "AbortError") return;
          if (!mountedRef.current) return;
          if (error && error.code === "missing") {
            setHostMissing(true);
            setLoadError("");
          } else {
            setLoadError(error && error.message ? error.message : t("unreachable"));
          }
        } finally {
          pollingRef.current = false;
          if (pollAbortRef.current === controller) pollAbortRef.current = null;
        }
      }, []);

      // 首次加载 + 1.5s 轮询；卸载时清掉定时器和未完成的请求。
      useEffect(() => {
        mountedRef.current = true;
        refresh();
        const timer = setInterval(refresh, POLL_INTERVAL_MS);
        return () => {
          mountedRef.current = false;
          clearInterval(timer);
          const controller = pollAbortRef.current;
          pollAbortRef.current = null;
          if (controller) {
            try {
              controller.abort();
            } catch (error) {
              /* 忽略 */
            }
          }
        };
      }, [refresh]);

      // 好友/发现状态：面板打开时高频刷新，平时低频刷新（用于未读请求角标）。
      const loadChats = useCallback(async () => {
        try {
          const data = await request("/chats", { method: "GET", headers: { accept: "application/json" }, cache: "no-store" });
          if (!mountedRef.current) return;
          setChats(data && Array.isArray(data.chats) ? data.chats : []);
          if (data && data.currentRoom) {
            setSnapshot((previous) => (previous ? previous : previous));
          }
        } catch {
          /* 老版本 Host 没有 /chats 时静默降级 */
        }
      }, []);

      const loadSocial = useCallback(async () => {
        try {
          const data = await request("/social", { method: "GET", headers: { accept: "application/json" }, cache: "no-store" });
          if (!mountedRef.current) return;
          setSocial(data || null);
          setSocialError("");
        } catch (error) {
          if (mountedRef.current) setSocialError(error && error.message ? error.message : t("unreachable"));
        }
      }, []);

      useEffect(() => {
        mountedRef.current = true;
        void loadSocial();
        void loadChats();
        const timer = setInterval(() => {
          void loadSocial();
          void loadChats();
        }, friendsOpen ? 5000 : 10000);
        return () => clearInterval(timer);
      }, [loadSocial, loadChats, friendsOpen]);

      // toast 定时器清理。
      useEffect(
        () => () => {
          if (toastTimerRef.current) {
            clearTimeout(toastTimerRef.current);
            toastTimerRef.current = null;
          }
        },
        [],
      );

      // 新消息到达：仅在用户本来就在底部时自动滚动；否则显示「回到底部」。
      useEffect(() => {
        const element = listRef.current;
        if (!element) return;
        const previous = lastSeqRef.current;
        const firstLoad = !didScrollRef.current;
        const roomReset = latestSeq < previous;
        const changed = latestSeq !== previous;
        const forced = forceScrollRef.current;
        forceScrollRef.current = false;

        if (firstLoad || roomReset || forced) {
          didScrollRef.current = true;
          lastSeqRef.current = latestSeq;
          element.scrollTop = element.scrollHeight;
          nearBottomRef.current = true;
          setShowJump(false);
          return;
        }
        if (!changed) return;
        lastSeqRef.current = latestSeq;
        if (nearBottomRef.current) {
          try {
            element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
          } catch (error) {
            element.scrollTop = element.scrollHeight;
          }
          setShowJump(false);
        } else {
          setShowJump(true);
        }
      }, [latestSeq]);

      // 输入框随内容增高（上限 132px）。
      useEffect(() => {
        const element = textareaRef.current;
        if (!element) return;
        element.style.height = "auto";
        const next = Math.max(38, Math.min(element.scrollHeight, 132));
        element.style.height = next + "px";
      }, [draft]);

      const notify = useCallback((notice) => {
        setSaveNotice(notice);
        if (toastTimerRef.current) {
          clearTimeout(toastTimerRef.current);
          toastTimerRef.current = null;
        }
        if (notice && notice.kind === "ok") {
          toastTimerRef.current = setTimeout(() => {
            toastTimerRef.current = null;
            if (mountedRef.current) setSaveNotice(null);
          }, 3500);
        }
      }, []);

      const handleScroll = useCallback(() => {
        const element = listRef.current;
        if (!element) return;
        const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
        const near = distance < NEAR_BOTTOM_PX;
        nearBottomRef.current = near;
        if (near) setShowJump(false);
      }, []);

      const jumpToBottom = useCallback(() => {
        const element = listRef.current;
        if (element) {
          try {
            element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
          } catch (error) {
            element.scrollTop = element.scrollHeight;
          }
        }
        nearBottomRef.current = true;
        setShowJump(false);
      }, []);

      const toggleSettings = useCallback(() => {
        const next = !settingsOpen;
        setSettingsOpen(next);
        setSaveNotice(null);
        if (next) {
          setForm(formFromSnapshot(snapshot));
          const active = (chats || []).find((chat) => chat.active);
          setChatTitleDraft(active ? active.title : (snapshot && snapshot.room) || "");
        }
      }, [settingsOpen, snapshot, chats]);

      const updateForm = useCallback(
        (patch) => {
          setForm((previous) => {
            const base = previous || formFromSnapshot(snapshot);
            return Object.assign({}, base, patch);
          });
          if (saveNotice) setSaveNotice(null);
        },
        [snapshot, saveNotice],
      );

      const handleDraftChange = useCallback(
        (event) => {
          const value = event.target.value;
          setDraft(value);
          if (sendError) setSendError("");
          const now = Date.now();
          if (value.trim() && now - typingSentRef.current > 2500) {
            typingSentRef.current = now;
            void request("/typing", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            }).catch(() => {
              /* 输入状态失败无所谓 */
            });
          }
        },
        [sendError],
      );

      /** 打开邀请面板：按需拉取当前房间的邀请码。 */
      const openInvite = useCallback(async () => {
        setInviteOpen(true);
        setCopied(false);
        setInviteError("");
        if (invite) return;
        setInviteLoading(true);
        try {
          const data = await request("/invite", {
            method: "GET",
            headers: { accept: "application/json" },
            cache: "no-store",
          });
          if (mountedRef.current) setInvite(data && data.code ? String(data.code) : "");
        } catch (error) {
          if (mountedRef.current) {
            setInviteError(error && error.message ? error.message : t("unreachable"));
          }
        } finally {
          if (mountedRef.current) setInviteLoading(false);
        }
      }, [invite]);

      const copyInvite = useCallback(async () => {
        if (!invite) return;
        try {
          if (
            typeof navigator !== "undefined" &&
            navigator.clipboard &&
            typeof navigator.clipboard.writeText === "function"
          ) {
            await navigator.clipboard.writeText(invite);
          } else if (typeof document !== "undefined") {
            const area = document.createElement("textarea");
            area.value = invite;
            area.style.position = "fixed";
            area.style.opacity = "0";
            document.body.appendChild(area);
            area.select();
            try {
              document.execCommand("copy");
            } finally {
              area.remove();
            }
          }
          setCopied(true);
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          toastTimerRef.current = setTimeout(() => {
            toastTimerRef.current = null;
            if (mountedRef.current) setCopied(false);
          }, 2500);
        } catch (error) {
          setInviteError(error && error.message ? error.message : t("joinFailed"));
        }
      }, [invite]);

      /** 粘贴邀请码加入房间：切房间/口令/中继，成功立即刷新。 */
      const joinByCode = useCallback(async () => {
        const code = joinCode.trim();
        if (!code || joining) return;
        setJoining(true);
        setJoinError("");
        try {
          const data = await request("/join", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ code }),
          });
          if (!mountedRef.current) return;
          setJoinCode("");
          forceScrollRef.current = true;
          if (data && data.state) {
            const next = normalizeSnapshot(data.state);
            if (next) setSnapshot(next);
          }
          void refresh();
        } catch (error) {
          if (mountedRef.current) {
            setJoinError(error && error.message ? error.message : t("joinFailed"));
          }
        } finally {
          if (mountedRef.current) setJoining(false);
        }
      }, [joinCode, joining, refresh]);

      /** 社交动作：统一 POST 后刷新 social + 聊天状态。 */
      const socialAction = useCallback(
        async (path, body) => {
          setSocialBusy(path);
          setSocialError("");
          try {
            const data = await request(path, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body || {}),
            });
            if (!mountedRef.current) return;
            if (data && data.state) {
              const next = normalizeSnapshot(data.state);
              if (next) setSnapshot(next);
            }
            forceScrollRef.current = true;
            await loadSocial();
            void refresh();
          } catch (error) {
            if (mountedRef.current) {
              setSocialError(error && error.message ? error.message : t("unreachable"));
            }
          } finally {
            if (mountedRef.current) setSocialBusy("");
          }
        },
        [loadSocial, refresh],
      );

      const toggleDiscoverable = useCallback(async () => {
        const enabled = !(social && social.discoverable === true);
        await socialAction("/social/discoverable", { enabled });
      }, [social, socialAction]);

      const connectTo = useCallback(
        async (id) => {
          if (!id || connectingId) return;
          setConnectingId(id);
          try {
            await socialAction("/social/connect", { id });
            setFriendsOpen(false);
          } finally {
            if (mountedRef.current) setConnectingId("");
          }
        },
        [connectingId, socialAction],
      );

      const acceptRequest = useCallback(async (id) => { await socialAction("/social/accept", { id }); }, [socialAction]);
      const dismissRequest = useCallback(async (id) => { await socialAction("/social/dismiss", { id }); }, [socialAction]);
      const joinContact = useCallback(async (id) => { await socialAction("/social/join", { id }); setFriendsOpen(false); }, [socialAction]);
      const removeContact = useCallback(async (id) => { await socialAction("/social/remove", { id }); }, [socialAction]);

      const switchChat = useCallback(
        async (id) => {
          if (!id) return;
          await socialAction("/chats/switch", { id });
        },
        [socialAction],
      );

      const createChat = useCallback(async () => {
        const title = newChatTitle.trim();
        setSocialBusy("create");
        try {
          const data = await request("/chats/create", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: title || t("newChat") }),
          });
          if (!mountedRef.current) return;
          if (data && data.state) {
            const next = normalizeSnapshot(data.state);
            if (next) setSnapshot(next);
          }
          if (data && Array.isArray(data.chats)) setChats(data.chats);
          setCreateOpen(false);
          setNewChatTitle("");
          forceScrollRef.current = true;
          void loadChats();
          void refresh();
        } catch (error) {
          if (mountedRef.current) setSocialError(error && error.message ? error.message : t("unreachable"));
        } finally {
          if (mountedRef.current) setSocialBusy("");
        }
      }, [newChatTitle, loadChats, refresh]);

      const currentChat = chats && Array.isArray(chats) ? chats.find((chat) => chat.active) : null;

      const renameCurrentChat = useCallback(async () => {
        if (!currentChat) return;
        await socialAction("/chats/rename", { id: currentChat.id, title: chatTitleDraft });
        void loadChats();
      }, [currentChat, chatTitleDraft, socialAction, loadChats]);

      const leaveCurrentChat = useCallback(async () => {
        if (!currentChat) return;
        if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(t("leaveConfirm"))) return;
        await socialAction("/chats/leave", { id: currentChat.id });
        void loadChats();
      }, [currentChat, socialAction, loadChats]);

      /** 发送消息：Enter 或按钮触发；失败保留输入并显示服务端错误。 */
      const submit = useCallback(async () => {
        if (sendingRef.current) return;
        const text = draft;
        if (!text || !text.trim()) return;
        sendingRef.current = true;
        setSending(true);
        setSendError("");
        try {
          let data;
          try {
            data = await request("/send", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ text }),
            });
          } catch (error) {
            if (error && error.code === "missing") setHostMissing(true);
            throw error;
          }
          if (!mountedRef.current) return;
          setHostMissing(false);
          setDraft("");
          forceScrollRef.current = true;
          if (data && data.message && typeof data.message === "object") {
            setSnapshot((previous) => appendMessage(previous, data.message));
          }
          if (textareaRef.current) textareaRef.current.focus();
          void refresh();
        } catch (error) {
          if (!mountedRef.current) return;
          const missing = error && error.code === "missing";
          const message = missing
            ? t("hostMissingSend")
            : error && error.message
              ? error.message
              : t("sendingFailed");
          setSendError(message);
        } finally {
          sendingRef.current = false;
          if (mountedRef.current) setSending(false);
        }
      }, [draft, refresh]);

      const handleKeyDown = useCallback(
        (event) => {
          if (event.key !== "Enter" || event.shiftKey) return;
          if (event.nativeEvent && event.nativeEvent.isComposing) return;
          if (event.keyCode === 229) return;
          event.preventDefault();
          void submit();
        },
        [submit],
      );

      /** 保存设置并重连：成功后立刻用返回的快照刷新。 */
      const saveConfig = useCallback(async () => {
        if (!form || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        setSaveNotice(null);
        try {
          const payload = buildConfigPayload(form);
          let data;
          try {
            data = await request("/config", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            });
          } catch (error) {
            if (error && error.code === "missing") setHostMissing(true);
            throw error;
          }
          if (!mountedRef.current) return;
          setHostMissing(false);
          const next = data && data.state ? normalizeSnapshot(data.state) : null;
          if (next) {
            setSnapshot(next);
            setForm(formFromSnapshot(next));
          }
          forceScrollRef.current = true;
          notify({ kind: "ok", text: t("saved") });
          void refresh();
        } catch (error) {
          if (!mountedRef.current) return;
          const missing = error && error.code === "missing";
          notify({
            kind: "err",
            text: missing
              ? t("hostMissingSave")
              : error && error.message
                ? error.message
                : t("saveFailed"),
          });
        } finally {
          savingRef.current = false;
          if (mountedRef.current) setSaving(false);
        }
      }, [form, notify, refresh]);

      // ── 渲染片段 ────────────────────────────────────────────────────────
      const status = statusOf(snapshot, hostMissing, loadError);
      // 桌面通知开关（浏览器授权；只在页面后台时弹）。
      useEffect(() => {
        if (typeof window === "undefined") return;
        try {
          const stored = window.localStorage && window.localStorage.getItem("dshchat.notify");
          if (stored === "1" && typeof Notification !== "undefined" && Notification.permission === "granted") {
            setNotifyEnabled(true);
            notifyEnabledRef.current = true;
          }
        } catch {
          /* ignore */
        }
      }, []);

      const toggleNotify = useCallback(async () => {
        if (typeof Notification === "undefined") {
          setNotifyError(t("notificationsDenied"));
          return;
        }
        if (notifyEnabled) {
          setNotifyEnabled(false);
          notifyEnabledRef.current = false;
          try {
            window.localStorage.setItem("dshchat.notify", "0");
          } catch {
            /* ignore */
          }
          return;
        }
        try {
          const permission = Notification.permission === "granted"
            ? "granted"
            : await Notification.requestPermission();
          if (permission !== "granted") {
            setNotifyError(t("notificationsDenied"));
            return;
          }
          setNotifyEnabled(true);
          notifyEnabledRef.current = true;
          setNotifyError("");
          window.localStorage.setItem("dshchat.notify", "1");
        } catch (error) {
          setNotifyError(error && error.message ? error.message : t("notificationsDenied"));
        }
      }, [notifyEnabled]);

      // 新消息 → 后台弹系统通知（只在页面 hidden 时）。
      useEffect(() => {
        if (!snapshot || !notifyEnabledRef.current) return;
        if (typeof document === "undefined" || document.visibilityState !== "hidden") return;
        const latest = Number(snapshot.latestSeq) || 0;
        if (latest <= lastNotifiedSeqRef.current) return;
        lastNotifiedSeqRef.current = latest;
        const last = messages.length > 0 ? messages[messages.length - 1] : null;
        if (!last || last.mine) return;
        try {
          new Notification(t("title"), {
            body: `${last.nick || t("anonymous")}: ${String(last.text || "").slice(0, 80)}`,
            tag: "dsh-chat",
          });
        } catch {
          /* ignore */
        }
      }, [snapshot]);

      const banner = hostMissing
        ? h("div", { className: "dchat-banner" }, "⚠️ " + t("hostMissing"))
        : loadError
          ? h("div", { className: "dchat-banner" }, "⚠️ " + loadError + "，" + t("retrying"))
          : snapshot && !snapshot.connected && snapshot.lastError
            ? h(
                "div",
                { className: "dchat-banner" },
                "⚠️ " + t("relayError") + "：" + snapshot.lastError,
              )
            : snapshot && snapshot.agent && snapshot.agent.lastError
              ? h("div", { className: "dchat-banner" }, "⚠️ " + snapshot.agent.lastError)
              : null;

      const pendingList =
        social && Array.isArray(social.inbox) ? social.inbox : [];
      const requestBanner =
        pendingList.length > 0
          ? h(
              "div",
              { className: "dchat-request" },
              h(
                "div",
                { className: "dchat-request-text" },
                "👋 " +
                  String(pendingList[0].fromNick || t("anonymous")) +
                  t("requestBody"),
              ),
              h(
                "div",
                { className: "dchat-request-actions" },
                h(
                  "button",
                  { type: "button", className: "dchat-small-btn", onClick: () => acceptRequest(pendingList[0].id) },
                  t("accept"),
                ),
                h(
                  "button",
                  { type: "button", className: "dchat-small-btn ghost", onClick: () => dismissRequest(pendingList[0].id) },
                  t("dismiss"),
                ),
              ),
            )
          : null;

      const peerChips = peers.map((peer, index) => {
        const rawId = peer && peer.id != null ? String(peer.id) : "";
        const id = rawId || "peer-" + index;
        const nick = peer && peer.nick ? String(peer.nick) : shortId(rawId) || t("anonymous");
        // 重名成员（多台 dsh 用同一个昵称）由 host 提供 #短id 的 label，避免分不清。
        const label = peer && peer.label ? String(peer.label) : nick;
        const online = peer && peer.online === true;
        const titleText = online
          ? label + " · " + t("online")
          : label +
            (peer && peer.lastSeen
              ? " · " + t("lastSeen") + " " + formatTime(peer.lastSeen)
              : "");
        return h(
          "span",
          { key: "peer-" + id, className: "dchat-peer", title: titleText },
          h(
            "span",
            {
              className: "dchat-avatar",
              style: { background: avatarColor(rawId || nick) },
              "aria-hidden": "true",
            },
            initialsOf(nick),
          ),
          h("span", { className: "dchat-peer-nick" }, label),
          h("span", {
            className: "dchat-peer-state" + (online ? " online" : ""),
            title: online ? t("online") : t("offline"),
          }),
        );
      });

      const peersView = h(
        "div",
        { className: "dchat-peers" },
        peers.length === 0
          ? h("span", { className: "dchat-peers-empty" }, t("noPeers"))
          : peerChips,
        me && me.nick ? h("span", { className: "dchat-me" }, t("you") + " · " + me.nick) : null,
        snapshot && snapshot.agent && snapshot.agent.autoReply
          ? h(
              "span",
              {
                className: "dchat-agent-badge",
                title: t("agentAutoReplyHint"),
              },
              "🤖 " + t("agentOn") + (snapshot.agent.busy ? " · " + t("agentBusy") : ""),
            )
          : null,
      );

      const settingsView =
        settingsOpen && form
          ? h(
              "div",
              { className: "dchat-settings" },
              h(
                "div",
                { className: "dchat-settings-head" },
                h("span", { className: "dchat-settings-title" }, t("settingsTitle")),
                h(
                  "button",
                  {
                    type: "button",
                    className: "dchat-icon-btn",
                    "aria-label": t("collapse"),
                    title: t("collapse"),
                    onClick: toggleSettings,
                    style: { marginLeft: "auto" },
                  },
                  COLLAPSE_ICON,
                ),
              ),
              h(
                "div",
                { className: "dchat-settings-grid" },
                h(
                  "div",
                  { className: "dchat-field dchat-field-full" },
                  h("span", null, t("currentChat")),
                  h(
                    "div",
                    { className: "dchat-settings-row" },
                    h("input", {
                      className: "dchat-input",
                      type: "text",
                      value: chatTitleDraft,
                      placeholder: t("chatNamePlaceholder"),
                      "aria-label": t("currentChat"),
                      onChange: (event) => setChatTitleDraft(event.target.value),
                    }),
                    h(
                      "button",
                      {
                        type: "button",
                        className: "dchat-small-btn",
                        disabled: !currentChat,
                        onClick: renameCurrentChat,
                      },
                      t("rename"),
                    ),
                    h(
                      "button",
                      {
                        type: "button",
                        className: "dchat-small-btn ghost",
                        disabled: !currentChat,
                        onClick: leaveCurrentChat,
                      },
                      t("leaveChat"),
                    ),
                  ),
                ),
                h(
                  "div",
                  { className: "dchat-field dchat-field-full" },
                  h(
                    "label",
                    { className: "dchat-check" },
                    h("input", {
                      type: "checkbox",
                      checked: notifyEnabled,
                      onChange: toggleNotify,
                    }),
                    t("notifications"),
                  ),
                  h("div", { className: "dchat-hint" }, notifyError || t("notificationsHint")),
                ),
                h(
                  "div",
                  { className: "dchat-field" },
                  h("span", null, t("nickname")),
                  h("input", {
                    className: "dchat-input",
                    type: "text",
                    value: form.nickname,
                    placeholder: t("nicknameHint"),
                    "aria-label": t("nickname"),
                    maxLength: 40,
                    onChange: (event) => updateForm({ nickname: event.target.value }),
                  }),
                ),
                h(
                  "div",
                  { className: "dchat-field" },
                  h("span", null, t("roomName")),
                  h("input", {
                    className: "dchat-input",
                    type: "text",
                    value: form.room,
                    placeholder: t("roomPlaceholder"),
                    "aria-label": t("roomName"),
                    maxLength: 64,
                    onChange: (event) => updateForm({ room: event.target.value }),
                  }),
                ),
                h(
                  "div",
                  { className: "dchat-field dchat-field-full" },
                  h("span", null, t("passphrase")),
                  h("input", {
                    className: "dchat-input",
                    type: "password",
                    autoComplete: "new-password",
                    value: form.passphrase,
                    placeholder: form.passphraseSet ? t("passphraseSet") : t("passphraseEmpty"),
                    "aria-label": t("passphrase"),
                    disabled: form.clearPassphrase === true,
                    onChange: (event) =>
                      updateForm({ passphrase: event.target.value, clearPassphrase: false }),
                  }),
                  form.passphraseSet
                    ? h(
                        "label",
                        { className: "dchat-check" },
                        h("input", {
                          type: "checkbox",
                          checked: form.clearPassphrase === true,
                          onChange: (event) =>
                            updateForm({ clearPassphrase: event.target.checked }),
                        }),
                        t("clearPassphrase"),
                      )
                    : null,
                ),
                h(
                  "div",
                  { className: "dchat-field" },
                  h("span", null, t("relayKind")),
                  h(
                    "select",
                    {
                      className: "dchat-select",
                      value: form.relayKind,
                      "aria-label": t("relayKind"),
                      onChange: (event) => updateForm({ relayKind: event.target.value }),
                    },
                    h("option", { value: "ntfy" }, t("relayNtfy")),
                    h("option", { value: "custom" }, t("relayCustom")),
                  ),
                ),
                h(
                  "div",
                  { className: "dchat-field" },
                  h("span", null, t("relayUrl")),
                  h("input", {
                    className: "dchat-input",
                    type: "text",
                    value: form.relayUrl,
                    placeholder: t("relayUrlPlaceholder"),
                    "aria-label": t("relayUrl"),
                    onChange: (event) => updateForm({ relayUrl: event.target.value }),
                  }),
                ),
              ),
                h(
                  "div",
                  { className: "dchat-field dchat-field-full" },
                  h(
                    "label",
                    { className: "dchat-check" },
                    h("input", {
                      type: "checkbox",
                      checked: form.agentAutoReply === true,
                      onChange: (event) => updateForm({ agentAutoReply: event.target.checked }),
                    }),
                    t("agentAutoReply"),
                  ),
                  h("div", { className: "dchat-hint dchat-hint-inline" }, t("agentAutoReplyHint")),
                ),
              h(
                "div",
                { className: "dchat-hint" },
                t("lobbyHint"),
              ),
              h(
                "div",
                { className: "dchat-settings-actions" },
                h(
                  "button",
                  {
                    type: "button",
                    className: "dchat-btn",
                    disabled: saving,
                    onClick: saveConfig,
                  },
                  saving ? t("saving") : t("save"),
                ),
                saveNotice
                  ? h(
                      "span",
                      {
                        className: "dchat-notice " + (saveNotice.kind === "ok" ? "ok" : "err"),
                      },
                      saveNotice.text,
                    )
                  : null,
              ),
            )
          : null;

      // 消息列表 + 日期分隔。
      const messageChildren = [];
      if (snapshot) {
        let lastDay = "";
        messages.forEach((message, index) => {
          if (!message || typeof message !== "object") return;
          const day = dayLabel(message.ts);
          if (day && day !== lastDay) {
            messageChildren.push(
              h("div", { key: "day-" + day + "-" + index, className: "dchat-day" }, day),
            );
            lastDay = day;
          }
          const mine =
            message.mine === true || Boolean(me && me.id && message.from === me.id);
          const seq = message.seq;
          const key =
            seq == null
              ? "msg-i-" + index
              : "msg-s-" + String(seq) + (message.id ? "-" + String(message.id) : "");
          const previous = index > 0 ? messages[index - 1] : null;
          const grouped =
            Boolean(previous) &&
            (previous.mine === true) === (message.mine === true) &&
            String(previous.nick || previous.from || "") === String(message.nick || message.from || "") &&
            new Date(Number(previous.ts) || 0).toDateString() ===
              new Date(Number(message.ts) || 0).toDateString() &&
            Math.abs((Number(message.ts) || 0) - (Number(previous.ts) || 0)) < 5 * 60 * 1000;
          const next = index + 1 < messages.length ? messages[index + 1] : null;
          const nextGrouped =
            Boolean(next) &&
            (next.mine === true) === (message.mine === true) &&
            String(next.nick || next.from || "") === String(message.nick || message.from || "") &&
            new Date(Number(next.ts) || 0).toDateString() ===
              new Date(Number(message.ts) || 0).toDateString() &&
            Math.abs((Number(next.ts) || 0) - (Number(message.ts) || 0)) < 5 * 60 * 1000;
          const readByPeer =
            mine && snapshot && Number(snapshot.peerReadSeq) >= Number(seq) && Number(seq) > 0;
          messageChildren.push(
            h(MessageRow, { key, message, mine, grouped, showTime: !nextGrouped, readByPeer }),
          );
        });
      }

      const bodyView = snapshot
        ? h(
            "div",
            { className: "dchat-body" },
            h(
              "div",
              {
                className: "dchat-list",
                ref: listRef,
                onScroll: handleScroll,
                role: "log",
                "aria-label": t("messagesAria"),
              },
              messages.length === 0
                ? h(ChatEmpty, {
                    onInvite: openInvite,
                    onFindFriends: () => setFriendsOpen(true),
                    joinCode,
                    onJoinCode: setJoinCode,
                    onJoin: joinByCode,
                    joining,
                    joinError,
                  })
                : messageChildren,
            ),
            showJump
              ? h(
                  "button",
                  { type: "button", className: "dchat-jump", onClick: jumpToBottom },
                  "↓ " + t("jumpToBottom"),
                )
              : null,
          )
        : hostMissing || loadError
          ? h(OfflinePlaceholder, null)
          : h(
              "div",
              { className: "dchat-loading" },
              h("span", { className: "dchat-spinner", "aria-hidden": "true" }),
              t("loading"),
            );

      const friendsView = friendsOpen
        ? (() => {
            const directoryList = social && Array.isArray(social.directory) ? social.directory : [];
            const contactsList = social && Array.isArray(social.contacts) ? social.contacts : [];
            const query = discoverQuery.trim().toLowerCase();
            const visibleDirectory = directoryList.filter(
              (peer) =>
                !query ||
                String(peer.nick || "").toLowerCase().includes(query) ||
                String(peer.id || "").toLowerCase().includes(query),
            );
            return h(
              "div",
              { className: "dchat-friends", role: "dialog", "aria-label": t("friendsTitle") },
              h(
                "div",
                { className: "dchat-friends-card" },
                h(
                  "div",
                  { className: "dchat-friends-head" },
                  h("span", { className: "dchat-invite-title" }, t("friendsTitle")),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "dchat-icon-btn",
                      "aria-label": t("inviteClose"),
                      title: t("inviteClose"),
                      onClick: () => setFriendsOpen(false),
                    },
                    COLLAPSE_ICON,
                  ),
                ),
                socialError ? h("div", { className: "dchat-invite-error" }, "⚠️ " + socialError) : null,
                h(
                  "label",
                  { className: "dchat-toggle" },
                  h("input", {
                    type: "checkbox",
                    checked: social ? social.discoverable === true : false,
                    onChange: toggleDiscoverable,
                  }),
                  t("discoverToggle"),
                ),
                h("div", { className: "dchat-hint" }, t("discoverHint")),
                h("input", {
                  className: "dchat-input dchat-search",
                  type: "search",
                  value: discoverQuery,
                  placeholder: t("discoverSearch"),
                  "aria-label": t("discoverSearch"),
                  onChange: (event) => setDiscoverQuery(event.target.value),
                }),
                h(
                  "div",
                  { className: "dchat-friends-section" },
                  h("div", { className: "dchat-friends-title" }, t("discover") + " · " + String(visibleDirectory.length)),
                  visibleDirectory.length === 0
                    ? h("div", { className: "dchat-hint" }, t("discoverEmpty"))
                    : visibleDirectory.map((peer) =>
                        h(
                          "div",
                          { key: "dir-" + peer.id, className: "dchat-dir-row" },
                          h(
                            "span",
                            {
                              className: "dchat-avatar",
                              style: { background: avatarColor(peer.id) },
                              "aria-hidden": "true",
                            },
                            initialsOf(peer.nick),
                          ),
                          h(
                            "div",
                            { className: "dchat-dir-info" },
                            h(
                              "div",
                              { className: "dchat-dir-nick" },
                              String(peer.nick || t("anonymous")),
                              h("span", { className: "dchat-dir-id" }, " · " + String(peer.id || "").slice(0, 6)),
                            ),
                            h("div", { className: "dchat-dir-meta" }, t("lastSeenShort") + " " + formatTime(peer.at)),
                          ),
                          h(
                            "button",
                            {
                              type: "button",
                              className: "dchat-small-btn",
                              disabled: connectingId === peer.id,
                              onClick: () => connectTo(peer.id),
                            },
                            connectingId === peer.id ? t("connecting") : t("connect"),
                          ),
                        ),
                      ),
                ),
                h(
                  "div",
                  { className: "dchat-friends-section" },
                  h("div", { className: "dchat-friends-title" }, t("contacts") + " · " + String(contactsList.length)),
                  contactsList.length === 0
                    ? h("div", { className: "dchat-hint" }, t("contactsEmpty"))
                    : contactsList.map((contact) =>
                        h(
                          "div",
                          { key: "contact-" + contact.id, className: "dchat-dir-row" },
                          h(
                            "span",
                            {
                              className: "dchat-avatar",
                              style: { background: avatarColor(contact.id) },
                              "aria-hidden": "true",
                            },
                            initialsOf(contact.nick),
                          ),
                          h(
                            "div",
                            { className: "dchat-dir-info" },
                            h("div", { className: "dchat-dir-nick" }, String(contact.nick || t("anonymous"))),
                            h("div", { className: "dchat-dir-meta" }, "房间 " + contact.room),
                          ),
                          h(
                            "button",
                            { type: "button", className: "dchat-small-btn", onClick: () => joinContact(contact.id) },
                            t("joinRoom"),
                          ),
                          h(
                            "button",
                            { type: "button", className: "dchat-small-btn ghost", onClick: () => removeContact(contact.id) },
                            t("remove"),
                          ),
                        ),
                      ),
                ),
              ),
            );
          })()
        : null;

      const inviteView = inviteOpen
        ? h(
            "div",
            { className: "dchat-invite", role: "dialog", "aria-label": t("inviteTitle") },
            h(
              "div",
              { className: "dchat-invite-card" },
              h(
                "div",
                { className: "dchat-invite-head" },
                h("span", { className: "dchat-invite-title" }, t("inviteTitle")),
                h(
                  "button",
                  {
                    type: "button",
                    className: "dchat-icon-btn",
                    "aria-label": t("inviteClose"),
                    title: t("inviteClose"),
                    onClick: () => setInviteOpen(false),
                  },
                  COLLAPSE_ICON,
                ),
              ),
              inviteError
                ? h("div", { className: "dchat-invite-error" }, "⚠️ " + inviteError)
                : null,
              inviteLoading
                ? h("div", { className: "dchat-hint" }, t("inviteLoading"))
                : h("textarea", {
                    className: "dchat-input dchat-invite-code",
                    readOnly: true,
                    rows: 3,
                    value: invite,
                    "aria-label": t("inviteTitle"),
                    onFocus: (event) => event.target.select(),
                  }),
              h(
                "div",
                { className: "dchat-invite-actions" },
                h(
                  "button",
                  {
                    type: "button",
                    className: "dchat-btn",
                    disabled: !invite,
                    onClick: copyInvite,
                  },
                  copied ? "✓ " + t("inviteCopied") : t("inviteCopy"),
                ),
                h(
                  "button",
                  {
                    type: "button",
                    className: "dchat-btn ghost",
                    onClick: () => setInviteOpen(false),
                  },
                  t("inviteClose"),
                ),
              ),
              h("div", { className: "dchat-hint" }, t("inviteHint")),
            ),
          )
        : null;

      const createView = createOpen
        ? h(
            "div",
            { className: "dchat-invite", role: "dialog", "aria-label": t("newChatTitle") },
            h(
              "div",
              { className: "dchat-invite-card" },
              h(
                "div",
                { className: "dchat-invite-head" },
                h("span", { className: "dchat-invite-title" }, t("newChatTitle")),
                h(
                  "button",
                  {
                    type: "button",
                    className: "dchat-icon-btn",
                    "aria-label": t("inviteClose"),
                    title: t("inviteClose"),
                    onClick: () => setCreateOpen(false),
                  },
                  COLLAPSE_ICON,
                ),
              ),
              h("input", {
                className: "dchat-input",
                type: "text",
                value: newChatTitle,
                placeholder: t("chatNamePlaceholder"),
                "aria-label": t("chatName"),
                maxLength: 40,
                onChange: (event) => setNewChatTitle(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === "Enter") void createChat();
                },
              }),
              h("div", { className: "dchat-hint" }, t("newChatHint")),
              h(
                "div",
                { className: "dchat-invite-actions" },
                h(
                  "button",
                  { type: "button", className: "dchat-btn ghost", onClick: () => setCreateOpen(false) },
                  t("inviteClose"),
                ),
                h(
                  "button",
                  {
                    type: "button",
                    className: "dchat-btn",
                    disabled: socialBusy === "create",
                    onClick: createChat,
                  },
                  socialBusy === "create" ? t("creating") : t("create"),
                ),
              ),
            ),
          )
        : null;

      const composer = h(
        "div",
        { className: "dchat-composer" },
        h("textarea", {
          ref: textareaRef,
          className: "dchat-input",
          value: draft,
          rows: 1,
          maxLength: MAX_TEXT_LENGTH,
          placeholder: t("placeholderShort"),
          title: t("placeholder"),
          "aria-label": t("composerAria"),
          onChange: handleDraftChange,
          onKeyDown: handleKeyDown,
        }),
        h(
          "button",
          {
            type: "button",
            className: "dchat-send",
            "aria-label": t("send"),
            title: t("send"),
            disabled: sending || draft.trim() === "",
            onClick: submit,
          },
          sending ? h("span", { className: "dchat-send-text" }, "…") : SEND_ICON,
        ),
      );

      const displayPeer = peers.length === 1 ? peers[0] : null;
      const typingLabel =
        snapshot && Array.isArray(snapshot.typing) && snapshot.typing.length > 0
          ? snapshot.typing
              .slice(0, 2)
              .map((peer) => (peer && peer.nick ? peer.nick : t("anonymous")))
              .join("、") + " " + t("typing")
          : "";
      const headName = displayPeer
        ? String(displayPeer.label || displayPeer.nick || t("anonymous"))
        : snapshot && snapshot.room
          ? "# " + snapshot.room
          : t("title");
      const lockBadge = relay
        ? relay.encrypted
          ? "🔒 " + t("encrypted")
          : "🔓 " + t("plain")
        : "";
      const headSub =
        typingLabel ||
        [
          status.text,
          lockBadge,
          snapshot ? t("peers") + " " + peers.length + (peersOnline > 0 ? " · " + t("online") + " " + peersOnline : "") : "",
          snapshot && snapshot.room ? "# " + snapshot.room : "",
        ]
          .filter(Boolean)
          .join(" · ");
      const chatList = chats && Array.isArray(chats) ? chats : [];
      const sideQuery = discoverQuery.trim().toLowerCase();
      const visibleChats = chatList.filter(
        (chat) =>
          !sideQuery ||
          String(chat.title || "").toLowerCase().includes(sideQuery) ||
          String(chat.room || "").toLowerCase().includes(sideQuery),
      );
      const knownPeerIds = new Set(chatList.map((chat) => chat.peerId).filter(Boolean));
      const directoryMatches = sideQuery
        ? (social && Array.isArray(social.directory) ? social.directory : [])
            .filter(
              (peer) =>
                !knownPeerIds.has(peer.id) &&
                (String(peer.nick || "").toLowerCase().includes(sideQuery) ||
                  String(peer.id || "").includes(sideQuery)),
            )
            .slice(0, 6)
        : [];

      const chatRows = visibleChats.map((chat) => {
        const isDm = chat.kind === "dm";
        return h(
          "button",
          {
            key: "chat-" + chat.id,
            type: "button",
            className: "dchat-chat-row" + (chat.active ? " active" : ""),
            title: (isDm ? "" : "群聊 · ") + chat.room,
            onClick: () => switchChat(chat.id),
          },
          h(
            "span",
            {
              className: "dchat-chat-avatar" + (isDm ? "" : " is-group"),
              style: isDm ? { background: avatarColor(chat.id) } : undefined,
              "aria-hidden": "true",
            },
            isDm ? initialsOf(chat.title) : "#",
          ),
          h(
            "span",
            { className: "dchat-chat-body" },
            h("span", { className: "dchat-chat-name" }, String(chat.title || chat.room)),
            h(
              "span",
              { className: "dchat-chat-preview" },
              chat.lastText
                ? (chat.lastMine ? t("you") + ": " : "") + chat.lastText
                : t("empty"),
            ),
          ),
          h(
            "span",
            { className: "dchat-chat-meta" },
            chat.unread > 0
              ? h("span", { className: "dchat-chat-unread" }, chat.unread > 99 ? "99+" : String(chat.unread))
              : chat.lastTs
                ? h("span", { className: "dchat-chat-time" }, formatTime(chat.lastTs))
                : null,
          ),
        );
      });

      const sideView = h(
        "aside",
        { className: "dchat-side", "aria-label": t("contacts") },
        h(
          "div",
          { className: "dchat-side-head" },
          h("span", { className: "dchat-logo", "aria-hidden": "true" }, h(BrandMark, { size: 18 })),
          h("span", { className: "dchat-side-title" }, t("title")),
          h(
            "button",
            { type: "button", className: "dchat-icon-btn", "aria-label": t("invite"), title: t("invite"), onClick: openInvite },
            INVITE_ICON,
          ),
          h(
            "button",
            {
              type: "button",
              className: "dchat-icon-btn",
              "aria-expanded": settingsOpen ? "true" : "false",
              "aria-label": t("settings"),
              title: t("settings"),
              onClick: toggleSettings,
            },
            SETTINGS_ICON,
          ),
        ),
        h(
          "div",
          { className: "dchat-side-search" },
          h("input", {
            className: "dchat-input",
            type: "search",
            value: discoverQuery,
            placeholder: t("discoverSearch"),
            "aria-label": t("discoverSearch"),
            onChange: (event) => setDiscoverQuery(event.target.value),
          }),
        ),
        h(
          "div",
          { className: "dchat-side-list" },
          ...chatRows,
          ...directoryMatches.map((peer) =>
            h(
              "div",
              { key: "found-" + peer.id, className: "dchat-chat-row" },
              h(
                "span",
                { className: "dchat-chat-avatar", style: { background: avatarColor(peer.id) }, "aria-hidden": "true" },
                initialsOf(peer.nick),
              ),
              h(
                "span",
                { className: "dchat-chat-body" },
                h("span", { className: "dchat-chat-name" }, String(peer.nick || t("anonymous"))),
                h("span", { className: "dchat-chat-preview" }, t("discover") + " · " + String(peer.id || "").slice(0, 6)),
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "dchat-small-btn",
                  disabled: connectingId === peer.id,
                  onClick: () => connectTo(peer.id),
                },
                connectingId === peer.id ? t("connecting") : t("connect"),
              ),
            ),
          ),
          chatRows.length === 0 && directoryMatches.length === 0
            ? h("div", { className: "dchat-side-empty" }, sideQuery ? t("discoverEmpty") : t("contactsEmpty"))
            : null,
        ),
        h(
          "div",
          { className: "dchat-side-foot" },
          h(
            "div",
            { className: "dchat-side-actions" },
            h(
              "button",
              { type: "button", className: "dchat-discover-btn", onClick: () => setFriendsOpen(true) },
              "🧭 " + t("findFriends") + (pendingList.length > 0 ? " · " + pendingList.length : ""),
            ),
            h(
              "button",
              {
                type: "button",
                className: "dchat-discover-btn",
                title: t("newChat"),
                onClick: () => {
                  setNewChatTitle("");
                  setCreateOpen(true);
                },
              },
              "＋",
            ),
          ),
          h(
            "span",
            { className: "dchat-side-status", "aria-live": "polite" },
            h("span", { className: "dchat-dot " + status.className }),
            status.text,
          ),
        ),
      );


      const mainHead = h(
        "header",
        { className: "dchat-main-head" },
        h(
          "span",
          {
            className: "dchat-head-avatar",
            style: displayPeer
              ? { background: avatarColor(displayPeer.id) }
              : { background: "var(--dchat-brand)", color: "var(--dchat-brand-fg)" },
            "aria-hidden": "true",
          },
          displayPeer ? initialsOf(displayPeer.nick) : "#",
        ),
        h(
          "div",
          { className: "dchat-head-text" },
          h(
            "div",
            { className: "dchat-head-name", title: headName },
            headName,
            snapshot && snapshot.agent && snapshot.agent.autoReply
              ? h("span", { className: "dchat-head-agent", title: t("agentOn") }, " 🤖")
              : null,
          ),
          h("div", { className: "dchat-head-sub" }, headSub),
        ),
        h(
          "div",
          { className: "dchat-head-tools" },
          h(
            "button",
            {
              type: "button",
              className: "dchat-icon-btn",
              "aria-label": t("friends"),
              title: t("friendsTitle"),
              onClick: () => setFriendsOpen(true),
            },
            PEOPLE_ICON,
            pendingList.length > 0
              ? h(
                  "span",
                  { className: "dchat-icon-badge" },
                  pendingList.length > 9 ? "9+" : String(pendingList.length),
                )
              : null,
          ),
          h(
            "button",
            { type: "button", className: "dchat-icon-btn", "aria-label": t("invite"), title: t("invite"), onClick: openInvite },
            INVITE_ICON,
          ),
          h(
            "button",
            {
              type: "button",
              className: "dchat-icon-btn",
              "aria-expanded": settingsOpen ? "true" : "false",
              "aria-label": t("settings"),
              title: t("settings"),
              onClick: toggleSettings,
            },
            SETTINGS_ICON,
          ),
        ),
      );

      return h(
        "div",
        { className: "dchat-root" + (inSettings ? " dchat-in-settings" : "") },
        h(
          "div",
          { className: "dchat-layout" },
          sideView,
          h(
            "main",
            { className: "dchat-main" },
            mainHead,
            banner,
            requestBanner,
            settingsView,
            snapshot && peers.length > 1 ? peersView : null,
            bodyView,
            sendError ? h("div", { className: "dchat-send-error" }, "⚠️ " + sendError) : null,
            composer,
          ),
        ),
        inviteView,
        friendsView,
        createView,
      );
    }

    // 兼容 fallback：若运行时没有 ctx.effect，只注入一次样式。
    function installStyles(ctx) {
      const appendStyle = () => {
        if (typeof document === "undefined" || !document.head) return () => {};
        const existing = document.querySelector
          ? document.querySelector('style[data-dsh-chat-plugin="1"]')
          : null;
        if (existing) return () => {};
        const element = document.createElement("style");
        element.setAttribute("data-dsh-chat-plugin", "1");
        element.textContent = CSS;
        document.head.appendChild(element);
        return () => {
          try {
            element.remove();
          } catch (error) {
            /* 忽略 */
          }
        };
      };

      try {
        if (ctx && typeof ctx.effect === "function") {
          ctx.effect(appendStyle, "dsh-chat: styles");
          return;
        }
      } catch (error) {
        console.warn("[dsh-chat-plugin] 注入样式失败，改用兜底方式：", error);
      }
      appendStyle();
    }

    // ── 挂载 ──────────────────────────────────────────────────────────────
    function warnRegistration(slotName, error) {
      console.warn("[dsh-chat-plugin] 注册 slot " + slotName + " 失败：", error);
    }

    function apply(ctx) {
      installStyles(ctx);

      // 1) 左侧栏面板图标：props 为 { size, active }。
      try {
        ctx.slots.inject("sidebar.panellist", () => {
          let dispose;
          try {
            dispose = ctx.slots.register(
              {
                name: "sidebar.panellist",
                id: "chat",
                order: 20,
                label: "dsh Chat",
              },
              PanelIcon,
            );
          } catch (error) {
            warnRegistration("sidebar.panellist", error);
            return () => {};
          }
          return () => {
            try {
              dispose();
            } catch (error) {
              warnRegistration("sidebar.panellist(dispose)", error);
            }
          };
        });
      } catch (error) {
        warnRegistration("sidebar.panellist", error);
      }

      // 2) 主面板：keyed slot，key 必须与左侧栏 id 一致，点击图标才会打开。
      try {
        ctx.slots.inject("main", () => {
          let dispose;
          try {
            dispose = ctx.slots.register(
              { name: "main", key: "chat" },
              ChatPanel,
            );
          } catch (error) {
            warnRegistration("main", error);
            return () => {};
          }
          return () => {
            try {
              dispose();
            } catch (error) {
              warnRegistration("main(dispose)", error);
            }
          };
        });
      } catch (error) {
        warnRegistration("main", error);
      }

      // 3) 设置页同名分区，复用同一个组件。
      try {
        ctx.slots.inject("settings.section", () => {
          let dispose;
          try {
            dispose = ctx.slots.register(
              {
                name: "settings.section",
                id: "chat",
                order: 45,
                label: "dsh Chat",
              },
              ChatPanel,
            );
          } catch (error) {
            warnRegistration("settings.section", error);
            return () => {};
          }
          return () => {
            try {
              dispose();
            } catch (error) {
              warnRegistration("settings.section(dispose)", error);
            }
          };
        });
      } catch (error) {
        warnRegistration("settings.section", error);
      }
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  },
});
