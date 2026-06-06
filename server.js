const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs/promises");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const ROUTER_BASE = process.env.HILINK_BASE || "http://192.168.7.1";
const STATIC_ROOT = path.join(__dirname, "public");
const DEBUG = process.env.DEBUG_HILINK === "1";

const ERROR_MESSAGES = {
  "100002": "设备拒绝了这个请求",
  "100003": "尚未登录或会话已过期",
  "108003": "已有用户登录设备",
  "108006": "账号或密码不正确",
  "108007": "密码错误次数过多，请稍后再试",
  "108010": "设备登录过于频繁，请稍后再试",
  "125001": "请求校验已过期",
  "125002": "登录会话已过期"
};

const BOX_TYPES = {
  inbox: 1,
  sent: 2,
  drafts: 3,
  trash: 4,
  simInbox: 5,
  simSent: 6,
  simDrafts: 7,
  allInbox: 8,
  allSent: 9,
  allDrafts: 10
};

function escapeXml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&apos;",
    "\"": "&quot;"
  })[char]);
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&");
}

function tag(xml, name) {
  const match = String(xml).match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match ? decodeXml(match[1]) : "";
}

function tagBlocks(xml, name) {
  return [...String(xml).matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g"))]
    .map((match) => match[1]);
}

function parseCode(xml) {
  const code = tag(xml, "code");
  return code || "";
}

function xmlRequest(fields) {
  const body = Object.entries(fields).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `<${key}>${value.map((item) => `<${key.slice(0, -1)}>${escapeXml(item)}</${key.slice(0, -1)}>`).join("")}</${key}>`;
    }
    return `<${key}>${escapeXml(value)}</${key}>`;
  }).join("");
  return `<request>${body}</request>`;
}

function smsListRequest({ page = 1, pageSize = 20, box = "inbox" }) {
  const boxType = BOX_TYPES[box] || BOX_TYPES.inbox;
  return [
    "<request>",
    `<PageIndex>${Number(page) || 1}</PageIndex>`,
    `<ReadCount>${Math.min(Math.max(Number(pageSize) || 20, 1), 50)}</ReadCount>`,
    `<BoxType>${boxType}</BoxType>`,
    "<SortType>0</SortType>",
    "<Ascending>0</Ascending>",
    "<UnreadPreferred>0</UnreadPreferred>",
    "</request>"
  ].join("");
}

function huaweiScramProof(password, saltHex, iterations, authMessage) {
  const salted = crypto.pbkdf2Sync(
    Buffer.from(password, "utf8"),
    Buffer.from(saltHex, "hex"),
    Number(iterations),
    32,
    "sha256"
  );
  const clientKey = crypto.createHmac("sha256", Buffer.from("Client Key", "utf8")).update(salted).digest();
  const storedKey = crypto.createHash("sha256").update(clientKey).digest();
  const clientSignature = crypto.createHmac("sha256", Buffer.from(authMessage, "utf8")).update(storedKey).digest();
  return Buffer.from(clientKey.map((byte, index) => byte ^ clientSignature[index])).toString("hex");
}

function tokenLabel(tokenValue) {
  if (!tokenValue) return "-";
  return crypto.createHash("sha256").update(tokenValue).digest("hex").slice(0, 8);
}

function parseMessage(block) {
  return {
    index: tag(block, "Index"),
    phone: tag(block, "Phone"),
    content: tag(block, "Content"),
    date: tag(block, "Date"),
    smstat: tag(block, "Smstat"),
    sca: tag(block, "Sca"),
    saveType: tag(block, "SaveType"),
    priority: tag(block, "Priority"),
    smsType: tag(block, "SmsType")
  };
}

function parseSmsList(xml) {
  return {
    count: Number(tag(xml, "Count") || 0),
    messages: tagBlocks(xml, "Message").map(parseMessage)
  };
}

function parseSmsCount(xml) {
  const fields = [
    "LocalUnread",
    "LocalInbox",
    "LocalOutbox",
    "LocalDraft",
    "LocalDeleted",
    "SimUnread",
    "SimInbox",
    "SimOutbox",
    "SimDraft",
    "LocalMax",
    "SimMax",
    "SimUsed",
    "NewMsg"
  ];
  return Object.fromEntries(fields.map((field) => [field, Number(tag(xml, field) || 0)]));
}

