// Things more than one screen needs: where a member plays, the list of who gained what,
// the hero detail pop-up, the how-to-play and the settings.

import { applyVolumes, sfx } from '../core/audio';
import { h } from '../core/dom';
import { canFullscreen, goFullscreen, installWay, onInstallChange, promptInstall } from '../core/install';
import { commit, prefs, save } from '../core/save';
import { lang, type Lang } from '../core/i18n';
import { speak } from '../core/voice/voice';
import { hero, recruit, specialOf, talentOf } from '../game/heroes';
import { isStarter } from '../game/lineup';
import { ROLE_LABEL, STATS, STAT_LABEL, defPos, fit, offPos, roleOf, type Role, type Stats } from '../game/model';
import {
  GRADES, STA_MAX, STA_TIRED, TRUST_BOOST, TRUST_LEARN, TRUST_MAX, boosted, learned, member, type Change, type Member, type Season,
} from '../game/season';
import { playCard, specialText } from './cardView';
import { glitter, center } from './fx';
import { TALENT_COLOR, button, cheerAt, closeModal, gauge, genChip, gradeChip, modal, portrait, radar, trustGauge } from './kit';
import { openChat, platformOn } from './platform';
import { lessonsModal } from './tutor';

/** Where a member plays: "QB / S", or "控え". */
export function positions(s: Season, id: number): string {
  const l = s.lineup!;
  const k = l.k === id;
  if (!isStarter(l, id)) return k ? 'K（キッカー）' : '控え';
  const off = offPos(l).find((p) => l.off[p] === id);
  const def = defPos(l).find((p) => l.def[p] === id);
  const where = off && def ? `${ROLE_LABEL[roleOf(off)]} / ${ROLE_LABEL[roleOf(def)]}` : off ? `攻撃の${ROLE_LABEL[roleOf(off)]}` : `守備の${ROLE_LABEL[roleOf(def!)]}`;
  return `${where}${k ? ' ・ K' : ''}`;
}

const ROLES: Role[] = ['QB', 'RB', 'WR', 'OL', 'DL', 'LB', 'CB', 'S'];
/** "攻撃はRB、守備はCB向き" */
export function bestRoles(stats: Stats): string {
  const top = (roles: Role[]): string => ROLE_LABEL[[...roles].sort((a, b) => fit(stats, b) - fit(stats, a))[0]!];
  return `攻撃は${top(ROLES.slice(0, 4))}、守備は${top(ROLES.slice(4))}向き`;
}

/**
 * Who gained what, one row per hero, arriving one after another with rising notes.
 * Trust gauges fill from the old value to the new one; new special plays are called out.
 */
export function changeList(s: Season, changes: Change[]): HTMLElement {
  const list = h('div.changes', changes.map((c, i) => {
    const m = member(s, c.id);
    const g = trustGauge(Math.max(0, m.trust - c.trust));
    const news = c.learnedNow || c.boostedNow;
    const row = h('div.change', { class: `${news ? 'news' : ''} t-${talentOf(m.stats).best}`, style: { '--i': String(i) } },
      portrait(c.id, { color: TALENT_COLOR[talentOf(m.stats).best] }),
      h('div.change-main',
        h('b', hero(c.id).name),
        STATS.filter((k) => c.stats[k]).map((k) => h('span', { class: c.stats[k]! < 0 ? 'minus' : '' }, `${STAT_LABEL[k]}${c.stats[k]! > 0 ? '+' : ''}${c.stats[k]}`)),
        c.trust ? h('span', { class: c.trust < 0 ? 'minus' : '' }, `信頼${c.trust > 0 ? '+' : ''}${c.trust}`) : null,
        c.sta ? h('span', { class: c.sta < 0 ? 'minus' : '' }, `体力${c.sta > 0 ? '+' : ''}${c.sta}`) : null),
      g,
      c.learnedNow ? h('em', `特別作戦「${hero(c.id).passive}」を覚えた！`) : null,
      c.boostedNow ? h('em', `「${hero(c.id).passive}」がさらに強くなった！`) : null);
    setTimeout(() => {
      if (!row.isConnected) return;
      sfx.statUp(i);
      (g.firstElementChild as HTMLElement).style.width = `${(m.trust / TRUST_MAX) * 100}%`;
      if (news) {
        sfx.learn();
        const p = center(row);
        glitter(p.x, p.y, '#ffe14a', 16);
      }
    }, 260 + i * 110);
    return row;
  }));
  return list;
}

