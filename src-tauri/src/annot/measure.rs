//! Measuring (phase 4, docs/editing-phase4-scope.md): the standard /Measure dictionary a saved
//! dimension carries (ISO 32000-1, 12.9), so other apps read its value back from its geometry,
//! and reading each page's /UserUnit, which PDFium doesn't expose and which changes how long a
//! page unit is. The front end works out every number (src/lib/markup/dimension.ts); this
//! only writes them.

use std::collections::BTreeMap;

use lopdf::{Dictionary, Document, LoadOptions, Object, StringFormat, dictionary};
use serde::Deserialize;

/// What the front end sends for a dimension's /Measure (AnnotSpec's `measure`).
#[derive(Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MeasureSpec {
    /// /R: the scale as text ("1:100").
    pub ratio: String,
    /// The unit values are written in ("m", "mm").
    pub unit: String,
    /// Units per user-space unit (page /UserUnit, paper millimetres and the scale together).
    pub factor: f64,
    /// /D in the number formats: 100 for two decimals, 1 for whole numbers.
    pub precision: i64,
}

fn ascii(s: &str) -> Object {
    Object::String(s.as_bytes().to_vec(), StringFormat::Literal)
}

/// A /NumberFormat dictionary: unit label, conversion factor, precision.
fn number_format(unit: &str, c: f64, precision: i64) -> Object {
    Object::Dictionary(dictionary! {
        "Type" => "NumberFormat",
        "U" => ascii(unit),
        "C" => Object::Real(c as f32),
        "D" => precision.max(1),
        "SS" => ascii(""),
    })
}

/// The /Measure dictionary: a rectilinear measure whose X axis turns user-space units into the
/// unit, with distances in that unit and areas in its square.
pub fn measure_dict(m: &MeasureSpec) -> Dictionary {
    dictionary! {
        "Type" => "Measure",
        "Subtype" => "RL",
        "R" => ascii(&m.ratio),
        "X" => Object::Array(vec![number_format(&m.unit, m.factor, m.precision)]),
        "D" => Object::Array(vec![number_format(&m.unit, 1.0, m.precision)]),
        "A" => Object::Array(vec![number_format(&format!("sq {}", m.unit), 1.0, m.precision)]),
    }
}

/// Each page's /UserUnit (1 where it has none), in page order. Pages with a /UserUnit are
/// rare: only sheets over 200 inches need one.
pub fn user_units(bytes: &[u8], password: &str) -> Result<Vec<f64>, String> {
    let options = LoadOptions { password: Some(password.to_string()), ..LoadOptions::default() };
    let doc = Document::load_mem_with_options(bytes, options).map_err(|e| format!("lopdf could not read the file: {e}"))?;
    let pages: BTreeMap<u32, lopdf::ObjectId> = doc.get_pages();
    Ok(pages
        .values()
        .map(|id| {
            doc.get_dictionary(*id)
                .ok()
                .and_then(|d| d.get(b"UserUnit").ok())
                .and_then(|o| match o {
                    Object::Reference(r) => doc.get_object(*r).ok(),
                    o => Some(o),
                })
                .and_then(|o| match o {
                    Object::Integer(i) => Some(*i as f64),
                    Object::Real(r) => Some(*r as f64),
                    _ => None,
                })
                .filter(|u| u.is_finite() && *u > 0.0)
                .unwrap_or(1.0)
        })
        .collect())
}

/// The pages' /UserUnit for the measuring tools, read from the file on disk.
#[tauri::command]
pub async fn measure_user_units(path: String, password: Option<String>) -> Result<Vec<f64>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&path).map_err(|e| format!("couldn't read {path}: {e}"))?;
        user_units(&bytes, password.as_deref().unwrap_or(""))
    })
    .await
    .map_err(|e| e.to_string())?
}
