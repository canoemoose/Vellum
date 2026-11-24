using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using static ViewerBench.Native;

namespace ViewerBench;

/// Single wheel notches (`run --notches`): from the zoom finishing to sharp, from the screen.
/// Per launch: fit page, pointer on the sheet's centre, then Count times one Ctrl+wheel notch,
/// each from a settled view, recorded until still for the quiet time. Every grab is kept, so
/// two moments can be told apart afterwards:
///   sharp     the last change at full detail (what Bench.Settle finds);
///   finished  the first grab after which every later grab has the final one's pattern:
///             compared block by block by correlation after a slight blur, which ignores a
///             soft render's lines coming out lighter or darker (CAD line work) but not the
///             picture shifting. A viewer that lands soft and sharpens later finishes early
///             and is sharp late; one that lands sharp has the two a grab or so apart.
///             (First tried 23 Nov as block means within 6 levels: a soft Chrome frame
///             failed it, so Chrome's soft stage counted as movement. Matt, from the frames.)
/// Vellum also logs its own landing to sharp (VELLUM_PERF_LOG), read back as a check on the
/// method. See docs/speed-diagnosis-scope.md, "The cross-viewer zoom test: single notches".
static class Notch
{
    public const int Count = 6;
    const int Step = 3;          // sample every third pixel each way, as Settle does
    const int MaxRecordMs = 30000;
    /// The alignment test: does a picture have the final picture's geometry (soft or not)?
    /// The view is cut into Grid x Grid regions, and in each the shift that best lines the
    /// blurred picture up with the blurred final one is found by correlation, in two passes:
    ///   coarse  on the samples (every third pixel), shifts up to MaxShift samples (12 px);
    ///   fine    on full-resolution pixels, shifts up to FineShift px, for what the coarse
    ///           pass can't see (Vellum's last ease frames move under 3 px).
    /// A region counts as moved only on a confident shift: the shifted match is good (at
    /// least Conf / FineConf) and clearly beats no shift (by Margin / FineMargin). Weak best
    /// shifts are noise: a stretched soft frame of Chrome's that Matt saw sitting in place
    /// (23 Nov) matched best 1 to 3 samples off in its sparse lower regions at 0.5 to 0.8.
    /// A soft or stretched render of the final view has its lines where the sharp ones will
    /// be; a zoom still moving doesn't (away from the zoom's centre the picture is displaced).
    /// Regions with no detail in the final picture (std under Flat levels) are skipped.
    const int Grid = 3, MaxShift = 4, FineShift = 3;
    const double Conf = 0.85, Margin = 0.1, FineConf = 0.9, FineMargin = 0.01;
    public static double Flat = 4;
    public static int BlurR = 1;
    /// --tolerance: a shift of this many pixels or fewer counts as in place (default 0).
    public static int TolPx = 0;
    /// --frames: save every grab that changed (and the one before) as a full-size colour BMP.
    /// --keep-raw: save each notch's sampled grabs, for `analyse` to re-run the test offline.
    public static bool SaveFrames, KeepRaw;

    public sealed record Result(string App, string File, int Run, int Index, double? FirstMs, double? FinishedMs,
        double? SharpMs, double? InAppMs, double? Pct, int Grabs, double GrabMs, string? Note)
    {
        public double? FinishedToSharpMs => SharpMs - FinishedMs;
    }

    sealed class Frame
    {
        /// Px: luminance sampled every Step pixels. Lum: full-resolution luminance, kept for the
        /// first grab and every grab that changed (the pictures the alignment test looks at).
        public double T; public byte[] Px; public byte[]? Bgra; public byte[]? Lum;
        public Frame(double t, byte[] px) { T = t; Px = px; }
    }

