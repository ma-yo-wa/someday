import type { ExternalEvent } from './types';
import { loadConfig } from './config';

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string;
            scope: string;
            callback: (resp: { access_token?: string; error?: string }) => void;
          }) => { requestAccessToken: () => void };
        };
      };
    };
  }
}

const TOKEN_KEY = 'os.gcalToken';

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
    s.onerror = () => reject(new Error('Couldn’t load Google'));
    document.head.appendChild(s);
  });
}

function toLocal(iso: string, allDay: boolean): string {
  if (allDay) return iso.slice(0, 10);
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function connectGoogle(): Promise<string> {
  const clientId = loadConfig().googleClientId.trim();
  if (!clientId) throw new Error('Add a Google client ID in Settings first');

  await loadScript('https://accounts.google.com/gsi/client');
  if (!window.google) throw new Error('Google Sign-In didn’t load');

  return new Promise((resolve, reject) => {
    const tc = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error('Google declined the request'));
          return;
        }
        try {
          sessionStorage.setItem(TOKEN_KEY, resp.access_token);
        } catch {
          /* private mode */
        }
        resolve(resp.access_token);
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

/* Titles are shared by default. A null title is reserved for an explicit
   busy-only share later — Google's own events always carry a summary. */
export async function fetchGoogleEvents(
  token: string,
  ownerId: string,
): Promise<ExternalEvent[]> {
  const min = new Date();
  min.setMonth(min.getMonth() - 1);
  const max = new Date();
  max.setMonth(max.getMonth() + 3);

  const url =
    'https://www.googleapis.com/calendar/v3/calendars/primary/events' +
    `?timeMin=${min.toISOString()}&timeMax=${max.toISOString()}` +
    '&singleEvents=true&orderBy=startTime&maxResults=250';

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Couldn't read Google Calendar");

  const body = (await res.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      start: { date?: string; dateTime?: string };
      end: { date?: string; dateTime?: string };
    }>;
  };

  return (body.items ?? []).map((ev) => {
    const allDay = Boolean(ev.start.date);
    const startRaw = ev.start.date ?? ev.start.dateTime ?? '';
    const endRaw = ev.end.date ?? ev.end.dateTime ?? startRaw;
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
      id: `gcal-${ev.id}`,
      ownerId,
      title: ev.summary?.trim() || 'Busy',
      startsAt: toLocal(startRaw, allDay),
      endsAt,
      allDay,
      calendar: 'Google',
    };
  });
}
