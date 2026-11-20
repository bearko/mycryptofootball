# UI の決まり：「ナイター中継 × 監督のプレイブック」

このゲームの画面は、ふたつの世界でできている。

- **中継の側**：斜めのテロップ板、黒い硬い影、LED のドット、止まらないニュースの帯。試合・結果・見出しはこちら
- **プレイブックの側**：クリーム色の紙、チョークの ○ と ×、テープとスタンプ。作戦カード・編成・練習はこちら

どの画面でも守ること。

1. **止まっている場所を作らない**。背景は `backdrop()` がつねに動く。ヒーローは息をする（`portrait()`）。待ち時間にも何かがゆれている
2. **押したら必ず返事がある**。音（`sfx`）＋形（リング・火花・はずみ）＋必要なら振動（`vibrate`）。`button()` は最初からそうなっている。自前の押せる要素も同じ水準にする
3. **UI は背景より鮮やかに**。黄 `--yellow` はいちばん大事な 1 か所に。背景や飾りは彩度を落とす
4. **重ねる**。大きな文字のうしろにヒーロー、ヒーローの手前にテロップ。UI を板の上に並べるだけにしない
5. **説明しなくても分かる**。押せるものは斜めの板か、持ち上がる紙。押せないものは平ら。選んだものは浮き、黄色い縁がつく
6. **色だけに意味を持たせない**。6 つの能力は「色＋アイコン＋言葉」（`statIcon`・`talentChip`）。良い・悪いは ◎ と × を添える
7. **動きは短く、はずむ**。出入りは 0.2〜0.5 秒、`var(--spring)`。順番に出すときは 40〜70ms ずつずらす。画面の切り替えは `show()` が斜めの帯で行う（自前で作らない）
8. 設定の「演出：ひかえめ」（`prefs().motion === false`）では、ゆれ・光・スローを出さない（`fx.ts` の関数は自動で従う）

## 大きさ

- 1rem が画面に合わせて伸び縮みする（`base.css` の `html`）。すべて rem で書く
- いちばん狭いのは 16:9 の PC（横およそ 71rem）、いちばん低いのはスマホ横持ち（縦およそ 37rem）。**71rem × 37rem に収める**
- 文字は `var(--fs-xs)`〜`var(--fs-xxl)` を使う（文字サイズの設定が効く）。本文は `--fs-s` 以上
- 押せるものは高さ 4.4rem 以上（スマホで 44px）
- ドット絵は `image-rendering: pixelated`（`.px` か `portrait()`）。整数倍でなくてよい

## 色（`base.css` の変数）

| 変数 | 使いどころ |
|---|---|
| `--yellow` | いちばん大事な操作・自分のチーム |
| `--orange` | 熱いもの（流れ・勝負どころ・相手の脅威） |
| `--cyan` | 守備・情報 |
| `--lime` / `--pink` | 上がった / 下がった・信頼 |
| `--ink` | 縁取りと影。影はぼかさず `var(--shadow)` |
| `--paper` | プレイブックの紙 |
| `--c-spd` `--c-pas` `--c-cat` `--c-blk` `--c-tkl` `--c-iq` | 6 つの能力（`.t-spd` などのクラスで `--tc` に入る） |

## 部品（`src/ui/kit.ts`）

| 関数 | 何か |
|---|---|
| `button(label, onclick, opts)` | 斜めの板のボタン。`cls`：`big` `mini` `alt` `cyan` `hot` `go`（縞が流れる「いま押すべき」ボタン）`off`（押せない） |
| `portrait(id, {color})` | ハーフトーンの円を背負って息をするヒーロー。`.hop` クラスを付け直すと跳ねる（`kick(el, 'hop')`） |
| `sprite(id)` | 素のドット絵 |
| `statIcon(k)` `talentChip(stats)` | 能力のアイコン／一芸の札 |
| `radar(stats, was?)` | 6 能力のレーダー。`.set(stats, was)` でなめらかに形が変わる |
| `gauge(0..1, {marks,color})` `trustGauge(trust)` | 斜めのゲージ。幅を変えるとはずんで伸びる |
| `speech('manager' \| 'announcer', text, pose)` | しゃべる人。文字が打たれ、口が動き、吹き出しがセリフの長さに合わせてはずむ。`.say(text, pose)` で次のセリフ |
| `modal(content, {title, sticky, cls:'wide'})` `closeModal()` | ポップアップ。開いている間は音楽がこもる |
| `backdrop([文字1, 文字2], [色a, 色b, 色c])` | 画面の最初の子に置く、動く背景。巨大な縁文字が流れる |
| `ticker(items, 'LIVE')` | ニュースの帯 |
| `cheerAt(el, color)` | その場で小さく祝う（火花・リング・振動） |

共通の画面部品（`src/ui/shared.ts`）：`positions` `bestRoles` `changeList(season, changes)`（成長の一覧。順に現れて音が上がっていく）`memberModal` `helpModal` `settingsModal`。

作戦カード（`src/ui/cardView.ts`）：`playCard(pick, side, opts)`。ポインターに合わせて傾き、えらぶとチョークの線が描かれる。特別作戦はホイルのカード。

## 手ごたえ（`src/ui/fx.ts`）

`burst` `sparks` `ring` `glitter` `confetti`（粒子）、`shake` `flash`（画面全体）、`pop(x, y, '+6')`（飛び出す数字）、
`kinetic(text)`（1 文字ずつ叩きつける文字）、`typewriter`、`countUp`、`tween`、`tilt(el)`、`flip(nodes)`（並べ替えをなめらかに）、`kick(el, cls)`（CSS アニメーションをもう一度）、`center(el)`。

## 音（`src/core/audio.ts`）

マーチングバンドの楽器で統一する：スネアのリム（ふれる・押す）、バスドラム（決定）、ブラス（成功）、ホイッスル、紙の音（カード）。
`sfx.hover` `sfx.tap` `sfx.back` `sfx.deny` `sfx.cardPick` `sfx.cardConfirm` `sfx.stamp` `sfx.swap` `sfx.statUp(n)` `sfx.trustUp` `sfx.learn` `sfx.recruit` `sfx.captain` `sfx.practice` `sfx.event` ほか。歓声は `crowd`。

## 画面ごとのファイル

各画面は `src/ui/<名前>.ts` と `src/styles/<名前>.css` の組。共通の見た目は `base.css`、カードは `cards.css`。
画面が本当に表示されたあとに何かしたいときは、画面の要素で `shown` イベントを待つ（切り替えの帯が終わってから届く）。