export function memberModal(s: Season, m: Member): void {
  const r = recruit(m.id);
  const sp = specialOf(m.id, r.kind, boosted(m));
  const best = talentOf(m.stats).best;
  const state = boosted(m) ? '強化ずみ' : learned(m) ? `習得ずみ（信頼${TRUST_BOOST}でさらに強化）` : `信頼${TRUST_LEARN}で習得`;
  modal(h('div.member',
    h('div.member-top',
      h('div.member-who',
        portrait(m.id, { color: TALENT_COLOR[best] }),
        h('h3', hero(m.id).name, m.captain ? h('span.label.hot', '主将') : null),
        h('p.member-year', gradeChip(m.grade), genChip(m.gen), m.grade >= GRADES ? h('span', '今年で卒業') : null)),
      h('div.member-say', h('p.member-line', `「${r.line}」`), h('p', r.blurb), h('p.dim', `いまは ${positions(s, m.id)}。${bestRoles(m.stats)}`),
        h('div.member-trust', h('span', `信頼 ${m.trust}`), trustGauge(m.trust)),
        h('div.member-trust', h('span', `体力 ${m.sta}`), gauge(m.sta / STA_MAX, { color: m.sta < STA_TIRED ? '#ff8a3d' : '#7dff8a' }),
          m.sta < STA_TIRED ? h('i.member-worn', 'バテ気味：練習が身につきにくい') : null)),
      radar(m.stats, r.stats).el),
    h('div.member-play', { class: learned(m) ? 'on' : '' },
      playCard({ type: 'inside', star: 1, special: sp }, 'off', { small: true, read: 0 }),
      h('div', h('b', `特別作戦「${sp.name}」`), h('i', state), h('p', specialText(sp)))),
    h('div.modal-actions', button('とじる', closeModal, { sound: 'back' }))), { cls: 'wide' });
}

export function helpModal(): void {
  const rules: [string, string][] = [
    ['目標', '秋の大会で3回勝って優勝する。1年に大会は春と秋の2つ。春は前哨戦で、負けても夏に鍛えなおせる。秋は負けたらその年はおしまい。部はそのまま次の年へつづく（部員は入れかわっていく）。'],
    ['1年', '4月は毎日練習して春の大会。5〜7月はカード1枚で2週間ぶん練習（5月に追加の入部説明会）。7月末から2週間の夏合宿は、練習の効果が2倍で最後の日は紅白戦。8月から秋の大会。'],
    ['格', '部の格は 素人・同好会・弱小・注目株・中堅・強豪・名門 の7段階。試合に勝つとゲージがたまり、いっぱいで昇格。負けると減って、空になると降格。格が上がると部員と練習カードがふえ、大会も相手も大きくなる（下がれば相手も弱くなる）。素人は1回戦に勝てば同好会。'],
    ['攻撃', '4回の攻撃で10ヤード進めば、また4回攻められる。相手側の端まで運べばタッチダウンで6点。'],
    ['キック', 'キッカー（編成でえらぶ）がいると、キックのカードが出る。フィールドゴールは3点、パントは相手を遠ざける。タッチダウンのあとはもう1プレー：キックなら1点、プレーで運べば2点。'],
    ['キックオフ', '前半と後半のはじめと、得点のあとは、キックオフで相手にボールをわたす（得点したほうが蹴る）。第4クォーターで負けているときだけ、短く蹴って取り返しにいく「オンサイドキック」もえらべる。'],
    ['作戦カード', '攻撃も守備も、配られたカードから1枚えらぶ。相手のカードとの相性（◎と×）で結果が大きく変わる。'],
    ['ヒーロー', '全員が一芸もち。得意に合うポジションに置くと活躍する。地区大会は6人制、県大会から上は11人制。攻撃の組と守備の組は、べつべつに組める。'],
    ['卒業', '部員は3年で卒業する。年のおわりに3年生が部を去り、春の入部説明会で1年生をむかえる。卒業したヒーローの名前をつぐ後輩（2代目）が、しばらくして入ってくることもある。'],
    ['練習', '練習カードを1枚えらぶと1日（大会のあいだは2週間ほど）進む。ヒーローは経験を、育成方針で決めた能力に変える。試合は日曜。'],
    ['ランク', '能力の数字の目安。G・F・E・D・C・B・A・S・SS の順に高い（SSは100以上）。春・初夏・夏合宿・秋の区切りに、その期間の成長をふり返る。「成長」ボタンでいつでも見られる。'],
    ['体力', '練習すると減る。半分を切るとバテて、練習が身につきにくくなり、試合でも動きが落ちる。「休養」で戻る。'],
    ['信頼', '練習や試合でたまる。20でそのヒーローの特別練習がカードに出るようになる。'],
    ['ハドル', 'プレーの前に、ヒーローが相手との力の差や狙い目を言う。判断が高いヒーローほど当たる。カードの右上の数字は期待値の目安（10段階）。'],
    ['特別作戦', '信頼が40たまるとヒーローごとの特別作戦を覚える。試合中にたまる「流れ」を使って出す。'],
    ['読まれる', '同じ特別作戦は、使うたびに相手に読まれて弱くなる。ここぞで使おう。'],
  ];
  modal(h('div.help',
    h('ul', rules.map(([a, b], i) => h('li', { style: { '--i': String(i) } }, h('b', a), h('span', b)))),
    h('div.modal-actions', button('とじる', closeModal, { sound: 'back' }))), { title: 'あそびかた' });
}

