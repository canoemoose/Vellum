using System.Diagnostics;
using System.Text.Json;
using System.Windows.Automation;
using static ViewerBench.Native;

namespace ViewerBench;

/// Times PDF viewers from the outside: launch on a file, place the window, then watch the
/// middle of the document area until it stops changing. ASCII-only console output.
static class Program
{
    // The window every viewer is placed in: 1600x1000 at (100,100) on the primary monitor.
    public static readonly RECT Target = new() { Left = 100, Top = 100, Right = 1700, Bottom = 1100 };
    public static string Root = "";

    static int Main(string[] args)
    {
        Root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "bench-output", "viewers"));
        var opt = Options.Parse(args);
        if (opt.Root != null) Root = Path.GetFullPath(opt.Root);
        Directory.CreateDirectory(Root);
        switch (opt.Mode)
        {
            case "probe": Probe(Apps.Get(opt.Apps[0]), opt.Files[0]); return 0;
            case "run": return Bench.Run(opt);
            case "exp": Exp(Apps.Get(opt.Apps[0]), opt.Files[0]); return 0;
            case "open": Hold(Apps.Get(opt.Apps[0]), opt.Files[0]); return 0;
            case "wheelprobe": Centre.Probe(opt.Apps.Select(Apps.Get).ToList(), opt.Files, 6); return 0;
            case "methodprobe": Centre.MethodProbe(Apps.Get(opt.Apps[0]), opt.Files[0]); return 0;
            default:
                Console.WriteLine("usage: viewer-bench probe <app> <file> | run [--apps a,b] [--runs 3] [--zoom 400] files...");
                return 2;
        }
    }

    public static void Log(string s) => Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {s}");

    // ---------- launching and the window ----------

    public sealed class Session : IDisposable
    {
        public readonly App App; public readonly Process Proc; public readonly Stopwatch Clock;
        public IntPtr Hwnd; public bool Moved;
        public Session(App app, Process p, Stopwatch clock) { App = app; Proc = p; Clock = clock; }

        public void Dispose() => Close(this);
    }

    public static Session Launch(App app, string file)
    {
        var psi = app.Start(file, Root);
        var clock = Stopwatch.StartNew();
        var p = Process.Start(psi)!;
        return new Session(app, p, clock);
    }

    /// The viewer's main window: the biggest visible top-level window owned by the launched
    /// process tree, or for the single-instance apps, by any process with the same exe name.
    public static IntPtr FindWindow(Session s)
    {
        var pids = ProcessTree(s.Proc.Id);
        // Single-instance desktop viewers may hand the file to a process they start themselves.
        // Never for browsers or Vellum: those could match windows we didn't launch.
        if (s.App.SingleInstance) foreach (var p in Process.GetProcessesByName(ExeName(s))) pids.Add(p.Id);
        IntPtr best = IntPtr.Zero; long area = 0;
        foreach (var h in TopWindows())
        {
            if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) continue; // skip owned popups
            GetWindowThreadProcessId(h, out var pid);
            if (!pids.Contains((int)pid)) continue;
            var r = Frame(h); long a = (long)r.W * r.H;
            if (r.W < 500 || r.H < 400) continue;
            if (a > area) { area = a; best = h; }
        }
        return best;
    }

    /// Waits for the main window and puts it at Target if it isn't there already.
    public static bool Place(Session s, int timeoutMs = 60000)
    {
        while (s.Clock.ElapsedMilliseconds < timeoutMs)
        {
            var h = FindWindow(s);
            if (h != IntPtr.Zero) { s.Hwnd = h; break; }
            Thread.Sleep(10);
        }
        if (s.Hwnd == IntPtr.Zero) return false;
        var r = Frame(s.Hwnd);
        if (IsZoomed(s.Hwnd) || Math.Abs(r.Left - Target.Left) > 2 || Math.Abs(r.Top - Target.Top) > 2 || Math.Abs(r.W - Target.W) > 2 || Math.Abs(r.H - Target.H) > 2)
        {
            s.Moved = true;
            if (IsZoomed(s.Hwnd)) ShowWindow(s.Hwnd, 9);
            // SetWindowPos takes the outer rectangle, which includes the invisible borders.
            GetWindowRect(s.Hwnd, out var outer); var vis = Frame(s.Hwnd);
            int l = vis.Left - outer.Left, t = vis.Top - outer.Top, rr = outer.Right - vis.Right, b = outer.Bottom - vis.Bottom;
            SetWindowPos(s.Hwnd, IntPtr.Zero, Target.Left - l, Target.Top - t, Target.W + l + rr, Target.H + t + b, 0x0004 | 0x0040);
        }
        SetForegroundWindow(s.Hwnd); // no click here: it would land mid-open
        return true;
    }

    public static string ExeName(Session s) => Path.GetFileNameWithoutExtension(s.Proc.StartInfo.FileName);

    /// Single-instance viewers already running (Matt's own windows): the bench must not start.
    public static List<string> Running(IEnumerable<App> apps) =>
        apps.Where(a => a.SingleInstance && Process.GetProcessesByName(Path.GetFileNameWithoutExtension(a.Start("x.pdf", Root).FileName)).Length > 0)
            .Select(a => a.Label).ToList();

    public static void Close(Session s)
    {
        try
        {
            if (s.Hwnd != IntPtr.Zero) PostMessage(s.Hwnd, 0x0010, IntPtr.Zero, IntPtr.Zero); // WM_CLOSE
            if (!s.Proc.WaitForExit(8000)) s.Proc.Kill(true);
        }
        catch { }
        // Single-instance viewers may have handed the file to another process; make sure it's gone.
        // (Bench.Run refuses to start while any of them is already running, so these are ours.)
        if (s.App.SingleInstance)
        {
            var deadline = Stopwatch.StartNew();
            while (deadline.ElapsedMilliseconds < 8000 && Process.GetProcessesByName(ExeName(s)).Length > 0) Thread.Sleep(100);
            foreach (var p in Process.GetProcessesByName(ExeName(s))) try { p.Kill(true); } catch { }
        }
        Thread.Sleep(1500); // let the desktop settle before the next run
    }

    /// The title of a window from outside the viewer that sits over the watched area (an error
    /// dialog, a notification), or null. A run with one is void: the timing watched that window.
    public static string? Covering(Session s)
    {
        var pids = ProcessTree(s.Proc.Id);
        if (s.App.SingleInstance) foreach (var p in Process.GetProcessesByName(ExeName(s))) pids.Add(p.Id);
        var w = WatchRect(s.Hwnd);
        foreach (var h in TopWindows()) // top of the z-order first
        {
            if (h == s.Hwnd) return null; // everything after this is underneath
            if (!IsWindowVisible(h) || Cloaked(h)) continue;
            GetWindowThreadProcessId(h, out var pid);
            if (pids.Contains((int)pid)) continue;
            var t = Title(h); if (t.Length == 0) continue; // untitled overlays (shell, GPU) are see-through
            var r = Frame(h);
            if (r.W < 40 || r.H < 40) continue;
            if (r.Left < w.Right && r.Right > w.Left && r.Top < w.Bottom && r.Bottom > w.Top) return t;
        }
        return null;
    }

    /// Closes the error box Acrobat raises on some drawings ("Font Capture: Windows - Application
    /// Error", owned by Windows rather than Acrobat), so it can't sit over the next viewer's run.
    public static int DismissStrays()
    {
        int n = 0;
        foreach (var h in TopWindows())
            if (IsWindowVisible(h) && Title(h).StartsWith("Font Capture", StringComparison.Ordinal)) { PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); n++; }
        if (n > 0) Thread.Sleep(500);
        return n;
    }

    /// The part of the window we watch: the middle of the client area, clear of toolbars,
    /// tabs, status bars and side panels, which can blink or animate on their own.
    public static RECT WatchRect(IntPtr h)
    {
        var c = ClientOnScreen(h);
        return new RECT { Left = c.Left + c.W * 30 / 100, Right = c.Left + c.W * 80 / 100, Top = c.Top + c.H * 30 / 100, Bottom = c.Top + c.H * 85 / 100 };
    }

    /// Saves a screen rectangle as a 32-bit BMP (for checking a run did what it should).
    public static unsafe void SaveBmp(RECT r, string path)
    {
        if (r.W <= 0 || r.H <= 0) return;
        using var g = new Grabber(r);
        var bits = (byte*)g.Grab();
        using var f = File.Create(path); using var w = new BinaryWriter(f);
        int size = g.W * g.H * 4;
        w.Write((ushort)0x4D42); w.Write(54 + size); w.Write(0); w.Write(54);
        w.Write(40); w.Write(g.W); w.Write(-g.H); w.Write((short)1); w.Write((short)32); w.Write(0); w.Write(size); w.Write(2835); w.Write(2835); w.Write(0); w.Write(0);
        w.Write(new ReadOnlySpan<byte>(bits, size));
    }

    static void Dump(AutomationElement root, string tag)
    {
        foreach (AutomationElement e in root.FindAll(TreeScope.Subtree, Condition.TrueCondition))
        {
            try { var ci = e.Current; string val = ""; if (e.TryGetCurrentPattern(ValuePattern.Pattern, out var vp)) val = ((ValuePattern)vp).Current.Value;
                Log($"{tag} {ci.ControlType.ProgrammaticName} name='{ci.Name}' class='{ci.ClassName}' value='{val}'"); } catch { }
        }
    }

    static void Exp(App app, string file)
    {
        using var s = Launch(app, file);
        Place(s); Thread.Sleep(9000);
        if (app.Id == "sumatra")
        {
            Focus(s.Hwnd); Chord(VK_CONTROL, (ushort)'Y'); Thread.Sleep(1000);
            var fg = GetForegroundWindow(); Log($"fg '{Title(fg)}' class {Class(fg)} main={fg == s.Hwnd}");
            Dump(AutomationElement.FromHandle(fg), "[dlg]");
            Tap(VK_ESCAPE);
        }
        else
        {
            var b = Zoom.Box(s)!; Log("box " + b.Current.Name);
            var vp = (ValuePattern)b.GetCurrentPattern(ValuePattern.Pattern);
            try { vp.SetValue("114.4"); Log("setvalue ok"); } catch (Exception ex) { Log("setvalue failed " + ex.GetType().Name); }
            Thread.Sleep(500); Log("value now " + vp.Current.Value);
            try { b.SetFocus(); } catch { }
            Tap(VK_RETURN); Thread.Sleep(3000);
            Log("after enter " + ((ValuePattern)Zoom.Box(s)!.GetCurrentPattern(ValuePattern.Pattern)).Current.Value);
        }
    }

    // ---------- probe: list the zoom-looking controls ----------

    /// Opens a viewer exactly as a run does and leaves it open until someone closes it: for
    /// answering first-run prompts (Foxit's "opened by an unsigned application") by hand.
    static void Hold(App app, string file)
    {
        var s = Launch(app, file);
        Log($"opened {app.Label}; close it when you're done");
        if (app.SingleInstance) { Thread.Sleep(3000); while (Process.GetProcessesByName(ExeName(s)).Length > 0) Thread.Sleep(500); }
        else s.Proc.WaitForExit();
        Log("closed");
    }

    static void Probe(App app, string file)
    {
        using var s = Launch(app, file);
        if (!Place(s)) { Log("no window"); return; }
        Log($"window '{Title(s.Hwnd)}' class {Class(s.Hwnd)} frame {Frame(s.Hwnd)} moved={s.Moved}");
        Thread.Sleep(15000);
        Log($"now '{Title(s.Hwnd)}'");
        SaveBmp(ClientOnScreen(s.Hwnd), Path.Combine(Root, $"probe-{app.Id}.bmp"));
        var root = AutomationElement.FromHandle(s.Hwnd);
        foreach (AutomationElement e in root.FindAll(TreeScope.Descendants, Condition.TrueCondition))
        {
            try
            {
                var ci = e.Current;
                if (ci.Name.Contains('%') || ci.Name.Contains("oom", StringComparison.OrdinalIgnoreCase) || ci.Name.StartsWith("Fit") || (ci.BoundingRectangle.Y < s.Clock.ElapsedMilliseconds * 0 + 170 && ci.BoundingRectangle.Y > 100))
                    Log($"[pct] {ci.ControlType.ProgrammaticName} name='{ci.Name}' id='{ci.AutomationId}' class='{ci.ClassName}' focusable={ci.IsKeyboardFocusable} enabled={ci.IsEnabled} pats={string.Join(",", e.GetSupportedPatterns().Select(x => x.ProgrammaticName.Replace("PatternIdentifiers.Pattern", "")))} at {ci.BoundingRectangle}");
            }
            catch { }
        }
        var cond = new OrCondition(
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ComboBox),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Spinner));
        foreach (AutomationElement e in root.FindAll(TreeScope.Descendants, cond))
        {
            string val = "";
            try { if (e.TryGetCurrentPattern(ValuePattern.Pattern, out var vp)) val = ((ValuePattern)vp).Current.Value; } catch { }
            var ci = e.Current;
            Log($"{ci.ControlType.ProgrammaticName} name='{ci.Name}' id='{ci.AutomationId}' class='{ci.ClassName}' value='{val}' at {ci.BoundingRectangle}");
        }
    }
}

