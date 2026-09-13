const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { nanoid } = require('nanoid');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const STORAGE_DIR = process.env.STORAGE_DIR || __dirname;
const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads');
const PLANS_DIR = path.join(UPLOADS_DIR, 'plans');
const ITEMS_DIR = path.join(UPLOADS_DIR, 'items');
for (const dir of [UPLOADS_DIR, PLANS_DIR, ITEMS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/vendor/pdfjs', express.static(path.join(__dirname, 'node_modules/pdfjs-dist/build')));
app.use(express.static(path.join(__dirname, 'public')));

function makeUploader(subdir) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, subdir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 10);
      cb(null, `${nanoid()}${ext}`);
    },
  });
  return multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (/^image\//.test(file.mimetype)) cb(null, true);
      else cb(new Error('רק קבצי תמונה נתמכים'));
    },
  });
}
const uploadItemPhotos = makeUploader(ITEMS_DIR);

const uploadPlanFields = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PLANS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 10);
      cb(null, `${nanoid()}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'planPdf') {
      if (file.mimetype === 'application/pdf') return cb(null, true);
      return cb(new Error('קובץ ה-PDF אינו תקין'));
    }
    if (/^image\//.test(file.mimetype)) return cb(null, true);
    cb(new Error('רק קבצי תמונה נתמכים'));
  },
}).fields([
  { name: 'plan', maxCount: 1 },
  { name: 'planPdf', maxCount: 1 },
]);

function relUpload(absPath) {
  return '/uploads/' + path.relative(UPLOADS_DIR, absPath).split(path.sep).join('/');
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function notFound(res, msg) {
  return res.status(404).json({ error: msg || 'לא נמצא' });
}

// ---------- Buildings ----------
app.get('/api/buildings', (req, res) => {
  const rows = db.prepare('SELECT * FROM buildings ORDER BY created_at ASC').all();
  res.json(rows);
});

app.post('/api/buildings', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'חובה להזין שם מבנה' });
  const id = nanoid();
  db.prepare('INSERT INTO buildings (id, name) VALUES (?, ?)').run(id, name);
  res.json(db.prepare('SELECT * FROM buildings WHERE id = ?').get(id));
});

app.patch('/api/buildings/:id', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'חובה להזין שם מבנה' });
  db.prepare('UPDATE buildings SET name = ? WHERE id = ?').run(name, req.params.id);
  res.json(db.prepare('SELECT * FROM buildings WHERE id = ?').get(req.params.id));
});

app.delete('/api/buildings/:id', (req, res) => {
  db.prepare('DELETE FROM buildings WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Floors ----------
app.get('/api/buildings/:buildingId/floors', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM floors WHERE building_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(req.params.buildingId);
  res.json(rows);
});

app.post('/api/buildings/:buildingId/floors', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'חובה להזין שם קומה' });
  const id = nanoid();
  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM floors WHERE building_id = ?')
    .get(req.params.buildingId).m;
  db.prepare('INSERT INTO floors (id, building_id, name, sort_order) VALUES (?, ?, ?, ?)').run(
    id,
    req.params.buildingId,
    name,
    maxOrder + 1
  );
  res.json(db.prepare('SELECT * FROM floors WHERE id = ?').get(id));
});

app.get('/api/floors/:id', (req, res) => {
  const floor = db.prepare('SELECT * FROM floors WHERE id = ?').get(req.params.id);
  if (!floor) return notFound(res);
  res.json(floor);
});

app.patch('/api/floors/:id', (req, res) => {
  const floor = db.prepare('SELECT * FROM floors WHERE id = ?').get(req.params.id);
  if (!floor) return notFound(res);
  const name = req.body.name !== undefined ? String(req.body.name).trim() : floor.name;
  db.prepare('UPDATE floors SET name = ? WHERE id = ?').run(name, req.params.id);
  res.json(db.prepare('SELECT * FROM floors WHERE id = ?').get(req.params.id));
});

app.post('/api/floors/:id/plan', uploadPlanFields, (req, res) => {
  const floor = db.prepare('SELECT * FROM floors WHERE id = ?').get(req.params.id);
  if (!floor) return notFound(res);
  const planFile = req.files?.plan?.[0];
  const pdfFile = req.files?.planPdf?.[0];
  if (!planFile) return res.status(400).json({ error: 'לא הועלה קובץ' });
  const relPath = relUpload(planFile.path);
  const pdfRelPath = pdfFile ? relUpload(pdfFile.path) : null;
  db.prepare('UPDATE floors SET plan_image_path = ?, plan_pdf_path = ? WHERE id = ?').run(
    relPath,
    pdfRelPath,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM floors WHERE id = ?').get(req.params.id));
});

app.delete('/api/floors/:id', (req, res) => {
  db.prepare('DELETE FROM floors WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Rooms ----------
app.get('/api/floors/:floorId/rooms', (req, res) => {
  const rows = db.prepare('SELECT * FROM rooms WHERE floor_id = ? ORDER BY created_at ASC').all(req.params.floorId);
  res.json(rows);
});

app.post('/api/floors/:floorId/rooms', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'חובה להזין שם חדר' });
  const id = nanoid();
  const x = req.body.x !== undefined && req.body.x !== null ? Number(req.body.x) : null;
  const y = req.body.y !== undefined && req.body.y !== null ? Number(req.body.y) : null;
  db.prepare('INSERT INTO rooms (id, floor_id, name, x, y) VALUES (?, ?, ?, ?, ?)').run(
    id,
    req.params.floorId,
    name,
    x,
    y
  );
  res.json(db.prepare('SELECT * FROM rooms WHERE id = ?').get(id));
});

app.patch('/api/rooms/:id', (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) return notFound(res);
  const name = req.body.name !== undefined ? String(req.body.name).trim() : room.name;
  const x = req.body.x !== undefined ? Number(req.body.x) : room.x;
  const y = req.body.y !== undefined ? Number(req.body.y) : room.y;
  db.prepare('UPDATE rooms SET name = ?, x = ?, y = ? WHERE id = ?').run(name, x, y, req.params.id);
  res.json(db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id));
});

app.delete('/api/rooms/:id', (req, res) => {
  db.prepare('DELETE FROM rooms WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Professions & contractor types ----------
app.get('/api/professions', (req, res) => {
  const professions = db.prepare('SELECT * FROM professions ORDER BY sort_order ASC, name ASC').all();
  const contractors = db.prepare('SELECT * FROM contractor_types ORDER BY name ASC').all();
  const byProfession = {};
  for (const c of contractors) {
    (byProfession[c.profession_id] = byProfession[c.profession_id] || []).push(c);
  }
  res.json(professions.map((p) => ({ ...p, contractor_types: byProfession[p.id] || [] })));
});

app.post('/api/professions', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'חובה להזין שם מקצוע' });
  const id = nanoid();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM professions').get().m;
  try {
    db.prepare('INSERT INTO professions (id, name, sort_order) VALUES (?, ?, ?)').run(id, name, maxOrder + 1);
  } catch (e) {
    return res.status(400).json({ error: 'מקצוע בשם זה כבר קיים' });
  }
  res.json({ ...db.prepare('SELECT * FROM professions WHERE id = ?').get(id), contractor_types: [] });
});

app.delete('/api/professions/:id', (req, res) => {
  db.prepare('DELETE FROM professions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/professions/:professionId/contractor-types', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'חובה להזין שם קבלן/תת-מקצוע' });
  const id = nanoid();
  try {
    db.prepare('INSERT INTO contractor_types (id, profession_id, name) VALUES (?, ?, ?)').run(
      id,
      req.params.professionId,
      name
    );
  } catch (e) {
    return res.status(400).json({ error: 'קבלן בשם זה כבר קיים תחת מקצוע זה' });
  }
  res.json(db.prepare('SELECT * FROM contractor_types WHERE id = ?').get(id));
});

app.delete('/api/contractor-types/:id', (req, res) => {
  db.prepare('DELETE FROM contractor_types WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Items (punch-list entries) ----------
function hydrateItem(item) {
  const photos = db.prepare('SELECT * FROM item_photos WHERE item_id = ? ORDER BY created_at ASC').all(item.id);
  return { ...item, photos };
}

const itemsListSql = `
  SELECT
    items.*,
    rooms.name AS room_name,
    floors.id AS floor_id,
    floors.name AS floor_name,
    buildings.id AS building_id,
    buildings.name AS building_name,
    professions.name AS profession_name,
    contractor_types.name AS contractor_type_name
  FROM items
  JOIN rooms ON rooms.id = items.room_id
  JOIN floors ON floors.id = rooms.floor_id
  JOIN buildings ON buildings.id = floors.building_id
  LEFT JOIN professions ON professions.id = items.profession_id
  LEFT JOIN contractor_types ON contractor_types.id = items.contractor_type_id
`;

app.get('/api/items', (req, res) => {
  const clauses = [];
  const params = [];
  const { building_id, floor_id, room_id, profession_id, contractor_type_id, status, q } = req.query;
  if (building_id) { clauses.push('buildings.id = ?'); params.push(building_id); }
  if (floor_id) { clauses.push('floors.id = ?'); params.push(floor_id); }
  if (room_id) { clauses.push('rooms.id = ?'); params.push(room_id); }
  if (profession_id) { clauses.push('professions.id = ?'); params.push(profession_id); }
  if (contractor_type_id) { clauses.push('contractor_types.id = ?'); params.push(contractor_type_id); }
  if (status) { clauses.push('items.status = ?'); params.push(status); }
  if (q) {
    clauses.push('(items.note LIKE ? OR rooms.name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = db.prepare(`${itemsListSql} ${where} ORDER BY items.created_at DESC`).all(...params);
  const ids = rows.map((r) => r.id);
  let photosByItem = {};
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const photos = db.prepare(`SELECT * FROM item_photos WHERE item_id IN (${placeholders}) ORDER BY created_at ASC`).all(...ids);
    for (const p of photos) {
      (photosByItem[p.item_id] = photosByItem[p.item_id] || []).push(p);
    }
  }
  res.json(rows.map((r) => ({ ...r, photos: photosByItem[r.id] || [] })));
});

app.get('/api/items/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return notFound(res);
  res.json(hydrateItem(item));
});

app.post('/api/items', uploadItemPhotos.array('photos', 10), (req, res) => {
  const { room_id, profession_id, contractor_type_id, note } = req.body;
  if (!room_id) return res.status(400).json({ error: 'חובה לבחור חדר' });
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(room_id);
  if (!room) return notFound(res, 'חדר לא נמצא');
  const id = nanoid();
  db.prepare(
    `INSERT INTO items (id, room_id, profession_id, contractor_type_id, note, status)
     VALUES (?, ?, ?, ?, ?, 'open')`
  ).run(id, room_id, profession_id || null, contractor_type_id || null, note || '');
  for (const file of req.files || []) {
    db.prepare('INSERT INTO item_photos (id, item_id, path, kind) VALUES (?, ?, ?, ?)').run(
      nanoid(),
      id,
      relUpload(file.path),
      'issue'
    );
  }
  res.json(hydrateItem(db.prepare('SELECT * FROM items WHERE id = ?').get(id)));
});

app.patch('/api/items/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return notFound(res);
  const note = req.body.note !== undefined ? req.body.note : item.note;
  const profession_id = req.body.profession_id !== undefined ? req.body.profession_id || null : item.profession_id;
  const contractor_type_id =
    req.body.contractor_type_id !== undefined ? req.body.contractor_type_id || null : item.contractor_type_id;
  db.prepare(
    `UPDATE items SET note = ?, profession_id = ?, contractor_type_id = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(note, profession_id, contractor_type_id, req.params.id);
  res.json(hydrateItem(db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id)));
});

