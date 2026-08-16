const express = require('express');
const {
  getUserByToken,
  getDefaultUser,
  formatPost,
  listBookmarks,
  addBookmark,
  deleteBookmark,
  getLastUpdate,
  getTags,
  getDates,
  suggestTags,
  renameTag,
  deleteTag,
  importFromJson,
} = require('../lib/db');

const router = express.Router();

function authenticate(req, res, next) {
  let authToken = req.query.auth_token;

  if (!authToken && req.headers.authorization) {
    const auth = req.headers.authorization;
    if (auth.startsWith('Basic ')) {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString();
      const [username, password] = decoded.split(':');
      authToken = `${username}:${password}`;
    }
  }

  if (authToken) {
    const user = getUserByToken(authToken);
    if (user) {
      req.user = user;
      return next();
    }
  }

  // Allow unauthenticated read for local dev convenience
  if (process.env.PINBOOK_ALLOW_ANON === '1') {
    req.user = getDefaultUser();
    return next();
  }

  return res.status(401).json({ result: 'bad auth token' });
}

function wantsJson(req) {
  return req.query.format === 'json' || req.accepts('json') === 'json';
}

function sendResult(req, res, data, xmlBuilder) {
  if (wantsJson(req)) {
    return res.json(data);
  }
  res.type('application/xml');
  return res.send(xmlBuilder());
}

function parseTagFilter(tag) {
  if (!tag) return [];
  return tag.trim().split(/\s+/).filter(Boolean).slice(0, 3);
}

router.use(authenticate);

// posts/update
router.get('/posts/update', (req, res) => {
  const time = getLastUpdate(req.user.id);
  sendResult(req, res, { update: { time } }, () =>
    `<?xml version="1.0" encoding="UTF-8" ?>\n<update time="${time}" />`
  );
});

// posts/add
router.get('/posts/add', (req, res) => {
  const { url, description, extended, tags, dt, replace, shared, toread } = req.query;
  if (!url) {
    return sendResult(req, res, { result: 'missing url' }, () => '<result code="missing url" />');
  }

  const result = addBookmark(req.user.id, {
    url,
    description: description || url,
    extended,
    tags,
    dt,
    replace: replace || 'yes',
    shared,
    toread,
  });

  if (!result.ok) {
    return sendResult(req, res, { result: result.error }, () => `<result code="${result.error}" />`);
  }

  sendResult(req, res, { result: 'done' }, () => '<result>done</result>');
});

// posts/delete
router.get('/posts/delete', (req, res) => {
  const { url } = req.query;
  if (!url) {
    return sendResult(req, res, { result: 'missing url' }, () => '<result code="missing url" />');
  }

  const deleted = deleteBookmark(req.user.id, url);
  if (!deleted) {
    return sendResult(req, res, { result: 'item not found' }, () => '<result code="item not found" />');
  }

  sendResult(req, res, { result: 'done' }, () => '<result>done</result>');
});

// posts/get
router.get('/posts/get', (req, res) => {
  const tags = parseTagFilter(req.query.tag);
  const bookmarks = listBookmarks(req.user.id, {
    tags,
    url: req.query.url,
    date: req.query.dt,
    limit: 100,
  });

  const dt = bookmarks[0]?.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const posts = bookmarks.map(formatPost);

  sendResult(
    req,
    res,
    { posts: { dt, tag: req.query.tag || '', user: req.user.username, post: posts } },
    () => {
      const postXml = posts
        .map(
          (p) =>
            `<post href="${escapeXml(p.href)}" description="${escapeXml(p.description)}" extended="${escapeXml(p.extended)}" hash="${p.hash}" tag="${escapeXml(p.tag)}" time="${p.time}" />`
        )
        .join('\n');
      return `<?xml version="1.0" encoding="UTF-8"?>\n<posts dt="${dt}" tag="${escapeXml(req.query.tag || '')}" user="${req.user.username}">\n${postXml}\n</posts>`;
    }
  );
});

// posts/recent
router.get('/posts/recent', (req, res) => {
  const tags = parseTagFilter(req.query.tag);
  const count = Math.min(parseInt(req.query.count, 10) || 15, 100);
  const bookmarks = listBookmarks(req.user.id, { tags, limit: count });
  const posts = bookmarks.map(formatPost);
  const dt = nowIso();

  sendResult(
    req,
    res,
    { posts: { dt, user: req.user.username, post: posts } },
    () => {
      const postXml = posts
        .map(
          (p) =>
            `<post href="${escapeXml(p.href)}" description="${escapeXml(p.description)}" extended="${escapeXml(p.extended)}" hash="${p.hash}" tag="${escapeXml(p.tag)}" time="${p.time}" />`
        )
        .join('\n');
      return `<?xml version="1.0" encoding="UTF-8" ?>\n<posts dt="${dt}" user="${req.user.username}">\n${postXml}\n</posts>`;
    }
  );
});

