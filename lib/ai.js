const DEFAULT_MODEL = "deepseek-flash";
const REQUEST_TIMEOUT = 180000;

export async function getConfig() {
  const data = await chrome.storage.local.get([
    "apiKey",
    "baseUrl",
    "model",
    "direction"
  ]);
  return {
    apiKey: (data.apiKey || "").trim(),
    baseUrl: (data.baseUrl || "").trim(),
    model: (data.model || "").trim() || DEFAULT_MODEL,
    direction: data.direction || "auto"
  };
}

export function normalizeBaseUrl(input) {
  let url = (input || "").trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(url)) return url;
  if (/\/chat$/i.test(url)) return `${url}/completions`;
  if (/\/v\d+$/i.test(url)) return `${url}/chat/completions`;
  return `${url}/chat/completions`;
}

function targetLanguage(direction, text) {
  if (direction === "zh-en") return "en";
  if (direction === "en-zh") return "zh";
  return /[\u3400-\u9fff]/.test(text) ? "en" : "zh";
}

const languageName = (code) =>
  code === "zh" ? "Simplified Chinese" : "English";

async function chat(messages, maxTokens = 2048) {
  const config = await getConfig();
  if (!config.apiKey) throw new Error("请先在插件设置中填写 API Key");
  if (!config.baseUrl) throw new Error("请先在插件设置中填写 Base URL");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const response = await fetch(normalizeBaseUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.2,
        stream: false
      }),
      signal: controller.signal
    });
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`接口返回异常 (${response.status})：${raw.slice(0, 160)}`);
    }
    if (!response.ok) {
      throw new Error(data?.error?.message || `请求失败 (${response.status})`);
    }
    const message = data?.choices?.[0]?.message;
    let content = message?.content;
    if (Array.isArray(content)) {
      content = content
        .map((part) => (typeof part === "string" ? part : part.text || ""))
        .join("");
    }
    content = (content || "").trim();
    if (!content) {
      throw new Error("模型没有返回文本，请确认模型名称及 max_tokens 设置");
    }
    return content;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("请求超时，请检查网络或 Base URL");
    }
    if (error instanceof TypeError) {
      throw new Error("无法连接接口，请检查 Base URL 与网络代理设置");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonArray(content, expectedLength) {
  let text = content.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) {
    throw new Error("翻译结果格式不正确");
  }
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("翻译结果解析失败，请重试");
  }
  if (!Array.isArray(parsed)) throw new Error("翻译结果不是数组");
  return Array.from({ length: expectedLength }, (_, i) =>
    typeof parsed[i] === "string" ? parsed[i] : ""
  );
}

function chunkByLanguage(texts) {
  const groups = new Map();
  texts.forEach((text, index) => {
    const lang = targetLanguage("auto", text);
    if (!groups.has(lang)) groups.set(lang, []);
    groups.get(lang).push({ text, index });
  });
  return groups;
}

function chunkItems(items, maxCount, maxChars) {
  const chunks = [];
  let current = [];
  let chars = 0;
  for (const item of items) {
    const size = item.text.length;
    if (current.length && (current.length >= maxCount || chars + size > maxChars)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export async function translateTexts(texts, direction = "auto") {
  const results = new Array(texts.length).fill("");
  const groups =
    direction === "auto"
      ? chunkByLanguage(texts)
      : new Map([[targetLanguage(direction, texts[0] || ""), texts.map((text, index) => ({ text, index }))]]);

  for (const [lang, items] of groups) {
    for (const chunk of chunkItems(items, 25, 2600)) {
      const prompt = [
        `You are a professional translator. Translate every string in the JSON array into ${languageName(lang)}.`,
        "Preserve the original order, meaning, tone and punctuation. Keep placeholders and URLs unchanged.",
        "Return ONLY a valid JSON array of translated strings with exactly the same length. No explanations.",
        JSON.stringify(chunk.map((item) => item.text))
      ].join("\n");
      const output = await chat(
        [
          { role: "system", content: "You are a JSON-only translation engine." },
          { role: "user", content: prompt }
        ],
        4096
      );
      const translated = parseJsonArray(output, chunk.length);
      chunk.forEach((item, i) => {
        results[item.index] = translated[i] || item.text;
      });
    }
  }
  return results;
}

export async function translateOne(text, direction = "auto") {
  const [result] = await translateTexts([text], direction);
  return result;
}

export async function summarizeText(text, direction = "auto") {
  const clean = (text || "").replace(/\n{3,}/g, "\n\n").slice(0, 16000);
  if (!clean.trim()) throw new Error("页面没有可总结的内容");
  const lang = direction === "auto" ? (/[\u3400-\u9fff]/.test(clean.slice(0, 2000)) ? "zh" : "en") : direction;
  const prompt =
    lang === "zh"
      ? `请用简体中文总结以下网页内容。先给出一句话概述，再列出 3-6 个要点，使用简洁的项目符号。\n\n${clean}`
      : `Summarize the following web page content in English. Start with a one-sentence overview, then list 3-6 key points as concise bullets.\n\n${clean}`;
  return chat(
    [
      { role: "system", content: "You are an expert at summarizing web pages." },
      { role: "user", content: prompt }
    ],
    2048
  );
}

export async function testConnection() {
  const reply = await chat([{ role: "user", content: "Reply with exactly: OK" }], 512);
  return reply;
}
