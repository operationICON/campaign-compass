import { useState, useRef, useEffect } from "react";
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfYear, addMonths, isSameDay, isWithinInterval, isBefore, isAfter, startOfDay } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";

interface DateRangePickerProps {
  value: { from: Date; to: Date } | null;
  onChange: (range: { from: Date; to: Date } | null) => void;
}

const PRESETS = [
  { label: "Last 7 days", fn: () => ({ from: subDays(new Date(), 7), to: new Date() }) },
  { label: "Last 14 days", fn: () => ({ from: subDays(new Date(), 14), to: new Date() }) },
  { label: "Last 30 days", fn: () => ({ from: subDays(new Date(), 30), to: new Date() }) },
  { label: "Last 60 days", fn: () => ({ from: subDays(new Date(), 60), to: new Date() }) },
  { label: "Last 90 days", fn: () => ({ from: subDays(new Date(), 90), to: new Date() }) },
  { label: "This month", fn: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
  { label: "Last month", fn: () => ({ from: startOfMonth(subMonths(new Date(), 1)), to: endOfMonth(subMonths(new Date(), 1)) }) },
  { label: "Year to date", fn: () => ({ from: startOfYear(new Date()), to: new Date() }) },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getMonthDays(year: number, month: number) {
  const first = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();
  let startDay = first.getDay() - 1;
  if (startDay < 0) startDay = 6;
  const days: (Date | null)[] = [];
  for (let i = 0; i < startDay; i++) days.push(null);
  for (let d = 1; d <= lastDay; d++) days.push(new Date(year, month, d));
  return days;
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [leftMonth, setLeftMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selecting, setSelecting] = useState<{ from: Date; to: Date | null } | null>(null);
  const [hover, setHover] = useState<Date | null>(null);
  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const rightMonth = addMonths(leftMonth, 1);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (open && value) {
      setSelecting({ from: value.from, to: value.to });
      setStartInput(format(value.from, "MMM d, yyyy"));
      setEndInput(format(value.to, "MMM d, yyyy"));
    } else if (open) {
      setSelecting(null);
      setStartInput("");
      setEndInput("");
    }
  }, [open]);

  const handleDayClick = (day: Date) => {
    if (!selecting || selecting.to !== null) {
      setSelecting({ from: day, to: null });
      setStartInput(format(day, "MMM d, yyyy"));
      setEndInput("");
    } else {
      const from = isBefore(day, selecting.from) ? day : selecting.from;
      const to = isBefore(day, selecting.from) ? selecting.from : day;
      setSelecting({ from, to });
      setStartInput(format(from, "MMM d, yyyy"));
      setEndInput(format(to, "MMM d, yyyy"));
    }
  };

  const handleApply = () => {
    if (selecting?.from && selecting?.to) {
      onChange({ from: startOfDay(selecting.from), to: startOfDay(selecting.to) });
      setOpen(false);
    }
  };

  const handlePreset = (preset: typeof PRESETS[0]) => {
    const range = preset.fn();
    setSelecting({ from: range.from, to: range.to });
    setStartInput(format(range.from, "MMM d, yyyy"));
    setEndInput(format(range.to, "MMM d, yyyy"));
  };

  const isInRange = (day: Date) => {
    if (!selecting) return false;
    const end = selecting.to ?? hover;
    if (!end) return false;
    const from = isBefore(end, selecting.from) ? end : selecting.from;
    const to = isAfter(end, selecting.from) ? end : selecting.from;
    return isWithinInterval(day, { start: from, end: to });
  };

  const isStart = (day: Date) => selecting?.from && isSameDay(day, selecting.from);
  const isEnd = (day: Date) => {
    const end = selecting?.to ?? hover;
    return end && isSameDay(day, end);
  };
  const isToday = (day: Date) => isSameDay(day, new Date());

  const renderMonth = (monthDate: Date) => {
    const days = getMonthDays(monthDate.getFullYear(), monthDate.getMonth());
    return (
      <div className="w-[260px]">
        <div className="text-center text-[13px] font-bold text-foreground mb-2">
          {format(monthDate, "MMMM yyyy")}
        </div>
        <div className="grid grid-cols-7 gap-0">
          {DAYS.map(d => (
            <div key={d} className="text-center text-[11px] text-muted-foreground py-1">{d}</div>
          ))}
          {days.map((day, i) => {
            if (!day) return <div key={`e${i}`} />;
            const inRange = isInRange(day);
            const start = isStart(day);
            const end = isEnd(day);
            const today = isToday(day);
            return (
              <button
                key={day.toISOString()}
                onClick={() => handleDayClick(day)}
                onMouseEnter={() => setHover(day)}
                className={`h-8 text-[12px] relative transition-colors rounded-none
                  ${inRange ? "bg-[#e0f2fe]" : "hover:bg-secondary"}
                  ${start || end ? "!bg-primary text-primary-foreground font-bold rounded-full z-10" : ""}
                  ${!start && !end && inRange ? "text-foreground" : "text-foreground"}
                `}
              >
                {day.getDate()}
                {today && !start && !end && (
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3 h-[2px] bg-primary rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="relative" ref={ref}>
      {value ? (
        <button
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium border border-primary/20 hover:bg-primary/15 transition-colors"
        >
          <CalendarDays className="h-3.5 w-3.5" />
          {format(value.from, "MMM d")} – {format(value.to, "MMM d")}
          <button
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
            className="ml-0.5 hover:text-primary/70"
          >
            <X className="h-3 w-3" />
          </button>
        </button>
      ) : (
        <button
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border text-muted-foreground text-xs font-medium hover:text-foreground transition-colors"
        >
          <CalendarDays className="h-3.5 w-3.5" />
          Custom Range
        </button>
      )}

      {open && (
        <div
          className="absolute top-full right-0 mt-2 z-50 bg-card rounded-2xl p-5"
          style={{
            border: "0.5px solid hsl(var(--border))",
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
          }}
        >
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => setLeftMonth(subMonths(leftMonth, 1))} className="p-1 rounded hover:bg-secondary transition-colors">
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </button>
            <div className="flex-1" />
            <button onClick={() => setLeftMonth(addMonths(leftMonth, 1))} className="p-1 rounded hover:bg-secondary transition-colors">
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          {/* Two calendars */}
          <div className="flex gap-6 mb-4">
            {renderMonth(leftMonth)}
            {renderMonth(rightMonth)}
          </div>

          {/* Bottom: date inputs + presets */}
          <div className="flex gap-6 border-t border-border pt-4">
            {/* Date inputs */}
            <div className="flex-1 space-y-2">
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Start</label>
                <input
                  value={startInput}
                  onChange={(e) => setStartInput(e.target.value)}
                  onBlur={() => {
                    const d = new Date(startInput);
                    if (!isNaN(d.getTime())) {
                      setSelecting(prev => prev ? { ...prev, from: d } : { from: d, to: null });
                    }
                  }}
                  className="w-full mt-0.5 px-2.5 py-1.5 text-[12px] border border-border rounded-lg bg-background text-foreground outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Mar 1, 2026"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">End</label>
                <input
                  value={endInput}
                  onChange={(e) => setEndInput(e.target.value)}
                  onBlur={() => {
                    const d = new Date(endInput);
                    if (!isNaN(d.getTime())) {
                      setSelecting(prev => prev ? { ...prev, to: d } : null);
                    }
                  }}
                  className="w-full mt-0.5 px-2.5 py-1.5 text-[12px] border border-border rounded-lg bg-background text-foreground outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Mar 25, 2026"
                />
              </div>
            </div>

            {/* Quick presets */}
            <div className="space-y-1">
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => handlePreset(p)}
                  className="block text-[11px] text-primary hover:underline transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-border">
            <button
              onClick={() => setOpen(false)}
              className="px-4 py-1.5 text-[12px] font-medium border border-border rounded-lg text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={!selecting?.from || !selecting?.to}
              className="px-4 py-1.5 text-[12px] font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-40 transition-colors"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
