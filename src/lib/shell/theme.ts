// Theme and accent: resolving "System", deriving the accent's soft and border shades.

export type ThemePref = "dark" | "light" | "system";
export type ThemeName = "dark" | "light";

/** The four accents from the brief, default first. */
export const ACCENTS: { name: string; hex: string }[] = [
  { name: "Red", hex: "#e5484d" },
  { name: "Blue", hex: "#3b82f6" },
  { name: "Teal", hex: "#14b8a6" },
  { name: "Amber", hex: "#f59e0b" },
];

export function resolveTheme(pref: ThemePref, systemDark: boolean): ThemeName {
  if (pref === "system") return systemDark ? "dark" : "light";
  return pref;
}

/** The accent mixed towards black by `amount` (0..1), as #rrggbb. */
export function darken(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - amount));
  return "#" + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("");
}

/**
 * CSS custom properties for an accent: the colour, "accent soft" (18% alpha, the brief's
 * `2e` suffix) and the visible border filled accent buttons get (house rule: never
 * transparent).
 */
export function accentVars(hex: string): Record<string, string> {
  return {
    "--accent": hex,
    "--accent-soft": `${hex}2e`,
    "--accent-bd": darken(hex, 0.25),
  };
}
