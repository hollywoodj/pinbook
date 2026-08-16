use anyhow::Result;
use pinbook_core::{
    CreateNotebookRequest, CreateStackRequest, CreateTagRequest, CreateNoteRequest, PinbookService,
    EnexImportRequest, EnexImportResult, SearchQuery, UpdateNoteRequest,
};
use uuid::Uuid;

use crate::{
    ImportAction, NotebookAction, NoteAction, ShortcutAction, StackAction, TagAction, TrashAction,
};

pub fn import(service: &PinbookService, action: &ImportAction, json_out: bool) -> Result<()> {
    match action {
        ImportAction::Enex {
            path,
            notebook,
            notebook_name,
            stack,
        } => {
            let options = EnexImportRequest {
                notebook_id: *notebook,
                notebook_name: notebook_name.clone(),
                stack_id: *stack,
            };
            let results = if path.is_dir() {
                let mut combined: Option<EnexImportResult> = None;
                for entry in std::fs::read_dir(path)? {
                    let entry = entry?;
                    let file_path = entry.path();
                    if file_path.extension().and_then(|s| s.to_str()) == Some("enex") {
                        let result = service.import_enex_file(&file_path, options.clone())?;
                        combined = Some(match combined {
                            Some(mut acc) => {
                                acc.imported += result.imported;
                                acc.skipped += result.skipped;
                                acc.errors.extend(result.errors);
                                acc
                            }
                            None => result,
                        });
                    }
                }
                combined.ok_or_else(|| anyhow::anyhow!("no .enex files found in directory"))?
            } else {
                service.import_enex_file(path, options)?
            };

            if json_out {
                println!("{}", serde_json::to_string_pretty(&results)?);
            } else {
                println!(
                    "Imported {} notes into '{}' ({} skipped)",
                    results.imported, results.notebook_name, results.skipped
                );
                for err in &results.errors {
                    println!("  error[{}]: {}", err.index, err.message);
                }
            }
        }
    }
    Ok(())
}

pub fn print_info(service: &PinbookService, json_out: bool) -> Result<()> {
    let path = service
        .db()
        .connection()
        .path()
        .unwrap_or("memory")
        .to_string();
    if json_out {
        println!(
            "{}",
            serde_json::json!({
                "mode": "local",
                "database": path,
            })
        );
    } else {
        println!("Mode: local");
        println!("Database: {path}");
    }
    Ok(())
}

pub fn note(service: &PinbookService, action: &NoteAction, json_out: bool) -> Result<()> {
    match action {
        NoteAction::List {
            notebook,
            tag,
            archived,
        } => {
            let notes = service.list_notes(*notebook, *tag, false, *archived)?;
            print_notes(&notes, json_out);
        }
        NoteAction::Get { id } => {
            let note = service.get_note(*id)?;
            if json_out {
                println!("{}", serde_json::to_string_pretty(&note)?);
            } else {
                println!("{} ({})", note.title, note.id);
                println!("Updated: {}", note.updated_at);
                println!("\n{}", note.content);
            }
        }
        NoteAction::Create {
            notebook,
            title,
            content,
            file,
            tags,
            pinned,
        } => {
            let content = if let Some(path) = file {
                std::fs::read_to_string(path)?
            } else {
                content.clone().unwrap_or_default()
            };
            let tag_ids = parse_local_tags(service, tags.as_deref())?;
            let note = service.create_note(CreateNoteRequest {
                notebook_id: *notebook,
                title: Some(title.clone()),
                content: Some(content),
                tag_ids,
                is_pinned: Some(*pinned),
                reminder_at: None,
                source_url: None,
            })?;
            if json_out {
                println!("{}", serde_json::to_string_pretty(&note)?);
            } else {
                println!("Created note {} ({})", note.title, note.id);
            }
        }
        NoteAction::Update {
            id,
            title,
            content,
            notebook,
            pinned,
            archived,
        } => {
            let note = service.update_note(
                *id,
                UpdateNoteRequest {
                    notebook_id: *notebook,
                    title: title.clone(),
                    content: content.clone(),
                    tag_ids: None,
                    is_pinned: *pinned,
                    is_archived: *archived,
                    reminder_at: None,
                    source_url: None,
                },
            )?;
            if json_out {
                println!("{}", serde_json::to_string_pretty(&note)?);
            } else {
                println!("Updated note {} ({})", note.title, note.id);
            }
        }
        NoteAction::Delete { id } => {
            service.delete_note(*id)?;
            println!("Moved note {id} to trash");
        }
        NoteAction::Restore { id } => {
            let note = service.restore_note(*id)?;
            if json_out {
                println!("{}", serde_json::to_string_pretty(&note)?);
            } else {
                println!("Restored note {} ({})", note.title, note.id);
            }
        }
        NoteAction::Revisions { id } => {
            let revisions = service.list_revisions(*id)?;
            if json_out {
                println!("{}", serde_json::to_string_pretty(&revisions)?);
            } else {
                for rev in revisions {
                    println!("{} — {} ({})", rev.created_at, rev.title, rev.id);
                }
            }
        }
        NoteAction::Attach { id, file } => {
            let filename = file
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("attachment")
                .to_string();
            let data = std::fs::read(file)?;
            let mime = mime_guess(&filename);
            let att = service.add_attachment(*id, filename, mime, &data)?;
            if json_out {
                println!("{}", serde_json::to_string_pretty(&att)?);
            } else {
                println!("Attached {} ({})", att.filename, att.id);
            }
        }
    }
    Ok(())
}

