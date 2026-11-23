const $ = (id) => document.getElementById(id);

let saveTimer;
let toastTimer;

function setMessage(text, type = "") {
  const node = $("settingsMsg");
  node.textContent = text;
  node.className = `msg ${type}`;
}

function showToast(text) {
  const node = $("popupToast");
  node.textContent = text;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2600);
}

function showResult(title, text) {
  const node = $("result");
  node.textContent = "";
  const heading = document.createElement("span");
  heading.className = "result-title";
  heading.textContent = title;
  node.append(heading, document.createTextNode(text));
  node.hidden = false;
}

function currentConfig() {
  return {
    apiKey: $("apiKey").value.trim(),
    baseUrl: $("baseUrl").value.trim(),
    model: $("model").value.trim(),
    direction: document.querySelector('input[name="direction"]:checked').value
  };
}

async function saveConfig(announce = true) {
  clearTimeout(saveTimer);
  await chrome.storage.local.set(currentConfig());
  if (announce) {
    $("saveStatus").textContent = "已保存";
    setTimeout(() => { $("saveStatus").textContent = ""; }, 2000);
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveConfig(false), 500);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToTab(message) {
  const tab = await activeTab();
  if (!tab?.id) throw new Error("无法获取当前标签页");
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    throw new Error("请刷新网页后重试");
  }
}

async function init() {
  const config = await chrome.storage.local.get([
    "apiKey", "baseUrl", "model", "direction"
  ]);
  $("apiKey").value = config.apiKey || "";
  $("baseUrl").value = config.baseUrl || "";
  $("model").value = config.model || "";
  const direction = config.direction || "auto";
  const radio = document.querySelector(`input[name="direction"][value="${direction}"]`);
  if (radio) radio.checked = true;
}

["apiKey", "baseUrl", "model"].forEach((id) => {
  $(id).addEventListener("input", scheduleSave);
});
document.querySelectorAll('input[name="direction"]').forEach((node) => {
  node.addEventListener("change", scheduleSave);
});

$("toggleKey").addEventListener("click", () => {
  const input = $("apiKey");
  const visible = input.type === "text";
  input.type = visible ? "password" : "text";
  $("toggleKey").textContent = visible ? "显示" : "隐藏";
});

$("saveConfig").addEventListener("click", async () => {
  await saveConfig();
  setMessage("设置已保存到本地", "success");
});

$("testConnection").addEventListener("click", async () => {
  await saveConfig(false);
  setMessage("正在测试连接…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "TEST_CONNECTION" });
    if (!response?.ok) throw new Error(response?.error || "连接失败");
    setMessage(`连接成功，模型返回：${response.reply.slice(0, 40)}`, "success");
  } catch (error) {
    setMessage(`连接失败：${error.message}`, "error");
  }
});

$("translatePage").addEventListener("click", async () => {
  await saveConfig(false);
  try {
    await sendToTab({ type: "TOGGLE_PAGE_TRANSLATION" });
    showToast("已发送至当前网页");
  } catch (error) {
    showToast(error.message);
  }
});

$("summarizePage").addEventListener("click", async () => {
  await saveConfig(false);
  setMessage("正在总结网页…");
  try {
    const response = await sendToTab({ type: "SUMMARIZE_PAGE", showPanel: false });
    if (!response?.ok) throw new Error(response?.error || "总结失败");
    showResult("网页总结", response.summary);
    setMessage("总结完成", "success");
  } catch (error) {
    setMessage(`总结失败：${error.message}`, "error");
  }
});

$("quickTranslate").addEventListener("click", async () => {
  const text = $("quickInput").value.trim();
  if (!text) {
    showToast("请输入要翻译的文字");
    return;
  }
  await saveConfig(false);
  setMessage("正在翻译…");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "TRANSLATE_TEXT",
      text
    });
    if (!response?.ok) throw new Error(response?.error || "翻译失败");
    showResult("翻译结果", response.translation);
    setMessage("翻译完成", "success");
  } catch (error) {
    setMessage(`翻译失败：${error.message}`, "error");
  }
});

$("clearResult").addEventListener("click", () => {
  $("quickInput").value = "";
  $("result").hidden = true;
  setMessage("");
});

init();
