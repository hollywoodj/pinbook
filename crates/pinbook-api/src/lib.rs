use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    extract::{Multipart, Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use pinbook_core::{
    CreateNotebookRequest, CreateNoteRequest, CreateStackRequest, CreateTagRequest, Database,
    EnexImportRequest, HealthResponse, PinbookService, SearchQuery, UpdateNoteRequest,
    UpdateNotebookRequest,
};
use serde::Deserialize;
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use uuid::Uuid;

pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub db_path: Option<String>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: std::env::var("PINBOOK_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            port: std::env::var("PINBOOK_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(8787),
            db_path: std::env::var("PINBOOK_DB").ok(),
        }
    }
}

pub fn init_tracing() {
    let _ = tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "pinbook_api=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .try_init();
}

pub async fn run(config: ServerConfig) -> anyhow::Result<()> {
    let db_path = config.db_path.unwrap_or_else(|| {
        dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("pinbook")
            .join("pinbook.db")
            .to_string_lossy()
            .to_string()
    });

    let db = Database::open(&db_path)?;
    let service = PinbookService::new(db);
    let state = AppState {
        service: Arc::new(Mutex::new(service)),
    };

    let app = build_router(state);

    let addr: SocketAddr = format!("{}:{}", config.host, config.port).parse()?;
    tracing::info!("Pinbook API listening on http://{addr}");
    tracing::info!("Database: {db_path}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/v1/notebooks", get(list_notebooks).post(create_notebook))
        .route(
            "/api/v1/notebooks/:id",
            get(get_notebook)
                .put(update_notebook)
                .delete(delete_notebook),
        )
        .route("/api/v1/notebooks/:id/restore", post(restore_notebook))
        .route("/api/v1/stacks", get(list_stacks).post(create_stack))
        .route("/api/v1/stacks/:id", get(get_stack).delete(delete_stack))
        .route("/api/v1/tags", get(list_tags).post(create_tag))
        .route("/api/v1/tags/:id", get(get_tag).delete(delete_tag))
        .route("/api/v1/notes", get(list_notes).post(create_note))
        .route(
            "/api/v1/notes/:id",
            get(get_note).put(update_note).delete(delete_note),
        )
        .route("/api/v1/notes/:id/restore", post(restore_note))
        .route(
            "/api/v1/notes/:id/permanent",
            delete(permanently_delete_note),
        )
        .route("/api/v1/notes/:id/revisions", get(list_revisions))
        .route(
            "/api/v1/notes/:id/revisions/:revision_id/restore",
            post(restore_revision),
        )
        .route("/api/v1/notes/:id/attachments", get(list_attachments))
        .route(
            "/api/v1/notes/:id/attachments/upload",
            post(upload_attachment),
        )
        .route("/api/v1/attachments/:id", get(download_attachment))
        .route("/api/v1/attachments/:id/meta", get(get_attachment))
        .route("/api/v1/attachments/:id", delete(delete_attachment))
        .route("/api/v1/shortcuts", get(list_shortcuts))
        .route("/api/v1/shortcuts/:note_id", post(add_shortcut))
        .route("/api/v1/shortcuts/:note_id", delete(remove_shortcut))
        .route("/api/v1/search", get(search))
        .route("/api/v1/trash/empty", post(empty_trash))
        .route("/api/v1/import/enex", post(import_enex))
        .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

#[derive(Clone)]
struct AppState {
    service: Arc<Mutex<PinbookService>>,
}

#[derive(Debug, Deserialize)]
struct ListNotesQuery {
    notebook_id: Option<Uuid>,
    tag_id: Option<Uuid>,
    trash: Option<bool>,
    archived: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ListNotebooksQuery {
    include_deleted: Option<bool>,
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let svc = state.service.lock().await;
    Json(HealthResponse {
        status: "ok".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        database: svc.db().connection().path().unwrap_or("memory").to_string(),
    })
}

async fn list_notebooks(
    State(state): State<AppState>,
    Query(q): Query<ListNotebooksQuery>,
) -> Result<Json<Vec<pinbook_core::Notebook>>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.list_notebooks(q.include_deleted.unwrap_or(false))?))
}

async fn create_notebook(
    State(state): State<AppState>,
    Json(req): Json<CreateNotebookRequest>,
) -> Result<Json<pinbook_core::Notebook>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.create_notebook(req)?))
}

async fn get_notebook(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<pinbook_core::Notebook>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.get_notebook(id)?))
}

async fn update_notebook(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateNotebookRequest>,
) -> Result<Json<pinbook_core::Notebook>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.update_notebook(id, req)?))
}

async fn delete_notebook(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let svc = state.service.lock().await;
    svc.delete_notebook(id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn restore_notebook(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<pinbook_core::Notebook>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.restore_notebook(id)?))
}

async fn list_stacks(
    State(state): State<AppState>,
) -> Result<Json<Vec<pinbook_core::Stack>>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.list_stacks()?))
}

async fn create_stack(
    State(state): State<AppState>,
    Json(req): Json<CreateStackRequest>,
) -> Result<Json<pinbook_core::Stack>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.create_stack(req)?))
}

async fn get_stack(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<pinbook_core::Stack>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.get_stack(id)?))
}

async fn delete_stack(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let svc = state.service.lock().await;
    svc.delete_stack(id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_tags(
    State(state): State<AppState>,
) -> Result<Json<Vec<pinbook_core::Tag>>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.list_tags()?))
}

async fn create_tag(
    State(state): State<AppState>,
    Json(req): Json<CreateTagRequest>,
) -> Result<Json<pinbook_core::Tag>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.create_tag(req)?))
}

