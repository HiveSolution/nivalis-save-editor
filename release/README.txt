NIVALIS SAVE EDITOR  v{{VERSION}}  by RenokK
Unofficial savegame editor for Nivalis Nights. Not affiliated with ION LANDS.
Source code: https://github.com/HiveSolution/nivalis-save-editor

WHAT IT DOES
  - Lists your saves with their screenshots, location, in-game day and playtime
  - Edit your money
  - Set the level of your skills (Barter, Boat, Cooking, Farming, Fishing,
    Serving, Managing)
  - Edit inventories: your own, your venues' storage, fridges and furniture,
    and vendor stock. Add any of 1,300+ items, change quantities and
    freshness, or make all food fresh again
  - Edit relationships (friend, romance, business, enemy) and your venues'
    level and reviews, plus your debt
  - Browse, search and edit the game's story variables (relationship values,
    venue levels, quest flags and more)
  - Compare two saves to see what changed between them, and copy values over
  - Keeps up to 10 backups of every save, with a comparison of what changed
    and one-click restore

HOW TO USE
  1. Run {{BINARY}}. No installation needed.
  2. Pick a save on the left, make your changes, then click "Save changes".
  3. Load that save in the game.

The game can stay open while you edit a manual save: save in the game, edit
that save, then load it again. Don't save over it in the game before you
load it. The autosave can only be changed once the game is closed, because
the game keeps overwriting it.

Your saves are found automatically in:
  {{SAVES_DIR}}

BACKUPS
Before every change the editor backs up the save. Open the "Backups" tab to
see up to 10 backups per save, compare any of them with the current save, and
restore one with a click. The oldest backup (the save before you first edited
it) is kept permanently. "Back up now" makes an extra backup at any time.
Restoring also backs up the current save first, so it can be undone.

Backups are stored compressed in
  {{BACKUP_DIR}}
outside the save folder, so they are not uploaded to Steam Cloud. Backups
made by older versions of the editor are moved there automatically.

GOOD TO KNOW
  - Story variables control quests and dialogue. Changing them can skip or
    break quest steps. Try changes on a copy of a save first if unsure.
  - The in-game clock cannot be edited (it is stored in hundreds of places).
  - Text variables are shown but cannot be edited yet.
  - A skill can be edited once you have gained some XP in it in the game.
    Setting a level puts its XP at the start of that level.
  - Added items are free and start fully fresh. Items that need a fridge are
    marked, and you get a warning when adding them to normal storage.
  - Steam Cloud syncs your saves, so an edited save replaces the cloud copy.
  - Tested with save format versions 151 and 153 (the game patch of 1 October
    2026). After a later game update the editor still opens your saves but
    warns you that the version is untested; look for an editor update then.
    If an update changes the format so much that the editor can't read a
    save, it refuses to open it instead of damaging it.

REQUIREMENTS
{{REQUIREMENTS}}

{{PLATFORM_NOTE}}

LICENSE
Copyright (c) 2026 RenokK. Licensed under Creative Commons
Attribution-NonCommercial 4.0 (CC BY-NC 4.0), see LICENSE.txt.
You may share and modify this tool for noncommercial purposes if you credit
RenokK. Commercial use, including selling it or including it in commercial
products, is not permitted.
