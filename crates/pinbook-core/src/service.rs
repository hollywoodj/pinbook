use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::db::Database;
use crate::error::{PinbookError, Result};
use crate::models::*;

pub struct PinbookService {
    db: Database,
}

impl PinbookService {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    pub fn db(&self) -> &Database {
        &self.db
    }

    pub fn into_db(self) -> Database {
        self.db
    }

    fn now() -> String {
        Utc::now().to_rfc3339()
    }

    fn parse_dt(s: &str) -> Result<DateTime<Utc>> {
        DateTime::parse_from_rfc3339(s)
            .map(|dt| dt.with_timezone(&Utc))
            .map_err(|e| PinbookError::Other(e.to_string()))
    }

    fn optional_dt(s: Option<String>) -> Result<Option<DateTime<Utc>>> {
        s.map(|v| Self::parse_dt(&v)).transpose()
    }

    // --- Notebooks ---

    pub fn list_notebooks(&self, include_deleted: bool) -> Result<Vec<Notebook>> {
        let user_id = self.db.default_user_id()?;
        let sql = if include_deleted {
            "SELECT id, user_id, stack_id, name, is_default, sort_order, created_at, updated_at, deleted_at FROM notebooks WHERE user_id = ?1 ORDER BY sort_order, name"
        } else {
            "SELECT id, user_id, stack_id, name, is_default, sort_order, created_at, updated_at, deleted_at FROM notebooks WHERE user_id = ?1 AND deleted_at IS NULL ORDER BY sort_order, name"
        };
        let conn = self.db.connection();
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map(params![user_id.to_string()], |row| {
            Ok(Notebook {
                id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                user_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                stack_id: row
                    .get::<_, Option<String>>(2)?
                    .map(|s| Uuid::parse_str(&s).unwrap()),
                name: row.get(3)?,
                is_default: row.get::<_, i32>(4)? != 0,
                sort_order: row.get(5)?,
                created_at: Self::parse_dt(&row.get::<_, String>(6)?).unwrap(),
                updated_at: Self::parse_dt(&row.get::<_, String>(7)?).unwrap(),
                deleted_at: Self::optional_dt(row.get(8)?).unwrap(),
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(PinbookError::from)
    }

    pub fn create_notebook(&self, req: CreateNotebookRequest) -> Result<Notebook> {
        let user_id = self.db.default_user_id()?;
        let id = Uuid::new_v4();
        let now = Self::now();
        if req.is_default.unwrap_or(false) {
            self.db.connection().execute(
                "UPDATE notebooks SET is_default = 0, updated_at = ?1 WHERE user_id = ?2",
                params![now, user_id.to_string()],
            )?;
        }
        self.db.connection().execute(
            "INSERT INTO notebooks (id, user_id, stack_id, name, is_default, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM notebooks WHERE user_id = ?2), ?6, ?7)",
            params![
                id.to_string(),
                user_id.to_string(),
                req.stack_id.map(|s| s.to_string()),
                req.name,
                if req.is_default.unwrap_or(false) { 1 } else { 0 },
                now,
                now
            ],
        )?;
        self.get_notebook(id)
    }

    pub fn get_notebook(&self, id: Uuid) -> Result<Notebook> {
        let conn = self.db.connection();
        conn.query_row(
            "SELECT id, user_id, stack_id, name, is_default, sort_order, created_at, updated_at, deleted_at FROM notebooks WHERE id = ?1",
            params![id.to_string()],
            |row| {
                Ok(Notebook {
                    id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                    user_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                    stack_id: row
                        .get::<_, Option<String>>(2)?
                        .map(|s| Uuid::parse_str(&s).unwrap()),
                    name: row.get(3)?,
                    is_default: row.get::<_, i32>(4)? != 0,
                    sort_order: row.get(5)?,
                    created_at: Self::parse_dt(&row.get::<_, String>(6)?).unwrap(),
                    updated_at: Self::parse_dt(&row.get::<_, String>(7)?).unwrap(),
                    deleted_at: Self::optional_dt(row.get(8)?).unwrap(),
                })
            },
        )
        .optional()?
        .ok_or_else(|| PinbookError::NotFound(format!("notebook {id}")))
    }

    pub fn update_notebook(&self, id: Uuid, req: UpdateNotebookRequest) -> Result<Notebook> {
        let mut notebook = self.get_notebook(id)?;
        if let Some(name) = req.name {
            notebook.name = name;
        }
        if let Some(stack_id) = req.stack_id {
            notebook.stack_id = stack_id;
        }
        if let Some(sort_order) = req.sort_order {
            notebook.sort_order = sort_order;
        }
        notebook.updated_at = Utc::now();
        let now = notebook.updated_at.to_rfc3339();
        self.db.connection().execute(
            "UPDATE notebooks SET name = ?1, stack_id = ?2, sort_order = ?3, updated_at = ?4 WHERE id = ?5",
            params![
                notebook.name,
                notebook.stack_id.map(|s| s.to_string()),
                notebook.sort_order,
                now,
                id.to_string()
            ],
        )?;
        Ok(notebook)
    }

    pub fn delete_notebook(&self, id: Uuid) -> Result<()> {
        let now = Self::now();
        let affected = self.db.connection().execute(
            "UPDATE notebooks SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![now, id.to_string()],
        )?;
        if affected == 0 {
            return Err(PinbookError::NotFound(format!("notebook {id}")));
        }
        Ok(())
    }

    pub fn restore_notebook(&self, id: Uuid) -> Result<Notebook> {
        let now = Self::now();
        self.db.connection().execute(
            "UPDATE notebooks SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2",
            params![now, id.to_string()],
        )?;
        self.get_notebook(id)
    }

    // --- Stacks ---

    pub fn list_stacks(&self) -> Result<Vec<Stack>> {
        let user_id = self.db.default_user_id()?;
        let conn = self.db.connection();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, name, sort_order, created_at, updated_at FROM stacks WHERE user_id = ?1 ORDER BY sort_order, name",
        )?;
        let rows = stmt.query_map(params![user_id.to_string()], |row| {
            Ok(Stack {
                id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                user_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                name: row.get(2)?,
                sort_order: row.get(3)?,
                created_at: Self::parse_dt(&row.get::<_, String>(4)?).unwrap(),
                updated_at: Self::parse_dt(&row.get::<_, String>(5)?).unwrap(),
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(PinbookError::from)
    }

    pub fn create_stack(&self, req: CreateStackRequest) -> Result<Stack> {
        let user_id = self.db.default_user_id()?;
        let id = Uuid::new_v4();
        let now = Self::now();
        self.db.connection().execute(
            "INSERT INTO stacks (id, user_id, name, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM stacks WHERE user_id = ?2), ?4, ?5)",
            params![id.to_string(), user_id.to_string(), req.name, now, now],
        )?;
        self.get_stack(id)
    }

    pub fn get_stack(&self, id: Uuid) -> Result<Stack> {
        self.db
            .connection()
            .query_row(
                "SELECT id, user_id, name, sort_order, created_at, updated_at FROM stacks WHERE id = ?1",
                params![id.to_string()],
                |row| {
                    Ok(Stack {
                        id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                        user_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                        name: row.get(2)?,
                        sort_order: row.get(3)?,
                        created_at: Self::parse_dt(&row.get::<_, String>(4)?).unwrap(),
                        updated_at: Self::parse_dt(&row.get::<_, String>(5)?).unwrap(),
                    })
                },
            )
            .optional()?
            .ok_or_else(|| PinbookError::NotFound(format!("stack {id}")))
    }

    pub fn delete_stack(&self, id: Uuid) -> Result<()> {
        self.db.connection().execute(
            "UPDATE notebooks SET stack_id = NULL WHERE stack_id = ?1",
            params![id.to_string()],
        )?;
        let affected = self
            .db
            .connection()
            .execute("DELETE FROM stacks WHERE id = ?1", params![id.to_string()])?;
        if affected == 0 {
            return Err(PinbookError::NotFound(format!("stack {id}")));
        }
        Ok(())
    }

    // --- Tags ---

    pub fn list_tags(&self) -> Result<Vec<Tag>> {
        let user_id = self.db.default_user_id()?;
        let conn = self.db.connection();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, name, created_at, updated_at FROM tags WHERE user_id = ?1 ORDER BY name",
        )?;
        let rows = stmt.query_map(params![user_id.to_string()], |row| {
            Ok(Tag {
                id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                user_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                name: row.get(2)?,
                created_at: Self::parse_dt(&row.get::<_, String>(3)?).unwrap(),
                updated_at: Self::parse_dt(&row.get::<_, String>(4)?).unwrap(),
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(PinbookError::from)
    }

    pub fn create_tag(&self, req: CreateTagRequest) -> Result<Tag> {
        let user_id = self.db.default_user_id()?;
        let id = Uuid::new_v4();
        let now = Self::now();
        self.db.connection().execute(
            "INSERT INTO tags (id, user_id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id.to_string(), user_id.to_string(), req.name, now, now],
        )?;
        self.get_tag(id)
    }

    pub fn get_tag(&self, id: Uuid) -> Result<Tag> {
        self.db
            .connection()
            .query_row(
                "SELECT id, user_id, name, created_at, updated_at FROM tags WHERE id = ?1",
                params![id.to_string()],
                |row| {
                    Ok(Tag {
                        id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                        user_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                        name: row.get(2)?,
                        created_at: Self::parse_dt(&row.get::<_, String>(3)?).unwrap(),
                        updated_at: Self::parse_dt(&row.get::<_, String>(4)?).unwrap(),
                    })
                },
            )
            .optional()?
            .ok_or_else(|| PinbookError::NotFound(format!("tag {id}")))
    }

    pub fn delete_tag(&self, id: Uuid) -> Result<()> {
        let affected = self
            .db
            .connection()
            .execute("DELETE FROM tags WHERE id = ?1", params![id.to_string()])?;
        if affected == 0 {
            return Err(PinbookError::NotFound(format!("tag {id}")));
        }
        Ok(())
    }

    pub fn get_or_create_tag_by_name(&self, name: &str) -> Result<Tag> {
        let user_id = self.db.default_user_id()?;
        let existing: Option<String> = self
            .db
            .connection()
            .query_row(
                "SELECT id FROM tags WHERE user_id = ?1 AND name = ?2",
                params![user_id.to_string(), name],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            return self.get_tag(Uuid::parse_str(&id).unwrap());
        }
        self.create_tag(CreateTagRequest {
            name: name.to_string(),
        })
    }

    // --- Notes ---

    pub fn list_notes(
        &self,
        notebook_id: Option<Uuid>,
        tag_id: Option<Uuid>,
        trash: bool,
        archived: Option<bool>,
    ) -> Result<Vec<NoteSummary>> {
        let user_id = self.db.default_user_id()?;
        let mut sql = String::from(
            "SELECT n.id, n.notebook_id, n.title, n.content_plain, n.is_pinned, n.is_archived, n.reminder_at, n.created_at, n.updated_at,
             (SELECT COUNT(*) FROM attachments a WHERE a.note_id = n.id) as attachment_count
             FROM notes n",
        );
        let mut conditions = vec!["n.user_id = ?1".to_string()];
        if trash {
            conditions.push("n.deleted_at IS NOT NULL".to_string());
        } else {
            conditions.push("n.deleted_at IS NULL".to_string());
        }
        if let Some(nb) = notebook_id {
            conditions.push(format!("n.notebook_id = '{nb}'"));
        }
        if let Some(tag) = tag_id {
            sql.push_str(" JOIN note_tags nt ON nt.note_id = n.id");
            conditions.push(format!("nt.tag_id = '{tag}'"));
        }
        if let Some(arch) = archived {
            conditions.push(format!("n.is_archived = {}", if arch { 1 } else { 0 }));
        }
        sql.push_str(" WHERE ");
        sql.push_str(&conditions.join(" AND "));
        sql.push_str(" ORDER BY n.is_pinned DESC, n.updated_at DESC");

        let conn = self.db.connection();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![user_id.to_string()], |row| {
            let content_plain: String = row.get(3)?;
            let snippet: String = content_plain.chars().take(200).collect();
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                snippet,
                row.get::<_, i32>(4)? != 0,
                row.get::<_, i32>(5)? != 0,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, i32>(9)?,
            ))
        })?;

        let mut notes = Vec::new();
        for row in rows {
            let (id_s, nb_s, title, snippet, pinned, archived, reminder, created, updated, att_count) =
                row?;
            let id = Uuid::parse_str(&id_s).unwrap();
            let (tag_ids, tag_names) = self.get_note_tags(id)?;
            notes.push(NoteSummary {
                id,
                notebook_id: Uuid::parse_str(&nb_s).unwrap(),
                title,
                snippet,
                is_pinned: pinned,
                is_archived: archived,
                reminder_at: Self::optional_dt(reminder)?,
                tag_ids,
                tag_names,
                attachment_count: att_count,
                created_at: Self::parse_dt(&created)?,
                updated_at: Self::parse_dt(&updated)?,
            });
        }
        Ok(notes)
    }

    fn get_note_tags(&self, note_id: Uuid) -> Result<(Vec<Uuid>, Vec<String>)> {
        let conn = self.db.connection();
        let mut stmt = conn.prepare(
            "SELECT t.id, t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ?1 ORDER BY t.name",
        )?;
        let rows = stmt.query_map(params![note_id.to_string()], |row| {
            Ok((
                Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                row.get::<_, String>(1)?,
            ))
        })?;
        let mut ids = Vec::new();
        let mut names = Vec::new();
        for row in rows {
            let (id, name) = row?;
            ids.push(id);
            names.push(name);
        }
        Ok((ids, names))
    }

    fn strip_html(html: &str) -> String {
        let mut out = String::with_capacity(html.len());
        let mut in_tag = false;
        for ch in html.chars() {
            match ch {
                '<' => in_tag = true,
                '>' => in_tag = false,
                _ if !in_tag => out.push(ch),
                _ => {}
            }
        }
        out.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    pub fn create_note(&self, req: CreateNoteRequest) -> Result<Note> {
        self.get_notebook(req.notebook_id)?;
        let user_id = self.db.default_user_id()?;
        let id = Uuid::new_v4();
        let now = Self::now();
        let title = req.title.unwrap_or_else(|| "Untitled".to_string());
        let content = req.content.unwrap_or_default();
        let content_plain = Self::strip_html(&content);

        self.db.connection().execute(
            "INSERT INTO notes (id, user_id, notebook_id, title, content, content_plain, is_pinned, reminder_at, source_url, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                id.to_string(),
                user_id.to_string(),
                req.notebook_id.to_string(),
                title,
                content,
                content_plain,
                if req.is_pinned.unwrap_or(false) { 1 } else { 0 },
                req.reminder_at.map(|d| d.to_rfc3339()),
                req.source_url,
                now,
                now
            ],
        )?;

        if let Some(tag_ids) = req.tag_ids {
            self.set_note_tags(id, &tag_ids)?;
        }

        self.save_revision(id, &title, &content)?;
        self.get_note(id)
    }

    pub fn get_note(&self, id: Uuid) -> Result<Note> {
        self.db
            .connection()
            .query_row(
                "SELECT id, user_id, notebook_id, title, content, content_plain, is_pinned, is_archived, reminder_at, source_url, latitude, longitude, created_at, updated_at, deleted_at FROM notes WHERE id = ?1",
                params![id.to_string()],
                |row| {
                    Ok(Note {
                        id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                        user_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                        notebook_id: Uuid::parse_str(&row.get::<_, String>(2)?).unwrap(),
                        title: row.get(3)?,
                        content: row.get(4)?,
                        content_plain: row.get(5)?,
                        is_pinned: row.get::<_, i32>(6)? != 0,
                        is_archived: row.get::<_, i32>(7)? != 0,
                        reminder_at: Self::optional_dt(row.get(8)?).unwrap(),
                        source_url: row.get(9)?,
                        latitude: row.get(10)?,
                        longitude: row.get(11)?,
                        created_at: Self::parse_dt(&row.get::<_, String>(12)?).unwrap(),
                        updated_at: Self::parse_dt(&row.get::<_, String>(13)?).unwrap(),
                        deleted_at: Self::optional_dt(row.get(14)?).unwrap(),
                    })
                },
            )
            .optional()?
            .ok_or_else(|| PinbookError::NotFound(format!("note {id}")))
    }

    pub fn update_note(&self, id: Uuid, req: UpdateNoteRequest) -> Result<Note> {
        let mut note = self.get_note(id)?;
        if let Some(notebook_id) = req.notebook_id {
            self.get_notebook(notebook_id)?;
            note.notebook_id = notebook_id;
        }
        if let Some(title) = req.title {
            note.title = title;
        }
        if let Some(content) = req.content {
            note.content = content.clone();
            note.content_plain = Self::strip_html(&content);
            self.save_revision(id, &note.title, &content)?;
        }
        if let Some(pinned) = req.is_pinned {
            note.is_pinned = pinned;
        }
        if let Some(archived) = req.is_archived {
            note.is_archived = archived;
        }
        if let Some(reminder) = req.reminder_at {
            note.reminder_at = reminder;
        }
        if let Some(source_url) = req.source_url {
            note.source_url = Some(source_url);
        }
        note.updated_at = Utc::now();

        self.db.connection().execute(
            "UPDATE notes SET notebook_id = ?1, title = ?2, content = ?3, content_plain = ?4, is_pinned = ?5, is_archived = ?6, reminder_at = ?7, source_url = ?8, updated_at = ?9 WHERE id = ?10",
            params![
                note.notebook_id.to_string(),
                note.title,
                note.content,
                note.content_plain,
                if note.is_pinned { 1 } else { 0 },
                if note.is_archived { 1 } else { 0 },
                note.reminder_at.map(|d| d.to_rfc3339()),
                note.source_url,
                note.updated_at.to_rfc3339(),
                id.to_string()
            ],
        )?;

        if let Some(tag_ids) = req.tag_ids {
            self.set_note_tags(id, &tag_ids)?;
        }

        Ok(note)
    }

    fn set_note_tags(&self, note_id: Uuid, tag_ids: &[Uuid]) -> Result<()> {
        let conn = self.db.connection();
        conn.execute(
            "DELETE FROM note_tags WHERE note_id = ?1",
            params![note_id.to_string()],
        )?;
        for tag_id in tag_ids {
            self.get_tag(*tag_id)?;
            conn.execute(
                "INSERT INTO note_tags (note_id, tag_id) VALUES (?1, ?2)",
                params![note_id.to_string(), tag_id.to_string()],
            )?;
        }
        Ok(())
    }

    pub fn delete_note(&self, id: Uuid) -> Result<()> {
        let now = Self::now();
        let affected = self.db.connection().execute(
            "UPDATE notes SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![now, id.to_string()],
        )?;
        if affected == 0 {
            return Err(PinbookError::NotFound(format!("note {id}")));
        }
        Ok(())
    }

    pub fn restore_note(&self, id: Uuid) -> Result<Note> {
        let now = Self::now();
        self.db.connection().execute(
            "UPDATE notes SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2",
            params![now, id.to_string()],
        )?;
        self.get_note(id)
    }

    pub fn permanently_delete_note(&self, id: Uuid) -> Result<()> {
        let attachments = self.list_attachments(id)?;
        for att in attachments {
            let path = self.db.attachment_path(&att.id);
            let _ = std::fs::remove_file(path);
        }
        let affected = self
            .db
            .connection()
            .execute("DELETE FROM notes WHERE id = ?1", params![id.to_string()])?;
        if affected == 0 {
            return Err(PinbookError::NotFound(format!("note {id}")));
        }
        Ok(())
    }

    pub fn empty_trash(&self) -> Result<i32> {
        let trash_notes = self.list_notes(None, None, true, None)?;
        let mut count = 0;
        for note in trash_notes {
            self.permanently_delete_note(note.id)?;
            count += 1;
        }
        Ok(count)
    }

    fn save_revision(&self, note_id: Uuid, title: &str, content: &str) -> Result<()> {
        let id = Uuid::new_v4();
        let now = Self::now();
        self.db.connection().execute(
            "INSERT INTO note_revisions (id, note_id, title, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id.to_string(), note_id.to_string(), title, content, now],
        )?;
        Ok(())
    }

    pub fn list_revisions(&self, note_id: Uuid) -> Result<Vec<NoteRevision>> {
        self.get_note(note_id)?;
        let conn = self.db.connection();
        let mut stmt = conn.prepare(
            "SELECT id, note_id, title, content, created_at FROM note_revisions WHERE note_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![note_id.to_string()], |row| {
            Ok(NoteRevision {
                id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                note_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                title: row.get(2)?,
                content: row.get(3)?,
                created_at: Self::parse_dt(&row.get::<_, String>(4)?).unwrap(),
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(PinbookError::from)
    }

    pub fn restore_revision(&self, note_id: Uuid, revision_id: Uuid) -> Result<Note> {
        let revision = self
            .db
            .connection()
            .query_row(
                "SELECT title, content FROM note_revisions WHERE id = ?1 AND note_id = ?2",
                params![revision_id.to_string(), note_id.to_string()],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
            .ok_or_else(|| PinbookError::NotFound(format!("revision {revision_id}")))?;
        self.update_note(
            note_id,
            UpdateNoteRequest {
                title: Some(revision.0),
                content: Some(revision.1),
                ..Default::default()
            },
        )
    }

    // --- Attachments ---

    pub fn list_attachments(&self, note_id: Uuid) -> Result<Vec<Attachment>> {
        let conn = self.db.connection();
        let mut stmt = conn.prepare(
            "SELECT id, note_id, filename, mime_type, size, width, height, created_at, updated_at FROM attachments WHERE note_id = ?1 ORDER BY created_at",
        )?;
        let rows = stmt.query_map(params![note_id.to_string()], |row| {
            Ok(Attachment {
                id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                note_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                filename: row.get(2)?,
                mime_type: row.get(3)?,
                size: row.get(4)?,
                width: row.get(5)?,
                height: row.get(6)?,
                created_at: Self::parse_dt(&row.get::<_, String>(7)?).unwrap(),
                updated_at: Self::parse_dt(&row.get::<_, String>(8)?).unwrap(),
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(PinbookError::from)
    }

    pub fn add_attachment(
        &self,
        note_id: Uuid,
        filename: String,
        mime_type: String,
        data: &[u8],
    ) -> Result<Attachment> {
        self.get_note(note_id)?;
        let id = Uuid::new_v4();
        let now = Self::now();
        let path = self.db.attachment_path(&id);
        std::fs::write(&path, data)?;
        self.db.connection().execute(
            "INSERT INTO attachments (id, note_id, filename, mime_type, size, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id.to_string(),
                note_id.to_string(),
                filename,
                mime_type,
                data.len() as i64,
                now,
                now
            ],
        )?;
        self.get_attachment(id)
    }

    pub fn get_attachment(&self, id: Uuid) -> Result<Attachment> {
        self.db
            .connection()
            .query_row(
                "SELECT id, note_id, filename, mime_type, size, width, height, created_at, updated_at FROM attachments WHERE id = ?1",
                params![id.to_string()],
                |row| {
                    Ok(Attachment {
                        id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                        note_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                        filename: row.get(2)?,
                        mime_type: row.get(3)?,
                        size: row.get(4)?,
                        width: row.get(5)?,
                        height: row.get(6)?,
                        created_at: Self::parse_dt(&row.get::<_, String>(7)?).unwrap(),
                        updated_at: Self::parse_dt(&row.get::<_, String>(8)?).unwrap(),
                    })
                },
            )
            .optional()?
            .ok_or_else(|| PinbookError::NotFound(format!("attachment {id}")))
    }

    pub fn read_attachment_data(&self, id: Uuid) -> Result<Vec<u8>> {
        let path = self.db.attachment_path(&id);
        self.get_attachment(id)?;
        std::fs::read(path).map_err(PinbookError::from)
    }

    pub fn delete_attachment(&self, id: Uuid) -> Result<()> {
        let path = self.db.attachment_path(&id);
        let affected = self.db.connection().execute(
            "DELETE FROM attachments WHERE id = ?1",
            params![id.to_string()],
        )?;
        if affected == 0 {
            return Err(PinbookError::NotFound(format!("attachment {id}")));
        }
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    // --- Shortcuts ---

    pub fn list_shortcuts(&self) -> Result<Vec<(Shortcut, NoteSummary)>> {
        let user_id = self.db.default_user_id()?;
        let conn = self.db.connection();
        let mut stmt = conn.prepare(
            "SELECT s.id, s.user_id, s.note_id, s.sort_order, s.created_at FROM shortcuts s WHERE s.user_id = ?1 ORDER BY s.sort_order",
        )?;
        let rows = stmt.query_map(params![user_id.to_string()], |row| {
            Ok(Shortcut {
                id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                user_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                note_id: Uuid::parse_str(&row.get::<_, String>(2)?).unwrap(),
                sort_order: row.get(3)?,
                created_at: Self::parse_dt(&row.get::<_, String>(4)?).unwrap(),
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            let shortcut = row?;
            let notes = self.list_notes(None, None, false, None)?;
            if let Some(summary) = notes.into_iter().find(|n| n.id == shortcut.note_id) {
                result.push((shortcut, summary));
            }
        }
        Ok(result)
    }

    pub fn add_shortcut(&self, note_id: Uuid) -> Result<Shortcut> {
        self.get_note(note_id)?;
        let user_id = self.db.default_user_id()?;
        let id = Uuid::new_v4();
        let now = Self::now();
        self.db.connection().execute(
            "INSERT OR REPLACE INTO shortcuts (id, user_id, note_id, sort_order, created_at) VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM shortcuts WHERE user_id = ?2), ?4)",
            params![id.to_string(), user_id.to_string(), note_id.to_string(), now],
        )?;
        self.db
            .connection()
            .query_row(
                "SELECT id, user_id, note_id, sort_order, created_at FROM shortcuts WHERE user_id = ?1 AND note_id = ?2",
                params![user_id.to_string(), note_id.to_string()],
                |row| {
                    Ok(Shortcut {
                        id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                        user_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                        note_id: Uuid::parse_str(&row.get::<_, String>(2)?).unwrap(),
                        sort_order: row.get(3)?,
                        created_at: Self::parse_dt(&row.get::<_, String>(4)?).unwrap(),
                    })
                },
            )
            .map_err(PinbookError::from)
    }

    pub fn remove_shortcut(&self, note_id: Uuid) -> Result<()> {
        let user_id = self.db.default_user_id()?;
        self.db.connection().execute(
            "DELETE FROM shortcuts WHERE user_id = ?1 AND note_id = ?2",
            params![user_id.to_string(), note_id.to_string()],
        )?;
        Ok(())
    }

    // --- Search ---

    pub fn search(&self, query: SearchQuery) -> Result<SearchResult> {
        crate::search::search_notes(self, query)
    }
}

impl Default for UpdateNoteRequest {
    fn default() -> Self {
        Self {
            notebook_id: None,
            title: None,
            content: None,
            tag_ids: None,
            is_pinned: None,
            is_archived: None,
            reminder_at: None,
            source_url: None,
        }
    }
}
