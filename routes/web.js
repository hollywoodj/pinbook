const express = require('express');
const multer = require('multer');
const {
  getDefaultUser,
  listBookmarks,
  addBookmark,
  deleteBookmark,
  getTags,
  countBookmarks,
  importFromJson,
  parseTags,
  nowIso,
  deleteAllBookmarks,
  updateUserSettings,
  regenerateApiToken,
  exportBookmarks,
  getBookmarkByHash,
  getOldestUnread,
  getRandomUnread,
  bulkUpdateBookmarks,
} = require('../lib/db');

const PER_PAGE = 25;

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
  if (Number.isNaN(d.getTime())) return '';
  const diff = Math.max(0, Date.now() - d.getTime());
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function formatWhenTitle(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function displayUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    let path = u.pathname === '/' ? '' : u.pathname;
    if (path.length > 28) path = `${path.slice(0, 26)}…`;
    const shown = host + path;
    return shown.length > 52 ? `${shown.slice(0, 50)}…` : shown;
  } catch {
    return String(url).replace(/^https?:\/\//, '').replace(/^www\./, '');
  }
}

function parseTagQuery(tag) {
  if (!tag) return [];
  const raw = Array.isArray(tag) ? tag.join(' ') : String(tag);
  return raw.split(/[+\s,]+/).filter(Boolean).slice(0, 3);
}

function buildQuery(state, overrides = {}) {
  const merged = { ...state, ...overrides };
  const params = new URLSearchParams();
  if (merged.filter && merged.filter !== 'all') params.set('filter', merged.filter);
  if (merged.tags && merged.tags.length) params.set('tag', merged.tags.join(' '));
  if (merged.tagMode && merged.tagMode !== 'all') params.set('tag_mode', merged.tagMode);
  if (merged.sort && merged.sort !== 'created_at') params.set('sort', merged.sort);
  if (merged.q) params.set('q', merged.q);
  if (merged.page && Number(merged.page) > 1) params.set('page', String(merged.page));
  if (merged.bulk) params.set('bulk', '1');
  const qs = params.toString();
  return qs ? `/?${qs}` : '/';
}

function renderBanner(user, activeNav) {
  const lock = user.privacy_lock
    ? ' <span id="privacy_lock" title="privacy lock is on">&#128274;</span>'
    : '';
  const item = (href, key, label) => {
    const cls = activeNav === key ? ' class="nav_active"' : '';
    return `<a href="${href}"${cls}>${label}</a>`;
  };
  return `
  <div id="banner">
    <table id="banner_table" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td id="logo">
          <a href="/">pinbook</a>
          <span>/</span>
          <a href="/" class="banner_username">${escapeHtml(user.username)}</a>${lock}
        </td>
        <td id="top_menu">
          ${item('/', 'bookmarks', 'bookmarks')}<span class="menu_sep"> · </span>${item('/add/', 'add', 'add')}<span class="menu_sep"> · </span>${item('/tools/', 'tools', 'tools')}<span class="menu_sep"> · </span>${item('/settings/', 'settings', 'settings')}<span class="menu_sep"> · </span>${item('/api/docs', 'api', 'api')}
        </td>
      </tr>
    </table>
  </div>`;
}

function renderPage(res, { title, body, user, activeNav, compact }) {
  if (compact) {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)} - Pinbook</title>
  <link rel="stylesheet" href="/css/pinboard.css?v=5">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body class="popup${user.privacy_lock ? ' privacy_lock' : ''}">
  <div id="content">
    ${body}
  </div>
  <script src="/js/pinboard.js?v=2"></script>
</body>
</html>`;
    return res.send(html);
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)} - Pinbook</title>
  <link rel="stylesheet" href="/css/pinboard.css?v=5">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body${user.privacy_lock ? ' class="privacy_lock"' : ''}>
  ${renderBanner(user, activeNav)}
  <div id="content">
    ${body}
  </div>
  <div id="footer">
    <p>Pinbook &mdash; local Pinboard clone</p>
  </div>
  <script src="/js/pinboard.js?v=2"></script>
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
  <link rel="stylesheet" href="/css/pinboard.css?v=5">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body${user.privacy_lock ? ' class="privacy_lock"' : ''}>
  ${renderBanner(user, 'settings')}
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
  <script src="/js/pinboard.js?v=2"></script>
</body>
</html>`;
  res.send(html);
}

