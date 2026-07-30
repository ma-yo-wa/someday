import { loadConfig } from './config';

export interface GifItem {
  id: string;
  title: string;
  preview: string;
  full: string;
}

const DEMO_KEY = 'FAKESECRET_a3b4c5d6e7f8g9h0i1j2';
const LIMIT = 15;

export async function fetchGifs(
  action: 'trending' | 'search',
  q = '',
  signal?: AbortSignal,
): Promise<GifItem[]> {
  const conf = loadConfig();
  let url: string;
  const headers: Record<string, string> = {};

  if (conf.supabaseUrl && conf.supabaseKey) {
    const u = new URL(`${conf.supabaseUrl.replace(/\/$/, '')}/functions/v1/giphy`);
    u.searchParams.set('action', action);
    u.searchParams.set('limit', String(LIMIT));
    if (q) u.searchParams.set('q', q);
    url = u.toString();
    headers.Authorization = `Bearer ${conf.supabaseKey}`;
  } else {
    const base =
      action === 'search'
        ? 'https://api.giphy.com/v1/gifs/search'
        : 'https://api.giphy.com/v1/gifs/trending';
    const u = new URL(base);
    u.searchParams.set('api_key', DEMO_KEY);
    u.searchParams.set('limit', String(LIMIT));
    u.searchParams.set('rating', 'pg-13');
    if (q) u.searchParams.set('q', q);
    url = u.toString();
  }

  const res = await fetch(url, { headers, signal });
  if (res.status === 429) throw Object.assign(new Error('rate'), { kind: 'rate' });
  if (res.status === 501) throw Object.assign(new Error('cfg'), { kind: 'cfg' });
  if (!res.ok) throw Object.assign(new Error('http'), { kind: 'http' });

  const body = (await res.json()) as {
    items?: GifItem[];
    data?: Array<{
      id: string;
      title?: string;
      images: Record<string, { url?: string } | undefined>;
    }>;
  };

  if (body.items) return body.items;
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
