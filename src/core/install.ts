// Installing the game as an app (so it opens full-screen, without the browser's bars).
//
//  - Android / desktop Chrome and Edge fire `beforeinstallprompt`: keep the event and show our own button
//  - iOS Safari has no such event: the player has to use Share → "ホーム画面に追加"
//  - once the game runs as an installed app, there is nothing to offer

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallEvent | null = null;
let installed = false;
const waiting = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    for (const f of waiting) f();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    for (const f of waiting) f();
  });
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => void navigator.serviceWorker.register('sw.js').catch(() => undefined));
  }
}

/** Already running as an installed app (no browser bars)? */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return true;
  const nav = navigator as Navigator & { standalone?: boolean };
  return installed || nav.standalone === true
    || ['fullscreen', 'standalone', 'minimal-ui'].some((m) => window.matchMedia(`(display-mode: ${m})`).matches);
}

export type InstallWay =
  /** the browser can show its install dialog when our button is pressed */
  | 'prompt'
  /** iPhone / iPad: explain Share → Add to Home Screen */
  | 'ios'
  /** a phone browser that gave us no install event (yet): explain the browser menu */
  | 'menu'
  /** nothing to offer (already installed, or a desktop browser without the feature) */
  | 'none';

export function installWay(): InstallWay {
  if (isStandalone()) return 'none';
  if (deferred) return 'prompt';
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return 'ios';
  if (/Android/.test(ua)) return 'menu';
  return 'none';
}

/** Shows the browser's install dialog. Resolves true when the player accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  try {
    await e.prompt();
    const choice = await e.userChoice;
    if (choice.outcome === 'accepted') installed = true;
    return choice.outcome === 'accepted';
  } catch {
    return false;
  }
}

/** Calls back whenever the install situation changes (the event arrived, or the app got installed). */
export function onInstallChange(f: () => void): () => void {
  waiting.add(f);
  return () => waiting.delete(f);
}

/** Asks the browser for real full-screen and a sideways screen (works on Android and desktop; iPhones refuse). */
export async function goFullscreen(): Promise<boolean> {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o.lock?.('landscape').catch(() => undefined);
    return !!document.fullscreenElement;
  } catch {
    return false;
  }
}

export const canFullscreen = (): boolean => typeof document !== 'undefined' && !!document.documentElement.requestFullscreen && !isStandalone();
