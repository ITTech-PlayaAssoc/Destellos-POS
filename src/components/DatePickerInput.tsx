import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';

interface DatePickerInputProps {
  value: string; // YYYY-MM-DD or ''
  onChange: (value: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  id?: string;
  ariaLabel?: string;
  minYear?: number;
  maxYear?: number;
  size?: 'sm' | 'md';
  align?: 'left' | 'right';
  className?: string;
}

const MONTH_NAMES_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const WEEKDAY_HEADERS_ES = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function getLocalIsoDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function getMonthStartIsoDate(date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-01`;
}

function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function formatDisplayDate(value: string): string {
  const parsed = parseIsoDate(value);
  if (!parsed) return value;
  return `${pad2(parsed.day)}/${pad2(parsed.month + 1)}/${parsed.year}`;
}

interface CalendarCell {
  iso: string;
  day: number;
  inCurrentMonth: boolean;
}

function buildCalendarGrid(year: number, month: number): CalendarCell[] {
  const firstOfMonth = new Date(year, month, 1);
  // Monday = 0 ... Sunday = 6
  const startWeekday = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const cells: CalendarCell[] = [];

  for (let i = startWeekday - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const prevDate = new Date(year, month - 1, d);
    cells.push({
      iso: `${prevDate.getFullYear()}-${pad2(prevDate.getMonth() + 1)}-${pad2(prevDate.getDate())}`,
      day: d,
      inCurrentMonth: false,
    });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      iso: `${year}-${pad2(month + 1)}-${pad2(d)}`,
      day: d,
      inCurrentMonth: true,
    });
  }

  const remaining = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    const nextDate = new Date(year, month + 1, d);
    cells.push({
      iso: `${nextDate.getFullYear()}-${pad2(nextDate.getMonth() + 1)}-${pad2(nextDate.getDate())}`,
      day: d,
      inCurrentMonth: false,
    });
  }

  return cells;
}

export function DatePickerInput({
  value,
  onChange,
  placeholder = 'Seleccionar fecha',
  allowClear = true,
  id,
  ariaLabel,
  minYear = 2020,
  maxYear = new Date().getFullYear() + 5,
  size = 'md',
  align = 'left',
  className = '',
}: DatePickerInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const todayIso = getLocalIsoDate(0);
  const parsedValue = parseIsoDate(value);

  const [viewYear, setViewYear] = useState<number>(() => {
    const now = new Date();
    return parsedValue?.year ?? now.getFullYear();
  });
  const [viewMonth, setViewMonth] = useState<number>(() => {
    const now = new Date();
    return parsedValue?.month ?? now.getMonth();
  });

  // Sync displayed calendar month when opening or when external value changes
  useEffect(() => {
    if (parsedValue) {
      setViewYear(parsedValue.year);
      setViewMonth(parsedValue.month);
    }
  }, [value]);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const years = useMemo(() => {
    const effectiveMin = Math.min(minYear, viewYear);
    const effectiveMax = Math.max(maxYear, viewYear);
    const list: number[] = [];
    for (let y = effectiveMin; y <= effectiveMax; y++) {
      list.push(y);
    }
    return list;
  }, [minYear, maxYear, viewYear]);

  const cells = useMemo(() => buildCalendarGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  const goPrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const goNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleToggleOpen = () => {
    if (!open) {
      const target = parsedValue || parseIsoDate(todayIso)!;
      setViewYear(target.year);
      setViewMonth(target.month);
    }
    setOpen((prev) => !prev);
  };

  const handleSelectDate = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setOpen(false);
  };

  const triggerClasses =
    size === 'sm'
      ? 'px-3 py-2 text-xs'
      : 'px-3 py-2 text-sm';

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <button
          id={id}
          type="button"
          onClick={handleToggleOpen}
          aria-label={ariaLabel || placeholder}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={`w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 ${triggerClasses} pl-9 ${
            allowClear && value ? 'pr-8' : 'pr-3'
          } text-left flex items-center justify-between gap-2 focus:outline-none focus:ring-2 focus:ring-amber-600/40 transition-colors cursor-pointer hover:border-stone-400 dark:hover:border-zinc-600`}
        >
          <Calendar className="w-3.5 h-3.5 text-stone-400 dark:text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <span
            className={`truncate ${
              value
                ? 'font-mono-tabular text-stone-900 dark:text-zinc-100'
                : 'text-stone-400 dark:text-zinc-500'
            }`}
          >
            {value ? formatDisplayDate(value) : placeholder}
          </span>
        </button>

        {allowClear && value && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Limpiar fecha"
            title="Limpiar fecha"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-stone-400 hover:text-stone-700 dark:text-zinc-500 dark:hover:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div
          role="dialog"
          aria-label="Selector de fecha"
          className={`absolute z-50 mt-1.5 w-72 rounded-xl border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl p-3 space-y-3 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {/* Month & Year Navigation */}
          <div className="flex items-center justify-between gap-1.5">
            <button
              type="button"
              onClick={goPrevMonth}
              aria-label="Mes anterior"
              className="p-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer shrink-0"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            <div className="flex items-center gap-1 flex-1 min-w-0 justify-center">
              <select
                value={viewMonth}
                onChange={(e) => setViewMonth(Number(e.target.value))}
                aria-label="Mes"
                className="rounded-md border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 px-1.5 py-1 text-xs font-medium text-stone-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40 cursor-pointer"
              >
                {MONTH_NAMES_ES.map((name, idx) => (
                  <option key={name} value={idx}>
                    {name}
                  </option>
                ))}
              </select>

              <select
                value={viewYear}
                onChange={(e) => setViewYear(Number(e.target.value))}
                aria-label="Año"
                className="rounded-md border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 px-1.5 py-1 text-xs font-mono-tabular font-medium text-stone-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40 cursor-pointer"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={goNextMonth}
              aria-label="Mes siguiente"
              className="p-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer shrink-0"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Weekday Headers */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_HEADERS_ES.map((dayName) => (
              <div
                key={dayName}
                className="text-[11px] font-medium text-stone-400 dark:text-zinc-500 py-1"
              >
                {dayName}
              </div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell) => {
              const isSelected = cell.iso === value;
              const isToday = cell.iso === todayIso;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => handleSelectDate(cell.iso)}
                  className={`h-8 w-full rounded-lg text-xs font-mono-tabular transition-colors cursor-pointer flex items-center justify-center ${
                    isSelected
                      ? 'bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-semibold'
                      : isToday
                        ? 'border border-amber-500/70 bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200 font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/50'
                        : cell.inCurrentMonth
                          ? 'text-stone-800 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800'
                          : 'text-stone-400 dark:text-zinc-600 hover:bg-stone-100/70 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>

          {/* Footer Shortcuts */}
          <div className="flex items-center justify-between pt-2 border-t border-stone-200 dark:border-zinc-800 text-xs">
            <button
              type="button"
              onClick={() => handleSelectDate(todayIso)}
              className="px-2.5 py-1 rounded-md font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 cursor-pointer"
            >
              Hoy
            </button>

            <div className="flex items-center gap-1.5">
              {allowClear && value && (
                <button
                  type="button"
                  onClick={() => {
                    onChange('');
                    setOpen(false);
                  }}
                  className="px-2.5 py-1 rounded-md text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  Limpiar
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-2.5 py-1 rounded-md text-stone-500 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
