const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'pinbook.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      api_token TEXT NOT NULL UNIQUE,
      secret_key TEXT NOT NULL,
      default_private INTEGER NOT NULL DEFAULT 0,
      privacy_lock INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      extended TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '',
      hash TEXT NOT NULL,
      shared INTEGER NOT NULL DEFAULT 1,
      toread INTEGER NOT NULL DEFAULT 0,
      starred INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, url)
    );

    CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_created ON bookmarks(created_at);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_toread ON bookmarks(user_id, toread);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_shared ON bookmarks(user_id, shared);
  `);

  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (userCount === 0) {
    const token = crypto.randomBytes(8).toString('hex').toUpperCase();
    const secret = crypto.randomBytes(10).toString('hex');
    db.prepare(
      'INSERT INTO users (username, api_token, secret_key) VALUES (?, ?, ?)'
    ).run('pinbook', token, secret);
  }

  migrateDb();
}

function migrateDb() {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('default_private')) {
    db.exec('ALTER TABLE users ADD COLUMN default_private INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('privacy_lock')) {
    db.exec('ALTER TABLE users ADD COLUMN privacy_lock INTEGER NOT NULL DEFAULT 0');
  }
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function bookmarkHash(url) {
  return md5(url);
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function emitWebhook(event, bookmark) {
  const url = process.env.PINBOOK_WEBHOOK_URL;
  if (!url) return;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, bookmark: bookmark ? formatPost(bookmark) : null, time: nowIso() }),
  }).catch(() => {});
}

function parseTags(tagStr) {
  if (!tagStr) return [];
  return tagStr.trim().split(/\s+/).filter(Boolean);
}

function tagsMatch(bookmarkTags, filterTags) {
  const bt = parseTags(bookmarkTags).map((t) => t.toLowerCase());
  return filterTags.every((ft) => bt.includes(ft.toLowerCase()));
}

function getDefaultUser() {
  return db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get();
}

function getUserByToken(authToken) {
  if (!authToken) return null;
  const parts = authToken.split(':');
  if (parts.length !== 2) return null;
  const [username, token] = parts;
  return db
    .prepare('SELECT * FROM users WHERE username = ? AND api_token = ?')
    .get(username, token);
}

function formatPost(bookmark) {
  return {
    href: bookmark.url,
    description: bookmark.description,
    extended: bookmark.extended,
    hash: bookmark.hash,
    tag: bookmark.tags,
    time: bookmark.created_at,
    shared: bookmark.shared ? 'yes' : 'no',
    toread: bookmark.toread ? 'yes' : 'no',
    starred: bookmark.starred ? 'yes' : 'no',
    others: '0',
    meta: md5(`${bookmark.url}${bookmark.updated_at}`),
  };
}

function listBookmarks(userId, options = {}) {
  let sql = 'SELECT * FROM bookmarks WHERE user_id = ?';
  const params = [userId];

  if (options.shared === true) {
    sql += ' AND shared = 1';
  } else if (options.shared === false) {
    sql += ' AND shared = 0';
  }

  if (options.toread === true) {
    sql += ' AND toread = 1';
  }

  if (options.starred === true) {
    sql += ' AND starred = 1';
  }

  if (options.untagged) {
    sql += " AND (tags IS NULL OR tags = '')";
  }

  if (options.url) {
    sql += ' AND url = ?';
    params.push(options.url);
  }

  if (options.fromdt) {
    sql += ' AND created_at >= ?';
    params.push(options.fromdt);
  }

  if (options.todt) {
    sql += ' AND created_at <= ?';
    params.push(options.todt);
  }

  if (options.date) {
    sql += " AND date(created_at) = date(?)";
    params.push(options.date);
  }

  const sort = options.sort === 'description' ? 'description' : 'created_at';
  const order = options.order === 'ASC' ? 'ASC' : 'DESC';
  sql += ` ORDER BY ${sort} ${order}`;

  if (options.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }

  if (options.offset) {
    sql += ' OFFSET ?';
    params.push(options.offset);
  }

  let rows = db.prepare(sql).all(...params);

  if (options.tags && options.tags.length > 0) {
    rows = rows.filter((b) => tagsMatch(b.tags, options.tags));
  }

  return rows;
}

function addBookmark(userId, data) {
  const url = data.url;
  const description = data.description || url;
  const extended = data.extended || '';
  const tags = Array.isArray(data.tags) ? data.tags.join(' ') : (data.tags || '');
  const shared = data.shared === 'no' || data.shared === false ? 0 : data.shared === 'yes' || data.shared === true ? 1 : null;
  const toread = data.toread === 'yes' || data.toread === true ? 1 : 0;
  const starred = data.starred === 'yes' || data.starred === true ? 1 : 0;
  const createdAt = data.dt || nowIso();
  const updatedAt = nowIso();
  const hash = bookmarkHash(url);

  let resolvedShared = shared;
  if (resolvedShared === null) {
    const user = db.prepare('SELECT default_private FROM users WHERE id = ?').get(userId);
    resolvedShared = user?.default_private ? 0 : 1;
  }

  const existing = db
    .prepare('SELECT * FROM bookmarks WHERE user_id = ? AND url = ?')
    .get(userId, url);

  if (existing && data.replace === 'no') {
    return { ok: false, error: 'bookmark exists' };
  }

  if (existing) {
    db.prepare(`
      UPDATE bookmarks SET description = ?, extended = ?, tags = ?, shared = ?,
        toread = ?, starred = ?, updated_at = ?
      WHERE id = ?
    `).run(description, extended, tags, resolvedShared, toread, starred, updatedAt, existing.id);
    const updated = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(existing.id);
    emitWebhook('bookmark.updated', updated);
    return { ok: true, bookmark: updated };
  }

  const result = db.prepare(`
    INSERT INTO bookmarks (user_id, url, description, extended, tags, hash, shared, toread, starred, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, url, description, extended, tags, hash, resolvedShared, toread, starred, createdAt, updatedAt);

  const created = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(result.lastInsertRowid);
  emitWebhook('bookmark.created', created);
  return { ok: true, bookmark: created };
}

