import '@fontsource/dela-gothic-one/japanese-400.css';
import '@fontsource/dela-gothic-one/latin-400.css';
import '@fontsource/dotgothic16/japanese-400.css';
import '@fontsource/dotgothic16/latin-400.css';
import './styles/base.css';
import './styles/cards.css';
import './styles/title.css';
import './styles/recruit.css';
import './styles/club.css';
import './styles/training.css';
import './styles/lineup.css';
import './styles/match.css';
import './styles/end.css';

import { unlockAudio } from './core/audio';
import { debug } from './core/debug';
import { save } from './core/save';
import { ROSTER_SIZE, SCHEDULE, newSeason, signRecruits, startWeek } from './game/season';
import { clubScreen } from './ui/club';
import { endScreen } from './ui/endScreen';
import { wireHover } from './ui/kit';
import { matchScreen } from './ui/matchScreen';
import { setRouter, show } from './ui/nav';
import { lineupScreen } from './ui/lineupScreen';
import { recruitScreen } from './ui/recruit';
import { applyPrefs } from './ui/shared';
import { titleScreen } from './ui/title';
import { trainingScreen } from './ui/training';

for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, unlockAudio, { once: true });
applyPrefs();
wireHover();

setRouter(() => {
  const s = save().season;
  if (!s) show(...titleScreen());
  else if (s.phase === 'recruit') show(recruitScreen());
  else if (s.phase === 'done') show(...endScreen());
  else if (save().match) show(...matchScreen());
  else show(clubScreen());
});

/** ?go=<screen>: jump straight to a screen with a ready-made season (for development). */
function jump(to: string): void {
  const s = newSeason(debug.seed ?? 7);
  save().season = s;
  save().match = null;
  save().helpSeen = true;
  if (to === 'recruit') {
    show(recruitScreen());
    return;
  }
  signRecruits(s, s.candidates.slice(0, ROSTER_SIZE));
  if (debug.trust !== null) for (const m of s.members) m.trust = debug.trust;
  const firstMatch = SCHEDULE.findIndex((w) => w.t === 'match');
  s.week = debug.week ?? (to === 'match' ? firstMatch : 0);
  startWeek(s);
  if (to === 'training' && s.deal) show(trainingScreen());
  else if (to === 'lineup') show(lineupScreen(() => show(clubScreen())));
  else if (to === 'match' && SCHEDULE[s.week]!.t === 'match') show(...matchScreen());
  else if (to === 'end' || to === 'champion') {
    s.phase = 'done';
    s.champion = to === 'champion';
    s.results = [{ week: 2, opp: 0, us: 21, them: 7, win: true }, { week: 5, opp: 1, us: 14, them: 7, win: true },
      { week: 7, opp: 2, us: 21, them: 14, win: true }, { week: 9, opp: 3, us: to === 'champion' ? 28 : 7, them: 21, win: to === 'champion' }];
    show(...endScreen());
  } else show(clubScreen());
}

// Always open on the title screen; "つづきから" resumes the season.
if (debug.go) jump(debug.go);
else show(...titleScreen());
