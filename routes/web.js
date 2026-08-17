const express = require('express');
const multer = require('multer');
const {
  getDefaultUser,
  listBookmarks,
  addBookmark,
  deleteBookmark,
  getTags,
  getTagCloud,
  countBookmarks,
  importFromJson,
  parseTags,
  nowIso,
  deleteAllBookmarks,
  updateUserSettings,
  regenerateApiToken,
  exportBookmarks,
} = require('../lib/db');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatWhen(iso) {
  const d = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function renderPage(res, { title, body, user, activeNav }) {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)} - Pinbook</title>
  <link rel="stylesheet" href="/css/pinboard.css?v=3">
</head>
<body>
  <div id="banner">
    <table id="banner_table" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td id="logo">
          <a href="/">pinbook</a>
          <span>/</span>
          <a href="/" class="banner_username">${escapeHtml(user.username)}</a>
        </td>
        <td id="top_menu">
          <a href="/">bookmarks</a><span class="menu_sep"> · </span><a href="/add/">add</a><span class="menu_sep"> · </span><a href="/settings/">settings</a><span class="menu_sep"> · </span><a href="/api/docs">api</a>
        </td>
      </tr>
    </table>
  </div>
  <div id="content">
    ${body}
  </div>
  <div id="footer">
    <p>Pinbook &mdash; local Pinboard clone</p>
  </div>
</body>
</html>`;
  res.send(html);
}

function renderSettingsPage(res, { title, tab, body, user }) {
  const tabs = [
    { key: 'account', label: 'account' },
    { key: 'privacy', label: 'privacy' },
    { key: 'import', label: 'import' },
    { key: 'export', label: 'export' },
    { key: 'api', label: 'password / api' },
    { key: 'danger', label: 'danger zone' },
  ];

  const sidebar = tabs
    .map((t) => {
      const cls = tab === t.key ? 'settings_nav_active' : 'settings_nav';
      return `<p><a class="${cls}" href="/settings/${t.key}/">${t.label}</a></p>`;
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)} - Pinbook</title>
  <link rel="stylesheet" href="/css/pinboard.css?v=3">
</head>
<body>
  <div id="banner">
    <table id="banner_table" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td id="logo">
          <a href="/">pinbook</a>
          <span>/</span>
          <a href="/" class="banner_username">${escapeHtml(user.username)}</a>
        </td>
        <td id="top_menu">
          <a href="/">bookmarks</a><span class="menu_sep"> · </span><a href="/add/">add</a><span class="menu_sep"> · </span><a href="/settings/">settings</a><span class="menu_sep"> · </span><a href="/api/docs">api</a>
        </td>
      </tr>
    </table>
  </div>
  <div id="content">
    <div id="settings_layout">
      <div id="settings_sidebar">
        <p class="settings_heading"><b>settings</b></p>
        ${sidebar}
      </div>
      <div id="settings_main">
        ${body}
      </div>
    </div>
  </div>
  <div id="footer">
    <p>Pinbook &mdash; local Pinboard clone</p>
  </div>
</body>
</html>`;
  res.send(html);
}

function renderBookmark(b, user) {
  const titleClass = [
    'bookmark_title',
    b.toread ? 'unread' : '',
  ].filter(Boolean).join(' ');

  const bookmarkClass = b.shared ? 'bookmark' : 'bookmark private';
  const tags = parseTags(b.tags)
    .map((t) => `<a class="tag" href="/?tag=${encodeURIComponent(t)}">${escapeHtml(t)}</a>`)
    .join(' ');

  const starClass = b.starred ? 'star selected_star' : 'star';
  const starChar = b.starred ? '&#9733;' : '&#9734;';

  return `
    <div class="${bookmarkClass}" id="bm_${b.id}">
      <a class="${starClass}" href="/star/?url=${encodeURIComponent(b.url)}" title="star">${starChar}</a>
      <div class="display">
        <a class="${titleClass}" href="${escapeHtml(b.url)}">${escapeHtml(b.description || b.url)}</a>
        <span class="url_display">${escapeHtml(b.url)}</span>
        ${b.extended ? `<div class="description">${escapeHtml(b.extended)}</div>` : ''}
        ${tags ? `<div class="tags">${tags}</div>` : ''}
      </div>
      <span class="when">${formatWhen(b.created_at)}</span>
      <span class="edit_links">
        <a class="edit" href="/edit/?url=${encodeURIComponent(b.url)}">edit</a>
        <a class="delete" href="/delete/?url=${encodeURIComponent(b.url)}">delete</a>
        ${b.toread ? `<a class="mark_read" href="/read/?url=${encodeURIComponent(b.url)}">mark read</a>` : ''}
      </span>
    </div>`;
}

