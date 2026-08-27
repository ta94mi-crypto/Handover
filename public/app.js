/* ניהול מסירות אתר - SPA פשוט ללא build step */

const app = document.getElementById('app');

// ---------------- helpers ----------------

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

let toastTimer = null;
function toast(msg, isError) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.toggle('error', !!isError);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

async function api(method, url, { json, form } = {}) {
  const opts = { method };
  if (json) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(json);
  } else if (form) {
    opts.body = form;
  }
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const msg = (data && data.error) || `שגיאה (${res.status})`;
    toast(msg, true);
    throw new Error(msg);
  }
  return data;
}

const get = (url) => api('GET', url);
const post = (url, json) => api('POST', url, { json });
const postForm = (url, form) => api('POST', url, { form });
const patch = (url, json) => api('PATCH', url, { json });
const del = (url) => api('DELETE', url);

function openLightbox(src) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightbox').classList.remove('hidden');
}
document.getElementById('lightboxClose').onclick = () => document.getElementById('lightbox').classList.add('hidden');
document.getElementById('lightbox').addEventListener('click', (e) => {
  if (e.target.id === 'lightbox') e.target.classList.add('hidden');
});

function closeModal() {
  document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove());
}

function openModal(innerHtml, { wide } = {}) {
  closeModal();
  const backdrop = h(`<div class="modal-backdrop"><div class="modal">${innerHtml}</div></div>`);
  if (wide) backdrop.querySelector('.modal').style.maxWidth = '860px';
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
  document.body.appendChild(backdrop);
  return backdrop;
}

function statusBadge(status) {
  return status === 'done'
    ? '<span class="badge badge-done">טופל</span>'
    : '<span class="badge badge-open">פתוח</span>';
}

function photoThumbs(photos, size) {
  if (!photos || !photos.length) return '<span class="muted">אין תמונות</span>';
  return `<div class="thumbs">${photos.map((p) =>
    `<img class="thumb ${size === 'lg' ? 'thumb-lg' : ''}" src="${esc(p.path)}" data-full="${esc(p.path)}" title="${p.kind === 'fix' ? 'תמונת תיקון' : 'תמונת ליקוי'}" />`
  ).join('')}</div>`;
}

function bindThumbClicks(root) {
  root.querySelectorAll('.thumb').forEach((img) => {
    img.addEventListener('click', () => openLightbox(img.dataset.full));
  });
}

// ---------------- router ----------------

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  return raw.split('/').filter(Boolean);
}

async function render() {
  const parts = parseHash();
  try {
    if (parts.length === 0) return viewBuildings();
    if (parts[0] === 'b' && parts[1]) return viewBuilding(parts[1]);
    if (parts[0] === 'f' && parts[1]) return viewFloor(parts[1]);
    if (parts[0] === 'table') return viewTable();
    if (parts[0] === 'settings') return viewSettings();
    return viewBuildings();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="card empty-state">אירעה שגיאה בטעינת המסך. <br>${esc(e.message)}</div>`;
  }
}

// ---------------- Buildings ----------------

async function viewBuildings() {
  app.innerHTML = '<h1>מבנים</h1><div id="buildingsGrid" class="grid"></div>';
  const buildings = await get('/api/buildings');
  const grid = document.getElementById('buildingsGrid');
  grid.appendChild(h(`
    <div class="tile" id="newBuildingTile" style="align-items:center;justify-content:center;cursor:pointer;border-style:dashed;">
      <div style="font-size:1.6rem;">+</div>
      <div>מבנה חדש</div>
    </div>
  `));
  document.getElementById('newBuildingTile').onclick = async () => {
    const name = prompt('שם המבנה / האתר:');
    if (!name || !name.trim()) return;
    const b = await post('/api/buildings', { name: name.trim() });
    location.hash = `#/b/${b.id}`;
  };
  for (const b of buildings) {
    const tile = h(`
      <div class="tile">
        <div class="tile-title">🏢 ${esc(b.name)}</div>
        <div class="muted">נוצר ${fmtDate(b.created_at)}</div>
        <div class="row" style="margin-top:8px;">
          <a class="btn btn-primary btn-sm" href="#/b/${b.id}">פתח</a>
          <button class="btn btn-sm rename">שנה שם</button>
          <button class="btn btn-danger btn-sm delete">מחק</button>
        </div>
      </div>
    `);
    tile.querySelector('.rename').onclick = async (e) => {
      e.preventDefault();
      const name = prompt('שם חדש:', b.name);
      if (!name || !name.trim()) return;
      await patch(`/api/buildings/${b.id}`, { name: name.trim() });
      render();
    };
    tile.querySelector('.delete').onclick = async (e) => {
      e.preventDefault();
      if (!confirm(`למחוק את "${b.name}" וכל התוכן שלו (קומות, חדרים, ליקויים)? פעולה זו בלתי הפיכה.`)) return;
      await del(`/api/buildings/${b.id}`);
      render();
    };
    grid.appendChild(tile);
  }
}

