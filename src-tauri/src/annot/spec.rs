//! What the front end sends to save: annotation specs in PDF user space (src/lib/markup/spec.ts
//! builds them). Every field is optional except the ones every annotation has. Later phases
//! add their fields inside their own blocks below (Measuring, Stamps, Text markups); build
//! specs in tests with `..Default::default()` so a new field doesn't break them.

use serde::Deserialize;

/// The annotation's normal appearance: content-stream operators in user space and the box
/// they cover, plus the resources they use.
#[derive(Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    pub ops: String,
    /// [x0, y0, x1, y1].
    pub bbox: [f64; 4],
    /// Line (/CA) opacity for the /GS0 graphics state, if the operators use it.
    pub opacity: Option<f64>,
    /// Fill (/ca) opacity for /GS0; without it, the fill takes `opacity`.
    #[serde(default)]
    pub fill_opacity: Option<f64>,
    /// The operators use /Helv (Helvetica, WinAnsi).
    #[serde(default)]
    pub font: bool,
    /// Standard fonts the operators use: resource name (/TiBo) to /BaseFont (Times-Bold).
    #[serde(default)]
    pub fonts: std::collections::BTreeMap<String, String>,
    // Stamps

    // Text markups
}

#[derive(Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnnotSpec {
    /// Zero-based page.
    pub page: usize,
    /// The annotation's unique name (/NM): Vellum's markup id. Replace and delete find it by this.
    pub nm: String,
    /// "Square", "Line", "Polygon", "PolyLine", "FreeText", "Ink", ...
    pub subtype: String,
    /// [x0, y0, x1, y1] in user space.
    pub rect: [f64; 4],
    pub appearance: Appearance,
    /// /T, /M and /CreationDate ("D:20261114120000Z").
    pub author: Option<String>,
    pub modified: Option<String>,
    pub created: Option<String>,
    /// /Contents: the text (text boxes) or a note.
    pub contents: Option<String>,
    /// /F; Print (4) when absent.
    pub flags: Option<i64>,
    /// /C: line colour (background for FreeText).
    pub colour: Option<[f64; 3]>,
    /// /IC: interior (fill) colour.
    pub interior: Option<[f64; 3]>,
    /// /CA.
    pub opacity: Option<f64>,
    /// /BS /W and, when dashed, /S /D with /D.
    pub border_width: Option<f64>,
    pub dash: Option<Vec<f64>>,
    /// /L for lines: [x1, y1, x2, y2].
    pub line: Option<[f64; 4]>,
    /// /LE: one name (FreeText callouts) or two (lines).
    pub line_ends: Option<Vec<String>>,
    /// /Vertices for polygons and polylines.
    pub vertices: Option<Vec<f64>>,
    /// /InkList for ink.
    pub ink: Option<Vec<Vec<f64>>>,
    /// /BE << /S /C /I n >>: a cloudy border of intensity n.
    pub cloud: Option<f64>,
    /// /IT, e.g. "PolygonCloud", "FreeTextCallout", "LineDimension".
    pub intent: Option<String>,
    /// /DA and /DS for FreeText.
    pub default_appearance: Option<String>,
    pub default_style: Option<String>,
    /// /Q: 0 left, 1 centred, 2 right.
    pub quadding: Option<i64>,
    /// /RD: how far the drawn shape sits inside /Rect [left, bottom, right, top].
    pub inset: Option<[f64; 4]>,
    /// /Rotate (Acrobat keeps FreeText upright on rotated pages with it).
    pub rotate: Option<i64>,
    /// /CL for callouts.
    pub callout: Option<Vec<f64>>,
    /// Vellum's private copy of the markup, written as /Vellum_Markup: JSON with the format
    /// version, the /M date it was written with and the markup's own model
    /// (src/lib/markup/reedit.ts). Other apps ignore keys they don't know; a later Vellum uses
    /// it to bring the markup back exactly as drawn, unless /M shows another app changed it.
    #[serde(default)]
    pub vellum: Option<String>,
    // Measuring
    /// A dimension's /Measure dictionary (annot/measure.rs).
    #[serde(default)]
    pub measure: Option<super::measure::MeasureSpec>,
    /// /Cap true and /CP /Top: a Line dimension shows its value as a caption above it.
    #[serde(default)]
    pub caption: Option<bool>,

    // Stamps

    // Text markups
}

/// One change to save.
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Change {
    /// A new annotation.
    Add { spec: AnnotSpec },
    /// Redraw the annotation with the spec's /NM on its page, keeping its object number.
    Replace { spec: AnnotSpec },
    /// Remove the annotation with this /NM (and its popup) from the page.
    Delete { page: usize, nm: String },
}
