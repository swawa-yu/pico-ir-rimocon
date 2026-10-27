# Pico Studio

Raspberry Pi Pico / Pico WとMicroPythonを使う教材です。
プログラム編集、USBでの書き込み・実行、赤外線信号の観測、データ変換をブラウザで行えます。

公開サイト：https://ir.swawa.dev/

## 開発

Node.js 22.12以降とpnpmを使います。pnpmのバージョンは`package.json`の`packageManager`で指定しています。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

http://127.0.0.1:8043/ を開きます。`src/`、`public/`、`pico/`の保存で再ビルドするので、ブラウザを再読み込みして確認します。
別のポートを使う場合は`PORT=8044 pnpm dev`と指定します。

```sh
pnpm build        # docs/に公開用ファイルを生成
pnpm test         # ビルドとJavaScriptのテスト
pnpm test:python  # Python 3でPico用コードをテスト
```

Python 3は開発時のテストに使用します。公開サイトを利用する受講生は、PCへのNode.js・pnpm・Pythonのインストールは不要です。

## ファイルの配置

| 場所 | 内容 |
| --- | --- |
| `src/pages/` | トップ、Studio、資料、旧URLからの転送ページ |
| `src/styles/` | CSS |
| `src/studio/` | ブロック編集、部品設定、プロジェクト、サンプル |
| `src/analyzer/` | ロジアナの表示・信号解析 |
| `src/conversion/` | データ変換 |
| `src/device/` | USB接続、REPL、Picoへの転送 |
| `src/editor/` | CodeMirror、Pythonの構文解析・ブロック変換 |
| `src/firmware/` | ブラウザからのファームウェア書き込み |
| `src/templates/` | Studioに埋め込むロジアナのHTML。単独ページとしても出力 |
| `public/` | 外部ライブラリ、公式UF2、配布用JSON、ライセンスなど |
| `pico/lib/` | Pico用Pythonライブラリの編集元 |
| `pico/examples/` | 単体の教材プログラム |
| `scripts/` | ビルドとローカルサーバー |
| `tests/` | 自動テスト |
| `docs/` | 公開用の生成物。ビルド後にコミットして公開 |

`docs/`は直接編集せず、対応するソースを編集します。
既存URLを維持するため、ビルド時にブラウザ用ファイルを公開ルートへ配置し、Pythonは`programs/`へ出力します。
`pico-sources.js`、CodeMirrorのバンドルとライセンス一覧、HTMLのアセットハッシュもビルド時に生成します。

## 公開

GitHub Pagesの公開元は**Deploy from a branch → main → /docs**です。
ローカルでビルドし、ソースと`docs/`を一緒にコミットしてpushします。

```sh
pnpm build
git add -A
git commit -m '変更内容'
git push origin HEAD:main
```

独自のGitHub Actionsワークフローは使いません。
`public/CNAME`はビルド時に`docs/CNAME`へコピーされます。
独自ドメイン`ir.swawa.dev`のPages設定と合わせて維持します。

外部ライブラリと公式ファームウェアの出典・ライセンスは`public/vendor/`、`public/firmware/`、`pico/lib/SSD1306-LICENSE.txt`にあります。
