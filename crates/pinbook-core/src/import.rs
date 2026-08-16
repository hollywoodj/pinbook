pub mod enex;

use std::path::Path;

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::error::{PinbookError, Result};
use crate::models::{CreateNoteRequest, EnexImportRequest, EnexImportResult, ImportError};
use crate::service::PinbookService;

use self::enex::{parse_enex, EnexNote};

impl PinbookService {
    pub fn import_enex(&self, data: &[u8], options: EnexImportRequest) -> Result<EnexImportResult> {
        let parsed = parse_enex(data)?;
        let notebook_id = self.resolve_import_notebook(&options)?;
        let mut imported = 0u32;
        let mut skipped = 0u32;
        let mut errors = Vec::new();

        for (index, enex_note) in parsed.notes.into_iter().enumerate() {
            match self.import_enex_note(notebook_id, enex_note) {
                Ok(()) => imported += 1,
                Err(e) => {
                    skipped += 1;
                    errors.push(ImportError {
                        index,
                        title: None,
                        message: e.to_string(),
                    });
                }
            }
        }

        Ok(EnexImportResult {
            imported,
            skipped,
            notebook_id,
            notebook_name: self.get_notebook(notebook_id)?.name,
            errors,
        })
    }

    pub fn import_enex_file(&self, path: &Path, options: EnexImportRequest) -> Result<EnexImportResult> {
        let data = std::fs::read(path).map_err(PinbookError::from)?;
        let mut options = options;
        if options.notebook_name.is_none() {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                options.notebook_name = Some(stem.to_string());
            }
        }
        self.import_enex(&data, options)
    }

    fn resolve_import_notebook(&self, options: &EnexImportRequest) -> Result<Uuid> {
        if let Some(id) = options.notebook_id {
            self.get_notebook(id)?;
            return Ok(id);
        }

        let name = options
            .notebook_name
            .clone()
            .unwrap_or_else(|| "Imported".to_string());

        let notebooks = self.list_notebooks(false)?;
        if let Some(existing) = notebooks.into_iter().find(|nb| nb.name == name) {
            return Ok(existing.id);
        }

        let notebook = self.create_notebook(crate::models::CreateNotebookRequest {
            name,
            stack_id: options.stack_id,
            is_default: Some(false),
        })?;
        Ok(notebook.id)
    }

    fn import_enex_note(&self, notebook_id: Uuid, note: EnexNote) -> Result<()> {
        let tag_ids: Vec<Uuid> = note
            .tags
            .iter()
            .map(|name| self.get_or_create_tag_by_name(name))
            .collect::<Result<Vec<_>>>()?
            .into_iter()
            .map(|t| t.id)
            .collect();

        let html = enex::enml_to_html(&note.content, &note.resources)?;

        let mut created = self.create_note(CreateNoteRequest {
            notebook_id,
            title: Some(note.title),
            content: Some(html),
            tag_ids: Some(tag_ids),
            is_pinned: None,
            reminder_at: note.reminder_at,
            source_url: note.source_url,
        })?;

        if let (Some(created_at), Some(updated_at)) = (note.created, note.updated) {
            self.set_note_timestamps(created.id, created_at, updated_at)?;
            created.created_at = created_at;
            created.updated_at = updated_at;
        }

        for resource in note.resources {
            if resource.mime.starts_with("image/") {
                continue;
            }
            self.add_attachment(
                created.id,
                resource
                    .filename
                    .unwrap_or_else(|| "attachment".to_string()),
                resource.mime,
                &resource.data,
            )?;
        }

        Ok(())
    }

    fn set_note_timestamps(&self, id: Uuid, created_at: DateTime<Utc>, updated_at: DateTime<Utc>) -> Result<()> {
        self.db().connection().execute(
            "UPDATE notes SET created_at = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![created_at.to_rfc3339(), updated_at.to_rfc3339(), id.to_string()],
        )?;
        Ok(())
    }
}
