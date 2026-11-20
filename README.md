# My Crypto Football

My Crypto Heroes のヒーロー 7 人が部員のアメリカンフットボール部を率いて、弱小校から地区大会の優勝を目指す育成カードゲーム（非公式の二次創作）。

- **募集**：説明会に来た 9 人から 7 人をえらぶ。全員が「一芸もち」で、得意はひとつだけ
- **練習**：グループごとに練習カードを 1 枚。気になるヒーローはマンツーマンで見て、信頼を上げる
- **編成**：同じ 6 人が攻撃も守備もする。得意に合うポジションに置く
- **試合**：監督として作戦カードをえらぶ。相手のカードとの相性で結果が変わる。信頼がたまったヒーローは、試合の「流れ」を使って特別作戦を出せる

アメフトを知らなくても遊べるよう、ルールは大きく簡略化しています（キック・反則・時計なし）。
ゲームの全体像と数値は [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)。

## 操作

PC はマウス、スマホは横持ちでタップ。試合中は PC なら数字キーでカードをえらび、Enter か Space で決定できます。

## 開発

```sh
git clone --recurse-submodules https://github.com/bearko/mycryptofootball
cd mycryptofootball
npm install
npm run dev        # 開発サーバー
npm test           # テスト（シーズンを自動で回すバランス検査を含む）
npm run balance    # 勝率と得点の表を出す
npm run build      # dist/ にビルド
```

素材は [bearko/mycryptoheroes](https://github.com/bearko/mycryptoheroes)（サブモジュール `vendor/mycryptoheroes`）から、
`scripts/sync-assets.mjs` が使うものだけを `public/mch/` に写します（`npm run dev`・`build`・`test` の前に自動で走ります）。

## 公開（Cloudflare）

Cloudflare Workers の静的配信です（`wrangler.jsonc`、`dist/` を配信）。
Workers Builds でこのリポジトリをつなぎ、ビルドコマンド `npm run build`、デプロイコマンド `npx wrangler deploy` を設定します。
サブモジュールを使うので、ビルドの設定でサブモジュールの取得を有効にしてください。

## ライセンス

ソースコードと文書は MIT。My Crypto Heroes の画像・BGM・効果音は対象外です（[LICENSE](LICENSE)）。