function deleteBookmark(userId, url) {
  const existing = db
    .prepare('SELECT * FROM bookmarks WHERE user_id = ? AND url = ?')
    .get(userId, url);
  const result = db
    .prepare('DELETE FROM bookmarks WHERE user_id = ? AND url = ?')
    .run(userId, url);
  if (result.changes > 0) {
    emitWebhook('bookmark.deleted', existing);
  }
  return result.changes > 0;
}

function getBookmarkByHash(userId, hash) {
  return db.prepare('SELECT * FROM bookmarks WHERE user_id = ? AND hash = ?').get(userId, hash);
}

function getOldestUnread(userId) {
  return db
    .prepare('SELECT * FROM bookmarks WHERE user_id = ? AND toread = 1 ORDER BY created_at ASC LIMIT 1')
    .get(userId);
}

function getRandomUnread(userId) {
  return db
    .prepare('SELECT * FROM bookmarks WHERE user_id = ? AND toread = 1 ORDER BY RANDOM() LIMIT 1')
    .get(userId);
}

function bulkUpdateBookmarks(userId, hashes, action, extra = {}) {
  const now = nowIso();
  let changed = 0;

  const apply = db.transaction(() => {
    for (const hash of hashes) {
      const b = getBookmarkByHash(userId, hash);
      if (!b) continue;

      if (action === 'delete') {
        db.prepare('DELETE FROM bookmarks WHERE id = ?').run(b.id);
        changed++;
        continue;
      }

      let shared = b.shared;
      let toread = b.toread;
      let tags = b.tags;

      if (action === 'private') shared = 0;
      else if (action === 'public') shared = 1;
      else if (action === 'read') toread = 0;
      else if (action === 'unread') toread = 1;
      else if ((action === 'add_tag' || action === 'remove_tag') && extra.tag) {
        const list = parseTags(tags);
        const needle = extra.tag.toLowerCase();
        if (action === 'add_tag') {
          if (!list.some((t) => t.toLowerCase() === needle)) list.push(extra.tag);
        } else {
          const idx = list.findIndex((t) => t.toLowerCase() === needle);
          if (idx !== -1) list.splice(idx, 1);
        }
        tags = list.join(' ');
      }

      db.prepare(
        'UPDATE bookmarks SET shared = ?, toread = ?, tags = ?, updated_at = ? WHERE id = ?'
      ).run(shared, toread, tags, now, b.id);
      changed++;
    }
  });

  apply();
  return changed;
}

function getLastUpdate(userId) {
  const row = db
    .prepare('SELECT MAX(updated_at) as t FROM bookmarks WHERE user_id = ?')
    .get(userId);
  return row.t || nowIso();
}

