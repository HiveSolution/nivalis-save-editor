import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseSave, applyEdits, roundTripCheck, diffSaves, listVariables, summarize,
  UnsupportedEditError, SaveFormatError, formatCredits, currentGameDay, TESTED_VERSIONS, xpForLevel, levelForXp,
  findVenue, averageReviewScore, VENUE_MAX_LEVEL,
} from '../core/index.js';
import { encodeString, readString } from '../core/binary.js';

// Sample saves live next to the project (the folder this repo sits in) unless NN_SAVE_DIR says otherwise.
const saveDir = process.env.NN_SAVE_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const saveFiles = existsSync(saveDir) ? readdirSync(saveDir).filter((f) => f.endsWith('.sav')) : [];
const load = (f) => parseSave(new Uint8Array(readFileSync(join(saveDir, f))));

test('string encoding round-trips, including multi-byte length prefixes', () => {
  for (const s of ['', 'abc', 'x'.repeat(127), 'y'.repeat(128), 'z'.repeat(20000), 'Café ☕']) {
    const enc = encodeString(s);
    const dec = readString(enc, 0);
    assert.equal(dec.value, s);
    assert.equal(dec.end, enc.length);
  }
});

test('formatCredits', () => {
  assert.equal(formatCredits(155880), '1558.80');
  assert.equal(formatCredits(5), '0.05');
  assert.equal(formatCredits(0), '0.00');
});

test('rejects non-save input', () => {
  assert.throws(() => parseSave(new Uint8Array(100)), SaveFormatError);
});

test('sample saves are present', { skip: saveFiles.length === 0 && 'no sample saves found' }, () => {
  assert.ok(saveFiles.length > 0);
});

test('opens untested save versions, flags them and can still edit them', { skip: saveFiles.length === 0 && 'no sample saves found' }, () => {
  const bytes = new Uint8Array(readFileSync(join(saveDir, saveFiles[0])));
  for (const version of TESTED_VERSIONS) {
    bytes[0] = version;
    assert.equal(parseSave(bytes).header.versionTested, true);
  }
  for (const version of [150, 152, 154]) {
    bytes[0] = version;
    const save = parseSave(bytes);
    assert.equal(save.header.version, version);
    assert.equal(summarize(save).versionTested, false);
    assert.deepEqual(save.warnings, []);
    const edited = parseSave(applyEdits(save, { moneyCents: save.header.moneyCents + 1 }));
    assert.equal(edited.header.version, version);
    assert.equal(edited.playerMoney.value, save.header.moneyCents + 1);
  }
  bytes[0] = 0;
  assert.throws(() => parseSave(bytes), SaveFormatError);
});

test('a layout change is refused whatever the version says', { skip: saveFiles.length === 0 && 'no sample saves found' }, () => {
  const save = load(saveFiles[0]);
  // one extra byte in front of the inventory section, as a new field would add
  const at = save.inventory.start;
  const shifted = new Uint8Array(save.bytes.length + 1);
  shifted.set(save.bytes.subarray(0, at), 0);
  shifted.set(save.bytes.subarray(at), at + 1);
  shifted[0] = 154;
  assert.throws(() => parseSave(shifted), SaveFormatError);
});