    public static int Run(Options o)
    {
        int quiet = o.QuietSet ? o.Quiet : 4000;
        var apps = o.Apps.Select(Apps.Get).Where(a => a.Id != "acrobat").ToList(); // ignores injected wheels
        var busy = Program.Running(apps);
        if (busy.Count > 0) { Program.Log("Close these first, the bench would take them over: " + string.Join(", ", busy)); return 1; }
        var results = new List<Result>();
        var dir = Path.Combine(Program.Root, "notches-" + DateTime.Now.ToString("yyyyMMdd-HHmm"));
        Directory.CreateDirectory(Path.Combine(dir, "frames"));
        foreach (var file in o.Files)
            foreach (var app in apps)
                for (int r = o.Warm ? 0 : 1; r <= o.Runs; r++)
                {
                    Program.Log($"{app.Id} {Path.GetFileName(file)}: {(r == 0 ? "warm-up" : $"run {r}")}");
                    var rs = Bench.Prepared(app, file, copy => Launch(app, copy, Path.GetFileName(file), r, dir, quiet));
                    foreach (var x in rs)
                        Program.Log($"  notch {x.Index}: first change {Fmt(x.FirstMs)}, finished {Fmt(x.FinishedMs)}, sharp {Fmt(x.SharpMs)}"
                            + $" -> finished to sharp {Fmt(x.FinishedToSharpMs)}{(x.InAppMs != null ? $" (in app {x.InAppMs:0} ms)" : "")}"
                            + $" [{x.Grabs} grabs, {x.GrabMs:0.0} ms each]{(x.Note != null ? " - " + x.Note : "")}");
                    if (r > 0) results.AddRange(rs);
                    File.WriteAllText(Path.Combine(dir, "results.json"), JsonSerializer.Serialize(results, new JsonSerializerOptions { WriteIndented = true }));
                }
        File.WriteAllText(Path.Combine(dir, "summary.md"), Summary(results, o, quiet));
        Program.Log("wrote " + dir);
        Console.WriteLine(File.ReadAllText(Path.Combine(dir, "summary.md")));
        return 0;
    }

    static string Fmt(double? ms) => ms == null ? "-" : $"{ms:0} ms";

    static List<Result> Launch(App app, string copy, string name, int run, string dir, int quiet)
    {
        var tag = $"{app.Id}-{Path.GetFileNameWithoutExtension(name)[..Math.Min(12, Path.GetFileNameWithoutExtension(name).Length)].Replace(' ', '_')}-r{run}";
        Zoom.File = copy;
        List<Result> Fail(string why) => new() { new(app.Id, name, run, 0, null, null, null, null, null, 0, 0, why) };
        using var s = Program.Launch(app, copy);
        if (!Program.Place(s)) return Fail("no window");
        if (Bench.Settle(s, s.Clock, quiet, needContent: true) == null) return Fail("open never settled");
        Program.DismissStrays();
        var c = Centre.Find(s, quiet); // leaves the viewer at fit page, drawn
        if (c == null) return Fail("could not find the sheet");
        var page = c.Value.page;
        int cx = page.Left + page.W / 2, cy = page.Top + page.H / 2;
        var log = app.Id == "vellum" ? Path.Combine(Program.Root, "profiles", "vellum", "local", "Vellum", "perf-log.csv") : null;
        var outp = new List<Result>();
        for (int k = 1; k <= Count; k++)
        {
            Program.DismissStrays(); SetForegroundWindow(s.Hwnd); Thread.Sleep(100);
            SetCursorPos(cx, cy); Thread.Sleep(300);
            var sentAt = DateTime.UtcNow;
            var frames = Record(s, quiet, () => { Key(VK_CONTROL, false); Native.Wheel(cx, cy, 1); Key(VK_CONTROL, true); }, out int cols, out int rows, out double grabMs, out int fw, out int fh);
            var pct = Zoom.WheelReadable(app) ? Zoom.Read(s) : null;
            var cover = Program.Covering(s);
            string? note = cover != null ? $"another window covered the view: '{cover}'" : null;
            var (first, finished, sharp, fi, si) = Analyse(frames, cols, rows, fw, fh);
            if (first == null && note == null) note = "the view never changed";
            if (SaveFrames && first != null)
            {
                // Every grab that changed, and the one before each: full size, in colour, named
                // by time from the notch and marked where finished and sharp fell.
                var fd = Path.Combine(dir, "frames", $"{tag}-n{k}");
                Directory.CreateDirectory(fd);
                for (int i = 0; i < frames.Count; i++)
                {
                    if (frames[i].Bgra == null) continue;
                    var mark = (i == fi ? "-FINISHED" : "") + (i == si ? "-SHARP" : "");
                    SaveColour(frames[i].Bgra!, fw, fh, Path.Combine(fd, $"{i:000}-{frames[i].T:0000}ms{mark}.bmp"));
                }
            }
            if (KeepRaw) SaveRaw(frames, cols, rows, fw, fh, Path.Combine(dir, "raw", $"{tag}-n{k}.bin"));
            double? inApp = log != null ? InApp(log, sentAt) : null;
            outp.Add(new(app.Id, name, run, k, first, note == null ? finished : null, note == null ? sharp : null, inApp, pct, frames.Count, grabMs, note));
            frames.Clear();
            GC.Collect();
        }
        Bench.MoveCursorAway(s);
        return outp;
    }

