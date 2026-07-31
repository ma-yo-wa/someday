import type { ExternalEventInput } from './backend';
import { loadConfig } from './config';

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string;
            scope: string;
            prompt?: string;
            callback: (resp: {
              access_token?: string;
              error?: string;
              error_description?: string;
            }) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => { requestAccessToken: (opts?: { prompt?: string }) => void };
        };
      };
    };
  }
}

const TOKEN_KEY = 'someday.gcalToken';
const CAL_KEY = 'someday.gcalCalendar';
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

export interface GoogleCalendar {
  id: string;
  summary: string;
  primary: boolean;
  /** owner | writer | reader — used to group “Mine” vs “Other”. */
  accessRole: 'owner' | 'writer' | 'reader' | string;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Couldn’t load Google Sign-In'));
    document.head.appendChild(s);
  });
}

function toLocal(iso: string, allDay: boolean): string {
  if (allDay) return iso.slice(0, 10);
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function googleClientId(): string {
  return loadConfig().googleClientId.trim();
}

export async function connectGoogle(): Promise<string> {
  const clientId = googleClientId();
  if (!clientId) {
    throw new Error(
      'Missing Google client ID. Set VITE_GOOGLE_CLIENT_ID in Cloudflare (or paste it in Settings), then redeploy.',
    );
  }

  await loadScript('https://accounts.google.com/gsi/client');
  if (!window.google) throw new Error('Google Sign-In didn’t load');

  return new Promise((resolve, reject) => {
    const tc = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      prompt: 'consent',
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(
            new Error(
              resp.error_description ||
                resp.error ||
                'Google declined calendar access',
            ),
          );
          return;
        }
        try {
          sessionStorage.setItem(TOKEN_KEY, resp.access_token);
        } catch {
          /* private mode */
        }
        resolve(resp.access_token);
      },
      error_callback: (err) => {
        reject(new Error(err.message || err.type || 'Google sign-in failed'));
      },
    });
    tc.requestAccessToken();
  });
}

export function googleToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearGoogleToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* */
  }
}

export function savedGoogleCalendar(): GoogleCalendar | null {
  try {
    const raw = localStorage.getItem(CAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GoogleCalendar;
    if (!parsed?.id || !parsed?.summary) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveGoogleCalendar(cal: GoogleCalendar | null): void {
  try {
    if (!cal) localStorage.removeItem(CAL_KEY);
    else localStorage.setItem(CAL_KEY, JSON.stringify(cal));
  } catch {
    /* */
  }
}

export async function listGoogleCalendars(token: string): Promise<GoogleCalendar[]> {
  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 401 || res.status === 403) {
    clearGoogleToken();
    throw new Error('Google access expired — connect again');
  }
  if (!res.ok) throw new Error("Couldn't list your calendars");

  const body = (await res.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      primary?: boolean;
      accessRole?: string;
    }>;
  };

  const list = (body.items ?? [])
    .filter((c) => c.id)
    .map((c) => ({
      id: c.id,
      summary: c.summary?.trim() || c.id,
      primary: Boolean(c.primary),
      accessRole: c.accessRole || 'reader',
    }));

  // Primary first, then A–Z.
  list.sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    return a.summary.localeCompare(b.summary);
  });
  return list;
}

/* Titles are shared by default. A null title is reserved for an explicit
   busy-only share later — Google's own events always carry a summary. */
export async function fetchGoogleEvents(
  token: string,
  _ownerId: string,
  calendarId: string,
): Promise<ExternalEventInput[]> {
  const min = new Date();
  min.setMonth(min.getMonth() - 1);
  const max = new Date();
  max.setMonth(max.getMonth() + 3);

  const cal = encodeURIComponent(calendarId);
  const url =
    `https://www.googleapis.com/calendar/v3/calendars/${cal}/events` +
    `?timeMin=${min.toISOString()}&timeMax=${max.toISOString()}` +
    '&singleEvents=true&orderBy=startTime&maxResults=250';

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) {
    clearGoogleToken();
    throw new Error('Google access expired — connect again');
  }
  if (!res.ok) throw new Error("Couldn't read Google Calendar");

  const body = (await res.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      description?: string;
      location?: string;
      start: { date?: string; dateTime?: string };
      end: { date?: string; dateTime?: string };
    }>;
  };

  const label = savedGoogleCalendar()?.summary || 'Google';

  return (body.items ?? [])
    .filter((ev) => ev.id && (ev.start?.date || ev.start?.dateTime))
    .map((ev) => {
      const allDay = Boolean(ev.start.date);
      const startRaw = ev.start.date ?? ev.start.dateTime ?? '';
      const endRaw = ev.end?.date ?? ev.end?.dateTime ?? startRaw;
      // Google all-day ends are exclusive; pull them back one day so the
      // band covers the nights they actually occupy.
      let endsAt = toLocal(endRaw, allDay);
      if (allDay && endsAt > toLocal(startRaw, true)) {
        const d = new Date(endsAt + 'T12:00:00');
        d.setDate(d.getDate() - 1);
        const pad = (n: number) => String(n).padStart(2, '0');
        endsAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      }
      return {
        sourceId: ev.id,
        title: ev.summary?.trim() || 'Busy',
        location: cleanPlace(ev.location),
        description: cleanNotes(ev.description),
        startsAt: toLocal(startRaw, allDay),
        endsAt,
        allDay,
        calendar: label,
      };
    });
}

function cleanPlace(raw: string | undefined): string | null {
  const t = raw?.replace(/\s+/g, ' ').trim();
  return t || null;
}

/** Google descriptions are often HTML (Airbnb, invites). Keep readable text. */
function cleanNotes(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return null;
  return text.length > 1200 ? `${text.slice(0, 1197)}…` : text;
}
