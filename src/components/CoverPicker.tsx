import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { fetchGifs, type GifItem } from '../lib/giphy';
import {
  emojiCover,
  fileToCoverDataUrl,
  iconsForPicker,
  isEmojiCover,
} from '../lib/cover';
import CoverArt from './CoverArt';
import f from './Form.module.css';
import s from './CoverPicker.module.css';

type Tab = 'icons' | 'gifs' | 'photos';

interface Props {
  value: string | null;
  onChange: (url: string | null) => void;
  titleHint: () => string;
}

export default function CoverPicker({ value, onChange, titleHint }: Props) {
  const [tab, setTab] = useState<Tab>('icons');
  const [q, setQ] = useState('');
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<number | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadGifs(action: 'trending' | 'search', query: string) {
    ctrl.current?.abort();
    const mine = new AbortController();
    ctrl.current = mine;
    setLoading(true);
    setMsg(null);
    try {
      const next = await fetchGifs(action, query, mine.signal);
      if (mine.signal.aborted) return;
      setGifs(next);
      if (!next.length) {
        setMsg(query ? `Nothing for “${query}”. Try another word.` : 'No GIFs came back.');
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const kind = (err as { kind?: string }).kind;
      setGifs([]);
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

  function openGifsTab() {
    setTab('gifs');
    const t = titleHint().trim();
    if (t) {
      setQ(t);
      void loadGifs('search', t);
    } else if (!gifs.length) {
      void loadGifs('trending', '');
    }
  }

  useEffect(() => () => ctrl.current?.abort(), []);

  const icons = iconsForPicker(titleHint(), tab === 'icons' ? q : '');

  return (
    <div className={s.wrap}>
      {value && (
        <div className={s.preview}>
          <CoverArt url={value} size="hero" className={s.previewArt} />
          <div className={s.tools}>
            <button
              type="button"
              className={`${s.tool} ${s.danger}`}
              onClick={() => {
                onChange(null);
                setGifs([]);
                setMsg(null);
              }}
            >
              Remove
            </button>
          </div>
        </div>
      )}

      <div className={f.segmented} role="tablist" aria-label="Cover type">
        {(
          [
            ['icons', 'Icons'],
            ['gifs', 'GIFs'],
            ['photos', 'Photos'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`${f.segment} ${tab === id ? f.segmentOn : ''}`}
            onClick={() => {
              if (id === 'gifs') openGifsTab();
              else {
                setTab(id);
                setMsg(null);
                if (id === 'icons') setQ('');
              }
            }}
          >
            {tab === id && (
              <motion.span
                layoutId="cover-tab-knob"
                className={f.segmentKnob}
                transition={{ type: 'spring', stiffness: 520, damping: 38 }}
              />
            )}
            <span className={f.segmentLabel}>{label}</span>
          </button>
        ))}
      </div>

      {(tab === 'icons' || tab === 'gifs') && (
        <div className={`${s.search} ${loading ? s.loading : ''}`}>
          <span className={s.mag} aria-hidden>
            ⌕
          </span>
          <input
            className={s.searchInput}
            value={q}
            placeholder={tab === 'gifs' ? 'Search Giphy…' : 'Search icons…'}
            onChange={(e) => {
              const next = e.target.value;
              setQ(next);
              if (tab !== 'gifs') return;
              if (timer.current) window.clearTimeout(timer.current);
              timer.current = window.setTimeout(() => {
                void loadGifs(next.trim() ? 'search' : 'trending', next.trim());
              }, 300);
            }}
            onFocus={() => {
              if (tab === 'gifs' && !q.trim() && !gifs.length) {
                const t = titleHint().trim();
                if (t) {
                  setQ(t);
                  void loadGifs('search', t);
                } else {
                  void loadGifs('trending', '');
                }
              }
            }}
          />
          {q ? (
            <button
              type="button"
              className={s.clear}
              aria-label="Clear search"
              onClick={() => {
                setQ('');
                if (tab === 'gifs') void loadGifs('trending', '');
              }}
            >
              ×
            </button>
          ) : null}
        </div>
      )}

      {tab === 'icons' && (
        <div className={s.grid}>
          {icons.map((emoji) => {
            const cover = emojiCover(emoji);
            const on = value === cover;
            return (
              <button
                key={emoji}
                type="button"
                className={`${s.iconCell} ${on ? s.iconOn : ''}`}
                onClick={() => onChange(cover)}
                aria-label={`Use ${emoji}`}
              >
                <span>{emoji}</span>
              </button>
            );
          })}
        </div>
      )}

      {tab === 'gifs' && gifs.length > 0 && (
        <div className={s.gifGrid}>
          {gifs.map((g, i) => (
            <button
              key={g.id}
              type="button"
              className={`${s.gifCell} ${value === g.full ? s.iconOn : ''}`}
              style={{ ['--i' as string]: i }}
              onClick={() => {
                onChange(g.full);
                setMsg(null);
              }}
            >
              <img src={g.preview} alt={g.title.slice(0, 60)} loading="lazy" />
            </button>
          ))}
        </div>
      )}

      {tab === 'photos' && (
        <div className={s.photos}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className={s.file}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              void (async () => {
                try {
                  const url = await fileToCoverDataUrl(file);
                  onChange(url);
                  setMsg(null);
                } catch (err) {
                  setMsg(err instanceof Error ? err.message : 'Couldn’t use that photo');
                }
              })();
            }}
          />
          <button
            type="button"
            className={s.photoBtn}
            onClick={() => fileRef.current?.click()}
          >
            Choose from library
          </button>
          <p className={s.photoNote}>
            Picks a photo from this phone. It’s saved with the idea.
          </p>
          {value && !isEmojiCover(value) && value.startsWith('data:') ? (
            <CoverArt url={value} size="thumb" className={s.photoThumb} />
          ) : null}
        </div>
      )}

      {msg && (
        <div className={s.msg}>
          <span>{msg}</span>
          {tab === 'gifs' ? (
            <button
              type="button"
              onClick={() => void loadGifs(q.trim() ? 'search' : 'trending', q.trim())}
            >
              Retry
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
