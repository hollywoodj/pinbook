use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::error::{PinbookError, Result};

const SCHEMA: &str = include_str!("../migrations/001_initial.sql");

pub struct Database {
    conn: Connection,
    data_dir: PathBuf,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        let data_dir = path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("attachments");
        std::fs::create_dir_all(&data_dir)?;
        let db = Self { conn, data_dir };
        db.migrate()?;
        db.ensure_default_user()?;
        Ok(db)
    }

    pub fn open_default() -> Result<Self> {
        let dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("pinbook");
        std::fs::create_dir_all(&dir)?;
        Self::open(dir.join("pinbook.db"))
    }

    pub fn connection(&self) -> &Connection {
        &self.conn
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn attachment_path(&self, attachment_id: &Uuid) -> PathBuf {
        self.data_dir.join(attachment_id.to_string())
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(SCHEMA)?;
        Ok(())
    }

    fn ensure_default_user(&self) -> Result<()> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))?;
        if count == 0 {
            let now = chrono::Utc::now().to_rfc3339();
            let user_id = Uuid::new_v4();
            let notebook_id = Uuid::new_v4();
            self.conn.execute(
                "INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![user_id.to_string(), "local@pinbook.app", "Local User", now, now],
            )?;
            self.conn.execute(
                "INSERT INTO notebooks (id, user_id, name, is_default, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, 1, 0, ?4, ?5)",
                params![notebook_id.to_string(), user_id.to_string(), "First Notebook", now, now],
            )?;
        }
        Ok(())
    }

    pub fn default_user_id(&self) -> Result<Uuid> {
        let id: String = self.conn.query_row(
            "SELECT id FROM users ORDER BY created_at LIMIT 1",
            [],
            |row| row.get(0),
        )?;
        Uuid::parse_str(&id).map_err(|e| PinbookError::Other(e.to_string()))
    }
}
