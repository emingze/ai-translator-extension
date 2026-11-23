(() => {
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED",
    "SVG", "CANVAS", "VIDEO", "AUDIO", "TEXTAREA", "INPUT",
    "SELECT", "OPTION", "CODE", "PRE", "BUTTON"
  ]);
  const MAX_NODES = 400;

  const originals = new Map();
  let translating = false;
  let selectionText = "";
  let selectionPoint = { x: 0, y: 0 };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function root() {
    return document.documentElement || document.body;
  }

  function place(node, x, y) {
    const width = node.offsetWidth || 320;
    const height = node.offsetHeight || 120;
    node.style.left = `${Math.max(12, Math.min(x, window.innerWidth - width - 12))}px`;
    node.style.top = `${Math.max(12, Math.min(y, window.innerHeight - height - 12))}px`;
  }

  function getUi(id) {
    return document.getElementById(id);
  }

  function removeUi(id) {
    getUi(id)?.remove();
  }

  function toast(message, duration = 3200) {
    removeUi("ait-toast");
    const box = element("div", "ait-toast", message);
    box.id = "ait-toast";
    root().appendChild(box);
    setTimeout(() => box.remove(), duration);
  }

  function isVisible(node) {
    const style = getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function collectTextNodes() {
    const groups = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest('[id^="ait-"], script, style, noscript, code, pre, textarea, select')) {
          return NodeFilter.FILTER_REJECT;
        }
        const value = node.nodeValue.trim();
        if (value.length < 2 || !/[\p{L}\p{N}]/u.test(value)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (!isVisible(parent) || originals.has(node)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const key = node.nodeValue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(node);
      if (groups.size >= MAX_NODES) break;
    }
    return groups;
  }

  function chunkTexts(texts, maxCount = 25, maxChars = 2600) {
    const chunks = [];
    let current = [];
    let chars = 0;
    for (const text of texts) {
      if (current.length && (current.length >= maxCount || chars + text.length > maxChars)) {
        chunks.push(current);
        current = [];
        chars = 0;
      }
      current.push(text);
      chars += text.length;
    }
    if (current.length) chunks.push(current);
    return chunks;
  }

  function showBadge(label, finished = false) {
    let badge = getUi("ait-badge");
    if (!badge) {
      badge = element("div", "ait-badge");
      badge.id = "ait-badge";
      const labelNode = element("span", "ait-badge-label");
      const button = element("button", "ait-badge-btn", "恢复原文");
      button.addEventListener("click", restorePage);
      badge.append(labelNode, button);
      root().appendChild(badge);
    }
    badge.querySelector(".ait-badge-label").textContent = label;
    badge.classList.toggle("ait-badge-done", finished);
    badge.querySelector(".ait-badge-btn").hidden = !finished || !originals.size;
  }

  function restorePage() {
    for (const [node, value] of originals) node.nodeValue = value;
    originals.clear();
    removeUi("ait-badge");
    toast("已恢复原文");
  }

  async function togglePageTranslation() {
    if (translating) return;
    if (originals.size) {
      restorePage();
      return;
    }
    const groups = collectTextNodes();
    if (!groups.size) {
      toast("当前页面没有可翻译的文本");
      return;
    }
    translating = true;
    const texts = [...groups.keys()];
    showBadge(`正在翻译 0/${texts.length}`);
    let done = 0;
    try {
      for (const chunk of chunkTexts(texts)) {
        const response = await chrome.runtime.sendMessage({
          type: "TRANSLATE_BATCH",
          texts: chunk
        });
        if (!response?.ok) throw new Error(response?.error || "翻译失败");
        chunk.forEach((text, index) => {
          const translated = response.translations[index];
          for (const node of groups.get(text)) {
            if (!originals.has(node)) originals.set(node, node.nodeValue);
            if (translated) node.nodeValue = translated;
          }
        });
        done += chunk.length;
        showBadge(`正在翻译 ${done}/${texts.length}`);
      }
      showBadge(`翻译完成 · ${texts.length} 段`, true);
    } catch (error) {
      console.error("[AI 翻译助手]", error);
      showBadge(`翻译中断 (${done}/${texts.length})`, true);
      toast(`翻译失败：${error.message}`, 5000);
    } finally {
      translating = false;
    }
  }

  function showToolbar() {
    removeUi("ait-selection-toolbar");
    const button = element("button", "ait-selection-btn", "译");
    button.id = "ait-selection-toolbar";
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      removeUi("ait-selection-toolbar");
      translateSelection(selectionText, selectionPoint);
    });
    root().appendChild(button);
    place(button, selectionPoint.x - 20, selectionPoint.y - 46);
  }

  async function translateSelection(text, point, providedTranslation = null) {
    removeUi("ait-selection-card");
    const card = element("div", "ait-card ait-selection-card");
    card.id = "ait-selection-card";
    const header = element("div", "ait-card-header");
    header.append(element("strong", "", "划词翻译"));
    const close = element("button", "ait-icon-btn", "×");
    close.addEventListener("click", () => card.remove());
    header.appendChild(close);
    const original = element("div", "ait-original", text.length > 180 ? `${text.slice(0, 180)}…` : text);
    const body = element("div", "ait-card-body");
    const loading = element("div", "ait-loading", "翻译中…");
    body.append(original, loading);
    card.appendChild(header);
    card.appendChild(body);
    root().appendChild(card);
    place(card, point.x - 150, point.y + 18);
    try {
      let translation = providedTranslation;
      if (translation == null) {
        const response = await chrome.runtime.sendMessage({
          type: "TRANSLATE_TEXT",
          text
        });
        if (!response?.ok) throw new Error(response?.error || "翻译失败");
        translation = response.translation;
      }
      loading.remove();
      body.appendChild(element("div", "ait-translation", translation));
      const copy = element("button", "ait-copy-btn", "复制译文");
      copy.addEventListener("click", async () => {
        await navigator.clipboard.writeText(translation);
        copy.textContent = "已复制";
      });
      body.appendChild(copy);
      place(card, point.x - 150, point.y + 18);
    } catch (error) {
      loading.textContent = `翻译失败：${error.message}`;
      loading.classList.add("ait-error");
      place(card, point.x - 150, point.y + 18);
    }
  }

  function showTranslation(text, translation) {
    translateSelection(text, { x: window.innerWidth / 2, y: 120 }, translation);
  }

  function showError(message) {
    toast(message, 6000);
  }

  function extractPageText() {
    const main = document.querySelector("article, main, [role='main']");
    const source = main || document.body;
    const text = (source?.innerText || source?.textContent || "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return text.slice(0, 16000);
  }

  async function summarizePage(showPanel = true) {
    removeUi("ait-summary-panel");
    const text = extractPageText();
    if (!text) {
      toast("页面没有可总结的内容");
      return { ok: false, error: "页面没有可总结的内容" };
    }
    let panel;
    let body;
    if (showPanel) {
      panel = element("div", "ait-panel");
      panel.id = "ait-summary-panel";
      const header = element("div", "ait-card-header");
      header.append(element("strong", "", "网页总结"));
      const close = element("button", "ait-icon-btn", "×");
      close.addEventListener("click", () => panel.remove());
      header.appendChild(close);
      body = element("div", "ait-panel-body");
      body.appendChild(element("div", "ait-loading", "正在读取网页并生成总结…"));
      panel.append(header, body);
      root().appendChild(panel);
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: "SUMMARIZE_TEXT",
        text
      });
      if (!response?.ok) throw new Error(response?.error || "总结失败");
      if (panel) {
        body.textContent = "";
        body.appendChild(element("div", "ait-summary-text", response.summary));
        const copy = element("button", "ait-copy-btn", "复制总结");
        copy.addEventListener("click", async () => {
          await navigator.clipboard.writeText(response.summary);
          copy.textContent = "已复制";
        });
        body.appendChild(copy);
      }
      return { ok: true, summary: response.summary };
    } catch (error) {
      if (panel) {
        body.textContent = "";
        body.appendChild(element("div", "ait-error", `总结失败：${error.message}`));
      }
      toast(`总结失败：${error.message}`, 6000);
      return { ok: false, error: error.message };
    }
  }

  document.addEventListener("mouseup", (event) => {
    if (event.target?.closest?.('[id^="ait-"]')) return;
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() || "";
      if (!text || text.length > 2000 || !/[\p{L}]/u.test(text)) {
        removeUi("ait-selection-toolbar");
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      selectionText = text;
      selectionPoint = {
        x: Math.max(12, rect.left + rect.width / 2),
        y: Math.max(12, rect.top)
      };
      showToolbar();
    }, 10);
  });

  document.addEventListener("mousedown", (event) => {
    if (!event.target?.closest?.(".ait-selection-btn, .ait-selection-card")) {
      removeUi("ait-selection-toolbar");
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message?.type) {
      case "TOGGLE_PAGE_TRANSLATION":
        togglePageTranslation();
        sendResponse({ ok: true });
        break;
      case "SUMMARIZE_PAGE":
        summarizePage(message.showPanel !== false).then(sendResponse);
        return true;
      case "SHOW_TRANSLATION":
        showTranslation(message.text, message.translation);
        sendResponse({ ok: true });
        break;
      case "SHOW_ERROR":
        showError(message.message);
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: "未知消息类型" });
    }
    return false;
  });
})();