// posts/dates
router.get('/posts/dates', (req, res) => {
  const dates = getDates(req.user.id, req.query.tag);
  sendResult(
    req,
    res,
    { dates: { user: req.user.username, tag: req.query.tag || '', date: dates } },
    () => {
      const dateXml = dates
        .map((d) => `<date count="${d.count}" date="${d.date}" />`)
        .join('\n');
      return `<?xml version="1.0" encoding="UTF-8" ?>\n<dates user="${req.user.username}" tag="${escapeXml(req.query.tag || '')}">\n${dateXml}\n</dates>`;
    }
  );
});

// posts/all
router.get('/posts/all', (req, res) => {
  const tags = parseTagFilter(req.query.tag);
  const start = parseInt(req.query.start, 10) || 0;
  const results = req.query.results ? parseInt(req.query.results, 10) : undefined;
  const bookmarks = listBookmarks(req.user.id, {
    tags,
    offset: start,
    limit: results,
    fromdt: req.query.fromdt,
    todt: req.query.todt,
  });
  const posts = bookmarks.map(formatPost);

  sendResult(
    req,
    res,
    { posts: { tag: req.query.tag || '', user: req.user.username, post: posts } },
    () => {
      const postXml = posts
        .map(
          (p) =>
            `<post href="${escapeXml(p.href)}" description="${escapeXml(p.description)}" extended="${escapeXml(p.extended)}" hash="${p.hash}" tag="${escapeXml(p.tag)}" time="${p.time}" />`
        )
        .join('\n');
      return `<posts tag="${escapeXml(req.query.tag || '')}" user="${req.user.username}">\n${postXml}\n</posts>`;
    }
  );
});

// posts/suggest
router.get('/posts/suggest', (req, res) => {
  const { popular, recommended } = suggestTags(req.user.id, req.query.url);
  sendResult(
    req,
    res,
    { suggested: { popular, recommended } },
    () => {
      const pop = popular.map((t) => `<popular>${escapeXml(t)}</popular>`).join('\n');
      const rec = recommended.map((t) => `<recommended>${escapeXml(t)}</recommended>`).join('\n');
      return `<suggested>\n${pop}\n${rec}\n</suggested>`;
    }
  );
});

// tags/get
router.get('/tags/get', (req, res) => {
  const tags = getTags(req.user.id);
  sendResult(
    req,
    res,
    { tags: { tag: tags } },
    () => {
      const tagXml = tags
        .map((t) => `<tag count="${t.count}" tag="${escapeXml(t.tag)}" />`)
        .join('\n');
      return `<tags>\n${tagXml}\n</tags>`;
    }
  );
});

// tags/delete
router.get('/tags/delete', (req, res) => {
  if (!req.query.tag) {
    return sendResult(req, res, { result: 'missing tag' }, () => '<result code="missing tag" />');
  }
  deleteTag(req.user.id, req.query.tag);
  sendResult(req, res, { result: 'done' }, () => '<result>done</result>');
});

// tags/rename
router.get('/tags/rename', (req, res) => {
  const { old: oldTag, new: newTag } = req.query;
  if (!oldTag) {
    return sendResult(req, res, { result: 'missing old tag' }, () => '<result code="missing old tag" />');
  }
  renameTag(req.user.id, oldTag, newTag || '');
  sendResult(req, res, { result: 'done' }, () => '<result>done</result>');
});

// user/secret
router.get('/user/secret', (req, res) => {
  sendResult(
    req,
    res,
    { result: req.user.secret_key },
    () => `<?xml version="1.0" encoding="UTF-8" ?>\n<result>${req.user.secret_key}</result>`
  );
});

// user/api_token
router.get('/user/api_token', (req, res) => {
  sendResult(
    req,
    res,
    { result: req.user.api_token },
    () => `<?xml version="1.0" encoding="UTF-8" ?>\n<result>${req.user.api_token}</result>`
  );
});

// Modern REST JSON API (easier for modern stacks)
router.get('/bookmarks', (req, res) => {
  const tags = parseTagFilter(req.query.tag);
  const bookmarks = listBookmarks(req.user.id, {
    tags,
    shared: req.query.shared === 'no' ? false : req.query.shared === 'yes' ? true : undefined,
    toread: req.query.toread === 'yes' ? true : undefined,
    untagged: req.query.untagged === 'yes',
    limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
    offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
  });
  res.json({ bookmarks: bookmarks.map(formatPost), count: bookmarks.length });
});

router.post('/bookmarks', express.json(), (req, res) => {
  const { url, description, extended, tags, shared, toread } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  const result = addBookmark(req.user.id, { url, description, extended, tags, shared, toread });
  if (!result.ok) return res.status(409).json({ error: result.error });
  res.status(201).json({ bookmark: formatPost(result.bookmark) });
});

router.delete('/bookmarks', (req, res) => {
  const url = req.query.url || req.body?.url;
  if (!url) return res.status(400).json({ error: 'url is required' });
  const deleted = deleteBookmark(req.user.id, url);
  if (!deleted) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

router.post('/import', express.json({ limit: '50mb' }), (req, res) => {
  const result = importFromJson(req.user.id, req.body);
  res.json(result);
});

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

module.exports = router;
