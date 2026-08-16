use std::io::Read;
use std::path::Path;

use anyhow::{bail, Context, Result};
use pinbook_core::{
    Attachment, CreateNotebookRequest, CreateNoteRequest, CreateStackRequest, CreateTagRequest,
    EnexImportRequest, EnexImportResult, HealthResponse, Note, NoteRevision, NoteSummary,
    Notebook, SearchQuery, SearchResult, Stack, Tag, UpdateNoteRequest,
};
use uuid::Uuid;

pub struct ApiClient {
    base: String,
}

impl ApiClient {
    pub fn new(base: &str) -> Result<Self> {
        Ok(Self {
            base: base.trim_end_matches('/').to_string(),
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base, path)
    }

    fn get_json<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T> {
        let resp = ureq::get(&self.url(path)).call()?;
        resp.into_json().context("parse json")
    }

    fn post_json<T: serde::de::DeserializeOwned, B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        let resp = ureq::post(&self.url(path)).send_json(body)?;
        resp.into_json().context("parse json")
    }

    fn put_json<T: serde::de::DeserializeOwned, B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        let resp = ureq::put(&self.url(path)).send_json(body)?;
        resp.into_json().context("parse json")
    }

    fn delete(&self, path: &str) -> Result<()> {
        let resp = ureq::delete(&self.url(path)).call()?;
        if resp.status() >= 400 {
            bail!("delete failed: {}", resp.status());
        }
        Ok(())
    }

    pub fn info(&self, json_out: bool) -> Result<()> {
        let health: HealthResponse = self.get_json("/health")?;
        if json_out {
            println!("{}", serde_json::to_string_pretty(&health)?);
        } else {
            println!("Mode: api");
            println!("Server: {}", self.base);
            println!("Status: {}", health.status);
            println!("Database: {}", health.database);
        }
        Ok(())
    }

    pub fn list_notebooks(&self, json_out: bool) -> Result<()> {
        let notebooks: Vec<Notebook> = self.get_json("/api/v1/notebooks")?;
        print_json_or(notebooks, json_out, |nb| {
            for n in nb {
                println!("{} ({})", n.name, n.id);
            }
        })
    }

    pub fn create_notebook(&self, req: CreateNotebookRequest, json_out: bool) -> Result<()> {
        let nb: Notebook = self.post_json("/api/v1/notebooks", &req)?;
        print_json_or(nb, json_out, |n| println!("Created {} ({})", n.name, n.id))
    }

    pub fn delete_notebook(&self, id: Uuid) -> Result<()> {
        self.delete(&format!("/api/v1/notebooks/{id}"))?;
        println!("Deleted notebook {id}");
        Ok(())
    }

    pub fn list_tags(&self, json_out: bool) -> Result<()> {
        let tags: Vec<Tag> = self.get_json("/api/v1/tags")?;
        print_json_or(tags, json_out, |t| {
            for tag in t {
                println!("{} ({})", tag.name, tag.id);
            }
        })
    }

    pub fn create_tag(&self, req: CreateTagRequest, json_out: bool) -> Result<()> {
        let tag: Tag = self.post_json("/api/v1/tags", &req)?;
        print_json_or(tag, json_out, |t| println!("Created {} ({})", t.name, t.id))
    }

    pub fn delete_tag(&self, id: Uuid) -> Result<()> {
        self.delete(&format!("/api/v1/tags/{id}"))?;
        println!("Deleted tag {id}");
        Ok(())
    }

    pub fn get_or_create_tag(&self, name: &str) -> Result<Tag> {
        let tags: Vec<Tag> = self.get_json("/api/v1/tags")?;
        if let Some(tag) = tags.into_iter().find(|t| t.name == name) {
            return Ok(tag);
        }
        self.post_json(
            "/api/v1/tags",
            &CreateTagRequest {
                name: name.to_string(),
            },
        )
    }

    pub fn list_stacks(&self, json_out: bool) -> Result<()> {
        let stacks: Vec<Stack> = self.get_json("/api/v1/stacks")?;
        print_json_or(stacks, json_out, |s| {
            for stack in s {
                println!("{} ({})", stack.name, stack.id);
            }
        })
    }

    pub fn create_stack(&self, req: CreateStackRequest, json_out: bool) -> Result<()> {
        let stack: Stack = self.post_json("/api/v1/stacks", &req)?;
        print_json_or(stack, json_out, |s| println!("Created {} ({})", s.name, s.id))
    }

    pub fn delete_stack(&self, id: Uuid) -> Result<()> {
        self.delete(&format!("/api/v1/stacks/{id}"))?;
        println!("Deleted stack {id}");
        Ok(())
    }

    pub fn list_notes(
        &self,
        notebook: Option<Uuid>,
        tag: Option<Uuid>,
        archived: Option<bool>,
        json_out: bool,
    ) -> Result<()> {
        let mut path = String::from("/api/v1/notes");
        let mut qs = Vec::new();
        if let Some(nb) = notebook {
            qs.push(format!("notebook_id={nb}"));
        }
        if let Some(t) = tag {
            qs.push(format!("tag_id={t}"));
        }
        if let Some(a) = archived {
            qs.push(format!("archived={a}"));
        }
        if !qs.is_empty() {
            path = format!("{path}?{}", qs.join("&"));
        }
        let notes: Vec<NoteSummary> = self.get_json(&path)?;
        print_json_or(notes, json_out, |notes| {
            for note in notes {
                println!("{} — {} ({})", note.updated_at, note.title, note.id);
            }
        })
    }

    pub fn get_note(&self, id: Uuid, json_out: bool) -> Result<()> {
        let note: Note = self.get_json(&format!("/api/v1/notes/{id}"))?;
        print_json_or(note, json_out, |n| {
            println!("{}\n\n{}", n.title, n.content);
        })
    }

    pub fn create_note(&self, req: CreateNoteRequest, json_out: bool) -> Result<()> {
        let note: Note = self.post_json("/api/v1/notes", &req)?;
        print_json_or(note, json_out, |n| println!("Created {} ({})", n.title, n.id))
    }

    pub fn update_note(&self, id: Uuid, req: UpdateNoteRequest, json_out: bool) -> Result<()> {
        let note: Note = self.put_json(&format!("/api/v1/notes/{id}"), &req)?;
        print_json_or(note, json_out, |n| println!("Updated {} ({})", n.title, n.id))
    }

    pub fn delete_note(&self, id: Uuid) -> Result<()> {
        self.delete(&format!("/api/v1/notes/{id}"))?;
        println!("Moved note {id} to trash");
        Ok(())
    }

    pub fn restore_note(&self, id: Uuid, json_out: bool) -> Result<()> {
        let note: Note = self.post_json(&format!("/api/v1/notes/{id}/restore"), &serde_json::json!({}))?;
        print_json_or(note, json_out, |n| println!("Restored {} ({})", n.title, n.id))
    }

    pub fn list_revisions(&self, id: Uuid, json_out: bool) -> Result<()> {
        let revisions: Vec<NoteRevision> = self.get_json(&format!("/api/v1/notes/{id}/revisions"))?;
        print_json_or(revisions, json_out, |revs| {
            for rev in revs {
                println!("{} — {}", rev.created_at, rev.title);
            }
        })
    }

    pub fn attach_file(&self, note_id: Uuid, file: &Path) -> Result<()> {
        let filename = file
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("attachment");
        let data = std::fs::read(file)?;

        let boundary = "pinbookboundary";
        let mut body = Vec::new();
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n")
                .as_bytes(),
        );
        body.extend_from_slice(b"Content-Type: application/octet-stream\r\n\r\n");
        body.extend_from_slice(&data);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

        let resp = ureq::post(&self.url(&format!(
            "/api/v1/notes/{note_id}/attachments/upload"
        )))
        .set(
            "Content-Type",
            &format!("multipart/form-data; boundary={boundary}"),
        )
        .send_bytes(&body)?;

        let att: Attachment = resp.into_json()?;
        println!("Attached {} ({})", att.filename, att.id);
        Ok(())
    }

    pub fn search(&self, query: SearchQuery, json_out: bool) -> Result<()> {
        let mut path = format!("/api/v1/search?q={}", urlencoding(&query.q));
        if let Some(nb) = query.notebook_id {
            path.push_str(&format!("&notebook_id={nb}"));
        }
        if let Some(tag) = query.tag_id {
            path.push_str(&format!("&tag_id={tag}"));
        }
        if let Some(limit) = query.limit {
            path.push_str(&format!("&limit={limit}"));
        }
        let result: SearchResult = self.get_json(&path)?;
        print_json_or(result, json_out, |r| {
            println!("Found {}", r.total);
            for note in &r.notes {
                println!("{} — {}", note.title, note.id);
            }
        })
    }

    pub fn list_trash(&self, json_out: bool) -> Result<()> {
        let notes: Vec<NoteSummary> = self.get_json("/api/v1/notes?trash=true")?;
        print_json_or(notes, json_out, |notes| {
            for note in notes {
                println!("{} ({})", note.title, note.id);
            }
        })
    }

    pub fn empty_trash(&self) -> Result<()> {
        let resp = ureq::post(&self.url("/api/v1/trash/empty")).send_bytes(b"")?;
        let mut body = String::new();
        resp.into_reader().read_to_string(&mut body)?;
        let value: serde_json::Value = serde_json::from_str(&body)?;
        println!("Deleted {} notes", value["deleted"]);
        Ok(())
    }

    pub fn list_shortcuts(&self, json_out: bool) -> Result<()> {
        let notes: Vec<NoteSummary> = self.get_json("/api/v1/shortcuts")?;
        print_json_or(notes, json_out, |notes| {
            for note in notes {
                println!("{} ({})", note.title, note.id);
            }
        })
    }

    pub fn add_shortcut(&self, note_id: Uuid, json_out: bool) -> Result<()> {
        let shortcut: pinbook_core::Shortcut =
            self.post_json(&format!("/api/v1/shortcuts/{note_id}"), &serde_json::json!({}))?;
        print_json_or(shortcut, json_out, |_| {
            println!("Shortcut added for {note_id}");
        })
    }

    pub fn remove_shortcut(&self, note_id: Uuid) -> Result<()> {
        self.delete(&format!("/api/v1/shortcuts/{note_id}"))?;
        println!("Shortcut removed for {note_id}");
        Ok(())
    }

    pub fn import_enex(
        &self,
        path: &Path,
        options: EnexImportRequest,
        json_out: bool,
    ) -> Result<()> {
        let data = std::fs::read(path)?;
        let boundary = "pinbookboundary";
        let filename = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("import.enex");

        let mut query = Vec::new();
        if let Some(id) = options.notebook_id {
            query.push(format!("notebook_id={id}"));
        }
        if let Some(name) = &options.notebook_name {
            query.push(format!("notebook_name={}", urlencoding(name)));
        }
        if let Some(stack) = options.stack_id {
            query.push(format!("stack_id={stack}"));
        }
        let query_str = if query.is_empty() {
            String::new()
        } else {
            format!("?{}", query.join("&"))
        };

        let mut body = Vec::new();
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n")
                .as_bytes(),
        );
        body.extend_from_slice(b"Content-Type: application/xml\r\n\r\n");
        body.extend_from_slice(&data);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

        let resp = ureq::post(&format!(
            "{}/api/v1/import/enex{query_str}",
            self.base
        ))
        .set(
            "Content-Type",
            &format!("multipart/form-data; boundary={boundary}"),
        )
        .send_bytes(&body)?;

        let result: EnexImportResult = resp.into_json()?;
        print_json_or(result, json_out, |r| {
            println!(
                "Imported {} notes into '{}' ({} skipped)",
                r.imported, r.notebook_name, r.skipped
            );
            for err in &r.errors {
                println!("  error[{}]: {}", err.index, err.message);
            }
        })
    }
}

fn print_json_or<T: serde::Serialize, F: FnOnce(&T)>(
    value: T,
    json_out: bool,
    text: F,
) -> Result<()> {
    if json_out {
        println!("{}", serde_json::to_string_pretty(&value)?);
    } else {
        text(&value);
    }
    Ok(())
}

fn urlencoding(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            ' ' => "+".to_string(),
            c if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' || c == '~' => {
                c.to_string()
            }
            c => format!("%{:02X}", c as u8),
        })
        .collect()
}