    /// Every grab of the watched area from just before `trigger` until the picture has been
    /// unchanged for quietMs, each stamped (after its grab) on a clock started at the trigger.
    /// The first frame (T = 0) is the picture before the trigger.
    static unsafe List<Frame> Record(Program.Session s, int quietMs, Action trigger, out int cols, out int rows, out double grabMs, out int fw, out int fh)
    {
        var r = Program.WatchRect(s.Hwnd);
        using var g = new Grabber(r);
        int cw = g.W / Step, rh = g.H / Step, n = cw * rh, bytes = g.W * g.H * 4;
        cols = cw; rows = rh; fw = g.W; fh = g.H;
        var frames = new List<Frame>();
        byte[] Look(out byte[]? bgra)
        {
            var p = (byte*)g.Grab(); var px = new byte[n];
            for (int y = 0, i = 0; y < rh; y++) { var row = p + (y * Step) * g.W * 4; for (int x = 0; x < cw; x++, i++) { var q = row + x * Step * 4; px[i] = (byte)((q[0] * 29 + q[1] * 150 + q[2] * 77) >> 8); } }
            bgra = null;
            if (SaveFrames) { bgra = new byte[bytes]; new ReadOnlySpan<byte>(p, bytes).CopyTo(bgra); }
            return px;
        }
        // Full-resolution luminance of the grab just taken (the grabber's buffer holds it until
        // the next grab).
        byte[] LumOfLast()
        {
            var lum = new byte[g.W * g.H];
            var p = (byte*)g.Bits;
            for (int i = 0; i < lum.Length; i++) { var q = p + i * 4; lum[i] = (byte)((q[0] * 29 + q[1] * 150 + q[2] * 77) >> 8); }
            return lum;
        }
        frames.Add(new(0, Look(out var prevBgra)) { Lum = LumOfLast() });
        var clock = Stopwatch.StartNew();
        trigger();
        double last = 0;
        while (clock.ElapsedMilliseconds < MaxRecordMs)
        {
            var px = Look(out var bgra);
            double t = clock.Elapsed.TotalMilliseconds;
            var f = new Frame(t, px);
            if (Changed(frames[^1].Px, px))
            {
                last = t;
                f.Lum = LumOfLast();
                // Keep this grab in colour, and the one before it (the picture it replaced).
                frames[^1].Bgra ??= prevBgra;
                f.Bgra = bgra;
            }
            frames.Add(f);
            prevBgra = bgra;
            if (t - last >= quietMs) break;
            Thread.Sleep(1);
        }
        grabMs = frames.Count > 1 ? frames[^1].T / (frames.Count - 1) : 0;
        return frames;
    }

    /// The same test Settle uses: more than a handful of samples moved by more than 10 levels.
    static bool Changed(byte[] a, byte[] b)
    {
        int changed = 0, n = a.Length;
        for (int i = 0; i < n; i++) if (Math.Abs(a[i] - b[i]) > 10) changed++;
        return changed > n / 4000 + 2;
    }

    /// Box blur of radius BlurR (separable), so a soft render's lines overlap the sharp ones
    /// and correlate, while a picture that has moved still doesn't.
    static float[] Blur(byte[] px, int cols, int rows)
    {
        var a = new float[px.Length]; var b = new float[px.Length]; int r = BlurR;
        for (int y = 0; y < rows; y++)
            for (int x = 0; x < cols; x++)
            {
                float sum = 0; int n = 0;
                for (int d = -r; d <= r; d++) { int xx = x + d; if (xx < 0 || xx >= cols) continue; sum += px[y * cols + xx]; n++; }
                a[y * cols + x] = sum / n;
            }
        for (int y = 0; y < rows; y++)
            for (int x = 0; x < cols; x++)
            {
                float sum = 0; int n = 0;
                for (int d = -r; d <= r; d++) { int yy = y + d; if (yy < 0 || yy >= rows) continue; sum += a[yy * cols + x]; n++; }
                b[y * cols + x] = sum / n;
            }
        return b;
    }

    /// Diagnostics for `analyse --why`: each region's best shift and its correlation there.
    public static bool Why;
    static List<string>? why;

