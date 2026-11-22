// The tournament's bracket on screen: eight teams, four on each side, the final in the middle.
// It is announced before the first round (the teams come in one by one, the club's first opponent is pointed out),
// and after each of the club's games the round's results are drawn in (the winners' lines light up, the losers dim).
// Both are shows, not pop-ups: they go on by themselves, and a tap goes on at once. From the practice ground the
// bracket can be looked at any time while a tournament is on.

import { sfx } from '../core/audio';
import { h } from '../core/dom';
import { CLUB, clubReach, freshGames, markSeen, pairOf, type Bracket } from '../game/bracket';
import { SCHOOLS } from '../game/teams';
import { TEAM_COLOR, TEAM_SHORT, cupOf, type Season } from '../game/season';
import { tierOf } from '../game/prestige';
import { burst, confetti, motion } from './fx';
import { button, closeModal, modal } from './kit';

const NS = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: (Node | string | null)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const k of kids) if (k != null) el.append(k);
  return el;
}

// ---- where everything stands (a 1000 × 560 board)
const ENTRY_Y = [70, 200, 330, 460];
const ENTRY_W = 230;
const ENTRY_H = 58;
/** each game's point: where its two lines meet */
const GAME: readonly [number, number][] = [
  [305, 135], [305, 395], [695, 135], [695, 395], // the first round
  [395, 265], [605, 265], // the semi-finals
  [500, 265], // the final
];
/** the place a team comes from into a game: an entry (0–7), or an earlier game (8 + its index) */
const FEEDS: readonly [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12, 13]];
const entryAt = (i: number): [number, number] => (i < 4 ? [10 + ENTRY_W, ENTRY_Y[i]!] : [990 - ENTRY_W, ENTRY_Y[i - 4]!]);
const nodeAt = (n: number): [number, number] => (n < 8 ? entryAt(n) : GAME[n - 8]!);

const nameOf = (id: number): string => (id === CLUB ? TEAM_SHORT : SCHOOLS[id]!.short);
const fullOf = (id: number): string => (id === CLUB ? 'マイクリ学園' : SCHOOLS[id]!.name);
const colorOf = (id: number): string => (id === CLUB ? TEAM_COLOR : SCHOOLS[id]!.color);

/** the team that went through a place (an entry, or an earlier game's winner) */
const teamAt = (b: Bracket, n: number): number | null => (n < 8 ? b.field[n]! : b.won[n - 8] ?? null);

export interface BracketOpts {
  /** announce the draw: the teams come in one by one */
  reveal?: boolean;
  /** games to draw in now (the others are shown as they stand); games not yet seen and not here are hidden */
  fresh?: number[];
}

/** The bracket board. */
export function bracketBoard(b: Bracket, opts: BracketOpts = {}): SVGSVGElement {
  const fresh = new Set(opts.fresh ?? []);
  const seen = new Set(b.seen ?? []);
  /** a game is shown decided when the coach has seen it, or it is being drawn in now */
  const decided = (g: number): boolean => b.won[g] != null && (seen.has(g) || fresh.has(g));
  const root = svg('svg', { viewBox: '0 0 1000 560', class: `bk-board ${opts.reveal ? 'is-reveal' : ''}`, role: 'img', 'aria-label': 'トーナメント表' });

  // the round names along the top
  for (const [x, text] of [[305, '1回戦'], [395, '準決勝'], [500, '決勝'], [605, '準決勝'], [695, '1回戦']] as const) {
    root.append(svg('text', { x, y: 22, class: 'bk-round' }, text));
  }

  // the lines: each game takes its two teams in
  let order = 0;
  FEEDS.forEach(([a, c], g) => {
    const [gx, gy] = GAME[g]!;
    const done = decided(g);
    for (const n of [a, c]) {
      const [x, y] = nodeAt(n);
      // a team came along this line when the place before it is decided (or it is an entry)
      const came = n < 8 || decided(n - 8);
      const team = came ? teamAt(b, n) : null;
      const won = done && team != null && b.won[g] === team;
      const lost = done && team != null && !won;
      const path = svg('path', {
        d: `M${x} ${y} H${gx} V${gy}`, pathLength: 1,
        class: `bk-line ${won ? 'won' : lost ? 'lost' : ''} ${won && team === CLUB ? 'club' : ''} ${won && fresh.has(g) ? 'fresh' : ''}`,
        style: `--d:${fresh.has(g) ? 0.2 + order * 0.35 : 0}s`,
      });
      if (won && fresh.has(g)) order += 1;
      root.append(path);
    }
    // the score, by the game's point
    if (done && b.score[g]) {
      const [w, l] = b.score[g]!;
      // (the first round's beside their points, the semi-finals' outside theirs, the final's under its line)
      const at: [number, number, string] = g < 2 ? [gx + 10, gy - 10, 'is-left'] : g < 4 ? [gx - 10, gy - 10, 'is-right']
        : g === 4 ? [gx - 10, gy - 10, 'is-right'] : g === 5 ? [gx + 10, gy - 10, 'is-left'] : [gx, gy + 34, 'is-final'];
      root.append(svg('text', {
        x: at[0], y: at[1],
        class: `bk-score ${at[2]} ${fresh.has(g) ? 'fresh' : ''}`,
        style: `--d:${fresh.has(g) ? 0.4 + [...fresh].indexOf(g) * 0.35 : 0}s`,
      }, `${w}-${l}`));
    }
  });

  // the teams
  b.field.forEach((id, i) => {
    const [ex, ey] = entryAt(i);
    const left = i < 4;
    const x = left ? ex - ENTRY_W : ex;
    // out: lost a game the coach has seen
    let out = false;
    for (let g = 0; g < 7; g += 1) {
      const [p, q] = pairOf(b, g);
      if (decided(g) && (p === id || q === id) && b.won[g] !== id) out = true;
    }
    const champ = decided(6) && b.won[6] === id;
    const g = svg('g', {
      class: `bk-team ${id === CLUB ? 'is-club' : ''} ${out ? 'is-out' : ''} ${champ ? 'is-champ' : ''}`,
      style: `--i:${i};--tc:${colorOf(id)}`, transform: `translate(${x} ${ey - ENTRY_H / 2})`,
    },
    svg('rect', { width: ENTRY_W, height: ENTRY_H, class: 'bk-box' }),
    svg('rect', { x: left ? 0 : ENTRY_W - 14, width: 14, height: ENTRY_H, class: 'bk-chip' }),
    svg('text', { x: left ? 26 : ENTRY_W - 26, y: ENTRY_H / 2 + 1, class: `bk-name ${left ? '' : 'is-right'}` }, fullOf(id).length > 7 ? nameOf(id) : fullOf(id)));
    root.append(g);
  });

  // the cup in the middle, and the winner once there is one
  const champ = decided(6) ? b.won[6]! : null;
  root.append(svg('g', { class: `bk-cup ${champ != null ? 'is-won' : ''} ${champ != null && fresh.has(6) ? 'fresh' : ''}`, transform: 'translate(500 150)' },
    svg('path', { d: 'M-26 -40 H26 V-18 C26 4 12 14 0 14 C-12 14 -26 4 -26 -18 Z M-8 14 H8 V30 H18 V40 H-18 V30 H-8 Z', class: 'bk-trophy' }),
    svg('text', { y: 74, class: 'bk-champ' }, champ != null ? fullOf(champ) : '優勝は？')));
  return root;
}

