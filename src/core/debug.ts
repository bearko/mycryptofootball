// Debug switches read from the URL (never linked from anywhere in the game):
//   ?trust=80   every member's trust becomes 80 when the club room opens
//   ?day=13     jump to that day of the calendar (0 = the first practice day; 6, 13, 20, 27 are the matches)
//   ?bot=1      the computer also calls the club's plays, and plays are shown very fast
//   ?seed=123   fixed seed for new seasons and matches
//   ?go=club    open a screen directly with a ready-made season (recruit, club, training, lineup, match, end, champion);
//               combines with ?day= and ?trust=. Nothing is written to the real save until the game itself saves

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const num = (key: string): number | null => (params.has(key) && params.get(key) !== '' ? Number(params.get(key)) : null);

export const debug = {
  trust: num('trust'),
  day: num('day'),
  bot: params.get('bot') === '1',
  seed: num('seed'),
  go: params.get('go'),
};

/** A fresh seed, or the fixed one from the URL. */
export const newSeed = (): number => debug.seed ?? ((Date.now() ^ (Math.random() * 2 ** 31)) >>> 0);
