// The title: the lit stadium with two teams already at it, the logo slammed on top.

import { playBgm, sfx } from '../core/audio';
import { newSeed } from '../core/debug';
import { h } from '../core/dom';
import { commit, save, storeMatch } from '../core/save';
import { RECRUITS, hero } from '../game/heroes';
import { bestLineup } from '../game/lineup';
import type { TeamSheet } from '../game/match';
import { opponentSheet } from '../game/teams';
import { TEAM_COLOR, TEAM_NAME, TEAM_SHORT, newSeason } from '../game/season';
import { kinetic, typewriter } from './fx';
import { button, closeModal, modal, ticker } from './kit';
import { route } from './nav';
import { helpModal, settingsModal } from './shared';
import { Stadium } from './stadium';

/** A club made of the first six recruits, for scenes that need a team before a season exists. */
export function demoSheet(): TeamSheet {
  const players = RECRUITS.filter((_, i) => i % 2 === 0).map((r) => ({ id: r.id, name: hero(r.id).name, stats: r.stats }));
  return { name: TEAM_NAME, short: TEAM_SHORT, color: TEAM_COLOR, players, lineup: bestLineup(players), specials: [], runBias: 0.5, smart: 0.5 };
}

export function titleScreen(): [HTMLElement, () => void] {
  const s = save();
  playBgm('club');
  const canvas = h('canvas.stadium');
  const stadium = new Stadium(canvas, [demoSheet(), opponentSheet(3)]);
  stadium.setMotion(s.prefs.motion);
  stadium.attract();

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
    modal(h('div',
      h('p', 'いまのシーズンの記録は消えます。'),
      h('div.modal-actions', button('やめる', closeModal, { cls: 'alt', sound: 'back' }), button('最初からはじめる', () => {
        closeModal();
        start();
      }))), { title: '最初からはじめますか？' });
  };
  const going = !!s.season && s.season.phase !== 'done';
  const lead = h('p.title-sub');
  const menu = [
    going ? button('つづきから', route, { cls: 'big go' }) : null,
    button(going ? '最初から' : 'はじめる', fresh, { cls: going ? 'big alt' : 'big go' }),
    button('あそびかた', helpModal, { cls: 'alt' }),
    button('設定', settingsModal, { cls: 'alt' }),
  ].filter((b): b is HTMLButtonElement => !!b);
  menu.forEach((b, i) => b.style.setProperty('--i', String(i)));

  const root = h('div.screen.title',
    canvas,
    h('div.title-shade', { 'aria-hidden': 'true' }),
    h('div.title-main',
      h('span.label.dark.title-tag', '部員7人。ぜんいん一芸もち。'),
      h('h1', h('span.t1', kinetic('My Crypto')), h('span.t2', kinetic('FOOTBALL'))),
      lead,
      h('nav.title-menu', menu)),
    ticker([
      'My Crypto Heroes の非公式ファンゲームです',
      s.seasons ? `これまで ${s.seasons} シーズン、優勝 ${s.titles} 回` : '弱小アメフト部の監督になって、地区大会の頂点へ',
      '作戦カードをえらぶだけ。アメフトを知らなくても遊べます', 'スマホは横向きで',
    ], 'KICK OFF'));
  root.addEventListener('shown', () => {
    sfx.whistle('long');
    typewriter(lead, '弱小アメフト部の監督になって、作戦カードで地区大会の頂点へ。', { cps: 30, onTick: () => sfx.typeTick() });
  }, { once: true });
  return [root, () => stadium.destroy()];
}