function renderTagCloud(tags, activeTag, mode) {
  const modes = [
    { key: '20', label: '20+' },
    { key: '10', label: '10+' },
    { key: '5', label: '5+' },
    { key: '2', label: '2+' },
    { key: 'all', label: 'all tags' },
    { key: 'cloud', label: 'top tags' },
  ];

  const headerLinks = modes
    .map((m) => {
      const cls = mode === m.key ? 'tag_heading_selected' : 'tag';
      return `<a class="${cls}" href="/?tag_mode=${m.key}">${m.label}</a>`;
    })
    .join(' ');

  let filteredTags = tags;
  if (mode === '20') filteredTags = tags.filter((t) => t.count >= 20);
  else if (mode === '10') filteredTags = tags.filter((t) => t.count >= 10);
  else if (mode === '5') filteredTags = tags.filter((t) => t.count >= 5);
  else if (mode === '2') filteredTags = tags.filter((t) => t.count >= 2);
  else if (mode === 'cloud') filteredTags = [...tags].sort((a, b) => b.count - a.count).slice(0, 30);

  const tagLinks = filteredTags
    .map((t) => {
      const cls = activeTag === t.tag ? 'tag selected' : 'tag';
      return `<a class="${cls}" href="/?tag=${encodeURIComponent(t.tag)}">${escapeHtml(t.tag)}</a>`;
    })
    .join('\n');

  return `
    <div id="tag_cloud_header">
      <p>${headerLinks}</p>
    </div>
    <div id="tag_cloud" class="tag_table">
      <p>${tagLinks}</p>
    </div>`;
}

