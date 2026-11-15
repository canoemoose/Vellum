//! Imperial measuring (stage 5 [A9], annot/measure.rs): the /Measure number formats for feet
//! and inches with a fraction, inches with a fraction, and decimal feet, with areas in square
//! feet (ISO 32000-1 12.9, table 268); metric written as before. The front end sends the spec
//! as JSON (src/lib/markup/dimension.ts measureSpec), so it's read from JSON here too.

mod print_common;

use lopdf::{Dictionary, Document, Object};
use print_common::*;
use vellum_lib::annot::measure::{MeasureSpec, measure_dict};
use vellum_lib::annot::spec::Appearance;
use vellum_lib::annot::{self, AnnotSpec, Change};

fn spec(json: &str) -> MeasureSpec {
    serde_json::from_str(json).expect("a measure spec")
}

fn formats(d: &Dictionary, key: &[u8]) -> Vec<Dictionary> {
    d.get(key).unwrap().as_array().unwrap().iter().map(|o| o.as_dict().unwrap().clone()).collect()
}

fn text(d: &Dictionary, key: &[u8]) -> String {
    String::from_utf8(d.get(key).unwrap().as_str().unwrap().to_vec()).unwrap()
}

fn name(d: &Dictionary, key: &[u8]) -> String {
    String::from_utf8(d.get(key).unwrap().as_name().unwrap().to_vec()).unwrap()
}

fn float(d: &Dictionary, key: &[u8]) -> f32 {
    d.get(key).unwrap().as_float().unwrap()
}

fn int(d: &Dictionary, key: &[u8]) -> i64 {
    d.get(key).unwrap().as_i64().unwrap()
}

const FEET_INCHES: &str = r#"{"ratio":"1/4\" = 1'-0\"","unit":"ft","factor":0.6666667,"precision":16,"fraction":true,"feetInches":true,"areaUnit":"sq ft","areaFactor":1,"areaPrecision":100}"#;

#[test]
fn metric_is_written_as_before() {
    let m = measure_dict(&spec(r#"{"ratio":"1:100","unit":"m","factor":0.0352778,"precision":100}"#));
    assert_eq!(text(&m, b"R"), "1:100");
    let d = formats(&m, b"D");
    assert_eq!(d.len(), 1);
    assert_eq!(text(&d[0], b"U"), "m");
    assert_eq!(int(&d[0], b"D"), 100);
    assert!(d[0].get(b"F").is_err());
    let a = formats(&m, b"A");
    assert_eq!(text(&a[0], b"U"), "sq m");
    assert_eq!(float(&a[0], b"C"), 1.0);
    assert_eq!(int(&a[0], b"D"), 100);
}

#[test]
fn feet_and_inches_write_whole_feet_then_a_fraction_of_an_inch() {
    let m = measure_dict(&spec(FEET_INCHES));
    assert_eq!(text(&m, b"R"), "1/4\" = 1'-0\"");
    let x = formats(&m, b"X");
    assert_eq!(text(&x[0], b"U"), "ft");
    assert!((float(&x[0], b"C") - 0.6666667).abs() < 1e-6);
    assert_eq!(int(&x[0], b"D"), 100, "X only converts: no denominator there");
    let d = formats(&m, b"D");
    assert_eq!(d.len(), 2);
    // Whole feet, truncated, the remainder passed on: 12' then a space.
    assert_eq!(text(&d[0], b"U"), "'");
    assert_eq!(name(&d[0], b"F"), "T");
    assert_eq!(text(&d[0], b"PS"), "");
    assert_eq!(text(&d[0], b"SS"), " ");
    // Then inches, twelve to the foot, as a fraction over the precision: 4 1/2".
    assert_eq!(text(&d[1], b"U"), "\"");
    assert_eq!(float(&d[1], b"C"), 12.0);
    assert_eq!(name(&d[1], b"F"), "F");
    assert_eq!(int(&d[1], b"D"), 16);
    assert_eq!(text(&d[1], b"PS"), "");
    let a = formats(&m, b"A");
    assert_eq!(text(&a[0], b"U"), "sq ft");
    assert_eq!(float(&a[0], b"C"), 1.0);
    assert_eq!(int(&a[0], b"D"), 100);
}

#[test]
fn fractional_inches_have_one_format_and_areas_in_square_feet() {
    let m = measure_dict(&spec(
        r#"{"ratio":"1:48","unit":"in","factor":8.0,"precision":32,"fraction":true,"areaUnit":"sq ft","areaFactor":0.006944444,"areaPrecision":100}"#,
    ));
    let d = formats(&m, b"D");
    assert_eq!(d.len(), 1);
    assert_eq!(text(&d[0], b"U"), "\"");
    assert_eq!(name(&d[0], b"F"), "F");
    assert_eq!(int(&d[0], b"D"), 32);
    let a = formats(&m, b"A");
    assert_eq!(text(&a[0], b"U"), "sq ft");
    assert!((float(&a[0], b"C") - 1.0 / 144.0).abs() < 1e-6, "square inches to square feet");
}

#[test]
fn decimal_feet_and_inches_are_decimal() {
    for (unit, factor) in [("ft", 0.6666667), ("in", 8.0)] {
        let json = format!(r#"{{"ratio":"1:48","unit":"{unit}","factor":{factor},"precision":1000,"areaUnit":"sq ft","areaFactor":1,"areaPrecision":100}}"#);
        let m = measure_dict(&spec(&json));
        let d = formats(&m, b"D");
        assert_eq!(d.len(), 1);
        assert_eq!(text(&d[0], b"U"), unit);
        assert!(d[0].get(b"F").is_err());
        assert_eq!(int(&d[0], b"D"), 1000);
        assert_eq!(int(&formats(&m, b"X")[0], b"D"), 1000);
    }
}

#[test]
fn a_saved_imperial_dimension_carries_its_number_formats() {
    let s = AnnotSpec {
        page: 0,
        nm: "len".into(),
        subtype: "Line".into(),
        rect: [18.0, 95.0, 222.0, 105.0],
        appearance: Appearance { ops: "0 0 1 RG 2 w 20 100 m 220 100 l S".into(), bbox: [18.0, 95.0, 222.0, 105.0], ..Default::default() },
        line: Some(vec![20.0, 100.0, 220.0, 100.0].try_into().unwrap()),
        intent: Some("LineDimension".into()),
        contents: Some("11' 1 3/8\"".into()),
        measure: Some(spec(FEET_INCHES)),
        ..Default::default()
    };
    let out = annot::apply(make_pdf(vec![page(300.0, 200.0, &[])]), "", &[Change::Add { spec: s }]).unwrap();
    let doc = Document::load_mem(&out).unwrap();
    let page = *doc.get_pages().get(&1).unwrap();
    let annots = match doc.get_dictionary(page).unwrap().get(b"Annots").unwrap() {
        Object::Reference(id) => doc.get_object(*id).unwrap().as_array().unwrap().clone(),
        o => o.as_array().unwrap().clone(),
    };
    let a = doc.get_dictionary(annots[0].as_reference().unwrap()).unwrap();
    let m = a.get(b"Measure").unwrap().as_dict().unwrap();
    assert_eq!(text(m, b"R"), "1/4\" = 1'-0\"");
    let d = formats(m, b"D");
    assert_eq!((text(&d[0], b"U"), text(&d[1], b"U")), ("'".into(), "\"".into()));
}
