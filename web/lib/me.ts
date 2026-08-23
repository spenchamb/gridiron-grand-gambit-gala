"use client";

/* "My team" — the viewer's own identity, remembered across visits.
 *
 * The idea already existed in one place: matchups seeded its team select from
 * meta.my_owner_id, a single owner baked in by the builder. That is the right
 * behaviour for exactly one person. This generalises it — every visitor picks
 * their own team once in the sidebar, and the pages lead with it.
 *
 * Why an external store rather than a hook with its own state: the picker lives
 * in the sidebar and the things it changes live in the page, which are separate
 * React trees. Per-component state would mean selecting a team did nothing
 * until a reload. useSyncExternalStore gives every consumer the same snapshot
 * and re-renders all of them on a change, with no provider to thread through
 * the layout and no prop drilling into sixteen routes.
 *
 * Resolution order for the active team:
 *   1. what this visitor picked        (localStorage)
 *   2. meta.my_owner_id                (the builder's own team — today's default)
 *   3. nothing                         (a plain league-wide view)
 *
 * Falling back to my_owner_id is deliberate: it keeps the site behaving exactly
 * as it does now for anyone who never opens the picker. */

import { useSyncExternalStore } from "react";
import { fetchJSON, type Meta, type Team } from "@/lib/data";

export const ME_KEY = "gggg.me.v1";

/** Stored when the viewer explicitly wants no team highlighted. */
export const NO_TEAM = "__none__";

export type MeState = {
  /** Active owner_id, or null for the neutral league view. */
  ownerId: string | null;
  /** The matching team record, once teams.json has landed. */
  team: Team | null;
  teams: Team[];
  /** True once the picker has real data to offer. */
  ready: boolean;
};

const EMPTY: MeState = { ownerId: null, team: null, teams: [], ready: false };

let state: MeState = EMPTY;
let stored: string | null = null;
let fallback: string | null = null;
let started = false;

const subscribers = new Set<() => void>();

/* One object identity per distinct state — useSyncExternalStore compares
   snapshots by reference and will loop forever if handed a fresh object each
   read. */
function commit(next: Partial<MeState>) {
  const merged = { ...state, ...next };
  const ownerId = merged.ownerId;
  merged.team = ownerId ? merged.teams.find((t) => t.owner_id === ownerId) ?? null : null;
  state = merged;
  subscribers.forEach((fn) => fn());
}

function resolve(): string | null {
  if (stored === NO_TEAM) return null;
  if (stored) return stored;
  return fallback;
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;

  try {
    stored = localStorage.getItem(ME_KEY);
  } catch {}

  /* Seed from the sidebar's session cache so the picker is populated on the
     first paint of a second page view, then revalidate. */
  try {
    const ct = sessionStorage.getItem("gggg-teams");
    const cm = sessionStorage.getItem("gggg-meta");
    if (cm) fallback = (JSON.parse(cm) as Meta).my_owner_id ?? null;
    if (ct) commit({ teams: JSON.parse(ct), ownerId: resolve(), ready: true });
  } catch {}

  Promise.all([
    fetchJSON<Team[]>("teams.json").catch(() => null),
    fetchJSON<Meta>("meta.json").catch(() => null),
  ]).then(([teams, meta]) => {
    if (meta?.my_owner_id) fallback = meta.my_owner_id;
    commit({ teams: teams ?? state.teams, ownerId: resolve(), ready: true });
  });
}

function subscribe(fn: () => void) {
  start();
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

const getSnapshot = () => state;
/* Prerender has no viewer, so it renders the neutral view. */
const getServerSnapshot = () => EMPTY;

export function useMe(): MeState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/* The stored pick, straight out of localStorage.
 *
 * useMe() cannot answer this on a cold first render: the store has to fetch
 * teams.json before it has a snapshot, and a page whose own effect resolves
 * faster would read null and fall through to the builder's team — the returning
 * visitor's pick silently ignored. Identity does not depend on the team list,
 * so pages that need an owner id up front read it synchronously here and use
 * useMe() only for rendering. */
export function storedOwnerId(): string | null {
  try {
    const v = localStorage.getItem(ME_KEY);
    return !v || v === NO_TEAM ? null : v;
  } catch {
    return null;
  }
}

/** Pass null to clear the selection back to the neutral league view. */
export function setMyTeam(ownerId: string | null) {
  stored = ownerId ?? NO_TEAM;
  try {
    localStorage.setItem(ME_KEY, stored);
  } catch {}
  commit({ ownerId: resolve() });
}

/** True when `id` is the viewer's team — the test every "featured" row makes. */
export const isMine = (me: MeState, id: string | null | undefined) =>
  Boolean(me.ownerId && id && me.ownerId === id);
