mod api_client;
mod local;

use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand};
use pinbook_core::{
    CreateNotebookRequest, CreateNoteRequest, CreateStackRequest, CreateTagRequest, Database,
    EnexImportRequest, PinbookService, SearchQuery, UpdateNoteRequest,
};
use uuid::Uuid;

use crate::api_client::ApiClient;

#[derive(Parser)]
#[command(name = "pinbook", about = "Pinbook CLI — Evernote-compatible notes for your stack", version)]
struct Cli {
    /// Path to local SQLite database (local mode)
    #[arg(long, env = "PINBOOK_DB", global = true)]
    db: Option<PathBuf>,

    /// Remote API base URL (e.g. http://127.0.0.1:8787). When set, all commands use the API.
    #[arg(long, env = "PINBOOK_API", default_value = "", global = true)]
    api: String,

    /// Output format: text or json
    #[arg(long, default_value = "text", global = true)]
    output: String,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Show connection info
    Info,
    /// Note operations
    Note {
        #[command(subcommand)]
        action: NoteAction,
    },
    /// Notebook operations
    Notebook {
        #[command(subcommand)]
        action: NotebookAction,
    },
    /// Tag operations
    Tag {
        #[command(subcommand)]
        action: TagAction,
    },
    /// Stack operations
    Stack {
        #[command(subcommand)]
        action: StackAction,
    },
    /// Full-text search
    Search {
        query: String,
        #[arg(long)]
        notebook: Option<Uuid>,
        #[arg(long)]
        tag: Option<Uuid>,
        #[arg(long)]
        limit: Option<u32>,
    },
    /// Trash operations
    Trash {
        #[command(subcommand)]
        action: TrashAction,
    },
    /// Shortcut operations
    Shortcut {
        #[command(subcommand)]
        action: ShortcutAction,
    },
    /// Import notes from external formats
    Import {
        #[command(subcommand)]
        action: ImportAction,
    },
}

#[derive(Subcommand)]
enum ImportAction {
    /// Import notes from an Evernote ENEX export file
    Enex {
        /// Path to .enex file (or directory of .enex files)
        path: PathBuf,
        #[arg(long)]
        notebook: Option<Uuid>,
        #[arg(long)]
        notebook_name: Option<String>,
        #[arg(long)]
        stack: Option<Uuid>,
    },
}

#[derive(Subcommand)]
enum NoteAction {
    List {
        #[arg(long)]
        notebook: Option<Uuid>,
        #[arg(long)]
        tag: Option<Uuid>,
        #[arg(long)]
        archived: Option<bool>,
    },
    Get { id: Uuid },
    Create {
        #[arg(long)]
        notebook: Uuid,
        #[arg(long, default_value = "Untitled")]
        title: String,
        #[arg(long)]
        content: Option<String>,
        #[arg(long)]
        file: Option<PathBuf>,
        #[arg(long)]
        tags: Option<String>,
        #[arg(long)]
        pinned: bool,
    },
    Update {
        id: Uuid,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        content: Option<String>,
        #[arg(long)]
        notebook: Option<Uuid>,
        #[arg(long)]
        pinned: Option<bool>,
        #[arg(long)]
        archived: Option<bool>,
    },
    Delete { id: Uuid },
    Restore { id: Uuid },
    Revisions { id: Uuid },
    Attach {
        id: Uuid,
        file: PathBuf,
    },
}

#[derive(Subcommand)]
enum NotebookAction {
    List,
    Create {
        name: String,
        #[arg(long)]
        stack: Option<Uuid>,
    },
    Delete { id: Uuid },
}

#[derive(Subcommand)]
enum TagAction {
    List,
    Create { name: String },
    Delete { id: Uuid },
}

#[derive(Subcommand)]
enum StackAction {
    List,
    Create { name: String },
    Delete { id: Uuid },
}

#[derive(Subcommand)]
enum TrashAction {
    List,
    Empty,
}

#[derive(Subcommand)]
enum ShortcutAction {
    List,
    Add { note_id: Uuid },
    Remove { note_id: Uuid },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let json_out = cli.output.eq_ignore_ascii_case("json");

    if !cli.api.is_empty() {
        let client = ApiClient::new(&cli.api)?;
        run_api(&cli, &client, json_out)
    } else {
        let db = match &cli.db {
            Some(path) => Database::open(path)?,
            None => Database::open_default()?,
        };
        let service = PinbookService::new(db);
        run_local(&cli, &service, json_out)
    }
}

