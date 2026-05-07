import { useState, useRef, useEffect } from "react";
import {
  format, subDays, startOfMonth, endOfMonth, subMonths, subYears,
  startOfYear, endOfYear, addMonths, isSameDay, isWithinInterval,
  isBefore, isAfter, startOfDay,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

interface DateRangePickerProps {
  value: { from: Date; to: Date } | null;
  onChange: (range: { from: Date; to: Date } | null) => void;
}

const PRESETS = [
  { label: "Today",          fn: () => { const t = new Date(); return { from: t, to: t }; } },
  { label: "Yesterday",      fn: () => { const y = subDays(new Date(), 1); return { from: y, to: y }; } },
  { label: "Last 7 Days",    fn: () => ({ from: subDays(new Date(), 7),  to: new Date() }) },
  { label: "Last 30 Days",   fn: () => ({ from: subDays(new Date(), 30), to: new Date() }) },
  { label: "This Month",     fn: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
  { label: "Previous Month", fn: () => ({ from: startOfMonth(subMonths(new Date(), 1)), to: endOfMonth(subMonths(new Date(), 1)) }) },
  { label: "This Year",      fn: () => ({ from: startOfYear(new Date()), to: new Date() }) },
  { label: "Previous Year",  fn: () => ({ from: startOfYear(subYears(new Date(), 1)), to: endOfYear(subYears(new Date(), 1)) }) },
];

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function getMonthDays(year: number, month: number) {
  const first = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();
  const startDay = first.getDay();
  const days: (Date | null)[] = [];
  for (let i = 0; i < startDay; i++) days.push(null);
  for (let d = 1; d <= lastDay; d++) days.push(new Date(year, month, d));
  return days;
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [open, setOpen]       = useState(false);
  const [leftMonth, setLeftMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() - 1, 1);
  });
  const [selecting, setSelecting] = useState<{ from: Date; to: Date | null } | null>(null);
  const [hover, setHover]     = useState<Date | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const rightMonth = addMonths(leftMonth, 1);

  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [open]);

  useEffect(() => {
    if (open) {
      if (value) {
        setSelecting({ from: value.from, to: value.to });
      } else {
        setSelecting(null);
      }
      setActivePreset(null);
    }
  }, [open]);

  const handleDayClick = (day: Date) => {
    setActivePreset(null);
    if (!selecting || selecting.to !== null) {
      setSelecting({ from: day, to: null });
    } else {
      const from = isBefore(day, selecting.from) ? day : selecting.from;
      const to   = isBefore(day, selecting.from) ? selecting.from : day;
      setSelecting({ from, to });
    }
  };

  const handlePreset = (p: typeof PRESETS[0]) => {
    const range = p.fn();
    setSelecting({ from: range.from, to: range.to });
    setActivePreset(p.label);
  };

  const handleApply = () => {
    if (selecting?.from && selecting?.to) {
      onChange({ from: startOfDay(selecting.from), to: startOfDay(selecting.to) });
      setOpen(false);
    }
  };

  const isInRange = (day: Date) => {
    if (!selecting) return false;
    const end = selecting.to ?? hover;
    if (!end) return false;
    const from = isBefore(end, selecting.from) ? end : selecting.from;
    const to   = isAfter(end, selecting.from)  ? end : selecting.from;
    return isWithinInterval(day, { start: from, end: to });
  };
  const isStart = (day: Date) => !!(selecting?.from && isSameDay(day, selecting.from));
  const isEnd   = (day: Date) => { const e = selecting?.to ?? hover; return !!(e && isSameDay(day, e)); };
  const isToday = (day: Date) => isSameDay(day, new Date());

  const renderMonth = (monthDate: Date) => {
    const days = getMonthDays(monthDate.getFullYear(), monthDate.getMonth());
    return (
      <div className="w-[220px]">
        <div className="text-center text-[13px] font-semibold text-foreground mb-3">
          {format(monthDate, "MMMM yyyy")}
        </div>
        <div className="grid grid-cols-7">
          {DAYS.map(d => (
            <div key={d} className="text-center text-[11px] text-muted-foreground py-1 font-medium">{d}</div>
          ))}
          {days.map((day, i) => {
            if (!day) return <div key={`e${i}`} />;
            const inRange = isInRange(day);
            const start   = isStart(day);
            const end     = isEnd(day);
            const today   = isToday(day);
            return (
              <button
                key={day.toISOString()}
                onClick={() => handleDayClick(day)}
                onMouseEnter={() => { if (selecting && !selecting.to) setHover(day); }}
                onMouseLeave={() => setHover(null)}
                className={[
                  "h-8 w-full text-[12px] relative transition-colors",
                  inRange && !start && !end ? "bg-primary/15 text-foreground rounded-none" : "",
                  start || end ? "bg-primary text-primary-foreground font-bold rounded-full z-10" : "hover:bg-secondary rounded-full",
                  today && !start && !end ? "font-semibold" : "",
                ].filter(Boolean).join(" ")}
              >
                {day.getDate()}
                {today && !start && !end && (
                  <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-primary rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const label = value
    ? `${format(value.from, "MMM d, yyyy")} - ${format(value.to, "MMM d, yyyy")}`
    : "Custom Range";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={[
          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
          value
            ? "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15"
            : "bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-accent/30",
        ].join(" ")}
      >
        <CalendarDays className="h-3.5 w-3.5" />
        {label}
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-2 z-50 bg-card rounded-2xl overflow-hidden"
          style={{ border: "1px solid hsl(var(--border))", boxShadow: "0 8px 32px rgba(0,0,0,0.24)" }}
        >
          <div className="flex">
            {/* Calendars */}
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => setLeftMonth(subMonths(leftMonth, 1))}
                  className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
                  <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                </button>
                <div className="flex-1" />
                <button onClick={() => setLeftMonth(addMonths(leftMonth, 1))}
                  className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
              <div className="flex gap-6">
                {renderMonth(leftMonth)}
                {renderMonth(rightMonth)}
              </div>
            </div>

            {/* Presets */}
            <div className="border-l border-border flex flex-col justify-between py-4 px-3 min-w-[148px]">
              <div className="space-y-0.5">
                {PRESETS.map(p => (
                  <button
                    key={p.label}
                    onClick={() => handlePreset(p)}
                    className={[
                      "w-full text-left px-3 py-2 rounded-lg text-[13px] transition-colors",
                      activePreset === p.label
                        ? "bg-primary text-primary-foreground font-medium"
                        : "text-foreground hover:bg-secondary",
                    ].join(" ")}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <button
                onClick={handleApply}
                disabled={!selecting?.from || !selecting?.to}
                className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2 text-[13px] font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-40 transition-colors"
              >
                Apply ✓
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
