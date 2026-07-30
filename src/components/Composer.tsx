import { useEffect, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import Sheet from './Sheet';
import GiphyPicker from './GiphyPicker';
import { useApp } from '../lib/store';
import { addDays, iso, nextSaturday, parseISO, pretty } from '../lib/date';
import f from './Form.module.css';

/* Still one form and still one nullable column underneath, but which of
   the two you're making was decided before this opened. In bucket mode
   there is no date control at all — the simplest way to stop someone
   wondering what happens if they leave it blank. */
export default function Composer() {
  const mode = useApp((st) => st.composerMode);
  const close = useApp((st) => st.closeComposer);
  const create = useApp((st) => st.create);
  const toast = useApp((st) => st.toast);
  const picked = useApp((st) => st.picked);
  const setPicked = useApp((st) => st.setPicked);
  const setScreen = useApp((st) => st.setScreen);
  const setCursor = useApp((st) => st.setCursor);

  const isPlan = mode === 'plan';

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [cover, setCover] = useState<string | null>(null);
  const [date, setDate] = useState<string>(picked);
  const [time, setTime] = useState('');
  const [end, setEnd] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!mode) return;
    setTitle('');
    setNotes('');
    setCover(null);
    // A plan opens on the day you were already looking at.
    setDate(picked);
    setTime('');
    setEnd(null);
    setPickerOpen(false);
    setSaving(false);
  }, [mode, picked]);

  const quick: Array<[string, string]> = [
    ['Today', addDays(0)],
    ['Tomorrow', addDays(1)],
    ['This weekend', nextSaturday()],
  ];

  async function save() {
    const clean = title.trim();
    if (!clean) {
      toast('Give it a name');
      return;
    }
    setSaving(true);
    const dateTime = isPlan ? (time ? `${date}T${time}` : date) : null;
    // An end that isn't after the start isn't a span, it's a typo.
    const span = isPlan && end && end > date ? (time ? `${end}T${time}` : end) : null;
    try {
      await create({
        title: clean,
        description: notes.trim() || null,
        image_url: cover,
        date_time: dateTime,
        ends_at: span,
      });
      close();
      if (isPlan) {
        setPicked(date);
        const d = parseISO(date);
        setCursor(iso(new Date(d.getFullYear(), d.getMonth(), 1)));
        setScreen('calendar');
      } else {
        setScreen('bucket');
      }
      toast(isPlan ? 'It’s on the calendar' : 'Added to your bucket list');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={mode !== null}
      onClose={close}
      heading={isPlan ? 'New plan' : 'New bucket-list idea'}
    >
      <span className={f.label} style={{ marginTop: 14 }}>
        {isPlan ? 'Plan' : 'Idea'}
      </span>
      <div className={f.group}>
        <input
          className={f.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={isPlan ? 'Dinner at Alma' : 'Kayak the Grand River'}
          autoComplete="off"
          enterKeyHint="done"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
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

      {isPlan && (
        <>
          <span className={f.label}>When</span>
          <div className={f.chips}>
            {quick.map(([label, value]) => (
              <button
                key={label}
                type="button"
                className={`${f.chip} ${date === value && !pickerOpen ? f.chipOn : ''}`}
                onClick={() => {
                  setDate(value);
                  setPickerOpen(false);
                }}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className={`${f.chip} ${pickerOpen ? f.chipNeutralOn : ''}`}
              onClick={() => setPickerOpen((v) => !v)}
            >
              {pickerOpen ? 'Done' : 'Another day…'}
            </button>
          </div>

          {pickerOpen && (
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
          )}

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

          {/* Tucked below the time, because most plans are one day and
              this shouldn't be the second thing you have to think about. */}
          <span className={f.label}>
            Ends <span className={f.hint}>— only if it runs over days</span>
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

          <p className={f.rowNote} style={{ marginTop: 12 }}>
            {end && end > date
              ? `${longDate(date)} – ${longDate(end)}`
              : `${longDate(date)}${time ? ` at ${pretty(time)}` : ', all day'}`}
          </p>
        </>
      )}

      <span className={f.label}>
        Cover <span className={f.hint}>— optional</span>
      </span>
      <GiphyPicker value={cover} onChange={setCover} titleHint={() => title} />

      <div className={f.row}>
        <button type="button" className={`${f.btn} ${f.ghost}`} onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className={`${f.btn} ${f.accent}`}
          onClick={() => void save()}
          disabled={saving}
        >
          {isPlan ? 'Add plan' : 'Add idea'}
        </button>
      </div>
    </Sheet>
  );
}

function longDate(dateISO: string): string {
  return parseISO(dateISO).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}
