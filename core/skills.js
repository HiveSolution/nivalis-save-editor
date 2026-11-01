// Skill section (SkillLevelsControllerSave): one entry per skill the player has gained XP in so far.
//
//   section  string key SKILLS_KEY, int32 entryCount, entries...
//   entry    string skillGuid (skill definition id), float32 xp, int32 level
//
// XP is cumulative. A skill definition lists the XP each level costs ("steps", index = level), so
// level N is reached at steps[1] + ... + steps[N]. The game recalculates the level from the XP when a
// save loads, so a level stored under an older curve (the Farming rebalance of save version 181) or
// one that doesn't match the XP is ignored; levelForXp gives the level the game will show. The game
// has been seen to store NaN as XP for a skill at its top level; such entries are kept as they are
// unless edited.

import { readInt32, readFloat32, readString, encodeString, indexOf } from './binary.js';
import { SaveFormatError } from './errors.js';

export const SKILLS_KEY = '2F00F72D-896A-42F8-92C4-E775FB79970E';
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseSkills(bytes) {
  const marker = encodeString(SKILLS_KEY);
  const at = indexOf(bytes, marker, 0);
  if (at < 0) throw new SaveFormatError('Skill section not found');
  let pos = at + marker.length;
  const count = readInt32(bytes, pos);
  pos += 4;
  if (count < 0 || count > 1000) throw new SaveFormatError(`Implausible skill count ${count}`);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const guid = readString(bytes, pos);
    if (!GUID_RE.test(guid.value)) throw new SaveFormatError(`Bad skill id at 0x${pos.toString(16)}`);
    const level = readInt32(bytes, guid.end + 4);
    if (level < 0 || level > 1000) throw new SaveFormatError(`Implausible level ${level} for skill ${guid.value}`);
    entries.push({ guid: guid.value, xp: readFloat32(bytes, guid.end), level, xpOffset: guid.end, levelOffset: guid.end + 4 });
    pos = guid.end + 8;
  }
  // The next manager section key must follow immediately; otherwise the grammar is wrong for this save.
  if (bytes[pos] !== 0x24 || !/^[0-9A-F-]{36}$/.test(readString(bytes, pos).value)) {
    throw new SaveFormatError('Skill section did not end at a section boundary');
  }
  return { start: at, end: pos, entries };
}

// Cumulative XP at which a level starts; steps[level] is the XP that level costs.
export function xpForLevel(steps, level) {
  let xp = 0;
  for (let i = 1; i <= level && i < steps.length; i++) xp += steps[i];
  return xp;
}

// The level a cumulative XP value corresponds to (NaN counts as the top level, as in the game).
export function levelForXp(steps, xp) {
  if (Number.isNaN(xp)) return steps.length - 1;
  let level = 0;
  while (level + 1 < steps.length && xp >= xpForLevel(steps, level + 1)) level++;
  return level;
}