/** The title of a tournament's bracket: "春の県大会". */
const titleOf = (s: Season, stage: 'spring' | 'autumn'): string =>
  `${stage === 'spring' ? '春' : '秋'}の${stage === 'spring' ? tierOf(s.springLeague ?? s.league).cup : cupOf(s)}`;

/**
 * Shows the bracket over the screen: the draw announced, or the latest results drawn in. It goes on by itself; a tap
 * goes on at once. Marks what was shown as seen.
 */
export function showBracket(parent: HTMLElement, s: Season, stage: 'spring' | 'autumn', mode: 'reveal' | 'update'): Promise<void> {
  const b = s.cups?.[stage];
  if (!b) return Promise.resolve();
  const fresh = mode === 'update' ? freshGames(b) : [];
  if (mode === 'update' && !fresh.length) return Promise.resolve();
  const reach = clubReach(b);
  const first = b.field[1]!;
  const head = mode === 'reveal' ? '組み合わせ発表' : fresh.includes(6) ? '大会結果' : '途中経過';
  const note = mode === 'reveal' ? `1回戦の相手は ${fullOf(first)}！`
    : reach === 4 ? '優勝！！' : reach > 0 ? (b.won[6] != null ? `優勝は ${fullOf(b.won[6]!)}` : '') : '勝ち上がり！ 次の相手が決まった';
  const board = bracketBoard(b, { reveal: mode === 'reveal', fresh });
  const layer = h('div.bk-show', { class: `is-${mode} ${reach === 4 && fresh.includes(6) ? 'is-champ' : ''}` },
    h('div.bk-panel',
      h('div.bk-head', h('span.bk-cupname', titleOf(s, stage)), h('b', head)),
      board,
      h('p.bk-note', note)),
    h('span.bk-tap', 'タップで次へ'));
  parent.append(layer);
  markSeen(b, b.won.map((w, g) => (w == null ? -1 : g)).filter((g) => g >= 0));
  if (mode === 'reveal') b.shown = true;
  (mode === 'reveal' ? sfx.transition : sfx.open)();
  // the club's first opponent is pointed out, then the lines of the round are drawn in
  const lit = (): void => {
    if (!layer.isConnected) return;
    if (reach === 4 && fresh.includes(6)) {
      sfx.win();
      confetti([TEAM_COLOR, '#fffbe8', '#ff5a2e', '#37e3ff'], 2);
    } else if (fresh.length) sfx.firstDown();
    const club = board.querySelector('.bk-team.is-club');
    const r = club?.getBoundingClientRect();
    if (r && motion() && mode === 'update' && reach === 0) burst(r.left + r.width, r.top + r.height / 2, { count: 12, color: ['#ffe14a', '#fffbe8'], shape: ['star'] });
  };
  const litTimer = window.setTimeout(lit, mode === 'reveal' ? 2600 : 700 + fresh.length * 200);
  return new Promise((resolve) => {
    let done = false;
    const end = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(litTimer);
      layer.classList.add('out');
      setTimeout(() => layer.remove(), 260);
      resolve();
    };
    const timer = window.setTimeout(end, mode === 'reveal' ? 6200 : 3600 + fresh.length * 350);
    // (a press, not a click: the click that brought the layer up must not close it)
    layer.addEventListener('pointerup', () => {
      sfx.tap();
      end();
    });
  });
}

/** The bracket as it stands, from the practice ground. */
export function bracketModal(s: Season, stage: 'spring' | 'autumn'): void {
  const b = s.cups?.[stage];
  if (!b) return;
  modal(h('div.bk-view', bracketBoard(b),
    h('div.modal-actions', button('とじる', closeModal, { sound: 'back' }))), { title: titleOf(s, stage), cls: 'wide bk-modal' });
  sfx.open();
}
