import {
  translateOne,
  translateTexts,
  summarizeText,
  testConnection
} from "./lib/ai.js";

const MENU = {
  selection: "ait-translate-selection",
  page: "ait-translate-page",
  summary: "ait-summarize-page"
};

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU.selection,
      title: "翻译选中文字",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: MENU.page,
      title: "翻译整个网页",
      contexts: ["page"]
    });
    chrome.contextMenus.create({
      id: MENU.summary,
      title: "总结此网页",
      contexts: ["page"]
    });
  });
}

chrome.runtime.onInstalled.addListener(createMenus);
chrome.runtime.onStartup.addListener(createMenus);

function toTab(tabId, message) {
  if (tabId == null) return Promise.resolve(false);
  return chrome.tabs.sendMessage(tabId, message).then(
    () => true,
    () => false
  );
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU.page) {
    await toTab(tab?.id, { type: "TOGGLE_PAGE_TRANSLATION" });
    return;
  }
  if (info.menuItemId === MENU.summary) {
    await toTab(tab?.id, { type: "SUMMARIZE_PAGE", showPanel: true });
    return;
  }
  if (info.menuItemId === MENU.selection && info.selectionText?.trim()) {
    const text = info.selectionText.trim().slice(0, 2000);
    try {
      const translation = await translateOne(text);
      await toTab(tab?.id, {
        type: "SHOW_TRANSLATION",
        text,
        translation
      });
    } catch (error) {
      await toTab(tab?.id, { type: "SHOW_ERROR", message: error.message });
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case "TEST_CONNECTION": {
          const reply = await testConnection();
          sendResponse({ ok: true, reply });
          break;
        }
        case "TRANSLATE_TEXT": {
          const translation = await translateOne(
            String(message.text || "").slice(0, 8000),
            message.direction
          );
          sendResponse({ ok: true, translation });
          break;
        }
        case "TRANSLATE_BATCH": {
          const translations = await translateTexts(
            message.texts || [],
            message.direction
          );
          sendResponse({ ok: true, translations });
          break;
        }
        case "SUMMARIZE_TEXT": {
          const summary = await summarizeText(message.text, message.direction);
          sendResponse({ ok: true, summary });
          break;
        }
        default:
          sendResponse({ ok: false, error: "未知消息类型" });
      }
    } catch (error) {
      sendResponse({ ok: false, error: error.message || String(error) });
    }
  })();
  return true;
});