pub fn notebook(
    service: &PinbookService,
    action: &NotebookAction,
    json_out: bool,
) -> Result<()> {
    match action {
        NotebookAction::List => {
            let notebooks = service.list_notebooks(false)?;
            if json_out {
                println!("{}", serde_json::to_string_pretty(&notebooks)?);
            } else {
                for nb in notebooks {
                    println!("{} — {} ({})", nb.name, nb.id, nb.sort_order);
                }
            }
        }
        NotebookAction::Create { name, stack } => {
            let nb = service.create_notebook(CreateNotebookRequest {
                name: name.clone(),
                stack_id: *stack,
                is_default: None,
            })?;
            if json_out {
                println!("{}", serde_json::to_string_pretty(&nb)?);
            } else {
                println!("Created notebook {} ({})", nb.name, nb.id);
            }
        }
        NotebookAction::Delete { id } => {
            service.delete_notebook(*id)?;
            println!("Deleted notebook {id}");
        }
    }
    Ok(())
}

pub fn tag(service: &PinbookService, action: &TagAction, json_out: bool) -> Result<()> {
    match action {
        TagAction::List => {
            let tags = service.list_tags()?;
            if json_out {
                println!("{}", serde_json::to_string_pretty(&tags)?);
            } else {
                for tag in tags {
                    println!("{} ({})", tag.name, tag.id);
                }
            }
        }
        TagAction::Create { name } => {
            let tag = service.create_tag(CreateTagRequest { name: name.clone() })?;
            if json_out {
                println!("{}", serde_json::to_string_pretty(&tag)?);
            } else {
                println!("Created tag {} ({})", tag.name, tag.id);
            }
        }
        TagAction::Delete { id } => {
            service.delete_tag(*id)?;
            println!("Deleted tag {id}");
        }
    }
    Ok(())
}

pub fn stack(service: &PinbookService, action: &StackAction, json_out: bool) -> Result<()> {
    match action {
        StackAction::List => {
            let stacks = service.list_stacks()?;
            if json_out {
                println!("{}", serde_json::to_string_pretty(&stacks)?);
            } else {
                for stack in stacks {
                    println!("{} ({})", stack.name, stack.id);
                }
            }
        }
        StackAction::Create { name } => {
            let stack = service.create_stack(CreateStackRequest { name: name.clone() })?;
            if json_out {
                println!("{}", serde_json::to_string_pretty(&stack)?);
            } else {
                println!("Created stack {} ({})", stack.name, stack.id);
            }
        }
        StackAction::Delete { id } => {
            service.delete_stack(*id)?;
            println!("Deleted stack {id}");
        }
    }
    Ok(())
}

pub fn search(service: &PinbookService, query: SearchQuery, json_out: bool) -> Result<()> {
    let result = service.search(query)?;
    if json_out {
        println!("{}", serde_json::to_string_pretty(&result)?);
    } else {
        println!("Found {} notes", result.total);
        print_notes(&result.notes, false);
    }
    Ok(())
}

pub fn trash(service: &PinbookService, action: &TrashAction, json_out: bool) -> Result<()> {
    match action {
        TrashAction::List => {
            let notes = service.list_notes(None, None, true, None)?;
            print_notes(&notes, json_out);
        }
        TrashAction::Empty => {
            let count = service.empty_trash()?;
            println!("Permanently deleted {count} notes");
        }
    }
    Ok(())
}

pub fn shortcut(
    service: &PinbookService,
    action: &ShortcutAction,
    json_out: bool,
) -> Result<()> {
    match action {
        ShortcutAction::List => {
            let shortcuts = service.list_shortcuts()?;
            let notes: Vec<_> = shortcuts.into_iter().map(|(_, n)| n).collect();
            print_notes(&notes, json_out);
        }
        ShortcutAction::Add { note_id } => {
            let shortcut = service.add_shortcut(*note_id)?;
            if json_out {
                println!("{}", serde_json::to_string_pretty(&shortcut)?);
            } else {
                println!("Shortcut added for note {note_id}");
            }
        }
        ShortcutAction::Remove { note_id } => {
            service.remove_shortcut(*note_id)?;
            println!("Shortcut removed for note {note_id}");
        }
    }
    Ok(())
}

fn parse_local_tags(
    service: &PinbookService,
    tags: Option<&str>,
) -> Result<Option<Vec<Uuid>>> {
    let Some(names) = tags else {
        return Ok(None);
    };
    let mut ids = Vec::new();
    for name in names.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        let tag = service.get_or_create_tag_by_name(name)?;
        ids.push(tag.id);
    }
    Ok(Some(ids))
}

fn print_notes(notes: &[pinbook_core::NoteSummary], json_out: bool) {
    if json_out {
        println!("{}", serde_json::to_string_pretty(notes).unwrap_or_default());
        return;
    }
    for note in notes {
        let tags = if note.tag_names.is_empty() {
            String::new()
        } else {
            format!(" [{}]", note.tag_names.join(", "))
        };
        println!(
            "{} — {}{} ({})",
            note.updated_at.format("%Y-%m-%d"),
            note.title,
            tags,
            note.id
        );
    }
}

fn mime_guess(filename: &str) -> String {
    let lower = filename.to_lowercase();
    if lower.ends_with(".png") {
        "image/png".into()
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg".into()
    } else if lower.ends_with(".pdf") {
        "application/pdf".into()
    } else if lower.ends_with(".txt") {
        "text/plain".into()
    } else if lower.ends_with(".html") {
        "text/html".into()
    } else {
        "application/octet-stream".into()
    }
}