for (const file of saveFiles) {
  test(`${file}: parses, is consistent and re-encodes losslessly`, () => {
    const save = load(file);
    assert.deepEqual(save.warnings, []);
    assert.ok(save.tablesConsistent);
    assert.equal(save.header.moneyCents, save.playerMoney.value);
    assert.ok(save.ghostBlocks.length > 1000);
    assert.deepEqual(roundTripCheck(save), []);
    const vars = listVariables(save);
    assert.ok(vars.length > 1000);
    assert.equal(summarize(save).variableCount, vars.length);
  });

  test(`${file}: money and variable edits verify and touch only intended bytes`, () => {
    const save = load(file);
    const vars = listVariables(save);
    const intVar = vars.find((v) => v.kind === 'int');
    const boolVar = vars.find((v) => v.kind === 'bool');
    const edited = applyEdits(save, {
      moneyCents: save.header.moneyCents + 1,
      variables: { [intVar.name]: intVar.value + 7, [boolVar.name]: !boolVar.value },
    });
    let changed = 0;
    for (let i = 0; i < edited.length; i++) if (edited[i] !== save.bytes[i]) changed++;
    assert.ok(changed >= 4 && changed <= 4 * 2 + 4 * 2 + 2, `changed ${changed} bytes`);

    const re = parseSave(edited);
    assert.equal(re.header.moneyCents, save.header.moneyCents + 1);
    assert.equal(re.playerMoney.value, save.header.moneyCents + 1);
    assert.ok(re.tablesConsistent);
    const d = diffSaves(save, re);
    assert.deepEqual(d.variables.map((v) => v.name).sort(), [intVar.name, boolVar.name].sort());
    // original buffer untouched
    assert.equal(load(file).header.moneyCents, save.header.moneyCents);
  });
}

for (const file of saveFiles) {
  test(`${file}: inventory edits add, change and remove items and keep the save consistent`, () => {
    const save = load(file);
    const player = save.inventory.containers.find((c) => c.kind === 'player');
    assert.ok(player, 'player inventory present');
    const vendorWithStock = save.inventory.containers.find((c) => c.kind === 'vendor' && c.items.length > 2);
    const newGuid = vendorWithStock.items[0].guid;
    const day = currentGameDay(save);

    // add a new item (grows the file), bump a quantity, and drop an item from a vendor (shrinks it)
    const playerItems = [
      ...player.items.map((it, i) => (i === 0 ? { ...it, stacks: it.stacks.map((s) => ({ ...s, quantity: s.quantity + 5 })) } : it)),
      { guid: newGuid, stacks: [{ price: 0, day, quantity: 3, freshness: 0 }] },
    ];
    const vendorItems = vendorWithStock.items.slice(1);
    const edited = applyEdits(save, {
      moneyCents: save.header.moneyCents + 100,
      inventory: { [player.key]: playerItems, [vendorWithStock.key]: vendorItems },
    });

    const re = parseSave(edited);
    assert.deepEqual(re.warnings, []);
    assert.deepEqual(roundTripCheck(re), []);
    assert.equal(re.ghostBlocks.length, save.ghostBlocks.length);
    assert.equal(re.header.moneyCents, save.header.moneyCents + 100);
    assert.equal(re.playerMoney.value, save.header.moneyCents + 100);
    const rePlayer = re.inventory.containers.find((c) => c.kind === 'player');
    assert.deepEqual(rePlayer.items, playerItems);
    assert.deepEqual(re.inventory.containers.find((c) => c.key === vendorWithStock.key).items, vendorItems);
    const d = diffSaves(save, re);
    assert.deepEqual(d.variables, []);
    assert.ok(d.inventory.some((c) => c.container === player.key && c.guid === newGuid && c.after >= 3));
    assert.ok(d.inventory.some((c) => c.container === vendorWithStock.key && c.guid === newGuid && c.after === 0));
    const expectedDelta = (37 + 4 + 16) - (37 + 4 + 16 * vendorWithStock.items[0].stacks.length);
    assert.equal(edited.length - save.bytes.length, expectedDelta);
  });
}

const { skills: SKILLS } = JSON.parse(readFileSync(new URL('../src/data/items.json', import.meta.url), 'utf8'));

test('skill level maths', () => {
  const boat = [0, 2000, 5000, 10000];
  assert.deepEqual([0, 1, 2, 3, 9].map((l) => xpForLevel(boat, l)), [0, 2000, 7000, 17000, 17000]);
  assert.deepEqual([0, 1999, 2000, 6999.5, 7000, 1e9, NaN].map((xp) => levelForXp(boat, xp)), [0, 0, 1, 1, 2, 3, 3]);
});

