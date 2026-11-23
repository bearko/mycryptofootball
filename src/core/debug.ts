// Debug switches read from the URL (never linked from anywhere in the game):
//   ?trust=80   every member's trust becomes 80 when the club room opens
//   ?day=13     jump to that day of the calendar (0 = the first practice day; 6, 13, 20, 27 are the matches)
//   ?bot=1      the computer also calls the club's plays, and plays are shown very fast
//   ?seed=123   fixed seed for new seasons and matches
//   ?tier=4     with ?go=: the club has that standing (0 beginners … 6), and as many heroes as it allows;
//               ?go=recruit&tier=2 opens the briefing of a later year
//   ?tactic=air&tlv=5  with ?go= and an eleven-a-side ?tier=: the club's colour, at that level (1 to 5)
//   ?ob=200     with ?go=: the club has that many OB points (and as many medals) for the alumni's room
//   ?event=gift with ?go=club: that club event waits on the ground (season.ts EVENTS' keys)
//   ?lang=en    play in English this time (the language preference is not changed)
//   ?go=club    open a screen directly with a ready-made season (recruit, club, training, lineup, match, end, champion);
//               combines with ?day= and ?trust=. Nothing is written to the real save until the game itself saves

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const num = (key: string): number | null => (params.has(key) && params.get(key) !== '' ? Number(params.get(key)) : null);

export const debug = {
  trust: num('trust'),
  day: num('day'),
  tier: num('tier'),
  bot: params.get('bot') === '1',
  seed: num('seed'),
  go: params.get('go'),
  tactic: params.get('tactic'),
  tlv: num('tlv'),
  ob: num('ob'),
  event: params.get('event'),
  lang: params.get('lang'),
};

/** A fresh seed, or the fixed one from the URL. */
export const newSeed = (): number => debug.seed ?? ((Date.now() ^ (Math.random() * 2 ** 31)) >>> 0);
