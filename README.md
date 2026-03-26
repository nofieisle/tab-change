# Tab Change

macOS の `Cmd+Tab` と同様の操作感で、Chrome のタブを素早く切り替えるブラウザ拡張機能です。

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)

## 使い方

1. `Option + Tab` でタブ一覧をオーバーレイ表示
2. `Option` を押したまま `Tab` を繰り返し押して選択を移動
3. `Shift + Option + Tab` で逆方向に移動
4. `↑` / `↓` 矢印キーでも選択を移動可能
5. タブにカーソルをホバーして選択
6. `Option + W` で選択中のタブを閉じる
7. `Option` を離すと選択したタブに切り替え

### 表示仕様

- タブ一覧にはスクリーンショットのサムネイルを表示
- ピン留めタブは一覧から除外

## インストール

1. このリポジトリをクローンまたはダウンロード
2. Chrome で `chrome://extensions` を開く
3. 右上の「デベロッパーモード」を有効にする
4. 「パッケージ化されていない拡張機能を読み込む」をクリック
5. `tab-change-extension` ディレクトリを選択

## 制約事項

- `chrome://` ページや新規タブページなど、Content Script が注入できないページでは動作しません
- サードパーティのキーボードカスタマイズツール（AltTab 等）と競合する場合があります

## ディレクトリ構成

```
tab-change-extension/   # Chrome拡張機能本体
  manifest.json         # Manifest V3 設定
  background.js         # Service Worker（タブ管理）
  content.js            # キーイベント検知・オーバーレイUI
  overlay.css           # ホスト要素スタイル
  icons/                # 拡張機能アイコン
docs/
  plan.md               # 実装計画書
```