/** Applies the settings to the page (text size, calm mode, colour support, volumes). */
export function applyPrefs(): void {
  const p = prefs();
  const root = document.documentElement;
  root.style.setProperty('--ts', String(p.text));
  root.classList.toggle('calm', !p.motion);
  root.classList.toggle('color-safe', p.colorSafe);
  applyVolumes();
}

export function settingsModal(): void {
  const p = prefs();
  const body = h('div.settings');
  const changed = (): void => {
    commit();
    applyPrefs();
    draw();
  };
  const seg = <T>(value: T, options: [T, string][], set: (v: T) => void): HTMLElement =>
    h('div.seg', options.map(([v, label]) => h('button', {
      type: 'button', class: v === value ? 'on' : '',
      onclick: () => {
        set(v);
        sfx.toggle(true);
        changed();
      },
    }, label)));
  const slider = (value: number, set: (v: number) => void, preview: () => void): HTMLElement => h('input.slider', {
    type: 'range', min: '0', max: '1', step: '0.05', value: String(value),
    oninput: (e: Event) => {
      set(Number((e.target as HTMLInputElement).value));
      commit();
      applyVolumes();
    },
    onchange: preview,
  });
  const row = (name: string, note: string, control: HTMLElement): HTMLElement => h('div.set-row', h('span', name, h('small', note)), control);
  const draw = (): void => {
    const rows: (HTMLElement | null)[] = [
      row('Language / 言語', '', seg<Lang>(lang(), [['ja', '日本語'], ['en', 'English']], (v) => {
        if (v === lang()) return;
        p.lang = v;
        commit();
        // the pages are built anew in the other language
        location.reload();
      })),
      row('チュートリアル', '説明をもう一度', h('div.seg', h('button', { type: 'button', onclick: lessonsModal }, '場面をえらぶ'))),
      row('音楽', '', slider(p.bgm, (v) => { p.bgm = v; }, () => undefined)),
      row('効果音', '歓声もふくむ', slider(p.se, (v) => { p.se = v; }, () => sfx.cardConfirm())),
      row('実況の声', '声：ElevenLabs', slider(p.voice ?? 0.9, (v) => { p.voice = v; }, () => speak('キックオフ！'))),
      row('演出', 'ゆれ・光・スロー', seg(p.motion, [[true, 'フル'], [false, 'ひかえめ']], (v) => { p.motion = v; })),
      row('試合の速さ', '', seg(save().fast, [[false, 'ふつう'], [true, '2倍速']], (v) => { save().fast = v; })),
      row('リプレイ', '大きなプレーをもう一度', seg(p.replay, [[true, 'ON'], [false, 'OFF']], (v) => { p.replay = v; })),
      row('文字', '', seg(p.text, [[1, '標準'], [1.15, '大きめ']], (v) => { p.text = v; })),
      row('色の補助', '色に形と記号を足す', seg(p.colorSafe, [[false, 'OFF'], [true, 'ON']], (v) => { p.colorSafe = v; })),
      row('振動', '対応するスマホのみ', seg(p.haptics, [[true, 'ON'], [false, 'OFF']], (v) => { p.haptics = v; })),
      installWay() === 'none' ? null : row('全画面', 'アプリとして入れる', h('div.seg', h('button', { type: 'button', onclick: installModal }, '入れ方を見る'))),
      platformOn() ? row('チャット', 'bearko.games のみんなと', h('div.seg', h('button', { type: 'button', onclick: () => { closeModal(); openChat(); } }, '開く'))) : null,
    ];
    body.replaceChildren(...rows.filter((r): r is HTMLElement => !!r));
  };
  draw();
  modal(h('div', body, h('div.modal-actions', button('とじる', closeModal, { sound: 'back' }))), { title: '設定' });
}

