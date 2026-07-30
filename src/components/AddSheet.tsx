import Sheet from './Sheet';
import { useApp } from '../lib/store';
import s from './AddSheet.module.css';

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
    </svg>
  );
}

function PlanGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="4" />
      <path d="M3 10h18M8 3v3M16 3v3" strokeLinecap="round" />
      <circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BucketGlyph() {
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

/* Asks the one question the app is built around, in words, instead of
   leaving it to be inferred from whether a date field got filled in. */
export default function AddSheet() {
  const open = useApp((st) => st.addOpen);
  const setOpen = useApp((st) => st.setAddOpen);
  const openComposer = useApp((st) => st.openComposer);

  return (
    <Sheet open={open} onClose={() => setOpen(false)}>
      <div className={s.head}>
        <h3 className={s.title}>Add to your space</h3>
        <button
          type="button"
          className={s.close}
          onClick={() => setOpen(false)}
          aria-label="Close"
        >
          <CloseIcon />
        </button>
      </div>

      <button type="button" className={s.option} onClick={() => openComposer('plan')}>
        <span className={s.glyph}>
          <PlanGlyph />
        </span>
        <span>
          <span className={s.optionTitle}>A plan</span>
          <span className={s.optionNote}>Something you’re doing on a day.</span>
        </span>
      </button>

      <button type="button" className={s.option} onClick={() => openComposer('bucket')}>
        <span className={s.glyph}>
          <BucketGlyph />
        </span>
        <span>
          <span className={s.optionTitle}>A bucket-list idea</span>
          <span className={s.optionNote}>
            Something you want to do, with no date yet.
          </span>
        </span>
      </button>
    </Sheet>
  );
}
