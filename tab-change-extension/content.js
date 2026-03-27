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
  let cachedPinnedTabs = null; // ピン留めタブのキャッシュ

  // タブリストを事前キャッシュ（Service Worker起動を促す）
  function prefetchTabList() {
    try {
      chrome.runtime.sendMessage({ type: "getTabList" }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.tabs) {
          cachedTabList = response.tabs;
          cachedCurrentTabId = response.currentTabId;
          cachedPinnedTabs = response.pinnedTabs || [];
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
        background: rgba(100, 149, 237, 0.15);
        border-color: rgba(100, 149, 237, 0.7);
      }
      .tab-change-item:hover {
        background: rgba(100, 149, 237, 0.3);
        border-color: rgba(100, 149, 237, 1);
        box-shadow: 0 0 8px rgba(100, 149, 237, 0.4);
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
      .tab-change-pinned-section {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
        width: 100%;
        padding: 0 0 10px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.15);
        margin-bottom: 4px;
        flex-shrink: 0;
      }
      .tab-change-pinned-item-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 130px;
        padding: 6px;
        border-radius: 10px;
        cursor: pointer;
        border: 2px solid transparent;
        box-sizing: border-box;
        opacity: 0.75;
      }
      .tab-change-pinned-item-card:hover {
        opacity: 1;
        background: rgba(100, 149, 237, 0.3);
        border-color: rgba(100, 149, 237, 1);
        box-shadow: 0 0 8px rgba(100, 149, 237, 0.4);
      }
      .tab-change-pinned-item-card .tab-change-thumbnail {
        width: 118px;
        height: 74px;
      }
      .tab-change-pinned-item-card .tab-change-thumbnail-placeholder {
        width: 118px;
        height: 74px;
      }
      .tab-change-pinned-item-card .tab-change-thumbnail-placeholder .tab-change-favicon-large {
        width: 32px;
        height: 32px;
      }
      .tab-change-pinned-item-card .tab-change-thumbnail-placeholder .tab-change-favicon-default {
        width: 32px;
        height: 32px;
        font-size: 15px;
      }
      .tab-change-pinned-item-card .tab-change-info {
        margin-top: 6px;
      }
      .tab-change-pinned-item-card .tab-change-favicon-small {
        width: 20px;
        height: 20px;
      }
      .tab-change-pinned-item-card .tab-change-favicon-small-default {
        width: 20px;
        height: 20px;
        font-size: 10px;
      }
      .tab-change-pinned-item-card .tab-change-title {
        font-size: 11px;
        -webkit-line-clamp: 2;
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

    // ピン留めタブセクション（通常タブと同じカード形式）
    if (cachedPinnedTabs && cachedPinnedTabs.length > 0) {
      const section = document.createElement("div");
      section.className = "tab-change-pinned-section";

      for (const pin of cachedPinnedTabs) {
        const card = document.createElement("div");
        card.className = "tab-change-pinned-item-card";
        card.addEventListener("mousedown", (e) => {
          e.preventDefault();
          chrome.runtime.sendMessage(
            { type: "switchTab", tabId: pin.id },
            () => {}
          );
          hideOverlay();
          resetState();
        });

        // サムネイル or プレースホルダー
        if (pin.thumbnail) {
          const thumb = document.createElement("img");
          thumb.className = "tab-change-thumbnail";
          thumb.src = pin.thumbnail;
          thumb.alt = "";
          thumb.loading = "eager";
          thumb.onerror = () => {
            thumb.replaceWith(createPlaceholder(pin));
          };
          card.appendChild(thumb);
        } else {
          card.appendChild(createPlaceholder(pin));
        }

        // Favicon + タイトル
        const info = document.createElement("div");
        info.className = "tab-change-info";

        if (pin.favIconUrl) {
          const favicon = document.createElement("img");
          favicon.className = "tab-change-favicon-small";
          favicon.src = pin.favIconUrl;
          favicon.alt = "";
          favicon.onerror = () => {
            favicon.replaceWith(createSmallDefaultIcon(pin.title));
          };
          info.appendChild(favicon);
        } else {
          info.appendChild(createSmallDefaultIcon(pin.title));
        }

        const title = document.createElement("div");
        title.className = "tab-change-title";
        title.textContent = pin.title || "New Tab";
        info.appendChild(title);

        card.appendChild(info);
        section.appendChild(card);
      }

      fragment.appendChild(section);
    }

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

      // クリックで確定
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectedIndex = index;
        cachedCurrentTabId = tab.id;
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
    const items = tabListEl.querySelectorAll(".tab-change-item");
    items.forEach((el, i) => {
      el.classList.toggle("selected", i === selectedIndex);
    });

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
      cachedCurrentTabId = selectedTab.id;
      try {
        chrome.runtime.sendMessage(
          { type: "switchTab", tabId: selectedTab.id },
          () => {
            if (chrome.runtime.lastError) {
              // 接続切れ時は無視
            }
          }
        );
      } catch {
        // runtime無効時は無視
      }
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

      // Enterで確定（オーバーレイ表示中）
      if (isVisible && e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        confirmSelection();
        return;
      }

      // Escでキャンセル（オーバーレイ表示中）
      if (isVisible && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        hideOverlay();
        resetState();
        return;
      }

      // Alt+W で選択中のタブを閉じる（オーバーレイ表示中）
      if (e.altKey && isVisible && e.code === "KeyW") {
        e.preventDefault();
        e.stopPropagation();

        const tabToClose = tabList[selectedIndex];
        if (!tabToClose) return;

        chrome.runtime.sendMessage(
          { type: "closeTab", tabId: tabToClose.id },
          (response) => {
            if (response && response.success) {
              tabList.splice(selectedIndex, 1);
              if (tabList.length <= 1) {
                hideOverlay();
                resetState();
                return;
              }
              if (selectedIndex >= tabList.length) {
                selectedIndex = tabList.length - 1;
              }
              renderTabList();
            }
          }
        );
        return;
      }

      // Alt+Tab 検知
      if (e.altKey && e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();

        if (!isVisible) {
          altPressed = true;

          // キャッシュがあれば即座に表示（レスポンシブ感を出す）
          if (cachedTabList && cachedTabList.length > 1) {
            openWithTabs(cachedTabList, cachedCurrentTabId);
          }

          // 常にbackgroundから最新データを取得
          try {
            chrome.runtime.sendMessage({ type: "getTabList" }, (response) => {
              if (chrome.runtime.lastError || !response || !response.tabs) return;
              cachedTabList = response.tabs;
              cachedCurrentTabId = response.currentTabId;
              cachedPinnedTabs = response.pinnedTabs || [];

              if (!isVisible && altPressed) {
                // キャッシュなしで初回表示
                openWithTabs(response.tabs, response.currentTabId);
              } else if (isVisible) {
                // 表示中なら最新データで再描画
                const prevSelectedId = tabList[selectedIndex]?.id;
                tabList = response.tabs;
                const newIdx = prevSelectedId
                  ? tabList.findIndex((t) => t.id === prevSelectedId)
                  : -1;
                selectedIndex = newIdx >= 0 ? newIdx : 0;
                renderTabList();
              }
            });
          } catch {
            // runtime接続切れ時はキャッシュのみで動作
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

  // --- favicon枠バッジ機能（ピン留め=緑、アクティブ=黄） ---
  let originalFaviconHref = null;
  let isPinned = false;
  let isActive = false;
  let badgeApplied = false;
  let faviconDataUrlCache = null;

  // 現在のfaviconのURLを取得（複数のrel形式に対応）
  function getCurrentFaviconHref() {
    const selectors = [
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
      'link[rel~="icon"]',
    ];
    for (const sel of selectors) {
      const link = document.querySelector(sel);
      if (link && link.href) return link.href;
    }
    return new URL("/favicon.ico", location.origin).href;
  }

  // 現在の状態に応じた枠スタイルを決定（ピン留め優先）
  function getBorderStyle() {
    if (isPinned) return { color: "#4ade80", shape: "circle" };
    if (isActive) return { color: "#ef4444", shape: "rect" };
    return null;
  }

  // faviconに枠を描画して適用
  async function applyBadge() {
    const style = getBorderStyle();
    if (!style) {
      removeBadge();
      return;
    }

    if (!originalFaviconHref) {
      originalFaviconHref = getCurrentFaviconHref();
    }

    // faviconのdata URLをキャッシュから取得、なければfetch
    if (!faviconDataUrlCache && originalFaviconHref) {
      try {
        const { dataUrl } = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: "fetchFavicon", url: originalFaviconHref }, (resp) => {
            resolve(resp || { dataUrl: null });
          });
        });
        faviconDataUrlCache = dataUrl;
      } catch {
        // 取得失敗
      }
    }

    const size = 32;
    const border = 5;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    const inner = size - border * 2;

    if (style.shape === "circle") {
      const center = size / 2;
      const radius = (size - border) / 2;

      // 円形クリッピングでfaviconを描画
      if (faviconDataUrlCache) {
        try {
          const img = await loadImage(faviconDataUrlCache);
          ctx.save();
          ctx.beginPath();
          ctx.arc(center, center, radius - border / 2, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, border, border, inner, inner);
          ctx.restore();
        } catch {
          // 描画失敗
        }
      }

      // 円形の枠を描画
      ctx.strokeStyle = style.color;
      ctx.lineWidth = border;
      ctx.beginPath();
      ctx.arc(center, center, radius, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // 四角: faviconを描画してから枠
      if (faviconDataUrlCache) {
        try {
          const img = await loadImage(faviconDataUrlCache);
          ctx.drawImage(img, border, border, inner, inner);
        } catch {
          // 描画失敗
        }
      }

      ctx.strokeStyle = style.color;
      ctx.lineWidth = border;
      const offset = border / 2;
      ctx.strokeRect(offset, offset, size - border, size - border);
    }

    badgeApplied = true;
    setFavicon(canvas.toDataURL("image/png"));
  }

  // data URLからImageを読み込む
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // faviconリンク要素を差し替え
  function setFavicon(dataUrl) {
    const existing = document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]');
    existing.forEach((el) => el.remove());

    const link = document.createElement("link");
    link.rel = "icon";
    link.href = dataUrl;
    document.head.appendChild(link);
  }

  // バッジを除去してオリジナルに戻す
  function removeBadge() {
    if (!badgeApplied) return;
    badgeApplied = false;
    if (originalFaviconHref) {
      setFavicon(originalFaviconHref);
    } else {
      const link = document.querySelector('link[rel~="icon"]');
      if (link && link.href.startsWith("data:")) {
        link.remove();
      }
    }
  }

  // 状態更新してバッジを再描画
  function updateBadge() {
    if (isPinned || isActive) {
      applyBadge();
    } else {
      removeBadge();
      originalFaviconHref = null;
      faviconDataUrlCache = null;
    }
  }

  // background.jsからの通知を受信
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "pinnedChanged") {
      isPinned = message.pinned;
      updateBadge();
    }
    if (message.type === "activeChanged") {
      isActive = message.active;
      updateBadge();
    }
  });

  // favicon変更を監視（SPAなどでfaviconが動的に変わる場合に対応）
  const faviconObserver = new MutationObserver(() => {
    if (!badgeApplied) return;
    const currentHref = getCurrentFaviconHref();
    if (currentHref && !currentHref.startsWith("data:")) {
      originalFaviconHref = currentHref;
      faviconDataUrlCache = null;
      applyBadge();
    }
  });

  function startFaviconObserver() {
    if (document.head) {
      faviconObserver.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
    }
  }

  // background.jsから状態を取得してバッジを更新
  let badgeSystemReady = false;

  function refreshBadgeState() {
    if (!badgeSystemReady) return;
    chrome.runtime.sendMessage({ type: "getTabState" }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response) {
        const changed = isPinned !== response.pinned || isActive !== response.active;
        isPinned = response.pinned;
        isActive = response.active;
        if (changed) updateBadge();
      }
    });
  }

  // セッション復元との干渉を防ぐため、ページ完全読み込み後に遅延して初期化
  function initBadgeSystem() {
    setTimeout(() => {
      badgeSystemReady = true;
      startFaviconObserver();
      refreshBadgeState();

      window.addEventListener("focus", refreshBadgeState);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") refreshBadgeState();
      });
    }, 2000);
  }

  if (document.readyState === "complete") {
    initBadgeSystem();
  } else {
    window.addEventListener("load", initBadgeSystem, { once: true });
  }
})();
