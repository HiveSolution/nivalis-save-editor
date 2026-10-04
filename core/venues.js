// Venue runtime state (VenueAreaGhost): one Ghost block per venue in the world. The game keeps a
// venue's level, customers served and reviews here and copies them into the story variables
// (Venue_<name>.Level, .CustomersServed, .ReviewScore, .ReviewAmount) when a save loads, so
// editing only the variables has no effect in the game.
//
//   block     string tag, int32 end offset, int32, string ghostGuid, 3 bytes, string ghostGuid,
//             int32, byte, 7 floats (position, rotation), byte, float,
//             int32 n + n GUID strings (placed furniture), int32 n + n GUID strings (trash),
//             int32 initial trash count, int32 currentLevel, int32 mealsServed, int32 totalVisits, ...
//   reviews   somewhere later in the block: int32 count, then the reviews (RuntimeReviewsList)
//   review    string venueGuid, int32 score (stars), string mainItem, 5 floats, int32 time,
//             string personGuid, int32 n + n delivered meals (string item, int32 price, 2 floats,
//             string mealGhost), byte, string override text, byte, int32, int32,
//             int32 n + n (string, int32)
//
// "Customers served" in the game is mealsServed; the review score shown is an average over the
// review records (weighted by age), and the review count is the number of records.

import { readInt32, readString, encodeString, indexOf } from './binary.js';
import { SaveFormatError } from './errors.js';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Highest venue level seen in real saves; the game's levelling tables are not read.
export const VENUE_MAX_LEVEL = 5;
export const REVIEW_MAX_SCORE = 5;

// Reads the fixed part of a Ghost block up to the venue stats; null when the block is not shaped like a venue.
function readVenueHeader(bytes, block) {
  try {
    let pos = readString(bytes, block.start).end + 8;
    const id = readString(bytes, pos);
    const again = readString(bytes, id.end + 3);
    if (!GUID_RE.test(id.value) || again.value !== id.value || block.tag !== `Ghost_${id.value}`) return null;
    pos = again.end + 4 + 1 + 28 + 1 + 4;
    for (let list = 0; list < 2; list++) {
      const n = readInt32(bytes, pos);
      pos += 4;
      if (n < 0 || n > 10000) return null;
      for (let i = 0; i < n; i++) {
        const s = readString(bytes, pos);
        if (!GUID_RE.test(s.value)) return null;
        pos = s.end;
      }
    }
    const levelOffset = pos + 4;
    if (levelOffset + 12 > block.end) return null;
    const level = readInt32(bytes, levelOffset);
    const mealsServed = readInt32(bytes, levelOffset + 4);
    const visits = readInt32(bytes, levelOffset + 8);
    if (level < 0 || level > 100 || mealsServed < 0 || visits < 0) return null;
    return { levelOffset, level, mealsOffset: levelOffset + 4, mealsServed, visits };
  } catch {
    return null;
  }
}

// Parses `count` review records of this venue starting at `pos`; throws when they don't fit the grammar.
function readReviews(bytes, countOffset, venueId, limit) {
  const count = readInt32(bytes, countOffset);
  let pos = countOffset + 4;
  const reviews = [];
  const checkCount = (n) => { if (n < 0 || n > 1000) throw new SaveFormatError('Implausible list length in review'); };
  for (let r = 0; r < count; r++) {
    const venue = readString(bytes, pos);
    if (venue.value !== venueId) throw new SaveFormatError('Review of another venue');
    pos = venue.end;
    const scoreOffset = pos;
    const score = readInt32(bytes, pos);
    if (score < 0 || score > REVIEW_MAX_SCORE) throw new SaveFormatError(`Implausible review score ${score}`);
    pos = readString(bytes, pos + 4).end + 20 + 4;
    pos = readString(bytes, pos).end;
    const meals = readInt32(bytes, pos);
    pos += 4;
    checkCount(meals);
    for (let i = 0; i < meals; i++) pos = readString(bytes, readString(bytes, pos).end + 12).end;
    pos = readString(bytes, pos + 1).end + 1 + 8;
    const refs = readInt32(bytes, pos);
    pos += 4;
    checkCount(refs);
    for (let i = 0; i < refs; i++) pos = readString(bytes, pos).end + 4;
    if (pos > limit) throw new SaveFormatError('Review runs past its block');
    reviews.push({ scoreOffset, score });
  }
  return reviews;
}

// The review list is the first `int32 count, string venueGuid, ...` run after the stats that parses completely.
function findReviews(bytes, header, block, venueId, marker) {
  for (let at = indexOf(bytes, marker, header.levelOffset + 12); at !== -1 && at < block.end; at = indexOf(bytes, marker, at + 1)) {
    const count = readInt32(bytes, at - 4);
    if (count < 1 || count > 1000000) continue;
    try {
      return { countOffset: at - 4, reviews: readReviews(bytes, at - 4, venueId, block.end) };
    } catch {
      // Another reference to the venue (menu, orders); keep looking.
    }
  }
  return { countOffset: null, reviews: [] };
}

// Finds a venue's runtime state by its GUID (the id used for its inventories). Returns null when the save
// has no block for it, and throws when more than one block fits, since the edit target would be ambiguous.
export function findVenue(save, venueId) {
  const { bytes, ghostBlocks } = save;
  const marker = encodeString(venueId);
  const candidates = new Set();
  for (let at = indexOf(bytes, marker, 0); at !== -1; at = indexOf(bytes, marker, at + 1)) {
    let lo = 0;
    let hi = ghostBlocks.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ghostBlocks[mid].end <= at) lo = mid + 1;
      else if (ghostBlocks[mid].start > at) hi = mid - 1;
      else { candidates.add(ghostBlocks[mid]); break; }
    }
  }
  const matches = [];
  for (const block of candidates) {
    const header = readVenueHeader(bytes, block);
    if (header) matches.push({ block, header });
  }
  if (!matches.length) return null;
  if (matches.length > 1) throw new SaveFormatError(`Venue ${venueId} matches ${matches.length} world records`);
  const [{ block, header }] = matches;
  const { countOffset, reviews } = findReviews(bytes, header, block, venueId, marker);
  return { id: venueId, ghost: block.tag, ...header, reviewCountOffset: countOffset, reviews };
}

export function averageReviewScore(venue) {
  return venue.reviews.length ? venue.reviews.reduce((n, r) => n + r.score, 0) / venue.reviews.length : null;
}

// Validates { level?, mealsServed?, reviewScore? } for one venue and returns the int32 writes it needs.
export function venueWrites(venue, edit) {
  const writes = [];
  const { level, mealsServed, reviewScore } = edit;
  if (level !== undefined) {
    if (!Number.isInteger(level) || level < 1 || level > VENUE_MAX_LEVEL) throw new RangeError(`Venue level must be 1 to ${VENUE_MAX_LEVEL}`);
    writes.push([venue.levelOffset, level]);
  }
  if (mealsServed !== undefined) {
    if (!Number.isInteger(mealsServed) || mealsServed < 0 || mealsServed > 2147483647) throw new RangeError('Customers served must be a whole number of 0 or more');
    writes.push([venue.mealsOffset, mealsServed]);
  }
  if (reviewScore !== undefined) {
    if (!Number.isInteger(reviewScore) || reviewScore < 1 || reviewScore > REVIEW_MAX_SCORE) throw new RangeError(`Review stars must be 1 to ${REVIEW_MAX_SCORE}`);
    if (!venue.reviews.length) throw new RangeError('This venue has no reviews to change yet');
    for (const r of venue.reviews) writes.push([r.scoreOffset, reviewScore]);
  }
  return writes;
}