// ---------------- Building (floors) ----------------

async function viewBuilding(buildingId) {
  app.innerHTML = '<div id="content">טוען...</div>';
  const [buildings, floors] = await Promise.all([
    get('/api/buildings'),
    get(`/api/buildings/${buildingId}/floors`),
  ]);
  const building = buildings.find((b) => b.id === buildingId);
  if (!building) { app.innerHTML = '<div class="card">מבנה לא נמצא</div>'; return; }

  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="breadcrumbs"><a href="#/">מבנים</a> ← ${esc(building.name)}</div>
    <h1>🏢 ${esc(building.name)} — קומות</h1>
    <div id="floorsGrid" class="grid"></div>
  `;
  const grid = document.getElementById('floorsGrid');
  grid.appendChild(h(`
    <div class="tile" id="newFloorTile" style="align-items:center;justify-content:center;cursor:pointer;border-style:dashed;">
      <div style="font-size:1.6rem;">+</div>
      <div>קומה חדשה</div>
    </div>
  `));
  document.getElementById('newFloorTile').onclick = async () => {
    const name = prompt('שם הקומה (למשל: קומה 3, קומת קרקע):');
    if (!name || !name.trim()) return;
    const f = await post(`/api/buildings/${buildingId}/floors`, { name: name.trim() });
    location.hash = `#/f/${f.id}`;
  };
  for (const f of floors) {
    const tile = h(`
      <div class="tile">
        ${f.plan_image_path
          ? `<img src="${esc(f.plan_image_path)}" style="width:100%;height:110px;object-fit:cover;border-radius:8px;" />`
          : `<div class="muted" style="height:110px;display:flex;align-items:center;justify-content:center;background:#f6f7f9;border-radius:8px;">אין תוכנית עדיין</div>`}
        <div class="tile-title">${esc(f.name)}</div>
        <div class="row" style="margin-top:6px;">
          <a class="btn btn-primary btn-sm" href="#/f/${f.id}">פתח</a>
          <button class="btn btn-danger btn-sm delete">מחק</button>
        </div>
      </div>
    `);
    tile.querySelector('.delete').onclick = async (e) => {
      e.preventDefault();
      if (!confirm(`למחוק את "${f.name}" וכל החדרים/הליקויים שלה?`)) return;
      await del(`/api/floors/${f.id}`);
      render();
    };
    grid.appendChild(tile);
  }
}

// ---------------- Floor (plan + rooms) ----------------