function getTags(userId) {
  const bookmarks = db
    .prepare('SELECT tags FROM bookmarks WHERE user_id = ?')
    .all(userId);
  const counts = {};
  for (const b of bookmarks) {
    for (const tag of parseTags(b.tags)) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

function getTagCloud(userId) {
  return getTags(userId).sort((a, b) => b.count - a.count);
}

function getDates(userId, tagFilter) {
  let bookmarks = db
    .prepare('SELECT created_at, tags FROM bookmarks WHERE user_id = ?')
    .all(userId);

  if (tagFilter) {
    const tags = parseTags(tagFilter);
    bookmarks = bookmarks.filter((b) => tagsMatch(b.tags, tags));
  }

  const counts = {};
  for (const b of bookmarks) {
    const date = b.created_at.slice(0, 10);
    counts[date] = (counts[date] || 0) + 1;
  }

  return Object.entries(counts)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function suggestTags(userId, url) {
  const allTags = getTags(userId);
  const popular = allTags.slice(0, 10).map((t) => t.tag);
  const recommended = allTags
    .filter((t) => t.count >= 2)
    .slice(0, 10)
    .map((t) => t.tag);
  return { popular, recommended };
}

function renameTag(userId, oldTag, newTag) {
  const bookmarks = db
    .prepare('SELECT * FROM bookmarks WHERE user_id = ?')
    .all(userId);
  for (const b of bookmarks) {
    const tags = parseTags(b.tags);
    const idx = tags.findIndex((t) => t.toLowerCase() === oldTag.toLowerCase());
    if (idx === -1) continue;
    if (newTag) {
      tags[idx] = newTag;
    } else {
      tags.splice(idx, 1);
    }
    db.prepare('UPDATE bookmarks SET tags = ?, updated_at = ? WHERE id = ?')
      .run(tags.join(' '), nowIso(), b.id);
  }
}

function deleteTag(userId, tag) {
  renameTag(userId, tag, '');
}

function importFromJson(userId, data) {
  let posts = [];
  if (Array.isArray(data)) {
    posts = data;
  } else if (data.posts && Array.isArray(data.posts)) {
    posts = data.posts;
  } else if (data.bookmarks && Array.isArray(data.bookmarks)) {
    posts = data.bookmarks;
  }

  let imported = 0;
  let skipped = 0;

  const importOne = db.transaction((post) => {
    const url = post.href || post.url;
    if (!url) {
      skipped++;
      return;
    }
    const result = addBookmark(userId, {
      url,
      description: post.description || post.title || url,
      extended: post.extended || post.note || post.description_text || '',
      tags: post.tag || post.tags || '',
      dt: post.time || post.created_at || post.date,
      shared: post.shared,
      toread: post.toread,
      replace: 'yes',
    });
    if (result.ok) imported++;
    else skipped++;
  });

  for (const post of posts) {
    importOne(post);
  }

  return { imported, skipped, total: posts.length };
}

function countBookmarks(userId, filter = {}) {
  return listBookmarks(userId, { ...filter, sort: 'created_at', order: 'DESC' }).length;
}

function deleteAllBookmarks(userId) {
  const count = db.prepare('SELECT COUNT(*) as c FROM bookmarks WHERE user_id = ?').get(userId).c;
  db.prepare('DELETE FROM bookmarks WHERE user_id = ?').run(userId);
  emitWebhook('bookmarks.deleted_all', null);
  return count;
}

function updateUserSettings(userId, settings) {
  const fields = [];
  const values = [];
  if (settings.default_private !== undefined) {
    fields.push('default_private = ?');
    values.push(settings.default_private ? 1 : 0);
  }
  if (settings.privacy_lock !== undefined) {
    fields.push('privacy_lock = ?');
    values.push(settings.privacy_lock ? 1 : 0);
  }
  if (settings.username !== undefined) {
    fields.push('username = ?');
    values.push(settings.username);
  }
  if (fields.length === 0) return getDefaultUser();
  values.push(userId);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function regenerateApiToken(userId) {
  const token = crypto.randomBytes(8).toString('hex').toUpperCase();
  db.prepare('UPDATE users SET api_token = ? WHERE id = ?').run(token, userId);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function exportBookmarks(userId, format) {
  const bookmarks = listBookmarks(userId, { sort: 'created_at', order: 'ASC' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const posts = bookmarks.map(formatPost);

  if (format === 'json') {
    return {
      contentType: 'application/json',
      filename: 'pinbook-export.json',
      body: JSON.stringify({ posts }, null, 2),
    };
  }

  if (format === 'xml') {
    const postXml = posts
      .map(
        (p) =>
          `  <post href="${escapeXml(p.href)}" description="${escapeXml(p.description)}" extended="${escapeXml(p.extended)}" hash="${p.hash}" tag="${escapeXml(p.tag)}" time="${p.time}" shared="${p.shared}" toread="${p.toread}" />`
      )
      .join('\n');
    return {
      contentType: 'application/xml',
      filename: 'pinbook-export.xml',
      body: `<?xml version="1.0" encoding="UTF-8"?>\n<posts user="${escapeXml(user.username)}">\n${postXml}\n</posts>`,
    };
  }

  if (format === 'html' || format === 'netscape') {
    const items = bookmarks
      .map((b) => {
        const addDate = Math.floor(new Date(b.created_at).getTime() / 1000);
        const tags = escapeHtml(b.tags);
        const priv = b.shared ? '' : ' PRIVATE="1"';
        return `    <DT><A HREF="${escapeHtml(b.url)}" ADD_DATE="${addDate}" TAGS="${tags}"${priv}>${escapeHtml(b.description || b.url)}</A>`;
      })
      .join('\n');
    return {
      contentType: 'text/html',
      filename: 'pinbook-export.html',
      body: `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<!-- This is an automatically generated file.\n     It will be read and overwritten.\n     DO NOT EDIT! -->\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${items}\n</DL><p>`,
    };
  }

  return null;
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

initDb();

module.exports = {
  db,
  md5,
  bookmarkHash,
  nowIso,
  parseTags,
  getDefaultUser,
  getUserByToken,
  formatPost,
  listBookmarks,
  addBookmark,
  deleteBookmark,
  getBookmarkByHash,
  getOldestUnread,
  getRandomUnread,
  bulkUpdateBookmarks,
  getLastUpdate,
  getTags,
  getTagCloud,
  getDates,
  suggestTags,
  renameTag,
  deleteTag,
  importFromJson,
  countBookmarks,
  deleteAllBookmarks,
  updateUserSettings,
  regenerateApiToken,
  exportBookmarks,
};