router.get('/', (req, res) => {
  const user = getDefaultUser();
  const filter = req.query.filter || 'all';
  const tag = req.query.tag;
  const tagMode = req.query.tag_mode || 'all';
  const sort = req.query.sort || 'created_at';
  const q = req.query.q;

  const options = {
    tags: tag ? [tag] : [],
    sort,
    order: sort === 'description' ? 'ASC' : 'DESC',
  };

  if (filter === 'private') options.shared = false;
  else if (filter === 'public') options.shared = true;
  else if (filter === 'unread') options.toread = true;
  else if (filter === 'untagged') options.untagged = true;

  let bookmarks = listBookmarks(user.id, options);

  if (user.privacy_lock && filter !== 'private') {
    bookmarks = bookmarks.filter((b) => b.shared);
  }

  if (q) {
    const lower = q.toLowerCase();
    bookmarks = bookmarks.filter(
      (b) =>
        b.description.toLowerCase().includes(lower) ||
        b.url.toLowerCase().includes(lower) ||
        b.extended.toLowerCase().includes(lower) ||
        b.tags.toLowerCase().includes(lower)
    );
  }

  const totalCount = countBookmarks(user.id);
  const tags = getTags(user.id);

  const filterLinks = [
    { key: 'all', label: 'all' },
    { key: 'private', label: 'private' },
    { key: 'public', label: 'public' },
    { key: 'unread', label: 'unread' },
    { key: 'untagged', label: 'untagged' },
  ]
    .map((f) => {
      const cls = filter === f.key ? 'filter active' : 'filter';
      return `<a class="${cls}" href="/?filter=${f.key}">${f.label}</a>`;
    })
    .join(' &middot; ');

  const heading = tag
    ? `<a style="font-size:140%" href="/?tag=${encodeURIComponent(tag)}">${escapeHtml(tag)}</a>`
    : `<span class="bookmark_count">${bookmarks.length}</span>`;

  const bookmarkHtml = bookmarks.map((b) => renderBookmark(b, user)).join('\n');

  const body = `
    <div id="main_column">
      <div class="user_navbar">
        <span class="small_username">${escapeHtml(user.username)}</span>
        <div class="bookmark_count_box">${heading}</div>
        <div class="source_filter">${filterLinks}</div>
        <div class="rss_linkbox"><a class="rss_link" href="/api/v1/posts/all?format=json">rss</a></div>
      </div>
      <p>
        <a class="edit" href="/add/">add bookmark</a>
        &nbsp;
        sort:
        <span id="sort_order_picker">
          <a href="/?sort=created_at&filter=${filter}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}">date</a>
          &middot;
          <a href="/?sort=description&filter=${filter}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}">title</a>
        </span>
      </p>
      ${bookmarkHtml || '<p>No bookmarks yet. <a href="/add/">Add one</a> or <a href="/import/">import from JSON</a>.</p>'}
      <div id="nextprev">
        <a id="bulk_edit" href="/settings/import/">import</a>
      </div>
    </div>
    <div id="right_bar">
      <form action="/" method="get">
        <input type="text" id="search_query_field" name="q" value="${escapeHtml(q || '')}" placeholder="search bookmarks">
        <input type="submit" class="search_button" value="search">
      </form>
      ${renderTagCloud(tags, tag, tagMode)}
      <p style="color:#888;margin-top:20px"><b>${totalCount}</b> total bookmarks</p>
    </div>`;

  const title = tag ? tag : `${bookmarks.length} bookmarks`;
  renderPage(res, { title, body, user });
});

router.get('/add/', (req, res) => {
  const user = getDefaultUser();
  const body = `
    <div id="main_column">
      <div id="popup_header">
        <div id="title"><a href="/">pinbook</a> / add bookmark</div>
      </div>
      <form id="edit_bookmark_form" action="/add/" method="post">
        <table><tbody><tr><td>
          <label>url</label><br>
          <input type="url" id="url" name="url" required value="${escapeHtml(req.query.url || '')}"><br><br>
          <label>title</label><br>
          <input type="text" name="title" value="${escapeHtml(req.query.title || '')}"><br><br>
          <label>description</label><br>
          <textarea name="description" rows="4"></textarea><br><br>
          <label>tags</label><br>
          <input type="text" name="tags" placeholder="space separated"><br><br>
          <label><input type="checkbox" name="private" value="yes"> private</label>
          &nbsp;
          <label><input type="checkbox" name="toread" value="yes"> read later</label><br><br>
          <input type="submit" value="save">
          <input type="button" class="reset" value="cancel" onclick="location.href='/'">
        </td></tr></tbody></table>
      </form>
    </div>`;
  renderPage(res, { title: 'Add Bookmark', body, user });
});

router.post('/add/', express.urlencoded({ extended: true }), (req, res) => {
  const user = getDefaultUser();
  addBookmark(user.id, {
    url: req.body.url,
    description: req.body.title || req.body.url,
    extended: req.body.description || '',
    tags: req.body.tags || '',
    shared: req.body.private === 'yes' ? 'no' : 'yes',
    toread: req.body.toread === 'yes' ? 'yes' : 'no',
  });
  res.redirect('/');
});

