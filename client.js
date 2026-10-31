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
      encrypted: "端到端加密",
      plain: "🔓 明文",
      settings: "设置",
      settingsTitle: "设置",
      settingsProfile: "个人资料",
      settingsChat: "当前会话",
      settingsAutomation: "Agent 自动化",
      settingsNotify: "桌面通知",
      settingsRoom: "房间与中继",
      settingsDiscover: "发现与隐私",
      settingsAdvanced: "更多",
      settingsGuide: "重新查看新手引导",
      settingsInvite: "查看邀请码",
      onboardTitle: "欢迎使用 dsh Chat",
      onboardLead: "三步开始：起个名字、建一个房间（或加入朋友的），就可以和另一台 dsh 聊天了。",
      onboardStep1: "① 你的昵称",
      onboardNicknameHint: "对方在成员栏看到的名字，之后随时能改。",
      onboardStep2: "② 房间",
      onboardCreateLabel: "新建群聊（名字）",
      onboardJoinLabel: "或粘贴朋友的邀请码",
      onboardStep3: "③ 被发现",
      onboardDiscoverHint: "开启后，装了 dsh Chat 的人能在「发现」里搜到你并发起私聊。",
      onboardFinish: "开始使用",
      onboardSkip: "稍后再说",
      onboardWorking: "正在准备…",
      members: "成员",
      membersTitle: "群成员",
      inviteMembers: "邀请成员",
      renameChat: "重命名会话",
      more: "更多",
      close: "关闭",
      menu: "会话菜单",
      sideToggle: "会话列表",
      me: "我",
      offline: "离线",
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
      nicknameHelp: "这是其他成员在成员栏看到的名字。",
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
      reply: "回复",
      replyTo: "回复",
      cancelReply: "取消回复",
      copyText: "复制",
      copied: "已复制",
      react: "回应",
      unreadDivider: "未读消息",
      diagnostics: "连接诊断",
      diagnosticsTesting: "诊断中…",
      diagnosticsOk: "中继可达",
      diagnosticsFail: "中继不可达",
      quoteUnavailable: "引用的消息不在本机窗口内",
      attach: "发送图片或文件",
      uploading: "上传中…",
      uploadFailed: "上传失败",
      fileTooLarge: "文件太大（上限 10MB）",
      download: "下载",
      imagePreview: "图片预览",
      closePreview: "关闭预览",
      agentId: "Agent ID",
      agentIdHint: "把这个 ID 发给朋友，对方在「发现」里按 ID 就能加你，不必开启发现目录。",
      agentIdInvalid: "Agent ID 是 8 位字母数字，例如 K7M2-QX9T",
      copyId: "复制 ID",
      addById: "按 ID 添加",
      addByIdHint: "对方没有出现在目录里？直接输入 TA 的 Agent ID。",
      idAdded: "已发送连接请求",
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
          agentId: String(me.agentId == null ? "" : me.agentId),
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
        reactions: raw.reactions && typeof raw.reactions === "object" ? raw.reactions : {},
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
  overflow: hidden;
}
.dchat-hamburger {
  display: none;
}
.dchat-menu {
  position: absolute;
  top: 52px;
  right: 12px;
  z-index: 24;
  min-width: 176px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--dchat-border-l2);
  border-radius: 10px;
  background: var(--dchat-overlay);
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.24);
}
.dchat-menu-item {
  text-align: left;
  padding: 8px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dchat-label);
  font-family: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.dchat-menu-item:hover {
  background: var(--dchat-hover);
}
.dchat-menu-item.danger {
  color: var(--dchat-err);
}
.dchat-menu-backdrop {
  position: absolute;
  inset: 0;
  z-index: 23;
  background: transparent;
}
.dchat-member-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  border-bottom: 1px solid var(--dchat-border-l1);
}
.dchat-member-row:last-of-type {
  border-bottom: 0;
}
.dchat-member-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dchat-member-tag {
  font-size: 10.5px;
  color: var(--dchat-label-2);
}
.dchat-side-backdrop {
  display: none;
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
.dchat-bubble-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
}
.dchat-actions {
  position: absolute;
  top: -14px;
  display: none;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--dchat-border-l1);
  border-radius: 8px;
  background: var(--dchat-overlay);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  z-index: 2;
}
.dchat-row.theirs .dchat-actions {
  right: 0;
}
.dchat-row.mine .dchat-actions {
  left: 0;
}
.dchat-row:hover .dchat-actions,
.dchat-bubble-wrap:focus-within .dchat-actions {
  display: flex;
}
.dchat-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dchat-label-2);
  cursor: pointer;
}
.dchat-act:hover {
  background: var(--dchat-hover);
  color: var(--dchat-label);
}
.dchat-react-picker {
  display: flex;
  gap: 2px;
  margin-top: 4px;
  padding: 3px 4px;
  border: 1px solid var(--dchat-border-l1);
  border-radius: 10px;
  background: var(--dchat-overlay);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.14);
  align-self: flex-start;
  z-index: 3;
}
.dchat-row.mine .dchat-react-picker {
  align-self: flex-end;
}
.dchat-react-btn {
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.dchat-react-btn:hover {
  background: var(--dchat-hover);
}
.dchat-reactions {
  display: flex;
  gap: 4px;
  margin-top: 3px;
  flex-wrap: wrap;
}
.dchat-row.mine .dchat-reactions {
  justify-content: flex-end;
}
.dchat-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 21px;
  padding: 0 7px;
  border: 1px solid var(--dchat-border-l1);
  border-radius: 11px;
  background: var(--dchat-layer-1);
  color: var(--dchat-label-2);
  font-family: inherit;
  font-size: 10.5px;
  cursor: pointer;
}
.dchat-chip.mine {
  border-color: color-mix(in srgb, var(--dchat-brand) 55%, transparent);
  background: color-mix(in srgb, var(--dchat-brand) 12%, transparent);
  color: var(--dchat-brand);
}
.dchat-quote {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-bottom: 5px;
  padding: 4px 8px;
  border-left: 3px solid color-mix(in srgb, var(--dchat-brand) 70%, transparent);
  border-radius: 4px;
  background: rgba(127, 127, 127, 0.14);
  font-size: 11px;
  max-width: 100%;
}
.dchat-row.mine .dchat-quote {
  background: rgba(255, 255, 255, 0.18);
  border-left-color: var(--dchat-brand-fg);
}
.dchat-quote-name {
  font-weight: 600;
  opacity: 0.9;
}
.dchat-quote-text {
  opacity: 0.85;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dchat-text {
  white-space: pre-wrap;
  word-break: break-word;
}
.dchat-mention {
  color: var(--dchat-brand);
  font-weight: 600;
}
.dchat-row.mine .dchat-mention {
  color: var(--dchat-brand-fg);
  text-decoration: underline;
}
.dchat-unread-divider {
  align-self: center;
  margin: 10px 0 6px;
  padding: 2px 10px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--dchat-brand) 14%, transparent);
  color: var(--dchat-brand);
  font-size: 10.5px;
  font-weight: 600;
}
.dchat-reply-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 14px 0;
  padding: 6px 10px;
  border: 1px solid var(--dchat-border-l1);
  border-left: 3px solid var(--dchat-brand);
  border-radius: 8px;
  background: var(--dchat-layer-1);
}
.dchat-reply-info {
  flex: 1 1 auto;
  min-width: 0;
}
.dchat-reply-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--dchat-brand);
}
.dchat-reply-text {
  font-size: 11.5px;
  color: var(--dchat-label-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dchat-toast {
  position: absolute;
  left: 50%;
  bottom: 86px;
  transform: translateX(-50%);
  z-index: 26;
  padding: 6px 14px;
  border-radius: 16px;
  background: rgba(20, 22, 26, 0.86);
  color: #fff;
  font-size: 12px;
  pointer-events: none;
}
.dchat-diagnostics {
  font-size: 11.5px;
  color: var(--dchat-label-2);
  padding-top: 2px;
}
.dchat-attach {
  flex: none;
  margin-bottom: 2px;
}
.dchat-uploading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 14px 0;
  padding: 6px 10px;
  border: 1px solid var(--dchat-border-l1);
  border-radius: 8px;
  background: var(--dchat-layer-1);
  color: var(--dchat-label-2);
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dchat-img {
  display: block;
  max-width: min(300px, 100%);
  max-height: 300px;
  border-radius: 10px;
  cursor: zoom-in;
  object-fit: cover;
}
.dchat-bubble-media {
  padding: 4px;
  background: var(--dchat-layer-1);
}
.dchat-row.mine .dchat-bubble-media {
  background: var(--dchat-layer-1);
}
.dchat-file-card {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 190px;
  padding: 6px 8px;
  border: 1px solid var(--dchat-border-l1);
  border-radius: 9px;
  color: inherit;
  text-decoration: none;
  background: var(--dchat-layer-1);
}
.dchat-row.mine .dchat-file-card {
  border-color: transparent;
  background: var(--dchat-overlay);
  color: var(--dchat-label);
}
.dchat-file-icon {
  font-size: 20px;
  line-height: 1;
}
.dchat-file-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.dchat-file-name {
  font-size: 12px;
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}
.dchat-file-size {
  font-size: 10.5px;
  opacity: 0.75;
}
.dchat-lightbox {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 24px;
  background: rgba(0, 0, 0, 0.82);
}
.dchat-lightbox-img {
  max-width: min(88%, 1000px);
  max-height: 76vh;
  border-radius: 10px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
  cursor: default;
}
.dchat-lightbox-actions {
  display: flex;
  gap: 8px;
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
.dchat-btn:focus-visible,
.dchat-small-btn:focus-visible,
.dchat-icon-btn:focus-visible,
.dchat-menu-item:focus-visible,
.dchat-discover-btn:focus-visible,
.dchat-chat-row:focus-visible,
.dchat-send:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dchat-brand) 70%, transparent);
  outline-offset: 1px;
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
.dchat-id-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dchat-agentid {
  padding: 3px 8px;
  border: 1px solid var(--dchat-border-l1);
  border-radius: 7px;
  background: var(--dchat-layer-1);
  color: var(--dchat-label);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  letter-spacing: 0.06em;
}
.dchat-addbyid {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px dashed color-mix(in srgb, var(--dchat-brand) 55%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--dchat-brand) 7%, transparent);
}
.dchat-addbyid-info {
  flex: 1 1 auto;
  min-width: 0;
}
.dchat-addbyid-title {
  font-size: 11.5px;
  font-weight: 650;
  color: var(--dchat-brand);
}
.dchat-addbyid-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 14px;
  letter-spacing: 0.08em;
  margin: 2px 0;
}
.dchat-settings-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  padding-right: 6px;
}
.dchat-settings-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dchat-settings-section-title {
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--dchat-label-2);
  opacity: 0.85;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--dchat-border-l1);
}
.dchat-onboard {
  width: min(480px, 100%);
}
.dchat-onboard-head {
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.dchat-onboard-lead {
  font-size: 12px;
  line-height: 1.55;
  color: var(--dchat-label-2);
}
.dchat-onboard-step {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--dchat-border-l1);
  border-radius: 10px;
  background: var(--dchat-layer-1);
}
.dchat-onboard-step-title {
  font-size: 11.5px;
  font-weight: 650;
}
.dchat-settings {
  position: absolute;
  inset: 0;
  z-index: 18;
  display: flex;
  flex-direction: column;
  padding: 14px 20px;
  background: var(--dchat-bg);
  overflow: hidden;
}
.dchat-settings-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 10px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--dchat-border-l1);
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
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--dchat-border-l1);
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