async fn get_tag(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<pinbook_core::Tag>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.get_tag(id)?))
}

async fn delete_tag(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let svc = state.service.lock().await;
    svc.delete_tag(id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_notes(
    State(state): State<AppState>,
    Query(q): Query<ListNotesQuery>,
) -> Result<Json<Vec<pinbook_core::NoteSummary>>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.list_notes(
        q.notebook_id,
        q.tag_id,
        q.trash.unwrap_or(false),
        q.archived,
    )?))
}

async fn create_note(
    State(state): State<AppState>,
    Json(req): Json<CreateNoteRequest>,
) -> Result<Json<pinbook_core::Note>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.create_note(req)?))
}

async fn get_note(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<pinbook_core::Note>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.get_note(id)?))
}

async fn update_note(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateNoteRequest>,
) -> Result<Json<pinbook_core::Note>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.update_note(id, req)?))
}

async fn delete_note(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let svc = state.service.lock().await;
    svc.delete_note(id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn restore_note(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<pinbook_core::Note>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.restore_note(id)?))
}

async fn permanently_delete_note(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let svc = state.service.lock().await;
    svc.permanently_delete_note(id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_revisions(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<pinbook_core::NoteRevision>>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.list_revisions(id)?))
}

async fn restore_revision(
    State(state): State<AppState>,
    Path((id, revision_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<pinbook_core::Note>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.restore_revision(id, revision_id)?))
}

async fn list_attachments(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<pinbook_core::Attachment>>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.list_attachments(id)?))
}

async fn upload_attachment(
    State(state): State<AppState>,
    Path(note_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<Json<pinbook_core::Attachment>, AppError> {
    let mut filename = String::from("attachment");
    let mut mime = String::from("application/octet-stream");
    let mut data = Vec::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::bad_request(e.to_string()))?
    {
        let name = field.name().unwrap_or("").to_string();
        if name == "filename" {
            filename = field.text().await.unwrap_or_default();
        } else if name == "file" {
            if let Some(ct) = field.content_type() {
                mime = ct.to_string();
            }
            data = field
                .bytes()
                .await
                .map_err(|e| AppError::bad_request(e.to_string()))?
                .to_vec();
        }
    }

    let svc = state.service.lock().await;
    Ok(Json(svc.add_attachment(note_id, filename, mime, &data)?))
}

async fn get_attachment(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<pinbook_core::Attachment>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.get_attachment(id)?))
}

async fn download_attachment(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Response, AppError> {
    let svc = state.service.lock().await;
    let att = svc.get_attachment(id)?;
    let data = svc.read_attachment_data(id)?;
    Ok((
        [
            (header::CONTENT_TYPE, att.mime_type),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{}\"", att.filename),
            ),
        ],
        data,
    )
        .into_response())
}

async fn delete_attachment(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let svc = state.service.lock().await;
    svc.delete_attachment(id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_shortcuts(
    State(state): State<AppState>,
) -> Result<Json<Vec<pinbook_core::NoteSummary>>, AppError> {
    let svc = state.service.lock().await;
    let shortcuts = svc.list_shortcuts()?;
    Ok(Json(shortcuts.into_iter().map(|(_, n)| n).collect()))
}

async fn add_shortcut(
    State(state): State<AppState>,
    Path(note_id): Path<Uuid>,
) -> Result<Json<pinbook_core::Shortcut>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.add_shortcut(note_id)?))
}

async fn remove_shortcut(
    State(state): State<AppState>,
    Path(note_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let svc = state.service.lock().await;
    svc.remove_shortcut(note_id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn search(
    State(state): State<AppState>,
    Query(q): Query<SearchQuery>,
) -> Result<Json<pinbook_core::SearchResult>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.search(q)?))
}

async fn empty_trash(State(state): State<AppState>) -> Result<Json<serde_json::Value>, AppError> {
    let svc = state.service.lock().await;
    let count = svc.empty_trash()?;
    Ok(Json(serde_json::json!({ "deleted": count })))
}

#[derive(Debug, Deserialize)]
struct ImportEnexQuery {
    notebook_id: Option<Uuid>,
    notebook_name: Option<String>,
    stack_id: Option<Uuid>,
}

async fn import_enex(
    State(state): State<AppState>,
    Query(q): Query<ImportEnexQuery>,
    mut multipart: Multipart,
) -> Result<Json<pinbook_core::EnexImportResult>, AppError> {
    let mut data = Vec::new();
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::bad_request(e.to_string()))?
    {
        if field.name() == Some("file") {
            data = field
                .bytes()
                .await
                .map_err(|e| AppError::bad_request(e.to_string()))?
                .to_vec();
            break;
        }
    }
    if data.is_empty() {
        return Err(AppError::bad_request("missing file field".into()));
    }
    let svc = state.service.lock().await;
    Ok(Json(svc.import_enex(
        &data,
        EnexImportRequest {
            notebook_id: q.notebook_id,
            notebook_name: q.notebook_name,
            stack_id: q.stack_id,
        },
    )?))
}

struct AppError(pinbook_core::PinbookError);

impl From<pinbook_core::PinbookError> for AppError {
    fn from(e: pinbook_core::PinbookError) -> Self {
        Self(e)
    }
}

impl AppError {
    fn bad_request(msg: String) -> Self {
        Self(pinbook_core::PinbookError::InvalidInput(msg))
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self.0 {
            pinbook_core::PinbookError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            pinbook_core::PinbookError::InvalidInput(msg) => {
                (StatusCode::BAD_REQUEST, msg.clone())
            }
            _ => (
                StatusCode::INTERNAL_SERVER_ERROR,
                self.0.to_string(),
            ),
        };
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}
