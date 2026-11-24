using System.Diagnostics;
using static ViewerBench.Native;

namespace ViewerBench;

/// Finding the middle of the sheet in any viewer, for any PDF, from the screen alone, and
/// zooming there with Ctrl+wheel (zoom at the pointer, as people do).
static class Centre
{
    /// Luminance of every pixel in a screen rectangle, row by row.
    public static unsafe byte[] Grab(RECT r)
    {
        using var g = new Grabber(r);
        var p = (byte*)g.Grab();
        var lum = new byte[g.W * g.H];
        for (int i = 0; i < lum.Length; i++) { var px = p + i * 4; lum[i] = (byte)((px[0] * 29 + px[1] * 150 + px[2] * 77) >> 8); }
        return lum;
    }

    /// Bounding box (in the grab's coordinates) of the pixels where a and b differ, or null.
    static RECT? Changed(byte[] a, byte[] b, int w, int h)
    {
        int l = w, t = h, rr = -1, bb = -1;
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
                if (Math.Abs(a[y * w + x] - b[y * w + x]) > 16) { if (x < l) l = x; if (x > rr) rr = x; if (y < t) t = y; if (y > bb) bb = y; }
        return rr < 0 ? null : new RECT { Left = l, Top = t, Right = rr + 1, Bottom = bb + 1 };
    }

    /// The sheet on screen, with the viewer at fit page. The document area is where the picture
    /// changes between fit width and fit page (toolbars, tabs and side panels don't change).
    /// Inside it, the page is what differs from the surround (the shade most common along the
    /// document area's edges). Returns the page's box and the document area, in screen
    /// coordinates; leaves the viewer at fit page.
    public static (RECT page, RECT area)? Find(Program.Session s, int quietMs)
    {
        var client = ClientOnScreen(s.Hwnd);
        byte[] a, b;
        if (Zoom.FitIsToggle(s.App))
        {
            // Chrome and Edge: one key toggles fit width and fit page, and the level can't be
            // read in Edge. Grab both states; fit page is the one with less page in view, so
            // the one where more of the document area is the surround.
            Focus(s.Hwnd); Bench.MoveCursorAway(s);
            Bench.Settle(s, Stopwatch.StartNew(), quietMs, needContent: false);
            var g1 = Grab(client);
            Focus(s.Hwnd); Zoom.FitPageKey(s); Bench.MoveCursorAway(s);
            Bench.Settle(s, Stopwatch.StartNew(), quietMs, needContent: true);
            var g2 = Grab(client);
            if (Spread(g2) >= Spread(g1)) { a = g1; b = g2; }
            else { a = g2; b = g1; Focus(s.Hwnd); Zoom.FitPageKey(s); Bench.MoveCursorAway(s); Bench.Settle(s, Stopwatch.StartNew(), quietMs, needContent: true); }
        }
        else
        {
            Focus(s.Hwnd); Zoom.FitWidthKey(s);
            Bench.MoveCursorAway(s);
            Bench.Settle(s, Stopwatch.StartNew(), quietMs, needContent: false);
            a = Grab(client);
            Focus(s.Hwnd); Zoom.FitPageKey(s);
            Bench.MoveCursorAway(s);
            Bench.Settle(s, Stopwatch.StartNew(), quietMs, needContent: true);
            b = Grab(client);
        }
        int w = client.W;
        var area = Changed(a, b, w, client.H);
        if (area == null) return null;
        var A = area.Value;
        var page = PageIn(b, w, A);
        RECT Scr(RECT q) => new() { Left = q.Left + client.Left, Top = q.Top + client.Top, Right = q.Right + client.Left, Bottom = q.Bottom + client.Top };
        return (Scr(page), Scr(A));
    }

    /// The page's box inside document area A of grab b (width w), in the grab's coordinates.
    static RECT PageIn(byte[] b, int w, RECT A)
    {
        var hist = new int[256];
        for (int x = A.Left; x < A.Right; x++) { hist[b[A.Top * w + x]]++; hist[b[(A.Bottom - 1) * w + x]]++; }
        for (int y = A.Top; y < A.Bottom; y++) { hist[b[y * w + A.Left]]++; hist[b[y * w + A.Right - 1]]++; }
        int surround = Array.IndexOf(hist, hist.Max());
        // The page: the longest run of columns that are mostly not surround (which skips scroll
        // bars, rulers and small floating panels such as Foxit's signature box), then within
        // those columns the longest run of rows that are mostly not surround.
        bool Off(int x, int y) => Math.Abs(b[y * w + x] - surround) > 10;
        var cols = new bool[A.W];
        for (int x = A.Left; x < A.Right; x++) { int k = 0; for (int y = A.Top; y < A.Bottom; y++) if (Off(x, y)) k++; cols[x - A.Left] = k > A.H / 2; }
        var (c0, c1) = RunNearest(cols, A.W / 2);
        RECT page = A;
        if (c1 > c0)
        {
            var rows = new bool[A.H];
            for (int y = A.Top; y < A.Bottom; y++) { int k = 0; for (int x = A.Left + c0; x < A.Left + c1; x++) if (Off(x, y)) k++; rows[y - A.Top] = k > (c1 - c0) / 2; }
            var (r0, r1) = RunNearest(rows, A.H / 2);
            if (r1 > r0) page = new RECT { Left = A.Left + c0, Right = A.Left + c1, Top = A.Top + r0, Bottom = A.Top + r1 };
        }
        return page;
    }