/* ── 窄屏：侧栏抽屉 ─────────────────────────────────────────── */
@media (max-width: 720px) {
  .dchat-hamburger {
    display: inline-flex;
  }
  .dchat-side {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 16;
    width: min(288px, 86%);
    background: var(--dchat-overlay);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.28);
    transform: translateX(-102%);
    transition: transform 0.18s ease;
  }
  .dchat-side.open {
    transform: none;
  }
  .dchat-side-backdrop {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 15;
    background: rgba(0, 0, 0, 0.35);
  }
  .dchat-main-head {
    padding: 8px 10px;
  }
  .dchat-list {
    padding: 12px 10px 6px;
  }
  .dchat-composer {
    padding: 6px 10px 10px;
  }
  .dchat-stack {
    max-width: 84%;
  }
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


/* ══ Design system v1.5 ──────────────────────────────────────────────
   统一 token / 基础件 / 动效。所有后续规则只使用这里的变量，
   避免各处出现 7px、9px、11px 之类的"一次性数值"。 */

.dchat-root {
  --dchat-space-1: 4px;
  --dchat-space-2: 8px;
  --dchat-space-3: 12px;
  --dchat-space-4: 16px;
  --dchat-space-5: 20px;
  --dchat-space-6: 24px;
  --dchat-radius-xs: 6px;
  --dchat-radius-sm: 8px;
  --dchat-radius-md: 10px;
  --dchat-radius-lg: 14px;
  --dchat-radius-xl: 16px;
  --dchat-radius-pill: 999px;
  --dchat-font-xs: 10.5px;
  --dchat-font-sm: 11.5px;
  --dchat-font-md: 12.5px;
  --dchat-font-lg: 14px;
  --dchat-font-xl: 16px;
  --dchat-weight-medium: 550;
  --dchat-weight-semibold: 650;
  --dchat-dur-1: 120ms;
  --dchat-dur-2: 160ms;
  --dchat-ease: cubic-bezier(0.2, 0.7, 0.3, 1);
  --dchat-shadow-1: 0 1px 2px rgba(0, 0, 0, 0.06);
  --dchat-shadow-2: 0 10px 28px rgba(0, 0, 0, 0.14);
  --dchat-shadow-3: 0 24px 64px rgba(0, 0, 0, 0.32);
  --dchat-ring: 0 0 0 2px color-mix(in srgb, var(--dchat-brand) 55%, transparent);
  font-size: var(--dchat-font-md);
}

/* 交互基态：统一过渡、按压、禁用、键盘焦点 */
.dchat-root button,
.dchat-root a,
.dchat-root input,
.dchat-root textarea,
.dchat-root select {
  transition:
    background-color var(--dchat-dur-1) var(--dchat-ease),
    border-color var(--dchat-dur-1) var(--dchat-ease),
    color var(--dchat-dur-1) var(--dchat-ease),
    box-shadow var(--dchat-dur-1) var(--dchat-ease),
    transform var(--dchat-dur-1) var(--dchat-ease),
    opacity var(--dchat-dur-1) var(--dchat-ease);
}
.dchat-root button:active:not(:disabled) {
  transform: scale(0.97);
}
.dchat-root button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
}
.dchat-root :is(button, a, input, textarea, select):focus-visible {
  outline: none;
  box-shadow: var(--dchat-ring);
  border-color: color-mix(in srgb, var(--dchat-brand) 65%, transparent);
}

/* 按钮：primary / ghost / quiet，尺寸 md(32) / sm(28) */
.dchat-root .dchat-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: var(--dchat-radius-sm);
  background: var(--dchat-brand);
  color: var(--dchat-brand-fg);
  font-family: inherit;
  font-size: var(--dchat-font-md);
  font-weight: var(--dchat-weight-semibold);
  white-space: nowrap;
}
.dchat-root .dchat-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dchat-brand) 88%, #000 12%);
}
.dchat-root .dchat-btn.ghost {
  background: transparent;
  border-color: var(--dchat-border-l1);
  color: var(--dchat-label);
}
.dchat-root .dchat-btn.ghost:hover:not(:disabled) {
  background: var(--dchat-layer-1);
  border-color: var(--dchat-border-l2);
}
.dchat-root .dchat-small-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--dchat-border-l1);
  border-radius: var(--dchat-radius-sm);
  background: var(--dchat-layer-1);
  color: var(--dchat-label);
  font-family: inherit;
  font-size: var(--dchat-font-sm);
  font-weight: var(--dchat-weight-medium);
  white-space: nowrap;
}
.dchat-root .dchat-small-btn:hover:not(:disabled) {
  background: var(--dchat-layer-2);
  border-color: var(--dchat-border-l2);
}
.dchat-root .dchat-small-btn.ghost {
  background: transparent;
  border-color: var(--dchat-border-l1);
  color: var(--dchat-label-2);
}
.dchat-root .dchat-small-btn.ghost:hover:not(:disabled) {
  background: var(--dchat-layer-1);
  color: var(--dchat-label);
}
.dchat-root .dchat-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--dchat-radius-sm);
  background: transparent;
  color: var(--dchat-label-2);
}
.dchat-root .dchat-icon-btn:hover:not(:disabled) {
  background: var(--dchat-layer-1);
  color: var(--dchat-label);
}
.dchat-root .dchat-btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

/* 输入：对话框/设置用方角 10px，聊天搜索与输入条保持 pill */
.dchat-root .dchat-input,
.dchat-root .dchat-select {
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--dchat-border-l1);
  border-radius: var(--dchat-radius-md);
  background: var(--dchat-bg);
  color: var(--dchat-label);
  font-family: inherit;
  font-size: var(--dchat-font-md);
}
.dchat-root .dchat-input::placeholder {
  color: var(--dchat-label-2);
}
.dchat-root textarea.dchat-input {
  height: auto;
  padding: 8px 10px;
  line-height: 1.5;
  resize: none;
}
.dchat-root .dchat-side-search .dchat-input,
.dchat-root .dchat-composer textarea.dchat-input {
  border-radius: var(--dchat-radius-pill);
  background: var(--dchat-layer-1);
}
.dchat-root .dchat-composer textarea.dchat-input {
  height: 36px;
  min-height: 36px;
  padding: 8px 14px;
}

