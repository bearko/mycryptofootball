import '@fontsource/dela-gothic-one/japanese-400.css';
import '@fontsource/dela-gothic-one/latin-400.css';
import '@fontsource/dotgothic16/japanese-400.css';
import '@fontsource/dotgothic16/latin-400.css';
import './styles/base.css';
import './styles/cards.css';
import './styles/title.css';
import './styles/recruit.css';
import './styles/club.css';
import './styles/policy.css';
import './styles/lineup.css';
import './styles/match.css';
import './styles/end.css';
import './styles/tutor.css';
import './styles/bracket.css';
import './styles/duel.css';
import './styles/alumni.css';

import { unlockAudio } from './core/audio';
import { debug } from './core/debug';
import { Rng } from './core/rng';
import { save } from './core/save';
import { RECRUITS } from './game/heroes';
import { TOP_TIER } from './game/prestige';
import { drawYear } from './game/teams';
import { ROSTER_SIZE, SCHEDULE, drawCup, hasTactic, joinCount, newSeason, nextYear, signRecruits, stageStart, startDay, tacticOf, type DayPlan } from './game/season';
import { LEVEL_PTS, TACTICS, type Tactic } from './game/tactics';
import { clubScreen } from './ui/club';
import { endScreen } from './ui/endScreen';
import { wireHover } from './ui/kit';
import { matchScreen } from './ui/matchScreen';
import { setRouter, show } from './ui/nav';
import { lineupScreen } from './ui/lineupScreen';
import { startPlatform } from './ui/platform';
import { recruitScreen } from './ui/recruit';
import { applyPrefs } from './ui/shared';
import { titleScreen } from './ui/title';
import { languageScreen } from './ui/language';
import { localize, setLang } from './core/i18n';
import { prefs } from './core/save';

// Sound needs a gesture, and on a phone only a lifted finger counts as one: listen to all of them, every time
// (unlockAudio retries whatever the browser refused so far, and is cheap once the music plays).
for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const) {
  window.addEventListener(ev, unlockAudio, { capture: true, passive: true });
}
// the language: English is laid over the Japanese pages as they appear (core/i18n.ts)
setLang(debug.lang === 'en' || debug.lang === 'ja' ? debug.lang : prefs().lang ?? 'ja');
localize();
applyPrefs();
wireHover();
startPlatform();

/** A screen is either an element, or an element with something to do when it is left. */
const open = (screen: HTMLElement | [HTMLElement, () => void]): void => (Array.isArray(screen) ? show(...screen) : show(screen));

setRouter(() => {
  const s = save().season;
  if (!s) show(...titleScreen());
  else if (s.phase === 'recruit') show(recruitScreen());
  else if (s.phase === 'done') show(...endScreen());
  else if (save().match) show(...matchScreen());
  else open(clubScreen());
});