    /// Correlation of region (x0, y0, w, h) of `end` with `f` displaced by (dx, dy).
    static double Ncc(float[] f, float[] end, int cols, int x0, int y0, int w, int h, int dx, int dy)
    {
        double sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0; int m = w * h;
        for (int y = y0; y < y0 + h; y++)
            for (int x = x0; x < x0 + w; x++)
            {
                double u = f[(y + dy) * cols + x + dx], v = end[y * cols + x];
                sa += u; sb += v; saa += u * u; sbb += v * v; sab += u * v;
            }
        double va = saa / m - (sa / m) * (sa / m), vb = sbb / m - (sb / m) * (sb / m);
        if (va < 1e-6 || vb < 1e-6) return 0;
        return (sab / m - (sa / m) * (sb / m)) / Math.Sqrt(va * vb);
    }

    /// Whether region `gx, gy` of blurred picture `f` is confidently displaced from the same
    /// region of blurred `end`: its best shift (up to `max` each way) matches at `conf` or
    /// better and beats no shift by more than `margin`. Null where the final picture has no
    /// detail there (it can't say where anything is).
    static bool? Moved(float[] f, float[] end, int w, int h, int gx, int gy, int max, double conf, double margin, string pass)
    {
        int rw = (w - 2 * max) / Grid, rh = (h - 2 * max) / Grid, x0 = max + gx * rw, y0 = max + gy * rh;
        double s = 0, ss = 0;
        for (int y = y0; y < y0 + rh; y++) for (int x = x0; x < x0 + rw; x++) { double v = end[y * w + x]; s += v; ss += v * v; }
        if (ss / (rw * rh) - (s / (rw * rh)) * (s / (rw * rh)) < Flat * Flat) return null;
        double c0 = Ncc(f, end, w, x0, y0, rw, rh, 0, 0), best = double.MinValue; int bx = 0, by = 0;
        for (int dy = -max; dy <= max; dy++)
            for (int dx = -max; dx <= max; dx++)
            {
                if (dx == 0 && dy == 0) continue;
                double c = Ncc(f, end, w, x0, y0, rw, rh, dx, dy);
                if (c > best) { best = c; bx = dx; by = dy; }
            }
        bool moved = best >= conf && best - c0 > margin && Math.Max(Math.Abs(bx), Math.Abs(by)) * (pass == "coarse" ? Step : 1) > TolPx;
        why?.Add(moved ? $"{pass} MOVED ({bx},{by}) {best:0.00} vs {c0:0.00}" : $"{pass} ok {c0:0.00} (best other ({bx},{by}) {best:0.00})");
        return moved;
    }

    /// True when picture `i` has the final picture's geometry (see the constants above): no
    /// region confidently displaced, first on the samples, then on full-resolution pixels.
    static bool Aligned(Frame f, Frame end, float[] endPx, float[] endLum, int cols, int rows, int fw, int fh)
    {
        var px = Blur(f.Px, cols, rows);
        var lum = f.Lum != null && end.Lum != null ? Blur(f.Lum, fw, fh) : null;
        for (int gy = 0; gy < Grid; gy++)
            for (int gx = 0; gx < Grid; gx++)
            {
                if (Moved(px, endPx, cols, rows, gx, gy, MaxShift, Conf, Margin, "coarse") == true) return false;
                if (lum != null && Moved(lum, endLum, fw, fh, gx, gy, FineShift, FineConf, FineMargin, "fine") == true) return false;
            }
        return true;
    }

    /// First change, finished and sharp (ms from the notch), with the frame indexes of
    /// finished and sharp. Sharp is the last frame that differs from the one before it;
    /// finished is the earliest frame from which every later one has the final geometry.
    static (double? first, double? finished, double? sharp, int fi, int si) Analyse(List<Frame> f, int cols, int rows, int fw, int fh)
    {
        if (f.Count < 2) return (null, null, null, 0, 0);
        // The pictures the notch showed: each grab that changed starts one.
        var pics = new List<int>();
        for (int i = 1; i < f.Count; i++) if (Changed(f[i - 1].Px, f[i].Px)) pics.Add(i);
        if (pics.Count == 0) return (null, null, null, 0, 0);
        int firstIdx = pics[0], sharpIdx = pics[^1];
        var end = f[sharpIdx];
        var endPx = Blur(end.Px, cols, rows);
        var endLum = end.Lum != null ? Blur(end.Lum, fw, fh) : Array.Empty<float>();
        int j = pics.Count - 1;
        while (j - 1 >= 0 && Aligned(f[pics[j - 1]], end, endPx, endLum, cols, rows, fw, fh)) j--;
        int k = pics[j];
        return (f[firstIdx].T, f[k].T, f[sharpIdx].T, k, sharpIdx);
    }

