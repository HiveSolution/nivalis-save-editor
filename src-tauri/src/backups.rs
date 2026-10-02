// Backup store: gzip-compressed copies of saves, kept outside the Steam Cloud-synced save folder.
//
//   <app data dir>/Nivalis Save Editor/Backups/<folder key>/<save name>/   (Windows)
//   <app data dir>/nivalis-save-editor/backups/<folder key>/<save name>/  (Linux)
//       manifest.json     list of backups (newest last)
//       <id>.sav.gz       the save
//       <id>.png          its screenshot, if there was one
//
// Up to MAX_BACKUPS are kept per save. The oldest backup ("original", taken before the editor first
// changed that save) is never pruned; the rest roll over, oldest first.

use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub const MAX_BACKUPS: usize = 10;
const LEGACY_DIR: &str = "SaveEditorBackups";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub id: u64,
    pub created_ms: u64,
    pub kind: String,
    pub note: String,
    pub original: bool,
    pub size: u64,
    pub has_screenshot: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct Manifest {
    backups: Vec<Backup>,
}

pub fn store_root() -> Result<PathBuf, String> {
    if cfg!(windows) {
        let base = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is not set")?;
        Ok(PathBuf::from(base).join("Nivalis Save Editor").join("Backups"))
    } else {
        if let Some(xdg) = std::env::var_os("XDG_DATA_HOME").filter(|d| !d.is_empty()) {
            return Ok(PathBuf::from(xdg).join("nivalis-save-editor").join("backups"));
        }
        let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
        Ok(PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("nivalis-save-editor")
            .join("backups"))
    }
}

// Stable short key per save folder, so saves with the same name in different folders stay apart.
fn folder_key(dir: &Path) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in dir.to_string_lossy().to_lowercase().bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn save_store(save: &Path) -> Result<PathBuf, String> {
    let dir = save.parent().ok_or("Save has no parent folder")?;
    let name = save.file_stem().ok_or("Save has no file name")?;
    Ok(store_root()?.join(folder_key(dir)).join(name))
}

fn load_manifest(store: &Path) -> Manifest {
    fs::read(store.join("manifest.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, data).map_err(|e| format!("Cannot write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Cannot replace {}: {e}", path.display())
    })
}

fn write_manifest(store: &Path, manifest: &Manifest) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(manifest).map_err(|e| e.to_string())?;
    write_atomic(&store.join("manifest.json"), &json)
}

/// Splits backups into (kept, dropped): all originals plus the newest others, MAX_BACKUPS in total.
/// If no backup is marked original yet, the oldest one becomes the original.
pub fn prune(mut backups: Vec<Backup>) -> (Vec<Backup>, Vec<Backup>) {
    backups.sort_by_key(|b| (b.created_ms, b.id));
    if !backups.iter().any(|b| b.original) {
        if let Some(first) = backups.first_mut() {
            first.original = true;
        }
    }
    let originals = backups.iter().filter(|b| b.original).count();
    let room = MAX_BACKUPS.saturating_sub(originals);
    let regular = backups.iter().filter(|b| !b.original).count();
    let mut to_drop = regular.saturating_sub(room);
    let (mut kept, mut dropped) = (Vec::new(), Vec::new());
    for b in backups {
        if !b.original && to_drop > 0 {
            to_drop -= 1;
            dropped.push(b);
        } else {
            kept.push(b);
        }
    }
    (kept, dropped)
}

fn remove_files(store: &Path, id: u64) {
    let _ = fs::remove_file(store.join(format!("{id}.sav.gz")));
    let _ = fs::remove_file(store.join(format!("{id}.png")));
}

pub fn add(save: &Path, data: &[u8], screenshot: Option<&Path>, created_ms: u64, kind: &str, note: &str) -> Result<Backup, String> {
    let store = save_store(save)?;
    fs::create_dir_all(&store).map_err(|e| format!("Cannot create backup folder: {e}"))?;
    let mut manifest = load_manifest(&store);
    let mut id = created_ms;
    while manifest.backups.iter().any(|b| b.id == id) {
        id += 1;
    }

    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(data).map_err(|e| e.to_string())?;
    let compressed = encoder.finish().map_err(|e| e.to_string())?;
    write_atomic(&store.join(format!("{id}.sav.gz")), &compressed)?;
    let has_screenshot = screenshot
        .filter(|p| p.is_file())
        .map_or(false, |p| fs::copy(p, store.join(format!("{id}.png"))).is_ok());

    manifest.backups.push(Backup {
        id,
        created_ms,
        kind: kind.into(),
        note: note.into(),
        original: false,
        size: data.len() as u64,
        has_screenshot,
    });
    let (kept, dropped) = prune(std::mem::take(&mut manifest.backups));
    for d in &dropped {
        remove_files(&store, d.id);
    }
    manifest.backups = kept;
    write_manifest(&store, &manifest)?;
    manifest
        .backups
        .iter()
        .find(|b| b.id == id)
        .cloned()
        .ok_or_else(|| "Backup was pruned immediately".into())
}

