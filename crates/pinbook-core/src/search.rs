use rusqlite::params;
use uuid::Uuid;

use crate::error::Result;
use crate::models::{SearchQuery, SearchResult};
use crate::service::PinbookService;

pub fn search_notes(service: &PinbookService, query: SearchQuery) -> Result<SearchResult> {
    let user_id = service.db().default_user_id()?;
    let limit = query.limit.unwrap_or(50).min(200);
    let offset = query.offset.unwrap_or(0);
    let include_trash = query.include_trash.unwrap_or(false);
    let include_archived = query.include_archived.unwrap_or(true);

    let fts_query = query
        .q
        .split_whitespace()
        .map(|term| format!("\"{term}\"*"))
        .collect::<Vec<_>>()
        .join(" AND ");

    if fts_query.is_empty() {
        return Ok(SearchResult {
            notes: vec![],
            total: 0,
        });
    }

    let conn = service.db().connection();

    let mut filters = vec!["n.user_id = ?1".to_string()];
    if !include_trash {
        filters.push("n.deleted_at IS NULL".to_string());
    }
    if !include_archived {
        filters.push("n.is_archived = 0".to_string());
    }
    if let Some(nb) = query.notebook_id {
        filters.push(format!("n.notebook_id = '{nb}'"));
    }
    if let Some(tag) = query.tag_id {
        filters.push(format!(
            "n.id IN (SELECT note_id FROM note_tags WHERE tag_id = '{tag}')"
        ));
    }

    filters.push("n.id IN (SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?2)".to_string());

    let where_clause = filters.join(" AND ");

    let count_sql = format!("SELECT COUNT(*) FROM notes n WHERE {where_clause}");
    let list_sql = format!(
        "SELECT n.id FROM notes n WHERE {where_clause} ORDER BY n.updated_at DESC LIMIT ?3 OFFSET ?4"
    );

    let total: u32 = conn.query_row(&count_sql, params![user_id.to_string(), fts_query.clone()], |row| {
        row.get(0)
    })?;

    let mut stmt = conn.prepare(&list_sql)?;
    let rows = stmt.query_map(
        params![
            user_id.to_string(),
            fts_query,
            limit as i64,
            offset as i64
        ],
        |row| row.get::<_, String>(0),
    )?;

    let mut notes = Vec::new();
    for row in rows {
        let id = Uuid::parse_str(&row?).unwrap();
        let all = service.list_notes(None, None, include_trash, None)?;
        if let Some(summary) = all.into_iter().find(|n| n.id == id) {
            if include_archived || !summary.is_archived {
                notes.push(summary);
            }
        }
    }

    Ok(SearchResult { notes, total })
}
