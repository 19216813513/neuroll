# neuroll

脳力を測定し、向上させることに全振りした Web アプリ。
設計の全体像は [PLAN.md](PLAN.md) を参照。

現在の状態: **フェーズ 0 完了**（計測基盤 + 保存層 + 反応時間種目）

## 開発

```bash
npm run dev
```

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー (http://localhost:5173) |
| `npm run build` | 型チェック + 本番ビルド → `dist/` |
| `npm test` | ユニットテスト (Vitest) |
| `npm run lint` | Biome によるチェック |
| `npm run fix` | Biome の自動修正 |

## デプロイ

GitHub 連携（推奨）の場合、Cloudflare Pages 側の設定:

| 項目 | 値 |
|---|---|
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| 環境変数 | `NODE_VERSION` = `22` |

CLI から直接デプロイする場合:

```bash
npx wrangler login
```

```bash
npm run deploy
```

### デプロイ後に必ず確認すること

クロール対策が効いているかは、ヘッダを見ないと分からない。

```bash
curl -sI https://neuroll.pages.dev | grep -i x-robots-tag
```

`X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` が返れば正常。
返らない場合は `public/_headers` が `dist/` にコピーされていない。

## 構成

```
src/
  core/        計測基盤（時刻・スケジューラ・入力・乱数・端末プロファイル）
  stats/       統計（記述統計・信号検出理論・標準化）— ブラウザ API 非依存
  scores/      スコアバケット・妥当性チェック
  store/       IndexedDB・エクスポート/インポート
  exercises/   種目。追加時はここに 1 ディレクトリ + registry.ts に 1 行
  app/         画面
```

`core/` と `stats/` は種目に依存しない。`stats/` と各種目の `score.ts` は
ブラウザ API を参照しない純関数に保つこと（将来サーバー側で再計算するため）。

## 注意

- 記録はブラウザの IndexedDB にのみ保存される。**サイトデータを削除すると失われる**ので
  定期的に JSON エクスポートすること。
- このプロジェクトは Dropbox 配下にあるため、`node_modules` は Dropbox の同期対象から
  除外している（`com.dropbox.ignored` 属性）。除外しないと Vite の依存キャッシュ更新が
  `EBUSY` で失敗する。`node_modules` を作り直した場合は再設定が必要:

```bash
powershell -c "Set-Content -Path 'node_modules' -Stream 'com.dropbox.ignored' -Value 1"
```
