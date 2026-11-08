//! Cancelling a region render that is already queued on the PDFium workers: strips the
//! workers haven't started are skipped, and nothing half-rendered is delivered.

mod print_common;

use print_common::*;
use std::sync::mpsc::channel;
use std::time::Duration;
use vellum_lib::pdfium::RegionArgs;

/// Occupy every worker until the returned senders are dropped or sent to.
fn block_workers() -> Vec<std::sync::mpsc::Sender<()>> {
    let n = pdfium().worker_count().unwrap();
    (0..n)
        .map(|i| {
            let (tx, rx) = channel::<()>();
            let (started_tx, started_rx) = channel::<()>();
            std::thread::spawn(move || {
                pdfium()
                    .run_on_worker_index(i, move |_| {
                        let _ = started_tx.send(());
                        let _ = rx.recv();
                    })
                    .unwrap();
            });
            started_rx.recv().unwrap();
            tx
        })
        .collect()
}

fn region(id: u64) -> RegionArgs {
    RegionArgs { id, page: 0, rs: 2.0, x: 0, y: 0, w: 400, h: 200 }
}

#[test]
fn cancelling_a_queued_render_skips_its_strips() {
    let (doc, _) = open_fixture("cancel", &make_pdf(vec![page(200.0, 100.0, &[(0.0, 0.0, 200.0, 100.0)])]));
    // A first render works out the band count, so the next one goes straight to the workers.
    let whole = pdfium().render(doc, region(0)).unwrap().unwrap();
    assert!(whole.iter().any(|&v| v < 128), "fixture renders ink");

    // Streamed: queued behind busy workers, then cancelled.
    let gates = block_workers();
    let (done_tx, done_rx) = channel();
    std::thread::spawn(move || {
        let mut bands = 0;
        let r = pdfium().render_stream(doc, region(101), |_, _| {
            bands += 1;
            true
        });
        done_tx.send((r, bands)).unwrap();
    });
    std::thread::sleep(Duration::from_millis(200)); // let its strips reach the worker queues
    pdfium().cancel(101);
    drop(gates);
    let (r, bands) = done_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(r.unwrap(), Some(0));
    assert_eq!(bands, 0, "no band of a cancelled render is delivered");

    // One buffer: the result is dropped rather than returned blank.
    let gates = block_workers();
    let (done_tx, done_rx) = channel();
    std::thread::spawn(move || done_tx.send(pdfium().render(doc, region(102))).unwrap());
    std::thread::sleep(Duration::from_millis(200));
    pdfium().cancel(102);
    drop(gates);
    assert_eq!(done_rx.recv_timeout(Duration::from_secs(10)).unwrap().unwrap(), None);

    // Cancelled before it starts: skipped outright. And an uncancelled render still works.
    pdfium().cancel(103);
    assert_eq!(pdfium().render(doc, region(103)).unwrap(), None);
    assert_eq!(pdfium().render(doc, region(104)).unwrap().unwrap(), whole);
}
