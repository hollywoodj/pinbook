use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stack {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notebook {
    pub id: Uuid,
    pub user_id: Uuid,
    pub stack_id: Option<Uuid>,
    pub name: String,
    pub is_default: bool,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: Uuid,
    pub user_id: Uuid,
    pub notebook_id: Uuid,
    pub title: String,
    pub content: String,
    pub content_plain: String,
    pub is_pinned: bool,
    pub is_archived: bool,
    pub reminder_at: Option<DateTime<Utc>>,
    pub source_url: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteSummary {
    pub id: Uuid,
    pub notebook_id: Uuid,
    pub title: String,
    pub snippet: String,
    pub is_pinned: bool,
    pub is_archived: bool,
    pub reminder_at: Option<DateTime<Utc>>,
    pub tag_ids: Vec<Uuid>,
    pub tag_names: Vec<String>,
    pub attachment_count: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub id: Uuid,
    pub note_id: Uuid,
    pub filename: String,
    pub mime_type: String,
    pub size: i64,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteRevision {
    pub id: Uuid,
    pub note_id: Uuid,
    pub title: String,
    pub content: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shortcut {
    pub id: Uuid,
    pub user_id: Uuid,
    pub note_id: Uuid,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateNoteRequest {
    pub notebook_id: Uuid,
    pub title: Option<String>,
    pub content: Option<String>,
    pub tag_ids: Option<Vec<Uuid>>,
    pub is_pinned: Option<bool>,
    pub reminder_at: Option<DateTime<Utc>>,
    pub source_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateNoteRequest {
    pub notebook_id: Option<Uuid>,
    pub title: Option<String>,
    pub content: Option<String>,
    pub tag_ids: Option<Vec<Uuid>>,
    pub is_pinned: Option<bool>,
    pub is_archived: Option<bool>,
    pub reminder_at: Option<Option<DateTime<Utc>>>,
    pub source_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateNotebookRequest {
    pub name: String,
    pub stack_id: Option<Uuid>,
    pub is_default: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateNotebookRequest {
    pub name: Option<String>,
    pub stack_id: Option<Option<Uuid>>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateStackRequest {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTagRequest {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQuery {
    pub q: String,
    pub notebook_id: Option<Uuid>,
    pub tag_id: Option<Uuid>,
    pub include_trash: Option<bool>,
    pub include_archived: Option<bool>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub notes: Vec<NoteSummary>,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncCheckpoint {
    pub last_sync_at: DateTime<Utc>,
    pub notes_updated: i32,
    pub notebooks_updated: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub database: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnexImportRequest {
    pub notebook_id: Option<Uuid>,
    pub notebook_name: Option<String>,
    pub stack_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnexImportResult {
    pub imported: u32,
    pub skipped: u32,
    pub notebook_id: Uuid,
    pub notebook_name: String,
    pub errors: Vec<ImportError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportError {
    pub index: usize,
    pub title: Option<String>,
    pub message: String,
}
