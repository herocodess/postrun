/**
 * Light, dark or the system's choice, remembered in this browser. The
 * attribute is set before first paint by a small script in the layout, so the
 * chosen theme never flashes the other one.
 */

export type Theme = "system" | "dark" | "light";

export function readTheme(): Theme {
  try {
    const t = window.localStorage.getItem("postrun.theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === "system") delete root.dataset["theme"];
  else root.dataset["theme"] = t;
  try {
    if (t === "system") window.localStorage.removeItem("postrun.theme");
    else window.localStorage.setItem("postrun.theme", t);
  } catch {
    // not remembered
  }
}