    /// Vellum's own landing-to-sharp for this notch: the first settle-to-sharp row it logged
    /// after the notch went (waits up to 3 s for the row to be written).
    static double? InApp(string path, DateTime after)
    {
        var deadline = Stopwatch.StartNew();
        while (deadline.ElapsedMilliseconds < 3000)
        {
            try
            {
                using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                using var rd = new StreamReader(fs);
                string? line; string[]? head = null;
                while ((line = rd.ReadLine()) != null)
                {
                    var c = Csv(line);
                    if (head == null) { head = c; continue; }
                    int ti = Array.IndexOf(head, "time"), si = Array.IndexOf(head, "source"), mi = Array.IndexOf(head, "settle_to_sharp_ms");
                    if (ti < 0 || mi < 0 || c.Length <= Math.Max(ti, mi)) continue;
                    if (si >= 0 && c[si] != "interactive") continue;
                    if (!DateTime.TryParse(c[ti], CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var t)) continue;
                    if (t > after && double.TryParse(c[mi], NumberStyles.Float, CultureInfo.InvariantCulture, out var ms)) return ms;
                }
            }
            catch (IOException) { }
            Thread.Sleep(100);
        }
        return null;
    }

    static string[] Csv(string line)
    {
        var o = new List<string>(); var sb = new StringBuilder(); bool q = false;
        for (int i = 0; i < line.Length; i++)
        {
            char ch = line[i];
            if (q) { if (ch == '"') { if (i + 1 < line.Length && line[i + 1] == '"') { sb.Append('"'); i++; } else q = false; } else sb.Append(ch); }
            else if (ch == '"') q = true;
            else if (ch == ',') { o.Add(sb.ToString()); sb.Clear(); }
            else sb.Append(ch);
        }
        o.Add(sb.ToString());
        return o.ToArray();
    }

    static void SaveColour(byte[] bgra, int w, int h, string path)
    {
        using var f = File.Create(path); using var wr = new BinaryWriter(f);
        int size = w * h * 4;
        wr.Write((ushort)0x4D42); wr.Write(54 + size); wr.Write(0); wr.Write(54);
        wr.Write(40); wr.Write(w); wr.Write(-h); wr.Write((short)1); wr.Write((short)32); wr.Write(0); wr.Write(size); wr.Write(2835); wr.Write(2835); wr.Write(0); wr.Write(0);
        wr.Write(bgra);
    }

    const int RawVersion = 2;

    static void SaveRaw(List<Frame> frames, int cols, int rows, int fw, int fh, string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        using var f = File.Create(path); using var w = new BinaryWriter(f);
        w.Write(-RawVersion); w.Write(cols); w.Write(rows); w.Write(fw); w.Write(fh); w.Write(frames.Count);
        foreach (var fr in frames)
        {
            w.Write(fr.T); w.Write(fr.Px);
            w.Write(fr.Lum != null);
            if (fr.Lum != null) w.Write(fr.Lum);
        }
    }

    static List<Frame> LoadRaw(string path, out int cols, out int rows, out int fw, out int fh)
    {
        using var f = File.OpenRead(path); using var r = new BinaryReader(f);
        if (r.ReadInt32() != -RawVersion) throw new InvalidDataException($"{path}: saved by an older viewer-bench (no full-resolution pictures)");
        cols = r.ReadInt32(); rows = r.ReadInt32(); fw = r.ReadInt32(); fh = r.ReadInt32(); int n = r.ReadInt32();
        var o = new List<Frame>(n);
        for (int i = 0; i < n; i++)
        {
            var fr = new Frame(r.ReadDouble(), r.ReadBytes(cols * rows));
            if (r.ReadBoolean()) fr.Lum = r.ReadBytes(fw * fh);
            o.Add(fr);
        }
        return o;
    }

