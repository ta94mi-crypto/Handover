const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const STORAGE_DIR = process.env.STORAGE_DIR || __dirname;
const DATA_DIR = path.join(STORAGE_DIR, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'handover.db'));

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS buildings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS floors (
    id TEXT PRIMARY KEY,
    building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    plan_image_path TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    floor_id TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    x REAL,
    y REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS professions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS contractor_types (
    id TEXT PRIMARY KEY,
    profession_id TEXT NOT NULL REFERENCES professions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    UNIQUE(profession_id, name)
  );

  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    profession_id TEXT REFERENCES professions(id) ON DELETE SET NULL,
    contractor_type_id TEXT REFERENCES contractor_types(id) ON DELETE SET NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS item_photos (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'issue',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_floors_building ON floors(building_id);
  CREATE INDEX IF NOT EXISTS idx_rooms_floor ON rooms(floor_id);
  CREATE INDEX IF NOT EXISTS idx_items_room ON items(room_id);
  CREATE INDEX IF NOT EXISTS idx_photos_item ON item_photos(item_id);
`);

// Seed default professions + contractor types on first run
const professionCount = db.prepare('SELECT COUNT(*) AS c FROM professions').get().c;
if (professionCount === 0) {
  const { nanoid } = require('nanoid');
  const insertProfession = db.prepare('INSERT INTO professions (id, name, sort_order) VALUES (?, ?, ?)');
  const insertContractor = db.prepare('INSERT INTO contractor_types (id, profession_id, name) VALUES (?, ?, ?)');

  const defaults = {
    'מיזוג אוויר': ['פחח', 'צנרן', 'מבודד', 'חשמלאי מיזוג'],
    'חשמל': ['חשמלאי', 'תקשורת/מתח נמוך'],
    'אינסטלציה': ['אינסטלטור', 'איטום'],
    'גבס ותקרות': ['גבסאי', 'צבעי'],
    'ריצוף וחיפוי': ['רצף'],
    'אלומיניום וזכוכית': ['מתקין אלומיניום'],
    'נגרות': ['נגר'],
    'מעליות': ['טכנאי מעליות'],
    'כללי / אחר': ['קבלן ראשי'],
  };

  let order = 0;
  for (const [profName, contractors] of Object.entries(defaults)) {
    const profId = nanoid();
    insertProfession.run(profId, profName, order++);
    for (const cName of contractors) {
      insertContractor.run(nanoid(), profId, cName);
    }
  }
}

module.exports = db;