app.post('/api/items/:id/status', uploadItemPhotos.array('photos', 10), (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return notFound(res);
  const status = req.body.status === 'done' ? 'done' : 'open';
  db.prepare(`UPDATE items SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, req.params.id);
  for (const file of req.files || []) {
    db.prepare('INSERT INTO item_photos (id, item_id, path, kind) VALUES (?, ?, ?, ?)').run(
      nanoid(),
      req.params.id,
      relUpload(file.path),
      'fix'
    );
  }
  res.json(hydrateItem(db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id)));
});

app.post('/api/items/:id/photos', uploadItemPhotos.array('photos', 10), (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return notFound(res);
  const kind = req.body.kind === 'fix' ? 'fix' : 'issue';
  for (const file of req.files || []) {
    db.prepare('INSERT INTO item_photos (id, item_id, path, kind) VALUES (?, ?, ?, ?)').run(
      nanoid(),
      req.params.id,
      relUpload(file.path),
      kind
    );
  }
  res.json(hydrateItem(db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id)));
});

app.delete('/api/items/:itemId/photos/:photoId', (req, res) => {
  const photo = db.prepare('SELECT * FROM item_photos WHERE id = ? AND item_id = ?').get(
    req.params.photoId,
    req.params.itemId
  );
  if (!photo) return notFound(res);
  const abs = path.join(UPLOADS_DIR, photo.path.replace(/^\/uploads\//, ''));
  db.prepare('DELETE FROM item_photos WHERE id = ?').run(req.params.photoId);
  fs.promises.unlink(abs).catch(() => {});
  res.json({ ok: true });
});

app.delete('/api/items/:id', (req, res) => {
  db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- exports (CSV / Excel) ----------
function filteredItemRows(query) {
  const clauses = [];
  const params = [];
  const { building_id, floor_id, room_id, profession_id, contractor_type_id, status, q } = query;
  if (building_id) { clauses.push('buildings.id = ?'); params.push(building_id); }
  if (floor_id) { clauses.push('floors.id = ?'); params.push(floor_id); }
  if (room_id) { clauses.push('rooms.id = ?'); params.push(room_id); }
  if (profession_id) { clauses.push('professions.id = ?'); params.push(profession_id); }
  if (contractor_type_id) { clauses.push('contractor_types.id = ?'); params.push(contractor_type_id); }
  if (status) { clauses.push('items.status = ?'); params.push(status); }
  if (q) {
    clauses.push('(items.note LIKE ? OR rooms.name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = db.prepare(`${itemsListSql} ${where} ORDER BY floors.sort_order, rooms.name`).all(...params);
  const ids = rows.map((r) => r.id);
  let photosByItem = {};
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const photos = db.prepare(`SELECT * FROM item_photos WHERE item_id IN (${placeholders}) ORDER BY created_at ASC`).all(...ids);
    for (const p of photos) {
      (photosByItem[p.item_id] = photosByItem[p.item_id] || []).push(p);
    }
  }
  return rows.map((r) => ({ ...r, photos: photosByItem[r.id] || [] }));
}

function csvEscape(val) {
  const s = val === null || val === undefined ? '' : String(val);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

app.get('/api/export.csv', (req, res) => {
  const rows = filteredItemRows(req.query);
  const header = ['בניין', 'קומה', 'חדר', 'מקצוע', 'קבלן', 'הערה', 'סטטוס', 'נוצר בתאריך'];
  const lines = [header.map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.building_name,
        r.floor_name,
        r.room_name,
        r.profession_name || '',
        r.contractor_type_name || '',
        r.note || '',
        r.status === 'done' ? 'טופל' : 'פתוח',
        r.created_at,
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  const csv = '﻿' + lines.join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="mesira.csv"');
  res.send(csv);
});

app.get('/api/export.xlsx', async (req, res) => {
  const rows = filteredItemRows(req.query);
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('מסירה', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });

  sheet.columns = [
    { header: 'סטטוס', key: 'status', width: 10 },
    { header: 'בניין', key: 'building', width: 16 },
    { header: 'קומה', key: 'floor', width: 12 },
    { header: 'חדר', key: 'room', width: 16 },
    { header: 'מקצוע', key: 'profession', width: 16 },
    { header: 'קבלן', key: 'contractor', width: 16 },
    { header: 'הערה', key: 'note', width: 40 },
    { header: 'תמונה', key: 'photo', width: 14 },
    { header: 'נוצר בתאריך', key: 'created', width: 18 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E5EA' } };
  sheet.autoFilter = { from: 'A1', to: 'I1' };

  for (const r of rows) {
    const row = sheet.addRow({
      status: r.status === 'done' ? 'טופל' : 'פתוח',
      building: r.building_name,
      floor: r.floor_name,
      room: r.room_name,
      profession: r.profession_name || '',
      contractor: r.contractor_type_name || '',
      note: r.note || '',
      photo: '',
      created: r.created_at,
    });
    row.getCell('note').alignment = { wrapText: true, vertical: 'top' };
    const statusCell = row.getCell('status');
    statusCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: r.status === 'done' ? 'FFDCFCE7' : 'FFFEE2E2' },
    };
    if (r.photos.length) {
      const url = baseUrl + r.photos[0].path;
      row.getCell('photo').value = {
        text: r.photos.length > 1 ? `תמונה (1/${r.photos.length})` : 'תמונה',
        hyperlink: url,
      };
      row.getCell('photo').font = { color: { argb: 'FF2563EB' }, underline: true };
    }
  }

  const filenameAscii = 'mesira.xlsx';
  const filenameUtf8 = encodeURIComponent('מסירה.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filenameAscii}"; filename*=UTF-8''${filenameUtf8}`);
  await workbook.xlsx.write(res);
  res.end();
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'שגיאת שרת' });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Handover server running on http://localhost:${PORT}`);
});