/* 开关与复选框 */
.dchat-root .dchat-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--dchat-font-sm);
  color: var(--dchat-label);
  cursor: pointer;
}
.dchat-root .dchat-toggle input[type="checkbox"] {
  appearance: none;
  position: relative;
  width: 32px;
  height: 18px;
  margin: 0;
  border-radius: var(--dchat-radius-pill);
  background: var(--dchat-border-l2);
  border: 0;
  cursor: pointer;
  flex: none;
}
.dchat-root .dchat-toggle input[type="checkbox"]::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  transition: transform var(--dchat-dur-1) var(--dchat-ease);
}
.dchat-root .dchat-toggle input[type="checkbox"]:checked {
  background: var(--dchat-brand);
}
.dchat-root .dchat-toggle input[type="checkbox"]:checked::after {
  transform: translateX(14px);
}
.dchat-root .dchat-check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--dchat-font-sm);
  color: var(--dchat-label);
  cursor: pointer;
}
.dchat-root .dchat-check input[type="checkbox"] {
  appearance: none;
  width: 16px;
  height: 16px;
  margin: 0;
  border: 1px solid var(--dchat-border-l2);
  border-radius: 4px;
  background: var(--dchat-bg);
  flex: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dchat-root .dchat-check input[type="checkbox"]:checked {
  background: var(--dchat-brand);
  border-color: var(--dchat-brand);
}
.dchat-root .dchat-check input[type="checkbox"]:checked::after {
  content: "";
  width: 4px;
  height: 8px;
  border: solid var(--dchat-brand-fg);
  border-width: 0 1.8px 1.8px 0;
  transform: translateY(-1px) rotate(45deg);
}

/* 标题 / 行 / 标签 */
.dchat-root :is(.dchat-settings-section-title, .dchat-friends-title) {
  font-size: var(--dchat-font-xs);
  font-weight: var(--dchat-weight-semibold);
  letter-spacing: 0.06em;
  color: var(--dchat-label-2);
  opacity: 0.85;
}
.dchat-root :is(.dchat-dir-row, .dchat-member-row) {
  padding: 8px 10px;
  border-radius: var(--dchat-radius-md);
  border-bottom: 0;
}
.dchat-root :is(.dchat-dir-row, .dchat-member-row):hover {
  background: var(--dchat-layer-1);
}
.dchat-root .dchat-chat-row {
  border-radius: var(--dchat-radius-md);
  margin: 1px 0;
}
.dchat-root .dchat-hint {
  font-size: var(--dchat-font-sm);
  line-height: 1.5;
  color: var(--dchat-label-2);
}
.dchat-root .dchat-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--dchat-font-sm);
  color: var(--dchat-label-2);
}
.dchat-root .dchat-id-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dchat-root .dchat-agentid {
  height: 28px;
  display: inline-flex;
  align-items: center;
  font-size: var(--dchat-font-sm);
}

/* 统一浮层：backdrop + 卡片 + 头部 + 粘性底部 */
@keyframes dchat-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes dchat-pop {
  from { opacity: 0; transform: translateY(6px) scale(0.985); }
  to { opacity: 1; transform: none; }
}
.dchat-root :is(.dchat-invite, .dchat-friends) {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--dchat-space-4);
  background: rgba(10, 12, 16, 0.44);
  backdrop-filter: blur(3px);
  animation: dchat-fade var(--dchat-dur-2) var(--dchat-ease);
}
.dchat-root :is(.dchat-invite-card, .dchat-friends-card) {
  width: min(420px, 100%);
  max-height: min(86%, 760px);
  display: flex;
  flex-direction: column;
  gap: var(--dchat-space-3);
  padding: var(--dchat-space-4);
  border: 1px solid var(--dchat-border-l1);
  border-radius: var(--dchat-radius-xl);
  background: var(--dchat-overlay);
  box-shadow: var(--dchat-shadow-3);
  overflow-y: auto;
  overscroll-behavior: contain;
  animation: dchat-pop var(--dchat-dur-2) var(--dchat-ease);
}
.dchat-root .dchat-friends-card {
  width: min(540px, 100%);
}
.dchat-root .dchat-invite-card.dchat-onboard {
  width: min(460px, 100%);
}
.dchat-root :is(.dchat-invite-head, .dchat-friends-head) {
  display: flex;
  align-items: center;
  gap: var(--dchat-space-2);
  padding: 0 0 var(--dchat-space-3);
  margin: 0;
  border-bottom: 1px solid var(--dchat-border-l1);
}
.dchat-root .dchat-invite-title {
  flex: 1 1 auto;
  font-size: var(--dchat-font-lg);
  font-weight: var(--dchat-weight-semibold);
  letter-spacing: -0.01em;
}
.dchat-root .dchat-invite-actions {
  position: sticky;
  bottom: calc(-1 * var(--dchat-space-4));
  margin: var(--dchat-space-1) calc(-1 * var(--dchat-space-4)) calc(-1 * var(--dchat-space-4));
  padding: var(--dchat-space-3) var(--dchat-space-4);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--dchat-space-2);
  border-top: 1px solid var(--dchat-border-l1);
  background: var(--dchat-overlay);
  border-radius: 0 0 var(--dchat-radius-xl) var(--dchat-radius-xl);
}
.dchat-root .dchat-invite-error {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  border-radius: var(--dchat-radius-sm);
  background: color-mix(in srgb, var(--dchat-err) 12%, transparent);
  color: var(--dchat-err);
  font-size: var(--dchat-font-sm);
}

/* 设置面板：与浮层同一套头部/间距，内容居中成列 */
.dchat-root .dchat-settings {
  padding: var(--dchat-space-5) max(var(--dchat-space-5), 7vw);
  background: var(--dchat-bg);
}
.dchat-root .dchat-settings-head {
  max-width: 640px;
  width: 100%;
  margin: 0 auto;
  padding: 0 0 var(--dchat-space-3);
}
.dchat-root .dchat-settings-title {
  flex: 1 1 auto;
  font-size: var(--dchat-font-xl);
  font-weight: var(--dchat-weight-semibold);
  letter-spacing: -0.01em;
}
.dchat-root .dchat-settings-body {
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  gap: var(--dchat-space-5);
}
.dchat-root .dchat-settings-actions {
  width: 100%;
  max-width: 640px;
  margin: var(--dchat-space-3) auto 0;
  padding-top: var(--dchat-space-3);
}
.dchat-root .dchat-settings-section {
  gap: var(--dchat-space-2);
}
.dchat-root .dchat-settings-section-title {
  padding-bottom: 6px;
}

/* 头部与输入区共享的节奏 */
.dchat-root .dchat-side-head,
.dchat-root .dchat-main-head {
  min-height: 52px;
  padding: 0 var(--dchat-space-3);
  box-sizing: border-box;
}
.dchat-root .dchat-side-search {
  padding: var(--dchat-space-2) var(--dchat-space-3) var(--dchat-space-1);
}
.dchat-root .dchat-side-search .dchat-input {
  height: 34px;
}
.dchat-root .dchat-composer {
  gap: var(--dchat-space-2);
  padding: var(--dchat-space-2) var(--dchat-space-3) var(--dchat-space-3);
}
.dchat-root .dchat-menu {
  top: 54px;
  right: var(--dchat-space-3);
  padding: var(--dchat-space-1);
  border-radius: var(--dchat-radius-md);
  box-shadow: var(--dchat-shadow-2);
}
.dchat-root .dchat-menu-item {
  padding: 8px 10px;
  border-radius: var(--dchat-radius-sm);
  font-size: var(--dchat-font-md);
}
.dchat-root .dchat-toast {
  bottom: 92px;
  padding: 7px 14px;
  font-size: var(--dchat-font-sm);
  box-shadow: var(--dchat-shadow-2);
}
.dchat-root .dchat-empty {
  gap: var(--dchat-space-3);
}

/* 移动端：浮层统一成底部 sheet */
@media (max-width: 720px) {
  .dchat-root :is(.dchat-invite, .dchat-friends) {
    align-items: flex-end;
    padding: 0;
  }
  .dchat-root :is(.dchat-invite-card, .dchat-friends-card),
  .dchat-root .dchat-invite-card.dchat-onboard {
    width: 100%;
    max-height: 88%;
    border-radius: var(--dchat-radius-xl) var(--dchat-radius-xl) 0 0;
    padding: var(--dchat-space-4);
    animation: dchat-sheet var(--dchat-dur-2) var(--dchat-ease);
  }
  .dchat-root .dchat-invite-actions {
    bottom: calc(-1 * var(--dchat-space-4));
    margin: var(--dchat-space-1) calc(-1 * var(--dchat-space-4)) calc(-1 * var(--dchat-space-4));
    border-radius: 0;
  }
}
@keyframes dchat-sheet {
  from { opacity: 0.6; transform: translateY(24px); }
  to { opacity: 1; transform: none; }
}

