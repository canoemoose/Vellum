using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace ViewerBench;

/// Win32: windows, input and screen grabs.
static class Native
{
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; public int W => Right - Left; public int H => Bottom - Top; public override string ToString() => $"{Left},{Top} {W}x{H}"; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }

    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] i, int size);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);

    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] static extern int DwmGetInt(IntPtr h, int attr, out int v, int size);
    /// Hidden by DWM (another virtual desktop, a suspended Store app) even though "visible".
    public static bool Cloaked(IntPtr h) => DwmGetInt(h, 14, out int v, 4) == 0 && v != 0;

    public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
    public static string Class(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }

    /// The visible frame (without the invisible resize borders Windows 10+ adds).
    public static RECT Frame(IntPtr h) { return DwmGetWindowAttribute(h, 9, out var r, Marshal.SizeOf<RECT>()) == 0 ? r : (GetWindowRect(h, out r) ? r : r); }

    public static RECT ClientOnScreen(IntPtr h)
    {
        GetClientRect(h, out var c); var p = new POINT();
        ClientToScreen(h, ref p);
        return new RECT { Left = p.X, Top = p.Y, Right = p.X + c.W, Bottom = p.Y + c.H };
    }

    public static List<IntPtr> TopWindows()
    {
        var list = new List<IntPtr>();
        EnumWindows((h, _) => { list.Add(h); return true; }, IntPtr.Zero);
        return list;
    }

    /// Every process descended from root (inclusive), from a snapshot of parent ids.
    public static HashSet<int> ProcessTree(int root)
    {
        var parents = new Dictionary<int, int>();
        foreach (var (pid, ppid) in Snapshot()) parents[pid] = ppid;
        var set = new HashSet<int> { root };
        bool grew = true;
        while (grew) { grew = false; foreach (var kv in parents) if (!set.Contains(kv.Key) && set.Contains(kv.Value)) { set.Add(kv.Key); grew = true; } }
        return set;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct PROCESSENTRY32 { public uint dwSize, cntUsage, th32ProcessID; public IntPtr th32DefaultHeapID; public uint th32ModuleID, cntThreads, th32ParentProcessID; public int pcPriClassBase; public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile; }
    [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint f, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr s, ref PROCESSENTRY32 e);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr s, ref PROCESSENTRY32 e);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    static IEnumerable<(int, int)> Snapshot()
    {
        var s = CreateToolhelp32Snapshot(2, 0); var e = new PROCESSENTRY32 { dwSize = (uint)Marshal.SizeOf<PROCESSENTRY32>() };
        var res = new List<(int, int)>();
        if (Process32FirstW(s, ref e)) do res.Add(((int)e.th32ProcessID, (int)e.th32ParentProcessID)); while (Process32NextW(s, ref e));
        CloseHandle(s); return res;
    }

    // ---- Input ----
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public int mouseData; public uint dwFlags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }

    public const ushort VK_CONTROL = 0x11, VK_RETURN = 0x0D, VK_ESCAPE = 0x1B, VK_MENU = 0x12, VK_BACK = 0x08;

    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);

    /// A key press with its hardware scan code filled in: some viewers (Acrobat among them)
    /// ignore synthetic keys that carry only the virtual-key code.
    public static void Key(ushort vk, bool up)
    {
        var i = new INPUT { type = 1 }; i.u.ki = new KEYBDINPUT { wVk = vk, wScan = (ushort)MapVirtualKey(vk, 0), dwFlags = up ? 2u : 0u };
        SendInput(1, new[] { i }, Marshal.SizeOf<INPUT>());
    }
    public static void Tap(ushort vk) { Key(vk, false); Key(vk, true); }
    public static void Chord(ushort mod, ushort vk) { Key(mod, false); Tap(vk); Key(mod, true); }
    /// Types text. Digits and the decimal point go as real key presses (some zoom boxes, Acrobat's
    /// among them, ignore the Unicode packets SendInput otherwise uses); anything else as Unicode.
    public static void Unicode(string text)
    {
        foreach (var ch in text)
        {
            if (char.IsDigit(ch)) { Tap((ushort)ch); continue; }
            if (ch == '.') { Tap(0xBE); continue; }
            var d = new INPUT { type = 1 }; d.u.ki = new KEYBDINPUT { wScan = ch, dwFlags = 4 };
            var u = new INPUT { type = 1 }; u.u.ki = new KEYBDINPUT { wScan = ch, dwFlags = 4 | 2 };
            SendInput(2, new[] { d, u }, Marshal.SizeOf<INPUT>());
        }
    }
    public static void Click(int x, int y)
    {
        SetCursorPos(x, y);
        var d = new INPUT { type = 0 }; d.u.mi = new MOUSEINPUT { dwFlags = 2 };
        var u = new INPUT { type = 0 }; u.u.mi = new MOUSEINPUT { dwFlags = 4 };
        SendInput(2, new[] { d, u }, Marshal.SizeOf<INPUT>());
    }
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);

    /// A real (injected) mouse move to (x, y), as SendInput moves, not SetCursorPos: some
    /// viewers only take the wheel after a mouse move has arrived over their document.
    public static void MoveTo(int x, int y)
    {
        // Absolute coordinates are 0..65535 across the primary monitor.
        int sw = GetSystemMetrics(0), sh = GetSystemMetrics(1);
        var m = new INPUT { type = 0 }; m.u.mi = new MOUSEINPUT { dx = (x * 65536 + sw / 2) / sw, dy = (y * 65536 + sh / 2) / sh, dwFlags = 0x0001 | 0x8000 };
        SendInput(1, new[] { m }, Marshal.SizeOf<INPUT>());
    }

    /// A Ctrl+wheel notch posted straight to the window under (x, y), with Ctrl flagged in the
    /// message itself (MK_CONTROL), bypassing the input queue.
    public static void PostCtrlWheel(int x, int y, int notches)
    {
        var h = WindowFromPoint(new POINT { X = x, Y = y });
        // WM_MOUSEWHEEL: wParam high word = delta, low word = key flags; lParam = screen x, y.
        var w = (IntPtr)(((120 * notches) << 16) | 0x0008);
        var l = (IntPtr)(((y & 0xFFFF) << 16) | (x & 0xFFFF));
        PostMessage(h, 0x020A, w, l);
    }

    public static void Wheel(int x, int y, int notches)
    {
        SetCursorPos(x, y);
        var w = new INPUT { type = 0 }; w.u.mi = new MOUSEINPUT { dwFlags = 0x0800, mouseData = 120 * notches };
        SendInput(1, new[] { w }, Marshal.SizeOf<INPUT>());
    }

    /// Brings the window forward with a click inside its document area (the left of the middle
    /// band, a harmless spot in every viewer here). Not an Alt tap: Vellum and Acrobat take a
    /// lone Alt as "go to the menu" and then swallow the shortcuts that follow.
    public static void Focus(IntPtr h)
    {
        var c = ClientOnScreen(h);
        Click(c.Left + c.W * 35 / 100, c.Top + c.H * 55 / 100);
        Thread.Sleep(250);
    }

    // ---- Screen grabs ----
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr o);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr d, int x, int y, int w, int h, IntPtr s, int sx, int sy, uint rop);
    [StructLayout(LayoutKind.Sequential)] struct BITMAPINFOHEADER { public int biSize, biWidth, biHeight; public short biPlanes, biBitCount; public int biCompression, biSizeImage, biXPels, biYPels, biClrUsed, biClrImportant; }
    [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc, ref BITMAPINFOHEADER bi, uint usage, out IntPtr bits, IntPtr sec, uint off);

    /// A reusable top-down 32-bit grabber for one screen rectangle.
    public sealed class Grabber : IDisposable
    {
        readonly IntPtr screen, mem, bmp, old, bits; public readonly int X, Y, W, H;
        public Grabber(RECT r)
        {
            X = r.Left; Y = r.Top; W = r.W; H = r.H;
            screen = GetDC(IntPtr.Zero); mem = CreateCompatibleDC(screen);
            var bi = new BITMAPINFOHEADER { biSize = 40, biWidth = W, biHeight = -H, biPlanes = 1, biBitCount = 32 };
            bmp = CreateDIBSection(screen, ref bi, 0, out bits, IntPtr.Zero, 0);
            old = SelectObject(mem, bmp);
        }
        /// Copies the screen into the buffer and returns a pointer to BGRA rows (stride W*4).
        public IntPtr Grab() { BitBlt(mem, 0, 0, W, H, screen, X, Y, 0x00CC0020); return bits; }
        public void Dispose() { SelectObject(mem, old); DeleteObject(bmp); DeleteDC(mem); ReleaseDC(IntPtr.Zero, screen); }
    }
}
