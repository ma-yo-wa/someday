const KEY = 'someday.config.v1';

export interface Config {
  /** Display names for the two partners. */
  names: [string, string];
  /** Which partner is using this device. */
  me: 0 | 1;
  supabaseUrl: string;
  supabaseKey: string;
  spaceId: string;
  googleClientId: string;
  vapidPublicKey: string;
}

/* Build-time defaults from Vite env. Empty in local demo; filled on
   Cloudflare so a fresh install can sign in without pasting keys. */
const FROM_ENV = {
  supabaseUrl: String(import.meta.env.VITE_SUPABASE_URL ?? ''),
  supabaseKey: String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''),
  googleClientId: String(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''),
  vapidPublicKey: String(import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''),
};

const DEFAULTS: Config = {
  names: ['Me', 'You'],
  me: 0,
  spaceId: '',
  ...FROM_ENV,
};

export function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Config>;
    return {
      ...DEFAULTS,
      ...parsed,
      names: parsed.names ?? DEFAULTS.names,
      // A blank field in localStorage shouldn't wipe a build-time value.
      supabaseUrl: parsed.supabaseUrl || FROM_ENV.supabaseUrl,
      supabaseKey: parsed.supabaseKey || FROM_ENV.supabaseKey,
      googleClientId: parsed.googleClientId || FROM_ENV.googleClientId,
      vapidPublicKey: parsed.vapidPublicKey || FROM_ENV.vapidPublicKey,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(c: Config): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* private mode / quota — the app still works, it just won't remember */
  }
}

/** Fully wired for the data backend (needs a space id). */
export function isSupabaseConfigured(c: Config): boolean {
  return Boolean(c.supabaseUrl && c.supabaseKey && c.spaceId);
}

/** Project credentials only — enough to sign in; the space comes after. */
export function hasProject(c: Config): boolean {
  return Boolean(c.supabaseUrl && c.supabaseKey);
}