pub fn list(save: &Path) -> Result<Vec<Backup>, String> {
    let mut backups = load_manifest(&save_store(save)?).backups;
    backups.sort_by(|a, b| b.created_ms.cmp(&a.created_ms));
    Ok(backups)
}

fn find(save: &Path, id: u64) -> Result<(PathBuf, Backup), String> {
    let store = save_store(save)?;
    let backup = load_manifest(&store)
        .backups
        .into_iter()
        .find(|b| b.id == id)
        .ok_or("Backup not found")?;
    Ok((store, backup))
}

pub fn read(save: &Path, id: u64) -> Result<Vec<u8>, String> {
    let (store, _) = find(save, id)?;
    let compressed = fs::read(store.join(format!("{id}.sav.gz"))).map_err(|e| format!("Cannot read backup: {e}"))?;
    let mut data = Vec::new();
    GzDecoder::new(&compressed[..])
        .read_to_end(&mut data)
        .map_err(|e| format!("Backup is damaged: {e}"))?;
    Ok(data)
}

pub fn read_screenshot(save: &Path, id: u64) -> Result<Vec<u8>, String> {
    let (store, backup) = find(save, id)?;
    if !backup.has_screenshot {
        return Err("This backup has no screenshot".into());
    }
    fs::read(store.join(format!("{id}.png"))).map_err(|e| format!("Cannot read screenshot: {e}"))
}

pub fn delete(save: &Path, id: u64) -> Result<(), String> {
    let (store, backup) = find(save, id)?;
    if backup.original {
        return Err("The original backup is kept permanently".into());
    }
    let mut manifest = load_manifest(&store);
    manifest.backups.retain(|b| b.id != id);
    write_manifest(&store, &manifest)?;
    remove_files(&store, id);
    Ok(())
}

/// Backs up the save as it is on disk right now (with its screenshot).
pub fn backup_current(save: &Path, created_ms: u64, kind: &str, note: &str) -> Result<Backup, String> {
    let data = fs::read(save).map_err(|e| format!("Cannot read {}: {e}", save.display()))?;
    add(save, &data, Some(&save.with_extension("png")), created_ms, kind, note)
        .map_err(|e| format!("Backup failed, nothing was written: {e}"))
}

/// Backs up the current save, then replaces it atomically with `data`.
pub fn write_with_backup(save: &Path, data: &[u8], created_ms: u64, note: &str) -> Result<Backup, String> {
    let backup = backup_current(save, created_ms, "edit", note)?;
    write_atomic(save, data)?;
    Ok(backup)
}

/// Restores backup `id` over the save (and its screenshot). The current save is backed up first,
/// so the restore itself can be undone. Returns that safety backup.
pub fn restore(save: &Path, id: u64, created_ms: u64, note: &str) -> Result<Backup, String> {
    // Read the backup before adding the safety copy, which may prune old backups.
    let data = read(save, id)?;
    let screenshot = read_screenshot(save, id).ok();
    let safety = backup_current(save, created_ms, "before-restore", note)?;
    write_atomic(save, &data)?;
    if let Some(png) = screenshot {
        let _ = fs::write(save.with_extension("png"), png);
    }
    Ok(safety)
}

