// WP-Shell: single-instance argument handling.
use vellum_lib::shell::{PendingOpens, forwarded_file, single_instance_wanted};

fn argv(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

#[test]
fn bench_and_new_instance_bypass_single_instance() {
    assert!(single_instance_wanted(false, &argv(&["vellum.exe", "a.pdf"])));
    assert!(!single_instance_wanted(true, &argv(&["vellum.exe", "--bench", "a.pdf"])));
    assert!(!single_instance_wanted(false, &argv(&["vellum.exe", "--new-instance"])));
}

#[test]
fn forwarded_absolute_path_is_kept() {
    let f = forwarded_file(argv(&["vellum.exe", r"C:\Drawings\(Rev C) Plan & Breakout.pdf"]), r"C:\Users\x");
    assert_eq!(f.as_deref(), Some(r"C:\Drawings\(Rev C) Plan & Breakout.pdf"));
}

#[test]
fn forwarded_relative_path_resolves_against_sender_cwd() {
    let f = forwarded_file(argv(&["vellum.exe", "--debug", "plan.pdf"]), r"C:\Work");
    assert_eq!(f.as_deref(), Some(r"C:\Work\plan.pdf"));
}

#[test]
fn forwarded_launch_without_file_opens_nothing() {
    assert_eq!(forwarded_file(argv(&["vellum.exe"]), r"C:\Work"), None);
    assert_eq!(forwarded_file(argv(&["vellum.exe", "--pdfium-threads", "4"]), r"C:\Work"), None);
}

#[test]
fn pending_opens_queue_until_front_end_ready() {
    let p = PendingOpens::default();
    assert!(p.queue_if_not_ready(&["a".into()]));
    assert!(p.queue_if_not_ready(&["b".into()]));
    assert_eq!(p.take(), vec!["a".to_string(), "b".to_string()]);
    assert!(!p.queue_if_not_ready(&["c".into()]));
    assert!(p.take().is_empty());
}

#[test]
fn only_web_and_mail_links_are_opened() {
    use vellum_lib::shell::safe_url;
    assert_eq!(safe_url(" https://example.com/a?b=1 ").as_deref(), Some("https://example.com/a?b=1"));
    assert!(safe_url("HTTP://EXAMPLE.COM").is_some());
    assert!(safe_url("mailto:crew@example.com").is_some());
    for bad in ["file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", r"C:\x.exe", "https://", "http://a b", "http://a\nb", "", "ftp://x", r"\\server\share"] {
        assert!(safe_url(bad).is_none(), "{bad:?} should be refused");
    }
    assert!(safe_url(&format!("https://x/{}", "a".repeat(3000))).is_none());
}