/**
 * "Play it as an app": how to put the game on the home screen so it opens full-screen.
 * The content follows what this browser can do (its own install dialog, or step-by-step directions).
 */
export function installModal(): void {
  const body = h('div.install');
  let off: () => void = () => undefined;
  const close = (): void => {
    off();
    closeModal();
  };
  const step = (n: number, text: string | (string | Node)[]): HTMLElement => h('li', h('i', String(n)), h('span', text));
  const draw = (): void => {
    const way = installWay();
    const actions: (HTMLElement | null)[] = [];
    let guide: HTMLElement;
    if (way === 'none') {
      guide = h('p.install-lead', 'アプリとして開いています。このまま全画面で遊べます。');
    } else if (way === 'prompt') {
      guide = h('p.install-lead', 'ホーム画面に置くと、ブラウザの枠がない全画面で遊べます。データはこの端末に残ります。');
      const go = button('アプリとして入れる', async () => {
        const ok = await promptInstall();
        if (ok) {
          cheerAt(go);
          sfx.learn();
          body.replaceChildren(h('p.install-lead', '追加しました！ ホーム画面の「MC Football」から開くと全画面になります。'),
            h('div.modal-actions', button('OK', close)));
        } else draw();
      }, { cls: 'big go' });
      actions.push(go);
    } else if (way === 'ios') {
      guide = h('ol.install-steps',
        step(1, ['画面の下（または上）にある ', h('b', '共有ボタン'), '（□から↑が出ている形）を押す']),
        step(2, [h('b', '「ホーム画面に追加」'), ' をえらぶ']),
        step(3, ['ホーム画面にできた ', h('b', 'MC Football'), ' から開くと、全画面で遊べます']));
    } else {
      guide = h('ol.install-steps',
        step(1, ['ブラウザの右上の ', h('b', '「︙」'), '（メニュー）を押す']),
        step(2, [h('b', '「ホーム画面に追加」'), ' か ', h('b', '「アプリをインストール」'), ' をえらぶ']),
        step(3, ['ホーム画面にできた ', h('b', 'MC Football'), ' から開くと、全画面で遊べます']));
    }
    if (way !== 'none' && canFullscreen()) {
      actions.push(button('いまだけ全画面にする', async () => {
        await goFullscreen();
        close();
      }, { cls: 'alt' }));
    }
    actions.push(button(way === 'none' ? 'とじる' : 'あとで', close, { cls: 'alt mini', sound: 'back' }));
    body.replaceChildren(
      h('div.install-top', h('img.install-icon', { src: 'icon-192.png', alt: '' }), guide),
      h('div.modal-actions', actions));
  };
  draw();
  off = onInstallChange(draw);
  modal(body, { title: '全画面で遊ぼう' });
}

let installOffered = false;
/** Once per visit, on phones and tablets that are still inside the browser: offer the app right at the start. */
export function offerInstallOnce(): void {
  if (installOffered) return;
  installOffered = true;
  if (installWay() === 'none') return;
  if (!window.matchMedia('(pointer: coarse)').matches) return;
  installModal();
}
