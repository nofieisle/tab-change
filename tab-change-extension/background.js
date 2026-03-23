// MRU (Most Recently Used) タブリスト管理
let mruList = []; // タブIDの配列（先頭が最新）
let thumbnailCache = {}; // タブID → スクリーンショットのdata URL

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

// サムネイルをsession storageに保存
async function saveThumbnails() {
  try {
    await chrome.storage.session.set({ thumbnailCache });
  } catch (e) {
    // 容量超過時は古いものから削除
    const keys = Object.keys(thumbnailCache);
    if (keys.length > 20) {
      const toRemove = keys.slice(0, keys.length - 20);
      for (const k of toRemove) {
        delete thumbnailCache[k];
      }
      await chrome.storage.session.set({ thumbnailCache }).catch(() => {});
    }
  }
}

// サムネイルをsession storageから復元
async function loadThumbnails() {
  const data = await chrome.storage.session.get("thumbnailCache");
  if (data.thumbnailCache) {
    thumbnailCache = data.thumbnailCache;
  }
}

// 現在表示中のタブのスクリーンショットを撮影してキャッシュ
async function captureTab(tabId, windowId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "jpeg",
      quality: 30,
    });
    thumbnailCache[tabId] = dataUrl;
    saveThumbnails();
  } catch (e) {
    // キャプチャ失敗時は無視（chrome:// ページ等）
  }
}

// 初期化: 既存タブからMRUリストを構築
async function initializeMruList() {
  await loadMruList();
  await loadThumbnails();

  const tabs = await chrome.tabs.query({});
  const existingIds = new Set(tabs.map((t) => t.id));

  // 既に存在しないタブをリストから除去
  mruList = mruList.filter((id) => existingIds.has(id));

  // キャッシュからも存在しないタブを除去
  for (const id of Object.keys(thumbnailCache)) {
    if (!existingIds.has(Number(id))) {
      delete thumbnailCache[id];
    }
  }

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

  // 初期化時に各ウィンドウのアクティブタブをキャプチャ
  for (const tab of activeTabs) {
    captureTab(tab.id, tab.windowId);
  }
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

  // 少し待ってからキャプチャ（ページ描画完了を待つ）
  setTimeout(() => {
    captureTab(activeInfo.tabId, activeInfo.windowId);
  }, 500);
});

// タブが閉じられたとき
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const idx = mruList.indexOf(tabId);
  if (idx !== -1) {
    mruList.splice(idx, 1);
    await saveMruList();
  }
  // サムネイルキャッシュからも削除
  delete thumbnailCache[tabId];
  saveThumbnails();
});

// 新規タブが作成されたとき
chrome.tabs.onCreated.addListener(async (tab) => {
  moveToFront(tab.id);
  await saveMruList();
});

// タブの読み込み完了時にキャプチャ更新
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    setTimeout(() => {
      captureTab(tabId, tab.windowId);
    }, 300);
  }
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

  if (message.type === "closeTab") {
    handleCloseTab(message.tabId).then(sendResponse);
    return true;
  }
});

// タブ情報を返す（ブラウザの表示順）
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

  const tabs = await chrome.tabs.query({});

  // ブラウザのタブ順（ウィンドウID → タブインデックス順）でソート
  const sorted = tabs
    .filter((tab) => isAccessible(tab.url))
    .sort((a, b) => {
      if (a.windowId !== b.windowId) return a.windowId - b.windowId;
      return a.index - b.index;
    });

  const result = sorted.map((tab) => ({
    id: tab.id,
    title: tab.title || "New Tab",
    favIconUrl: tab.favIconUrl || "",
    url: tab.url || "",
    windowId: tab.windowId,
    thumbnail: thumbnailCache[tab.id] || "",
  }));

  return { tabs: result, currentTabId: senderTabId };
}

// 指定タブを閉じる
async function handleCloseTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
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