for (const file of saveFiles) {
  test(`${file}: skills match the catalog and can be edited`, () => {
    const save = load(file);
    assert.ok(save.skills.entries.length <= Object.keys(SKILLS).length);
    for (const e of save.skills.entries) {
      assert.ok(SKILLS[e.guid], `skill ${e.guid} is in the catalog`);
      assert.equal(e.level, levelForXp(SKILLS[e.guid].steps, e.xp), `${SKILLS[e.guid].name} level matches its XP`);
    }
    if (!save.skills.entries.length) return;
    const target = save.skills.entries[save.skills.entries.length - 1];
    const { steps } = SKILLS[target.guid];
    const level = target.level === steps.length - 1 ? 0 : steps.length - 1;
    const edited = applyEdits(save, { skills: { [target.guid]: { xp: xpForLevel(steps, level), level } } });
    assert.equal(edited.length, save.bytes.length);
    let changed = 0;
    for (let i = 0; i < edited.length; i++) if (edited[i] !== save.bytes[i]) changed++;
    assert.ok(changed >= 1 && changed <= 8, `changed ${changed} bytes`);
    const re = parseSave(edited);
    assert.deepEqual(roundTripCheck(re), []);
    const d = diffSaves(save, re);
    assert.deepEqual(d.variables, []);
    assert.deepEqual(d.inventory, []);
    assert.equal(d.skills.length, 1);
    assert.deepEqual(d.skills[0].after, { xp: xpForLevel(steps, level), level });
    // untouched skills keep their exact bytes, including a NaN XP
    for (const e of save.skills.entries.slice(0, -1)) {
      assert.ok(Object.is(re.skills.entries.find((x) => x.guid === e.guid).xp, e.xp));
    }
  });
}

const { venues: VENUES } = JSON.parse(readFileSync(new URL('../src/data/items.json', import.meta.url), 'utf8'));

for (const file of saveFiles) {
  test(`${file}: venue stats are found and can be edited`, () => {
    const save = load(file);
    const vars = new Map(listVariables(save).map((v) => [v.name, v.value]));
    const venues = Object.keys(VENUES).map((id) => findVenue(save, id)).filter(Boolean);
    assert.ok(venues.length > 10, `found ${venues.length} venues`);
    // The game copies the stats of venues the player owns into the story variables.
    for (const v of venues) {
      const group = VENUES[v.id].internal;
      if (vars.get(`${group}.Owned`) !== true) continue;
      assert.equal(v.level, vars.get(`${group}.Level`), `${group} level`);
      assert.equal(v.mealsServed, vars.get(`${group}.CustomersServed`), `${group} customers served`);
      assert.equal(v.reviews.length, vars.get(`${group}.ReviewAmount`), `${group} reviews`);
    }
    const target = venues.find((v) => v.reviews.length);
    const edit = { level: target.level === VENUE_MAX_LEVEL ? 1 : VENUE_MAX_LEVEL, mealsServed: target.mealsServed + 1000, reviewScore: 5 };
    const edited = applyEdits(save, { venues: { [target.id]: edit } });
    assert.equal(edited.length, save.bytes.length);
    let changed = 0;
    for (let i = 0; i < edited.length; i++) if (edited[i] !== save.bytes[i]) changed++;
    assert.ok(changed >= 2 && changed <= 8 + 4 * target.reviews.length, `changed ${changed} bytes`);
    const re = parseSave(edited);
    assert.deepEqual(roundTripCheck(re), []);
    const after = findVenue(re, target.id);
    assert.equal(after.level, edit.level);
    assert.equal(after.mealsServed, edit.mealsServed);
    assert.equal(averageReviewScore(after), 5);
    assert.deepEqual(diffSaves(save, re).variables, []);
  });
}