router.get('/edit/', (req, res) => {
  const user = getDefaultUser();
  const url = req.query.url;
  const bookmarks = listBookmarks(user.id, { url });
  const b = bookmarks[0];
  if (!b) return res.redirect('/');

  const body = `
    <div id="main_column">
      <div id="popup_header">
        <div id="title"><a href="/">pinbook</a> / edit bookmark</div>
      </div>
      <form id="edit_bookmark_form" action="/edit/" method="post">
        <input type="hidden" name="original_url" value="${escapeHtml(b.url)}">
        <table><tbody><tr><td>
          <label>url</label><br>
          <input type="url" id="url" name="url" required value="${escapeHtml(b.url)}"><br><br>
          <label>title</label><br>
          <input type="text" name="title" value="${escapeHtml(b.description)}"><br><br>
          <label>description</label><br>
          <textarea name="description" rows="4">${escapeHtml(b.extended)}</textarea><br><br>
          <label>tags</label><br>
          <input type="text" name="tags" value="${escapeHtml(b.tags)}"><br><br>
          <label><input type="checkbox" name="private" value="yes" ${!b.shared ? 'checked' : ''}> private</label>
          &nbsp;
          <label><input type="checkbox" name="toread" value="yes" ${b.toread ? 'checked' : ''}> read later</label><br><br>
          <input type="submit" value="save">
          <input type="button" class="reset" value="cancel" onclick="location.href='/'">
        </td></tr></tbody></table>
      </form>
    </div>`;
  renderPage(res, { title: 'Edit Bookmark', body, user });
});

router.post('/edit/', express.urlencoded({ extended: true }), (req, res) => {
  const user = getDefaultUser();
  if (req.body.original_url !== req.body.url) {
    deleteBookmark(user.id, req.body.original_url);
  }
  addBookmark(user.id, {
    url: req.body.url,
    description: req.body.title || req.body.url,
    extended: req.body.description || '',
    tags: req.body.tags || '',
    shared: req.body.private === 'yes' ? 'no' : 'yes',
    toread: req.body.toread === 'yes' ? 'yes' : 'no',
    replace: 'yes',
  });
  res.redirect('/');
});

router.get('/delete/', (req, res) => {
  const user = getDefaultUser();
  const url = req.query.url;
  if (req.query.confirm === 'yes') {
    deleteBookmark(user.id, url);
    return res.redirect('/');
  }

  const body = `
    <div id="main_column">
      <p class="confirm">Delete <a href="${escapeHtml(url)}">${escapeHtml(url)}</a>?
        <a class="destroy" href="/delete/?url=${encodeURIComponent(url)}&confirm=yes">yes</a>
        <a href="/">no</a>
      </p>
    </div>`;
  renderPage(res, { title: 'Delete', body, user: getDefaultUser() });
});

router.get('/read/', (req, res) => {
  const user = getDefaultUser();
  const bookmarks = listBookmarks(user.id, { url: req.query.url });
  const b = bookmarks[0];
  if (b) {
    addBookmark(user.id, {
      url: b.url,
      description: b.description,
      extended: b.extended,
      tags: b.tags,
      shared: b.shared ? 'yes' : 'no',
      toread: 'no',
      replace: 'yes',
    });
  }
  res.redirect(req.headers.referer || '/');
});

router.get('/star/', (req, res) => {
  const user = getDefaultUser();
  const bookmarks = listBookmarks(user.id, { url: req.query.url });
  const b = bookmarks[0];
  if (b) {
    const { db } = require('../lib/db');
    db.prepare('UPDATE bookmarks SET starred = ?, updated_at = ? WHERE id = ?')
      .run(b.starred ? 0 : 1, nowIso(), b.id);
  }
  res.redirect(req.headers.referer || '/');
});

router.get('/import/', (req, res) => res.redirect('/settings/import/'));

router.post('/import/', upload.single('file'), express.urlencoded({ extended: true, limit: '50mb' }), (req, res) => {
  const user = getDefaultUser();
  let data;
  try {
    if (req.file) {
      data = JSON.parse(req.file.buffer.toString('utf8'));
    } else if (req.body.json) {
      data = JSON.parse(req.body.json);
    } else {
      return res.status(400).send('No JSON provided');
    }
  } catch (e) {
    return res.status(400).send('Invalid JSON: ' + e.message);
  }
  const result = importFromJson(user.id, data);
  res.redirect(`/settings/import/?imported=${result.imported}&skipped=${result.skipped}`);
});

