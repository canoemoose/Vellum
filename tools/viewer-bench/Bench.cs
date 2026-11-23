using System.Diagnostics;
using System.Text;
using System.Text.Json;
using static ViewerBench.Native;

namespace ViewerBench;

/// The measurement loop. For each file and viewer: one unmeasured warm-up run (disk cache,
/// first-run prompts), then N measured runs of:
///   open    process start -> the middle of the window stops changing (and shows something);
///   zoom    fit page (untimed) -> type fit-width x Factor into the zoom box -> Enter -> settled.
static class Bench
{
    public const double Factor = 4; // zoom target: 4x the fit-width level (Chrome and Edge stop at 500%)
    // How long the picture must stay unchanged before a step counts as finished. Was 3 s for
    // opens and 2.5 s for zooms: Acrobat and SumatraPDF sit still for longer than that before
    // drawing a heavy page (Matt, watching, 18 Nov), so the tool moved on with a blank or
    // blurred page. --quiet sets it.
    static int QuietOpenMs = 10000, QuietZoomMs = 10000;
    /// The typed zoom (fit page, type a level, Enter) is off unless --typed: each viewer lands
    /// on a different part of the sheet, so its figures don't compare (18 Nov).
    static bool Typed;
    /// --open-only: the cold open and nothing else. --whole-sheet: launch to the whole sheet
    /// drawn as one timed step (see MeasureWholeSheet), and nothing else.
    static bool OpenOnly, WholeSheet;
    /// A whole-sheet run counts only if its picture matches a fit page taken afterwards in the
    /// same launch to within this share of sampled pixels (else the key was lost).
    const double MatchLimit = 0.05;
    const int NotchGapMs = 50, MaxNotches = 80;
    /// Notches each viewer needs to reach the target, per drawing, found in its warm-up launch.
    static readonly Dictionary<string, int> NotchesFor = new();
    const int TimeoutMs = 120000;

    sealed record RunResult(string App, string File, int Run, double? OpenMs, double? ZoomMs, double? FitPct, double? TargetPct, double? GotPct, bool Moved, string? Note)
    {
        // The same two views in every viewer, each timed from the key press: fit width -> fit
        // page (the whole sheet drawn), then fit page -> fit width. "First" is the first change
        // on screen, "Ms" the last; Pct is the zoom level the viewer reports afterwards.
        public double? FitPageFirstMs { get; init; } public double? FitPageMs { get; init; } public double? FitPagePct { get; init; }
        public double? FitWidthFirstMs { get; init; } public double? FitWidthMs { get; init; } public double? FitWidthPct { get; init; }
        // Wheel zoom at the middle of the sheet: from fit page, Notches notches of Ctrl+wheel
        // 50 ms apart with the pointer on the sheet's centre, Notches chosen in the warm-up so the
        // viewer reaches Factor x its fit-width level. First: first notch to first change.
        // Landing: last notch to settled (the still wait after the gesture). Ms: first notch to
        // settled.
        public int? WheelNotches { get; init; } public double? WheelFirstMs { get; init; } public double? WheelMs { get; init; }
        public double? WheelLandingMs { get; init; } public double? WheelPct { get; init; } public double? WheelTargetPct { get; init; }
        public string? WheelNote { get; init; }
        // Launch to the whole sheet drawn (--whole-sheet): KeyAt is when the first drawing showed
        // and the fit-page key went; Ms is the last change after it, both from process start.
        // Diff is the share of sampled pixels that differ from a fit page taken afterwards.
        public double? WholeSheetMs { get; init; } public double? WholeSheetKeyAt { get; init; }
        public double? WholeSheetDiff { get; init; }
        /// The timed figure even when the run is void (Ms is null then), for judging from the
        /// saved frames: Acrobat's error box can sit over the reference alone.
        public double? WholeSheetRawMs { get; init; }
    }

