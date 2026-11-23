// The very first screen: which language the game is played in (English or Japanese). Asked once; the settings
// panel can change it later. Its own words are in both languages and are never translated.

import { h } from '../core/dom';
import { commit, prefs } from '../core/save';
import { localize, setLang, type Lang } from '../core/i18n';
import { sfx } from '../core/audio';

/** The language picker. `then`: the language is set and the page speaks it; go on to the title. */
export function languageScreen(then: () => void): HTMLElement {
  const pick = (l: Lang): void => {
    prefs().lang = l;
    commit();
    setLang(l);
    localize();
    sfx.cardConfirm();
    then();
  };
  return h('section.screen.lang', { data: { noTr: '1' } },
    h('div.lang-box',
      h('h1', h('span', 'Choose Language'), h('small', '言語選択')),
      h('div.lang-picks',
        h('button.lang-pick', { type: 'button', lang: 'en', onclick: () => pick('en') }, h('b', 'English')),
        h('button.lang-pick', { type: 'button', lang: 'ja', onclick: () => pick('ja') }, h('b', '日本語'))),
      h('p.lang-note', 'You can change this later in Settings. / あとから「設定」で変えられます。')));
}
