import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  Note,
  NoteSummary,
  Notebook,
  Stack,
  Tag,
  ViewFilter,
} from "./api";
import { NoteEditor } from "./components/NoteEditor";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [stacks, setStacks] = useState<Stack[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [filter, setFilter] = useState<ViewFilter>({ type: "all" });
  const [searchInput, setSearchInput] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [showNewNotebook, setShowNewNotebook] = useState(false);
  const [showNewTag, setShowNewTag] = useState(false);
  const [newName, setNewName] = useState("");
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const defaultNotebook = useMemo(
    () => notebooks.find((n) => n.is_default) || notebooks[0],
    [notebooks]
  );

  const refreshMeta = useCallback(async () => {
    const [nb, st, tg] = await Promise.all([
      api.listNotebooks(),
      api.listStacks(),
      api.listTags(),
    ]);
    setNotebooks(nb);
    setStacks(st);
    setTags(tg);
  }, []);

  const refreshNotes = useCallback(async () => {
    let list: NoteSummary[] = [];
    switch (filter.type) {
      case "all":
        list = await api.listNotes({});
        break;
      case "notebook":
        list = await api.listNotes({ notebookId: filter.id });
        break;
      case "tag":
        list = await api.listNotes({ tagId: filter.id });
        break;
      case "shortcuts":
        list = await api.listShortcuts();
        break;
      case "trash":
        list = await api.listNotes({ trash: true });
        break;
      case "search":
        list = (await api.search(filter.query)).notes;
        break;
    }
    setNotes(list);
  }, [filter]);

  const loadNote = useCallback(async (id: string) => {
    const note = await api.getNote(id);
    setActiveNote(note);
    setSelectedNoteId(id);
  }, []);

  useEffect(() => {
    (async () => {
      for (let i = 0; i < 30; i++) {
        try {
          await api.health();
          setReady(true);
          await refreshMeta();
          await refreshNotes();
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      setError("Could not connect to Pinbook API on http://127.0.0.1:8787");
    })();
  }, [refreshMeta, refreshNotes]);

  useEffect(() => {
    if (ready) refreshNotes().catch(console.error);
  }, [ready, filter, refreshNotes]);

  const saveNote = useCallback(
    async (patch: Partial<Note>) => {
      if (!activeNote) return;
      setSaveState("saving");
      try {
        const updated = await api.updateNote(activeNote.id, {
          title: patch.title,
          content: patch.content,
          notebook_id: patch.notebook_id,
          is_pinned: patch.is_pinned,
          is_archived: patch.is_archived,
        });
        setActiveNote(updated);
        setSaveState("saved");
        await refreshNotes();
      } catch {
        setSaveState("error");
      }
    },
    [activeNote, refreshNotes]
  );

  useEffect(() => {
    if (!activeNote) return;
    const timer = setTimeout(() => {
      saveNote({
        title: activeNote.title,
        content: activeNote.content,
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [activeNote?.title, activeNote?.content]);

  const createNote = async () => {
    const nbId =
      filter.type === "notebook"
        ? filter.id
        : defaultNotebook?.id;
    if (!nbId) return;
    const note = await api.createNote(nbId);
    await refreshNotes();
    await loadNote(note.id);
  };

  const notebooksByStack = useMemo(() => {
    const grouped: Record<string, Notebook[]> = { uncategorized: [] };
    stacks.forEach((s) => (grouped[s.id] = []));
    notebooks.forEach((nb) => {
      if (nb.stack_id && grouped[nb.stack_id]) {
        grouped[nb.stack_id].push(nb);
      } else {
        grouped.uncategorized.push(nb);
      }
    });
    return grouped;
  }, [notebooks, stacks]);

  if (error) {
    return (
      <div className="boot-screen">
        <h1>Pinbook</h1>
        <p className="error">{error}</p>
        <p>Start the API with: <code>cargo run -p pinbook-api</code></p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="boot-screen">
        <div className="logo-mark">P</div>
        <p>Starting Pinbook…</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <span className="logo-mark">P</span>
            <span>Pinbook</span>
          </div>
          <button className="primary-btn" onClick={createNote} title="New Note">
            +
          </button>
        </div>

        <div className="sidebar-search">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && searchInput.trim()) {
                setFilter({ type: "search", query: searchInput.trim() });
              }
            }}
            placeholder="Search notes..."
          />
        </div>

        <nav className="sidebar-nav">
          <button
            className={filter.type === "all" ? "nav-item active" : "nav-item"}
            onClick={() => setFilter({ type: "all" })}
          >
            All Notes
          </button>
          <button
            className={filter.type === "shortcuts" ? "nav-item active" : "nav-item"}
            onClick={() => setFilter({ type: "shortcuts" })}
          >
            Shortcuts
          </button>

          <div className="nav-section">
            <div className="nav-section-title">
              <span>Notebooks</span>
              <button onClick={() => setShowNewNotebook(true)}>+</button>
            </div>
            {stacks.map((stack) => (
              <div key={stack.id} className="stack-group">
                <div className="stack-name">{stack.name}</div>
                {(notebooksByStack[stack.id] || []).map((nb) => (
                  <button
                    key={nb.id}
                    className={
                      filter.type === "notebook" && filter.id === nb.id
                        ? "nav-item active indent"
                        : "nav-item indent"
                    }
                    onClick={() =>
                      setFilter({ type: "notebook", id: nb.id, name: nb.name })
                    }
                  >
                    {nb.name}
                  </button>
                ))}
              </div>
            ))}
            {notebooksByStack.uncategorized.map((nb) => (
              <button
                key={nb.id}
                className={
                  filter.type === "notebook" && filter.id === nb.id
                    ? "nav-item active indent"
                    : "nav-item indent"
                }
                onClick={() =>
                  setFilter({ type: "notebook", id: nb.id, name: nb.name })
                }
              >
                {nb.name}
              </button>
            ))}
          </div>

          <div className="nav-section">
            <div className="nav-section-title">
              <span>Tags</span>
              <button onClick={() => setShowNewTag(true)}>+</button>
            </div>
            {tags.map((tag) => (
              <button
                key={tag.id}
                className={
                  filter.type === "tag" && filter.id === tag.id
                    ? "nav-item active indent"
                    : "nav-item indent"
                }
                onClick={() =>
                  setFilter({ type: "tag", id: tag.id, name: tag.name })
                }
              >
                #{tag.name}
              </button>
            ))}
          </div>

          <button
            className={filter.type === "trash" ? "nav-item active" : "nav-item"}
            onClick={() => setFilter({ type: "trash" })}
          >
            Trash
          </button>

          <div className="nav-section">
            <div className="nav-section-title">
              <span>Import</span>
            </div>
            <button className="nav-item indent" onClick={() => importRef.current?.click()}>
              Import Evernote (.enex)
            </button>
            {importStatus && <div className="import-status">{importStatus}</div>}
          </div>
        </nav>
        <input
          ref={importRef}
          type="file"
          accept=".enex,application/xml,text/xml"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              setImportStatus("Importing…");
              const result = await api.importEnex(file, {
                notebookName: file.name.replace(/\.enex$/i, ""),
              });
              setImportStatus(
                `Imported ${result.imported} notes into "${result.notebook_name}"` +
                  (result.skipped ? ` (${result.skipped} skipped)` : "")
              );
              await refreshMeta();
              await refreshNotes();
              setFilter({
                type: "notebook",
                id: result.notebook_id,
                name: result.notebook_name,
              });
            } catch (err) {
              setImportStatus(err instanceof Error ? err.message : "Import failed");
            }
          }}
        />
      </aside>

      <section className="note-list-panel">
        <div className="panel-header">
          <h2>
            {filter.type === "all" && "All Notes"}
            {filter.type === "notebook" && filter.name}
            {filter.type === "tag" && `#${filter.name}`}
            {filter.type === "shortcuts" && "Shortcuts"}
            {filter.type === "trash" && "Trash"}
            {filter.type === "search" && `Search: ${filter.query}`}
          </h2>
          <span className="count">{notes.length}</span>
        </div>
        <div className="note-list">
          {notes.map((note) => (
            <button
              key={note.id}
              className={
                selectedNoteId === note.id ? "note-card selected" : "note-card"
              }
              onClick={() => loadNote(note.id)}
            >
              <div className="note-card-title">
                {note.is_pinned && <span className="pin">📌</span>}
                {note.title || "Untitled"}
              </div>
              <div className="note-card-meta">{formatDate(note.updated_at)}</div>
              <div className="note-card-snippet">{note.snippet}</div>
              {note.tag_names.length > 0 && (
                <div className="note-card-tags">
                  {note.tag_names.map((t) => (
                    <span key={t}>#{t}</span>
                  ))}
                </div>
              )}
            </button>
          ))}
          {notes.length === 0 && (
            <div className="empty-state">No notes here yet.</div>
          )}
        </div>
      </section>

      <main className="editor-panel">
        {activeNote ? (
          <>
            <div className="editor-header">
              <input
                className="title-input"
                value={activeNote.title}
                onChange={(e) =>
                  setActiveNote({ ...activeNote, title: e.target.value })
                }
                placeholder="Title"
              />
              <div className="editor-actions">
                <select
                  value={activeNote.notebook_id}
                  onChange={(e) =>
                    saveNote({ ...activeNote, notebook_id: e.target.value })
                  }
                >
                  {notebooks.map((nb) => (
                    <option key={nb.id} value={nb.id}>
                      {nb.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() =>
                    saveNote({ ...activeNote, is_pinned: !activeNote.is_pinned })
                  }
                >
                  {activeNote.is_pinned ? "Unpin" : "Pin"}
                </button>
                <button
                  onClick={() =>
                    saveNote({
                      ...activeNote,
                      is_archived: !activeNote.is_archived,
                    })
                  }
                >
                  {activeNote.is_archived ? "Unarchive" : "Archive"}
                </button>
                {filter.type === "trash" ? (
                  <>
                    <button
                      onClick={async () => {
                        await api.restoreNote(activeNote.id);
                        setActiveNote(null);
                        await refreshNotes();
                      }}
                    >
                      Restore
                    </button>
                    <button
                      className="danger"
                      onClick={async () => {
                        await api.permanentlyDeleteNote(activeNote.id);
                        setActiveNote(null);
                        await refreshNotes();
                      }}
                    >
                      Delete Forever
                    </button>
                  </>
                ) : (
                  <button
                    className="danger"
                    onClick={async () => {
                      await api.deleteNote(activeNote.id);
                      setActiveNote(null);
                      await refreshNotes();
                    }}
                  >
                    Delete
                  </button>
                )}
                <span className="save-state">{saveState}</span>
              </div>
            </div>
            <NoteEditor
              content={activeNote.content}
              onChange={(html) =>
                setActiveNote({ ...activeNote, content: html })
              }
              onAttach={async (file) => {
                await api.uploadAttachment(activeNote.id, file);
                await refreshNotes();
              }}
            />
          </>
        ) : (
          <div className="empty-editor">
            <h2>Select a note or create a new one</h2>
            <button className="primary-btn large" onClick={createNote}>
              New Note
            </button>
          </div>
        )}
      </main>

      {showNewNotebook && (
        <Modal
          title="New Notebook"
          value={newName}
          onChange={setNewName}
          onCancel={() => {
            setShowNewNotebook(false);
            setNewName("");
          }}
          onSubmit={async () => {
            await api.createNotebook(newName);
            await refreshMeta();
            setShowNewNotebook(false);
            setNewName("");
          }}
        />
      )}

      {showNewTag && (
        <Modal
          title="New Tag"
          value={newName}
          onChange={setNewName}
          onCancel={() => {
            setShowNewTag(false);
            setNewName("");
          }}
          onSubmit={async () => {
            await api.createTag(newName);
            await refreshMeta();
            setShowNewTag(false);
            setNewName("");
          }}
        />
      )}
    </div>
  );
}

function Modal({
  title,
  value,
  onChange,
  onCancel,
  onSubmit,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>{title}</h3>
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && value && onSubmit()}
        />
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary-btn" disabled={!value.trim()} onClick={onSubmit}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
