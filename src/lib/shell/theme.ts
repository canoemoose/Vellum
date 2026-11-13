// Theme: resolving "System". The accent is fixed in app.css.

export type ThemePref = "dark" | "light" | "system";
export type ThemeName = "dark" | "light";

export function resolveTheme(pref: ThemePref, systemDark: boolean): ThemeName {
  if (pref === "system") return systemDark ? "dark" : "light";
  return pref;
}
