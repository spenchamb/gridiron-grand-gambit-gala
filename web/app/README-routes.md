# Route ownership

The migration is complete — every page is a Next route and there is no vanilla
stack to coexist with. What is left here is the set of rules that were learned
the hard way and still apply.

## Rules

- **Query params need `Suspense`.** `useSearchParams()` under
  `output: "export"` must sit inside a `<Suspense>` boundary or the build fails
  outright for every route. Applies to `player`, `ledger`, `projections`,
  `matchups`, `team`, `draft`, and to `AppSidebar` (wrapped in the root layout,
  since it reads the active team/season).

- **`redirect()` is unsupported** under `output: "export"` — there is no server
  to issue a 3xx. Use a link, or a client-side `router.replace`.

- **Pages must not render `<main>`.** `SidebarInset` provides the one real
  `<main>`; nesting another is invalid HTML and an ambiguous screen-reader
  landmark. Page components use `<div>`.

- **Normalise the pathname before matching nav.** static-web-server resolves
  `/sleeper/draft`, `/sleeper/draft/` and `/sleeper/draft.html` to the same
  export, and every pre-migration bookmark is the `.html` form. `usePathname`
  reports the URL as-is, so compare through `routePath()` from `lib/nav.ts` or
  the sidebar highlights nothing.

- **`lib/nav.ts` still carries `ported: false` and `legacyHref()`.** Nothing
  uses them today. They stay as the mechanism for linking out to a page that
  lives outside this app, which is how the NBA section and War Room would be
  reached if they ever needed a link from here.

## The two builds

`build:site` (basePath `/sleeper`) and `build:ffb` (no basePath) both write to
`web/out`, so `deploy.sh` copies each aside as `out-site` / `out-ffb`. The base
path is compiled into every asset URL — feeding the wrong export to
`ffb/build-ffb.sh` would 404 every script and stylesheet, which is why that
script validates its source before writing anything.
