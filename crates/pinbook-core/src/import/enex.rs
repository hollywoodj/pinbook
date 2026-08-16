use std::collections::HashMap;
use std::io::Cursor;

use base64::Engine;
use chrono::{DateTime, NaiveDateTime, Utc};
use md5;
use quick_xml::events::Event;
use quick_xml::Reader;

use crate::error::{PinbookError, Result};

#[derive(Debug, Clone)]
pub struct EnexExport {
    pub notes: Vec<EnexNote>,
}

#[derive(Debug, Clone)]
pub struct EnexNote {
    pub title: String,
    pub content: String,
    pub created: Option<DateTime<Utc>>,
    pub updated: Option<DateTime<Utc>>,
    pub reminder_at: Option<DateTime<Utc>>,
    pub tags: Vec<String>,
    pub source_url: Option<String>,
    pub resources: Vec<EnexResource>,
}

#[derive(Debug, Clone)]
pub struct EnexResource {
    pub data: Vec<u8>,
    pub mime: String,
    pub filename: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub hash: String,
}

pub fn parse_enex(data: &[u8]) -> Result<EnexExport> {
    let mut reader = Reader::from_reader(Cursor::new(data));
    reader.config_mut().trim_text(true);

    let mut notes = Vec::new();
    let mut buf = Vec::new();
    let mut in_note = false;
    let mut current: Option<PartialNote> = None;
    let mut current_field = String::new();
    let mut in_resource = false;
    let mut current_resource: Option<PartialResource> = None;
    let mut in_resource_attributes = false;
    let mut in_note_attributes = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match name.as_str() {
                    "note" => {
                        in_note = true;
                        current = Some(PartialNote::default());
                    }
                    "resource" if in_note => {
                        in_resource = true;
                        current_resource = Some(PartialResource::default());
                    }
                    "resource-attributes" if in_resource => {
                        in_resource_attributes = true;
                    }
                    "note-attributes" if in_note => {
                        in_note_attributes = true;
                    }
                    _ if in_note && !in_resource => {
                        current_field = name;
                    }
                    _ if in_resource && !in_resource_attributes => {
                        current_field = name;
                    }
                    _ if in_resource_attributes => {
                        current_field = name;
                    }
                    _ if in_note_attributes => {
                        current_field = name;
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(e)) => {
                let text = String::from_utf8_lossy(e.as_ref()).into_owned();
                if in_resource {
                    if let Some(resource) = current_resource.as_mut() {
                        match current_field.as_str() {
                            "data" => resource.data_b64.push_str(text.trim()),
                            "mime" => resource.mime = text.trim().to_string(),
                            "width" => resource.width = text.trim().parse().ok(),
                            "height" => resource.height = text.trim().parse().ok(),
                            "file-name" if in_resource_attributes => {
                                resource.filename = Some(text.trim().to_string())
                            }
                            _ => {}
                        }
                    }
                } else if let Some(note) = current.as_mut() {
                    match current_field.as_str() {
                        "title" => note.title = text.trim().to_string(),
                        "content" => note.content.push_str(&text),
                        "created" => note.created = parse_evernote_datetime(text.trim()),
                        "updated" => note.updated = parse_evernote_datetime(text.trim()),
                        "tag" => {
                            let tag = text.trim();
                            if !tag.is_empty() {
                                note.tags.push(tag.to_string());
                            }
                        }
                        "source-url" => note.source_url = Some(text.trim().to_string()),
                        "reminder-time" => note.reminder_at = parse_evernote_datetime(text.trim()),
                        _ if in_note_attributes && current_field == "source-url" => {
                            note.source_url = Some(text.trim().to_string())
                        }
                        _ if in_note_attributes && current_field == "reminder-time" => {
                            note.reminder_at = parse_evernote_datetime(text.trim())
                        }
                        _ => {}
                    }
                }
            }
            Ok(Event::CData(e)) => {
                if let Some(note) = current.as_mut() {
                    if current_field == "content" || note.content.is_empty() {
                        let bytes = e.into_inner();
                        note.content.push_str(&String::from_utf8_lossy(&bytes));
                        current_field = "content".to_string();
                    }
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match name.as_str() {
                    "note" => {
                        if let Some(note) = current.take() {
                            notes.push(note.into_note()?);
                        }
                        in_note = false;
                        current_field.clear();
                    }
                    "resource" => {
                        if let (Some(note), Some(resource)) =
                            (current.as_mut(), current_resource.take())
                        {
                            note.resources.push(resource.into_resource()?);
                        }
                        in_resource = false;
                        in_resource_attributes = false;
                        current_field.clear();
                    }
                    "resource-attributes" => {
                        in_resource_attributes = false;
                        current_field.clear();
                    }
                    "note-attributes" => {
                        in_note_attributes = false;
                        current_field.clear();
                    }
                    _ => {
                        current_field.clear();
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(PinbookError::Other(err.to_string())),
            _ => {}
        }
        buf.clear();
    }

    Ok(EnexExport { notes })
}

#[derive(Default)]
struct PartialNote {
    title: String,
    content: String,
    created: Option<DateTime<Utc>>,
    updated: Option<DateTime<Utc>>,
    reminder_at: Option<DateTime<Utc>>,
    tags: Vec<String>,
    source_url: Option<String>,
    resources: Vec<EnexResource>,
}

impl PartialNote {
    fn into_note(self) -> Result<EnexNote> {
        Ok(EnexNote {
            title: if self.title.is_empty() {
                "Untitled".to_string()
            } else {
                self.title
            },
            content: self.content,
            created: self.created,
            updated: self.updated,
            reminder_at: self.reminder_at,
            tags: self.tags,
            source_url: self.source_url,
            resources: self.resources,
        })
    }
}

#[derive(Default)]
struct PartialResource {
    data_b64: String,
    mime: String,
    filename: Option<String>,
    width: Option<i32>,
    height: Option<i32>,
}

impl PartialResource {
    fn into_resource(self) -> Result<EnexResource> {
        let data = base64::engine::general_purpose::STANDARD
            .decode(self.data_b64.replace('\n', "").replace('\r', ""))
            .map_err(|e| PinbookError::Other(format!("invalid base64 in resource: {e}")))?;
        let hash = format!("{:x}", md5::compute(&data));
        Ok(EnexResource {
            data,
            mime: if self.mime.is_empty() {
                "application/octet-stream".to_string()
            } else {
                self.mime
            },
            filename: self.filename,
            width: self.width,
            height: self.height,
            hash,
        })
    }
}

pub fn parse_evernote_datetime(value: &str) -> Option<DateTime<Utc>> {
    if value.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(value) {
        return Some(dt.with_timezone(&Utc));
    }
    NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%SZ")
        .ok()
        .map(|dt| dt.and_utc())
}

pub fn enml_to_html(enml: &str, resources: &[EnexResource]) -> Result<String> {
    let resource_map: HashMap<String, &EnexResource> =
        resources.iter().map(|r| (r.hash.clone(), r)).collect();

    let mut reader = Reader::from_reader(Cursor::new(enml.as_bytes()));
    reader.config_mut().trim_text(false);

    let mut out = String::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match name.as_str() {
                    "en-note" => out.push_str("<div>"),
                    "en-todo" => {
                        let checked = e
                            .attributes()
                            .flatten()
                            .any(|a| a.key.as_ref() == b"checked" && a.value.as_ref() != b"false");
                        out.push_str(if checked {
                            "<p>☑ "
                        } else {
                            "<p>☐ "
                        });
                    }
                    "en-crypt" => {
                        out.push_str("<p><em>[Encrypted content not imported]</em></p>");
                    }
                    "en-media" => {
                        let mut hash = None;
                        let mut mime = None;
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"hash" => hash = Some(String::from_utf8_lossy(&attr.value).to_string()),
                                b"type" => mime = Some(String::from_utf8_lossy(&attr.value).to_string()),
                                _ => {}
                            }
                        }
                        if let Some(hash) = hash {
                            if let Some(resource) = resource_map.get(&hash) {
                                let use_mime = mime.unwrap_or_else(|| resource.mime.clone());
                                if use_mime.starts_with("image/") {
                                    let b64 = base64::engine::general_purpose::STANDARD
                                        .encode(&resource.data);
                                    out.push_str(&format!(
                                        "<img src=\"data:{};base64,{}\" alt=\"{}\" />",
                                        use_mime,
                                        b64,
                                        resource.filename.as_deref().unwrap_or("image")
                                    ));
                                } else {
                                    out.push_str(&format!(
                                        "<p><a href=\"#\">📎 {}</a></p>",
                                        resource.filename.as_deref().unwrap_or("attachment")
                                    ));
                                }
                            }
                        }
                    }
                    "a" | "div" | "span" | "p" | "br" | "ul" | "ol" | "li" | "b" | "i" | "u"
                    | "strong" | "em" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "blockquote"
                    | "pre" | "code" | "table" | "tr" | "td" | "th" | "thead" | "tbody" => {
                        out.push('<');
                        out.push_str(&name);
                        for attr in e.attributes().flatten() {
                            let key = String::from_utf8_lossy(attr.key.as_ref());
                            if key == "style" || key == "href" || key == "class" {
                                let value = String::from_utf8_lossy(&attr.value);
                                out.push_str(&format!(" {key}=\"{value}\""));
                            }
                        }
                        out.push('>');
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match name.as_str() {
                    "en-note" => out.push_str("</div>"),
                    "en-todo" => out.push_str("</p>"),
                    "a" | "div" | "span" | "p" | "ul" | "ol" | "li" | "b" | "i" | "u" | "strong"
                    | "em" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "blockquote" | "pre"
                    | "code" | "table" | "tr" | "td" | "th" | "thead" | "tbody" => {
                        out.push_str("</");
                        out.push_str(&name);
                        out.push('>');
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(e)) => {
                let text = String::from_utf8_lossy(e.as_ref());
                out.push_str(&escape_html(&text));
            }
            Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if name == "br" {
                    out.push_str("<br/>");
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => {
                if out.is_empty() {
                    return Err(PinbookError::Other(format!("invalid ENML: {err}")));
                }
                break;
            }
            _ => {}
        }
        buf.clear();
    }

    if out.trim().is_empty() {
        out.push_str("<p></p>");
    }

    Ok(out)
}

fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export3.dtd">
<en-export>
  <note>
    <title>Test Note</title>
    <content><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note><div>Hello <b>world</b></div></en-note>]]></content>
    <created>20240115T100000Z</created>
    <updated>20240116T120000Z</updated>
    <tag>work</tag>
    <tag>ideas</tag>
  </note>
</en-export>"#;

    #[test]
    fn parses_basic_enex() {
        let export = parse_enex(SAMPLE.as_bytes()).unwrap();
        assert_eq!(export.notes.len(), 1);
        assert_eq!(export.notes[0].title, "Test Note");
        assert_eq!(export.notes[0].tags, vec!["work", "ideas"]);
        let html = enml_to_html(&export.notes[0].content, &[]).unwrap();
        assert!(html.contains("Hello"));
        assert!(html.contains("<b>"));
    }

    #[test]
    fn parses_evernote_datetime() {
        let dt = parse_evernote_datetime("20240115T100000Z").unwrap();
        assert_eq!(dt.format("%Y-%m-%d").to_string(), "2024-01-15");
    }

    #[test]
    fn imports_enex_into_database() {
        let dir = std::env::temp_dir().join("pinbook-import-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        let db = crate::db::Database::open(&db_path).unwrap();
        let service = crate::service::PinbookService::new(db);
        let result = service
            .import_enex(
                SAMPLE.as_bytes(),
                crate::models::EnexImportRequest {
                    notebook_id: None,
                    notebook_name: Some("Imported".into()),
                    stack_id: None,
                },
            )
            .unwrap();
        assert_eq!(result.imported, 1, "errors: {:?}", result.errors);
        let search = service
            .search(crate::models::SearchQuery {
                q: "world".into(),
                notebook_id: None,
                tag_id: None,
                include_trash: Some(false),
                include_archived: Some(true),
                limit: None,
                offset: None,
            })
            .unwrap();
        assert_eq!(search.total, 1);
    }
}