    /// `analyse <run dir> [--blur r] [--why]`: the alignment test again on a run's saved grabs
    /// (from --keep-raw), for checking and tuning without another run. Vellum's in-app figures
    /// come from the run's results.json.
    public static int Analyse(string dir)
    {
        var rpath = Path.Combine(dir, "results.json");
        var res = File.Exists(rpath) ? JsonSerializer.Deserialize<List<Result>>(File.ReadAllText(rpath)) ?? new() : new();
        Console.WriteLine($"alignment test: {Grid}x{Grid} regions; coarse shifts up to {MaxShift} samples (moved at >= {Conf} and > {Margin} better than none); fine up to {FineShift} px (>= {FineConf}, > {FineMargin}); blur radius {BlurR}, flat {Flat}");
        foreach (var p in Directory.GetFiles(Path.Combine(dir, "raw"), "*.bin").OrderBy(x => x))
        {
            var fr = LoadRaw(p, out int c, out int r, out int fw, out int fh);
            var (first, fin, sharp, _, si) = Analyse(fr, c, r, fw, fh);
            var name = Path.GetFileNameWithoutExtension(p);
            var app = name[..name.IndexOf('-')];
            int ri = name.LastIndexOf("-r"), ni = name.LastIndexOf("-n");
            int run = int.Parse(name[(ri + 2)..ni]), k = int.Parse(name[(ni + 2)..]);
            var inApp = res.FirstOrDefault(x => x.App == app && x.Run == run && x.Index == k)?.InAppMs;
            Console.WriteLine($"{name}: first {Fmt(first)}, finished {Fmt(fin)}, sharp {Fmt(sharp)} -> finished to sharp {Fmt(sharp - fin)}{(inApp != null ? $" (in app {inApp:0} ms)" : "")}");
            if (Why)
            {
                // Every picture the notch showed (each grab that changed), against the final one:
                // each region in turn until one has confidently moved.
                if (first == null) continue;
                var end = fr[si];
                var endPx = Blur(end.Px, c, r);
                var endLum = end.Lum != null ? Blur(end.Lum, fw, fh) : Array.Empty<float>();
                for (int i = 1; i < fr.Count; i++)
                {
                    if (!Changed(fr[i - 1].Px, fr[i].Px)) continue;
                    why = new();
                    bool al = Aligned(fr[i], end, endPx, endLum, c, r, fw, fh);
                    Console.WriteLine($"    picture from {fr[i].T:0} ms: {(al ? "aligned" : "moved")}  " + string.Join("  ", why));
                    why = null;
                }
            }
        }
        return 0;
    }

    static string Summary(List<Result> rs, Options o, int quiet)
    {
        static double? Med(IEnumerable<double?> xs) { var v = xs.Where(x => x != null).Select(x => x!.Value).OrderBy(x => x).ToList(); return v.Count == 0 ? null : v[v.Count / 2]; }
        var sb = new StringBuilder();
        sb.AppendLine($"# Single wheel notches ({DateTime.Now:d MMM yyyy HH:mm})");
        sb.AppendLine();
        sb.AppendLine($"{o.Runs} launches per viewer after a warm-up, {Count} notches in each from fit page, one Ctrl+wheel notch at the sheet's centre at a time, each from a settled view; a notch ends when the picture has been unchanged for {quiet / 1000.0:0.#} s. Window 1600x1000. Finished: the picture has its final geometry, sharp or not (alignment test, tolerance {TolPx} px); sharp: its last change. Times from the notch; medians over every notch.");
        foreach (var f in rs.Select(r => r.File).Distinct())
        {
            sb.AppendLine(); sb.AppendLine($"## {f}"); sb.AppendLine();
            sb.AppendLine("| Viewer | Finished to sharp | Notch to sharp | Notch to first change | Vellum in app | Notches counted | Notes |");
            sb.AppendLine("|---|---:|---:|---:|---:|---|---|");
            foreach (var a in rs.Where(r => r.File == f).Select(r => r.App).Distinct())
            {
                var x = rs.Where(r => r.File == f && r.App == a).ToList();
                var ok = x.Where(r => r.Note == null).ToList();
                var notes = string.Join("; ", x.Select(r => r.Note).Where(n => n != null).Distinct());
                sb.AppendLine($"| {Apps.Get(a).Label} | {Fmt(Med(ok.Select(r => r.FinishedToSharpMs)))} | {Fmt(Med(ok.Select(r => r.SharpMs)))} | {Fmt(Med(ok.Select(r => r.FirstMs)))} | {(a == "vellum" ? Fmt(Med(ok.Select(r => r.InAppMs))) : "")} | {ok.Count} of {x.Count} | {notes} |");
            }
        }
        return sb.ToString();
    }
}