    public static int Run(Options o)
    {
        QuietOpenMs = QuietZoomMs = o.Quiet; Typed = o.Typed; OpenOnly = o.OpenOnly; WholeSheet = o.WholeSheet;
        var apps = o.Apps.Select(Apps.Get).ToList();
        var busy = Program.Running(apps);
        if (busy.Count > 0) { Program.Log("Close these first, the bench would take them over: " + string.Join(", ", busy)); return 1; }
        var results = new List<RunResult>();
        var stamp = DateTime.Now.ToString("yyyyMMdd-HHmm");
        var dir = Path.Combine(Program.Root, stamp); Directory.CreateDirectory(Path.Combine(dir, "frames"));
        foreach (var file in o.Files)
            foreach (var app in apps)
            {
                if (o.Warm) { Program.Log($"{app.Id} {Path.GetFileName(file)}: warm-up"); One(app, file, 0, dir, warm: true); }
                for (int r = 1; r <= o.Runs; r++)
                {
                    var res = One(app, file, r, dir, warm: false);
                    if (WholeSheet || OpenOnly)
                    {
                        Program.Log(WholeSheet
                            ? $"  run {r}: launch to whole sheet {Fmt(res.WholeSheetMs)} (raw {Fmt(res.WholeSheetRawMs)}, key at {Fmt(res.WholeSheetKeyAt)}, differs from fit page by {res.WholeSheetDiff:P1}){(res.Moved ? " moved" : "")}{(res.Note != null ? " - " + res.Note : "")}"
                            : $"  run {r}: open {Fmt(res.OpenMs)}{(res.Moved ? " moved" : "")}{(res.Note != null ? " - " + res.Note : "")}");
                        results.Add(res);
                        File.WriteAllText(Path.Combine(dir, "results.json"), JsonSerializer.Serialize(results, new JsonSerializerOptions { WriteIndented = true }));
                        continue;
                    }
                    Program.Log($"  run {r}: open {Fmt(res.OpenMs)}  zoom {Fmt(res.ZoomMs)} ({res.FitPct}% -> {res.TargetPct}%, got {res.GotPct}%){(res.Moved ? " moved" : "")}{(res.Note != null ? " - " + res.Note : "")}");
                    Program.Log($"         fit page {Fmt(res.FitPageFirstMs)} / {Fmt(res.FitPageMs)} (at {res.FitPagePct}%)  fit width {Fmt(res.FitWidthFirstMs)} / {Fmt(res.FitWidthMs)} (at {res.FitWidthPct}%)  [first change / settled; one look = {lookMs:0.0} ms]");
                    Program.Log($"         wheel {res.WheelNotches} notches: first change {Fmt(res.WheelFirstMs)}, landing to settled {Fmt(res.WheelLandingMs)}, first notch to settled {Fmt(res.WheelMs)} (at {res.WheelPct}%, target {res.WheelTargetPct}%)" + (res.WheelNote != null ? " - " + res.WheelNote : ""));
                    results.Add(res);
                    File.WriteAllText(Path.Combine(dir, "results.json"), JsonSerializer.Serialize(results, new JsonSerializerOptions { WriteIndented = true }));
                }
            }
        File.WriteAllText(Path.Combine(dir, "summary.md"), Summary(results, o));
        Program.Log("wrote " + dir);
        Console.WriteLine(File.ReadAllText(Path.Combine(dir, "summary.md")));
        return 0;
    }

    static string Fmt(double? ms) => ms == null ? "-" : $"{ms:0} ms";