/** ?go=<screen>: jump straight to a screen with a ready-made season (for development). */
function jump(to: string): void {
  const s = newSeason(debug.seed ?? 7);
  save().season = s;
  save().match = null;
  save().helpSeen = true;
  if (to === 'recruit' && debug.day !== null) {
    signRecruits(s, s.candidates.slice(0, ROSTER_SIZE));
    // the May briefing: the spring is over, and the club has gone up a step (or as far as ?tier= says)
    s.tier = Math.max(1, Math.min(TOP_TIER, debug.tier ?? 1));
    s.day = stageStart('summer');
    startDay(s);
    show(s.phase === 'recruit' ? recruitScreen() : clubScreen()[0]);
    return;
  }
  if (to === 'recruit' && debug.tier === null) {
    show(recruitScreen());
    return;
  }
  signRecruits(s, s.candidates.slice(0, ROSTER_SIZE));
  if (debug.tier !== null) {
    // a club that has already come some way
    s.tier = Math.max(0, Math.min(TOP_TIER, debug.tier));
    s.fame = 40;
    s.year = 1 + s.tier;
    if (to === 'recruit') {
      // three of the founders are in their last year: the briefing follows a graduation
      s.members.forEach((m, i) => {
        m.grade = i < 3 ? 3 : i < 5 ? 2 : 1;
      });
      s.phase = 'done';
      nextYear(s, debug.seed ?? 7);
      show(recruitScreen());
      return;
    }
    s.league = s.tier;
    s.draw = drawYear(s.league, new Rng(debug.seed ?? 7));
    drawCup(s, 'spring', new Rng(debug.seed ?? 7));
    const have = new Set(s.members.map((m) => m.id));
    s.candidates = RECRUITS.map((r) => r.id).filter((id) => !have.has(id));
    if (joinCount(s) > 0) signRecruits(s, s.candidates.slice(0, joinCount(s)));
    // every school year is there: the founders are in their last one
    s.members.forEach((m, i) => {
      m.grade = i < ROSTER_SIZE ? 3 : i % 2 ? 2 : 1;
    });
  }
  if (debug.trust !== null) for (const m of s.members) m.trust = debug.trust;
  if (debug.ob !== null) {
    s.ob = debug.ob;
    s.medals = debug.ob;
  }
  if (hasTactic(s) && (debug.tactic || debug.tlv !== null)) {
    if (debug.tactic && (TACTICS as readonly string[]).includes(debug.tactic)) s.tactic = debug.tactic as Tactic;
    s.tactic ??= tacticOf(s);
    s.tacticWins = LEVEL_PTS[Math.max(1, Math.min(LEVEL_PTS.length, debug.tlv ?? 1)) - 1];
  }
  const firstMatch = SCHEDULE.findIndex((w) => w.t === 'match');
  s.day = Math.max(0, Math.min(SCHEDULE.length - 1, debug.day ?? (to === 'match' ? firstMatch : 0)));
  // a day in the middle of a part of the year: that part has begun already (its first day: it begins now)
  const at = SCHEDULE[s.day]!;
  if (s.day !== stageStart(at.stage)) {
    s.stageAt = stageStart(at.stage);
    if (at.stage === 'autumn') {
      s.league = s.tier;
      drawCup(s, 'autumn', new Rng(debug.seed ?? 7));
    }
  }
  s.hand = [];
  startDay(s);
  // (a day's start clears the event: the asked-for one comes after it)
  if (debug.event && s.members.length > 1) {
    s.event = { key: debug.event, a: s.members[0]!.id, b: s.members[1]!.id };
    s.told = ['e1', 'e2', 'e3', 'e4'];
  }
  if (s.phase === 'recruit') show(recruitScreen());
  else if (to === 'lineup') show(lineupScreen(() => open(clubScreen())));
  else if (to === 'match' && SCHEDULE[s.day]!.t === 'match') show(...matchScreen());
  else if (to === 'end' || to === 'champion' || to === 'clear') {
    s.phase = 'done';
    s.champion = to !== 'end';
    // the summit won as well: the game is beaten
    if (to === 'clear') s.summit = 'won';
    // a year played to its end: lost the spring's semi-final, then all the way to the autumn's final (and the summit)
    const won = (d: DayPlan): boolean => (d.stage === 'spring' ? d.round < 2 : d.round < 3 || to !== 'end');
    s.results = SCHEDULE.filter((d) => d.t === 'match' && !(d.stage === 'spring' && d.round === 3) && (!d.summit || to === 'clear'))
      .map((d) => ({ day: d.n, m: d.m, opp: d.round, us: won(d) ? 21 : 7, them: won(d) ? 14 : 17, win: won(d) }));
    show(...endScreen());
  } else open(clubScreen());
}

// Always open on the title screen; "つづきから" resumes the season.
if (debug.go) jump(debug.go);
else if (!prefs().lang && !debug.lang) show(languageScreen(() => show(...titleScreen())));
else show(...titleScreen());
