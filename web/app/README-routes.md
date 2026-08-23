# Route ownership during the migration

Both stacks are live at once. static-web-server serves whichever file exists,
so a half-ported site works — but that also means **this export must never emit
a file that a still-vanilla page owns**, or the rsync silently overwrites it.

Two rules follow:

1. **No root `app/page.tsx` until `index.html` is ported.** A root route exports
   as `out/index.html`, which is the live league hub. It is the last page to
   port (three modes, ~860 lines), so it is also the last route to add.

2. **Add the Next route and delete the vanilla `.html` in the same commit**, and
   flip `ported: true` in `lib/nav.ts` at the same time. Leaving both in place
   means the export wins and the vanilla page becomes unreachable-but-present,
   which is the confusing failure mode.

`redirect()` is unsupported under `output: "export"` — there is no server to
issue a 3xx. Use a link, or a client-side `router.replace`.
