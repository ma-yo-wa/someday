import { useEffect, useRef, useState } from 'react';
import { fetchGifs, type GifItem } from '../lib/giphy';
import f from './Form.module.css';
import s from './GiphyPicker.module.css';

interface Props {
  value: string | null;
  onChange: (url: string | null) => void;
  titleHint: () => string;
}

export default function GiphyPicker({ value, onChange, titleHint }: Props) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<GifItem[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<number | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  async function load(action: 'trending' | 'search', query: string) {
    ctrl.current?.abort();
    const mine = new AbortController();
    ctrl.current = mine;
    setLoading(true);
    setMsg(null);
    try {
      const next = await fetchGifs(action, query, mine.signal);
      if (mine.signal.aborted) return;
      setItems(next);
      if (!next.length) {
        setMsg(query ? `Nothing for “${query}”. Try another word.` : 'No GIFs came back.');
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const kind = (err as { kind?: string }).kind;
      setItems([]);
      setMsg(
        {
          rate: "Giphy's rate limit is hit. Give it a minute.",
          cfg: 'Add VITE_GIPHY_API_KEY in Cloudflare (free key from developers.giphy.com), then redeploy.',
          http: 'Giphy returned an error.',
        }[kind ?? ''] ?? "Couldn't reach Giphy.",
      );
    } finally {
      if (!mine.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => () => ctrl.current?.abort(), []);

  return (
    <div className={s.wrap}>
      {value && (
        <div className={s.cover} style={{ backgroundImage: `url(${value})` }}>
          <div className={s.tools}>
            <button
              type="button"
              className={s.tool}
              onClick={() => void load(q.trim() ? 'search' : 'trending', q.trim())}
            >
              Change
            </button>
            <button
              type="button"
              className={`${s.tool} ${s.danger}`}
              onClick={() => {
                onChange(null);
                setItems([]);
              }}
            >
              Remove
            </button>
          </div>
        </div>
      )}

      <div className={`${s.bar} ${loading ? s.loading : ''}`}>
        <input
          className={f.input}
          value={q}
          placeholder="Search Giphy"
          onChange={(e) => {
            const next = e.target.value;
            setQ(next);
            if (timer.current) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => {
              void load(next.trim() ? 'search' : 'trending', next.trim());
            }, 300);
          }}
          onFocus={() => {
            if (!q.trim() && !items.length) void load('trending', '');
          }}
        />
        <button
          type="button"
          className={s.suggest}
          onClick={() => {
            const t = titleHint().trim();
            if (!t) {
              setMsg('Give it a title first.');
              return;
            }
            setQ(t);
            void load('search', t);
          }}
        >
          Suggest
        </button>
      </div>

      {items.length > 0 && (
        <div className={s.strip}>
          {items.map((g, i) => (
            <img
              key={g.id}
              src={g.preview}
              alt={g.title.slice(0, 60)}
              loading="lazy"
              className={value === g.full ? s.on : undefined}
              style={{ ['--i' as string]: i }}
              onClick={() => {
                onChange(g.full);
                setItems([]);
                setMsg(null);
              }}
            />
          ))}
        </div>
      )}

      {msg && (
        <div className={s.msg}>
          <span>{msg}</span>
          <button type="button" onClick={() => void load(q.trim() ? 'search' : 'trending', q.trim())}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
