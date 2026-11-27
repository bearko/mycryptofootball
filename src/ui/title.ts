// The title: the lit stadium with two teams already at it, the logo slammed on top.

import { playBgm, sfx } from '../core/audio';
import { newSeed } from '../core/debug';
import { h } from '../core/dom';
import { commit, save, storeMatch } from '../core/save';
import { FOUNDERS, RECRUITS, hero } from '../game/heroes';
import { bestLineup } from '../game/lineup';
import type { TeamSheet } from '../game/match';
import { tierOf } from '../game/prestige';
import { opponentSheet } from '../game/teams';
import { TEAM_COLOR, TEAM_NAME, TEAM_SHORT, newSeason } from '../game/season';
import { RTA_REGULATION } from '../game/feats';
import { kinetic, typewriter } from './fx';
import { button, closeModal, modal, ticker } from './kit';
import { route } from './nav';
import { installWay, onInstallChange } from '../core/install';
import { abortRta, openChat, platformOn, rtaOpen, startRta } from './platform';
import { helpModal, installModal, offerInstallOnce, settingsModal } from './shared';
import { Stadium } from './stadium';

/** A club made of the first six recruits, for scenes that need a team before a season exists. */
export function demoSheet(): TeamSheet {
  const players = RECRUITS.slice(0, FOUNDERS).filter((_, i) => i % 2 === 0).map((r) => ({ id: r.id, name: hero(r.id).name, stats: r.stats }));
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
    abortRta();
    s.season = newSeason(newSeed());
    s.season.guide = true;
    // the manager teaches the first week (game/tutorial.ts)
    s.season.tut = [];
    storeMatch(null);
    commit();
    route();
  };
  const fresh = (): void => {
    if (!s.season) {
      start();
      return;
    }
    modal(h('div',
      h('p', `いまの部（${s.season.year}年目・${tierOf(s.season.tier).name}）の記録は消えます。`),
      h('div.modal-actions', button('やめる', closeModal, { cls: 'alt', sound: 'back' }), button('最初からはじめる', () => {
        closeModal();
        start();
      }))), { title: '最初からはじめますか？' });
  };
  // the RTA (bearko.games times it: from the founding briefing to the district title). A new club, no lessons
  const startRun = async (): Promise<void> => {
    closeModal();
    const season = newSeason(newSeed());
    s.season = season;
    storeMatch(null);
    commit();
    // the timing starts as the briefing opens (without the platform the club is simply a new one)
    if (await startRta()) season.rta = { reg: RTA_REGULATION, sent: [] };
    commit();
    route();
  };
  const rtaModal = (): void => {
    modal(h('div.rta-rule',
      h('p', '新しい部をつくり、地区大会で優勝するまでの時間を計ります。'),
      h('ul',
        h('li', '入部説明会から計測が始まり、最初の勝利・同好会・地区大会の優勝で区切ります'),
        h('li', 'マネージャーの説明は出ません'),
        h('li', 'ページを読み直したり、タイトルに戻って新しい部をつくると、計測はそこで終わります')),
      s.season ? h('p.rta-warn', `いまの部（${s.season.year}年目・${tierOf(s.season.tier).name}）の記録は消えます。`) : null,
      h('div.modal-actions', button('やめる', closeModal, { cls: 'alt', sound: 'back' }), button('RTA をはじめる', () => void startRun(), { cls: 'go' }))),
    { title: 'RTA で始める' });
  };
  const rtaButton = button('RTA', rtaModal, { cls: 'alt' });
  rtaButton.hidden = true;
  // shown once the platform says the RTA is open
  void rtaOpen().then((on) => {
    rtaButton.hidden = !on;
  });

  // a club goes on from year to year: there is always something to continue once it has been founded
  const going = !!s.season;
  const lead = h('p.title-sub');
  const menu = [
    going ? button('つづきから', route, { cls: 'big go' }) : null,
    button(going ? '最初から' : 'はじめる', fresh, { cls: going ? 'big alt' : 'big go' }),
    button('あそびかた', helpModal, { cls: 'alt' }),
    rtaButton,
    button('設定', settingsModal, { cls: 'alt' }),
    // the chat of bearko.games (only when its SDK is there)
    platformOn() ? button('チャット', openChat, { cls: 'alt' }) : null,
  ].filter((b): b is HTMLButtonElement => !!b);
  // the way to full-screen play: shown while the game still runs inside the browser
  const app = button('アプリとして入れる', installModal, { cls: 'cyan' });
  const syncApp = (): void => {
    app.hidden = installWay() === 'none';
  };
  syncApp();
  const offInstall = onInstallChange(syncApp);
  menu.push(app);
  menu.forEach((b, i) => b.style.setProperty('--i', String(i)));

  const root = h('div.screen.title',
    canvas,
    h('div.title-shade', { 'aria-hidden': 'true' }),
    h('div.title-main',
      h('span.label.dark.title-tag', '部員7人から。ぜんいん一芸もち。'),
      h('h1', h('span.t1', kinetic('My Crypto')), h('span.t2', kinetic('FOOTBALL'))),
      lead,
      h('nav.title-menu', menu)),
    ticker([
      'My Crypto Heroes の非公式ファンゲームです',
      s.season ? `${s.season.year}年目　格：${tierOf(s.season.tier).name}　部員${s.season.members.length}人` : '素人ばかりのアメフト部を、名門に育てよう',
      s.seasons ? `これまで ${s.seasons} シーズン、優勝 ${s.titles} 回${s.cleared ? `・頂上決戦制覇 ${s.cleared} 回` : ''}` : '作戦カードで地区大会の頂点へ',
      '作戦カードをえらぶだけ。アメフトを知らなくても遊べます', 'スマホは横向きで',
    ], 'KICK OFF'));
  root.addEventListener('shown', () => {
    sfx.whistle('long');
    typewriter(lead, '素人ばかりのアメフト部の監督になって、作戦カードで勝ち、名門に育てよう。', { cps: 30, onTick: () => sfx.typeTick() });
    // phones still inside the browser are shown how to get the full screen, first thing
    setTimeout(offerInstallOnce, 1700);
  }, { once: true });
  return [root, () => {
    offInstall();
    stadium.destroy();
  }];
}