    /// SumatraPDF's fit-width level in its own units. Its zoom box says "Fit Width" rather than
    /// a number, and its percentages are on a different scale from other viewers (its 100% is
    /// about Vellum's 360%: Matt, 22 Nov), so: set its smallest level, 8% (where even an A0
    /// sheet fits across the window), measure the sheet's width on screen, and scale by the
    /// document area's width, which is what fit width fills. Leaves the viewer at 8%.
    public static double? SumatraFitWidth(Program.Session s, RECT areaOnScreen, int quietMs)
    {
        const double known = 8;
        if (!Zoom.SetSumatraLevel(s, known)) return null;
        Bench.MoveCursorAway(s);
        Bench.Settle(s, Stopwatch.StartNew(), quietMs, needContent: true);
        var client = ClientOnScreen(s.Hwnd);
        var g = Grab(client);
        var A = new RECT { Left = areaOnScreen.Left - client.Left, Top = areaOnScreen.Top - client.Top, Right = areaOnScreen.Right - client.Left, Bottom = areaOnScreen.Bottom - client.Top };
        var page = PageIn(g, client.W, A);
        if (page.W <= 0 || page.W >= A.W) return null; // the sheet didn't fit, or wasn't found
        var level = Math.Round(known * A.W / page.W, 1);
        Program.Log($"  sumatra: sheet {page.W} px wide at {known}% in a {A.W} px document area: fit width = {level}%");
        return level;
    }

    /// The run of true values (gaps of up to 4 allowed: a dark line across a page) that contains
    /// or is nearest to `mid`. At fit page the sheet is centred in the document area, so this
    /// picks the sheet over side panels and mini maps, even when they are bigger than a thin
    /// sheet (the aerial drawing at fit page is about 40 px wide, Vellum's mini map 95).
    static (int from, int to) RunNearest(bool[] v, int mid)
    {
        var runs = new List<(int a, int b)>();
        int start = -1, lastTrue = -10;
        for (int i = 0; i < v.Length; i++)
            if (v[i]) { if (start < 0 || i - lastTrue > 5) { if (start >= 0) runs.Add((start, lastTrue + 1)); start = i; } lastTrue = i; }
        if (start >= 0) runs.Add((start, lastTrue + 1));
        if (runs.Count == 0) return (0, 0);
        int Dist((int a, int b) r) => mid < r.a ? r.a - mid : mid >= r.b ? mid - r.b + 1 : 0;
        return runs.OrderBy(Dist).ThenByDescending(r => r.b - r.a).First();
    }

    /// Spread of shades in a grab: higher when more of it is one plain colour. Used to tell
    /// fit page (mostly surround) from fit width (mostly page) for the toggling viewers.
    static int Spread(byte[] g)
    {
        var hist = new int[256]; foreach (var v in g) hist[v]++;
        return hist.Max();
    }

    /// How the wheel is sent. 0: SetCursorPos then SendInput (what every viewer but Acrobat
    /// takes). 1: an injected mouse move first, then SendInput. 2: posted to the window with
    /// Ctrl in the message. Chosen per viewer once the Acrobat probe shows which works.
    public static int Method;

    /// Ctrl held, `notches` wheel notches up (zoom in) at screen point (x, y), `gapMs` apart.
    public static void WheelZoom(int x, int y, int notches, int gapMs)
    {
        if (Method == 2)
        {
            SetCursorPos(x, y); Thread.Sleep(30);
            for (int i = 0; i < notches; i++) { if (i > 0) Thread.Sleep(gapMs); PostCtrlWheel(x, y, 1); }
            return;
        }
        if (Method == 1) { MoveTo(x + 5, y + 5); Thread.Sleep(50); MoveTo(x, y); Thread.Sleep(150); }
        else { SetCursorPos(x, y); Thread.Sleep(30); }
        Key(VK_CONTROL, false);
        for (int i = 0; i < notches; i++) { if (i > 0) Thread.Sleep(gapMs); Wheel(x, y, 1); }
        Key(VK_CONTROL, true);
    }

