import { newSeed } from '../core/debug';
import { h } from '../core/dom';
import { commit, save, storeMatch } from '../core/save';
import { RECRUITS } from '../game/heroes';
import { newSeason } from '../game/season';
import { route } from './nav';
import { button, closeModal, helpModal, modal, muteButton, sprite } from './parts';

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
  const going = s.season && s.season.phase !== 'done';
  return h('div.screen.title',
    h('div.title-top', muteButton(), button('あそびかた', helpModal, 'ghost mini')),
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
