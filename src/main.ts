import '@fontsource/dela-gothic-one/japanese-400.css';
import '@fontsource/dela-gothic-one/latin-400.css';
import '@fontsource/dotgothic16/japanese-400.css';
import '@fontsource/dotgothic16/latin-400.css';
import './styles/main.css';

import { unlockAudio } from './core/audio';
import { save } from './core/save';
import { clubScreen } from './ui/club';
import { endScreen } from './ui/endScreen';
import { matchScreen } from './ui/matchScreen';
import { setRouter, show } from './ui/nav';
import { recruitScreen } from './ui/recruit';
import { titleScreen } from './ui/title';

for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, unlockAudio, { once: true });

setRouter(() => {
  const s = save().season;
  if (!s) show(titleScreen());
  else if (s.phase === 'recruit') show(recruitScreen());
  else if (s.phase === 'done') show(endScreen());
  else if (save().match) show(...matchScreen());
  else show(clubScreen());
});

// Always open on the title screen; "つづきから" resumes the season.
show(titleScreen());
