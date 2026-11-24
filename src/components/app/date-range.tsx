"use client";

import { format, subDays } from "date-fns";
import { CalendarDays } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const PRESETS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 14 days", days: 14 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 60 days", days: 60 },
];
const iso = (d: Date) => format(d, "yyyy-MM-dd");

/** URL-synced date range (`from`, `to`); defaults to the API default of the last 30 days. */
export function useDateRange() {
  const [range, setRange] = useQueryStates({ from: parseAsString, to: parseAsString });
  return { from: range.from ?? undefined, to: range.to ?? undefined, setRange };
}

export function DateRangePicker() {
  const { from, to, setRange } = useDateRange();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();
  const label = from && to ? `${format(new Date(from), "d MMM")} – ${format(new Date(to), "d MMM yyyy")}` : "Last 30 days";
  const preset = (days: number) => {
    setRange(days === 30 ? { from: null, to: null } : { from: iso(subDays(new Date(), days - 1)), to: iso(new Date()) });
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" className="h-9 gap-2" />}>
        <CalendarDays className="size-4" />
        {label}
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-auto gap-3 p-3">
        <div className="flex w-36 flex-col gap-1">
          {PRESETS.map((p) => (
            <Button key={p.days} variant="ghost" size="sm" className="justify-start" onClick={() => preset(p.days)}>{p.label}</Button>
          ))}
        </div>
        <div className="border-l pl-3">
          <Calendar
            mode="range"
            numberOfMonths={1}
            selected={draft ?? (from && to ? { from: new Date(from), to: new Date(to) } : undefined)}
            onSelect={setDraft}
            disabled={{ after: new Date() }}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" disabled={!draft?.from || !draft?.to} onClick={() => { setRange({ from: iso(draft!.from!), to: iso(draft!.to!) }); setDraft(undefined); setOpen(false); }}>Apply</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
