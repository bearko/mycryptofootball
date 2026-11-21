import { START, createMatch, deal, type MatchState, type TeamSheet } from '../src/game/match';

/** A match whose opening kickoff has been run back already: the team that received it has the ball at its own START. */
export function opened(home: TeamSheet, away: TeamSheet, seed: number): MatchState {
  const st = createMatch(home, away, seed);
  st.ko = false;
  st.poss = st.first;
  st.pos = START;
  deal(st);
  return st;
}
