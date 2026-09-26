// Finds every player who has played at least one game for two chosen clubs. Plain functions with
// no browser or Astro dependencies, so they can be unit tested. See players-index.json's `clubs`:
// a franchise id -> games count for that player.

/**
 * @param players       the output of players-index.json
 * @param franchiseIdA  a franchise id from franchises.json, or "" for none chosen yet
 * @param franchiseIdB  a franchise id from franchises.json, or "" for none chosen yet
 * @returns players with games for both clubs, each with `gamesA`/`gamesB` added, ordered by their
 *          combined games for the two clubs (most first), then name.
 */
export function playersForBothClubs(players, franchiseIdA, franchiseIdB) {
  if (!franchiseIdA || !franchiseIdB || franchiseIdA === franchiseIdB) return [];

  const matches = [];
  for (const player of players) {
    const gamesA = player.clubs[franchiseIdA];
    const gamesB = player.clubs[franchiseIdB];
    if (gamesA && gamesB) matches.push({ ...player, gamesA, gamesB });
  }

  matches.sort(
    (a, b) => b.gamesA + b.gamesB - (a.gamesA + a.gamesB) || a.name.localeCompare(b.name) || a.id - b.id,
  );
  return matches;
}