sealed class Options
{
    public string Mode = "";
    public List<string> Apps = new(), Files = new();
    public int Runs = 3, Zoom = 400, Quiet = 10000; public bool Warm = true, Typed;
    public string? Root;
    public static Options Parse(string[] a)
    {
        var o = new Options();
        for (int i = 0; i < a.Length; i++)
        {
            switch (a[i])
            {
                case "--apps": o.Apps.AddRange(a[++i].Split(',')); break;
                case "--runs": o.Runs = int.Parse(a[++i]); break;
                case "--zoom": o.Zoom = int.Parse(a[++i]); break;
                case "--quiet": o.Quiet = int.Parse(a[++i]); break;
                case "--typed": o.Typed = true; break;
                case "--out": o.Root = a[++i]; break;
                case "--no-warm": o.Warm = false; break;
                default:
                    if (o.Mode == "") o.Mode = a[i];
                    else if ((o.Mode == "probe" || o.Mode == "exp" || o.Mode == "open" || o.Mode == "methodprobe") && o.Apps.Count == 0) o.Apps.Add(a[i]);
                    else o.Files.Add(Path.GetFullPath(a[i]));
                    break;
            }
        }
        if (o.Apps.Count == 0) o.Apps.AddRange(ViewerBench.Apps.All.Select(x => x.Id));
        return o;
    }
}
