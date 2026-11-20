// The end of a season: a champion's night, or the long walk back to the club room.

import { crowd, playBgm, sfx } from '../core/audio';
import { newSeed } from '../core/debug';
import { h } from '../core/dom';
import { commit, save, storeMatch } from '../core/save';
import { hero, talentOf } from '../game/heroes';
import { OPPONENTS, opponentSheet } from '../game/teams';
import { SCHEDULE, TEAM_COLOR, TEAM_NAME, clubSheet, learned, newSeason, type Season } from '../game/season';
import { confetti, kinetic } from './fx';
import { TALENT_COLOR, backdrop, button, cheerAt, portrait, speech, ticker } from './kit';
import { route, show } from './nav';
import { Stadium } from './stadium';
import { titleScreen } from './title';

/** The line-up needs a valid sheet even when the season was cut short in a debug jump. */
function sheetOf(s: Season): ReturnType<typeof clubSheet> | null {
  try {
    return clubSheet({ ...s, week: 0 });
  } catch {
    return null;
  }
}

export function endScreen(): [HTMLElement, () => void] {
  const s = save().season!;
  const champion = s.champion;
  playBgm(champion ? 'final' : 'club');
  const last = s.results[s.results.length - 1];
  const lastPlan = last ? SCHEDULE[last.week] : null;
  const where = lastPlan && lastPlan.t === 'match' ? lastPlan.label.replace('地区大会 ', '') : '';
  let stadium: Stadium | null = null;
  let timer = 0;
  const again = (): void => {
    save().season = newSeason(newSeed());
    storeMatch(null);
    commit();
    route();
  };

  const canvas = h('canvas.stadium');
  const sheet = champion ? sheetOf(s) : null;
  if (sheet) {
    stadium = new Stadium(canvas, [sheet, opponentSheet(3)]);
    stadium.setMotion(save().prefs.motion);
    stadium.attract();
    stadium.setExcitement(1);
  }
  const say = speech('manager');
  const team = h('div.end-team', s.members.map((m, i) => {
    const el = h('button.end-hero', { type: 'button', class: learned(m) ? 'on' : '', style: { '--i': String(i) } },
      portrait(m.id, { color: TALENT_COLOR[talentOf(m.stats).best] }), h('span', hero(m.id).name), m.captain ? h('i.label.hot', '主将') : null);
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
      h('h1', kinetic(champion ? '地区大会 優勝！' : `${where}で敗退`)),
      h('p.end-sub', champion ? '弱小と呼ばれた7人が、頂点に立った。全国への道は、ここから。' : 'あと一歩。部員の顔ぶれと育て方を変えて、もう一度挑もう。'),
      h('ol.end-results', s.results.map((r, i) => {
        const w = SCHEDULE[r.week]!;
        return h('li', { class: r.win ? 'win' : 'lose', style: { '--i': String(i) } },
          h('span', w.t === 'match' ? w.label.replace('地区大会 ', '') : ''),
          h('b.led', `${r.us}-${r.them}`),
          h('span', `${r.win ? '○' : '●'} ${OPPONENTS[r.opp]!.name}`));
      })),
      team,
      h('div.end-actions',
        button('新しいシーズンをはじめる', again, { cls: 'big go' }),
        button('タイトルへ', () => show(...titleScreen()), { cls: 'alt', sound: 'back' }))),
    h('div.end-foot.pad', say.el),
    ticker(champion
      ? [`${TEAM_NAME} 地区大会を制覇`, '次の舞台は全国大会（これからのアップデートで）', `優勝 ${save().titles} 回目`]
      : ['シーズン終了', '説明会に来る9人は毎年変わる', '主将をだれにするかで序盤の戦い方が変わる'], champion ? '速報' : 'また来年'));

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
      say.say('やりましたね、監督！！ 来年は全国大会ですよ！', 'cheer');
    } else {
      sfx.lose();
      say.say('くやしいです…。でも、次はきっと勝てます。もう一度、いきましょう！', 'cry');
    }
  }, { once: true });
  return [root, () => {
    clearInterval(timer);
    crowd.stop();
    stadium?.destroy();
  }];
}
