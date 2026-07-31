import { useEffect, useMemo, useState } from 'react';
import Sheet from './Sheet';
import type { GoogleCalendar } from '../lib/gcal';
import f from './Form.module.css';
import s from './GcalPicker.module.css';

interface Props {
  open: boolean;
  calendars: GoogleCalendar[];
  selectedId: string | null;
  busy?: boolean;
  onClose: () => void;
  onPick: (cal: GoogleCalendar) => void;
}

function CalIcon() {
  return (
    <svg className={s.icon} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 10h17M8 3.5v3.5M16 3.5v3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export default function GcalPicker({
  open,
  calendars,
  selectedId,
  busy,
  onClose,
  onPick,
}: Props) {
  const [pending, setPending] = useState<string | null>(selectedId);

  useEffect(() => {
    if (open) setPending(selectedId);
  }, [open, selectedId]);

  const sections = useMemo(() => {
    const mine = calendars.filter((c) => c.accessRole === 'owner' || c.primary);
    const other = calendars.filter((c) => !(c.accessRole === 'owner' || c.primary));
    const out: { label: string; items: GoogleCalendar[] }[] = [];
    if (mine.length) out.push({ label: 'My calendars', items: mine });
    if (other.length) out.push({ label: 'Other', items: other });
    return out;
  }, [calendars]);

  const chosen =
    calendars.find((c) => c.id === (pending ?? selectedId)) ?? null;

  return (
    <Sheet open={open} onClose={onClose} heading="Import calendars" stacked>
      <p className={s.lead}>Choose one of your calendars to overlay — yours, not a shared plan</p>

      {sections.map((sec) => (
        <div key={sec.label} className={s.section}>
          <span className={s.sectionLabel}>{sec.label}</span>
          <div className={s.list}>
            {sec.items.map((cal) => {
              const on = (pending ?? selectedId) === cal.id;
              return (
                <button
                  key={cal.id}
                  type="button"
                  className={s.row}
                  disabled={busy}
                  onClick={() => setPending(cal.id)}
                  aria-pressed={on}
                >
                  <CalIcon />
                  <span className={s.name}>
                    {cal.summary}
                    {cal.primary ? ' · Primary' : ''}
                  </span>
                  <span className={`${s.radio} ${on ? s.radioOn : ''}`} aria-hidden />
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className={s.actions}>
        <button type="button" className={`${f.btn} ${f.ghost}`} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={`${f.btn} ${f.accent}`}
          disabled={busy || !chosen}
          onClick={() => {
            if (chosen) onPick(chosen);
          }}
        >
          {busy ? 'Importing…' : 'Import'}
        </button>
      </div>
    </Sheet>
  );
}
