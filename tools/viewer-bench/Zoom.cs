using System.Globalization;
using System.Text.RegularExpressions;
using System.Windows.Automation;
using static ViewerBench.Native;

namespace ViewerBench;

/// Per-viewer zoom handling: fit to width, read the zoom percentage, type a new one.
/// Every viewer that has a zoom box gets the same treatment: click it, select all, type, Enter.
static class Zoom
{
    static readonly Regex Pct = new(@"^\s*(\d+(?:[.,]\d+)?)\s*%\s*$");

    /// Edge's PDF viewer has only zoom-in and zoom-out buttons, no box to type a level into.
    public static bool Supported(App a) => a.Id != "edge";

    public static void FitWidth(Program.Session s)
    {
        Focus(s.Hwnd);
        if (s.App.Id == "chrome")
        {
            // Chrome opens fitted to width (capped at 100%); Ctrl+\ toggles to fit-to-page and back,
            // and the second press gives true fit to width.
            Chord(VK_CONTROL, 0xDC); Thread.Sleep(800); Chord(VK_CONTROL, 0xDC);
        }
        else Chord(VK_CONTROL, (ushort)'2'); // Fit width in Vellum, Acrobat, Foxit, PDF-XChange and SumatraPDF
    }

    /// The key that fits the whole page in the view. Sent as the timed trigger, so no focus
    /// click here: call Focus first.
    /// Viewers the wheel test runs on. Edge shows no zoom level anywhere, and Acrobat ignores an
    /// injected Ctrl+wheel (three ways tried); both parked by Matt, 22 Nov. (SumatraPDF's box is right in its own units, which differ from everyone
    /// else's: see Centre.SumatraFitWidth.)
    public static bool WheelReadable(App a) => a.Id is not ("edge" or "acrobat");

    /// Chrome and Edge have one key that toggles between fit width and fit page.
    public static bool FitIsToggle(App a) => a.Id is "chrome" or "edge";

    public static void FitPageKey(Program.Session s)
    {
        if (FitIsToggle(s.App)) Chord(VK_CONTROL, 0xDC); // toggles fit width <-> fit page
        else Chord(VK_CONTROL, (ushort)'0'); // Fit page in Vellum, Acrobat, Foxit, PDF-XChange and SumatraPDF
    }

    /// The key that fits the page's width, from fit page. Timed trigger: no focus click.
    public static void FitWidthKey(Program.Session s)
    {
        if (FitIsToggle(s.App)) Chord(VK_CONTROL, 0xDC);
        else Chord(VK_CONTROL, (ushort)'2');
    }

    /// The zoom box: an edit or text whose name or value is just a percentage, in the window.
    public static AutomationElement? Box(Program.Session s)
    {
        // Chromium builds its accessibility tree only once something asks, so try for a while.
        for (int i = 0; i < 10; i++) { try { var b = FindBox(s); if (b != null) return b; } catch (ElementNotAvailableException) { } Thread.Sleep(500); }
        return null;
    }

    static AutomationElement? FindBox(Program.Session s)
    {
        var root = AutomationElement.FromHandle(s.Hwnd);
        var cond = new OrCondition(
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Text));
        AutomationElement? best = null;
        foreach (AutomationElement e in root.FindAll(TreeScope.Descendants, cond))
        {
            var v = Text(e);
            if (v != null && Pct.IsMatch(v)) { best = e; if (e.Current.ControlType == ControlType.Edit) break; }
        }
        return best;
    }

    static string? Text(AutomationElement e)
    {
        try
        {
            if (e.TryGetCurrentPattern(ValuePattern.Pattern, out var vp)) { var v = ((ValuePattern)vp).Current.Value; if (!string.IsNullOrEmpty(v)) return v; }
            return e.Current.Name;
        }
        catch { return null; }
    }

    public static double? Read(Program.Session s)
    {
        if (s.App.Id == "sumatra") return ReadSumatra(s);
        var b = Box(s); if (b == null) return null;
        Match m; try { m = Pct.Match(Text(b) ?? ""); } catch (ElementNotAvailableException) { return null; } return m.Success ? double.Parse(m.Groups[1].Value.Replace(',', '.'), CultureInfo.InvariantCulture) : null;
    }

    /// Types the level and returns just before pressing Enter, so the caller can start the clock.
    public static bool Prepare(Program.Session s, double pct)
    {
        var text = pct.ToString("0.#", CultureInfo.InvariantCulture);
        Focus(s.Hwnd);
        if (s.App.Id == "sumatra")
        {
            Chord(VK_CONTROL, (ushort)'Y'); Thread.Sleep(600); // Zoom factor dialog, its box focused
            Chord(VK_CONTROL, (ushort)'A'); Unicode(text); Thread.Sleep(1500);
            return true;
        }
        var b = Box(s); if (b == null) return false;
        System.Windows.Rect r; try { r = b.Current.BoundingRectangle; } catch (ElementNotAvailableException) { return false; }
        if (s.App.Id == "acrobat")
        {
            // Acrobat's zoom box shows the click but ignores synthetic typing; its automation
            // interface takes the value, and Enter then applies it.
            Click((int)(r.X + r.Width / 2), (int)(r.Y + r.Height / 2)); Thread.Sleep(300);
            try { ((ValuePattern)b.GetCurrentPattern(ValuePattern.Pattern)).SetValue(text); } catch { return false; }
            Thread.Sleep(2500);
            return true;
        }
        Click((int)(r.X + r.Width / 2), (int)(r.Y + r.Height / 2)); Thread.Sleep(300);
        Chord(VK_CONTROL, (ushort)'A'); Unicode(text);
        // UI Automation queries run on the viewer's own UI thread; give it time to drain them
        // so the Enter we time isn't queued behind them.
        Thread.Sleep(2500);
        return true;
    }

    public static string File = "";

    /// Types a level into SumatraPDF's zoom dialog and applies it.
    public static bool SetSumatraLevel(Program.Session s, double pct)
    {
        Focus(s.Hwnd);
        Chord(VK_CONTROL, (ushort)'Y'); Thread.Sleep(600);
        Chord(VK_CONTROL, (ushort)'A'); Unicode(pct.ToString("0.#", CultureInfo.InvariantCulture)); Thread.Sleep(300);
        Tap(VK_RETURN); Thread.Sleep(300);
        return true;
    }

    static double? ReadSumatra(Program.Session s)
    {
        // Its zoom box, in its own units. Says "Fit Page" or "Fit Width" at a fit: null then.
        Focus(s.Hwnd);
        Chord(VK_CONTROL, (ushort)'Y'); Thread.Sleep(800);
        double? z = null;
        var dlg = AutomationElement.FromHandle(GetForegroundWindow());
        foreach (AutomationElement e in dlg.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit)))
        {
            var m = Pct.Match(Text(e) ?? "");
            if (!m.Success) m = Regex.Match(Text(e) ?? "", @"^\s*(\d+(?:\.\d+)?)\s*$");
            if (m.Success) { z = double.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture); break; }
        }
        Tap(VK_ESCAPE); Thread.Sleep(300);
        return z;
    }
}
