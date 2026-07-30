export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const MON3 = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
export const DAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Local-date ISO (YYYY-MM-DD). Deliberately not toISOString(), which
 *  converts to UTC and can hand back yesterday. */
export function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): string {
  return iso(new Date());
}

/** Parse YYYY-MM-DD as a *local* date, not UTC midnight. */
export function parseISO(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** The date half of a stored date_time. */
export function dtDate(v: string | null): string | null {
  return v ? v.slice(0, 10) : null;
}

/** The time half, or null when the plan is all-day. */
export function dtTime(v: string | null): string | null {
  if (!v || v.length <= 10) return null;
  return v.slice(11, 16);
}

export function addDays(n: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + n);
  return iso(d);
}

/** Next Saturday. Never today, so "this weekend" always points forward. */
export function nextSaturday(): string {
  const offset = (6 - new Date().getDay() + 7) % 7 || 7;
  return addDays(offset);
}

/** 18:30 -> "6:30 PM" */
export function pretty(time: string): string {
  const [hRaw, m] = time.split(':').map(Number);
  const h = hRaw ?? 0;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m ?? 0)} ${suffix}`;
}

/** 18:30 -> "6:30 pm" — the agenda sets time lowercase, so it recedes
 *  behind the title instead of competing with it. */
export function prettyLower(time: string): string {
  return pretty(time).replace('AM', 'am').replace('PM', 'pm');
}

/** Every date an event touches, so a multi-day booking appears on each
 *  day it actually covers rather than only the one it starts on. */
export function spanDays(startsAt: string, endsAt: string): string[] {
  const from = parseISO(startsAt);
  const to = parseISO(endsAt);
  const out: string[] = [];
  const cur = new Date(from);
  // Guard against a malformed feed handing us a decade-long event.
  for (let i = 0; cur <= to && i < 400; i++) {
    out.push(iso(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out.length ? out : [iso(from)];
}

/** "8:10 am – 3:45 pm" on one day; "Aug 30 at 9:00 am – Sep 3 at 5:00 am"
 *  when it crosses midnight. */
export function formatRange(
  startsAt: string,
  endsAt: string,
  allDay: boolean,
): string {
  const sDate = dtDate(startsAt) as string;
  const eDate = dtDate(endsAt) as string;
  const sTime = dtTime(startsAt);
  const eTime = dtTime(endsAt);
  const sameDay = sDate === eDate;

  if (allDay) {
    if (sameDay) return 'All day';
    return `${shortDate(sDate)} – ${shortDate(eDate)}`;
  }
  if (sameDay) {
    return `${sTime ? prettyLower(sTime) : ''}${eTime ? ` – ${prettyLower(eTime)}` : ''}`;
  }
  const left = `${shortDate(sDate)}${sTime ? ` at ${prettyLower(sTime)}` : ''}`;
  const right = `${shortDate(eDate)}${eTime ? ` at ${prettyLower(eTime)}` : ''}`;
  return `${left} – ${right}`;
}

/** How a plan reads on its own detail screen: the full day spelled out,
 *  a span when it has one, and the time only when there is one. */
export function describePlan(
  dateTime: string,
  endsAt: string | null,
): string {
  const start = parseISO(dateTime);
  const time = dtTime(dateTime);
  const long = (d: Date) =>
    d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  if (endsAt && dtDate(endsAt) !== dtDate(dateTime)) {
    const end = parseISO(endsAt);
    const nights = Math.round((+end - +start) / 86400000);
    return `${long(start)} – ${long(end)} · ${nights} night${nights === 1 ? '' : 's'}`;
  }
  return time ? `${long(start)} at ${pretty(time)}` : `${long(start)}, all day`;
}

/** "3 minutes ago", "yesterday", "12 Mar" — precise while it's fresh and
 *  vague once it stops mattering, which is how people talk about time. */
export function timeAgo(stamp: string): string {
  const then = new Date(stamp);
  const mins = Math.floor((Date.now() - +then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return `${MON3[then.getMonth()]} ${then.getDate()}`;
}

/** "2026-09-03" -> "Sep 3" */
export function shortDate(dateISO: string): string {
  const d = parseISO(dateISO);
  return `${MON3[d.getMonth()]} ${d.getDate()}`;
}

export function describeDT(v: string): string {
  const date = parseISO(v);
  const t = dtTime(v);
  const day = `${DAYS[date.getDay()]}, ${MON3[date.getMonth()]} ${date.getDate()}`;
  return t ? `${day} at ${pretty(t)}` : day;
}

/** Cells for a month grid, padded to whole weeks. */
export interface DayCell {
  label: number | '';
  date: string | null;
  outside: boolean;
}

export function monthGrid(cursor: Date): DayCell[] {
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const start = new Date(y, m, 1).getDay();
  const dim = new Date(y, m + 1, 0).getDate();
  const dimPrev = new Date(y, m, 0).getDate();

  const cells: DayCell[] = [];
  for (let i = 0; i < start; i++) {
    cells.push({ label: dimPrev - start + 1 + i, date: null, outside: true });
  }
  for (let d = 1; d <= dim; d++) {
    cells.push({ label: d, date: iso(new Date(y, m, d)), outside: false });
  }
  while (cells.length % 7) cells.push({ label: '', date: null, outside: true });
  return cells;
}