function parseSendStatus(xml) {
  return {
    phone: tag(xml, "Phone"),
    sucPhone: tag(xml, "SucPhone"),
    failPhone: tag(xml, "FailPhone"),
    totalCount: Number(tag(xml, "TotalCount") || 0),
    curIndex: Number(tag(xml, "CurIndex") || 0),
    status: Number(tag(xml, "Status") || 0)
  };
}

function parseFlatResponse(xml) {
  const data = {};
  for (const match of String(xml).matchAll(/<([A-Za-z0-9_]+)>([^<>]*)<\/\1>/g)) {
    const key = match[1];
    if (key !== "response" && key !== "request") data[key] = decodeXml(match[2]);
  }
  return data;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") || "";
}

function parseNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function networkLabel(value) {
  const labels = {
    "0": "无服务",
    "1": "GSM",
    "2": "GPRS",
    "3": "EDGE",
    "4": "WCDMA",
    "5": "HSDPA",
    "6": "HSUPA",
    "7": "HSPA",
    "19": "LTE"
  };
  return labels[String(value)] || String(value || "");
}

function connectionLabel(value) {
  const labels = {
    "0": "断开",
    "1": "已连接",
    "2": "连接中",
    "3": "断开中"
  };
  return labels[String(value)] || String(value || "");
}

class HiLinkClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.cookies = new Map();
    this.tokens = [];
    this.loggedIn = false;
    this.username = "";
  }

  reset() {
    this.cookies.clear();
    this.tokens = [];
    this.loggedIn = false;
    this.username = "";
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  rememberCookies(headers) {
    const values = typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie")].filter(Boolean);
    for (const item of values) {
      const first = item.split(";")[0];
      const eq = first.indexOf("=");
      if (eq > 0) this.cookies.set(first.slice(0, eq), first.slice(eq + 1));
    }
  }

  extractTokens(headers) {
    const get = (name) => {
      for (const [key, value] of headers) {
        if (key.toLowerCase() === name.toLowerCase()) return value;
      }
      return "";
    };
    const tokenOne = get("__RequestVerificationTokenone");
    if (tokenOne) {
      const tokenTwo = get("__RequestVerificationTokentwo");
      return tokenTwo ? [tokenOne, tokenTwo] : [tokenOne];
    }
    const token = get("__RequestVerificationToken");
    return token ? [token] : [];
  }

  async request(endpoint, options = {}, retry = true) {
    const method = options.method || "GET";
    const headers = {
      "_ResponseSource": "Broswer"
    };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    if (method !== "GET") headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
    if (options.token) {
      if (!this.tokens.length) await this.refreshToken();
      headers.__RequestVerificationToken = this.tokens.shift();
    }
    const usedToken = headers.__RequestVerificationToken || "";

    const response = await fetch(`${this.baseUrl}/${endpoint.replace(/^\//, "")}`, {
      method,
      headers,
      body: method === "GET" ? undefined : options.body
    });
    this.rememberCookies(response.headers);
    const responseTokens = this.extractTokens(response.headers);
    const text = await response.text();
    const code = parseCode(text);

    this.tokens.push(...responseTokens);
    if (DEBUG) {
      console.log(JSON.stringify({
        endpoint,
        method,
        usedToken: tokenLabel(usedToken),
        responseTokens: responseTokens.map(tokenLabel),
        queuedTokens: this.tokens.map(tokenLabel),
        code: code || "ok"
      }));
    }

    if (code === "125001" && retry) {
      await this.refreshToken();
      return this.request(endpoint, options, false);
    }
    if (code === "125002") this.loggedIn = false;
    if (code) {
      const message = ERROR_MESSAGES[code] || `设备返回错误 ${code}`;
      const error = new Error(message);
      error.code = code;
      throw error;
    }
    return text;
  }

  async initializeSession() {
    const html = await this.request("/html/home.html");
    const metaTokens = [...html.matchAll(/name=["']csrf_token["']\s+content=["']([^"']+)/g)].map((match) => match[1]);
    this.tokens.push(...metaTokens);
  }

  async refreshToken() {
    const xml = await this.request("/api/webserver/token", { token: false });
    const tokenValue = tag(xml, "token");
    if (!tokenValue) throw new Error("无法从设备获取请求校验 token");
    this.tokens.push(tokenValue.length > 32 ? tokenValue.slice(32) : tokenValue);
  }

  async login(username, password) {
    this.reset();
    await this.initializeSession();
    this.tokens = [];
    await this.refreshToken();

    const firstNonce = crypto.randomBytes(16).toString("hex");
    const challengeXml = await this.request("/api/user/challenge_login", {
      method: "POST",
      token: true,
      body: xmlRequest({
        username,
        firstnonce: firstNonce,
        mode: 1
      })
    });

    const salt = tag(challengeXml, "salt");
    const iterations = tag(challengeXml, "iterations");
    const finalNonce = tag(challengeXml, "servernonce");
    if (!salt || !iterations || !finalNonce) throw new Error("设备登录挑战返回不完整");

    const authMessage = `${firstNonce},${finalNonce},${finalNonce}`;
    const clientProof = huaweiScramProof(password, salt, iterations, authMessage);
    await this.request("/api/user/authentication_login", {
      method: "POST",
      token: true,
      body: xmlRequest({
        clientproof: clientProof,
        finalnonce: finalNonce
      })
    });

    this.loggedIn = true;
    this.username = username;
    return this.state();
  }

  state() {
    return {
      loggedIn: this.loggedIn,
      username: this.username,
      router: this.baseUrl
    };
  }

  async logout() {
    if (this.loggedIn) {
      try {
        await this.request("/api/user/logout", {
          method: "POST",
          token: true,
          body: xmlRequest({ Logout: 1 })
        });
      } catch {
        // Local state still needs to be cleared if the router session has already expired.
      }
    }
    this.reset();
    return this.state();
  }

  async counts() {
    const xml = await this.request("/api/sms/sms-count");
    return parseSmsCount(xml);
  }

  async messages(params) {
    const xml = await this.request("/api/sms/sms-list", {
      method: "POST",
      token: true,
      body: smsListRequest(params)
    });
    return parseSmsList(xml);
  }

  async markRead(indexes) {
    const body = `<request>${indexes.map((index) => `<Index>${escapeXml(index)}</Index>`).join("")}</request>`;
    await this.request("/api/sms/set-read", { method: "POST", token: true, body });
    return { ok: true };
  }

  async delete(indexes) {
    const body = `<request>${indexes.map((index) => `<Index>${escapeXml(index)}</Index>`).join("")}</request>`;
    await this.request("/api/sms/delete-sms", { method: "POST", token: true, body });
    return { ok: true };
  }

  async send({ phones, content }) {
    const cleanPhones = [...new Set((phones || []).map((phone) => String(phone).trim()).filter(Boolean))];
    if (!cleanPhones.length) throw new Error("请输入收件人");
    if (!String(content || "").trim()) throw new Error("请输入短信内容");
    const phoneXml = cleanPhones.map((phone) => `<Phone>${escapeXml(phone)}</Phone>`).join("");
    const now = new Date();
    const date = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")
    ].join("-") + " " + [
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0")
    ].join(":");
    const body = [
      "<request>",
      "<Index>-1</Index>",
      `<Phones>${phoneXml}</Phones>`,
      "<Sca></Sca>",
      `<Content>${escapeXml(content)}</Content>`,
      `<Length>${String(content).length}</Length>`,
      "<Reserved>1</Reserved>",
      `<Date>${date}</Date>`,
      "</request>"
    ].join("");
    await this.request("/api/sms/send-sms", { method: "POST", token: true, body });
    return { ok: true };
  }

  async sendStatus() {
    const xml = await this.request("/api/sms/send-status");
    return parseSendStatus(xml);
  }

  async optionalXml(endpoint) {
    try {
      return parseFlatResponse(await this.request(endpoint));
    } catch (error) {
      return { error: error.code || error.message };
    }
  }

  async deviceInfo() {
    const [basic, information, status, plmn, traffic, converged, dataSwitch] = await Promise.all([
      this.optionalXml("/api/device/basic_information"),
      this.optionalXml("/api/device/information"),
      this.optionalXml("/api/monitoring/status"),
      this.optionalXml("/api/net/current-plmn"),
      this.optionalXml("/api/monitoring/traffic-statistics"),
      this.optionalXml("/api/monitoring/converged-status"),
      this.optionalXml("/api/dialup/mobile-dataswitch")
    ]);

    const signalBars = parseNumber(firstValue(status.SignalIcon, status.SignalStrength));
    const networkType = firstValue(status.CurrentNetworkType, status.Rat, plmn.Rat);
    const routerHost = new URL(this.baseUrl).hostname;
    return {
      deviceName: firstValue(basic.devicename, information.DeviceName, information.devicename),
      softwareVersion: firstValue(basic.SoftwareVersion, information.SoftwareVersion),
      webUiVersion: firstValue(basic.WebUIVersion, information.WebUIVersion),
      phoneNumber: firstValue(
        information.Msisdn,
        information.msisdn,
        information.MDN,
        information.PhoneNumber,
        information.MyNumber,
        status.Msisdn,
        status.PhoneNumber
      ),
      operator: firstValue(plmn.FullName, plmn.ShortName, plmn.Spn, status.CurrentNetworkName),
      operatorShort: firstValue(plmn.ShortName, plmn.Spn),
      networkType: networkLabel(networkType),
      signalBars,
      signalStrength: firstValue(status.SignalStrength, status.rssi),
      wanIp: firstValue(status.WanIPAddress, status.WanIPv4Address, status.WanIPv6Address, routerHost),
      connectionStatus: connectionLabel(firstValue(status.ConnectionStatus, status.WifiConnectionStatus)),
      dataSwitch: dataSwitch.dataswitch === "1" ? "已开启" : dataSwitch.dataswitch === "0" ? "已关闭" : "",
      simState: firstValue(converged.SimState, status.SimStatus, status.SimState),
      imei: firstValue(information.Imei, information.IMEI, information.imei),
      imsi: firstValue(information.Imsi, information.IMSI, information.imsi),
      iccid: firstValue(information.Iccid, information.ICCID, information.IccidNumber),
      serialNumber: firstValue(information.SerialNumber, information.Serial, information.serialnumber),
      currentDownloadRate: parseNumber(traffic.CurrentDownloadRate),
      currentUploadRate: parseNumber(traffic.CurrentUploadRate),
      currentConnectTime: parseNumber(traffic.CurrentConnectTime)
    };
  }
}

const client = new HiLinkClient(ROUTER_BASE);

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function requireLogin() {
  if (!client.loggedIn) {
    const error = new Error("请先登录设备");
    error.status = 401;
    throw error;
  }
}

async function api(request, response, pathname, searchParams) {
  if (request.method === "GET" && pathname === "/api/state") return sendJson(response, 200, client.state());
  if (request.method === "POST" && pathname === "/api/login") {
    const body = await readJson(request);
    if (!body.username || !body.password) throw new Error("请输入账号和密码");
    return sendJson(response, 200, await client.login(body.username, body.password));
  }
  if (request.method === "POST" && pathname === "/api/logout") return sendJson(response, 200, await client.logout());
  if (request.method === "GET" && pathname === "/api/counts") {
    requireLogin();
    return sendJson(response, 200, await client.counts());
  }
  if (request.method === "GET" && pathname === "/api/device-info") {
    requireLogin();
    return sendJson(response, 200, await client.deviceInfo());
  }
  if (request.method === "GET" && pathname === "/api/messages") {
    requireLogin();
    return sendJson(response, 200, await client.messages({
      box: searchParams.get("box") || "inbox",
      page: searchParams.get("page") || "1",
      pageSize: searchParams.get("pageSize") || "20"
    }));
  }
  if (request.method === "POST" && pathname === "/api/read") {
    requireLogin();
    const body = await readJson(request);
    return sendJson(response, 200, await client.markRead(body.indexes || [body.index].filter(Boolean)));
  }
  if (request.method === "POST" && pathname === "/api/delete") {
    requireLogin();
    const body = await readJson(request);
    return sendJson(response, 200, await client.delete(body.indexes || [body.index].filter(Boolean)));
  }
  if (request.method === "POST" && pathname === "/api/send") {
    requireLogin();
    const body = await readJson(request);
    return sendJson(response, 200, await client.send(body));
  }
  if (request.method === "GET" && pathname === "/api/send-status") {
    requireLogin();
    return sendJson(response, 200, await client.sendStatus());
  }
  sendJson(response, 404, { error: "Not found" });
}

async function staticFile(pathname, response) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(STATIC_ROOT, requested));
  if (!filePath.startsWith(STATIC_ROOT)) {
    response.writeHead(403);
    response.end();
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".svg": "image/svg+xml"
    }[ext] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname.startsWith("/api/")) {
      await api(request, response, url.pathname, url.searchParams);
    } else {
      await staticFile(url.pathname, response);
    }
  } catch (error) {
    const status = error.status || (error.code === "100003" ? 401 : 500);
    sendJson(response, status, {
      error: error.message || "请求失败",
      code: error.code || undefined
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`HiLink SMS Manager listening on http://${HOST}:${PORT}`);
});
