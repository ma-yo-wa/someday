import { loadConfig } from './config';

export interface GifItem {
  id: string;
  title: string;
  preview: string;
  full: string;
}

/* Giphy’s public beta key (from their docs). Fine for a private two-person
   app. Prefer VITE_GIPHY_API_KEY, or the Edge Function + GIPHY_API_KEY
   secret, when you want your own quota. */
const API_KEY =
  (import.meta.env.VITE_GIPHY_API_KEY as string | undefined)?.trim() ||
  'sXpGFDGZs0Dv1mmNFvYaGUvYwKX52TU3';

const LIMIT = 15;

export async function fetchGifs(
  action: 'trending' | 'search',
  q = '',
  signal?: AbortSignal,
): Promise<GifItem[]> {
  const conf = loadConfig();

  // Prefer the Edge Function when Supabase is wired — key stays server-side.
  if (conf.supabaseUrl && conf.supabaseKey) {
    try {
      return await fetchViaFunction(conf.supabaseUrl, conf.supabaseKey, action, q, signal);
    } catch (err) {
      const kind = (err as { kind?: string }).kind;
      // Function missing / not configured → fall back so covers still work.
      if (kind !== 'cfg' && kind !== 'http' && kind !== 'missing') throw err;
    }
  }

  return fetchDirect(action, q, signal);
}

async function fetchViaFunction(
  supabaseUrl: string,
  supabaseKey: string,
  action: 'trending' | 'search',
  q: string,
  signal?: AbortSignal,
): Promise<GifItem[]> {
  const u = new URL(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/giphy`);
  u.searchParams.set('action', action);
  u.searchParams.set('limit', String(LIMIT));
  if (q) u.searchParams.set('q', q);

  const res = await fetch(u, {
    headers: { Authorization: `Bearer ${supabaseKey}` },
    signal,
  });

  if (res.status === 429) throw Object.assign(new Error('rate'), { kind: 'rate' });
  if (res.status === 501) throw Object.assign(new Error('cfg'), { kind: 'cfg' });
  if (res.status === 404) throw Object.assign(new Error('missing'), { kind: 'missing' });
  if (!res.ok) throw Object.assign(new Error('http'), { kind: 'http' });

  const body = (await res.json()) as { items?: GifItem[] };
  return body.items ?? [];
}

async function fetchDirect(
  action: 'trending' | 'search',
  q: string,
  signal?: AbortSignal,
): Promise<GifItem[]> {
  const base =
    action === 'search'
      ? 'https://api.giphy.com/v1/gifs/search'
      : 'https://api.giphy.com/v1/gifs/trending';
  const u = new URL(base);
  u.searchParams.set('api_key', API_KEY);
  u.searchParams.set('limit', String(LIMIT));
  u.searchParams.set('rating', 'pg-13');
  if (q) u.searchParams.set('q', q);

  const res = await fetch(u.toString(), { signal });
  if (res.status === 429) throw Object.assign(new Error('rate'), { kind: 'rate' });
  if (!res.ok) throw Object.assign(new Error('http'), { kind: 'http' });

  const body = (await res.json()) as {
    data?: Array<{
      id: string;
      title?: string;
      images: Record<string, { url?: string } | undefined>;
    }>;
  };

  return (body.data ?? [])
    .map((g) => ({
      id: g.id,
      title: g.title ?? '',
      preview:
        g.images.fixed_height_small?.url ??
        g.images.preview_gif?.url ??
        g.images.downsized?.url ??
        g.images.fixed_height?.url ??
        '',
      full:
        g.images.downsized?.url ??
        g.images.fixed_height?.url ??
        g.images.original?.url ??
        '',
    }))
    .filter((g) => g.preview && g.full);
}