/// Moves `<save dir>\SaveEditorBackups\<name>.<unix secs>.sav.bak` files (editor v1.0/1.1) into the store.
pub fn migrate_legacy(save_dir: &Path) -> Result<usize, String> {
    let legacy = save_dir.join(LEGACY_DIR);
    let Ok(entries) = fs::read_dir(&legacy) else { return Ok(0) };
    let mut files: Vec<(PathBuf, String, u64)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
        let Some(base) = file_name.strip_suffix(".sav.bak") else { continue };
        let Some((stem, secs)) = base.rsplit_once('.') else { continue };
        let Ok(secs) = secs.parse::<u64>() else { continue };
        files.push((path, stem.to_string(), secs));
    }
    files.sort_by_key(|(_, _, secs)| *secs);
    for (path, stem, secs) in &files {
        let data = fs::read(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
        add(&save_dir.join(format!("{stem}.sav")), &data, None, secs * 1000, "imported", "Backup from an earlier version of the editor")?;
        fs::remove_file(path).map_err(|e| format!("Cannot remove {}: {e}", path.display()))?;
    }
    let _ = fs::remove_dir(&legacy); // only succeeds when empty
    Ok(files.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b(id: u64, original: bool) -> Backup {
        Backup { id, created_ms: id, kind: "edit".into(), note: String::new(), original, size: 0, has_screenshot: false }
    }

    #[test]
    fn first_backup_becomes_original() {
        let (kept, dropped) = prune(vec![b(2, false), b(1, false)]);
        assert!(dropped.is_empty());
        assert!(kept.iter().find(|x| x.id == 1).unwrap().original);
        assert!(!kept.iter().find(|x| x.id == 2).unwrap().original);
    }

    #[test]
    fn keeps_original_and_newest() {
        let mut all = vec![b(1, true)];
        all.extend((2..=15).map(|i| b(i, false)));
        let (kept, dropped) = prune(all);
        assert_eq!(kept.len(), MAX_BACKUPS);
        assert!(kept.iter().any(|x| x.id == 1 && x.original));
        assert_eq!(kept.iter().filter(|x| !x.original).map(|x| x.id).collect::<Vec<_>>(), (7..=15).collect::<Vec<_>>());
        assert_eq!(dropped.iter().map(|x| x.id).collect::<Vec<_>>(), (2..=6).collect::<Vec<_>>());
    }

    // End-to-end against a temporary LOCALAPPDATA and save folder (the only test touching the env).
    #[test]
    fn store_migration_roundtrip_and_retention() {
        let base = std::env::temp_dir().join(format!("nse-backup-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let saves = base.join("saves");
        fs::create_dir_all(saves.join(LEGACY_DIR)).unwrap();
        let appdata = base.join("appdata");
        std::env::set_var("LOCALAPPDATA", &appdata);
        std::env::set_var("XDG_DATA_HOME", &appdata);

        fs::write(saves.join(LEGACY_DIR).join("AUTOSAVE.1000.sav.bak"), b"legacy").unwrap();
        let save = saves.join("AUTOSAVE.sav");
        fs::write(&save, b"current").unwrap();
        fs::write(save.with_extension("png"), b"png").unwrap();

        assert_eq!(migrate_legacy(&saves).unwrap(), 1);
        assert!(!saves.join(LEGACY_DIR).exists());
        let listed = list(&save).unwrap();
        assert_eq!(listed.len(), 1);
        assert!(listed[0].original);
        assert_eq!(listed[0].kind, "imported");
        assert_eq!(read(&save, listed[0].id).unwrap(), b"legacy");

        for i in 0..15u64 {
            add(&save, format!("v{i}").as_bytes(), Some(&save.with_extension("png")), 2_000_000 + i, "edit", "note").unwrap();
        }
        let listed = list(&save).unwrap();
        assert_eq!(listed.len(), MAX_BACKUPS);
        assert_eq!(listed[0].id, 2_000_014, "newest first");
        assert_eq!(read(&save, 2_000_014).unwrap(), b"v14");
        assert_eq!(read_screenshot(&save, 2_000_014).unwrap(), b"png");
        let original = listed.iter().find(|b| b.original).unwrap();
        assert_eq!(original.id, 1_000_000);
        assert!(read(&save, 2_000_005).is_err(), "oldest regular backups are pruned");

        assert!(delete(&save, original.id).is_err());
        delete(&save, 2_000_014).unwrap();
        assert_eq!(list(&save).unwrap().len(), MAX_BACKUPS - 1);

        // write_with_backup keeps the old content; restore brings it back and is itself undoable.
        fs::write(&save, b"before-edit").unwrap();
        let edit = write_with_backup(&save, b"after-edit", 3_000_000, "edited").unwrap();
        assert_eq!(fs::read(&save).unwrap(), b"after-edit");
        assert_eq!(read(&save, edit.id).unwrap(), b"before-edit");
        let safety = restore(&save, edit.id, 3_000_001, "restored").unwrap();
        assert_eq!(fs::read(&save).unwrap(), b"before-edit");
        assert_eq!(fs::read(save.with_extension("png")).unwrap(), b"png");
        assert_eq!(safety.kind, "before-restore");
        assert_eq!(read(&save, safety.id).unwrap(), b"after-edit");

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn under_limit_keeps_everything() {
        let (kept, dropped) = prune((1..=MAX_BACKUPS as u64).map(|i| b(i, false)).collect());
        assert_eq!(kept.len(), MAX_BACKUPS);
        assert!(dropped.is_empty());
    }
}
