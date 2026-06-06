const DEFAULT_TEMPLATES = [
  {
    id: "notification",
    title: "通知",
    description: "发送通用通知短信",
    content: "【通知】{{message}}",
    variables: [
      { name: "message", label: "通知内容", required: true }
    ]
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

const TEMPLATE_ENV = {
  notification: "SMS_TEMPLATE_NOTIFICATION",
  "verification-code": "SMS_TEMPLATE_VERIFICATION_CODE"
};

function templateContent(template) {
  return process.env[TEMPLATE_ENV[template.id]] || template.content;
}

function listTemplates() {
  return DEFAULT_TEMPLATES.map((template) => ({
    ...template,
    content: templateContent(template)
  }));
}

function getTemplate(id) {
  return listTemplates().find((template) => template.id === id);
}

function extractPlaceholders(content) {
  return [...String(content).matchAll(/{{\s*([A-Za-z0-9_.-]+)\s*}}/g)]
    .map((match) => match[1]);
}

function renderTemplate(id, values = {}) {
  const template = getTemplate(id);
  if (!template) throw new Error(`未知短信模板：${id}`);

  const content = template.content;
  const requiredNames = new Set([
    ...template.variables.filter((item) => item.required).map((item) => item.name),
    ...extractPlaceholders(content)
  ]);
  const missing = [...requiredNames].filter((name) => {
    const value = values[name] ?? template.variables.find((item) => item.name === name)?.default;
    return value === undefined || value === null || String(value).trim() === "";
  });
  if (missing.length) throw new Error(`模板缺少变量：${missing.join(", ")}`);

  return content.replace(/{{\s*([A-Za-z0-9_.-]+)\s*}}/g, (_, name) => {
    const variable = template.variables.find((item) => item.name === name);
    return String(values[name] ?? variable?.default ?? "");
  });
}

module.exports = {
  listTemplates,
  renderTemplate
};
