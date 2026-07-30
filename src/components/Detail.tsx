import { useEffect, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import Sheet from './Sheet';
import GiphyPicker from './GiphyPicker';
import { useApp, partnerName } from '../lib/store';
import { isPlan } from '../lib/types';
import { artFor } from '../lib/art';
import { faceColor } from '../lib/tint';
import {
  describePlan,
  dtDate,
  dtTime,
  iso,
  parseISO,
  timeAgo,
  todayISO,
} from '../lib/date';
import s from './Detail.module.css';
import f from './Form.module.css';

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 20h4L20 8a2.8 2.8 0 0 0-4-4L4 16v4Z" strokeLinejoin="round" />
    </svg>
  );
}

function CalendarPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="4" />
      <path d="M3 10h18M8 3v3M16 3v3M12 13v5M9.5 15.5h5" strokeLinecap="round" />
    </svg>
  );
}

function BucketIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path
        d="M4.6 5h14.8l-2 12.3A3 3 0 0 1 14.4 20H9.6a3 3 0 0 1-3-2.7L4.6 5Z"
        strokeLinejoin="round"
      />
      <path d="m8.6 10.6 2.4 2.4 4.4-4.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" strokeLinecap="round" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" strokeLinejoin="round" />
    </svg>
  );
}

type Mode = 'view' | 'edit' | 'when' | 'confirmDelete';