async function viewFloor(floorId) {
  app.innerHTML = '<div id="content">טוען...</div>';
  const floor = await get(`/api/floors/${floorId}`);
  const buildings = await get('/api/buildings');
  const building = buildings.find((b) => b.id === floor.building_id);
  const [rooms, items] = await Promise.all([
    get(`/api/floors/${floorId}/rooms`),
    get(`/api/items?floor_id=${floorId}`),
  ]);

  const counts = {};
  for (const it of items) {
    counts[it.room_id] = counts[it.room_id] || { open: 0, done: 0 };
    counts[it.room_id][it.status]++;
  }

  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="breadcrumbs">
      <a href="#/">מבנים</a> ←
      <a href="#/b/${esc(floor.building_id)}">${esc(building ? building.name : '')}</a> ←
      ${esc(floor.name)}
    </div>
    <div class="row-between">
      <h1>${esc(floor.name)}</h1>
      <div class="row">
        <label class="btn btn-sm">
          📷 ${floor.plan_image_path ? 'החלף תוכנית' : 'העלה תוכנית קומה'}
          <input type="file" accept="image/*" id="planInput" style="display:none;" />
        </label>
        <button class="btn btn-primary btn-sm" id="addRoomBtn">+ הוסף חדר</button>
      </div>
    </div>
    <div class="card">
      <div id="planWrap"></div>
      <div class="muted" style="margin-top:8px;font-size:.82rem;">
        ${floor.plan_image_path ? 'לחץ על התוכנית כדי לסמן חדר במיקום מדויק.' : 'העלה תמונת תוכנית (סריקה/צילום) כדי לסמן חדרים על גבי המפה.'}
      </div>
      <div id="roomList" class="room-list"></div>
    </div>
  `;

  document.getElementById('planInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('plan', file);
    await postForm(`/api/floors/${floorId}/plan`, fd);
    toast('התוכנית הועלתה');
    viewFloor(floorId);
  });

  document.getElementById('addRoomBtn').onclick = () => openRoomCreateModal(floorId, null, null, () => viewFloor(floorId));

  renderPlan(floor, rooms, counts, floorId);
  renderRoomList(rooms, counts, floorId);
}

function pinClass(c) {
  if (!c) return '';
  if (c.open > 0) return 'has-open';
  if (c.done > 0) return 'all-done';
  return '';
}

function renderPlan(floor, rooms, counts, floorId) {
  const wrap = document.getElementById('planWrap');
  if (!floor.plan_image_path) {
    wrap.innerHTML = `<div class="no-plan">אין עדיין תוכנית לקומה זו. לחצו על "העלה תוכנית קומה" למעלה.</div>`;
    return;
  }
  wrap.innerHTML = `<div class="floor-plan-wrap" id="planImgWrap">
    <img src="${esc(floor.plan_image_path)}" id="planImg" />
    ${rooms.filter((r) => r.x !== null && r.y !== null).map((r) => `
      <div class="room-pin ${pinClass(counts[r.id])}" style="left:${r.x}%;top:${r.y}%;" data-room="${r.id}" title="${esc(r.name)}">${esc(r.name).slice(0, 1)}</div>
    `).join('')}
  </div>`;
  const planImgWrap = document.getElementById('planImgWrap');
  planImgWrap.addEventListener('click', (e) => {
    if (e.target.closest('.room-pin')) return;
    const rect = planImgWrap.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    openRoomCreateModal(floorId, x, y, () => viewFloor(floorId));
  });
  planImgWrap.querySelectorAll('.room-pin').forEach((pin) => {
    pin.addEventListener('click', () => openRoomModal(pin.dataset.room, () => viewFloor(floorId)));
  });
}

function renderRoomList(rooms, counts, floorId) {
  const list = document.getElementById('roomList');
  if (!rooms.length) {
    list.innerHTML = '<span class="muted">עדיין אין חדרים בקומה זו.</span>';
    return;
  }
  list.innerHTML = '';
  for (const r of rooms) {
    const c = counts[r.id] || { open: 0, done: 0 };
    const chip = h(`<div class="room-chip">${esc(r.name)} <span class="count">(${c.open} פתוח / ${c.done} טופל)</span></div>`);
    chip.addEventListener('click', () => openRoomModal(r.id, () => viewFloor(floorId)));
    list.appendChild(chip);
  }
}

function openRoomCreateModal(floorId, x, y, onDone) {
  const backdrop = openModal(`
    <div class="modal-header"><h2>חדר חדש</h2><button class="modal-close">✕</button></div>
    <div class="field">
      <label>שם החדר</label>
      <input type="text" id="roomNameInput" placeholder="למשל: סלון, חדר שינה 2, מטבח" autofocus />
    </div>
    <div class="row" style="margin-top:14px;justify-content:flex-end;">
      <button class="btn" id="cancelBtn">ביטול</button>
      <button class="btn btn-primary" id="saveBtn">שמור</button>
    </div>
  `);
  backdrop.querySelector('.modal-close').onclick = closeModal;
  backdrop.querySelector('#cancelBtn').onclick = closeModal;
  const input = backdrop.querySelector('#roomNameInput');
  input.focus();
  const save = async () => {
    const name = input.value.trim();
    if (!name) return;
    await post(`/api/floors/${floorId}/rooms`, { name, x, y });
    closeModal();
    toast('החדר נוסף');
    onDone();
  };
  backdrop.querySelector('#saveBtn').onclick = save;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
}

// ---------------- Room modal (items list + add item) ----------------

let professionsCache = null;
async function getProfessions() {
  if (!professionsCache) professionsCache = await get('/api/professions');
  return professionsCache;
}

async function openRoomModal(roomId, onChange) {
  const items = await get(`/api/items?room_id=${roomId}`);
  const professions = await getProfessions();
  const roomName = items[0]?.room_name || '';

  const backdrop = openModal(`
    <div class="modal-header">
      <h2>🚪 ${esc(roomName || 'חדר')}</h2>
      <button class="modal-close">✕</button>
    </div>
    <div id="itemsList"></div>
    <hr style="border:none;border-top:1px solid var(--border);margin:14px 0;" />
    <h3>➕ הוספת הערה / ליקוי</h3>
    <form id="newItemForm">
      <div class="row" style="margin-bottom:8px;">
        <div class="field" style="flex:1;min-width:150px;">
          <label>מקצוע</label>
          <select id="professionSelect"><option value="">— בחר מקצוע —</option>
            ${professions.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
            <option value="__new__">+ מקצוע חדש...</option>
          </select>
        </div>
        <div class="field" style="flex:1;min-width:150px;">
          <label>קבלן / תת-מקצוע</label>
          <select id="contractorSelect"><option value="">— בחר —</option></select>
        </div>
      </div>
      <div class="field" style="margin-bottom:8px;">
        <label>הערה</label>
        <textarea id="noteInput" placeholder="תיאור הליקוי או הערה..."></textarea>
      </div>
      <div class="field" style="margin-bottom:8px;">
        <label>תמונות</label>
        <input type="file" id="photosInput" accept="image/*" capture="environment" multiple />
      </div>
      <div class="row" style="justify-content:flex-end;">
        <button type="submit" class="btn btn-primary">הוסף</button>
      </div>
    </form>
  `, { wide: true });

  backdrop.querySelector('.modal-close').onclick = closeModal;

  function renderItems(list) {
    const box = backdrop.querySelector('#itemsList');
    if (!list.length) {
      box.innerHTML = '<div class="muted">אין עדיין הערות/ליקויים לחדר זה.</div>';
      return;
    }
    box.innerHTML = '';
    for (const it of list) {
      const card = h(`
        <div class="item-card">
          <div class="item-card-top">
            <div class="item-tags">
              ${it.profession_name ? `<span class="badge badge-neutral">${esc(it.profession_name)}</span>` : ''}
              ${it.contractor_type_name ? `<span class="badge badge-neutral">${esc(it.contractor_type_name)}</span>` : ''}
              ${statusBadge(it.status)}
            </div>
            <span class="muted" style="font-size:.78rem;">${fmtDate(it.created_at)}</span>
          </div>
          <div class="item-note">${esc(it.note) || '<span class="muted">ללא הערה</span>'}</div>
          ${photoThumbs(it.photos)}
          <div class="row" style="margin-top:10px;">
            ${it.status === 'open'
              ? `<button class="btn btn-success btn-sm mark-done">✔ סמן כטופל</button>`
              : `<button class="btn btn-sm reopen">↺ פתח מחדש</button>`}
            <button class="btn btn-sm add-photo">📷 הוסף תמונה</button>
            <button class="btn btn-danger btn-sm del-item">מחק</button>
          </div>
        </div>
      `);
      bindThumbClicks(card);
      card.querySelector('.mark-done')?.addEventListener('click', () => openStatusModal(it, async () => {
        const fresh = await get(`/api/items?room_id=${roomId}`);
        renderItems(fresh);
        onChange();
      }));
      card.querySelector('.reopen')?.addEventListener('click', async () => {
        await post(`/api/items/${it.id}/status`, { status: 'open' });
        const fresh = await get(`/api/items?room_id=${roomId}`);
        renderItems(fresh);
        onChange();
      });
      card.querySelector('.add-photo').addEventListener('click', () => openAddPhotoModal(it.id, async () => {
        const fresh = await get(`/api/items?room_id=${roomId}`);
        renderItems(fresh);
      }));
      card.querySelector('.del-item').addEventListener('click', async () => {
        if (!confirm('למחוק את הרשומה?')) return;
        await del(`/api/items/${it.id}`);
        const fresh = await get(`/api/items?room_id=${roomId}`);
        renderItems(fresh);
        onChange();
      });
      box.appendChild(card);
    }
  }
  renderItems(items);

  const professionSelect = backdrop.querySelector('#professionSelect');
  const contractorSelect = backdrop.querySelector('#contractorSelect');

  function fillContractors(professionId) {
    const prof = professions.find((p) => p.id === professionId);
    contractorSelect.innerHTML = '<option value="">— בחר —</option>' +
      (prof ? prof.contractor_types.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') : '') +
      '<option value="__new__">+ קבלן/תת-מקצוע חדש...</option>';
  }

  professionSelect.addEventListener('change', async () => {
    if (professionSelect.value === '__new__') {
      const name = prompt('שם המקצוע החדש:');
      professionSelect.value = '';
      if (name && name.trim()) {
        const p = await post('/api/professions', { name: name.trim() });
        professionsCache = null;
        const fresh = await getProfessions();
        professions.length = 0; professions.push(...fresh);
        const opt = h(`<option value="${p.id}">${esc(p.name)}</option>`);
        professionSelect.insertBefore(opt, professionSelect.lastElementChild);
        professionSelect.value = p.id;
      }
    }
    fillContractors(professionSelect.value);
  });

  contractorSelect.addEventListener('change', async () => {
    if (contractorSelect.value === '__new__') {
      const professionId = professionSelect.value;
      if (!professionId) { toast('בחר מקצוע קודם', true); contractorSelect.value = ''; return; }
      const name = prompt('שם הקבלן / תת-המקצוע:');
      contractorSelect.value = '';
      if (name && name.trim()) {
        const c = await post(`/api/professions/${professionId}/contractor-types`, { name: name.trim() });
        professionsCache = null;
        const fresh = await getProfessions();
        professions.length = 0; professions.push(...fresh);
        const opt = h(`<option value="${c.id}">${esc(c.name)}</option>`);
        contractorSelect.insertBefore(opt, contractorSelect.lastElementChild);
        contractorSelect.value = c.id;
      }
    }
  });

  backdrop.querySelector('#newItemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('room_id', roomId);
    if (professionSelect.value && professionSelect.value !== '__new__') fd.append('profession_id', professionSelect.value);
    if (contractorSelect.value && contractorSelect.value !== '__new__') fd.append('contractor_type_id', contractorSelect.value);
    fd.append('note', backdrop.querySelector('#noteInput').value.trim());
    const files = backdrop.querySelector('#photosInput').files;
    for (const f of files) fd.append('photos', f);
    await postForm('/api/items', fd);
    toast('נוסף בהצלחה');
    const fresh = await get(`/api/items?room_id=${roomId}`);
    renderItems(fresh);
    e.target.reset();
    contractorSelect.innerHTML = '<option value="">— בחר —</option>';
    onChange();
  });
}

function openStatusModal(item, onDone) {
  const backdrop = openModal(`
    <div class="modal-header"><h2>סימון כטופל</h2><button class="modal-close">✕</button></div>
    <p class="muted">ניתן לצרף תמונה שמעידה על התיקון (לא חובה).</p>
    <div class="field">
      <input type="file" id="fixPhotos" accept="image/*" capture="environment" multiple />
    </div>
    <div class="row" style="margin-top:14px;justify-content:flex-end;">
      <button class="btn" id="cancelBtn">ביטול</button>
      <button class="btn btn-success" id="confirmBtn">✔ סמן כטופל</button>
    </div>
  `);
  backdrop.querySelector('.modal-close').onclick = closeModal;
  backdrop.querySelector('#cancelBtn').onclick = closeModal;
  backdrop.querySelector('#confirmBtn').onclick = async () => {
    const fd = new FormData();
    fd.append('status', 'done');
    const files = backdrop.querySelector('#fixPhotos').files;
    for (const f of files) fd.append('photos', f);
    await postForm(`/api/items/${item.id}/status`, fd);
    closeModal();
    toast('סומן כטופל');
    onDone();
  };
}

function openAddPhotoModal(itemId, onDone) {
  const backdrop = openModal(`
    <div class="modal-header"><h2>הוספת תמונה</h2><button class="modal-close">✕</button></div>
    <input type="file" id="morePhotos" accept="image/*" capture="environment" multiple />
    <div class="row" style="margin-top:14px;justify-content:flex-end;">
      <button class="btn" id="cancelBtn">ביטול</button>
      <button class="btn btn-primary" id="saveBtn">שמור</button>
    </div>
  `);
  backdrop.querySelector('.modal-close').onclick = closeModal;
  backdrop.querySelector('#cancelBtn').onclick = closeModal;
  backdrop.querySelector('#saveBtn').onclick = async () => {
    const fd = new FormData();
    const files = backdrop.querySelector('#morePhotos').files;
    if (!files.length) { closeModal(); return; }
    for (const f of files) fd.append('photos', f);
    await postForm(`/api/items/${itemId}/photos`, fd);
    closeModal();
    toast('התמונה נוספה');
    onDone();
  };
}

// ---------------- Global table ----------------

let tableFilters = {};
let searchDebounce = null;

async function viewTable() {
  app.innerHTML = `
    <h1>📋 טבלת ליקויים ומסירה</h1>
    <div class="card">
      <div class="filters-bar" id="filtersBar"></div>
      <div class="row" style="margin-bottom:12px;">
        <a class="btn" id="exportCsv" href="#">⬇ ייצוא CSV</a>
        <button class="btn" id="printBtn">🖨 הדפסה</button>
        <span class="muted" id="resultsCount"></span>
      </div>
      <div style="overflow-x:auto;">
        <table id="itemsTable">
          <thead><tr>
            <th>סטטוס</th><th>מבנה</th><th>קומה</th><th>חדר</th><th>מקצוע</th><th>קבלן</th><th>הערה</th><th>תמונה</th><th>תאריך</th><th></th>
          </tr></thead>
          <tbody id="itemsBody"></tbody>
        </table>
      </div>
    </div>
  `;

  const [buildings, professions] = await Promise.all([get('/api/buildings'), getProfessions()]);
  const filtersBar = document.getElementById('filtersBar');

  filtersBar.innerHTML = `
    <div class="field"><label>מבנה</label><select id="fBuilding"><option value="">הכל</option>
      ${buildings.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
    <div class="field"><label>קומה</label><select id="fFloor"><option value="">הכל</option></select></div>
    <div class="field"><label>מקצוע</label><select id="fProfession"><option value="">הכל</option>
      ${professions.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
    <div class="field"><label>קבלן</label><select id="fContractor"><option value="">הכל</option></select></div>
    <div class="field"><label>סטטוס</label><select id="fStatus">
      <option value="">הכל</option><option value="open">פתוח</option><option value="done">טופל</option>
    </select></div>
    <div class="field"><label>חיפוש</label><input type="search" id="fSearch" placeholder="חיפוש בהערה / חדר..." /></div>
  `;

  const fBuilding = document.getElementById('fBuilding');
  const fFloor = document.getElementById('fFloor');
  const fProfession = document.getElementById('fProfession');
  const fContractor = document.getElementById('fContractor');
  const fStatus = document.getElementById('fStatus');
  const fSearch = document.getElementById('fSearch');

  async function refreshFloors() {
    fFloor.innerHTML = '<option value="">הכל</option>';
    if (fBuilding.value) {
      const floors = await get(`/api/buildings/${fBuilding.value}/floors`);
      for (const f of floors) fFloor.appendChild(h(`<option value="${f.id}">${esc(f.name)}</option>`));
    }
  }
  function refreshContractors() {
    fContractor.innerHTML = '<option value="">הכל</option>';
    const prof = professions.find((p) => p.id === fProfession.value);
    if (prof) for (const c of prof.contractor_types) fContractor.appendChild(h(`<option value="${c.id}">${esc(c.name)}</option>`));
  }

  fBuilding.addEventListener('change', async () => { await refreshFloors(); loadTable(); });
  fFloor.addEventListener('change', loadTable);
  fProfession.addEventListener('change', () => { refreshContractors(); loadTable(); });
  fContractor.addEventListener('change', loadTable);
  fStatus.addEventListener('change', loadTable);
  fSearch.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(loadTable, 300);
  });

  function currentFilters() {
    return {
      building_id: fBuilding.value, floor_id: fFloor.value, profession_id: fProfession.value,
      contractor_type_id: fContractor.value, status: fStatus.value, q: fSearch.value.trim(),
    };
  }

  function buildQuery() {
    const f = currentFilters();
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) params.set(k, v);
    return params.toString();
  }

  async function loadTable() {
    const qs = buildQuery();
    document.getElementById('exportCsv').href = `/api/export.csv${qs ? '?' + qs : ''}`;
    const items = await get(`/api/items${qs ? '?' + qs : ''}`);
    document.getElementById('resultsCount').textContent = `${items.length} רשומות`;
    const body = document.getElementById('itemsBody');
    if (!items.length) {
      body.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-muted);">אין רשומות תואמות</td></tr>`;
      return;
    }
    body.innerHTML = '';
    for (const it of items) {
      const tr = h(`
        <tr>
          <td data-label="סטטוס">${statusBadge(it.status)}</td>
          <td data-label="מבנה">${esc(it.building_name)}</td>
          <td data-label="קומה">${esc(it.floor_name)}</td>
          <td data-label="חדר">${esc(it.room_name)}</td>
          <td data-label="מקצוע">${esc(it.profession_name || '—')}</td>
          <td data-label="קבלן">${esc(it.contractor_type_name || '—')}</td>
          <td data-label="הערה" style="max-width:220px;white-space:pre-wrap;">${esc(it.note || '')}</td>
          <td data-label="תמונה">${photoThumbs(it.photos)}</td>
          <td data-label="תאריך">${fmtDate(it.created_at)}</td>
          <td data-label=""><button class="btn btn-sm open-item">פתח</button></td>
        </tr>
      `);
      bindThumbClicks(tr);
      tr.querySelector('.open-item').addEventListener('click', () => openItemDetailModal(it, loadTable));
      body.appendChild(tr);
    }
  }

  document.getElementById('printBtn').onclick = () => window.print();

  await refreshFloors();
  refreshContractors();
  loadTable();
}

function openItemDetailModal(it, onChange) {
  const backdrop = openModal(`
    <div class="modal-header"><h2>${esc(it.room_name)} — ${esc(it.floor_name)}</h2><button class="modal-close">✕</button></div>
    <div class="item-tags" style="margin-bottom:10px;">
      ${it.profession_name ? `<span class="badge badge-neutral">${esc(it.profession_name)}</span>` : ''}
      ${it.contractor_type_name ? `<span class="badge badge-neutral">${esc(it.contractor_type_name)}</span>` : ''}
      ${statusBadge(it.status)}
    </div>
    <div class="item-note">${esc(it.note) || '<span class="muted">ללא הערה</span>'}</div>
    <div id="detailPhotos">${photoThumbs(it.photos, 'lg')}</div>
    <div class="row" style="margin-top:14px;">
      ${it.status === 'open'
        ? `<button class="btn btn-success mark-done">✔ סמן כטופל</button>`
        : `<button class="btn reopen">↺ פתח מחדש</button>`}
      <button class="btn add-photo">📷 הוסף תמונה</button>
    </div>
  `, { wide: true });
  backdrop.querySelector('.modal-close').onclick = closeModal;
  bindThumbClicks(backdrop);
  backdrop.querySelector('.mark-done')?.addEventListener('click', () => openStatusModal(it, () => { closeModal(); onChange(); }));
  backdrop.querySelector('.reopen')?.addEventListener('click', async () => {
    await post(`/api/items/${it.id}/status`, { status: 'open' });
    closeModal(); onChange();
  });
  backdrop.querySelector('.add-photo').addEventListener('click', () => openAddPhotoModal(it.id, () => { closeModal(); onChange(); }));
}

// ---------------- Settings (professions & contractor types) ----------------

async function viewSettings() {
  professionsCache = null;
  app.innerHTML = '<h1>⚙️ מקצועות וקבלנים</h1><div id="settingsBody"></div>';
  await renderSettings();
}

async function renderSettings() {
  const professions = await getProfessions();
  const box = document.getElementById('settingsBody');
  box.innerHTML = `
    <div class="card">
      <div class="row" style="margin-bottom:14px;">
        <input type="text" id="newProfessionInput" placeholder="שם מקצוע חדש (למשל: מיזוג אוויר)" />
        <button class="btn btn-primary" id="addProfessionBtn">+ הוסף מקצוע</button>
      </div>
      <div id="professionsList"></div>
    </div>
  `;
  const list = document.getElementById('professionsList');
  for (const p of professions) {
    const group = h(`
      <div class="settings-group">
        <div class="row-between">
          <h3>${esc(p.name)}</h3>
          <button class="btn btn-danger btn-sm del-prof">מחק מקצוע</button>
        </div>
        <div class="contractor-list"></div>
        <div class="row">
          <input type="text" class="new-contractor" placeholder="קבלן / תת-מקצוע חדש" />
          <button class="btn btn-sm add-contractor">+ הוסף</button>
        </div>
      </div>
    `);
    const cList = group.querySelector('.contractor-list');
    for (const c of p.contractor_types) {
      const pill = h(`<span class="tag-pill">${esc(c.name)}<button title="מחק">✕</button></span>`);
      pill.querySelector('button').addEventListener('click', async () => {
        if (!confirm(`למחוק את "${c.name}"?`)) return;
        await del(`/api/contractor-types/${c.id}`);
        professionsCache = null;
        renderSettings();
      });
      cList.appendChild(pill);
    }
    group.querySelector('.del-prof').addEventListener('click', async () => {
      if (!confirm(`למחוק את המקצוע "${p.name}" וכל תתי-המקצוע שלו?`)) return;
      await del(`/api/professions/${p.id}`);
      professionsCache = null;
      renderSettings();
    });
    group.querySelector('.add-contractor').addEventListener('click', async () => {
      const input = group.querySelector('.new-contractor');
      const name = input.value.trim();
      if (!name) return;
      await post(`/api/professions/${p.id}/contractor-types`, { name });
      professionsCache = null;
      renderSettings();
    });
    list.appendChild(group);
  }

  document.getElementById('addProfessionBtn').onclick = async () => {
    const input = document.getElementById('newProfessionInput');
    const name = input.value.trim();
    if (!name) return;
    await post('/api/professions', { name });
    professionsCache = null;
    renderSettings();
  };
}
