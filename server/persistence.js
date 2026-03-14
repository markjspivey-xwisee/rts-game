// ═══════════════════════════════════════════════════════════════════════════
//  PERSISTENCE - JSON file-based persistent storage
// ═══════════════════════════════════════════════════════════════════════════
//
// Simple JSON file storage that survives server restarts.
// No native compilation needed (no SQLite), works on Azure out of the box.
// Data files are stored in the /data directory at project root.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

// Ensure data directory exists
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

/**
 * Load JSON data from a file in the data directory.
 * Returns defaultValue if file doesn't exist.
 */
export function loadData(filename, defaultValue = null) {
  const filepath = join(DATA_DIR, filename);
  try {
    if (existsSync(filepath)) {
      return JSON.parse(readFileSync(filepath, "utf-8"));
    }
  } catch (err) {
    console.warn(`[Persistence] Failed to load ${filename}:`, err.message);
  }
  return defaultValue;
}

/**
 * Save JSON data to a file in the data directory.
 * Writes atomically (write to .tmp then rename).
 */
export function saveData(filename, data) {
  const filepath = join(DATA_DIR, filename);
  const tmp = filepath + ".tmp";
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tmp, filepath);
  } catch (err) {
    // Fallback: direct write
    try {
      writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
      console.warn(`[Persistence] Failed to save ${filename}:`, e.message);
    }
  }
}

/**
 * Create an auto-saving Map-like store backed by a JSON file.
 * Debounces saves to avoid excessive disk IO.
 */
export function createPersistentStore(filename, defaultData = {}) {
  const data = loadData(filename, defaultData);
  let saveTimer = null;

  const scheduleSave = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveData(filename, data);
      saveTimer = null;
    }, 5000); // Save at most every 5 seconds
  };

  return {
    get: (key) => data[String(key)],
    set: (key, value) => { data[String(key)] = value; scheduleSave(); },
    delete: (key) => { delete data[String(key)]; scheduleSave(); },
    has: (key) => String(key) in data,
    values: () => Object.values(data),
    entries: () => Object.entries(data),
    keys: () => Object.keys(data),
    get size() { return Object.keys(data).length; },
    toJSON: () => data,
    forceSave: () => {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      saveData(filename, data);
    },
  };
}
