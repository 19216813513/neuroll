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

**Cloudflare Workers**（静的アセット）にデプロイする。Pages ではない。

Cloudflare は新規プロジェクトを Workers に誘導しており、静的 SPA では両者は等価
（どちらも帯域無制限、どちらも `_headers` を解釈する）。Workers を選ぶ理由は、
将来 PLAN §9.5 の同期 API を**同じデプロイに同居させられる**こと。

設定は [`wrangler.jsonc`](wrangler.jsonc) に入っているので、ダッシュボード側で
指定するのは次の3つだけ:

| 項目 | 値 |
|---|---|
| プロジェクト名 | `neuroll` |
| ビルドコマンド | `npm run build` |
| デプロイコマンド | `npx wrangler deploy` |

Node のバージョンは [`.nvmrc`](.nvmrc) で固定しているので、環境変数の設定は不要。

### CLI（wrangler）からデプロイする

初回のみログインする。**ブラウザの OAuth を使うので、実行前にブラウザが目的の
Cloudflare アカウントでサインインしていることを確認すること。**

```bash
npm run cf:login
```

接続先の確認（読み取りのみ）。1つのログインが複数アカウントに所属している場合、
ここに全部並ぶ。

```bash
npm run cf:whoami
```

デプロイ前の検証。ビルドと設定だけ確認して、アップロードはしない。

```bash
npm run deploy:dry
```

本番へデプロイ。

```bash
npm run deploy
```

本番を切り替えずにプレビュー版を上げる場合。

```bash
npm run deploy:preview
```

`wrangler.jsonc` に `account_id` を固定してあるので、別アカウントへのデプロイは
wrangler が拒否する。アカウントを変える場合はここを書き換える。

> **注意**: `wrangler pages deploy` は使わない。このプロジェクトは Pages ではなく
> Workers 静的アセットなので、そのコマンドを打つと `neuroll` を更新せずに別物の
> Pages プロジェクトが新規作成される。

ローカルで本番相当の配信を確認する場合（`_headers` の検証はこれで足りる）:

```bash
npm run build && npx wrangler dev --port 8788 --local
```

### デプロイ後に必ず確認すること

クロール対策が効いているかは、ヘッダを見ないと分からない。

```bash
curl -sI https://neuroll.<subdomain>.workers.dev | grep -i x-robots-tag
```

`X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` が返れば正常。
返らない場合は `public/_headers` が `dist/` にコピーされていない。

`_headers` は配信されず Workers にパースされるだけなので、`/_headers` に
アクセスすると（SPA フォールバックで）index.html が返る。これが正しい挙動。

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
