// Screen switching. A screen is just an element; `show` swaps it in.

import { closeModal } from './parts';

let leave: (() => void) | null = null;
let router: () => void = () => undefined;

/** Shows a screen. `onLeave` runs when the next screen replaces it. */
export function show(el: HTMLElement, onLeave?: () => void): void {
  leave?.();
  leave = onLeave ?? null;
  closeModal();
  const app = document.getElementById('app')!;
  app.replaceChildren(el);
}

/** Goes to whatever screen the saved game calls for. */
export const route = (): void => router();
export function setRouter(f: () => void): void {
  router = f;
}