function renderBookmark(b, ctx) {
  const titleClass = ['bookmark_title', b.toread ? 'unread' : ''].filter(Boolean).join(' ');
  const bookmarkClass = b.shared ? 'bookmark' : 'bookmark private';
  const activeTags = ctx.tags || [];

  const tags = parseTags(b.tags)
    .map((t) => {
      const selected = activeTags.some((a) => a.toLowerCase() === t.toLowerCase());
      const nextTags = selected
        ? activeTags.filter((a) => a.toLowerCase() !== t.toLowerCase())
        : [...activeTags, t].slice(0, 3);
      const cls = [
        'tag',
        selected ? 'selected' : '',
        t.startsWith('.') ? 'private_tag' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<a class="${cls}" href="${buildQuery(ctx, { tags: nextTags, page: 1 })}">${escapeHtml(t)}</a>`;
    })
    .join(' ');

  const starClass = b.starred ? 'star selected_star' : 'star';
  const starChar = b.starred ? '&#9733;' : '&#9734;';
  const checkbox = ctx.bulk
    ? `<input type="checkbox" class="bookmark_checkbox" name="hash" value="${escapeHtml(b.hash)}">`
    : '';

  return `
    <div class="${bookmarkClass}" id="bm_${escapeHtml(b.hash)}" data-url="${escapeHtml(b.url)}">
      ${checkbox}
      <a class="${starClass}" href="/star/?url=${encodeURIComponent(b.url)}" title="star">${starChar}</a>
      <div class="display">
        <a class="${titleClass}" href="${escapeHtml(b.url)}">${escapeHtml(b.description || b.url)}</a>
        <a class="url_display" href="${escapeHtml(b.url)}">${escapeHtml(displayUrl(b.url))}</a>
        ${b.extended ? `<div class="description">${escapeHtml(b.extended)}</div>` : ''}
        ${tags ? `<div class="tags">${tags}</div>` : ''}
      </div>
      <a class="when" title="${escapeHtml(formatWhenTitle(b.created_at))}" href="/b/${encodeURIComponent(b.hash)}/">${formatWhen(b.created_at)}</a>
      <span class="edit_links">
        <a class="copy_link" href="${escapeHtml(b.url)}" data-url="${escapeHtml(b.url)}">copy</a>
        <a class="edit" href="/edit/?url=${encodeURIComponent(b.url)}">edit</a>
        <a class="delete" href="/delete/?url=${encodeURIComponent(b.url)}">delete</a>
        ${b.toread ? `<a class="mark_read" href="/read/?url=${encodeURIComponent(b.url)}">mark as read</a>` : ''}
      </span>
    </div>`;
}

function renderTagCloud(allTags, ctx) {
  const mode = ctx.tagMode || 'all';
  const isCloud = mode === 'cloud';
  const minMap = { '20': 20, '10': 10, '5': 5, '2': 2 };
  const minCount = minMap[mode] || 0;

  const countModes = [
    { key: '20', label: '20+' },
    { key: '10', label: '10+' },
    { key: '5', label: '5+' },
    { key: '2', label: '2+' },
    { key: 'all', label: 'all tags' },
  ];

  const countLinks = countModes
    .map((m) => {
      const selected = !isCloud && mode === m.key;
      const cls = selected ? ' class="tag_heading_selected"' : '';
      return `<a${cls} href="${buildQuery(ctx, { tagMode: m.key })}">${m.label}</a>`;
    })
    .join(' ');

  const viewLinks = [
    { key: 'cloud', label: 'cloud' },
    { key: mode === 'cloud' ? 'all' : mode, label: 'list', selected: !isCloud },
  ]
    .map((m) => {
      const selected = m.label === 'cloud' ? isCloud : !isCloud;
      const cls = selected ? ' class="tag_heading_selected"' : '';
      return `<a${cls} href="${buildQuery(ctx, { tagMode: m.key })}">${m.label}</a>`;
    })
    .join(' ');

  let filtered = allTags;
  if (isCloud) {
    filtered = [...allTags].sort((a, b) => b.count - a.count).slice(0, 200);
  } else if (minCount) {
    filtered = allTags.filter((t) => t.count >= minCount);
  }

  const max = filtered.reduce((m, t) => Math.max(m, t.count), 1);
  const min = filtered.reduce((m, t) => Math.min(m, t.count), max);

  const tagAnchor = (t) => {
    const selected = ctx.tags.some((a) => a.toLowerCase() === t.tag.toLowerCase());
    const nextTags = selected
      ? ctx.tags.filter((a) => a.toLowerCase() !== t.tag.toLowerCase())
      : [...ctx.tags, t.tag].slice(0, 3);
    const cls = [
      'tag',
      selected ? 'selected' : '',
      t.tag.startsWith('.') ? 'private_tag' : '',
    ]
      .filter(Boolean)
      .join(' ');
    let style = '';
    if (isCloud) {
      const ratio = max === min ? 0.5 : (t.count - min) / (max - min);
      const size = Math.round(12 + ratio * 16);
      style = ` style="font-size:${size}px"`;
    }
    return `<a class="${cls}" href="${buildQuery(ctx, { tags: nextTags, page: 1 })}"${style}>${escapeHtml(t.tag)}</a>`;
  };

  let cloudBody;
  if (isCloud) {
    cloudBody = `<p>${filtered.map(tagAnchor).join('\n')}</p>`;
  } else {
    const mid = Math.ceil(filtered.length / 2);
    const col = (items) =>
      items
        .map(
          (t) =>
            `${tagAnchor(t)} <span class="tag_count">${t.count}</span><br>`
        )
        .join('\n');
    cloudBody = `
      <div class="tag_table">${col(filtered.slice(0, mid))}</div>
      <div class="tag_table">${col(filtered.slice(mid))}</div>`;
  }

  return `
    <div id="tag_cloud_header">
      <p>${countLinks}</p>
      <p>${viewLinks}</p>
    </div>
    <div id="tag_cloud" class="${isCloud ? 'tag_cloud_view' : 'tag_list_view'}">
      ${cloudBody}
    </div>`;
}

function listOptionsFromState(state) {
  const options = {
    tags: state.tags,
    sort: state.sort,
    order: state.sort === 'description' ? 'ASC' : 'DESC',
  };
  if (state.filter === 'private') options.shared = false;
  else if (state.filter === 'public') options.shared = true;
  else if (state.filter === 'unread') options.toread = true;
  else if (state.filter === 'untagged') options.untagged = true;
  else if (state.filter === 'starred') options.starred = true;
  return options;
}

function applySearch(bookmarks, q) {
  if (!q) return bookmarks;
  const lower = q.toLowerCase();
  return bookmarks.filter(
    (b) =>
      (b.description || '').toLowerCase().includes(lower) ||
      (b.url || '').toLowerCase().includes(lower) ||
      (b.extended || '').toLowerCase().includes(lower) ||
      (b.tags || '').toLowerCase().includes(lower)
  );
}

function parseListState(req) {
  return {
    filter: req.query.filter || 'all',
    tags: parseTagQuery(req.query.tag),
    tagMode: req.query.tag_mode || 'all',
    sort: req.query.sort || 'created_at',
    q: req.query.q || '',
    page: Math.max(1, parseInt(req.query.page, 10) || 1),
    bulk: req.query.bulk === '1',
  };
}

router.get('/', (req, res) => {
  const user = getDefaultUser();
  const state = parseListState(req);
  const options = listOptionsFromState(state);

  let bookmarks = listBookmarks(user.id, options);

  if (user.privacy_lock && state.filter !== 'private') {
    bookmarks = bookmarks.filter((b) => b.shared);
  }

  bookmarks = applySearch(bookmarks, state.q);

  const filteredCount = bookmarks.length;
  const totalCount = countBookmarks(user.id);
  const totalPages = Math.max(1, Math.ceil(filteredCount / PER_PAGE));
  const page = Math.min(state.page, totalPages);
  const pageItems = bookmarks.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const tags = getTags(user.id);
  const ctx = { ...state, page };

  const filterLinks = [
    { key: 'all', label: 'all' },
    { key: 'private', label: 'private' },
    { key: 'public', label: 'public' },
    { key: 'unread', label: 'unread' },
    { key: 'starred', label: 'starred' },
    { key: 'untagged', label: 'untagged' },
  ]
    .map((f) => {
      const cls = state.filter === f.key ? 'filter active' : 'filter';
      return `<a class="${cls}" href="${buildQuery(ctx, { filter: f.key, page: 1 })}">${f.label}</a>`;
    })
    .join(' &middot; ');

  let heading;
  if (state.q) {
    heading = `<span class="search_heading">search: ${escapeHtml(state.q)}</span>`;
  } else if (state.tags.length) {
    heading = state.tags
      .map(
        (t) =>
          `<a class="tag_heading" href="${buildQuery(ctx, { tags: [t], page: 1 })}">${escapeHtml(t)}</a>`
      )
      .join(' + ');
  } else {
    heading = `<span class="bookmark_count">${filteredCount}</span>`;
  }

  const bookmarkHtml = pageItems.map((b) => renderBookmark(b, ctx)).join('\n');
  const rssHref = `/rss/${buildQuery(ctx, { bulk: false, page: 1 }).replace(/^\//, '')}`;

  const laterLink =
    page > 1
      ? `<a class="next_prev" href="${buildQuery(ctx, { page: page - 1 })}">&larr; later</a>`
      : '';
  const earlierLink =
    page < totalPages
      ? `<a class="next_prev" href="${buildQuery(ctx, { page: page + 1 })}">earlier &rarr;</a>`
      : '';

  const bulkBar = state.bulk
    ? `<div id="bulk_bar">
        select:
        <a href="#" id="select_all">all</a> &middot;
        <a href="#" id="select_page">this page</a> &middot;
        <a href="#" id="select_none">none</a>
        <input type="hidden" name="scope" id="bulk_scope" value="page">
        <input type="hidden" name="filter" value="${escapeHtml(state.filter)}">
        <input type="hidden" name="tag" value="${escapeHtml(state.tags.join(' '))}">
        <input type="hidden" name="q" value="${escapeHtml(state.q)}">
        <input type="hidden" name="sort" value="${escapeHtml(state.sort)}">
        <input type="hidden" name="return_to" value="${escapeHtml(buildQuery(ctx))}">
        <p>
          <input type="text" name="new_tag" placeholder="tag" size="14">
          <input type="submit" name="action" value="add tag">
          <input type="submit" name="action" value="remove tag">
        </p>
        <p>
          <input type="submit" name="action" value="make private">
          <input type="submit" name="action" value="make public">
          <input type="submit" name="action" value="mark as read">
          <input type="submit" class="reset" name="action" value="delete">
        </p>
      </div>`
    : '';

  const empty = '<p>No bookmarks yet. <a href="/add/">Add one</a> or <a href="/settings/import/">import from JSON</a>.</p>';

  const body = `
    <div id="main_column">
      <div class="user_navbar">
        <span class="small_username">${escapeHtml(user.username)}</span>
        <div class="bookmark_count_box">${heading}</div>
        <div class="source_filter">${filterLinks}</div>
        <div class="rss_linkbox"><a class="rss_link" href="${rssHref}">rss</a></div>
      </div>
      <p>
        <a class="edit" href="/add/">add bookmark</a>
        &nbsp;
        sort:
        <span id="sort_order_picker">
          <a${state.sort === 'created_at' ? ' class="sort_selected"' : ''} href="${buildQuery(ctx, { sort: 'created_at', page: 1 })}">date</a>
          &middot;
          <a${state.sort === 'description' ? ' class="sort_selected"' : ''} href="${buildQuery(ctx, { sort: 'description', page: 1 })}">title</a>
        </span>
        &nbsp;
        <a class="edit" id="bulk_edit" href="${buildQuery(ctx, { bulk: !state.bulk, page: state.bulk ? 1 : page })}">${state.bulk ? 'done' : 'edit'}</a>
      </p>
      <form id="bulk_form" action="/bulk/" method="post">
        ${bulkBar}
        <div id="bookmarks"${state.bulk ? ' class="bulk_mode"' : ''}>
          ${bookmarkHtml || empty}
        </div>
      </form>
      <div id="nextprev">
        ${laterLink}${laterLink && earlierLink ? '&nbsp;&nbsp;' : ''}${earlierLink}
      </div>
    </div>
    <div id="right_bar">
      <form action="/" method="get">
        ${state.filter !== 'all' ? `<input type="hidden" name="filter" value="${escapeHtml(state.filter)}">` : ''}
        ${state.tags.length ? `<input type="hidden" name="tag" value="${escapeHtml(state.tags.join(' '))}">` : ''}
        ${state.tagMode !== 'all' ? `<input type="hidden" name="tag_mode" value="${escapeHtml(state.tagMode)}">` : ''}
        ${state.sort !== 'created_at' ? `<input type="hidden" name="sort" value="${escapeHtml(state.sort)}">` : ''}
        <input type="text" id="search_query_field" name="q" value="${escapeHtml(state.q)}" placeholder="search bookmarks">
        <input type="submit" class="search_button" value="search">
      </form>
      ${renderTagCloud(tags, ctx)}
      <p style="color:#888;margin-top:20px"><b>${totalCount}</b> total bookmarks</p>
    </div>`;

  const title = state.q
    ? `search: ${state.q}`
    : state.tags.length
      ? state.tags.join(' + ')
      : `${filteredCount} bookmarks`;
  renderPage(res, { title, body, user, activeNav: 'bookmarks' });
});

router.get('/add/', (req, res) => {
  const user = getDefaultUser();
  const tags = getTags(user.id);
  const suggested = tags
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 16)
    .map(
      (t) =>
        `<a class="tag suggest_tag" href="#" data-tag="${escapeHtml(t.tag)}">${escapeHtml(t.tag)}</a>`
    )
    .join(' ');
  const defaultPrivate = user.privacy_lock || user.default_private;
  const showPrivate = !user.privacy_lock;
  const toread = req.query.toread === 'yes' || req.query.toread === '1';
  const popup = req.query.popup === '1';

  const body = `
    <div id="main_column">
      <div id="popup_header">
        <div id="title"><a href="/">pinbook</a> / add bookmark</div>
      </div>
      <form id="edit_bookmark_form" action="/add/" method="post">
        ${popup ? '<input type="hidden" name="popup" value="1">' : ''}
        <table><tbody><tr><td>
          <label>url</label><br>
          <input type="url" id="url" name="url" required value="${escapeHtml(req.query.url || '')}"><br><br>
          <label>title</label><br>
          <input type="text" name="title" id="title_field" value="${escapeHtml(req.query.title || '')}">
          <a href="#" id="fetch_title">fetch title</a><br><br>
          <label>tags</label><br>
          <input type="text" name="tags" id="tags_field" placeholder="space separated" value="${escapeHtml(req.query.tags || '')}"><br>
          ${suggested ? `<div id="suggested_tags">${suggested}</div>` : ''}<br>
          <label>description</label><br>
          <textarea name="description" rows="4">${escapeHtml(req.query.description || '')}</textarea><br><br>
          ${showPrivate ? `<label><input type="checkbox" name="private" value="yes" ${defaultPrivate ? 'checked' : ''}> private</label>` : '<input type="hidden" name="private" value="yes">'}
          &nbsp;
          <label><input type="checkbox" name="toread" value="yes" ${toread ? 'checked' : ''}> to read</label><br><br>
          <input type="submit" value="save">
          <input type="button" class="reset" value="cancel" onclick="location.href='/'">
        </td></tr></tbody></table>
      </form>
    </div>`;
  renderPage(res, { title: 'Add Bookmark', body, user, activeNav: 'add', compact: popup });
});

router.post('/add/', express.urlencoded({ extended: true }), (req, res) => {
  const user = getDefaultUser();
  addBookmark(user.id, {
    url: req.body.url,
    description: req.body.title || req.body.url,
    extended: req.body.description || '',
    tags: req.body.tags || '',
    shared: (req.body.private === 'yes' || user.privacy_lock) ? 'no' : 'yes',
    toread: req.body.toread === 'yes' ? 'yes' : 'no',
  });
  if (req.body.popup === '1') {
    return res.send(
      `<!DOCTYPE html><html><body><p>saved.</p><script>window.close();setTimeout(function(){location.href='/'},400);</script></body></html>`
    );
  }
  res.redirect('/');
});

router.get('/edit/', (req, res) => {
  const user = getDefaultUser();
  const url = req.query.url;
  const bookmarks = listBookmarks(user.id, { url });
  const b = bookmarks[0];
  if (!b) return res.redirect('/');
  const tags = getTags(user.id);
  const suggested = tags
    .slice()
    .sort((a, b2) => b2.count - a.count)
    .slice(0, 16)
    .map(
      (t) =>
        `<a class="tag suggest_tag" href="#" data-tag="${escapeHtml(t.tag)}">${escapeHtml(t.tag)}</a>`
    )
    .join(' ');
  const showPrivate = !user.privacy_lock;

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
          <input type="text" name="title" id="title_field" value="${escapeHtml(b.description)}">
          <a href="#" id="fetch_title">fetch title</a><br><br>
          <label>tags</label><br>
          <input type="text" name="tags" id="tags_field" value="${escapeHtml(b.tags)}"><br>
          ${suggested ? `<div id="suggested_tags">${suggested}</div>` : ''}<br>
          <label>description</label><br>
          <textarea name="description" rows="4">${escapeHtml(b.extended)}</textarea><br><br>
          ${showPrivate ? `<label><input type="checkbox" name="private" value="yes" ${!b.shared ? 'checked' : ''}> private</label>` : '<input type="hidden" name="private" value="yes">'}
          &nbsp;
          <label><input type="checkbox" name="toread" value="yes" ${b.toread ? 'checked' : ''}> to read</label><br><br>
          <input type="submit" value="save">
          <input type="button" class="reset" value="cancel" onclick="location.href='/'">
        </td></tr></tbody></table>
      </form>
    </div>`;
  renderPage(res, { title: 'Edit Bookmark', body, user });
});

router.post('/edit/', express.urlencoded({ extended: true }), (req, res) => {
  const user = getDefaultUser();
  const existing = listBookmarks(user.id, { url: req.body.original_url })[0];
  if (req.body.original_url !== req.body.url) {
    deleteBookmark(user.id, req.body.original_url);
  }
  addBookmark(user.id, {
    url: req.body.url,
    description: req.body.title || req.body.url,
    extended: req.body.description || '',
    tags: req.body.tags || '',
    shared: (req.body.private === 'yes' || user.privacy_lock) ? 'no' : 'yes',
    toread: req.body.toread === 'yes' ? 'yes' : 'no',
    starred: existing?.starred ? 'yes' : 'no',
    dt: existing?.created_at,
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

router.get('/b/:hash/', (req, res) => {
  const user = getDefaultUser();
  const b = getBookmarkByHash(user.id, req.params.hash);
  if (!b) return res.redirect('/');
  const ctx = parseListState(req);
  ctx.bulk = false;
  const body = `
    <div id="main_column">
      <div class="user_navbar">
        <span class="small_username">${escapeHtml(user.username)}</span>
        <div class="bookmark_count_box"><span class="search_heading">permalink</span></div>
      </div>
      <div id="bookmarks">
        ${renderBookmark(b, ctx)}
      </div>
      <p id="nextprev"><a href="/">&larr; all bookmarks</a></p>
    </div>
    <div id="right_bar">
      <p style="color:#888">saved ${escapeHtml(formatWhenTitle(b.created_at))}</p>
    </div>`;
  renderPage(res, { title: b.description || b.url, body, user });
});

router.post('/bulk/', express.urlencoded({ extended: true }), (req, res) => {
  const user = getDefaultUser();
  const actionMap = {
    'add tag': 'add_tag',
    'remove tag': 'remove_tag',
    'make private': 'private',
    'make public': 'public',
    'mark as read': 'read',
    delete: 'delete',
  };
  const action = actionMap[req.body.action];
  const returnTo = req.body.return_to || '/?bulk=1';
  if (!action) return res.redirect(returnTo);
  if (action === 'public' && user.privacy_lock) return res.redirect(returnTo);

  let hashes = [].concat(req.body.hash || []).filter(Boolean);
  if (req.body.scope === 'all') {
    const state = {
      filter: req.body.filter || 'all',
      tags: parseTagQuery(req.body.tag),
      sort: req.body.sort || 'created_at',
      q: req.body.q || '',
    };
    let bookmarks = listBookmarks(user.id, listOptionsFromState(state));
    bookmarks = applySearch(bookmarks, state.q);
    hashes = bookmarks.map((b) => b.hash);
  }

  bulkUpdateBookmarks(user.id, hashes, action, { tag: (req.body.new_tag || '').trim() });
  res.redirect(returnTo);
});

router.get('/tools/', (req, res) => {
  const user = getDefaultUser();
  const host = `${req.protocol}://${req.get('host')}`;
  const saveJs = `javascript:void(open('${host}/add/?popup=1&url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)+'&description='+encodeURIComponent(document.getSelection?document.getSelection().toString():''),'pinbook','toolbar=no,width=720,height=420'))`;
  const laterJs = `javascript:void(open('${host}/add/?popup=1&toread=yes&url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'pinbook','toolbar=no,width=720,height=420'))`;

  const body = `
    <div id="main_column">
      <div id="popup_header">
        <div id="title"><a href="/">pinbook</a> / tools</div>
      </div>
      <p>Pinboard uses bookmarklets for saving. Drag these onto your bookmarks toolbar:</p>
      <p>
        <a class="bookmarklet" href="${escapeHtml(saveJs)}">save to pinbook</a>
        &nbsp;
        <a class="bookmarklet" href="${escapeHtml(laterJs)}">read later</a>
      </p>
      <p>Shortcuts for unread bookmarks:</p>
      <ul>
        <li><a href="/unread/oldest">oldest</a> unread item</li>
        <li><a href="/unread/random">random</a> unread item</li>
      </ul>
      <p>Keyboard on the bookmarks page: <code>j</code>/<code>k</code> move, <code>enter</code> opens, <code>/</code> focuses search.</p>
      <p>Feeds:</p>
      <ul>
        <li><a href="/rss/">all bookmarks RSS</a></li>
        <li><a href="/rss/?filter=unread">unread RSS</a></li>
        <li><a href="/rss/?filter=private">private RSS</a></li>
        <li><a href="/rss/?filter=starred">starred RSS</a></li>
      </ul>
    </div>`;
  renderPage(res, { title: 'Tools', body, user, activeNav: 'tools' });
});

router.get('/unread/oldest', (req, res) => {
  const user = getDefaultUser();
  const b = getOldestUnread(user.id);
  if (!b) return res.redirect('/?filter=unread');
  res.redirect(b.url);
});

router.get('/unread/random', (req, res) => {
  const user = getDefaultUser();
  const b = getRandomUnread(user.id);
  if (!b) return res.redirect('/?filter=unread');
  res.redirect(b.url);
});

router.get('/fetch-title/', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'missing url' });
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'unsupported protocol' });
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    const response = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Pinbook/1.0' },
    });
    clearTimeout(timer);
    const html = await response.text();
    const sliced = html.slice(0, 200000);
    const match = sliced.match(/<title[^>]*>([^<]+)/i);
    const title = match ? match[1].replace(/\s+/g, ' ').trim() : '';
    res.json({ title });
  } catch {
    res.json({ title: '' });
  }
});

