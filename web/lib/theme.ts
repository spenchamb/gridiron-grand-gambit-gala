/* Theme state.
 *
 * Deliberately not next-themes: that pulls a provider and a hydration dance
 * into a static export for what is, here, one class on <html>. Dark is the
 * default — GGGG has never had a light mode and flipping existing visitors to
 * light on first load would be a surprise, so prefers-color-scheme is NOT
 * consulted. Light is opt-in and sticky.
 *
 * THEME_SCRIPT runs in <head> before first paint. Without it the toggle still
 * works, but a light-mode visitor gets a dark flash on every navigation. */

export type Theme = "light" | "dark";

export const THEME_KEY = "gggg-theme";

/* Inlined verbatim into the document head. Kept to one statement and wrapped in
   try/catch because localStorage throws outright in some privacy modes, and an
   uncaught error here would run before anything else on the page. */
export const THEME_SCRIPT = `try{if(localStorage.getItem("${THEME_KEY}")==="light")document.documentElement.classList.add("light")}catch(e){}`;

export const getTheme = (): Theme =>
  typeof document !== "undefined" && document.documentElement.classList.contains("light")
    ? "light"
    : "dark";

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle("light", theme === "light");
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
}
