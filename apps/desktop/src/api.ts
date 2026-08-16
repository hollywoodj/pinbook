export interface Notebook {
  id: string;
  user_id: string;
  stack_id: string | null;
  name: string;
  is_default: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Stack {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface NoteSummary {
  id: string;
  notebook_id: string;
  title: string;
  snippet: string;
  is_pinned: boolean;
  is_archived: boolean;
  reminder_at: string | null;
  tag_ids: string[];
  tag_names: string[];
  attachment_count: number;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  user_id: string;
  notebook_id: string;
  title: string;
  content: string;
  content_plain: string;
  is_pinned: boolean;
  is_archived: boolean;
  reminder_at: string | null;
  source_url: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface NoteRevision {
  id: string;
  note_id: string;
  title: string;
  content: string;
  created_at: string;
}

export type ViewFilter =
  | { type: "all" }
  | { type: "notebook"; id: string; name: string }
  | { type: "tag"; id: string; name: string }
  | { type: "shortcuts" }
  | { type: "trash" }
  | { type: "search"; query: string };

const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8787";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  health: () => request<{ status: string; version: string }>("/health"),

  listNotebooks: () => request<Notebook[]>("/api/v1/notebooks"),
  createNotebook: (name: string, stackId?: string) =>
    request<Notebook>("/api/v1/notebooks", {
      method: "POST",
      body: JSON.stringify({ name, stack_id: stackId || null }),
    }),
  deleteNotebook: (id: string) =>
    request<void>(`/api/v1/notebooks/${id}`, { method: "DELETE" }),

  listStacks: () => request<Stack[]>("/api/v1/stacks"),
  createStack: (name: string) =>
    request<Stack>("/api/v1/stacks", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  listTags: () => request<Tag[]>("/api/v1/tags"),
  createTag: (name: string) =>
    request<Tag>("/api/v1/tags", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  listNotes: (params: {
    notebookId?: string;
    tagId?: string;
    trash?: boolean;
    archived?: boolean;
  }) => {
    const qs = new URLSearchParams();
    if (params.notebookId) qs.set("notebook_id", params.notebookId);
    if (params.tagId) qs.set("tag_id", params.tagId);
    if (params.trash) qs.set("trash", "true");
    if (params.archived !== undefined) qs.set("archived", String(params.archived));
    const query = qs.toString();
    return request<NoteSummary[]>(`/api/v1/notes${query ? `?${query}` : ""}`);
  },

  getNote: (id: string) => request<Note>(`/api/v1/notes/${id}`),

  createNote: (notebookId: string, title = "Untitled") =>
    request<Note>("/api/v1/notes", {
      method: "POST",
      body: JSON.stringify({
        notebook_id: notebookId,
        title,
        content: "<p></p>",
      }),
    }),

  updateNote: (
    id: string,
    patch: Partial<{
      title: string;
      content: string;
      notebook_id: string;
      is_pinned: boolean;
      is_archived: boolean;
      tag_ids: string[];
      reminder_at: string | null;
    }>
  ) =>
    request<Note>(`/api/v1/notes/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  deleteNote: (id: string) =>
    request<void>(`/api/v1/notes/${id}`, { method: "DELETE" }),

  restoreNote: (id: string) =>
    request<Note>(`/api/v1/notes/${id}/restore`, { method: "POST" }),

  permanentlyDeleteNote: (id: string) =>
    request<void>(`/api/v1/notes/${id}/permanent`, { method: "DELETE" }),

  emptyTrash: () =>
    request<{ deleted: number }>("/api/v1/trash/empty", { method: "POST" }),

  search: (q: string) =>
    request<{ notes: NoteSummary[]; total: number }>(
      `/api/v1/search?q=${encodeURIComponent(q)}`
    ),

  listShortcuts: () => request<NoteSummary[]>("/api/v1/shortcuts"),
  addShortcut: (noteId: string) =>
    request(`/api/v1/shortcuts/${noteId}`, { method: "POST" }),
  removeShortcut: (noteId: string) =>
    request<void>(`/api/v1/shortcuts/${noteId}`, { method: "DELETE" }),

  listRevisions: (noteId: string) =>
    request<NoteRevision[]>(`/api/v1/notes/${noteId}/revisions`),

  restoreRevision: (noteId: string, revisionId: string) =>
    request<Note>(`/api/v1/notes/${noteId}/revisions/${revisionId}/restore`, {
      method: "POST",
    }),

  uploadAttachment: async (noteId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(
      `${API_BASE}/api/v1/notes/${noteId}/attachments/upload`,
      { method: "POST", body: form }
    );
    if (!res.ok) throw new Error("Upload failed");
    return res.json();
  },

  importEnex: async (
    file: File,
    options?: { notebookId?: string; notebookName?: string }
  ) => {
    const qs = new URLSearchParams();
    if (options?.notebookId) qs.set("notebook_id", options.notebookId);
    if (options?.notebookName) qs.set("notebook_name", options.notebookName);
    const query = qs.toString();
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(
      `${API_BASE}/api/v1/import/enex${query ? `?${query}` : ""}`,
      { method: "POST", body: form }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Import failed");
    }
    return res.json() as Promise<{
      imported: number;
      skipped: number;
      notebook_id: string;
      notebook_name: string;
      errors: { index: number; message: string }[];
    }>;
  },
};
