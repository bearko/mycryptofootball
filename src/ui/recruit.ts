// 入部説明会: the candidates stand on the stage and the coach signs some of them: seven of nine when the club is
// founded (the first one becomes captain), in later years as many newcomers as the club's standing has room for.
// The stage is the broadcast side (spotlight, LED counter, lamps); the scouting memo is the playbook side
// (cream paper on a clipboard, tape, a rubber stamp). The first hero signed becomes captain.

import { sfx, vibrate } from '../core/audio';
import { h } from '../core/dom';
import { commit, save } from '../core/save';
import { KIND } from '../game/cards';
import { hero, recruit, specialOf, talentOf } from '../game/heroes';
import { STATS, STAT_LABEL, type Stat, type Stats } from '../game/model';
import { tierOf } from '../game/prestige';
import { founding as isFounding, genOf, joinCount, midYear, needsCaptain, signRecruits } from '../game/season';
import { playCard, specialText } from './cardView';
import { burst, center, confetti, flash, flip, glitter, kick, kinetic, motion, pop, ring, shake, typewriter, type Typing } from './fx';
import { TALENT_COLOR, backdrop, button, cheerAt, genChip, modalOpen, portrait, radar, speech, sprite, statIcon, talentChip } from './kit';
import { route } from './nav';
import { bestRoles } from './shared';
import { guideEvent } from './platform';
import { lessonDue, markLesson } from '../game/tutorial';
import { clearGoal, teach } from './tutor';

const STAMP_INK = ['#e0261c', '#ff5a7a', '#fffbe8'];
/** How many candidates stand on the back riser (the rest stand in front). */
const BACK_ROW = 5;

/** A name that may wrap after each "・" (and nowhere else, if it fits). */
const nameNodes = (name: string): (string | Node)[] =>
  name.split('・').flatMap((part, i, all) => (i < all.length - 1 ? [`${part}・`, h('wbr')] : [part]));

const JERSEY = 'M9,2 L15,2 Q20,8 25,2 L31,2 L39,10 L34,17 L30,14 L30,36 L10,36 L10,14 L6,17 L1,10 Z';
/** Pennants strung across the top of the stage. */
const FLAGS = 13;