fn run_local(cli: &Cli, service: &PinbookService, json_out: bool) -> Result<()> {
    match &cli.command {
        Commands::Info => local::print_info(service, json_out),
        Commands::Note { action } => local::note(service, action, json_out),
        Commands::Notebook { action } => local::notebook(service, action, json_out),
        Commands::Tag { action } => local::tag(service, action, json_out),
        Commands::Stack { action } => local::stack(service, action, json_out),
        Commands::Search {
            query,
            notebook,
            tag,
            limit,
        } => local::search(
            service,
            SearchQuery {
                q: query.clone(),
                notebook_id: *notebook,
                tag_id: *tag,
                include_trash: Some(false),
                include_archived: Some(true),
                limit: *limit,
                offset: None,
            },
            json_out,
        ),
        Commands::Trash { action } => local::trash(service, action, json_out),
        Commands::Shortcut { action } => local::shortcut(service, action, json_out),
        Commands::Import { action } => local::import(service, action, json_out),
    }
}

fn run_api(cli: &Cli, client: &ApiClient, json_out: bool) -> Result<()> {
    match &cli.command {
        Commands::Info => client.info(json_out),
        Commands::Note { action } => match action {
            NoteAction::List {
                notebook,
                tag,
                archived,
            } => client.list_notes(*notebook, *tag, *archived, json_out),
            NoteAction::Get { id } => client.get_note(*id, json_out),
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
                let tag_ids = parse_tag_names(client, tags.as_deref())?;
                client.create_note(
                    CreateNoteRequest {
                        notebook_id: *notebook,
                        title: Some(title.clone()),
                        content: Some(content),
                        tag_ids,
                        is_pinned: Some(*pinned),
                        reminder_at: None,
                        source_url: None,
                    },
                    json_out,
                )
            }
            NoteAction::Update {
                id,
                title,
                content,
                notebook,
                pinned,
                archived,
            } => client.update_note(
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
                json_out,
            ),
            NoteAction::Delete { id } => client.delete_note(*id),
            NoteAction::Restore { id } => client.restore_note(*id, json_out),
            NoteAction::Revisions { id } => client.list_revisions(*id, json_out),
            NoteAction::Attach { id, file } => client.attach_file(*id, file),
        },
        Commands::Notebook { action } => match action {
            NotebookAction::List => client.list_notebooks(json_out),
            NotebookAction::Create { name, stack } => client.create_notebook(
                CreateNotebookRequest {
                    name: name.clone(),
                    stack_id: *stack,
                    is_default: None,
                },
                json_out,
            ),
            NotebookAction::Delete { id } => client.delete_notebook(*id),
        },
        Commands::Tag { action } => match action {
            TagAction::List => client.list_tags(json_out),
            TagAction::Create { name } => {
                client.create_tag(CreateTagRequest { name: name.clone() }, json_out)
            }
            TagAction::Delete { id } => client.delete_tag(*id),
        },
        Commands::Stack { action } => match action {
            StackAction::List => client.list_stacks(json_out),
            StackAction::Create { name } => {
                client.create_stack(CreateStackRequest { name: name.clone() }, json_out)
            }
            StackAction::Delete { id } => client.delete_stack(*id),
        },
        Commands::Search {
            query,
            notebook,
            tag,
            limit,
        } => client.search(
            SearchQuery {
                q: query.clone(),
                notebook_id: *notebook,
                tag_id: *tag,
                include_trash: Some(false),
                include_archived: Some(true),
                limit: *limit,
                offset: None,
            },
            json_out,
        ),
        Commands::Trash { action } => match action {
            TrashAction::List => client.list_trash(json_out),
            TrashAction::Empty => client.empty_trash(),
        },
        Commands::Shortcut { action } => match action {
            ShortcutAction::List => client.list_shortcuts(json_out),
            ShortcutAction::Add { note_id } => client.add_shortcut(*note_id, json_out),
            ShortcutAction::Remove { note_id } => client.remove_shortcut(*note_id),
        },
        Commands::Import { action } => match action {
            ImportAction::Enex {
                path,
                notebook,
                notebook_name,
                stack,
            } => client.import_enex(
                path,
                EnexImportRequest {
                    notebook_id: *notebook,
                    notebook_name: notebook_name.clone(),
                    stack_id: *stack,
                },
                json_out,
            ),
        },
    }
}

fn parse_tag_names(client: &ApiClient, tags: Option<&str>) -> Result<Option<Vec<Uuid>>> {
    let Some(names) = tags else {
        return Ok(None);
    };
    let mut ids = Vec::new();
    for name in names.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        let tag = client.get_or_create_tag(name)?;
        ids.push(tag.id);
    }
    Ok(Some(ids))
}
