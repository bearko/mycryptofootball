import { playBgm } from '../core/audio';
import { newSeed } from '../core/debug';
import { h } from '../core/dom';
import { commit, save, storeMatch } from '../core/save';
import { hero } from '../game/heroes';
import { OPPONENTS } from '../game/teams';
import { SCHEDULE, TEAM_NAME, learned, newSeason } from '../game/season';
import { route, show } from './nav';
import { button, manager, sprite } from './parts';
import { titleScreen } from './title';

export function endScreen(): HTMLElement {
  const s = save().season!;
  playBgm('club');
  const last = s.results[s.results.length - 1];
  const lastPlan = last ? SCHEDULE[last.week] : null;
  const where = lastPlan && lastPlan.t === 'match' ? lastPlan.label : '';
  const again = (): void => {
    save().season = newSeason(newSeed());
    storeMatch(null);
    commit();
    route();
  };
  return h('div.screen.end', { class: s.champion ? 'champion' : '' },
    h('div.end-main',
      h('p.title-lead', TEAM_NAME),
      h('h1', s.champion ? '地区大会 優勝！' : `${where}で敗退`),
      h('p.title-sub', s.champion
        ? '弱小と呼ばれた7人が、頂点に立った。全国への道はここから。'
        : 'あと一歩。部員の顔ぶれと育て方を変えて、もう一度挑もう。'),
      h('ul.end-results', s.results.map((r) => {
        const w = SCHEDULE[r.week]!;
        return h('li', { class: r.win ? 'win' : 'lose' },
          h('span', w.t === 'match' ? w.label : ''),
          h('b', `${r.win ? '○' : '●'} ${r.us} - ${r.them}`),
          h('span', OPPONENTS[r.opp]!.name));
      })),
      h('div.end-team', s.members.map((m) => h('div', { class: learned(m) ? 'on' : '' }, sprite(m.id), h('span', hero(m.id).name)))),
      h('div.title-actions',
        button('新しいシーズンをはじめる', again, 'primary big'),
        button('タイトルへ', () => show(titleScreen()), 'big'))),
    h('footer.bar', manager(s.champion ? 'やりましたね、監督！ 来年は全国大会ですよ！' : 'くやしいです…。でも、きっと次は勝てます！', s.champion ? 'sparkle' : 'cry')));
}
