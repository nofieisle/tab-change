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
    try {
      chrome.runtime.sendMessage({ type: "getTabList" }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.tabs) {
          cachedTabList = response.tabs;
          cachedCurrentTabId = response.currentTabId;
        }
      });
    } catch (e) {
      // Service Worker未準備時は無視
    }
  }

  // ページ読み込み完了後とフォーカス復帰時にキャッシュ更新
  if (document.readyState === "complete") {
    prefetchTabList();
  } else {
    window.addEventListener("load", prefetchTabList, { once: true });
  }
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
        gap: 12px;
        padding: 20px;
        width: max-content;
        max-width: 95vw;
        max-height: 80vh;
        overflow-y: auto;
        background: #282828;
        border-radius: 16px;
        border: 1px solid #444;
        box-sizing: border-box;
      }
      .tab-change-container.visible {
        display: flex;
      }
      .tab-change-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 200px;
        padding: 8px;
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
      .tab-change-thumbnail {
        width: 184px;
        height: 115px;
        border-radius: 8px;
        object-fit: cover;
        background: rgba(255, 255, 255, 0.05);
        flex-shrink: 0;
      }
      .tab-change-thumbnail-placeholder {
        width: 184px;
        height: 115px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.05);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .tab-change-thumbnail-placeholder .tab-change-favicon-large {
        width: 48px;
        height: 48px;
        border-radius: 8px;
        object-fit: contain;
      }
      .tab-change-thumbnail-placeholder .tab-change-favicon-default {
        width: 48px;
        height: 48px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.1);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
        color: rgba(255, 255, 255, 0.6);
      }
      .tab-change-info {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        width: 100%;
        margin-top: 10px;
        padding: 0 2px;
        box-sizing: border-box;
      }
      .tab-change-favicon-small {
        width: 30px;
        height: 30px;
        border-radius: 6px;
        object-fit: contain;
        flex-shrink: 0;
      }
      .tab-change-favicon-small-default {
        width: 30px;
        height: 30px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.1);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        color: rgba(255, 255, 255, 0.6);
        flex-shrink: 0;
      }
      .tab-change-title {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 15px;
        color: rgba(255, 255, 255, 0.85);
        text-align: center;
        width: 100%;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
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

      // サムネイル or プレースホルダー
      if (tab.thumbnail) {
        const thumb = document.createElement("img");
        thumb.className = "tab-change-thumbnail";
        thumb.src = tab.thumbnail;
        thumb.alt = "";
        thumb.loading = "eager";
        thumb.onerror = () => {
          thumb.replaceWith(createPlaceholder(tab));
        };
        item.appendChild(thumb);
      } else {
        item.appendChild(createPlaceholder(tab));
      }

      // Favicon + タイトル行
      const info = document.createElement("div");
      info.className = "tab-change-info";

      if (tab.favIconUrl) {
        const favicon = document.createElement("img");
        favicon.className = "tab-change-favicon-small";
        favicon.src = tab.favIconUrl;
        favicon.alt = "";
        favicon.onerror = () => {
          favicon.replaceWith(createSmallDefaultIcon(tab.title));
        };
        info.appendChild(favicon);
      } else {
        info.appendChild(createSmallDefaultIcon(tab.title));
      }

      const title = document.createElement("div");
      title.className = "tab-change-title";
      title.textContent = tab.title || "New Tab";
      info.appendChild(title);

      item.appendChild(info);

      // ホバーで選択を追従
      item.addEventListener("mouseenter", () => {
        selectedIndex = index;
        updateSelection();
      });

      // クリックで確定
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectedIndex = index;
        chrome.runtime.sendMessage(
          { type: "switchTab", tabId: tab.id },
          () => {}
        );
        hideOverlay();
        resetState();
      });

      fragment.appendChild(item);
    });

    tabListEl.replaceChildren(fragment);
  }

  // サムネイルがない場合のプレースホルダー
  function createPlaceholder(tab) {
    const div = document.createElement("div");
    div.className = "tab-change-thumbnail-placeholder";
    if (tab.favIconUrl) {
      const img = document.createElement("img");
      img.className = "tab-change-favicon-large";
      img.src = tab.favIconUrl;
      img.alt = "";
      img.onerror = () => {
        img.replaceWith(createDefaultIcon(tab.title));
      };
      div.appendChild(img);
    } else {
      div.appendChild(createDefaultIcon(tab.title));
    }
    return div;
  }

  // デフォルトアイコン（プレースホルダー内用）
  function createDefaultIcon(title) {
    const div = document.createElement("div");
    div.className = "tab-change-favicon-default";
    div.textContent = (title || "?")[0].toUpperCase();
    return div;
  }

  // 小さいデフォルトアイコン（タイトル行用）
  function createSmallDefaultIcon(title) {
    const div = document.createElement("div");
    div.className = "tab-change-favicon-small-default";
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

    // 現在のタブの位置を探して、次のタブを初期選択（循環）
    const currentIdx = tabList.findIndex((t) => t.id === currentTabId);
    selectedIndex = currentIdx >= 0 ? currentIdx : 0;
    showOverlay();
  }

  // キーダウンハンドラ
  document.addEventListener(
    "keydown",
    (e) => {
      // Alt+矢印キーで移動（オーバーレイ表示中）
      if (e.altKey && isVisible && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();

        // 1行あたりの列数を計算
        const containerWidth = tabListEl.offsetWidth - 40; // padding分を引く
        const itemWidth = 200 + 12; // item幅 + gap
        const cols = Math.max(1, Math.floor(containerWidth / itemWidth));

        if (e.key === "ArrowRight") {
          selectedIndex = (selectedIndex + 1) % tabList.length;
        } else if (e.key === "ArrowLeft") {
          selectedIndex = (selectedIndex - 1 + tabList.length) % tabList.length;
        } else if (e.key === "ArrowDown") {
          selectedIndex = Math.min(selectedIndex + cols, tabList.length - 1);
        } else if (e.key === "ArrowUp") {
          selectedIndex = Math.max(selectedIndex - cols, 0);
        }
        updateSelection();
        return;
      }

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
