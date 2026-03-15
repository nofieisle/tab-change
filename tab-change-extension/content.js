// Tab Change - Content Script
// Alt+Tab でタブ切り替えオーバーレイを表示・操作

(function () {
  "use strict";

  let overlayHost = null; // Shadow DOM ホスト要素
  let shadowRoot = null;
  let overlayEl = null; // オーバーレイのルート要素
  let tabListEl = null; // タブリストコンテナ
  let isVisible = false;
  let tabList = []; // 現在のタブリスト
  let selectedIndex = 0;
  let altPressed = false;

  // Shadow DOM内にオーバーレイを構築
  function createOverlay() {
    if (overlayHost) return;

    overlayHost = document.createElement("div");
    overlayHost.id = "tab-change-overlay-host";
    shadowRoot = overlayHost.attachShadow({ mode: "closed" });

    // スタイルをShadow DOM内に適用
    const style = document.createElement("style");
    style.textContent = `
      .tab-change-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483647;
        background: rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        opacity: 0;
        transition: opacity 0.15s ease;
        pointer-events: none;
      }
      .tab-change-overlay.visible {
        opacity: 1;
        pointer-events: all;
      }
      .tab-change-container {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
        padding: 20px 24px;
        max-width: 80vw;
        max-height: 60vh;
        overflow-y: auto;
        background: rgba(40, 40, 40, 0.85);
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
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
        transition: background 0.1s ease, border-color 0.1s ease;
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

    overlayEl = document.createElement("div");
    overlayEl.className = "tab-change-overlay";

    tabListEl = document.createElement("div");
    tabListEl.className = "tab-change-container";

    overlayEl.appendChild(tabListEl);
    shadowRoot.appendChild(style);
    shadowRoot.appendChild(overlayEl);
    document.documentElement.appendChild(overlayHost);
  }

  // タブリストをレンダリング
  function renderTabList() {
    tabListEl.innerHTML = "";

    tabList.forEach((tab, index) => {
      const item = document.createElement("div");
      item.className =
        "tab-change-item" + (index === selectedIndex ? " selected" : "");
      item.dataset.index = index;

      // Favicon
      if (tab.favIconUrl) {
        const img = document.createElement("img");
        img.className = "tab-change-favicon";
        img.src = tab.favIconUrl;
        img.alt = "";
        img.onerror = () => {
          const fallback = createDefaultIcon(tab.title);
          img.replaceWith(fallback);
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

      tabListEl.appendChild(item);
    });
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
    const items = tabListEl.querySelectorAll(".tab-change-item");
    items.forEach((item, i) => {
      item.classList.toggle("selected", i === selectedIndex);
    });

    // 選択アイテムが見えるようにスクロール
    const selectedItem = items[selectedIndex];
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  // オーバーレイを表示
  async function showOverlay() {
    if (tabList.length <= 1) return; // 単一タブ時は表示しない

    createOverlay();
    isVisible = true;

    renderTabList();

    // フェードイン
    requestAnimationFrame(() => {
      overlayEl.classList.add("visible");
    });
  }

  // オーバーレイを非表示
  function hideOverlay() {
    if (!isVisible) return;

    isVisible = false;
    if (overlayEl) {
      overlayEl.classList.remove("visible");
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

  // キーダウンハンドラ
  document.addEventListener(
    "keydown",
    async (e) => {
      // Alt+Tab 検知
      if (e.altKey && e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();

        if (!isVisible) {
          // 初回: タブリスト取得してオーバーレイ表示
          altPressed = true;
          try {
            const response = await chrome.runtime.sendMessage({
              type: "getTabList",
            });
            if (response && response.tabs) {
              tabList = response.tabs;

              if (tabList.length <= 1) return;

              // 現在のタブを初期選択
              const currentIdx = response.currentTabId
                ? tabList.findIndex((t) => t.id === response.currentTabId)
                : -1;
              selectedIndex = currentIdx >= 0 ? currentIdx : 0;
              await showOverlay();
            }
          } catch (err) {
            // Content Scriptがdisconnectされた場合など
            resetState();
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
