(function () {
  function bookmarks() {
    return Array.prototype.slice.call(document.querySelectorAll('#bookmarks .bookmark'));
  }

  function currentIndex() {
    const items = bookmarks();
    return items.findIndex(function (el) {
      return el.classList.contains('kb_current');
    });
  }

  function setCurrent(index) {
    const items = bookmarks();
    if (!items.length) return;
    items.forEach(function (el) {
      el.classList.remove('kb_current');
    });
    const next = items[Math.max(0, Math.min(index, items.length - 1))];
    next.classList.add('kb_current');
    next.scrollIntoView({ block: 'nearest' });
  }

  document.addEventListener('keydown', function (e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) {
      return;
    }
    if (e.key === 'j') {
      const i = currentIndex();
      setCurrent(i < 0 ? 0 : i + 1);
    } else if (e.key === 'k') {
      const i = currentIndex();
      setCurrent(i < 0 ? 0 : i - 1);
    } else if (e.key === 'Enter') {
      const i = currentIndex();
      if (i >= 0) {
        const link = bookmarks()[i].querySelector('.bookmark_title');
        if (link) window.location = link.href;
      }
    } else if (e.key === '/') {
      const search = document.getElementById('search_query_field');
      if (search) {
        e.preventDefault();
        search.focus();
        search.select();
      }
    }
  });

  document.addEventListener('click', function (e) {
    const copy = e.target.closest('a.copy_link');
    if (copy) {
      e.preventDefault();
      const url = copy.getAttribute('data-url') || copy.href;
      const done = function () {
        const original = copy.textContent;
        copy.textContent = 'copied';
        setTimeout(function () {
          copy.textContent = original;
        }, 900);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done).catch(done);
      } else {
        done();
      }
      return;
    }

    const suggest = e.target.closest('a.suggest_tag');
    if (suggest) {
      e.preventDefault();
      const field = document.getElementById('tags_field');
      if (!field) return;
      const tag = suggest.getAttribute('data-tag');
      const parts = field.value.trim().split(/\s+/).filter(Boolean);
      if (!parts.some(function (p) { return p.toLowerCase() === tag.toLowerCase(); })) {
        parts.push(tag);
        field.value = parts.join(' ');
      }
      field.focus();
    }
  });

  const fetchTitle = document.getElementById('fetch_title');
  if (fetchTitle) {
    fetchTitle.addEventListener('click', function (e) {
      e.preventDefault();
      const url = document.getElementById('url');
      const title = document.getElementById('title_field');
      if (!url || !url.value) return;
      fetchTitle.textContent = 'fetching…';
      fetch('/fetch-title/?url=' + encodeURIComponent(url.value))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.title && title) title.value = data.title;
          fetchTitle.textContent = 'fetch title';
        })
        .catch(function () {
          fetchTitle.textContent = 'fetch title';
        });
    });
  }

  function setChecks(on) {
    document.querySelectorAll('.bookmark_checkbox').forEach(function (c) {
      c.checked = on;
    });
  }

  const scope = document.getElementById('bulk_scope');
  const selectAll = document.getElementById('select_all');
  const selectPage = document.getElementById('select_page');
  const selectNone = document.getElementById('select_none');
  if (selectAll) {
    selectAll.addEventListener('click', function (e) {
      e.preventDefault();
      setChecks(true);
      if (scope) scope.value = 'all';
    });
  }
  if (selectPage) {
    selectPage.addEventListener('click', function (e) {
      e.preventDefault();
      setChecks(true);
      if (scope) scope.value = 'page';
    });
  }
  if (selectNone) {
    selectNone.addEventListener('click', function (e) {
      e.preventDefault();
      setChecks(false);
      if (scope) scope.value = 'page';
    });
  }

  const bulkForm = document.getElementById('bulk_form');
  if (bulkForm) {
    bulkForm.addEventListener('submit', function (e) {
      const submitter = e.submitter;
      if (submitter && submitter.value === 'delete') {
        if (!confirm('Delete selected bookmarks?')) e.preventDefault();
      }
    });
  }
})();
