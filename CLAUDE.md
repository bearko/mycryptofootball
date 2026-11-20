# プロジェクトのメモ（Claude 用）

- **ユーザーへの返答・報告・質問は、必ず日本語で書く**。
- **ほかの作品の名前（参考にした漫画・ゲームなど）や、その登場人物・技・固有の用語を、このリポジトリのどこにも書かない**。ファイル・コミットメッセージ・ブランチ名・PR のタイトルと本文・コメントのすべてが対象。仕組みは「一芸特化の部員」「作戦カードで進む試合」のように一般的な言葉で書く。実在のチーム・リーグ・大会・選手の名前も使わない。
- このリポジトリは「My Crypto Football」。My Crypto Heroes のヒーローが部員のアメフト部を育てて、作戦カードで試合をする。全体像と数値は `docs/GAME_DESIGN.md`。ルールを変えたらこの文書も直す。
- サイトを開くと `index.html` → `src/main.ts`。公開は Cloudflare Workers の静的配信（`wrangler.jsonc`）。本番のブランチは `main`。
- 構成：
  - `src/core/` 乱数（`rng.ts`）、セーブ（`save.ts`）、音（`audio.ts`）、DOM の小道具（`dom.ts`）、デバッグ用 URL（`debug.ts`）
  - `src/game/` ルール。画面を知らない：`model.ts`（能力・ポジション・適性）、`cards.ts`（作戦カード・相性表・特別作戦の種類）、`heroes.ts`（入部候補 12 人）、`teams.ts`（対戦校）、`lineup.ts`（編成）、`match.ts`（試合エンジン・相手の AI）、`season.ts`（募集・練習・イベント・大会）
  - `src/ui/` 画面
- 素材は `vendor/mycryptoheroes`（サブモジュール）から `scripts/sync-assets.mjs` が使うものだけを `public/mch/` に写し、`src/generated/catalog.json` を作る（どちらも Git には入れない）。手元にサブモジュールがないときは `MCH_ASSETS_DIR=/path/to/mycryptoheroes` を付けて動かす。
- 特別作戦の名前は、そのヒーローのパッシブスキル名（カタログの `passive`）をそのまま使う。効果は `cards.ts` の `KIND`。
- 試合は乱数を `MatchState.rng` だけから取る。同じ種と同じ選択なら同じ試合になること（テストあり）。試合の途中経過はプレーごとにセーブする。
- 難度は `teams.ts` の `base`・`spread`、`match.ts` の `ADV_SCALE`、`season.ts` の信頼の増え方。変えたら `npm run balance` で勝率を確かめる。目安：ていねいに遊ぶ自動操縦で 練習試合 9 割・1 回戦 8 割・準決勝 6 割・決勝 3 割前後。
- デバッグ用の URL（どこからもリンクしない）：`?trust=80`（全員の信頼）、`?week=5`（その週へ）、`?bot=1`（自動で試合を進める・早送り）、`?seed=123`（乱数の種を固定）。
- チェック：`npm test`・`npm run typecheck`・`npm run build`。
- PC とスマホ横持ちの両方で遊べること。1rem が画面に合わせて伸び縮みする（`main.css` の `html`）。横幅は 16:9 の PC がいちばん狭い（約 71rem）。画面を直したら 1280×720 と 844×390 で重なりを確かめる。ボタンは 44px 以上、ドット絵は `image-rendering: pixelated`。
