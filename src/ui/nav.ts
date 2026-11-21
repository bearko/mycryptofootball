// Screen switching. A screen is just an element; `show` swaps it in behind a wipe.

import { sfx } from '../core/audio';
import { wipe } from './fx';
import { closeModal } from './kit';
import { closeTutor } from './tutor';

let leave: (() => void) | null = null;
let router: () => void = () => undefined;
let first = true;

/** Shows a screen. `onLeave` runs when the next screen replaces it. `cut` skips the wipe. */
export function show(el: HTMLElement, onLeave?: () => void, cut = false): void {
  const swap = (): void => {
    leave?.();
    leave = onLeave ?? null;
    closeModal();
    closeTutor();
    document.getElementById('app')!.replaceChildren(el);
  };
  // screens that need to act once they are really on screen listen for 'shown'
  const shown = (): boolean => el.dispatchEvent(new Event('shown'));
  if (first || cut) {
    first = false;
    swap();
    setTimeout(shown, 30);
    return;
  }
  sfx.transition();
  void wipe(swap).then(shown);
}

/** Goes to whatever screen the saved game calls for. */
export const route = (): void => router();
export function setRouter(f: () => void): void {
  router = f;
}
