import { useEffect, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import Sheet from './Sheet';
import CoverPicker from './CoverPicker';
import CoverArt from './CoverArt';
import { useApp, partnerName, isMatched } from '../lib/store';
import { isPlan } from '../lib/types';
import { artFor } from '../lib/art';
import { faceColor, faceIndexFor } from '../lib/tint';
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

function SuggestIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path
        d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H12l-4 3v-3H7.5A2.5 2.5 0 0 1 5 13.5v-7Z"
        strokeLinejoin="round"
      />
      <path d="M9 9h6M9 12h3.5" strokeLinecap="round" />
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

type Mode = 'view' | 'edit' | 'when' | 'suggest' | 'confirmDelete';

function sameWhen(
  a: string | null,
  b: string | null,
  aEnd: string | null,
  bEnd: string | null,
): boolean {
  return a === b && (aEnd ?? null) === (bEnd ?? null);
}

export default function Detail() {
  const detailId = useApp((st) => st.detailId);
  const activities = useApp((st) => st.activities);
  const logs = useApp((st) => st.logs);
  const config = useApp((st) => st.config);
  const openDetail = useApp((st) => st.openDetail);
  const patch = useApp((st) => st.patch);
  const remove = useApp((st) => st.remove);
  const suggestWhen = useApp((st) => st.suggestWhen);
  const acceptSuggestion = useApp((st) => st.acceptSuggestion);
  const dismissSuggestion = useApp((st) => st.dismissSuggestion);
  const toast = useApp((st) => st.toast);
  const setPicked = useApp((st) => st.setPicked);
  const setCursor = useApp((st) => st.setCursor);
  const space = useApp((st) => st.space);

  const item = activities.find((a) => a.id === detailId) ?? null;
  const faceCtx = { me: space?.me ?? config.me, myId: space?.myId };
  const myId = space?.myId ?? String(config.me);

  const [mode, setMode] = useState<Mode>('view');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [cover, setCover] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState('');
  const [end, setEnd] = useState<string | null>(null);
  const [suggestNote, setSuggestNote] = useState('');
  const [busy, setBusy] = useState(false);

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
    setSuggestNote('');
    setBusy(false);
  }, [detailId, item]);

  if (!item) return <Sheet open={false} onClose={() => openDetail(null)} children={null} />;

  const planned = isPlan(item);
  const matched = isMatched(space);
  const pending = Boolean(item.suggested_date_time && item.suggested_by);
  const minePending = pending && item.suggested_by === myId;
  const history = logs
    .filter((l) => l.activity_id === item.id)
    .slice()
    .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));

  const close = () => openDetail(null);

  function openSuggest() {
    const row = item!;
    const from = row.suggested_date_time ?? row.date_time;
    setDate(dtDate(from) ?? todayISO());
    setTime(dtTime(from) ?? '');
    setEnd(dtDate(row.suggested_ends_at ?? row.ends_at));
    setSuggestNote('');
    setMode('suggest');
  }

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

  async function saveSuggest() {
    const row = item!;
    const dateTime = time ? `${date}T${time}` : date;
    const span = end && end > date ? (time ? `${end}T${time}` : end) : null;
    if (sameWhen(dateTime, row.date_time, span, row.ends_at)) {
      toast('That’s already the date — change it, or leave a reason in a note');
      return;
    }
    if (
      row.suggested_date_time &&
      sameWhen(dateTime, row.suggested_date_time, span, row.suggested_ends_at)
    ) {
      toast('That’s already the suggestion');
      return;
    }
    setBusy(true);
    try {
      await suggestWhen(row.id, {
        date_time: dateTime,
        ends_at: span,
        note: suggestNote.trim() || null,
      });
      setMode('view');
      toast('Suggested');
    } catch {
      /* toast already shown */
    } finally {
      setBusy(false);
    }
  }

  async function onAccept() {
    const row = item!;
    setBusy(true);
    try {
      const day = dtDate(row.suggested_date_time);
      await acceptSuggestion(row.id);
      if (day) {
        setPicked(day);
        const d = parseISO(day);
        setCursor(iso(new Date(d.getFullYear(), d.getMonth(), 1)));
      }
      toast('Locked in');
    } catch {
      /* toast already shown */
    } finally {
      setBusy(false);
    }
  }

  async function onDismiss() {
    const row = item!;
    const mine = row.suggested_by === myId;
    setBusy(true);
    try {
      await dismissSuggestion(row.id);
      toast(mine ? 'Cancelled' : 'Dismissed');
    } catch {
      /* toast already shown */
    } finally {
      setBusy(false);
    }
  }

  async function toBucket() {
    await patch(item!.id, { date_time: null, ends_at: null });
    toast('Back on the bucket list');
    close();
  }

  const suggestedLabel =
    item.suggested_date_time &&
    describePlan(item.suggested_date_time, item.suggested_ends_at);

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
        <CoverArt url={item.image_url} size="hero" className={s.cover} />
      )}

      {mode === 'view' && item.description && (
        <p className={`${s.notes} selectable`}>{item.description}</p>
      )}

      {mode === 'view' && pending && item.suggested_date_time && (
        <div className={s.suggestCard}>
          <div className={s.suggestWho}>
            <span
              className={s.who}
              style={{
                background: faceColor(faceIndexFor(item.suggested_by!, faceCtx)),
              }}
              aria-hidden
            >
              {(partnerName(config, item.suggested_by!)[0] ?? '?').toUpperCase()}
            </span>
            <span>
              {minePending
                ? 'You suggested'
                : `${partnerName(config, item.suggested_by!)} suggests`}{' '}
              <strong>{suggestedLabel}</strong>
            </span>
          </div>
          {item.suggested_note && (
            <p className={s.suggestNote}>{item.suggested_note}</p>
          )}
          <div className={s.suggestActions}>
            {minePending ? (
              <button
                type="button"
                className={`${f.btn} ${f.ghost}`}
                disabled={busy}
                onClick={() => void onDismiss()}
              >
                Cancel
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={`${f.btn} ${f.accent}`}
                  disabled={busy}
                  onClick={() => void onAccept()}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className={`${f.btn} ${f.ghost}`}
                  disabled={busy}
                  onClick={() => void onDismiss()}
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  className={`${f.btn} ${f.ghost}`}
                  disabled={busy}
                  onClick={openSuggest}
                >
                  Suggest something else
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {mode === 'edit' && (
        <>
          <span className={f.label} style={{ marginTop: 14 }}>
            Name
          </span>
          <div className={f.group}>
            <input
              className={f.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Name"
              enterKeyHint="done"
            />
          </div>
          <span className={f.label}>
            Notes <span className={f.hint}>— optional</span>
          </span>
          <div className={f.group}>
            <textarea
              className={f.input}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering"
              rows={3}
            />
          </div>
          <span className={f.label}>Cover</span>
          <CoverPicker value={cover} onChange={setCover} titleHint={() => title} />
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

      {(mode === 'when' || mode === 'suggest') && (
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

          {mode === 'suggest' && (
            <>
              <span className={f.label}>
                Why <span className={f.hint}>— optional, but helpful</span>
              </span>
              <div className={f.group}>
                <textarea
                  className={f.input}
                  value={suggestNote}
                  onChange={(e) => setSuggestNote(e.target.value)}
                  placeholder="I’m free that afternoon…"
                  rows={2}
                />
              </div>
            </>
          )}

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
              disabled={busy}
              onClick={() => void (mode === 'suggest' ? saveSuggest() : saveWhen())}
            >
              {mode === 'suggest' ? 'Suggest' : 'Save'}
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

          {matched && (
            <button type="button" className={s.action} onClick={openSuggest}>
              <SuggestIcon />
              Suggest a date
            </button>
          )}

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
                style={{ background: faceColor(faceIndexFor(l.user_id, faceCtx)) }}
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
