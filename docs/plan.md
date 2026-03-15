# Tab Change - Chrome拡張機能 実装計画

## Context

タブを多数開いた際にタイトルが見えなくなり、目的のタブを探しにくい問題を解決する。
macOSの `Cmd+Tab` と同様の操作感で、ブラウザタブを素早く切り替えられるChrome拡張機能を作成する。

**方式**: 擬似Cmd+Tab型（Option押し続け → Tabで循環 → Option離して確定）
**制約**: Content Scriptが注入できない `chrome://` ページ、新規タブページ等では動作しない（許容済み）

## ディレクトリ構成

```
tab-change-extension/
  manifest.json       # Manifest V3 設定
  background.js       # Service Worker（MRUタブリスト管理、タブ切替実行）
  content.js          # キーイベント検知、オーバーレイ表示・操作
  overlay.css         # macOS Cmd+Tab風UIスタイル
  icons/
    icon16.png
    icon32.png
    icon48.png
    icon128.png
docs/
  plan.md             # 本計画書
```

## 実装ステップ

### Step 1: manifest.json
- Manifest V3
- permissions: `tabs`（全タブ情報取得）、`storage`（設定保存）
- content_scripts: `<all_urls>` に `content.js` + `overlay.css` を注入（`run_at: "document_start"`）
- commands: `_execute_action` は使わず、Content Script内でキーイベントを直接検知

### Step 2: background.js — MRUタブリスト管理
- `chrome.tabs.onActivated` でタブのアクティブ化を追跡し、MRU（Most Recently Used）順リストを維持
- `chrome.tabs.onRemoved` でタブ削除時にリストから除去
- `chrome.tabs.onCreated` で新規タブをリストに追加
- `chrome.runtime.onMessage` で以下のメッセージを処理:
  - `getTabList`: MRU順のタブ情報（id, title, favIconUrl, url, windowId）を返す
  - `switchTab`: 指定タブIDにフォーカスを移す（`chrome.tabs.update` + `chrome.windows.update`）
- Service Worker起動時に `chrome.tabs.query` で既存タブのMRUリストを初期化

### Step 3: content.js — キーイベント検知とオーバーレイ制御
- **キーイベント**:
  - `keydown`: `Alt+Tab` 検知でオーバーレイ表示 & 選択アイテムを次へ移動。`Shift+Alt+Tab` で逆方向。`event.preventDefault()` でブラウザデフォルト動作を抑制
  - `keyup`: `Alt` キーのリリースを検知して選択確定 → backgroundに `switchTab` メッセージ送信
  - `window.onblur`: フォーカス喪失時にオーバーレイを閉じてリセット
- **オーバーレイ**:
  - Shadow DOMを使用してページのCSSと干渉しないよう隔離
  - 初回 `Alt+Tab` 時にbackgroundから `getTabList` でタブリスト取得
  - 2番目のタブ（MRU順で直前に使っていたタブの次）を初期選択
  - `Alt+Tab` 連打で選択を循環

### Step 4: overlay.css — macOS Cmd+Tab風UI
- 画面中央に固定配置（`position: fixed`）
- 半透明ダーク背景 + `backdrop-filter: blur()`
- 横並びのタブアイコン（favicon 48x48 + タイトル省略表示）
- タブ数が多い場合は横スクロール or グリッド表示
- 選択中アイテムはハイライト（明るい背景 + ボーダー）
- `z-index: 2147483647` で最前面表示
- アニメーション: フェードイン/アウト

### Step 5: アイコン作成
- SVGベースでシンプルなタブ切替アイコンを作成
- 16, 32, 48, 128px の各サイズをPNG出力

### Step 6: エッジケース対応
- オーバーレイ表示中にタブが閉じられた場合のリスト更新
- favicon取得不可時のデフォルトアイコン表示
- タブタイトルが長い場合の省略表示
- 単一タブ時は切り替え不要なのでオーバーレイ非表示

## 技術的注意点

1. **Shadow DOM**: Content Scriptのオーバーレイはページのスタイルと干渉しないようShadow DOM内に構築
2. **Alt+Tab のOS競合**: macOSでは `Alt+Tab` はデフォルトでOS機能に割り当てなし。ただしAltTabアプリ等のサードパーティツールとは競合する可能性あり
3. **keyup信頼性**: ブラウザがフォーカスを失った場合 `keyup` が発火しないため `window.onblur` で補完
4. **MRU初期化**: Service Worker再起動時にMRUリストが消失するため、`chrome.storage.session` で永続化
5. **favicon**: `chrome.tabs.query()` の `tab.favIconUrl` を使用。取得不可時はデフォルトアイコンを表示

## 検証方法

1. `chrome://extensions` でデベロッパーモード有効化 → 「パッケージ化されていない拡張機能を読み込む」で `tab-change-extension` を指定
2. 複数タブを開いた状態で `Option+Tab` を押してオーバーレイが表示されることを確認
3. `Option` を押し続けたまま `Tab` を連打して選択が循環することを確認
4. `Option` を離して選択したタブに切り替わることを確認
5. `Shift+Option+Tab` で逆方向に循環することを確認
6. タブを閉じた後のリスト更新を確認
7. 通常のWebページ（Google, GitHub等）で正常動作することを確認
