"use client";

/* Segmented filter control.
 *
 * The position filter existed twice with byte-identical class strings (Draft's
 * big board, Waivers' best-available) and would have appeared a third time on
 * the next page that needs one. firstdown.studio puts the same control in the
 * same place — a single row directly beneath the section label, above the table
 * it filters — so this follows that shape.
 *
 * Two changes from the pair it replaces:
 *
 *   one track, not loose pills   Each option was its own bordered button with a
 *                                gap between, which at seven positions wrapped
 *                                onto a second line on a phone. A shared inset
 *                                track reads as one control and fits one line.
 *   scroll, never wrap           flex-nowrap plus overflow-x-auto: a long option
 *                                set stays a single row and scrolls, rather than
 *                                reflowing the page under the reader's thumb. */

import { cn } from "@/lib/utils";

export function Segmented<T extends string>({
  options, value, onChange, label, className,
}: {
  options: readonly T[] | readonly (readonly [T, string])[];
  value: T;
  onChange: (v: T) => void;
  /** Names the group for screen readers — "Position", "Season", … */
  label: string;
  className?: string;
}) {
  const items = options.map((o) =>
    Array.isArray(o) ? (o as unknown as [T, string]) : ([o as T, o as string] as [T, string]),
  );

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "mb-3 flex w-full gap-0.5 overflow-x-auto rounded-lg bg-secondary p-1",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {items.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "shrink-0 rounded-md px-2.5 py-1 font-mono text-xs font-bold transition-colors",
            /* 32px tall including padding — a comfortable tap target without
               making the control taller than the rows it filters. */
            "min-h-8 sm:min-h-0",
            value === v
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
