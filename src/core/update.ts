// Keeping an installed copy up to date.
//
// A phone keeps an installed app alive in the background: opening it again brings back the page as it was, with the
// code it loaded days ago, so a new version never shows. Each time the game comes back on screen it asks the server
// which build is out (`version.json`, written by vite.config.ts) and, when that is not the one running, reloads by
// itself, straight back into the screen the save calls for (no title screen, no tap). The service worker (public/sw.js)
// goes to the network first, so the reload gets the new files.

declare const __BUILD__: string;

/** The build this page runs. */
export const BUILD: string = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

const RESUME = 'mcf-resume';
const TRIED = 'mcf-reloaded-for';

const session = {
  get: (k: string): string | null => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null): void => {
    try {
      if (v === null) sessionStorage.removeItem(k);
      else sessionStorage.setItem(k, v);
    } catch {
      /* private mode: no resume, the title screen it is */
    }
  },
};

/** The build the server has out now (null: offline, or no answer). */
async function latest(): Promise<string | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { build?: unknown };
    return typeof body.build === 'string' ? body.build : null;
  } catch {
    return null;
  }
}

let checking = false;

/** Asks for the build that is out, and moves to it when it is not this one. */
async function check(beforeReload: () => void): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const out = await latest();
    // (once per new build: if the reload brought the same old page back, the next visit tries again — never a loop)
    if (!out || out === BUILD || session.get(TRIED) === out || document.hidden) return;
    session.set(TRIED, out);
    beforeReload();
    session.set(RESUME, '1');
    // the service worker too, so the next start is the new one even offline
    await navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => undefined);
    location.reload();
  } finally {
    checking = false;
  }
}

/** Watches for a new version while the game is installed or left open (production only). */
export function watchUpdates(beforeReload: () => void): void {
  if (!import.meta.env.PROD || typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void check(beforeReload);
  });
  // a page brought back from the browser's back/forward memory
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) void check(beforeReload);
  });
}

/** Did this page start from an update's reload? (then it goes straight back to where the player was) */
export function resumedFromUpdate(): boolean {
  const r = session.get(RESUME) === '1';
  session.set(RESUME, null);
  return r;
}