router.get('/settings/', (req, res) => res.redirect('/settings/account/'));

router.get('/settings/account/', (req, res) => {
  const user = getDefaultUser();
  const total = countBookmarks(user.id);
  const body = `
    <p><b>Account</b></p>
    <table class="settings_table">
      <tr><td class="settings_label">username</td><td>${escapeHtml(user.username)}</td></tr>
      <tr><td class="settings_label">bookmarks</td><td>${total}</td></tr>
      <tr><td class="settings_label">member since</td><td>${formatWhen(user.created_at)}</td></tr>
    </table>
    <form class="settings_form" action="/settings/account/" method="post" style="margin-top:20px">
      <p><label>change username</label><br>
      <input type="text" name="username" value="${escapeHtml(user.username)}" maxlength="50"></p>
      <p><input type="submit" value="save"></p>
    </form>`;
  renderSettingsPage(res, { title: 'Account', tab: 'account', body, user });
});

router.post('/settings/account/', express.urlencoded({ extended: true }), (req, res) => {
  const user = getDefaultUser();
  const username = (req.body.username || '').trim();
  if (username) {
    try {
      updateUserSettings(user.id, { username });
    } catch (e) {
      // username taken
    }
  }
  res.redirect('/settings/account/');
});

router.get('/settings/privacy/', (req, res) => {
  const user = getDefaultUser();
  const body = `
    <p><b>Privacy</b></p>
    <p>Control the default visibility of your bookmarks.</p>
    <form class="settings_form" action="/settings/privacy/" method="post">
      <p>
        <label>
          <input type="checkbox" name="default_private" value="yes" ${user.default_private ? 'checked' : ''}>
          Save all new bookmarks as private by default
        </label>
      </p>
      <p>
        <label>
          <input type="checkbox" name="privacy_lock" value="yes" ${user.privacy_lock ? 'checked' : ''}>
          Privacy lock &mdash; hide private bookmarks from the web interface
        </label>
      </p>
      <p><input type="submit" value="save"></p>
    </form>`;
  renderSettingsPage(res, { title: 'Privacy', tab: 'privacy', body, user });
});

router.post('/settings/privacy/', express.urlencoded({ extended: true }), (req, res) => {
  const user = getDefaultUser();
  updateUserSettings(user.id, {
    default_private: req.body.default_private === 'yes',
    privacy_lock: req.body.privacy_lock === 'yes',
  });
  res.redirect('/settings/privacy/');
});

router.get('/settings/import/', (req, res) => {
  const user = getDefaultUser();
  const imported = req.query.imported;
  const skipped = req.query.skipped;
  const notice = imported
    ? `<p class="settings_notice">Imported ${escapeHtml(imported)} bookmarks${skipped ? ` (${escapeHtml(skipped)} skipped)` : ''}.</p>`
    : '';

  const body = `
    <p><b>Import Bookmarks</b></p>
    <p>Import your existing bookmarks from a JSON file. Pinboard export format and plain arrays are supported. Tags are preserved; private bookmarks stay private.</p>
    ${notice}
    <form class="settings_form" action="/settings/import/" method="post" enctype="multipart/form-data">
      <p><label>choose file</label><br>
      <input type="file" name="file" accept=".json,application/json"></p>
      <p><label>or paste JSON</label><br>
      <textarea name="json" rows="12" placeholder='{"posts": [{"href": "...", "description": "...", "tag": "..."}]}'></textarea></p>
      <p><input type="submit" value="import"></p>
    </form>
    <p><a href="/sample/bookmarks.json">download sample JSON</a></p>`;
  renderSettingsPage(res, { title: 'Import', tab: 'import', body, user });
});

