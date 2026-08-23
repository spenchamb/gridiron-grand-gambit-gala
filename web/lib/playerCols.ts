import type { StatLine } from "@/lib/data";

/* Position-relevant box-score columns, transcribed from player.html's COLS map.
   Each entry is [header, getter]; a getter returning null/0/"0/0" renders as a
   dot, matching the vanilla `cell()` helper. */
export type Col = [string, (s: StatLine) => number | string | null | undefined];

export const COLS: Record<string, Col[]> = {
  QB: [
    ["C/A", (s) => (s.pass_att ? `${s.pass_cmp ?? 0}/${s.pass_att}` : null)],
    ["PaYd", (s) => s.pass_yd],
    ["PaTD", (s) => s.pass_td],
    ["INT", (s) => s.pass_int],
    ["RuYd", (s) => s.rush_yd],
    ["RuTD", (s) => s.rush_td],
  ],
  RB: [
    ["Car", (s) => s.rush_att],
    ["RuYd", (s) => s.rush_yd],
    ["RuTD", (s) => s.rush_td],
    ["Rec", (s) => s.rec],
    ["ReYd", (s) => s.rec_yd],
    ["ReTD", (s) => s.rec_td],
  ],
  WR: [
    ["Tgt", (s) => s.rec_tgt],
    ["Rec", (s) => s.rec],
    ["ReYd", (s) => s.rec_yd],
    ["ReTD", (s) => s.rec_td],
    ["RuYd", (s) => s.rush_yd],
  ],
  TE: [
    ["Tgt", (s) => s.rec_tgt],
    ["Rec", (s) => s.rec],
    ["ReYd", (s) => s.rec_yd],
    ["ReTD", (s) => s.rec_td],
    ["RuYd", (s) => s.rush_yd],
  ],
  K: [
    ["FGM", (s) => s.fgm],
    ["FGA", (s) => s.fga],
    ["XP", (s) => s.xpm],
  ],
  DEF: [
    ["Sack", (s) => (s.def_sack != null ? s.def_sack : s.sack)],
    ["INT", (s) => s.def_int],
    ["DefTD", (s) => s.def_td],
    ["FF", (s) => s.def_ff],
    ["PA", (s) => s.pts_allow],
  ],
};

/** Vanilla `cell()`: blank-looking values collapse to a dot. */
export const cellValue = (v: number | string | null | undefined) =>
  v == null || v === 0 || v === "0/0" ? null : v;