    static RunResult One(App app, string file, int run, string dir, bool warm)
    {
        if (app.Id == "vellum")
        {
            // Cold preview cache every time: no viewer gets yesterday's render for free.
            var cache = Path.Combine(Program.Root, "profiles", "vellum", "local", "Vellum", "preview-cache");
            try { if (Directory.Exists(cache)) Directory.Delete(cache, true); } catch { }
        }
        if (app.Id == "sumatra")
        {
            // Its settings file holds the session: without this it reopens the last run's tabs.
            var prof = Path.Combine(Program.Root, "profiles", "sumatra");
            try { if (Directory.Exists(prof)) Directory.Delete(prof, true); } catch { }
        }
        // Every run opens a fresh copy at a new path. Viewers remember the last view per file
        // path (zoom, scroll, page), so reopening the same path would start the next run zoomed
        // into wherever the last one ended, which is far more work to draw than the fit view.
        var copyDir = Path.Combine(Program.Root, "files", Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(copyDir);
        var copy = Path.Combine(copyDir, Path.GetFileName(file));
        File.Copy(file, copy);
        Program.DismissStrays();
        try { return Measure(app, copy, run, dir); }
        finally
        {
            if (Program.DismissStrays() > 0) Program.Log($"  closed an error box left by {app.Id}");
            try { Directory.Delete(copyDir, true); } catch { }
        }
    }

    static RunResult Measure(App app, string file, int run, string dir)
    {
        string tag = $"{app.Id}-{Path.GetFileNameWithoutExtension(file)[..Math.Min(12, Path.GetFileNameWithoutExtension(file).Length)].Replace(' ', '_')}-r{run}";
        Zoom.File = file;
        using var s = Program.Launch(app, file);
        if (!Program.Place(s)) return new(app.Id, Path.GetFileName(file), run, null, null, null, null, null, false, "no window");
        if (WholeSheet) return MeasureWholeSheet(s, app, file, run, dir, tag);
        var open = Settle(s, s.Clock, QuietOpenMs, needContent: true);
        Program.SaveBmp(ClientOnScreen(s.Hwnd), Path.Combine(dir, "frames", tag + "-open.bmp"));
        if (open == null) return new(app.Id, Path.GetFileName(file), run, null, null, null, null, null, s.Moved, "open never settled");
        var cover = Program.Covering(s);
        if (cover != null) return new(app.Id, Path.GetFileName(file), run, null, null, null, null, null, s.Moved, $"another window covered the view: '{cover}'");
        if (OpenOnly) return new(app.Id, Path.GetFileName(file), run, open, null, null, null, null, s.Moved, null);

        double? zoomMs = null, fit = null, target = null, got = null; string? note = null;
        double? fitPageMs = null, fitPageFirst = null, fitPagePct = null, fitWidthMs = null, fitWidthFirst = null, fitWidthPct = null;
        if (Zoom.Supported(app))
        {
            Zoom.FitWidth(s);
            Settle(s, Stopwatch.StartNew(), QuietZoomMs, needContent: false);
            Program.SaveBmp(ClientOnScreen(s.Hwnd), Path.Combine(dir, "frames", tag + "-fit.bmp"));
            // Same two views everywhere, timed from the key: the whole page, then back to its width.
            Focus(s.Hwnd); MoveCursorAway(s); Thread.Sleep(300);
            fitPageMs = Settle(s, Stopwatch.StartNew(), QuietZoomMs, needContent: true, trigger: () => Zoom.FitPageKey(s));
            fitPageFirst = firstChange;
            Program.SaveBmp(ClientOnScreen(s.Hwnd), Path.Combine(dir, "frames", tag + "-fitpage.bmp"));
            fitPagePct = Zoom.Read(s);
            Focus(s.Hwnd); MoveCursorAway(s); Thread.Sleep(300);
            fitWidthMs = Settle(s, Stopwatch.StartNew(), QuietZoomMs, needContent: false, trigger: () => Zoom.FitWidthKey(s));
            fitWidthFirst = firstChange;
            Program.SaveBmp(ClientOnScreen(s.Hwnd), Path.Combine(dir, "frames", tag + "-fitwidth.bmp"));
            if (Program.Covering(s) != null) { fitPageMs = fitPageFirst = fitWidthMs = fitWidthFirst = null; }
            fit = Zoom.Read(s);
            fitWidthPct = fit;
            if (fit == null) note = "could not read the zoom level";
            else if (Typed)
            {
                target = Math.Round(fit.Value * Factor, 1);
                // Zoom from fit page, not fit width: at fit page the sheet is centred in every
                // viewer, so a zoom that keeps the centre lands on the middle of the sheet. From
                // fit width each viewer sits somewhere different (SumatraPDF at the top of the
                // aerial drawing zoomed into blank paper: Matt, 18 Nov).
                Focus(s.Hwnd); Zoom.FitPageKey(s);
                Settle(s, Stopwatch.StartNew(), QuietZoomMs, needContent: false);
                if (!Zoom.Prepare(s, target.Value)) note = "no zoom box";
                else
                {
                    Program.SaveBmp(ClientOnScreen(s.Hwnd), Path.Combine(dir, "frames", tag + "-typed.bmp"));
                    MoveCursorAway(s);
                    zoomMs = Settle(s, Stopwatch.StartNew(), QuietZoomMs, needContent: false, trigger: () => Tap(VK_RETURN));
                    Program.SaveBmp(ClientOnScreen(s.Hwnd), Path.Combine(dir, "frames", tag + "-zoom.bmp"));
                    if (zoomMs == null) note = "the view never changed";
                    else if (!endedOnContent) { zoomMs = null; note = "zoomed into a blank part of the sheet"; }
                    cover = Program.Covering(s);
                    if (cover != null) { zoomMs = null; note = $"another window covered the view: '{cover}'"; }
                    got = Zoom.Read(s);
                }
            }
        }
        if (fit == null && app.Id == "sumatra" && Zoom.WheelReadable(app))
        {
            var c = Centre.Find(s, QuietZoomMs);
            if (c != null) fit = Centre.SumatraFitWidth(s, c.Value.area, QuietZoomMs);
            if (fit != null) { fitWidthPct = fit; note = null; }
        }
        var w = fit != null ? Wheel(s, app, file, run, dir, tag, fit.Value * Factor) : new WheelResult { Note = "could not read the fit-width level" };
        return new(app.Id, Path.GetFileName(file), run, open, zoomMs, fit, target, got, s.Moved, note)
        {
            FitPageFirstMs = fitPageFirst, FitPageMs = fitPageMs, FitPagePct = fitPagePct,
            FitWidthFirstMs = fitWidthFirst, FitWidthMs = fitWidthMs, FitWidthPct = fitWidthPct,
            WheelNotches = w.Notches, WheelFirstMs = w.First, WheelMs = w.Settled, WheelLandingMs = w.Landing,
            WheelPct = w.Pct, WheelTargetPct = fit == null ? null : Math.Round(fit.Value * Factor, 1), WheelNote = w.Note,
        };
    }

    /// Launch to the whole sheet drawn, as one step on the launch stopwatch. Viewers open on
    /// different views (Foxit and PDF-XChange show only the top of a long sheet), so as soon as
    /// the window shows any drawing the fit-page key goes (no focus click: it could land
    /// mid-open; Place already brought the window forward), and the step ends when the picture
    /// has been unchanged for the quiet time. A viewer already at fit page just keeps drawing.
    /// Then, untimed, fit width and fit page again: the result counts only if that reference
    /// matches the timed picture, which shows the key arrived. It can't show that the viewer's
    /// fit-page key works at all (Edge's doesn't, so it is left out): check the saved frames.
    static RunResult MeasureWholeSheet(Program.Session s, App app, string file, int run, string dir, string tag)
    {
        RunResult Fail(string why, double? keyAt = null) =>
            new(app.Id, Path.GetFileName(file), run, null, null, null, null, null, s.Moved, why) { WholeSheetKeyAt = keyAt };
        if (!Zoom.HasFitPageKey(app)) return Fail("no fit-page key: not measured");
        double? keyAt = null;
        while (s.Clock.ElapsedMilliseconds < TimeoutMs)
        {
            var (px, cols, rows) = Look(Program.WatchRect(s.Hwnd));
            if (IsContent(px, cols, rows)) { keyAt = s.Clock.Elapsed.TotalMilliseconds; break; }
            Thread.Sleep(5);
        }
        if (keyAt == null) return Fail("never showed any drawing");
        Zoom.FitPageKey(s);
        var whole = Settle(s, s.Clock, QuietOpenMs, needContent: true);
        var timed = Look(Program.WatchRect(s.Hwnd));
        Program.SaveBmp(ClientOnScreen(s.Hwnd), Path.Combine(dir, "frames", tag + "-wholesheet.bmp"));
        if (whole == null) return Fail("never settled", keyAt);
        var cover = Program.Covering(s);
        if (cover != null) return Fail($"another window covered the view: '{cover}'", keyAt);

        Focus(s.Hwnd); MoveCursorAway(s); Zoom.FitWidthKey(s);
        Settle(s, Stopwatch.StartNew(), QuietZoomMs, needContent: false);
        Focus(s.Hwnd); MoveCursorAway(s); Zoom.FitPageKey(s);
        Settle(s, Stopwatch.StartNew(), QuietZoomMs, needContent: true);
        // Acrobat's "Font Capture" error box can appear by now (Windows' own, over the view):
        // close it, or it alone fails the comparison.
        if (Program.DismissStrays() > 0) Settle(s, Stopwatch.StartNew(), 2000, needContent: true);
        var reference = Look(Program.WatchRect(s.Hwnd));
        Program.SaveBmp(ClientOnScreen(s.Hwnd), Path.Combine(dir, "frames", tag + "-reference.bmp"));
        double? diff = Differ(timed, reference);
        var note = diff == null ? "the window changed size" : diff > MatchLimit ? "did not match a fit page taken afterwards: key lost?" : null;
        return new(app.Id, Path.GetFileName(file), run, null, null, null, null, null, s.Moved, note)
        {
            WholeSheetMs = note == null ? whole : null, WholeSheetKeyAt = keyAt, WholeSheetDiff = diff, WholeSheetRawMs = whole,
        };
    }

    /// One look at a screen rectangle: luminance sampled every third pixel each way.
    static unsafe (byte[] px, int cols, int rows) Look(RECT r)
    {
        using var g = new Grabber(r);
        const int step = 3;
        int cols = g.W / step, rows = g.H / step;
        var px = new byte[cols * rows];
        var p = (byte*)g.Grab();
        for (int y = 0, i = 0; y < rows; y++) { var row = p + (y * step) * g.W * 4; for (int x = 0; x < cols; x++, i++) { var q = row + x * step * 4; px[i] = (byte)((q[0] * 29 + q[1] * 150 + q[2] * 77) >> 8); } }
        return (px, cols, rows);
    }

    /// The same test Settle uses for "shows drawing": 2% off the commonest shade, and detailed.
    static bool IsContent(byte[] px, int cols, int rows)
    {
        var hist = new int[256]; foreach (var v in px) hist[v]++;
        int mode = Array.IndexOf(hist, hist.Max()), near = 0;
        for (int v = Math.Max(0, mode - 12); v <= Math.Min(255, mode + 12); v++) near += hist[v];
        return px.Length - near > px.Length / 50 && Detailed(px, cols, rows);
    }

    /// Share of sampled pixels that differ by more than 24 levels; null if the sizes differ.
    static double? Differ((byte[] px, int cols, int rows) a, (byte[] px, int cols, int rows) b)
    {
        if (a.cols != b.cols || a.rows != b.rows) return null;
        int n = 0; for (int i = 0; i < a.px.Length; i++) if (Math.Abs(a.px[i] - b.px[i]) > 24) n++;
        return n / (double)a.px.Length;
    }

    sealed class WheelResult { public int? Notches; public double? First, Settled, Landing, Pct; public string? Note; }

    /// Wheel zoom at the middle of the sheet (see RunResult). In the warm-up launch (run 0) it
    /// counts the notches this viewer needs to reach `targetPct`, one at a time, reading the
    /// level; in measured launches it sends that many in one gesture and times it.
    static WheelResult Wheel(Program.Session s, App app, string file, int run, string dir, string tag, double targetPct)
    {
        if (!Zoom.WheelReadable(app)) return new() { Note = "zoom level can't be read, so the target can't be found" };
        Program.DismissStrays();
        var c = Centre.Find(s, QuietZoomMs); // leaves the viewer at fit page, drawn
        if (c == null) return new() { Note = "could not find the sheet" };
        var page = c.Value.page;
        int cx = page.Left + page.W / 2, cy = page.Top + page.H / 2;
        string key = app.Id + "|" + Path.GetFileName(file);
        if (run == 0)
        {
            double? level = Zoom.Read(s), before = level; int n = 0, stuck = 0;
            // Some viewers (SumatraPDF) show a fit as words, so the first reading may be empty.
            while ((level == null ? n == 0 : level < targetPct * 0.97) && n < MaxNotches && stuck < 3)
            {
                Program.DismissStrays(); SetForegroundWindow(s.Hwnd); Thread.Sleep(50);
                Centre.WheelZoom(cx, cy, 1, 0); n++;
                Thread.Sleep(500);
                var now = Zoom.Read(s);
                stuck = now == level ? stuck + 1 : 0;
                level = now;
            }
            string? why = level == null ? "could not read the level" : stuck >= 3 ? "ignores Ctrl+wheel" : level < targetPct * 0.97 ? $"still short after {n} notches" : null;
            NotchesFor[key] = why == null ? n : -1;
            Program.Log($"  {app.Id}: " + (why ?? $"{n} notches from {before}% to {level}% (target {targetPct:0.#}%)"));
            return new() { Notches = why == null ? n : null, Pct = level, Note = why };
        }
        if (!NotchesFor.TryGetValue(key, out var notches)) return new() { Note = "no warm-up to count the notches" };
        if (notches <= 0) return new() { Note = "the warm-up could not reach the target" };
        Program.DismissStrays(); SetForegroundWindow(s.Hwnd); Thread.Sleep(100);
        SetCursorPos(cx, cy); Thread.Sleep(200);
        double lastNotch = 0;
        var clock = new Stopwatch();
        // The gesture runs beside the watcher, so changes during it are seen as they happen.
        var settled = Settle(s, clock, QuietZoomMs, needContent: false, trigger: () => Task.Run(() =>
        {
            Key(VK_CONTROL, false);
            for (int i = 0; i < notches; i++) { if (i > 0) Thread.Sleep(NotchGapMs); Native.Wheel(cx, cy, 1); Volatile.Write(ref lastNotch, clock.Elapsed.TotalMilliseconds); }
            Key(VK_CONTROL, true);
        }));
        var first = firstChange; bool drawn = endedOnContent;
        MoveCursorAway(s);
        Program.SaveBmp(ClientOnScreen(s.Hwnd), Path.Combine(dir, "frames", tag + "-wheel.bmp"));
        var pct = Zoom.Read(s);
        var cover = Program.Covering(s);
        string? note = settled == null ? "the view never changed" : !drawn ? "landed on a blank part of the sheet" : cover != null ? $"another window covered the view: '{cover}'" : null;
        if (note != null) return new() { Notches = notches, Pct = pct, Note = note };
        var last = Volatile.Read(ref lastNotch);
        return new() { Notches = notches, First = first, Settled = settled, Landing = Math.Max(0, settled!.Value - last), Pct = pct };
    }

    /// Parks the pointer on the window's title bar so hover effects stay out of the watched area.
    internal static void MoveCursorAway(Program.Session s) { var f = Frame(s.Hwnd); SetCursorPos(f.Left + f.W / 2, f.Top + 8); }

    /// Watches the middle of the window until it has been unchanged for quietMs, and returns the
    /// time of the last change on the given clock. With needContent, a blank (near-uniform)
    /// picture doesn't count as settled: that's a viewer still loading.
    /// With a trigger, the picture is grabbed first, then the clock restarts and the trigger
    /// runs, so a change that lands before the next grab still counts; and if nothing ever
    /// changes, the result is null rather than zero.
    /// Set by Settle: the time of the first change it saw after the trigger (null if none).
    static double? firstChange;
    /// Set by Settle: whether the picture it stopped on had drawing in it (see Detailed).
    static bool endedOnContent;
    /// Set by Settle: how long one look at the screen took on average (grab plus compare), ms.
    /// A change is stamped when the grab that shows it returns, so the true time lies between
    /// the reported figure minus this and the reported figure.
    static double lookMs;

    internal static unsafe double? Settle(Program.Session s, Stopwatch clock, int quietMs, bool needContent, Action? trigger = null)
    {
        firstChange = null;
        RECT r = Program.WatchRect(s.Hwnd);
        var g = new Grabber(r);
        try
        {
            const int step = 3;
            int cols = g.W / step, rows = g.H / step, n = cols * rows;
            var prev = new byte[n]; var cur = new byte[n];
            double last = 0; bool first = true; bool content = false; bool changedAtAll = trigger == null;
            if (trigger != null)
            {
                var p0 = (byte*)g.Grab();
                for (int y = 0, i = 0; y < rows; y++) { var row = p0 + (y * step) * g.W * 4; for (int x = 0; x < cols; x++, i++) { var px = row + x * step * 4; prev[i] = (byte)((px[0] * 29 + px[1] * 150 + px[2] * 77) >> 8); } }
                first = false;
                clock.Restart();
                trigger();
            }
            int looks = 0; double looksFrom = clock.Elapsed.TotalMilliseconds;
            while (clock.ElapsedMilliseconds < TimeoutMs)
            {
                if (looks > 0) lookMs = (clock.Elapsed.TotalMilliseconds - looksFrom) / looks;
                looks++;
                // The window can still be moving or resizing early in an open: follow it.
                var nr = Program.WatchRect(s.Hwnd);
                if (nr.Left != r.Left || nr.Top != r.Top || nr.W != r.W || nr.H != r.H)
                {
                    g.Dispose(); r = nr; g = new Grabber(r);
                    cols = g.W / step; rows = g.H / step; n = cols * rows; prev = new byte[n]; cur = new byte[n]; first = true;
                    last = clock.Elapsed.TotalMilliseconds;
                }
                // Stamped after the grab: whatever it shows had happened by then (an upper bound,
                // at most one look late), where stamping before it read up to one look early.
                var p = (byte*)g.Grab();
                double t = clock.Elapsed.TotalMilliseconds;
                var hist = new int[256];
                for (int y = 0, i = 0; y < rows; y++)
                {
                    var row = p + (y * step) * g.W * 4;
                    for (int x = 0; x < cols; x++, i++)
                    {
                        var px = row + x * step * 4;
                        byte l = (byte)((px[0] * 29 + px[1] * 150 + px[2] * 77) >> 8);
                        cur[i] = l; hist[l]++;
                    }
                }
                // Content: at least 2% of the area differs from the most common shade by a margin.
                // A "Loading..." line or a spinner on a plain background doesn't reach that.
                int mode = Array.IndexOf(hist, hist.Max()), near = 0;
                for (int v = Math.Max(0, mode - 12); v <= Math.Min(255, mode + 12); v++) near += hist[v];
                content = n - near > n / 50 && Detailed(cur, cols, rows);
                // Already drawn at the first look: the best we can say is "by now", not 0 ms.
                if (first && trigger == null && last == 0) last = t;
                if (!first)
                {
                    int changed = 0;
                    for (int i = 0; i < n; i++) if (Math.Abs(cur[i] - prev[i]) > 10) changed++;
                    if (changed > n / 4000 + 2) { last = t; changedAtAll = true; firstChange ??= t; }
                }
                first = false;
                (prev, cur) = (cur, prev);
                if (t - last >= quietMs && (!needContent || content)) { endedOnContent = content; return changedAtAll ? last : null; }
                Thread.Sleep(1);
            }
            return null;
        }
        finally { g.Dispose(); }
    }

    /// True when the picture has detail in both directions. A blank page on a contrasting
    /// surround has two shades (which the 2% test passes) but its only edges are the page's own
    /// straight borders: a couple of columns, a couple of rows. A drawing has edges at many
    /// columns and many rows. The measure is the share of columns holding a left-right edge
    /// times the share of rows holding an up-down edge: about 0.0002 for a blank page, under
    /// 0.01 for a line of "Loading..." text or a spinner, 0.09 for a thin strip of drawing
    /// running the height of the view, 0.5 or more for an ordinary sheet.
    static bool Detailed(byte[] px, int cols, int rows)
    {
        var colHit = new bool[cols]; var rowHit = new bool[rows];
        for (int y = 0; y < rows - 1; y++)
            for (int x = 0, i = y * cols; x < cols - 1; x++, i++)
            {
                if (Math.Abs(px[i] - px[i + 1]) > 24) colHit[x] = true;
                if (Math.Abs(px[i] - px[i + cols]) > 24) rowHit[y] = true;
            }
        double c = colHit.Count(b => b) / (double)cols, r = rowHit.Count(b => b) / (double)rows;
        return c * r >= 0.02;
    }

    static string Summary(List<RunResult> rs, Options o)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"# Viewer timings ({DateTime.Now:d MMM yyyy HH:mm})");
        sb.AppendLine();
        sb.AppendLine($"Median of {o.Runs} runs after one warm-up. A step is finished when the picture has been unchanged for {o.Quiet / 1000.0:0.#} s. Window 1600x1000 on the primary monitor. Open: process start to the middle of the window settled. Zoom: from fit page, type {Factor}x the fit-width level into the zoom box, Enter to settled.");
        if (WholeSheet)
        {
            sb.AppendLine();
            sb.AppendLine($"Launch to the whole sheet drawn: process start, fit-page key as soon as any drawing shows, to the picture unchanged for {o.Quiet / 1000.0:0.#} s. A run counts only if its picture differs from a fit page taken afterwards by under {MatchLimit:P0} of sampled pixels.");
            foreach (var f in rs.Select(r => r.File).Distinct())
            {
                sb.AppendLine(); sb.AppendLine($"## {f}"); sb.AppendLine();
                sb.AppendLine("| Viewer | Whole sheet (median) | All runs | Key sent at (all) | Differs from fit page (all) | Notes |");
                sb.AppendLine("|---|---:|---|---|---|---|");
                foreach (var a in rs.Where(r => r.File == f).Select(r => r.App).Distinct())
                {
                    var x = rs.Where(r => r.File == f && r.App == a).ToList();
                    var v = x.Select(r => r.WholeSheetMs).Where(z => z != null).Select(z => z!.Value).OrderBy(z => z).ToList();
                    string med = v.Count == 0 ? "-" : $"{v[v.Count / 2]:0} ms" + (v.Count < x.Count ? $" ({v.Count} of {x.Count})" : "");
                    string all(Func<RunResult, string> k) => string.Join(", ", x.Select(k));
                    var notes = string.Join("; ", x.Select(r => r.Note).Where(n => n != null).Distinct());
                    sb.AppendLine($"| {Apps.Get(a).Label} | {med} | {all(r => r.WholeSheetMs == null ? "-" : $"{r.WholeSheetMs:0}")} | {all(r => r.WholeSheetKeyAt == null ? "-" : $"{r.WholeSheetKeyAt:0}")} | {all(r => r.WholeSheetDiff == null ? "-" : $"{r.WholeSheetDiff:P1}")} | {notes} |");
                }
            }
            return sb.ToString();
        }
        foreach (var f in rs.Select(r => r.File).Distinct())
        {
            sb.AppendLine(); sb.AppendLine($"## {f}"); sb.AppendLine();
            sb.AppendLine("| Viewer | Open (median) | Open (all) | Zoom (median) | Zoom (all) | Zoom levels | Notes |");
            sb.AppendLine("|---|---:|---|---:|---|---|---|");
            foreach (var a in rs.Where(r => r.File == f).Select(r => r.App).Distinct())
            {
                var x = rs.Where(r => r.File == f && r.App == a).ToList();
                string all(Func<RunResult, double?> k) => string.Join(", ", x.Select(k).Select(v => v == null ? "-" : $"{v:0}"));
                string med(Func<RunResult, double?> k) { var v = x.Select(k).Where(z => z != null).Select(z => z!.Value).OrderBy(z => z).ToList(); return v.Count == 0 ? "-" : $"{v[v.Count / 2]:0} ms"; }
                var lv = x.FirstOrDefault(r => r.FitPct != null);
                var notes = string.Join("; ", x.Select(r => r.Note).Where(n => n != null).Distinct());
                sb.AppendLine($"| {Apps.Get(a).Label} | {med(r => r.OpenMs)} | {all(r => r.OpenMs)} | {med(r => r.ZoomMs)} | {all(r => r.ZoomMs)} | {(lv == null ? "-" : $"{lv.FitPct}% -> {lv.TargetPct}% (got {lv.GotPct}%)")} | {notes} |");
            }
            if (OpenOnly) continue; // no zoom steps were run
            sb.AppendLine();
            sb.AppendLine("Same views in every viewer, timed from the key press (first change / settled, median):");
            sb.AppendLine();
            sb.AppendLine("| Viewer | To fit page | Fit page (all settled) | Level | To fit width | Fit width (all settled) | Level |");
            sb.AppendLine("|---|---:|---|---:|---:|---|---:|");
            foreach (var a in rs.Where(r => r.File == f).Select(r => r.App).Distinct())
            {
                var x = rs.Where(r => r.File == f && r.App == a).ToList();
                string all(Func<RunResult, double?> k) => string.Join(", ", x.Select(k).Select(v => v == null ? "-" : $"{v:0}"));
                string med(Func<RunResult, double?> k) { var v = x.Select(k).Where(z => z != null).Select(z => z!.Value).OrderBy(z => z).ToList(); return v.Count == 0 ? "-" : $"{v[v.Count / 2]:0}"; }
                var lv = x.FirstOrDefault(r => r.FitPagePct != null || r.FitWidthPct != null);
                sb.AppendLine($"| {Apps.Get(a).Label} | {med(r => r.FitPageFirstMs)} / {med(r => r.FitPageMs)} ms | {all(r => r.FitPageMs)} | {lv?.FitPagePct}% | {med(r => r.FitWidthFirstMs)} / {med(r => r.FitWidthMs)} ms | {all(r => r.FitWidthMs)} | {lv?.FitWidthPct}% |");
            }
            sb.AppendLine();
            sb.AppendLine($"Wheel zoom at the middle of the sheet, from fit page to {Factor}x fit width, notches {NotchGapMs} ms apart (median):");
            sb.AppendLine();
            sb.AppendLine("| Viewer | Notches | First change | Landing to settled | First notch to settled | Landing (all) | Level reached / target | Notes |");
            sb.AppendLine("|---|---:|---:|---:|---:|---|---|---|");
            foreach (var a in rs.Where(r => r.File == f).Select(r => r.App).Distinct())
            {
                var x = rs.Where(r => r.File == f && r.App == a).ToList();
                string allW(Func<RunResult, double?> k) => string.Join(", ", x.Select(k).Select(v => v == null ? "-" : $"{v:0}"));
                string medW(Func<RunResult, double?> k) { var v = x.Select(k).Where(z => z != null).Select(z => z!.Value).OrderBy(z => z).ToList(); return v.Count == 0 ? "-" : $"{v[v.Count / 2]:0} ms"; }
                var lw = x.LastOrDefault(r => r.WheelPct != null);
                var notesW = string.Join("; ", x.Select(r => r.WheelNote).Where(n => n != null).Distinct());
                sb.AppendLine($"| {Apps.Get(a).Label} | {x.FirstOrDefault(r => r.WheelNotches != null)?.WheelNotches} | {medW(r => r.WheelFirstMs)} | {medW(r => r.WheelLandingMs)} | {medW(r => r.WheelMs)} | {allW(r => r.WheelLandingMs)} | {lw?.WheelPct}% / {lw?.WheelTargetPct}% | {notesW} |");
            }
        }
        return sb.ToString();
    }
}