function buildRss(user, bookmarks, selfUrl, title) {
  const items = bookmarks
    .slice(0, 50)
    .map((b) => {
      const cats = parseTags(b.tags)
        .map((t) => `<category>${escapeHtml(t)}</category>`)
        .join('');
      const desc = escapeHtml(b.extended || '');
      return `    <item>
      <title>${escapeHtml(b.description || b.url)}</title>
      <link>${escapeHtml(b.url)}</link>
      <guid isPermaLink="false">${escapeHtml(b.hash)}</guid>
      <pubDate>${new Date(b.created_at).toUTCString()}</pubDate>
      <description>${desc}</description>
      ${cats}
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeHtml(title)}</title>
    <link>${escapeHtml(selfUrl)}</link>
    <description>Bookmarks for ${escapeHtml(user.username)}</description>
${items}
  </channel>
</rss>`;
}

router.get('/rss/', (req, res) => {
  const user = getDefaultUser();
  const state = parseListState(req);
  let bookmarks = listBookmarks(user.id, listOptionsFromState(state));
  if (user.privacy_lock && state.filter !== 'private') {
    bookmarks = bookmarks.filter((b) => b.shared);
  }
  bookmarks = applySearch(bookmarks, state.q);
  const titleBits = ['Pinbook', user.username];
  if (state.filter !== 'all') titleBits.push(state.filter);
  if (state.tags.length) titleBits.push(state.tags.join('+'));
  if (state.q) titleBits.push(`search:${state.q}`);
  res.type('application/rss+xml');
  res.send(buildRss(user, bookmarks, `${req.protocol}://${req.get('host')}/`, titleBits.join(' / ')));
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
  renderPage(res, { title: 'API Docs', body, user, activeNav: 'api' });
});

router.get('/sample/bookmarks.json', (req, res) => {
  res.sendFile(require('path').join(__dirname, '..', 'sample', 'bookmarks.json'));
});

module.exports = router;
