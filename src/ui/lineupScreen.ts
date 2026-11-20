// The line-up board: the same six heroes on offense and on defense, one substitute on the bench.

import { blip } from '../core/audio';
import { h } from '../core/dom';
import { commit, save } from '../core/save';
import { KIND } from '../game/cards';
import { hero, recruit } from '../game/heroes';
import { bestLineup, isStarter, place } from '../game/lineup';
import { unitSummary } from '../game/match';
import { ROLE_HINT, ROLE_LABEL, fit, grade, roleOf, type DefPos, type OffPos } from '../game/model';
import { asPlayer, clubSheet, learned, member, type Season } from '../game/season';
import { button, manager, sprite } from './parts';

const OFF_ROWS: OffPos[][] = [['WR1', 'OL1', 'OL2', 'WR2'], ['QB'], ['RB']];
const DEF_ROWS: DefPos[][] = [['S'], ['CB1', 'LB', 'CB2'], ['DL1', 'DL2']];

/** Is the hero's special play available from this position? (null: not learned or not on this unit) */
function playState(s: Season, id: number, unit: 'off' | 'def', pos: OffPos | DefPos): null | boolean {
  const m = member(s, id);
  const info = KIND[recruit(id).kind];
  if (!learned(m) || info.side !== unit) return null;
  return !info.roles || info.roles.includes(roleOf(pos));
}

export function lineupScreen(back: () => void): HTMLElement {
  const s = save().season!;
  let held: number | null = null;
  const root = h('div.screen.lineup');

  const tapSlot = (unit: 'off' | 'def', pos: OffPos | DefPos): void => {
    const here = unit === 'off' ? s.lineup!.off[pos as OffPos] : s.lineup!.def[pos as DefPos];
    if (held === null) held = here;
    else if (held === here) held = null;
    else {
      s.lineup = place(s.lineup!, unit, pos, held);
      held = null;
      commit();
    }
    blip.pick();
    draw();
  };

  const slot = (unit: 'off' | 'def', pos: OffPos | DefPos): HTMLElement => {
    const id = unit === 'off' ? s.lineup!.off[pos as OffPos] : s.lineup!.def[pos as DefPos];
    const role = roleOf(pos);
    const g = grade(fit(member(s, id).stats, role));
    const ifHeld = held !== null && held !== id ? grade(fit(member(s, held).stats, role)) : null;
    const play = playState(s, id, unit, pos);
    return h('button.slot', {
      type: 'button', class: [held === id ? 'held' : '', `g${g}`].join(' '), title: ROLE_HINT[role],
      onclick: () => tapSlot(unit, pos),
    },
    h('span.slot-role', ROLE_LABEL[role]),
    sprite(id),
    h('span.slot-name', hero(id).name),
    h('span.slot-grade', g),
    play === null ? null : h('span.slot-play', { class: play ? 'on' : 'off' }, play ? '★' : '★×'),
    ifHeld ? h('span.slot-if', `→${ifHeld}`) : null);
  };

  const meter = (label: string, v: number): HTMLElement =>
    h('div.meter', h('span', label), h('span.bar-track', h('span.bar-fill', { style: { width: `${Math.min(100, v)}%` } })), h('b', Math.round(v)));

  const draw = (): void => {
    const bench = s.members.filter((m) => !isStarter(s.lineup!, m.id));
    const sum = unitSummary(clubSheet(s));
    const heldName = held !== null ? hero(held).name : '';
    root.replaceChildren(
      h('header.bar',
        h('h2', '編成'),
        h('p', held !== null ? `${heldName}をどこに置きますか？ 置きたい場所をタップ（→のあとの文字が、そこでの適性）` : '入れかえたいヒーローをタップ。同じ6人が攻撃も守備もします。S・A・B・C・D は適性')),
      h('div.boards',
        h('section.board.off', h('h3.sec', '攻撃', h('i', '上が相手側')),
          OFF_ROWS.map((row) => h('div.board-row', row.map((p) => slot('off', p)))),
          h('div.meters', meter('ラン', sum.runOff), meter('パス', sum.passOff))),
        h('section.board.def', h('h3.sec', '守備', h('i', '下が相手側')),
          DEF_ROWS.map((row) => h('div.board-row', row.map((p) => slot('def', p)))),
          h('div.meters', meter('ラン守備', sum.runDef), meter('パス守備', sum.passDef))),
        h('section.bench', h('h3.sec', '控え'),
          bench.map((m) => h('button.slot', {
            type: 'button', class: held === m.id ? 'held' : '',
            onclick: () => {
              held = held === m.id ? null : m.id;
              blip.pick();
              draw();
            },
          }, sprite(m.id), h('span.slot-name', hero(m.id).name))),
          h('p.bench-note', '★は特別作戦が使える位置。★×は位置が合っていません'))),
      h('footer.bar',
        manager('司令塔はパスと判断、ランナーは走力、ラインはブロック。守備はタックルと走力がものを言います。', 'pointer_up'),
        h('div.row',
          button('おまかせ', () => {
            s.lineup = bestLineup(s.members.map(asPlayer));
            held = null;
            commit();
            draw();
          }, 'big'),
          button('これでOK', back, 'primary big'))));
  };
  draw();
  return root;
}