export default function Detail() {
  const detailId = useApp((st) => st.detailId);
  const activities = useApp((st) => st.activities);
  const logs = useApp((st) => st.logs);
  const config = useApp((st) => st.config);
  const openDetail = useApp((st) => st.openDetail);
  const patch = useApp((st) => st.patch);
  const remove = useApp((st) => st.remove);
  const toast = useApp((st) => st.toast);
  const setPicked = useApp((st) => st.setPicked);
  const setCursor = useApp((st) => st.setCursor);

  const item = activities.find((a) => a.id === detailId) ?? null;

  const [mode, setMode] = useState<Mode>('view');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [cover, setCover] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState('');
  const [end, setEnd] = useState<string | null>(null);

  // Reset every time a different card opens, so nothing leaks between them.
  useEffect(() => {
    if (!item) return;
    setMode('view');
    setTitle(item.title);
    setNotes(item.description ?? '');
    setCover(item.image_url);
    setDate(dtDate(item.date_time) ?? todayISO());
    setTime(dtTime(item.date_time) ?? '');
    setEnd(dtDate(item.ends_at));
  }, [detailId, item]);

  if (!item) return <Sheet open={false} onClose={() => openDetail(null)} children={null} />;

  const planned = isPlan(item);
  const history = logs
    .filter((l) => l.activity_id === item.id)
    .slice()
    .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));

  const close = () => openDetail(null);

  async function saveEdits() {
    const clean = title.trim();
    if (!clean) {
      toast('It needs a name');
      return;
    }
    await patch(item!.id, {
      title: clean,
      description: notes.trim() || null,
      image_url: cover,
    });
    setMode('view');
  }

  async function saveWhen() {
    const dateTime = time ? `${date}T${time}` : date;
    // An end that isn't after the start isn't a span, it's a typo.
    const span = end && end > date ? (time ? `${end}T${time}` : end) : null;
    await patch(item!.id, { date_time: dateTime, ends_at: span });
    setPicked(date);
    const d = parseISO(date);
    setCursor(iso(new Date(d.getFullYear(), d.getMonth(), 1)));
    setMode('view');
    toast('Moved');
  }

  async function toBucket() {
    await patch(item!.id, { date_time: null, ends_at: null });
    toast('Back on the bucket list');
    close();
  }

  return (
    <Sheet open={!!detailId} onClose={close}>
      <div className={s.head}>
        <span className={s.glyph} aria-hidden>
          {artFor(item.title)}
        </span>
        <div>
          <h3 className={s.title}>{item.title}</h3>
          <div className={s.when}>
            {planned
              ? describePlan(item.date_time as string, item.ends_at)
              : 'On the bucket list'}
          </div>
        </div>
        {mode === 'view' && (
          <button
            type="button"
            className={s.round}
            onClick={() => setMode('edit')}
            aria-label="Edit"
          >
            <PencilIcon />
          </button>
        )}
      </div>

      {item.image_url && mode === 'view' && (
        <div className={s.cover} style={{ backgroundImage: `url(${item.image_url})` }} />
      )}

      {mode === 'view' && item.description && (
        <p className={`${s.notes} selectable`}>{item.description}</p>
      )}

      {mode === 'edit' && (
        <>
          <div className={f.group} style={{ marginTop: 14 }}>
            <input
              className={f.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Name"
              enterKeyHint="done"
            />
            <textarea
              className={f.input}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes — optional"
            />
          </div>
          <span className={f.label}>Cover</span>
          <GiphyPicker value={cover} onChange={setCover} titleHint={() => title} />
          <div className={f.row}>
            <button
              type="button"
              className={`${f.btn} ${f.ghost}`}
              onClick={() => setMode('view')}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`${f.btn} ${f.accent}`}
              onClick={() => void saveEdits()}
            >
              Save
            </button>
          </div>
        </>
      )}

      {mode === 'when' && (
        <>
          <DayPicker
            className={f.picker}
            mode="single"
            required
            selected={parseISO(date)}
            defaultMonth={parseISO(date)}
            onSelect={(d) => {
              if (!d) return;
              const next = iso(d);
              setDate(next);
              if (end && end <= next) setEnd(null);
            }}
          />

          <span className={f.label}>
            Time <span className={f.hint}>— leave blank for all day</span>
          </span>
          <div className={f.group}>
            <input
              className={f.input}
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>

          <span className={f.label}>
            Ends <span className={f.hint}>— for something that runs over days</span>
          </span>
          <div className={f.group}>
            <input
              className={f.input}
              type="date"
              value={end ?? ''}
              min={date}
              onChange={(e) => setEnd(e.target.value || null)}
            />
          </div>

          <div className={f.row}>
            <button
              type="button"
              className={`${f.btn} ${f.ghost}`}
              onClick={() => setMode('view')}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`${f.btn} ${f.accent}`}
              onClick={() => void saveWhen()}
            >
              Save
            </button>
          </div>
        </>
      )}

      {mode === 'confirmDelete' && (
        <div className={s.confirm}>
          <p className={s.confirmText}>
            Delete “{item.title}”? This removes it for both of you.
          </p>
          <div className={f.row} style={{ marginTop: 0 }}>
            <button
              type="button"
              className={`${f.btn} ${f.ghost}`}
              onClick={() => setMode('view')}
            >
              Keep it
            </button>
            <button
              type="button"
              className={`${f.btn} ${f.danger}`}
              onClick={() => {
                void remove(item.id);
                close();
                toast('Deleted');
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {mode === 'view' && (
        <div className={s.actions}>
          <button type="button" className={s.action} onClick={() => setMode('when')}>
            <CalendarPlusIcon />
            {planned ? 'Change the date' : 'Put it on the calendar'}
          </button>

          {planned && (
            <button type="button" className={s.action} onClick={() => void toBucket()}>
              <BucketIcon />
              Back to the bucket list
            </button>
          )}

          <button
            type="button"
            className={`${s.action} ${s.destructive}`}
            onClick={() => setMode('confirmDelete')}
          >
            <TrashIcon />
            Delete
          </button>
        </div>
      )}

      {mode === 'view' && history.length > 0 && (
        <>
          <span className={s.historyHead}>History</span>
          {history.map((l) => (
            <div key={l.id} className={s.entry}>
              <span
                className={s.who}
                style={{ background: faceColor(l.user_id === '1' ? 1 : 0) }}
                aria-hidden
              >
                {(partnerName(config, l.user_id)[0] ?? '?').toUpperCase()}
              </span>
              <span className={s.what}>
                {partnerName(config, l.user_id)} {l.details}{' '}
                <span className={s.ago}>· {timeAgo(l.timestamp)}</span>
              </span>
            </div>
          ))}
        </>
      )}
    </Sheet>
  );
}