/* 所有布尔项统一为 switch（与发现目录开关一致） */
.dchat-root .dchat-check input[type="checkbox"] {
  appearance: none;
  position: relative;
  width: 32px;
  height: 18px;
  margin: 0;
  border: 0;
  border-radius: var(--dchat-radius-pill);
  background: var(--dchat-border-l2);
  cursor: pointer;
  flex: none;
}
.dchat-root .dchat-check input[type="checkbox"]::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: 50%;
  background: #fff;
  transform: none;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  transition: transform var(--dchat-dur-1) var(--dchat-ease);
}
.dchat-root .dchat-check input[type="checkbox"]:checked {
  background: var(--dchat-brand);
  border: 0;
}
.dchat-root .dchat-check input[type="checkbox"]:checked::after {
  content: "";
  width: 14px;
  height: 14px;
  border: 0;
  background: #fff;
  transform: translateX(14px);
  rotate: 0deg;
}
.dchat-root .dchat-toggle input[type="checkbox"]:focus-visible,
.dchat-root .dchat-check input[type="checkbox"]:focus-visible {
  box-shadow: var(--dchat-ring);
}
.dchat-root .dchat-chip,
.dchat-root .dchat-unread-divider {
  border-radius: var(--dchat-radius-pill);
}

@media (prefers-reduced-motion: reduce) {
  .dchat-root *,
  .dchat-root *::before,
  .dchat-root *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

`;

    // ── 图标（内联 SVG，不依赖任何 icon 包）──────────────────────────────
    function PanelIcon(props) {
      const ownerProps = props || {};
      const requestedSize = Number(ownerProps.size);
      const size = Number.isFinite(requestedSize) && requestedSize > 0 ? requestedSize : 18;
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
        h(LogoMark, { size }),
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

    const MENU_ICON = h(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: 17,
        height: 17,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        strokeLinecap: "round",
        "aria-hidden": "true",
        focusable: "false",
        style: { display: "block" },
      },
      h("path", { key: "a", d: "M4 7h16" }),
      h("path", { key: "b", d: "M4 12h16" }),
      h("path", { key: "c", d: "M4 17h16" }),
    );

    const MORE_ICON = h(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: 17,
        height: 17,
        fill: "currentColor",
        "aria-hidden": "true",
        focusable: "false",
        style: { display: "block" },
      },
      h("circle", { key: "a", cx: 5, cy: 12, r: 1.6 }),
      h("circle", { key: "b", cx: 12, cy: 12, r: 1.6 }),
      h("circle", { key: "c", cx: 19, cy: 12, r: 1.6 }),
    );

    const REPLY_ICON = h(
      "svg",
      { viewBox: "0 0 24 24", width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false", style: { display: "block" } },
      h("path", { key: "a", d: "M9 7L3 12l6 5" }),
      h("path", { key: "b", d: "M3 12h7.5a6.5 6.5 0 0 1 6.5 6.5" }),
    );

    const SMILE_ICON = h(
      "svg",
      { viewBox: "0 0 24 24", width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", "aria-hidden": "true", focusable: "false", style: { display: "block" } },
      h("circle", { key: "a", cx: 12, cy: 12, r: 8 }),
      h("path", { key: "b", d: "M9 10.5h.01M15 10.5h.01" }),
      h("path", { key: "c", d: "M9 14.5c.8 1 1.8 1.5 3 1.5s2.2-.5 3-1.5" }),
    );

    const COPY_ICON = h(
      "svg",
      { viewBox: "0 0 24 24", width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false", style: { display: "block" } },
      h("rect", { key: "a", x: 9, y: 9, width: 11, height: 11, rx: 2 }),
      h("path", { key: "b", d: "M15 5H6a2 2 0 0 0-2 2v9" }),
    );

    const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "👀"];

    /** 渲染消息文本：@提及高亮。 */
    function renderMentions(text, meNick) {
      const value = String(text == null ? "" : text);
      if (!value) return "";
      const pattern = /(@[^\s@]+)/g;
      const parts = [];
      let last = 0;
      let match;
      while ((match = pattern.exec(value)) !== null) {
        if (match.index > last) parts.push(value.slice(last, match.index));
        const mention = match[1];
        const name = mention.slice(1).toLowerCase();
        const mineMention =
          name === "all" ||
          name === "everyone" ||
          (meNick && name === String(meNick).toLowerCase());
        parts.push(
          h(
            "span",
            { key: "m-" + match.index, className: "dchat-mention" + (mineMention ? " me" : "") },
            mention,
          ),
        );
        last = match.index + mention.length;
      }
      if (last < value.length) parts.push(value.slice(last));
      return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : parts;
    }

    function humanSize(bytes) {
      const size = Number(bytes) || 0;
      if (size < 1024) return size + " B";
      if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
      return (size / 1024 / 1024).toFixed(1) + " MB";
    }

    function fileUrlOf(file) {
      if (!file) return "";
      if (typeof file.url === "string" && /^data:/i.test(file.url)) return file.url;
      if (!file.id) return "";
      return "/dsh-chat-plugin/api/file/" + encodeURIComponent(String(file.id));
    }

    function normalizeAgentIdInput(value) {
      const cleaned = String(value || "")
        .toUpperCase()
        .replace(/[^0-9A-Z]/g, "")
        .replace(/[ILOU]/g, "");
      if (cleaned.length !== 8) return "";
      for (const char of cleaned) {
        if (!"23456789ABCDEFGHJKLMNPQRSTUVWXYZ".includes(char)) return "";
      }
      return cleaned;
    }

    function formatAgentId(value) {
      const id = normalizeAgentIdInput(value) || String(value || "");
      return id.length === 8 ? id.slice(0, 4) + "-" + id.slice(4) : id;
    }

    const ATTACH_ICON = h(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: 17,
        height: 17,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
        focusable: "false",
        style: { display: "block" },
      },
      h("path", { key: "a", d: "M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8-8a3.4 3.4 0 0 1 4.8 4.8l-8 8a1.8 1.8 0 0 1-2.6-2.6l7.3-7.3" }),
    );

    const CLOSE_ICON = h(
      "svg",
      { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", "aria-hidden": "true", focusable: "false", style: { display: "block" } },
      h("path", { key: "a", d: "M6 6l12 12" }),
      h("path", { key: "b", d: "M18 6L6 18" }),
    );

    const COMPASS_ICON = h(
      "svg",
      { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false", style: { display: "block" } },
      h("circle", { key: "a", cx: 12, cy: 12, r: 8.5 }),
      h("path", { key: "b", d: "M15.2 8.8l-2.1 4.3-4.3 2.1 2.1-4.3 4.3-2.1z" }),
    );

    const BOT_ICON = h(
      "svg",
      { viewBox: "0 0 24 24", width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false", style: { display: "block" } },
      h("rect", { key: "a", x: 4, y: 8, width: 16, height: 11, rx: 3 }),
      h("path", { key: "b", d: "M12 8V5M9 13h.01M15 13h.01M9 16c.9.8 1.9 1.2 3 1.2s2.1-.4 3-1.2" }),
    );

    const FILE_ICON = h(
      "svg",
      { viewBox: "0 0 24 24", width: 18, height: 18, fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false", style: { display: "block" } },
      h("path", { key: "a", d: "M7 3h7l4 4v14H7z" }),
      h("path", { key: "b", d: "M14 3v4h4" }),
    );

    const LOCK_ICON = h(
      "svg",
      { viewBox: "0 0 24 24", width: 12, height: 12, fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", "aria-hidden": "true", focusable: "false", style: { display: "block" } },
      h("rect", { key: "a", x: 5, y: 10, width: 14, height: 10, rx: 2.5 }),
      h("path", { key: "b", d: "M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" }),
    );

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

    /** 产品 Logo（深蓝圆角底 + 白色对话气泡/鲸尾 + 波浪，参考 DeepSeek 的鲸鱼意象）。 */
    function LogoMark(props) {
      const size = Number(props && props.size) || 18;
      return h(
        "svg",
        {
          viewBox: "0 0 64 64",
          width: size,
          height: size,
          role: "img",
          "aria-label": "dsh Chat",
          focusable: "false",
          style: { display: "block", flex: "none" },
        },
        h(
          "defs",
          { key: "defs" },
          h(
            "linearGradient",
            { id: "dshchat-logo-grad", x1: 6, y1: 2, x2: 58, y2: 62, gradientUnits: "userSpaceOnUse" },
            h("stop", { key: "a", offset: 0, stopColor: "#6A9BFF" }),
            h("stop", { key: "b", offset: 1, stopColor: "#3350D8" }),
          ),
        ),
        h("rect", { key: "bg", x: 2, y: 2, width: 60, height: 60, rx: 16, fill: "url(#dshchat-logo-grad)" }),
        h("rect", { key: "bubble", x: 14, y: 14, width: 36, height: 30, rx: 10, fill: "#FFFFFF" }),
        h("path", {
          key: "fin",
          d: "M44 41c3 5 8 8 14 9-2-3-2-6 0-9-5 1-10-1-14-5z",
          fill: "#FFFFFF",
        }),
        h("path", {
          key: "wave",
          d: "M22 26c2-2 4-2 6 0s4 2 6 0 4-2 6 0",
          stroke: "url(#dshchat-logo-grad)",
          strokeWidth: 3.4,
          fill: "none",
          strokeLinecap: "round",
        }),
      );
    }

    /** 兼容旧名：面板内的品牌小图标。 */
    const BrandMark = LogoMark;

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
      const quoted = props.quoted || null;
      const chips = Array.isArray(props.reactions) ? props.reactions : [];
      const pickerOpen = props.pickerOpen === true;
      const text = message.text == null ? "" : String(message.text);
      const nick = String(message.nick || shortId(message.from) || t("anonymous"));
      const color = avatarColor(message.from == null ? nick : message.from);
      const meNick = props.meNick || "";
      const file = message.file && message.file.id ? message.file : null;
      const isImage = Boolean(file && /^image\//i.test(String(file.mime || "")));
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
          h(
            "div",
            { className: "dchat-bubble-wrap" },
            h(
              "div",
              { className: "dchat-actions", role: "toolbar" },
              h(
                "button",
                {
                  type: "button",
                  className: "dchat-act",
                  title: t("reply"),
                  "aria-label": t("reply"),
                  onClick: () => props.onReply && props.onReply(message),
                },
                REPLY_ICON,
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "dchat-act",
                  title: t("react"),
                  "aria-label": t("react"),
                  onClick: () => props.onTogglePicker && props.onTogglePicker(message.id),
                },
                SMILE_ICON,
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "dchat-act",
                  title: t("copyText"),
                  "aria-label": t("copyText"),
                  onClick: () => props.onCopy && props.onCopy(text),
                },
                COPY_ICON,
              ),
            ),
            h(
              "div",
              {
                className: "dchat-bubble" + (isImage ? " dchat-bubble-media" : ""),
                title: fullTimeTitle(message.ts),
              },
              message.replyTo
                ? h(
                    "div",
                    { className: "dchat-quote" },
                    h(
                      "span",
                      { className: "dchat-quote-name" },
                      quoted
                        ? (quoted.mine ? t("you") : String(quoted.nick || t("anonymous"))) + "："
                        : t("quoteUnavailable"),
                    ),
                    quoted
                      ? h("span", { className: "dchat-quote-text" }, String(quoted.text || "").slice(0, 120))
                      : null,
                  )
                : null,
              file
                ? isImage
                  ? h("img", {
                      className: "dchat-img",
                      src: fileUrlOf(file),
                      alt: file.name,
                      loading: "lazy",
                      onClick: () => props.onOpenImage && props.onOpenImage({ url: fileUrlOf(file), name: file.name }),
                    })
                  : h(
                      "a",
                      { className: "dchat-file-card", href: fileUrlOf(file), download: file.name },
                      h("span", { className: "dchat-file-icon", "aria-hidden": "true" }, FILE_ICON),
                      h(
                        "span",
                        { className: "dchat-file-info" },
                        h("span", { className: "dchat-file-name" }, file.name),
                        h("span", { className: "dchat-file-size" }, humanSize(file.size)),
                      ),
                    )
                : null,
              text && (!file || text !== file.name)
                ? h("span", { className: "dchat-text" }, renderMentions(text, meNick))
                : null,
            ),
            pickerOpen
              ? h(
                  "div",
                  { className: "dchat-react-picker" },
                  REACTION_EMOJIS.map((emoji) =>
                    h(
                      "button",
                      {
                        key: emoji,
                        type: "button",
                        className: "dchat-react-btn",
                        onClick: () => props.onReact && props.onReact(message.id, emoji),
                      },
                      emoji,
                    ),
                  ),
                )
              : null,
          ),
          chips.length > 0
            ? h(
                "div",
                { className: "dchat-reactions" },
                chips.map((chip) =>
                  h(
                    "button",
                    {
                      key: chip.emoji,
                      type: "button",
                      className: "dchat-chip" + (chip.mine ? " mine" : ""),
                      title: chip.count + " 个回应",
                      onClick: () => props.onReact && props.onReact(message.id, chip.emoji),
                    },
                    String(chip.emoji) + " " + String(chip.count),
                  ),
                ),
              )
            : null,
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
            h("span", { className: "dchat-btn-icon" }, COMPASS_ICON),
            t("findFriends"),
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
      const [onboardingOpen, setOnboardingOpen] = useState(false);
      const [onboardSeen, setOnboardSeen] = useState(false);
      const [obNickname, setObNickname] = useState("");
      const [obGroupTitle, setObGroupTitle] = useState("");
      const [obInviteCode, setObInviteCode] = useState("");
      const [obDiscover, setObDiscover] = useState(true);
      const [obBusy, setObBusy] = useState(false);
      const [obError, setObError] = useState("");
      const [sideOpen, setSideOpen] = useState(() =>
        typeof window === "undefined" ? true : window.innerWidth > 720,
      );
      const [menuOpen, setMenuOpen] = useState(false);
      const [membersOpen, setMembersOpen] = useState(false);
      const [replyTo, setReplyTo] = useState(null);
      const [reactionFor, setReactionFor] = useState(null);
      const [diagnostic, setDiagnostic] = useState(null);
      const [diagnosticBusy, setDiagnosticBusy] = useState(false);
      const [toast, setToast] = useState(null);
      const [uploading, setUploading] = useState(null);
      const [preview, setPreview] = useState(null);

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
      const draftSavedRef = useRef("");
      const [unreadAnchor, setUnreadAnchor] = useState(0);
      const anchorRoomRef = useRef(null);
      const fileInputRef = useRef(null);
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
          if (next && anchorRoomRef.current !== next.room) {
            anchorRoomRef.current = next.room;
            setUnreadAnchor(Math.max(0, Number(next.lastReadSeq) || 0) + 1);
          }
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
            const normalized = normalizeAgentIdInput(id);
            await socialAction("/social/connect", normalized ? { agentId: normalized } : { id });
            setFriendsOpen(false);
          } finally {
            if (mountedRef.current) setConnectingId("");
          }
        },
        [connectingId, socialAction],
      );

      /** 好友抽屉里直接按 Agent ID 添加（不需要目录）。 */
      const connectById = useCallback(
        async (rawId) => {
          const normalized = normalizeAgentIdInput(rawId);
          if (!normalized) {
            setSocialError(t("agentIdInvalid"));
            return;
          }
          await connectTo(normalized);
        },
        [connectTo],
      );

      const acceptRequest = useCallback(async (id) => { await socialAction("/social/accept", { id }); }, [socialAction]);
      const dismissRequest = useCallback(async (id) => { await socialAction("/social/dismiss", { id }); }, [socialAction]);
      const joinContact = useCallback(async (id) => { await socialAction("/social/join", { id }); setFriendsOpen(false); }, [socialAction]);
      const removeContact = useCallback(async (id) => { await socialAction("/social/remove", { id }); }, [socialAction]);

      const switchChat = useCallback(
        async (id) => {
          if (!id) return;
          await socialAction("/chats/switch", { id });
          if (typeof window !== "undefined" && window.innerWidth <= 720) setSideOpen(false);
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

      /** 打开首次使用引导（预填当前昵称/发现状态）。 */
      const openOnboarding = useCallback(() => {
        setObNickname(
          (snapshot && snapshot.settings && snapshot.settings.nickname) || "",
        );
        setObGroupTitle("");
        setObInviteCode("");
        setObDiscover(social ? social.discoverable === true : true);
        setObError("");
        setOnboardingOpen(true);
      }, [snapshot, social]);

      const finishOnboarding = useCallback(async () => {
        if (obBusy) return;
        setObBusy(true);
        setObError("");
        try {
          const nickname = obNickname.trim();
          await request("/config", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              nickname: nickname || undefined,
              onboarded: true,
              discoverable: obDiscover === true,
            }),
          });
          if (obInviteCode.trim()) {
            await request("/join", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ code: obInviteCode.trim() }),
            });
          } else if (obGroupTitle.trim()) {
            await request("/chats/create", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ title: obGroupTitle.trim() }),
            });
          }
          if (!mountedRef.current) return;
          setOnboardingOpen(false);
          setOnboardSeen(true);
          await loadSocial();
          await loadChats();
          void refresh();
        } catch (error) {
          if (mountedRef.current) {
            setObError(error && error.message ? error.message : t("unreachable"));
          }
        } finally {
          if (mountedRef.current) setObBusy(false);
        }
      }, [obNickname, obGroupTitle, obInviteCode, obDiscover, obBusy, loadSocial, loadChats, refresh]);

      const dismissOnboarding = useCallback(async () => {
        setOnboardingOpen(false);
        setOnboardSeen(true);
        try {
          await request("/config", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ onboarded: true }),
          });
        } catch {
          /* ignore */
        }
        void refresh();
      }, [refresh]);

      /** 选择并上传图片/文件（原始字节直传 Host，Host 加密后传中继）。 */
      const uploadFile = useCallback(
        async (file) => {
          if (!file) return;
          if (file.size > 10 * 1024 * 1024) {
            setSendError(t("fileTooLarge"));
            if (fileInputRef.current) fileInputRef.current.value = "";
            return;
          }
          setUploading({ name: file.name, size: file.size });
          setSendError("");
          try {
            const response = await fetch("/dsh-chat-plugin/api/upload", {
              method: "POST",
              headers: {
                "x-file-name": encodeURIComponent(file.name),
                "x-file-type": file.type || "application/octet-stream",
              },
              body: file,
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.ok === false) {
              throw new Error(data.error || t("uploadFailed"));
            }
            if (!mountedRef.current) return;
            if (data.message) {
              setSnapshot((previous) => appendMessage(previous, data.message));
              forceScrollRef.current = true;
            }
            void refresh();
          } catch (error) {
            if (mountedRef.current) {
              setSendError((error && error.message) || t("uploadFailed"));
            }
          } finally {
            if (mountedRef.current) setUploading(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
          }
        },
        [refresh],
      );

      /** 发送消息：Enter 或按钮触发；失败保留输入并显示服务端错误。 */
      const submit = useCallback(async () => {
        if (sendingRef.current) return;
        const text = draft;
        if (!text || !text.trim()) return;
        const quotedId = replyTo && replyTo.id ? replyTo.id : undefined;
        sendingRef.current = true;
        setSending(true);
        setSendError("");
        try {
          let data;
          try {
            data = await request("/send", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ text, replyTo: quotedId }),
            });
          } catch (error) {
            if (error && error.code === "missing") setHostMissing(true);
            throw error;
          }
          if (!mountedRef.current) return;
          setHostMissing(false);
          setDraft("");
          setReplyTo(null);
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

      // 全新安装（未完成引导且没有昵称）时自动弹一次引导；老用户不会被打扰。
      useEffect(() => {
        if (onboardSeen || onboardingOpen) return;
        if (!snapshot || !snapshot.settings) return;
        if (snapshot.settings.onboarded !== true && !snapshot.settings.nickname) {
          setOnboardSeen(true);
          openOnboarding();
        }
      }, [snapshot, onboardSeen, onboardingOpen, openOnboarding]);

      const openMembers = useCallback(() => {
        setMenuOpen(false);
        setMembersOpen(true);
      }, []);

      const openRename = useCallback(() => {
        setMenuOpen(false);
        if (!settingsOpen) toggleSettings();
      }, [settingsOpen, toggleSettings]);

      const leaveFromMenu = useCallback(async () => {
        setMenuOpen(false);
        await leaveCurrentChat();
      }, [leaveCurrentChat]);

      /** 消息操作：回复 / 回应 / 复制。 */
      const startReply = useCallback((message) => {
        if (!message) return;
        setReplyTo(message);
        if (textareaRef.current && typeof textareaRef.current.focus === "function") {
          textareaRef.current.focus();
        }
      }, []);

      const toggleReactionPicker = useCallback((messageId) => {
        setReactionFor((current) => (current === messageId ? null : messageId));
      }, []);

      const reactTo = useCallback(
        async (messageId, emoji) => {
          if (!messageId || !emoji) return;
          setReactionFor(null);
          try {
            await request("/react", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ id: messageId, emoji }),
            });
            if (mountedRef.current) void refresh();
          } catch (error) {
            if (mountedRef.current) setSendError(error && error.message ? error.message : t("unreachable"));
          }
        },
        [refresh],
      );

      const copyMessageText = useCallback(async (value) => {
        try {
          if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
          } else if (typeof document !== "undefined") {
            const area = document.createElement("textarea");
            area.value = value;
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
          setToast(t("copied"));
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          toastTimerRef.current = setTimeout(() => {
            toastTimerRef.current = null;
            if (mountedRef.current) setToast(null);
          }, 1800);
        } catch {
          /* ignore */
        }
      }, []);

      /** 连接诊断：检查中继 HTTP 健康端点。 */
      const runDiagnostics = useCallback(async () => {
        if (diagnosticBusy) return;
        setDiagnosticBusy(true);
        setDiagnostic(null);
        try {
          const data = await request("/diagnostics", {
            method: "GET",
            headers: { accept: "application/json" },
            cache: "no-store",
          });
          if (mountedRef.current) setDiagnostic(data || null);
        } catch (error) {
          if (mountedRef.current) {
            setDiagnostic({ ok: false, error: error && error.message ? error.message : t("unreachable") });
          }
        } finally {
          if (mountedRef.current) setDiagnosticBusy(false);
        }
      }, [diagnosticBusy]);


      // 每个会话独立的输入草稿。
      useEffect(() => {
        if (!snapshot || typeof window === "undefined") return;
        try {
          const stored = window.localStorage.getItem("dshchat.draft." + snapshot.room) || "";
          draftSavedRef.current = stored;
          setDraft(stored);
        } catch {
          /* ignore */
        }
      }, [snapshot && snapshot.room]);

      useEffect(() => {
        if (!snapshot || typeof window === "undefined") return;
        if (draft === draftSavedRef.current) return;
        draftSavedRef.current = draft;
        try {
          if (draft) window.localStorage.setItem("dshchat.draft." + snapshot.room, draft);
          else window.localStorage.removeItem("dshchat.draft." + snapshot.room);
        } catch {
          /* ignore */
        }
      }, [draft, snapshot && snapshot.room]);

      // Esc 关闭所有浮层 / 取消回复。
      useEffect(() => {
        if (typeof window === "undefined") return;
        const onKeyDown = (event) => {
          if (event.key !== "Escape") return;
          setMenuOpen(false);
          setReactionFor(null);
          setReplyTo(null);
          setInviteOpen(false);
          setFriendsOpen(false);
          setCreateOpen(false);
          setMembersOpen(false);
          setOnboardingOpen(false);
          setPreview(null);
          if (settingsOpen) setSettingsOpen(false);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
      }, [settingsOpen]);

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
              h("span", { className: "dchat-btn-icon" }, BOT_ICON),
              t("agentOn") + (snapshot.agent.busy ? " · " + t("agentBusy") : ""),
            )
          : null,
      );

      const settingsSection = (title, children) =>
        h(
          "div",
          { className: "dchat-settings-section" },
          h("div", { className: "dchat-settings-section-title" }, title),
          ...children,
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
                  CLOSE_ICON,
                ),
              ),
              h(
                "div",
                { className: "dchat-settings-body" },
                settingsSection(t("settingsProfile"), [
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
                    h("div", { className: "dchat-hint" }, t("nicknameHelp")),
                  ),
                  h(
                    "div",
                    { className: "dchat-field" },
                    h("span", null, t("agentId")),
                    h(
                      "div",
                      { className: "dchat-id-row" },
                      h(
                        "code",
                        { className: "dchat-agentid" },
                        formatAgentId(
                          (snapshot && snapshot.me && snapshot.me.agentId) ||
                            (form && form.agentId) ||
                            "",
                        ) || "········",
                      ),
                      h(
                        "button",
                        {
                          type: "button",
                          className: "dchat-small-btn ghost",
                          onClick: () =>
                            copyMessageText(
                              formatAgentId(
                                (snapshot && snapshot.me && snapshot.me.agentId) ||
                                  (form && form.agentId) ||
                                  "",
                              ),
                            ),
                        },
                        t("copyId"),
                      ),
                    ),
                    h("div", { className: "dchat-hint" }, t("agentIdHint")),
                  ),
                ]),
                settingsSection(t("settingsChat"), [
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
                  h("div", { className: "dchat-hint" }, "当前房间 #" + (snapshot ? snapshot.room : "-")),
                ]),
                settingsSection(t("settingsAutomation"), [
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
                  h("div", { className: "dchat-hint" }, t("agentAutoReplyHint")),
                ]),
                settingsSection(t("settingsNotify"), [
                  h(
                    "label",
                    { className: "dchat-check" },
                    h("input", { type: "checkbox", checked: notifyEnabled, onChange: toggleNotify }),
                    t("notifications"),
                  ),
                  h("div", { className: "dchat-hint" }, notifyError || t("notificationsHint")),
                ]),
                settingsSection(t("settingsRoom"), [
                  h(
                    "div",
                    { className: "dchat-settings-grid" },
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
                      { className: "dchat-field dchat-field-full" },
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
                  h("div", { className: "dchat-hint" }, t("lobbyHint")),
                ]),
                settingsSection(t("settingsDiscover"), [
                  h(
                    "label",
                    { className: "dchat-check" },
                    h("input", {
                      type: "checkbox",
                      checked: social ? social.discoverable === true : false,
                      onChange: toggleDiscoverable,
                    }),
                    t("discoverToggle"),
                  ),
                  h("div", { className: "dchat-hint" }, t("discoverHint")),
                ]),
                settingsSection(t("settingsAdvanced"), [
                  h(
                    "div",
                    { className: "dchat-settings-row" },
                    h(
                      "button",
                      {
                        type: "button",
                        className: "dchat-small-btn ghost",
                        onClick: () => {
                          setSettingsOpen(false);
                          openOnboarding();
                        },
                      },
                      t("settingsGuide"),
                    ),
                    h(
                      "button",
                      {
                        type: "button",
                        className: "dchat-small-btn ghost",
                        onClick: openInvite,
                      },
                      t("settingsInvite"),
                    ),
                    h(
                      "button",
                      {
                        type: "button",
                        className: "dchat-small-btn ghost",
                        disabled: diagnosticBusy,
                        onClick: runDiagnostics,
                      },
                      diagnosticBusy ? t("diagnosticsTesting") : t("diagnostics"),
                    ),
                  ),
                  diagnostic
                    ? h(
                        "div",
                        { className: "dchat-diagnostics" },
                        diagnostic.ok !== false && diagnostic.relay
                          ? (diagnostic.relay.reachable ? "✅ " : "⚠️ ") +
                            t("diagnosticsOk") +
                            " · " +
                            String(diagnostic.relay.kind) +
                            " · " +
                            String(diagnostic.relay.latencyMs) +
                            "ms" +
                            (diagnostic.relay.reachable ? "" : "（" + (diagnostic.relay.error || diagnostic.relay.status) + "）")
                          : "⚠️ " + (diagnostic.error || t("diagnosticsFail")),
                      )
                    : null,
                ]),
              ),
              h(
                "div",
                { className: "dchat-settings-actions" },
                h(
                  "button",
                  { type: "button", className: "dchat-btn", disabled: saving, onClick: saveConfig },
                  saving ? t("saving") : t("save"),
                ),
                saveNotice
                  ? h(
                      "span",
                      { className: "dchat-notice " + (saveNotice.kind === "ok" ? "ok" : "err") },
                      saveNotice.text,
                    )
                  : null,
              ),
            )
          : null;

      // 消息列表 + 日期分隔 + 未读分隔线。
      const messageChildren = [];
      const msgMap = new Map();
      for (const message of messages) {
        if (message && message.id) msgMap.set(message.id, message);
      }
      if (snapshot) {
        let lastDay = "";
        let dividerInserted = false;
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
          if (!dividerInserted && unreadAnchor > 0 && Number(seq) >= unreadAnchor) {
            dividerInserted = true;
            messageChildren.push(
              h("div", { key: "unread-divider", className: "dchat-unread-divider" }, t("unreadDivider")),
            );
          }
          messageChildren.push(
            h(MessageRow, {
              key,
              message,
              mine,
              grouped,
              showTime: !nextGrouped,
              readByPeer,
              quoted: message.replyTo ? msgMap.get(message.replyTo) : null,
              reactions: snapshot.reactions ? snapshot.reactions[message.id] : null,
              pickerOpen: reactionFor === message.id,
              meNick: me ? me.nick : "",
              onReply: startReply,
              onTogglePicker: toggleReactionPicker,
              onReact: reactTo,
              onCopy: copyMessageText,
              onOpenImage: setPreview,
            }),
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
            const queryId = normalizeAgentIdInput(discoverQuery);
            const visibleDirectory = directoryList.filter(
              (peer) =>
                !query ||
                String(peer.nick || "").toLowerCase().includes(query) ||
                String(peer.agentId || "").toLowerCase().includes(query) ||
                String(peer.peerId || peer.id || "").toLowerCase().includes(query),
            );
            const idInDirectory = Boolean(
              queryId && directoryList.some((peer) => normalizeAgentIdInput(peer.agentId) === queryId),
            );
            return h(
              "div",
              { className: "dchat-friends", role: "dialog", "aria-label": t("friendsTitle"), onMouseDown: (event) => { if (event.target === event.currentTarget) setFriendsOpen(false); } },
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
                    CLOSE_ICON,
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
                queryId && !idInDirectory
                  ? h(
                      "div",
                      { className: "dchat-addbyid" },
                      h(
                        "div",
                        { className: "dchat-addbyid-info" },
                        h("div", { className: "dchat-addbyid-title" }, t("addById")),
                        h("div", { className: "dchat-addbyid-id" }, formatAgentId(queryId)),
                        h("div", { className: "dchat-hint" }, t("addByIdHint")),
                      ),
                      h(
                        "button",
                        {
                          type: "button",
                          className: "dchat-small-btn",
                          disabled: connectingId === queryId,
                          onClick: () => connectById(queryId),
                        },
                        connectingId === queryId ? t("connecting") : t("connect"),
                      ),
                    )
                  : query && !queryId && query.length >= 4
                    ? h("div", { className: "dchat-hint" }, t("agentIdInvalid"))
                    : null,
                h(
                  "div",
                  { className: "dchat-friends-section" },
                  h("div", { className: "dchat-friends-title" }, t("discover") + " · " + String(visibleDirectory.length)),
                  visibleDirectory.length === 0
                    ? h("div", { className: "dchat-hint" }, t("discoverEmpty"))
                    : visibleDirectory.map((peer) =>
                        h(
                          "div",
                          { key: "dir-" + (peer.agentId || peer.id), className: "dchat-dir-row" },
                          h(
                            "span",
                            {
                              className: "dchat-avatar",
                              style: { background: avatarColor(peer.agentId || peer.id) },
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
                              h("span", { className: "dchat-dir-id" }, " · " + formatAgentId(peer.agentId)),
                            ),
                            h("div", { className: "dchat-dir-meta" }, t("lastSeenShort") + " " + formatTime(peer.at)),
                          ),
                          h(
                            "button",
                            {
                              type: "button",
                              className: "dchat-small-btn",
                              disabled: connectingId === (peer.agentId || peer.id),
                              onClick: () => connectTo(peer.agentId || peer.id),
                            },
                            connectingId === (peer.agentId || peer.id) ? t("connecting") : t("connect"),
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
                            h(
                              "div",
                              { className: "dchat-dir-meta" },
                              contact.agentId ? formatAgentId(contact.agentId) + " · " : "",
                              "房间 " + contact.room,
                            ),
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
            { className: "dchat-invite", role: "dialog", "aria-label": t("inviteTitle"), onMouseDown: (event) => { if (event.target === event.currentTarget) setInviteOpen(false); } },
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
                  CLOSE_ICON,
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

      const onboardingView = onboardingOpen
        ? h(
            "div",
            { className: "dchat-invite", role: "dialog", "aria-label": t("onboardTitle"), onMouseDown: (event) => { if (event.target === event.currentTarget) setOnboardingOpen(false); } },
            h(
              "div",
              { className: "dchat-invite-card dchat-onboard" },
              h("div", { className: "dchat-onboard-head" }, t("onboardTitle")),
              h("div", { className: "dchat-onboard-lead" }, t("onboardLead")),
              h(
                "div",
                { className: "dchat-onboard-step" },
                h("div", { className: "dchat-onboard-step-title" }, t("onboardStep1")),
                h("input", {
                  className: "dchat-input",
                  type: "text",
                  value: obNickname,
                  placeholder: t("nicknameHint"),
                  maxLength: 40,
                  "aria-label": t("nickname"),
                  onChange: (event) => setObNickname(event.target.value),
                }),
                h("div", { className: "dchat-hint" }, t("onboardNicknameHint")),
                h(
                  "div",
                  { className: "dchat-id-row" },
                  h(
                    "code",
                    { className: "dchat-agentid" },
                    formatAgentId((snapshot && snapshot.me && snapshot.me.agentId) || ""),
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "dchat-small-btn ghost",
                      onClick: () =>
                        copyMessageText(
                          formatAgentId((snapshot && snapshot.me && snapshot.me.agentId) || ""),
                        ),
                    },
                    t("copyId"),
                  ),
                ),
              ),
              h(
                "div",
                { className: "dchat-onboard-step" },
                h("div", { className: "dchat-onboard-step-title" }, t("onboardStep2")),
                h("input", {
                  className: "dchat-input",
                  type: "text",
                  value: obGroupTitle,
                  placeholder: t("onboardCreateLabel"),
                  maxLength: 40,
                  "aria-label": t("onboardCreateLabel"),
                  onChange: (event) => setObGroupTitle(event.target.value),
                }),
                h("input", {
                  className: "dchat-input",
                  type: "text",
                  value: obInviteCode,
                  placeholder: t("joinPlaceholder"),
                  "aria-label": t("joinTitle"),
                  onChange: (event) => setObInviteCode(event.target.value),
                }),
              ),
              h(
                "div",
                { className: "dchat-onboard-step" },
                h("div", { className: "dchat-onboard-step-title" }, t("onboardStep3")),
                h(
                  "label",
                  { className: "dchat-check" },
                  h("input", {
                    type: "checkbox",
                    checked: obDiscover,
                    onChange: (event) => setObDiscover(event.target.checked),
                  }),
                  t("discoverToggle"),
                ),
                h("div", { className: "dchat-hint" }, t("onboardDiscoverHint")),
              ),
              obError ? h("div", { className: "dchat-invite-error" }, "⚠️ " + obError) : null,
              h(
                "div",
                { className: "dchat-invite-actions" },
                h(
                  "button",
                  { type: "button", className: "dchat-btn ghost", disabled: obBusy, onClick: dismissOnboarding },
                  t("onboardSkip"),
                ),
                h(
                  "button",
                  { type: "button", className: "dchat-btn", disabled: obBusy, onClick: finishOnboarding },
                  obBusy ? t("onboardWorking") : t("onboardFinish"),
                ),
              ),
            ),
          )
        : null;

      const createView = createOpen
        ? h(
            "div",
            { className: "dchat-invite", role: "dialog", "aria-label": t("newChatTitle"), onMouseDown: (event) => { if (event.target === event.currentTarget) setCreateOpen(false); } },
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
                  CLOSE_ICON,
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

      const menuView = menuOpen
        ? h(
            "div",
            { className: "dchat-menu", role: "menu", "aria-label": t("menu") },
            [
              { key: "members", label: t("members"), onClick: openMembers },
              {
                key: "invite",
                label: t("inviteMembers"),
                onClick: () => {
                  setMenuOpen(false);
                  openInvite();
                },
              },
              { key: "rename", label: t("renameChat"), onClick: openRename },
              { key: "leave", label: t("leaveChat"), onClick: leaveFromMenu, danger: true },
            ].map((item) =>
              h(
                "button",
                {
                  key: item.key,
                  type: "button",
                  role: "menuitem",
                  className: "dchat-menu-item" + (item.danger ? " danger" : ""),
                  onClick: item.onClick,
                },
                item.label,
              ),
            ),
          )
        : null;

      const membersView = membersOpen
        ? h(
            "div",
            { className: "dchat-invite", role: "dialog", "aria-label": t("membersTitle"), onMouseDown: (event) => { if (event.target === event.currentTarget) setMembersOpen(false); } },
            h(
              "div",
              { className: "dchat-invite-card" },
              h(
                "div",
                { className: "dchat-invite-head" },
                h("span", { className: "dchat-invite-title" }, t("membersTitle")),
                h(
                  "button",
                  {
                    type: "button",
                    className: "dchat-icon-btn",
                    "aria-label": t("close"),
                    title: t("close"),
                    onClick: () => setMembersOpen(false),
                  },
                  CLOSE_ICON,
                ),
              ),
              h(
                "div",
                { className: "dchat-member-row" },
                h(
                  "span",
                  {
                    className: "dchat-avatar",
                    style: { background: "var(--dchat-brand)" },
                    "aria-hidden": "true",
                  },
                  me ? initialsOf(me.nick) : "我",
                ),
                h("span", { className: "dchat-member-name" }, me ? me.nick : t("me")),
                h("span", { className: "dchat-member-tag" }, t("you")),
              ),
              ...peers.map((peer) =>
                h(
                  "div",
                  { key: "member-" + peer.id, className: "dchat-member-row" },
                  h(
                    "span",
                    { className: "dchat-avatar", style: { background: avatarColor(peer.id) }, "aria-hidden": "true" },
                    initialsOf(peer.nick),
                  ),
                  h("span", { className: "dchat-member-name" }, String(peer.label || peer.nick || t("anonymous"))),
                  h("span", { className: "dchat-peer-state" + (peer.online ? " online" : "") }),
                  h("span", { className: "dchat-member-tag" }, peer.online ? t("online") : t("offline")),
                ),
              ),
              h(
                "div",
                { className: "dchat-invite-actions" },
                h(
                  "button",
                  {
                    type: "button",
                    className: "dchat-btn",
                    onClick: () => {
                      setMembersOpen(false);
                      openInvite();
                    },
                  },
                  t("inviteMembers"),
                ),
              ),
            ),
          )
        : null;

      const replyBar = replyTo
        ? h(
            "div",
            { className: "dchat-reply-bar" },
            h(
              "div",
              { className: "dchat-reply-info" },
              h(
                "div",
                { className: "dchat-reply-name" },
                t("replyTo") + " " + (replyTo.mine ? t("you") : String(replyTo.nick || t("anonymous"))),
              ),
              h("div", { className: "dchat-reply-text" }, String(replyTo.text || "").slice(0, 120)),
            ),
            h(
              "button",
              {
                type: "button",
                className: "dchat-icon-btn",
                "aria-label": t("cancelReply"),
                title: t("cancelReply"),
                onClick: () => setReplyTo(null),
              },
              CLOSE_ICON,
            ),
          )
        : null;

      const previewView = preview
        ? h(
            "div",
            {
              className: "dchat-lightbox",
              role: "dialog",
              "aria-label": t("imagePreview"),
              onClick: () => setPreview(null),
            },
            h("img", {
              className: "dchat-lightbox-img",
              src: preview.url,
              alt: preview.name,
              onClick: (event) => event.stopPropagation(),
            }),
            h(
              "div",
              { className: "dchat-lightbox-actions" },
              h(
                "a",
                { className: "dchat-btn", href: preview.url, download: preview.name },
                t("download"),
              ),
              h(
                "button",
                { type: "button", className: "dchat-btn ghost", onClick: () => setPreview(null) },
                t("closePreview"),
              ),
            ),
          )
        : null;

      const composer = h(
        "div",
        { className: "dchat-composer" },
        h(
          "button",
          {
            type: "button",
            className: "dchat-icon-btn dchat-attach",
            "aria-label": t("attach"),
            title: t("attach"),
            disabled: Boolean(uploading),
            onClick: () => fileInputRef.current && fileInputRef.current.click(),
          },
          ATTACH_ICON,
        ),
        h("input", {
          ref: fileInputRef,
          type: "file",
          style: { display: "none" },
          "aria-hidden": "true",
          tabIndex: -1,
          onChange: (event) => {
            const file = event.target.files && event.target.files[0];
            if (file) void uploadFile(file);
          },
        }),
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
          ? h("span", { className: "dchat-status-lock" }, LOCK_ICON, t("encrypted"))
          : h("span", { className: "dchat-status-lock" }, t("plain"))
        : "";
      const headSubParts = [
        status.text,
        lockBadge,
        snapshot ? t("peers") + " " + peers.length + (peersOnline > 0 ? " · " + t("online") + " " + peersOnline : "") : "",
        snapshot && snapshot.room ? "# " + snapshot.room : "",
      ].filter(Boolean);
      const headSub =
        typingLabel ||
        h(
          "span",
          { className: "dchat-head-sub-parts" },
          ...headSubParts.flatMap((part, index) =>
            index === 0 ? [part] : [" · ", part],
          ),
        );
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
        { className: "dchat-side" + (sideOpen ? " open" : ""), "aria-label": t("contacts") },
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
              h("span", { className: "dchat-btn-icon" }, COMPASS_ICON),
              t("findFriends") + (pendingList.length > 0 ? " · " + pendingList.length : ""),
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
          "button",
          {
            type: "button",
            className: "dchat-icon-btn dchat-hamburger",
            "aria-label": t("sideToggle"),
            title: t("sideToggle"),
            onClick: () => setSideOpen((open) => !open),
          },
          MENU_ICON,
        ),
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
              ? h("span", { className: "dchat-head-agent", title: t("agentOn"), "aria-label": t("agentOn") }, BOT_ICON)
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
              "aria-label": t("menu"),
              title: t("more"),
              "aria-expanded": menuOpen ? "true" : "false",
              onClick: () => setMenuOpen((open) => !open),
            },
            MORE_ICON,
          ),
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
            uploading
              ? h(
                  "div",
                  { className: "dchat-uploading" },
                  h("span", { className: "dchat-spinner", "aria-hidden": "true" }),
                  t("uploading") + " " + uploading.name,
                )
              : null,
            replyBar,
            composer,
          ),
        ),
        sideOpen ? h("div", { className: "dchat-side-backdrop", onClick: () => setSideOpen(false) }) : null,
        menuOpen ? h("div", { className: "dchat-menu-backdrop", onClick: () => setMenuOpen(false) }) : null,
        menuView,
        inviteView,
        friendsView,
        createView,
        onboardingView,
        membersView,
        previewView,
        toast ? h("div", { className: "dchat-toast" }, toast) : null,
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