    /// Probe for viewers that ignore the wheel: find the centre, then two notches with each way
    /// of sending it (Method 0, 1, 2), reading the level after each. Not timed.
    public static void MethodProbe(App app, string file)
    {
        var copyDir = Path.Combine(Program.Root, "files", Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(copyDir);
        var copy = Path.Combine(copyDir, Path.GetFileName(file)); File.Copy(file, copy);
        Zoom.File = "";
        Program.DismissStrays();
        try
        {
            using var s = Program.Launch(app, copy);
            if (!Program.Place(s)) { Program.Log("no window"); return; }
            Bench.Settle(s, s.Clock, 4000, needContent: true);
            Program.DismissStrays();
            var c = Find(s, 3000);
            if (c == null) { Program.Log("could not find the sheet"); return; }
            var page = c.Value.page;
            int cx = page.Left + page.W / 2, cy = page.Top + page.H / 2;
            // No zoom-box reads until the end: reading Acrobat's box through UI Automation may be
            // what raises its Font Capture error. Changes are seen from the screen instead.
            Program.Log($"{app.Id}: centre ({cx},{cy}), error box up: {Program.DismissStrays() > 0}");
            for (int m = 0; m <= 2; m++)
            {
                Method = m;
                for (int k = 0; k < 2; k++)
                {
                    Program.DismissStrays(); SetForegroundWindow(s.Hwnd); Thread.Sleep(100);
                    var changed = Bench.Settle(s, System.Diagnostics.Stopwatch.StartNew(), 1500, needContent: false, trigger: () => WheelZoom(cx, cy, 1, 0));
                    Program.Log($"  method {m}, notch {k + 1}: view {(changed == null ? "unchanged" : "changed")}");
                }
            }
            Method = 0;
            Program.Log($"  level read at the end: {Zoom.Read(s)}");
        }
        finally
        {
            Program.DismissStrays();
            try { Directory.Delete(copyDir, true); } catch { }
        }
    }

    /// Probe: for each viewer, find the centre, then zoom in one notch at a time there,
    /// reading the level and saving a frame after each. Answers how big each viewer's notch
    /// is and whether it zooms around the pointer. Not timed.
    public static void Probe(List<App> apps, List<string> files, int notches)
    {
        var busy = Program.Running(apps);
        if (busy.Count > 0) { Program.Log("Close these first, the bench would take them over: " + string.Join(", ", busy)); return; }
        var dir = Path.Combine(Program.Root, "wheelprobe-" + DateTime.Now.ToString("yyyyMMdd-HHmm"));
        Directory.CreateDirectory(dir);
        foreach (var file in files)
            foreach (var app in apps)
            {
                var copyDir = Path.Combine(Program.Root, "files", Guid.NewGuid().ToString("N")[..8]);
                Directory.CreateDirectory(copyDir);
                var copy = Path.Combine(copyDir, Path.GetFileName(file));
                File.Copy(file, copy);
                Zoom.File = ""; // read every level from the viewer, never from a per-file table
                var stem = Path.GetFileNameWithoutExtension(file);
                string tag = $"{app.Id}-{stem[..Math.Min(12, stem.Length)].Replace(' ', '_')}";
                Program.DismissStrays();
                try
                {
                    using var s = Program.Launch(app, copy);
                    if (!Program.Place(s)) { Program.Log($"{tag}: no window"); continue; }
                    Bench.Settle(s, s.Clock, 4000, needContent: true);
                    Program.DismissStrays();
                    var c = Find(s, 3000);
                    if (c == null) { Program.Log($"{tag}: could not find the document area"); continue; }
                    var (page, area) = c.Value;
                    int cx = page.Left + page.W / 2, cy = page.Top + page.H / 2;
                    var cl = ClientOnScreen(s.Hwnd);
                    Program.SaveBmp(cl, Path.Combine(dir, tag + "-0.bmp"));
                    var levels = new List<string> { $"{Zoom.Read(s)}" };
                    for (int n = 1; n <= notches; n++)
                    {
                        Program.DismissStrays();
                        SetForegroundWindow(s.Hwnd); Thread.Sleep(100); // Acrobat ignores the wheel while another window is active
                        WheelZoom(cx, cy, 1, 0);
                        Bench.MoveCursorAway(s);
                        Bench.Settle(s, Stopwatch.StartNew(), 3000, needContent: false);
                        Program.SaveBmp(cl, Path.Combine(dir, $"{tag}-{n}.bmp"));
                        levels.Add($"{Zoom.Read(s)}");
                    }
                    var line = $"{tag}\tclient {cl}\tarea {area}\tpage {page}\tcentre {cx - cl.Left},{cy - cl.Top}\tlevels {string.Join(" > ", levels)}";
                    Program.Log(line.Replace('\t', ' '));
                    File.AppendAllText(Path.Combine(dir, "probe.txt"), line + "\n");
                }
                finally
                {
                    Program.DismissStrays();
                    try { Directory.Delete(copyDir, true); } catch { }
                }
            }
        Program.Log("wrote " + dir);
    }
}
