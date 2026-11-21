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

import { unlockAudio } from './core/audio';
import { debug } from './core/debug';
import { Rng } from './core/rng';
import { save } from './core/save';
import { RECRUITS } from './game/heroes';
import { TOP_TIER } from './game/prestige';
import { drawSchools } from './game/teams';
import { ROSTER_SIZE, SCHEDULE, joinCount, newSeason, nextYear, signRecruits, startDay } from './game/season';
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

// Sound needs a gesture, and on a phone only a lifted finger counts as one: listen to all of them, every time
// (unlockAudio retries whatever the browser refused so far, and is cheap once the music plays).
for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const) {
  window.addEventListener(ev, unlockAudio, { capture: true, passive: true });
}
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
    s.draw = drawSchools(s.league, new Rng(debug.seed ?? 7));
    const have = new Set(s.members.map((m) => m.id));
    s.candidates = RECRUITS.map((r) => r.id).filter((id) => !have.has(id));
    if (joinCount(s) > 0) signRecruits(s, s.candidates.slice(0, joinCount(s)));
    // every school year is there: the founders are in their last one
    s.members.forEach((m, i) => {
      m.grade = i < ROSTER_SIZE ? 3 : i % 2 ? 2 : 1;
    });
  }
  if (debug.trust !== null) for (const m of s.members) m.trust = debug.trust;
  const firstMatch = SCHEDULE.findIndex((w) => w.t === 'match');
  s.day = debug.day ?? (to === 'match' ? firstMatch : 0);
  s.hand = [];
  startDay(s);
  if (to === 'lineup') show(lineupScreen(() => open(clubScreen())));
  else if (to === 'match' && SCHEDULE[s.day]!.t === 'match') show(...matchScreen());
  else if (to === 'end' || to === 'champion') {
    s.phase = 'done';
    s.champion = to === 'champion';
    s.results = [{ day: 6, opp: 0, us: 21, them: 7, win: true }, { day: 13, opp: 1, us: 14, them: 7, win: true },
      { day: 20, opp: 2, us: 21, them: 14, win: true }, { day: 27, opp: 3, us: to === 'champion' ? 28 : 7, them: 21, win: to === 'champion' }];
    show(...endScreen());
  } else open(clubScreen());
}

// Always open on the title screen; "つづきから" resumes the season.
if (debug.go) jump(debug.go);
else show(...titleScreen());
