import { newSeed } from '../core/debug';
import { h } from '../core/dom';
import { canFullscreen, goFullscreen, installWay, onInstallChange, promptInstall } from '../core/install';
import { commit, save, storeMatch } from '../core/save';
import { RECRUITS } from '../game/heroes';
import { newSeason } from '../game/season';
import { route } from './nav';
import { button, closeModal, helpModal, modal, muteButton, sprite } from './parts';

/** "Play it as an app": how to put the game on the home screen so it opens full-screen. */
export function installModal(): void {
  const body = h('div.install');
  let off: () => void = () => undefined;
  const close = (): void => {
    off();
    closeModal();
  };
  const draw = (): void => {
    const way = installWay();
    const steps = (items: string[]): HTMLElement => h('ol.install-steps', items.map((t, i) => h('li', h('b', String(i + 1)), h('span', t))));
    let guide: HTMLElement;
    const actions: HTMLElement[] = [];
    if (way === 'prompt') {
      guide = h('p', 'ホーム画面に置くと、ブラウザの枠がない全画面で遊べます。データはこの端末に残ります。');
      actions.push(button('アプリとして入れる', () => {
        void promptInstall().then((ok) => {
          if (ok) body.replaceChildren(h('h2', '追加しました！'), h('p', 'ホーム画面の「MC Football」から開くと全画面になります。'), button('OK', close, 'primary'));
          else draw();
        });
      }, 'primary big'));
    } else if (way === 'ios') {
      guide = steps(['画面の下（または上）にある共有ボタン（□から↑が出ている形）を押す', '「ホーム画面に追加」をえらぶ', 'ホーム画面にできた MC Football から開くと、全画面で遊べます']);
    } else if (way === 'menu') {
      guide = steps(['ブラウザの右上の「︙」（メニュー）を押す', '「ホーム画面に追加」か「アプリをインストール」をえらぶ', 'ホーム画面にできた MC Football から開くと、全画面で遊べます']);
    } else {
      guide = h('p', 'アプリとして開いています。このまま全画面で遊べます。');
    }
    if (way !== 'none' && canFullscreen()) actions.push(button('いまだけ全画面にする', () => void goFullscreen().then(close)));
    actions.push(button(way === 'none' ? 'とじる' : 'あとで', close, 'ghost'));
    body.replaceChildren(h('h2', '全画面で遊ぼう'),
      h('div.install-top', h('img.install-icon', { src: 'icon-192.png', alt: '' }), guide),
      h('div.row', actions));
  };
  draw();
  off = onInstallChange(draw);
  modal(body);
}

let installOffered = false;
/** Once per visit, on phones and tablets that are still inside the browser: offer the app right at the start. */
function offerInstallOnce(): void {
  if (installOffered) return;
  installOffered = true;
  if (installWay() === 'none' || !window.matchMedia('(pointer: coarse)').matches) return;
  installModal();
}

export function titleScreen(): HTMLElement {
  const s = save();
  const start = (): void => {
    s.season = newSeason(newSeed());
    storeMatch(null);
    commit();
    route();
  };
  const fresh = (): void => {
    if (!s.season || s.season.phase === 'done') {
      start();
      return;
    }
    modal(h('div.confirm',
      h('h2', '最初からはじめますか？'),
      h('p', 'いまのシーズンの記録は消えます。'),
      h('div.row', button('やめる', closeModal, 'ghost'), button('最初からはじめる', start, 'primary'))));
  };
  setTimeout(offerInstallOnce, 600);
  const going = s.season && s.season.phase !== 'done';
  return h('div.screen.title',
    h('div.title-top', installWay() === 'none' ? null : button('アプリとして入れる', installModal, 'mini primary'), muteButton(), button('あそびかた', helpModal, 'ghost mini')),
    h('div.title-main',
      h('p.title-lead', '部員7人。ぜんいん一芸もち。'),
      h('h1', 'My Crypto', h('br'), 'Football'),
      h('p.title-sub', '弱小アメフト部の監督になって、作戦カードで地区大会の頂点へ'),
      h('div.title-actions',
        going ? button('つづきから', route, 'primary big') : null,
        button(going ? '最初から' : 'はじめる', fresh, going ? 'big' : 'primary big')),
      s.seasons ? h('p.title-record', `これまで ${s.seasons} シーズン、優勝 ${s.titles} 回`) : null),
    h('div.title-turf', RECRUITS.map((r, i) => sprite(r.id, `hop hop${i % 4}`))),
    h('p.title-note', 'My Crypto Heroes の非公式ファンゲームです。'));
}
