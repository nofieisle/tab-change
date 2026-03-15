// Tab Change - Content Script
// Alt+Tab でタブ切り替えオーバーレイを表示・操作

(function () {
  "use strict";

  let overlayHost = null; // Shadow DOM ホスト要素
  let shadowRoot = null;
  let tabListEl = null; // タブリストコンテナ
  let isVisible = false;
  let tabList = []; // 現在のタブリスト
  let selectedIndex = 0;
  let altPressed = false;
  let cachedTabList = null; // タブリストのキャッシュ
  let cachedCurrentTabId = null;

  // タブリストを事前キャッシュ（Service Worker起動を促す）
  function prefetchTabList() {
    chrome.runtime.sendMessage({ type: "getTabList" }, (response) => {
      if (response && response.tabs) {
        cachedTabList = response.tabs;
        cachedCurrentTabId = response.currentTabId;
      }
    });
  }

  // ページ読み込み時とフォーカス復帰時にキャッシュ更新
  prefetchTabList();
  window.addEventListener("focus", prefetchTabList);

  // Shadow DOM内にオーバーレイを構築（初回のみ）
  function createOverlay() {
    if (overlayHost) return;

    overlayHost = document.createElement("div");
    overlayHost.id = "tab-change-overlay-host";
    shadowRoot = overlayHost.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      .tab-change-container {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 2147483647;
        display: none;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
        padding: 20px 24px;
        max-width: 80vw;
        max-height: 60vh;
        overflow-y: auto;
        background: #282828;
        border-radius: 16px;
        border: 1px solid #444;
      }
      .tab-change-container.visible {
        display: flex;
      }
      .tab-change-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 96px;
        padding: 12px 8px;
        border-radius: 12px;
        cursor: pointer;
        border: 2px solid transparent;
        box-sizing: border-box;
      }
      .tab-change-item.selected {
        background: rgba(255, 255, 255, 0.15);
        border-color: rgba(100, 149, 237, 0.8);
      }
      .tab-change-item:hover {
        background: rgba(255, 255, 255, 0.08);
      }
      .tab-change-favicon {
        width: 48px;
        height: 48px;
        border-radius: 8px;
        margin-bottom: 8px;
        object-fit: contain;
        background: rgba(255, 255, 255, 0.05);
        padding: 4px;
        box-sizing: border-box;
      }
      .tab-change-favicon-default {
        width: 48px;
        height: 48px;
        border-radius: 8px;
        margin-bottom: 8px;
        background: rgba(255, 255, 255, 0.1);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        color: rgba(255, 255, 255, 0.6);
      }
      .tab-change-title {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.85);
        text-align: center;
        width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1.3;
      }
    `;

    tabListEl = document.createElement("div");
    tabListEl.className = "tab-change-container";

    shadowRoot.appendChild(style);
    shadowRoot.appendChild(tabListEl);
    document.documentElement.appendChild(overlayHost);
  }

  // タブリストをレンダリング
  function renderTabList() {
    const fragment = document.createDocumentFragment();

    tabList.forEach((tab, index) => {
      const item = document.createElement("div");
      item.className =
        "tab-change-item" + (index === selectedIndex ? " selected" : "");

      // Favicon
      if (tab.favIconUrl) {
        const img = document.createElement("img");
        img.className = "tab-change-favicon";
        img.src = tab.favIconUrl;
        img.alt = "";
        img.loading = "eager";
        img.onerror = () => {
          img.replaceWith(createDefaultIcon(tab.title));
        };
        item.appendChild(img);
      } else {
        item.appendChild(createDefaultIcon(tab.title));
      }

      // タイトル
      const title = document.createElement("div");
      title.className = "tab-change-title";
      title.textContent = tab.title || "New Tab";
      item.appendChild(title);

      fragment.appendChild(item);
    });

    tabListEl.replaceChildren(fragment);
  }

  // デフォルトアイコンを生成
  function createDefaultIcon(title) {
    const div = document.createElement("div");
    div.className = "tab-change-favicon-default";
    div.textContent = (title || "?")[0].toUpperCase();
    return div;
  }

  // 選択アイテムの更新
  function updateSelection() {
    const items = tabListEl.children;
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle("selected", i === selectedIndex);
    }

    // 選択アイテムが見えるようにスクロール
    if (items[selectedIndex]) {
      items[selectedIndex].scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  // オーバーレイを表示
  function showOverlay() {
    if (tabList.length <= 1) return; // 単一タブ時は表示しない

    createOverlay();
    isVisible = true;

    renderTabList();
    tabListEl.classList.add("visible");
  }

  // オーバーレイを非表示
  function hideOverlay() {
    if (!isVisible) return;

    isVisible = false;
    if (tabListEl) {
      tabListEl.classList.remove("visible");
    }
  }

  // 選択を確定してタブを切り替え
  function confirmSelection() {
    if (!isVisible || tabList.length === 0) return;

    const selectedTab = tabList[selectedIndex];
    if (selectedTab) {
      chrome.runtime.sendMessage(
        { type: "switchTab", tabId: selectedTab.id },
        () => {}
      );
    }

    hideOverlay();
    resetState();
  }

  // 状態リセット
  function resetState() {
    tabList = [];
    selectedIndex = 0;
    altPressed = false;
  }

  // キャッシュまたはAPIからタブリストを取得して表示
  function openWithTabs(tabs, currentTabId) {
    tabList = tabs;
    if (tabList.length <= 1) return;

    const currentIdx = currentTabId
      ? tabList.findIndex((t) => t.id === currentTabId)
      : -1;
    selectedIndex = currentIdx >= 0 ? currentIdx : 0;
    showOverlay();
  }

  // キーダウンハンドラ
  document.addEventListener(
    "keydown",
    (e) => {
      // Alt+Tab 検知
      if (e.altKey && e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();

        if (!isVisible) {
          // 初回: キャッシュがあれば即座に表示
          altPressed = true;

          if (cachedTabList && cachedTabList.length > 1) {
            openWithTabs(cachedTabList, cachedCurrentTabId);
            // バックグラウンドで最新リストを取得し、差分があれば更新
            chrome.runtime.sendMessage({ type: "getTabList" }, (response) => {
              if (response && response.tabs) {
                cachedTabList = response.tabs;
                cachedCurrentTabId = response.currentTabId;
                // オーバーレイがまだ表示中で、タブ数が変わっていたら再描画
                if (isVisible && response.tabs.length !== tabList.length) {
                  const prevSelectedId = tabList[selectedIndex]?.id;
                  tabList = response.tabs;
                  const newIdx = prevSelectedId
                    ? tabList.findIndex((t) => t.id === prevSelectedId)
                    : -1;
                  selectedIndex = newIdx >= 0 ? newIdx : 0;
                  renderTabList();
                }
              }
            });
          } else {
            // キャッシュなし: APIから取得
            chrome.runtime.sendMessage({ type: "getTabList" }, (response) => {
              if (response && response.tabs) {
                cachedTabList = response.tabs;
                cachedCurrentTabId = response.currentTabId;
                if (altPressed) {
                  openWithTabs(response.tabs, response.currentTabId);
                }
              }
            });
          }
        } else {
          // Alt+Tab 連打: 選択を循環
          if (e.shiftKey) {
            selectedIndex =
              (selectedIndex - 1 + tabList.length) % tabList.length;
          } else {
            selectedIndex = (selectedIndex + 1) % tabList.length;
          }
          updateSelection();
        }
      }
    },
    true
  );

  // キーアップハンドラ
  document.addEventListener(
    "keyup",
    (e) => {
      // Alt キーのリリースで選択確定
      if (e.key === "Alt" && altPressed) {
        e.preventDefault();
        e.stopPropagation();
        confirmSelection();
      }
    },
    true
  );

  // フォーカス喪失時にオーバーレイを閉じる
  window.addEventListener("blur", () => {
    if (isVisible) {
      hideOverlay();
      resetState();
    }
  });
})();