router.post('/settings/import/', upload.single('file'), express.urlencoded({ extended: true, limit: '50mb' }), (req, res) => {
  const user = getDefaultUser();
  let data;
  try {
    if (req.file) {
      data = JSON.parse(req.file.buffer.toString('utf8'));
    } else if (req.body.json) {
      data = JSON.parse(req.body.json);
    } else {
      return res.status(400).send('No JSON provided');
    }
  } catch (e) {
    return res.status(400).send('Invalid JSON: ' + e.message);
  }

  const result = importFromJson(user.id, data);
  res.redirect(`/settings/import/?imported=${result.imported}&skipped=${result.skipped}`);
});

router.get('/settings/export/', (req, res) => {
  if (req.query.format) {
    const user = getDefaultUser();
    const exported = exportBookmarks(user.id, req.query.format);
    if (!exported) return res.status(400).send('Unknown format');
    res.setHeader('Content-Type', exported.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    return res.send(exported.body);
  }

  const user = getDefaultUser();
  const total = countBookmarks(user.id);
  const body = `
    <p><b>Export Bookmarks</b></p>
    <p>Download a copy of all ${total} bookmarks. You can also export using the API for automated backups.</p>
    <form class="settings_form" action="/settings/export/" method="get">
      <p><label>format</label><br>
      <select name="format">
        <option value="json">JSON (Pinboard format)</option>
        <option value="xml">XML (Pinboard format)</option>
        <option value="html">Netscape Bookmarks (HTML)</option>
      </select></p>
      <p><input type="submit" value="export"></p>
    </form>
    <p style="margin-top:20px;color:#888">API export:</p>
    <pre>curl "http://localhost:3000/api/v1/export?auth_token=${escapeHtml(user.username)}:${escapeHtml(user.api_token)}&format=json" -o pinbook-backup.json</pre>`;
  renderSettingsPage(res, { title: 'Export', tab: 'export', body, user });
});

router.get('/settings/api/', (req, res) => {
  const user = getDefaultUser();
  const body = `
    <p><b>Password / API</b></p>
    <p>Your API token lets you access Pinbook programmatically. Treat it like a password.</p>
    <table class="settings_table">
      <tr><td class="settings_label">API token</td><td><code>${escapeHtml(user.api_token)}</code></td></tr>
      <tr><td class="settings_label">auth token</td><td><code>${escapeHtml(user.username)}:${escapeHtml(user.api_token)}</code></td></tr>
      <tr><td class="settings_label">secret key</td><td><code>${escapeHtml(user.secret_key)}</code></td></tr>
    </table>
    <form class="settings_form" action="/settings/api/regenerate" method="post" style="margin-top:20px" onsubmit="return confirm('Regenerate API token? Existing integrations will stop working.')">
      <p><input type="submit" class="reset" value="regenerate api token"></p>
    </form>
    <p style="margin-top:20px">Example:</p>
    <pre>curl "http://localhost:3000/api/v1/posts/all?auth_token=${escapeHtml(user.username)}:${escapeHtml(user.api_token)}&format=json"</pre>
    <p><a href="/api/docs">full API documentation</a></p>`;
  renderSettingsPage(res, { title: 'API', tab: 'api', body, user });
});

router.post('/settings/api/regenerate', express.urlencoded({ extended: true }), (req, res) => {
  const user = getDefaultUser();
  regenerateApiToken(user.id);
  res.redirect('/settings/api/');
});

router.get('/settings/danger/', (req, res) => {
  const user = getDefaultUser();
  const total = countBookmarks(user.id);
  const deleted = req.query.deleted ? '<p class="settings_notice">All bookmarks have been deleted.</p>' : '';
  const body = `
    <p><b>Danger Zone</b></p>
    ${deleted}
    <p class="settings_warning">These actions are permanent and cannot be undone.</p>
    <div class="settings_danger_box">
      <p><b>Delete all bookmarks</b></p>
      <p>Permanently remove all ${total} bookmarks from your account. Tags will also be cleared.</p>
      ${total > 0 ? `
      <form class="settings_form" action="/settings/danger/delete-all" method="post" onsubmit="return confirm('Delete ALL ${total} bookmarks? This cannot be undone.')">
        <p><label>Type <b>DELETE</b> to confirm:</label><br>
        <input type="text" name="confirm" autocomplete="off" required pattern="DELETE" title="Type DELETE to confirm"></p>
        <p><input type="submit" class="reset" value="delete all bookmarks"></p>
      </form>` : '<p><i>No bookmarks to delete.</i></p>'}
    </div>`;
  renderSettingsPage(res, { title: 'Danger Zone', tab: 'danger', body, user });
});

router.post('/settings/danger/delete-all', express.urlencoded({ extended: true }), (req, res) => {
  const user = getDefaultUser();
  if (req.body.confirm !== 'DELETE') {
    return res.redirect('/settings/danger/?error=confirm');
  }
  deleteAllBookmarks(user.id);
  res.redirect('/settings/danger/?deleted=1');
});

router.get('/api/docs', (req, res) => {
  const user = getDefaultUser();
  const body = `
    <div id="main_column">
      <p><b>API Documentation</b></p>
      <p>Pinbook implements the <a href="https://pinboard.in/api/">Pinboard API v1</a> for drop-in compatibility with existing tools.</p>
      <h3>Pinboard-compatible endpoints (GET)</h3>
      <ul>
        <li><code>/api/v1/posts/update</code> — last update time</li>
        <li><code>/api/v1/posts/add?url=&amp;description=&amp;tags=</code> — add bookmark</li>
        <li><code>/api/v1/posts/delete?url=</code> — delete bookmark</li>
        <li><code>/api/v1/posts/get?url=</code> — get bookmark(s)</li>
        <li><code>/api/v1/posts/recent</code> — recent bookmarks</li>
        <li><code>/api/v1/posts/all</code> — all bookmarks</li>
        <li><code>/api/v1/posts/dates</code> — dates with counts</li>
        <li><code>/api/v1/posts/suggest?url=</code> — tag suggestions</li>
        <li><code>/api/v1/tags/get</code> — all tags</li>
        <li><code>/api/v1/user/api_token</code> — your API token</li>
      </ul>
      <p>Add <code>?format=json</code> for JSON responses. Authenticate with <code>?auth_token=username:TOKEN</code> or HTTP Basic Auth.</p>
      <h3>Modern REST API (JSON)</h3>
      <ul>
        <li><code>GET /api/v1/bookmarks</code> — list bookmarks</li>
        <li><code>POST /api/v1/bookmarks</code> — create bookmark (JSON body)</li>
        <li><code>DELETE /api/v1/bookmarks?url=</code> — delete bookmark</li>
        <li><code>POST /api/v1/import</code> — bulk import JSON</li>
        <li><code>GET /api/v1/export?format=json|xml|html</code> — export all bookmarks</li>
        <li><code>DELETE /api/v1/bookmarks/all</code> — delete all bookmarks</li>
      </ul>
      <h3>Integration alternatives</h3>
      <ul>
        <li><b>Webhooks</b> — set <code>PINBOOK_WEBHOOK_URL</code> to receive POST events on bookmark changes</li>
        <li><b>SQLite direct</b> — read <code>data/pinbook.db</code> directly for zero-latency local access</li>
        <li><b>RSS/JSON feed</b> — <code>/api/v1/posts/all?format=json</code> polled on interval</li>
      </ul>
      <p>Your token: <code>${escapeHtml(user.username)}:${escapeHtml(user.api_token)}</code></p>
    </div>`;
  renderPage(res, { title: 'API Docs', body, user });
});

router.get('/sample/bookmarks.json', (req, res) => {
  res.sendFile(require('path').join(__dirname, '..', 'sample', 'bookmarks.json'));
});

module.exports = router;
