// Debug switches read from the URL (never linked from anywhere in the game):
//   ?trust=80   every member's trust becomes 80 when the club room opens
//   ?week=5     jump to that week of the calendar (0 = first practice week)
//   ?bot=1      the computer also calls the club's plays, and plays are shown very fast
//   ?seed=123   fixed seed for new seasons and matches

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const num = (key: string): number | null => (params.has(key) && params.get(key) !== '' ? Number(params.get(key)) : null);

export const debug = {
  trust: num('trust'),
  week: num('week'),
  bot: params.get('bot') === '1',
  seed: num('seed'),
};

/** A fresh seed, or the fixed one from the URL. */
export const newSeed = (): number => debug.seed ?? ((Date.now() ^ (Math.random() * 2 ** 31)) >>> 0);
