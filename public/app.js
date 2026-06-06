const state = {
  loggedIn: false,
  box: "inbox",
  page: 1,
  pageSize: 20,
  counts: {},
  device: {},
  messages: [],
  selected: null,
  templates: []
};

const titles = {
  inbox: "收件箱",
  sent: "已发送",
  drafts: "草稿",
  trash: "回收站"
};

const icons = {
  inbox: '<svg viewBox="0 0 24 24"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/></svg>',
  sent: '<svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
  draft: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 2v4h-4"/><path d="M6 22v-4h4"/></svg>',
  compose: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  message: '<svg viewBox="0 0 24 24"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m20 6-11 11-5-5"/></svg>',
  reply: '<svg viewBox="0 0 24 24"><path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>'
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function installIcons() {
  $$("[data-icon]").forEach((node) => {
    const key = node.dataset.icon;
    if (icons[key]) node.innerHTML = icons[key];
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove("show"), 2200);
}

function isUnread(message) {
  return String(message.smstat) === "0";
}

function updateShell() {
  $("#viewTitle").textContent = titles[state.box] || "短信";
  $("#viewMeta").textContent = state.loggedIn
    ? `${state.messages.length} / ${state.messagesTotal || 0}`
    : "正在连接设备";
  $$(".folder").forEach((button) => button.classList.toggle("active", button.dataset.box === state.box));
}

function updateCounts(counts = {}) {
  state.counts = counts;
  $("#badgeInbox").textContent = counts.LocalInbox ?? 0;
  $("#badgeSent").textContent = counts.LocalOutbox ?? 0;
  $("#badgeDrafts").textContent = counts.LocalDraft ?? 0;
  $("#badgeTrash").textContent = counts.LocalDeleted ?? 0;
  const used = (counts.LocalInbox || 0) + (counts.LocalOutbox || 0) + (counts.LocalDraft || 0) + (counts.LocalDeleted || 0);
  const max = counts.LocalMax || 500;
  $("#localUsage").textContent = `${used} / ${max}`;
  $("#usageFill").style.width = `${Math.min(100, Math.round((used / max) * 100))}%`;
}

function fallback(value) {
  return value === undefined || value === null || String(value).trim() === "" ? "-" : String(value);
}

function signalText(info = {}) {
  if (info.signalStrength && info.signalBars) return `${info.signalStrength} / ${info.signalBars} 格`;
  if (info.signalStrength) return `${info.signalStrength}`;
  if (info.signalBars) return `${info.signalBars} 格`;
  return "-";
}

function updateDeviceInfo(info = {}) {
  state.device = info;
  $("#devicePhone").textContent = fallback(info.phoneNumber);
  $("#deviceOperator").textContent = fallback(info.operator);
  $("#deviceSignal").textContent = signalText(info);
  $("#deviceIp").textContent = fallback(info.wanIp);
  $("#deviceNetwork").textContent = fallback(info.networkType || info.connectionStatus);
  $("#deviceModel").textContent = fallback(info.deviceName);
}

function defaultTemplates() {
  return [
    {
      id: "notification",
      title: "通知",
      description: "发送通用通知短信",
      content: "【通知】{{message}}",
      variables: [{ name: "message", label: "通知内容", required: true }]
    },
    {
      id: "verification-code",
      title: "验证码",
      description: "发送一次性验证码",
      content: "您的验证码是 {{code}}，{{ttl}} 分钟内有效。",
      variables: [
        { name: "code", label: "验证码", required: true },
        { name: "ttl", label: "有效期（分钟）", required: true, default: "5" }
      ]
    }
  ];
}

async function loadTemplates() {
  try {
    const data = await api("/api/templates");
    state.templates = Array.isArray(data.templates) ? data.templates : defaultTemplates();
  } catch {
    state.templates = defaultTemplates();
  }
  renderTemplates();
}

function renderTemplates() {
  const list = $("#templateList");
  if (!list) return;
  list.innerHTML = "";
  if (!state.templates.length) {
    list.innerHTML = '<div class="template-empty">暂无模板</div>';
    return;
  }
  for (const template of state.templates) {
    const item = document.createElement("div");
    item.className = "template-item";
    item.innerHTML = `
      <button class="template-use" type="button">
        <strong>${escapeHtml(template.title)}</strong>
        <span>${escapeHtml(template.description || template.content)}</span>
      </button>
    `;
    item.querySelector(".template-use").addEventListener("click", () => applyTemplate(template));
    list.append(item);
  }
  installIcons();
}

function applyTemplate(template) {
  const values = {};
  for (const variable of template.variables || []) {
    const currentContent = $("#contentInput").value.trim();
    const fallback = variable.default || (variable.name === "code" ? randomCode() : "");
    const value = variable.name === "message" && currentContent
      ? currentContent
      : window.prompt(variable.label || variable.name, fallback);
    if (value === null) return;
    values[variable.name] = value;
  }
  $("#contentInput").value = renderTemplateContent(template.content, values);
  updateComposeMeta();
  $("#contentInput").focus();
}

function randomCode() {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
}

function renderTemplateContent(content, values = {}) {
  return String(content || "").replace(/{{\s*([A-Za-z0-9_.-]+)\s*}}/g, (_, name) => values[name] ?? "");
}

function renderList() {
  const list = $("#messageList");
  list.innerHTML = "";
  if (!state.loggedIn) {
    list.innerHTML = '<div class="empty-list"><span data-icon="message"></span><strong>正在连接设备</strong></div>';
    installIcons();
    return;
  }
  if (!state.messages.length) {
    list.innerHTML = '<div class="empty-list"><span data-icon="message"></span><strong>暂无短信</strong></div>';
    installIcons();
    return;
  }

  for (const message of state.messages) {
    const button = document.createElement("button");
    button.className = `message-card ${isUnread(message) ? "unread" : ""} ${state.selected?.index === message.index ? "selected" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <div class="message-card-head">
        <strong>${escapeHtml(message.phone || "未知号码")}</strong>
        <time>${escapeHtml(message.date || "")}</time>
      </div>
      <p>${escapeHtml(message.content || "")}</p>
      <div class="message-meta">
        <span>${state.box === "sent" ? "发出" : "本机"}</span>
        <span class="status-pill ${isUnread(message) ? "unread" : ""}">${isUnread(message) ? "未读" : "已读"}</span>
      </div>
    `;
    button.addEventListener("click", () => selectMessage(message));
    list.append(button);
  }
}

function renderDetail() {
  const detail = $("#messageDetail");
  if (!state.selected) {
    detail.innerHTML = `
      <div class="empty-detail">
        <span data-icon="message"></span>
        <h3>选择一条短信</h3>
        <p>暂无选择</p>
      </div>
    `;
    installIcons();
    return;
  }
  const message = state.selected;
  detail.innerHTML = `
    <article class="detail-card">
      <div class="detail-head">
        <div>
          <p class="detail-phone">${escapeHtml(message.phone || "未知号码")}</p>
          <p class="detail-date">${escapeHtml(message.date || "")}</p>
        </div>
        <span class="status-pill ${isUnread(message) ? "unread" : ""}">${isUnread(message) ? "未读" : "已读"}</span>
      </div>
      <p class="detail-content">${escapeHtml(message.content || "")}</p>
      <div class="message-actions">
        <button class="primary-button" id="replyButton">
          <span data-icon="reply"></span>
          <span>回复</span>
        </button>
        <button class="ghost-button" id="markReadButton">
          <span data-icon="check"></span>
          <span>标为已读</span>
        </button>
        <button class="danger-button" id="deleteButton">
          <span data-icon="trash"></span>
          <span>删除</span>
        </button>
      </div>
    </article>
  `;
  $("#replyButton").addEventListener("click", () => openComposer({
    title: "回复短信",
    phones: [message.phone].filter(Boolean)
  }));
  $("#markReadButton").disabled = !isUnread(message);
  $("#markReadButton").addEventListener("click", markSelectedRead);
  $("#deleteButton").addEventListener("click", deleteSelected);
  installIcons();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

async function selectMessage(message) {
  state.selected = message;
  renderList();
  renderDetail();
  if (isUnread(message)) {
    await api("/api/read", {
      method: "POST",
      body: JSON.stringify({ index: message.index })
    }).catch(() => null);
    message.smstat = "1";
    renderList();
    renderDetail();
    loadCounts().catch(() => null);
  }
}

async function loadState() {
  const data = await api("/api/state");
  state.loggedIn = data.loggedIn;
  $("#routerLabel").textContent = new URL(data.router).host;
  updateShell();
  renderList();
  renderDetail();
  if (!data.credentialsConfigured) throw new Error("请先在 .env 中设置 HILINK_USERNAME 和 HILINK_PASSWORD");
  await refreshAll();
}

async function loadCounts() {
  updateCounts(await api("/api/counts"));
}

async function loadDeviceInfo() {
  updateDeviceInfo(await api("/api/device-info"));
}

async function loadMessages() {
  const data = await api(`/api/messages?box=${encodeURIComponent(state.box)}&page=${state.page}&pageSize=${state.pageSize}`);
  state.messages = data.messages || [];
  state.messagesTotal = data.count || 0;
  if (!state.messages.some((message) => message.index === state.selected?.index)) state.selected = state.messages[0] || null;
  updateShell();
  renderList();
  renderDetail();
}

async function refreshAll() {
  await Promise.all([loadCounts(), loadMessages(), loadDeviceInfo()]);
  state.loggedIn = true;
  updateShell();
  renderList();
  renderDetail();
}

async function markSelectedRead() {
  if (!state.selected) return;
  await api("/api/read", {
    method: "POST",
    body: JSON.stringify({ index: state.selected.index })
  });
  state.selected.smstat = "1";
  toast("已标记");
  await refreshAll();
}

async function deleteSelected() {
  if (!state.selected) return;
  const index = state.selected.index;
  await api("/api/delete", {
    method: "POST",
    body: JSON.stringify({ index })
  });
  state.messages = state.messages.filter((message) => message.index !== index);
  state.selected = state.messages[0] || null;
  toast("已删除");
  await refreshAll();
}

function parsePhones(value) {
  return String(value || "")
    .split(/[,\n;，；\s]+/)
    .map((phone) => phone.trim())
    .filter(Boolean);
}

function updateComposeMeta() {
  const count = parsePhones($("#phonesInput").value).length;
  const chars = $("#contentInput").value.length;
  $("#composeMeta").textContent = `${count} 个收件人 · ${chars} 字`;
}

function openComposer({ title = "新短信", phones = [], content = "" } = {}) {
  $("#composeTitle").textContent = title;
  $("#composeError").textContent = "";
  $("#phonesInput").value = phones.join("\n");
  $("#contentInput").value = content;
  updateComposeMeta();
  renderTemplates();
  $("#composeDialog").showModal();
  (phones.length ? $("#contentInput") : $("#phonesInput")).focus();
}

function wireEvents() {
  $$(".folder").forEach((button) => {
    button.addEventListener("click", async () => {
      state.box = button.dataset.box;
      state.page = 1;
      state.selected = null;
      updateShell();
      await loadMessages().catch((error) => toast(error.message));
    });
  });

  $("#refreshButton").addEventListener("click", async () => {
    await refreshAll().then(() => toast("已刷新")).catch((error) => toast(error.message));
  });

  $("#deviceRefreshButton").addEventListener("click", async () => {
    await loadDeviceInfo().then(() => toast("设备信息已刷新")).catch((error) => toast(error.message));
  });

  $("#composeButton").addEventListener("click", () => openComposer());

  $("#closeCompose").addEventListener("click", () => $("#composeDialog").close());

  $("#contentInput").addEventListener("input", () => {
    updateComposeMeta();
  });

  $("#phonesInput").addEventListener("input", updateComposeMeta);

  $("#composeForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#composeError").textContent = "";
    try {
      await api("/api/send", {
        method: "POST",
        body: JSON.stringify({
          phones: parsePhones($("#phonesInput").value),
          content: $("#contentInput").value
        })
      });
      $("#composeDialog").close();
      $("#composeForm").reset();
      $("#composeTitle").textContent = "新短信";
      updateComposeMeta();
      toast("已提交发送");
      await refreshAll();
    } catch (error) {
      $("#composeError").textContent = error.message;
    }
  });
}

installIcons();
wireEvents();
loadTemplates();
loadState().catch((error) => {
  state.loggedIn = false;
  updateShell();
  renderList();
  toast(error.message);
});
