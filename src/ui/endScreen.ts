// The end of a season: a champion's night, or the long walk back to the club room.

import { crowd, playBgm, sfx } from '../core/audio';
import { newSeed } from '../core/debug';
import { h } from '../core/dom';
import { commit, save, storeMatch } from '../core/save';
import { hero, talentOf } from '../game/heroes';
import { sizeOf } from '../game/model';
import { opponentSheet } from '../game/teams';
import { tierOf } from '../game/prestige';
import { SCHEDULE, TEAM_COLOR, TEAM_NAME, GRADES, clubSheet, cupOf, graduating, learned, nextYear, roundOf, schoolAt, schoolId, type Season } from '../game/season';
import { fameBar, tierPlate } from './standing';
import { confetti, kinetic } from './fx';
import { TALENT_COLOR, backdrop, button, cheerAt, portrait, speech, ticker } from './kit';
import { route, show } from './nav';
import { Stadium } from './stadium';
import { titleScreen } from './title';

/** The line-up needs a valid sheet even when the season was cut short in a debug jump. */
function sheetOf(s: Season): ReturnType<typeof clubSheet> | null {
  try {
    return clubSheet({ ...s, day: 0 });
  } catch {
    return null;
  }
}

export function endScreen(): [HTMLElement, () => void] {
  const s = save().season!;
  const champion = s.champion;
  playBgm(champion ? 'final' : 'club');
  const last = s.results[s.results.length - 1];
  const where = last ? roundOf(SCHEDULE[last.day]!) : '';
  const cup = cupOf(s);
  const tier = tierOf(s.tier);
  /** the heroes in their last year: they leave before the next one begins */
  const leaving = graduating(s);
  const room = tier.roster - (s.members.length - leaving.length);
  let stadium: Stadium | null = null;
  let timer = 0;
  /** the same club, one year on */
  const again = (): void => {
    nextYear(s, newSeed());
    storeMatch(null);
    commit();
    route();
  };

  const canvas = h('canvas.stadium');
  const sheet = champion ? sheetOf(s) : null;
  if (sheet) {
    stadium = new Stadium(canvas, [sheet, opponentSheet(3, s.league, sizeOf(sheet.lineup), schoolId(s, 3))]);
    stadium.setMotion(save().prefs.motion);
    stadium.attract();
    stadium.setExcitement(1);
  }
  const say = speech('manager');
  const team = h(s.members.length > 8 ? 'div.end-team.is-many' : 'div.end-team', s.members.map((m, i) => {
    const el = h('button.end-hero', { type: 'button', class: `${learned(m) ? 'on' : ''} ${m.grade >= GRADES ? 'is-grad' : ''}`, style: { '--i': String(i) } },
      portrait(m.id, { color: TALENT_COLOR[talentOf(m.stats).best] }), h('span', hero(m.id).name), m.captain ? h('i.label.hot', '主将') : null,
      m.grade >= GRADES ? h('i.end-grad', '卒業') : null);
    el.addEventListener('click', () => {
      sfx.tap();
      el.querySelector('.portrait')?.classList.remove('hop');
      void (el as HTMLElement).offsetWidth;
      el.querySelector('.portrait')?.classList.add('hop');
      cheerAt(el, TALENT_COLOR[talentOf(m.stats).best]);
    });
    return el;
  }));
  const root = h('div.screen.end', { class: champion ? 'champion' : 'out' },
    sheet ? canvas : backdrop(['NEXT YEAR ◆ もう一度 ◆', 'あと一歩 ◆ NEVER GIVE UP ◆'], ['#2a2452', '#0b0d1f', '#6a6fa8']),
    h('div.end-shade', { 'aria-hidden': 'true' }),
    h('div.end-main',
      h('span.label.dark', `${TEAM_NAME} アメフト部`),
      h('h1', kinetic(champion ? `${cup} 優勝！` : `${where}で敗退`)),
      h('p.end-sub', champion ? `${s.year}年目の${TEAM_NAME}が、${cup}の頂点に立った。` : leaving.length ? `あと一歩。3年生の${leaving.length}人は、これで卒業。思いは後輩がつぐ。` : 'あと一歩。みんなは来年も残る。鍛えなおして、もう一度挑もう。'),
      h('div.end-standing', h('span', `${s.year}年目をおえて`), tierPlate(s.tier), fameBar(s.fame),
        h('i', s.tier !== s.league ? (s.tier > s.league ? `${tierOf(s.league).name}から昇格！` : `${tierOf(s.league).name}から降格…`) : ''),
        h('em', [
          leaving.length ? `3年生 ${leaving.length}人が卒業` : '',
          room > 0 ? `来年の春、新しい部員を${room}人までむかえられる` : s.tier !== s.league ? `来年は${tier.cup}に出場` : '',
          tier.size !== tierOf(s.league).size ? `来年の試合は${tier.size}人制` : '',
        ].filter(Boolean).join('。'))),
      h('ol.end-results', s.results.map((r, i) => {
        const w = SCHEDULE[r.day]!;
        return h('li', { class: r.win ? 'win' : 'lose', style: { '--i': String(i) } },
          h('span', roundOf(w)),
          h('b.led', `${r.us}-${r.them}`),
          h('span', `${r.win ? '○' : '●'} ${schoolAt(s, r.opp).name}`));
      })),
      team,
      h('div.end-actions',
        button(`${s.year + 1}年目へ`, again, { cls: 'big go' }),
        button('タイトルへ', () => show(...titleScreen()), { cls: 'alt', sound: 'back' }))),
    h('div.end-foot.pad', say.el),
    ticker(champion
      ? [`${TEAM_NAME} ${cup}を制覇`, `格：${tier.name}`, `優勝 ${save().titles} 回目`]
      : ['シーズン終了', `格：${tier.name}`, leaving.length ? '3年生は卒業。1・2年生は、身につけた力を来年にもちこせる' : '部員も、身につけた力も、来年にもちこせる'], champion ? '速報' : 'また来年'));

  root.addEventListener('shown', () => {
    if (champion) {
      sfx.win();
      crowd.start();
      crowd.roar(1);
      stadium?.celebrate('win', 0);
      confetti([TEAM_COLOR, '#fffbe8', '#ff5a2e', '#37e3ff'], 4);
      timer = window.setInterval(() => {
        stadium?.celebrate('td', 0);
        crowd.roar(0.5);
      }, 5200);
      say.say(leaving.length ? `やりましたね、監督！！ 3年生${leaving.length}人を、最高の形で送り出せます！` : s.tier > s.league ? `やりましたね、監督！！ 来年は「${tier.name}」として挑めますよ！` : 'やりましたね、監督！！ 来年も勝ちましょう！', 'cheer');
    } else {
      sfx.lose();
      say.say(s.tier < s.league ? 'くやしいです…。格は下がりましたが、相手も少しやさしくなります。立て直しましょう！' : leaving.length ? `くやしいです…。3年生${leaving.length}人は卒業ですが、1・2年生と新入部員で、またいきましょう！` : 'くやしいです…。でも、みんな来年も残ります。もう一度、いきましょう！', 'cry');
    }
  }, { once: true });
  return [root, () => {
    clearInterval(timer);
    crowd.stop();
    stadium?.destroy();
  }];
}
