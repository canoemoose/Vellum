// Resetting settings (Help > About > Reset...). Everything Vellum remembers in the web view's
// storage goes: settings, per-file memory, print layouts, panel positions, the update check's
// state. It isn't cleared on the spot, as the running app would write half of it straight
// back. A mark is left instead, and the next start clears it all before anything is read
// (resetOnStart.ts, the first import in main.ts). The command line's `--reset settings` does
// the same from the back end (src-tauri/src/reset.rs).

const MARK = "vellum.reset";

type Store = Pick<Storage, "getItem" | "setItem" | "clear">;

/** Ask for everything stored to be cleared at the next start. False if storage is unavailable. */
export function markForReset(store: Store = localStorage): boolean {
  try {
    store.setItem(MARK, "1");
    return store.getItem(MARK) === "1";
  } catch {
    return false;
  }
}

/** At start, before anything is read: clear everything if the last run asked for it. */
export function clearIfMarked(store: Store = localStorage): boolean {
  try {
    if (store.getItem(MARK) === null) return false;
    store.clear();
    return true;
  } catch {
    return false;
  }
}