export function recruitScreen(): HTMLElement {
  const season = save().season!;
  const ids = season.candidates;
  /** how many sign today */
  const NEED = joinCount(season);
  /** the club is being founded: the first hero signed becomes its captain */
  const founding = isFounding(season);
  /** the first hero signed becomes captain (a new club, or one whose heroes have all graduated) */
  const lead = needsCaptain(season);
  /** the briefing in May: the spring tournament brought them */
  const may = midYear(season);
  /** how many left when the last year ended */
  const gone = founding || may ? 0 : (season.left ?? []).length;
  /** what a newcomer to a club of this standing has on top of a beginner's abilities */
  const plus = founding ? 0 : tierOf(season.tier).join;
  const joinStats = (id: number): Stats => {
    const base = recruit(id).stats;
    if (!plus) return base;
    const out = { ...base };
    for (const k of STATS) out[k] = base[k] + plus;
    return out;
  };
  /** in signing order: when the club is founded, the first one is the captain */
  const picked: number[] = [];
  let focus = ids[0]!;
  let typing: Typing | null = null;
  let lastLine = '';
  let leaving = false;

  const talent = (id: number): Stat => talentOf(recruit(id).stats).best;
  const full = (): boolean => picked.length >= NEED;
  // the heroes who are already in the club count too
  const old = season.members.map((m) => m.id);
  const covered = (k: Stat): number => [...old, ...picked].filter((id) => talent(id) === k).length;

  // ---------------------------------------------------------------- the stage

  const cands = new Map<number, HTMLButtonElement>();
  const spot = h('div.rc-spot', { 'aria-hidden': 'true' });

  const makeCand = (id: number, i: number): HTMLButtonElement => {
    const best = talent(id);
    const pic = portrait(id, { color: TALENT_COLOR[best] });
    const el: HTMLButtonElement = h('button.rc-cand', {
      type: 'button', class: `t-${best}`, style: { '--i': String(i) },
      'aria-label': `${hero(id).name}（${STAT_LABEL[best]}が得意）`,
      onclick: () => {
        if (focus === id) toggle(id);
        else {
          setFocus(id);
          const c = center(pic);
          ring(c.x, c.y, TALENT_COLOR[best], 1.2);
        }
      },
      onpointerenter: (e: PointerEvent) => {
        if (e.pointerType !== 'mouse') return;
        kick(pic, 'hop');
        setFocus(id);
      },
    },
    pic,
    talentChip(recruit(id).stats),
    h('span.rc-name', nameNodes(hero(id).name)),
    genChip(genOf(season, id)),
    h('span.rc-ask', { 'aria-hidden': 'true' }, '入部？'),
    h('span.rc-stamp', { 'aria-hidden': 'true' }, '入部'),
    h('span.rc-cap', { 'aria-hidden': 'true' }, '★主将'));
    cands.set(id, el);
    return el;
  };

  const rows = [
    // a big briefing stands in three rows, everybody a little smaller
    ...(ids.length > 9
      ? [0, 1, 2].map((r) => {
        const per = Math.ceil(ids.length / 3);
        return h('div.rc-row', { class: r === 0 ? 'back' : r === 2 ? 'front' : '' }, ids.slice(r * per, (r + 1) * per).map((id, i) => makeCand(id, r * per + i)));
      })
      : [h('div.rc-row.back', ids.slice(0, BACK_ROW).map((id, i) => makeCand(id, i))),
        h('div.rc-row.front', ids.slice(BACK_ROW).map((id, i) => makeCand(id, BACK_ROW + i)))]),
  ];
  const flags = h('div.rc-flags', { 'aria-hidden': 'true' }, Array.from({ length: FLAGS }, (_, i) => h('i', { style: { '--i': String(i) } })));
  const stage = h(ids.length > 9 ? 'section.rc-stage.is-many' : 'section.rc-stage', flags, rows, spot);

  /** Moves the spotlight onto the focused candidate (positions in % of the stage, so it survives a resize). */
  const placeSpot = (): void => {
    const c = cands.get(focus);
    const row = c?.parentElement;
    if (!c || !row || !stage.clientWidth) return;
    const x = row.offsetLeft + c.offsetLeft + c.offsetWidth / 2;
    const y = row.offsetTop + c.offsetTop + c.offsetHeight;
    spot.style.left = `${(x / stage.clientWidth) * 100}%`;
    spot.style.top = `${(y / stage.clientHeight) * 100}%`;
    spot.style.setProperty('--sc', TALENT_COLOR[talent(focus)]);
  };

  // ---------------------------------------------------------------- the scouting memo

  const big = h('div.rc-big');
  const who = h('h3.rc-who');
  const chipBox = h('span.rc-chipbox');
  const formNo = h('span.rc-form');
  const ghost = h('span.ghost');
  const say = h('span.say');
  const bubble = h('div.bubble.rc-bubble', ghost, say);
  const blurb = h('p.rc-blurb');
  const roles = h('p.rc-roles');
  const rd = radar(joinStats(focus));
  const cardBox = h('div.rc-card');
  const spName = h('b.rc-sp-name');
  const spText = h('p.rc-sp-text');
  const spMeta = h('p.rc-sp-meta');
  const sealed = h('span.rc-sealed', { 'aria-hidden': 'true' });
  const paper = h('div.rc-paper.paper.tape',
    formNo,
    h('div.rc-top', big, h('div.rc-id', who, chipBox), bubble),
    h('div.rc-notes', blurb, roles),
    h('div.rc-bottom',
      h('div.rc-radar', rd.el),
      cardBox,
      h('div.rc-sp', h('span.label.dark', '特別作戦'), spName, spText, spMeta)),
    sealed);
  const clip = h('section.rc-clip', paper);

  const drawReport = (): void => {
    const r = recruit(focus);
    const best = talent(focus);
    const info = KIND[r.kind];
    const sp = specialOf(focus, r.kind);
    const name = hero(focus).name;
    paper.className = `rc-paper paper tape t-${best}`;
    const pic = portrait(focus, { color: TALENT_COLOR[best] });
    big.replaceChildren(pic);
    kick(pic, 'hop');
    who.replaceChildren(kinetic(name), genChip(genOf(season, focus)) ?? '');
    who.classList.toggle('long', name.length > 6);
    chipBox.replaceChildren(talentChip(r.stats));
    formNo.textContent = `No.${ids.indexOf(focus) + 1}/${ids.length}`;
    // the self-introduction types itself into a bubble that springs to the size of the line
    typing?.skip();
    ghost.textContent = r.line;
    kick(bubble, 'grow');
    typing = typewriter(say, r.line, { cps: 48, onTick: () => sfx.typeTick() });
    blurb.textContent = r.blurb;
    roles.replaceChildren(h('b', '◎'), bestRoles(r.stats));
    rd.set(joinStats(focus));
    const card = playCard({ type: info.base, star: 1, special: sp }, info.side, {
      small: true,
      onpick: () => {
        sfx.cardPick();
        kick(cardBox, 'peek');
      },
    });
    card.setAttribute('aria-label', `特別作戦「${sp.name}」`);
    cardBox.replaceChildren(card);
    kick(cardBox, 'turn');
    spName.replaceChildren(...nameNodes(sp.name));
    // "what it does。" + "side／cost／where": the last part reads better as small tags
    const text = specialText(sp);
    const cut = text.lastIndexOf('。');
    const meta = cut >= 0 ? text.slice(cut + 1).split('／') : [];
    if (meta.length === 3) {
      spText.textContent = text.slice(0, cut + 1);
      spMeta.replaceChildren(h('i', meta[0]), h('i', meta[1]), h('span', meta[2]));
    } else {
      spText.textContent = text;
      spMeta.replaceChildren();
    }
    kick(paper, 'page');
  };

  // ---------------------------------------------------------------- the uniforms, the lamps, the counter

  const tokens = new Map<number, HTMLElement>();
  const slots = Array.from({ length: NEED }, (_, i) => {
    const el = h('div.rc-slot', { class: lead && i === 0 ? 'cap' : '' });
    el.innerHTML = `<svg viewBox="0 0 40 38" aria-hidden="true"><path d="${JERSEY}"/><text x="20" y="29" font-size="14" text-anchor="middle">${old.length + i + 1}</text></svg>`;
    if (lead && i === 0) el.append(h('span.rc-armband', '主将'));
    return el;
  });
  const lamps = new Map<Stat, HTMLElement>(STATS.map((k) => [k, h('div.rc-lamp', { class: `t-${k}` }, statIcon(k), h('span', STAT_LABEL[k]), h('u'))]));
  const countNum = h('b', '0');
  const count = h('div.rc-count.led', h('small', founding ? '部員' : '新入部員'), countNum, h('i', `/${NEED}`));
  const rack = h('section.rc-rack', count, h('div.rc-slots', { class: NEED > 9 ? 'is-many' : '' }, slots));

  /** Lights the lamp of every ability the picked heroes are great at; a lamp that just came on celebrates. */
  const syncLamps = (): void => {
    let n = 0;
    for (const k of STATS) {
      const lamp = lamps.get(k)!;
      const c = covered(k);
      if (c) n += 1;
      const was = lamp.classList.contains('on');
      lamp.classList.toggle('on', c > 0);
      lamp.querySelector('u')!.textContent = c > 1 ? `×${c}` : c ? '✓' : '';
      lamp.setAttribute('aria-label', `${STAT_LABEL[k]}：${c ? `${c}人` : 'まだいない'}`);
      if (c && !was) {
        kick(lamp, 'lit');
        const p = center(lamp);
        glitter(p.x, p.y, TALENT_COLOR[k], 8);
        sfx.statUp(n);
      }
    }
    if (countNum.textContent !== String(picked.length)) {
      countNum.textContent = String(picked.length);
      kick(count, 'tick');
      sfx.countTick();
    }
    count.classList.toggle('max', full());
  };

  /** Puts every signed hero into the uniform of their number; heroes that change number glide over. */
  const syncRack = (): HTMLElement[] => {
    const play = flip(tokens.values(), 360);
    for (const [id, tok] of tokens) {
      if (picked.includes(id)) continue;
      tokens.delete(id);
      tok.remove();
    }
    const fresh: HTMLElement[] = [];
    picked.forEach((id, i) => {
      let tok = tokens.get(id);
      if (!tok) {
        tok = h('div.rc-tok', { data: { id: String(id) } }, sprite(id));
        tokens.set(id, tok);
        fresh.push(tok);
      }
      if (tok.parentElement !== slots[i]) slots[i]!.append(tok);
    });
    slots.forEach((slot, i) => {
      const id = picked[i];
      slot.classList.toggle('full', id !== undefined);
      slot.style.setProperty('--tc', id !== undefined ? TALENT_COLOR[talent(id)] : '');
    });
    play();
    return fresh;
  };

  // ---------------------------------------------------------------- the manager and the buttons

  const mgr = speech('manager');
  const tell = (line: string, pose: string): void => {
    if (line === lastLine) return;
    lastLine = line;
    mgr.say(line, pose);
  };
  const advise = (): void => {
    const left = NEED - picked.length;
    const miss = STATS.filter((k) => !covered(k));
    const names = miss.slice(0, 2).map((k) => `「${STAT_LABEL[k]}」`).join('と');
    if (!picked.length && founding) tell('まずは主将をえらびましょう！ さいしょの1人は、特別作戦をすぐに使えますよ。', 'point');
    else if (!picked.length && lead) tell(`部員はみんな卒業しました。新しい部のはじまりです！ まずは主将をえらびましょう。`, 'point');
    else if (!picked.length && may) tell(`春の大会を見て、入部したいヒーローが来てくれました！ ${NEED}人むかえられます。`, 'cheer');
    else if (!picked.length && gone) tell(`3年生が${gone}人、卒業しました。新しい部員を${NEED}人むかえましょう！`, 'point');
    else if (!picked.length) tell(`${tierOf(season.tier).name}になって、部員を${NEED}人むかえられます！ ${miss.length ? `${names}が得意な子がほしいですね。` : 'だれをむかえましょう？'}`, 'point');
    else if (left === 0 && !miss.length) tell(founding ? `6つの能力がぜんぶそろった、いいチームです！ この${NEED}人でいきましょう、監督！` : `これで部員は${old.length + NEED}人！ たのもしくなりますね、監督！`, 'sparkle');
    else if (left === 0) tell(`${NEED}人そろいました！ ${names}は手うすですが、練習でおぎなえますよ。`, 'smile');
    else if (!miss.length) tell(`6つの能力がそろいました！ あと${left}人は、お好みでどうぞ。`, 'cheer');
    else if (miss.length > 2) tell(`あと${left}人。上のランプがぜんぶ光るように、いろんな得意をあつめましょう。`, 'point');
    else tell(`あと${left}人。まだ${names}が得意な子がいませんね。`, 'think');
  };

  const signLabel = h('span');
  const signBtn = button([signLabel], () => toggle(focus), { quiet: true, key: 'Enter' });
  const startLabel = h('span');
  let filling = false;
  /** Fills the empty places: first the abilities nobody has yet, then the strongest left. */
  const fillRest = (): void => {
    if (filling) return;
    filling = true;
    const order: number[] = [];
    const have = new Set(picked.map(talent));
    const rest = ids.filter((id) => !picked.includes(id));
    const total = (id: number): number => STATS.reduce((sum, k) => sum + recruit(id).stats[k], 0);
    // (the bonus of the club's standing is the same for everybody, so it does not change the order)
    while (picked.length + order.length < NEED && rest.length) {
      rest.sort((x, y) => Number(have.has(talent(x))) - Number(have.has(talent(y))) || total(y) - total(x));
      const id = rest.shift()!;
      have.add(talent(id));
      order.push(id);
    }
    const gap = motion() ? 230 : 0;
    order.forEach((id, i) => setTimeout(() => {
      if (!root.isConnected || leaving) return;
      if (!picked.includes(id) && !full()) {
        setFocus(id);
        sign(id);
      }
      if (i === order.length - 1) filling = false;
    }, i * gap));
    if (!order.length) filling = false;
  };
  const startBtn = button([startLabel], () => {
    if (leaving) return;
    if (!full()) {
      fillRest();
      return;
    }
    leaving = true;
    signRecruits(season, picked);
    commit();
    sfx.captain();
    vibrate([20, 40, 60]);
    confetti(['#ffe14a', '#ff5a2e', '#37e3ff', '#fffbe8'], 0.6);
    route();
  }, { cls: 'off' });

  /** Everything that only depends on who is focused and who is signed (cheap, no animation). */
  const mark = (): void => {
    const isIn = picked.includes(focus);
    for (const [id, el] of cands) {
      el.classList.toggle('focus', id === focus);
      el.classList.toggle('cap', lead && picked[0] === id);
      el.setAttribute('aria-pressed', String(picked.includes(id)));
    }
    root.classList.toggle('full', full());
    signLabel.textContent = isIn ? 'とりやめる' : full() ? `${NEED}人そろった` : '入部させる';
    signBtn.className = `btn ${isIn ? 'alt' : full() ? 'off' : ''}`;
    startBtn.className = `btn ${full() ? 'go' : 'alt'}`;
    startLabel.textContent = full() ? (founding ? `この${NEED}人ではじめる` : `この${NEED}人をむかえる`) : picked.length ? 'のこりはおまかせ' : 'おまかせでえらぶ';
    sealed.textContent = !isIn ? '' : lead && picked[0] === focus ? '主将' : '入部';
    paper.classList.toggle('signed', isIn);
    placeSpot();
  };

  const setFocus = (id: number): void => {
    if (focus === id) return;
    focus = id;
    sfx.pageTurn();
    drawReport();
    mark();
  };

  /** A slanted slab of news that crosses the stage and leaves. */
  const telop = (text: string): void => {
    stage.querySelector('.rc-telop')?.remove();
    const el = h('div.rc-telop', { 'aria-hidden': 'true' }, kinetic(text));
    stage.append(el);
    setTimeout(() => el.remove(), 1900);
  };

  // ---------------------------------------------------------------- signing

  /** The captain's moment: armband, fanfare, sparks. `big` for the very first signing. */
  const crown = (id: number, big: boolean): void => {
    const slot = slots[0]!;
    kick(slot, 'crowned');
    cheerAt(slot, '#ff5a2e');
    const r = cands.get(id)!.getBoundingClientRect();
    pop(r.left + r.width / 2, r.top + r.height * 0.35, '主将！');
    if (big) {
      sfx.captain();
      flash('#ffe14a', 260, 0.35);
      vibrate([20, 50, 40]);
    } else sfx.trustUp();
    tell(founding ? `${hero(id).name}が主将ですね！ 特別作戦「${hero(id).passive}」を、最初から使えます。` : `${hero(id).name}が新しい主将ですね！ たのもしいです。`, 'cheer');
  };

  /** The manager's lessons of the first briefing: after the captain, and when everybody is there. */
  const lesson = (): void => {
    if (!lessonDue(season, 'r3')) return;
    clearGoal();
    // (hands that are filling the places by themselves are not interrupted)
    if (filling && !full()) {
      markLesson(season, 'r2');
      return;
    }
    const id = full() ? 'r3' : picked.length === 1 ? 'r2' : '';
    if (id) setTimeout(() => root.isConnected && !leaving && void teach(season, id), full() ? 900 : 1100);
  };

  const sign = (id: number): void => {
    const el = cands.get(id)!;
    const isCaptain = lead && picked.length === 0;
    picked.push(id);
    el.classList.remove('out');
    el.classList.add('in');
    mark();
    // the stamp comes down...
    const stampAt = motion() ? 150 : 0;
    setTimeout(() => {
      if (!root.isConnected || !picked.includes(id)) return;
      sfx.stamp();
      vibrate(22);
      shake(0.45, 220);
      const c = center(el.querySelector('.rc-stamp')!);
      burst(c.x, c.y, { color: STAMP_INK, count: 16, power: 0.75, shape: ['dot', 'rect'], size: 0.8 });
      ring(c.x, c.y, '#e0261c', 1.5);
      kick(el.querySelector('.portrait'), 'hop');
    }, stampAt);
    // ...and the hero jumps into a uniform
    const from = el.querySelector('.portrait img')!.getBoundingClientRect();
    const [tok] = syncRack();
    const land = (): void => {
      if (!root.isConnected || !picked.includes(id)) return;
      const slot = tok?.parentElement;
      if (slot) {
        kick(slot, 'land');
        const c = center(slot);
        burst(c.x, c.y, { color: [TALENT_COLOR[talent(id)], '#fffbe8'], count: 10, power: 0.6, shape: ['star', 'rect'] });
      }
      syncLamps();
      lesson();
      if (isCaptain) crown(id, true);
      else {
        sfx.recruit();
        if (full()) {
          vibrate([15, 30, 15]);
          telop(`${NEED}人そろった！`);
          sfx.learn();
          const c = center(startBtn);
          ring(c.x, c.y, '#ffe14a', 2.2);
          glitter(c.x, c.y, '#ffe14a', 14);
        }
        advise();
      }
    };
    if (!tok || !motion()) {
      land();
      return;
    }
    const to = tok.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const s = from.width / Math.max(1, to.width);
    const lift = Math.max(to.height * 1.2, Math.abs(dx) * 0.22);
    const a = tok.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0, offset: 0 },
      { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 1, offset: 0.02 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.4 - lift}px) scale(${s * 1.12}) rotate(-16deg)`, offset: 0.5 },
      { transform: 'translate(0, 0) scale(1.25, 0.75)', offset: 0.88 },
      { transform: 'none', opacity: 1, offset: 1 },
    ], { duration: 560, delay: stampAt + 90, fill: 'backwards', easing: 'cubic-bezier(0.3, 0.1, 0.3, 1)' });
    a.onfinish = land;
  };

  const unsign = (id: number): void => {
    const el = cands.get(id)!;
    const wasCaptain = lead && picked[0] === id;
    clearGoal();
    picked.splice(picked.indexOf(id), 1);
    el.classList.remove('in');
    kick(el, 'out');
    setTimeout(() => el.classList.remove('out'), 320);
    sfx.back();
    const c = center(el.querySelector('.rc-stamp')!);
    ring(c.x, c.y, '#fffbe8', 1.1);
    syncRack();
    syncLamps();
    mark();
    const next = picked[0];
    if (wasCaptain && next !== undefined) crown(next, false);
    else advise();
  };

  const toggle = (id: number): void => {
    if (leaving) return;
    if (picked.includes(id)) unsign(id);
    else if (full()) {
      sfx.deny();
      kick(cands.get(id)!, 'nope');
      kick(count, 'nope');
      lastLine = '';
      tell(`部員は${NEED}人までです。入れかえるなら、先にだれかの入部をとりやめましょう。`, 'think');
    } else {
      sign(id);
      guideEvent(save(), 'captain');
    }
  };

  // ---------------------------------------------------------------- the screen

  const root = h('div.screen.recruit',
    backdrop(['ROOKIES WANTED', '新入部員 大募集'], ['#3a1f8a', '#090d24', '#ffb648']),
    h('header.head.pad',
      h('h2', may ? '追加の入部説明会' : '入部説明会'),
      h('p', h('span', `${ids.length}人から${NEED}人をえらぼう。`), h('span', founding ? 'さいしょの1人が主将になる！' : may ? `${season.year}年目の5月。格は「${tierOf(season.tier).name}」！` : lead ? `${season.year}年目の春。さいしょの1人が主将になる！` : `${season.year}年目の春。格は「${tierOf(season.tier).name}」！`)),
      h('div.row.rc-score', h('div.rc-cov', h('small', 'チームの得意'), h('div.rc-lamps', [...lamps.values()])))),
    h('main.rc-body.pad', stage, rack, clip),
    h('footer.foot.pad', mgr.el, h('div.row', signBtn, startBtn)));

  // keys: arrows walk along the stage, Enter / Space signs the focused hero
  const onKey = (e: KeyboardEvent): void => {
    if (!root.isConnected) {
      window.removeEventListener('keydown', onKey);
      return;
    }
    if (modalOpen() || leaving || e.altKey || e.ctrlKey || e.metaKey) return;
    const i = ids.indexOf(focus);
    let next: number | undefined;
    if (e.key === 'ArrowRight') next = ids[(i + 1) % ids.length];
    else if (e.key === 'ArrowLeft') next = ids[(i + ids.length - 1) % ids.length];
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // the nearest candidate on the other riser
      const here = cands.get(focus)!;
      const x = center(here).x;
      const other = [...cands.entries()].filter(([, el]) => el.parentElement !== here.parentElement);
      next = other.sort((a, b) => Math.abs(center(a[1]).x - x) - Math.abs(center(b[1]).x - x))[0]?.[0];
    } else if ((e.key === 'Enter' || e.key === ' ') && !(document.activeElement instanceof HTMLButtonElement)) {
      e.preventDefault();
      toggle(focus);
      return;
    }
    if (next === undefined) return;
    e.preventDefault();
    setFocus(next);
    cands.get(next)!.focus({ preventScroll: true });
  };
  window.addEventListener('keydown', onKey);

  // the candidates walk on once the screen is really visible
  let live = false;
  const enter = (): void => {
    if (live) return;
    live = true;
    root.classList.add('live');
    placeSpot();
    if (motion()) ids.forEach((_, i) => setTimeout(() => root.isConnected && sfx.hover(), 80 + i * 55));
    setTimeout(() => {
      if (!root.isConnected) return;
      placeSpot();
      if (!picked.length) advise();
      // a new coach: the manager introduces herself and the club
      void teach(season, 'r1');
    }, 500);
  };
  root.addEventListener('shown', enter);
  setTimeout(enter, 1400);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(placeSpot).observe(stage);

  drawReport();
  syncRack();
  mark();
  return root;
}
