using System.Diagnostics;

namespace ViewerBench;

/// One viewer: how to start it on a file. Zoom recipes live in Zoom.cs.
sealed record App(string Id, string Label, Func<string, string, ProcessStartInfo> Start, bool SingleInstance = false);

static class Apps
{
    static readonly string Local = Environment.GetEnvironmentVariable("LOCALAPPDATA")!;

    public static string Profile(string root, string id) { var d = Path.Combine(root, "profiles", id); Directory.CreateDirectory(d); return d; }

    static ProcessStartInfo Psi(string exe, params string[] args)
    {
        var p = new ProcessStartInfo(exe) { UseShellExecute = false };
        foreach (var a in args) p.ArgumentList.Add(a);
        return p;
    }

    static ProcessStartInfo Browser(string exe, string file, string profile) => Psi(exe,
        "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "--disable-sync",
        "--hide-crash-restore-bubble", "--disable-session-crashed-bubble",
        "--new-window", "--window-position=100,100", "--window-size=1600,1000",
        "--disable-features=msEdgeWelcomePage,msImplicitSignin,EdgeCollections,msShowSidebar",
        new Uri(file).AbsoluteUri);

    public static readonly App[] All =
    {
        new("vellum", "Vellum 0.2.0", (file, root) =>
        {
            // The installed copy, isolated: its own profile, settings and preview cache, never Matt's.
            var p = Psi(Environment.GetEnvironmentVariable("VELLUM_EXE") ?? Path.Combine(Local, "Vellum", "vellum.exe"), file);
            var prof = Profile(root, "vellum");
            p.Environment["VELLUM_MULTI_INSTANCE"] = "1";
            p.Environment["VELLUM_DATA_DIR"] = Path.Combine(prof, "data");
            p.Environment["WEBVIEW2_USER_DATA_FOLDER"] = Path.Combine(prof, "webview2");
            if (Environment.GetEnvironmentVariable("VB_NO_LOCAL") == null) p.Environment["LOCALAPPDATA"] = Path.Combine(prof, "local"); // moves the preview cache too
            return p;
        }),
        new("acrobat", "Adobe Acrobat", (file, root) => Psi(@"C:\Program Files\Adobe\Acrobat DC\Acrobat\Acrobat.exe", file), true),
        new("foxit", "Foxit PDF Reader", (file, root) => Psi(@"C:\Program Files\Foxit Software\Foxit PDF Reader\FoxitPDFReader.exe", file), true),
        new("pdfxchange", "PDF-XChange Editor", (file, root) => Psi(@"C:\Program Files\PDF-XChange\PDF Editor\PXCEditor.exe", file), true),
        new("sumatra", "SumatraPDF", (file, root) =>
            // -appdata: its own settings, so it doesn't restore Matt's open tabs.
            Psi(Path.Combine(Local, "SumatraPDF", "SumatraPDF.exe"), "-appdata", Profile(root, "sumatra"), file), true),
        new("edge", "Microsoft Edge", (file, root) => Browser(@"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", file, Profile(root, "edge"))),
        new("chrome", "Google Chrome", (file, root) => Browser(@"C:\Program Files\Google\Chrome\Application\chrome.exe", file, Profile(root, "chrome"))),
    };

    public static App Get(string id) => All.FirstOrDefault(a => a.Id == id) ?? throw new ArgumentException("unknown app " + id);
}
