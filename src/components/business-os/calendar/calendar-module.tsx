'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, Plus, MapPin, Clock, CalendarDays,
  Users, List, Grid3X3, Calendar as CalendarIcon, MoreHorizontal,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { calendarEvents } from '@/lib/mock-data';

// ─── Types & Helpers ─────────────────────────────────────────────────────────

type CalendarView = 'day' | 'week' | 'month';

interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  events: typeof calendarEvents;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function isSameDay(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

function formatEventTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function buildMonthGrid(year: number, month: number, events: typeof calendarEvents): CalendarDay[][] {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const today = new Date();

  // Previous month padding
  const prevMonthDays = getDaysInMonth(year, month - 1 < 0 ? 11 : month - 1);
  const days: CalendarDay[] = [];

  for (let i = firstDay - 1; i >= 0; i--) {
    const day = prevMonthDays - i;
    const date = new Date(year, month - 1, day);
    days.push({ date, isCurrentMonth: false, isToday: isSameDay(date, today), events: [] });
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const dayEvents = events.filter((ev) => {
      const start = new Date(ev.startDate);
      const end = new Date(ev.endDate);
      return (
        (isSameDay(date, start) || date > start) &&
        (isSameDay(date, end) || date < end)
      );
    });
    days.push({ date, isCurrentMonth: true, isToday: isSameDay(date, today), events: dayEvents });
  }

  // Fill to 6 weeks
  const remaining = 42 - days.length;
  for (let d = 1; d <= remaining; d++) {
    const date = new Date(year, month + 1, d);
    days.push({ date, isCurrentMonth: false, isToday: isSameDay(date, today), events: [] });
  }

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < 42; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function CalendarModule() {
  const [currentYear, setCurrentYear] = useState(2026);
  const [currentMonth, setCurrentMonth] = useState(6); // July
  const [view, setView] = useState<CalendarView>('month');
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date(2026, 6, 20));

  const weeks = useMemo(
    () => buildMonthGrid(currentYear, currentMonth, calendarEvents),
    [currentYear, currentMonth]
  );

  // Upcoming events starting from selected date or today
  const upcomingEvents = useMemo(() => {
    const ref = selectedDate || new Date(2026, 6, 20);
    return calendarEvents
      .filter((ev) => new Date(ev.startDate) >= new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()))
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
      .slice(0, 8);
  }, [selectedDate]);

  const navigatePrev = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const navigateNext = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const goToToday = () => {
    const today = new Date();
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
    setSelectedDate(today);
  };

  const viewButtons: { label: string; value: CalendarView; icon: React.ElementType }[] = [
    { label: 'Day', value: 'day', icon: List },
    { label: 'Week', value: 'week', icon: Grid3X3 },
    { label: 'Month', value: 'month', icon: CalendarDays },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full bg-background">
        {/* ── Main Calendar Area ──────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Bar */}
          <div className="h-14 flex items-center justify-between px-4 border-b border-border bg-background/80 backdrop-blur-sm flex-shrink-0">
            <div className="flex items-center gap-3">
              <motion.h2
                key={`${currentYear}-${currentMonth}`}
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-lg font-semibold text-foreground"
              >
                {MONTH_NAMES[currentMonth]} {currentYear}
              </motion.h2>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={navigatePrev}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={navigateNext}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" className="h-7 px-3 text-xs ml-1" onClick={goToToday}>
                  Today
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* View toggle */}
              <div className="flex items-center rounded-md border border-border bg-muted/50 p-0.5">
                {viewButtons.map((vb) => {
                  const Icon = vb.icon;
                  return (
                    <Button
                      key={vb.value}
                      variant="ghost"
                      size="sm"
                      onClick={() => setView(vb.value)}
                      className={cn(
                        'h-7 px-3 text-xs gap-1.5',
                        view === vb.value
                          ? 'bg-background shadow-sm text-foreground font-medium'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {vb.label}
                    </Button>
                  );
                })}
              </div>
              <Separator orientation="vertical" className="h-6 mx-1" />
              <Button size="sm" className="h-8 bg-emerald-500 hover:bg-emerald-600 text-white gap-1.5">
                <Plus className="h-4 w-4" />
                New Event
              </Button>
            </div>
          </div>

          {/* Month View */}
          <AnimatePresence mode="wait">
            {view === 'month' && (
              <motion.div
                key="month-view"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex flex-col p-3"
              >
                {/* Day headers */}
                <div className="grid grid-cols-7 mb-1">
                  {DAY_HEADERS.map((day) => (
                    <div
                      key={day}
                      className="text-center text-xs font-medium text-muted-foreground py-2"
                    >
                      {day}
                    </div>
                  ))}
                </div>

                {/* Calendar grid */}
                <div className="flex-1 grid grid-rows-6 grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
                  {weeks.map((week, wi) =>
                    week.map((day, di) => {
                      const isSelected = selectedDate && isSameDay(day.date, selectedDate);
                      return (
                        <motion.button
                          key={`${wi}-${di}`}
                          whileHover={{ backgroundColor: 'rgba(16,185,129,0.04)' }}
                          onClick={() => setSelectedDate(day.date)}
                          className={cn(
                            'bg-background p-1.5 flex flex-col items-start text-left transition-colors relative min-h-[80px]',
                            !day.isCurrentMonth && 'bg-muted/30',
                            isSelected && 'bg-emerald-50/50 dark:bg-emerald-950/20'
                          )}
                        >
                          <div className="flex items-center justify-between w-full mb-0.5">
                            <span
                              className={cn(
                                'text-xs font-medium h-6 w-6 flex items-center justify-center rounded-full',
                                day.isCurrentMonth
                                  ? day.isToday
                                    ? 'bg-emerald-500 text-white font-bold ring-2 ring-emerald-500 ring-offset-1 ring-offset-background'
                                    : 'text-foreground'
                                  : 'text-muted-foreground/40'
                              )}
                            >
                              {day.date.getDate()}
                            </span>
                          </div>

                          {/* Event indicators */}
                          <div className="flex-1 w-full space-y-0.5 overflow-hidden">
                            {day.events.slice(0, 3).map((ev) => (
                              <div
                                key={ev.id}
                                className="truncate text-[10px] leading-tight px-1.5 py-0.5 rounded-sm font-medium text-white"
                                style={{ backgroundColor: ev.color }}
                                title={ev.title}
                              >
                                {ev.allDay
                                  ? ev.title
                                  : `${formatEventTime(ev.startDate)} ${ev.title}`}
                              </div>
                            ))}
                            {day.events.length > 3 && (
                              <span className="text-[10px] text-muted-foreground font-medium px-1.5">
                                +{day.events.length - 3} more
                              </span>
                            )}
                          </div>

                          {/* Dot indicators for small screens / secondary view */}
                          {day.events.length > 0 && (
                            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
                              {day.events.slice(0, 4).map((ev) => (
                                <div
                                  key={ev.id}
                                  className="w-1 h-1 rounded-full"
                                  style={{ backgroundColor: ev.color }}
                                />
                              ))}
                            </div>
                          )}
                        </motion.button>
                      );
                    })
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Side Panel: Upcoming Events ─────────────────────────────── */}
        <motion.div
          initial={{ x: 20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="w-80 flex-shrink-0 border-l border-border bg-muted/20 flex flex-col"
        >
          {/* Side panel header */}
          <div className="p-4 pb-3 border-b border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-emerald-500" />
                <h3 className="font-semibold text-sm text-foreground">Upcoming Events</h3>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>More options</TooltipContent>
              </Tooltip>
            </div>
            {selectedDate && (
              <p className="text-xs text-muted-foreground mt-1">
                Showing events from{' '}
                {selectedDate.toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </p>
            )}
          </div>

          {/* Events list */}
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              {upcomingEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                    <CalendarDays className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground">No upcoming events</p>
                  <p className="text-xs text-muted-foreground mt-1">Create a new event to get started</p>
                  <Button
                    size="sm"
                    className="mt-3 h-8 bg-emerald-500 hover:bg-emerald-600 text-white gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Event
                  </Button>
                </div>
              ) : (
                upcomingEvents.map((event, idx) => (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 * idx, duration: 0.25 }}
                    whileHover={{ x: 2 }}
                    className={cn(
                      'rounded-lg border border-border bg-background p-3 cursor-pointer transition-shadow hover:shadow-md',
                      selectedDate && isSameDay(selectedDate, new Date(event.startDate))
                        ? 'ring-1 ring-emerald-500/30'
                        : ''
                    )}
                  >
                    <div className="flex gap-3">
                      {/* Color accent bar */}
                      <div
                        className="w-1 rounded-full flex-shrink-0 self-stretch"
                        style={{ backgroundColor: event.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm text-foreground truncate">
                          {event.title}
                        </h4>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {event.description}
                        </p>
                        <div className="flex items-center gap-3 mt-1.5">
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {event.allDay
                              ? 'All day'
                              : `${formatEventTime(event.startDate)} – ${formatEventTime(event.endDate)}`}
                          </div>
                        </div>
                        {event.location && (
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1">
                            <MapPin className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{event.location}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1">
                          <Users className="h-3 w-3 flex-shrink-0" />
                          <span>{event.creatorName}</span>
                        </div>
                      </div>
                    </div>
                    {/* Event date badge */}
                    <div className="mt-2 pt-2 border-t border-border/50">
                      <div className="flex items-center justify-between">
                        <Badge
                          variant="secondary"
                          className="text-[10px] h-5 px-1.5 gap-0.5"
                          style={{ backgroundColor: event.color + '20', color: event.color }}
                        >
                          {event.allDay
                            ? `${new Date(event.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(event.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                            : new Date(event.startDate).toLocaleDateString('en-US', {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                              })}
                        </Badge>
                        {event.allDay && (
                          <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-teal-200 text-teal-700 dark:border-teal-800 dark:text-teal-400">
                            Multi-day
                          </Badge>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </ScrollArea>

          {/* Mini calendar stats */}
          <div className="p-3 border-t border-border">
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <p className="text-lg font-bold text-emerald-600">{calendarEvents.length}</p>
                <p className="text-[10px] text-muted-foreground">Total Events</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <p className="text-lg font-bold text-teal-600">
                  {calendarEvents.filter((e) => e.allDay).length}
                </p>
                <p className="text-[10px] text-muted-foreground">All-Day</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <p className="text-lg font-bold text-cyan-600">
                  {calendarEvents.filter((e) => !e.allDay).length}
                </p>
                <p className="text-[10px] text-muted-foreground">Timed</p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </TooltipProvider>
  );
}