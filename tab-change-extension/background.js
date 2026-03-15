// MRU (Most Recently Used) タブリスト管理
let mruList = []; // タブIDの配列（先頭が最新）

// MRUリストをsession storageに保存
async function saveMruList() {
  await chrome.storage.session.set({ mruList });
}

// MRUリストをsession storageから復元
async function loadMruList() {
  const data = await chrome.storage.session.get("mruList");
  if (data.mruList) {
    mruList = data.mruList;
  }
}

// 初期化: 既存タブからMRUリストを構築
async function initializeMruList() {
  await loadMruList();

  const tabs = await chrome.tabs.query({});
  const existingIds = new Set(tabs.map((t) => t.id));

  // 既に存在しないタブをリストから除去
  mruList = mruList.filter((id) => existingIds.has(id));

  // リストにないタブを末尾に追加
  const inList = new Set(mruList);
  for (const tab of tabs) {
    if (!inList.has(tab.id)) {
      mruList.push(tab.id);
    }
  }

  // アクティブタブを先頭に
  const activeTabs = tabs.filter((t) => t.active);
  for (const tab of activeTabs) {
    moveToFront(tab.id);
  }

  await saveMruList();
}

// タブIDをMRUリストの先頭に移動
function moveToFront(tabId) {
  const idx = mruList.indexOf(tabId);
  if (idx > 0) {
    mruList.splice(idx, 1);
  }
  if (idx !== 0) {
    mruList.unshift(tabId);
  }
}

// タブがアクティブになったとき
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  moveToFront(activeInfo.tabId);
  await saveMruList();
});

// タブが閉じられたとき
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const idx = mruList.indexOf(tabId);
  if (idx !== -1) {
    mruList.splice(idx, 1);
    await saveMruList();
  }
});

// 新規タブが作成されたとき
chrome.tabs.onCreated.addListener(async (tab) => {
  moveToFront(tab.id);
  await saveMruList();
});

// メッセージハンドラ
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getTabList") {
    handleGetTabList(sender.tab?.id).then(sendResponse);
    return true; // 非同期レスポンスを示す
  }

  if (message.type === "switchTab") {
    handleSwitchTab(message.tabId).then(sendResponse);
    return true;
  }
});

// タブ情報を返す（ブラウザの並び順、MRUで直前タブのIDも返す）
async function handleGetTabList(senderTabId) {
  // Content Scriptが注入できないURLを除外
  const isAccessible = (url) =>
    url &&
    !url.startsWith("chrome://") &&
    !url.startsWith("chrome-extension://") &&
    !url.startsWith("chrome-search://") &&
    !url.startsWith("chrome-devtools://") &&
    !url.startsWith("edge://") &&
    !url.startsWith("about:") &&
    !url.startsWith("chrome:untab");

  // ブラウザのタブ並び順（windowId, index）で取得
  const tabs = await chrome.tabs.query({});
  tabs.sort((a, b) => a.windowId - b.windowId || a.index - b.index);

  const result = tabs
    .filter((tab) => isAccessible(tab.url))
    .map((tab) => ({
      id: tab.id,
      title: tab.title || "New Tab",
      favIconUrl: tab.favIconUrl || "",
      url: tab.url || "",
      windowId: tab.windowId,
    }));

  return { tabs: result, currentTabId: senderTabId };
}

// 指定タブにフォーカスを移す
async function handleSwitchTab(tabId) {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Service Worker起動時の初期化
initializeMruList();
