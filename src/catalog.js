// Human-readable names for item, venue and vendor ids, from src/data/items.json
// (generated from the game files by scripts/build-item-catalog.mjs).
import data from './data/items.json';

export const CATALOG_DATE = data.generated;

// "Kitchen_Fridge01" -> "Kitchen Fridge 01", "GreenhouseSkyhighGardens2G" -> "Greenhouse Skyhigh Gardens 2G"
export function prettify(name) {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

const titleCase = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

export function itemInfo(guid) {
  return data.items[guid] ?? null;
}

export function itemName(guid) {
  const e = data.items[guid];
  return e ? prettify(e.name) : `Unknown item (${guid.slice(0, 8)})`;
}

// Sorted list for the "add item" picker; labels are unique so they can be mapped back to ids.
export const ITEM_CHOICES = (() => {
  const list = Object.entries(data.items).map(([guid, e]) => ({ guid, name: prettify(e.name), kind: e.kind }));
  const counts = new Map();
  for (const it of list) counts.set(it.name, (counts.get(it.name) ?? 0) + 1);
  for (const it of list) {
    const suffix = it.kind === 'dish' ? ' (dish)' : '';
    it.label = counts.get(it.name) > 1 ? `${it.name}${suffix} · ${it.guid.slice(0, 8)}` : `${it.name}${suffix}`;
  }
  return list.sort((a, b) => a.label.localeCompare(b.label));
})();

export function venueInfo(id) {
  return data.venues[id] ?? null;
}

const VENUE_ID_BY_INTERNAL = new Map(Object.entries(data.venues).map(([id, v]) => [v.internal, id]));

// "Venue_NoodleBar" (the story variable group) -> venue id
export function venueIdByInternal(internal) {
  return VENUE_ID_BY_INTERNAL.get(internal) ?? null;
}

export function venueName(id) {
  const v = data.venues[id];
  if (!v) return `Venue ${id.slice(0, 8)}`;
  const place = prettify(v.internal.replace(/^Venue_/, ''));
  return v.key ? `${titleCase(v.key.replace(/^VENUE_/, '').replace(/_/g, ' '))} (${place})` : place;
}

// { name, steps }: steps[level] is the XP that level costs (see core/skills.js).
export function skillInfo(guid) {
  return data.skills[guid] ?? null;
}

export function skillName(guid) {
  const s = data.skills[guid];
  return s ? prettify(s.name.replace(/^Player_/, '')) : `Unknown skill (${guid.slice(0, 8)})`;
}

export function vendorName(id) {
  const n = data.vendors[id];
  return n ? prettify(n) : null;
}
