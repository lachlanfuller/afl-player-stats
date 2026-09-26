// Player search. Plain functions with no browser or Astro dependencies, so they can be unit tested.
//
// A query matches a player when every word typed is the start of a different word in the name,
// in any order ("ablett gary" finds Gary Ablett). Punctuation and accents are ignored, so
// "obrien" finds O'Brien. Results are ordered by how closely the name matches, then by career
// length, so the best-known player with a shared name comes first.

/** Lower-case, strip accents, and turn everything that is not a letter or digit into a single space. */
export function normalise(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Prepare the players from players-index.json once, so each keystroke only compares strings. */
export function prepare(players) {
  return players.map((player) => {
    const key = normalise(player.name);
    return { player, key, tokens: key.split(" "), compact: key.replaceAll(" ", "") };
  });
}

const EXACT = 4;
const STARTS_WITH = 3;
const EVERY_WORD = 2;
const CONTAINS = 1;
const MIN_CONTAINS_LENGTH = 3;

/** True if each query word is the start of a different word in the name. */
function everyWordMatches(nameTokens, queryTokens) {
  const free = [...nameTokens];
  // Longest words first: they are the most constrained, so they claim their name word first.
  for (const word of [...queryTokens].sort((a, b) => b.length - a.length)) {
    const at = free.findIndex((token) => token.startsWith(word));
    if (at === -1) return false;
    free.splice(at, 1);
  }
  return true;
}

function score(entry, query) {
  if (entry.key === query.key) return EXACT;
  if (entry.key.startsWith(query.key)) return STARTS_WITH;
  if (everyWordMatches(entry.tokens, query.tokens)) return EVERY_WORD;
  if (query.compact.length >= MIN_CONTAINS_LENGTH && entry.compact.includes(query.compact)) return CONTAINS;
  return 0;
}

/**
 * @param entries   the output of prepare()
 * @param rawQuery  what the person typed
 * @param limit     the most results to return
 * @returns {{ results: object[], total: number }} the best `limit` players, and how many matched in all
 */
export function search(entries, rawQuery, limit = 12) {
  const key = normalise(rawQuery);
  if (!key) return { results: [], total: 0 };
  const query = { key, tokens: key.split(" "), compact: key.replaceAll(" ", "") };

  const matches = [];
  for (const entry of entries) {
    const s = score(entry, query);
    if (s > 0) matches.push({ entry, s });
  }

  matches.sort(
    (a, b) =>
      b.s - a.s ||
      b.entry.player.games - a.entry.player.games ||
      a.entry.player.name.localeCompare(b.entry.player.name) ||
      a.entry.player.id - b.entry.player.id,
  );

  return { results: matches.slice(0, limit).map((m) => m.entry.player), total: matches.length };
}