test('rejects invalid venue edits', { skip: saveFiles.length === 0 && 'no sample saves found' }, () => {
  const save = load(saveFiles[0]);
  const venues = Object.keys(VENUES).map((id) => findVenue(save, id)).filter(Boolean);
  const { id } = venues.find((v) => v.reviews.length);
  for (const bad of [{ level: 0 }, { level: VENUE_MAX_LEVEL + 1 }, { level: 2.5 }, { mealsServed: -1 }, { reviewScore: 0 }, { reviewScore: 6 }]) {
    assert.throws(() => applyEdits(save, { venues: { [id]: bad } }), UnsupportedEditError);
  }
  const unreviewed = venues.find((v) => !v.reviews.length);
  if (unreviewed) assert.throws(() => applyEdits(save, { venues: { [unreviewed.id]: { reviewScore: 5 } } }), UnsupportedEditError);
  assert.throws(() => applyEdits(save, { venues: { '00000000-0000-0000-0000-000000000000': { level: 1 } } }), UnsupportedEditError);
});

test('rejects invalid skill edits', { skip: saveFiles.length === 0 && 'no sample saves found' }, () => {
  const save = load(saveFiles.find((f) => load(f).skills.entries.length) ?? saveFiles[0]);
  const guid = save.skills.entries[0].guid;
  assert.throws(() => applyEdits(save, { skills: { 'c8e0d9c0-0000-0000-0000-000000000000': { xp: 0, level: 0 } } }), UnsupportedEditError);
  assert.throws(() => applyEdits(save, { skills: { [guid]: { xp: NaN, level: 1 } } }), UnsupportedEditError);
  assert.throws(() => applyEdits(save, { skills: { [guid]: { xp: -1, level: 1 } } }), UnsupportedEditError);
  assert.throws(() => applyEdits(save, { skills: { [guid]: { xp: 1e39, level: 1 } } }), UnsupportedEditError);
  assert.throws(() => applyEdits(save, { skills: { [guid]: { xp: 10, level: 1.5 } } }), UnsupportedEditError);
  assert.throws(() => applyEdits(save, { skills: { [guid]: { xp: 10 } } }), UnsupportedEditError);
});

test('rejects invalid inventory edits', { skip: saveFiles.length === 0 && 'no sample saves found' }, () => {
  const save = load(saveFiles[0]);
  const key = save.inventory.containers.find((c) => c.kind === 'player').key;
  const good = { price: 0, day: 1, quantity: 1, freshness: 0 };
  const guid = save.inventory.containers.find((c) => c.items.length).items[0].guid;
  assert.throws(() => applyEdits(save, { inventory: { nope: [] } }), UnsupportedEditError);
  assert.throws(() => applyEdits(save, { inventory: { [key]: [{ guid: 'not-a-guid', stacks: [good] }] } }), UnsupportedEditError);
  assert.throws(() => applyEdits(save, { inventory: { [key]: [{ guid, stacks: [] }] } }), UnsupportedEditError);
  assert.throws(() => applyEdits(save, { inventory: { [key]: [{ guid, stacks: [{ ...good, quantity: 0 }] }] } }), UnsupportedEditError);
  assert.throws(() => applyEdits(save, { inventory: { [key]: [{ guid, stacks: [{ ...good, quantity: 1.5 }] }] } }), UnsupportedEditError);
});

test('rejects unsupported edits',{ skip: saveFiles.length === 0 && 'no sample saves found' }, () => {
  const save = load(saveFiles[0]);
  const strVar = listVariables(save).find((v) => v.kind === 'string');
  assert.throws(() => applyEdits(save, { variables: { [strVar.name]: 'x' } }), UnsupportedEditError);
  assert.throws(() => applyEdits(save, { moneyCents: -1 }), UnsupportedEditError);
  assert.throws(() => applyEdits(save, { moneyCents: 1.5 }), UnsupportedEditError);
  assert.throws(() => applyEdits(save, { variables: { 'Nope.Nope': 1 } }), UnsupportedEditError);
  const boolVar = listVariables(save).find((v) => v.kind === 'bool');
  assert.throws(() => applyEdits(save, { variables: { [boolVar.name]: 1 } }), UnsupportedEditError);
});
