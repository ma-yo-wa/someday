import { motion } from 'motion/react';
import { useApp, isMatched, type Screen } from '../lib/store';
import s from './TabBar.module.css';

/* Outlined when idle, solid when selected. Without labels the icon is
   doing all the work, so the selected state has to be unmistakable —
   hence a fill and a pill behind it, not just a colour change. */
function CalendarIcon({ on }: { on: boolean }) {
  return on ? (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1.1A4 4 0 0 1 21 8v1H3V8a4 4 0 0 1 3-3.9V3a1 1 0 0 1 1-1Z" />
      <path d="M3 11h18v6a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-6Z" fillOpacity="0.55" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="4" />
      <path d="M3 10h18M8 3v3M16 3v3" strokeLinecap="round" />
    </svg>
  );
}

function BucketIcon({ on }: { on: boolean }) {
  return on ? (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3.6 5.5A1 1 0 0 1 4.6 4h14.8a1 1 0 0 1 1 1.2l-2 12.3A3 3 0 0 1 15.4 20H8.6a3 3 0 0 1-3-2.5l-2-12ZM9 9.4a1 1 0 1 0-1.4 1.4l2.6 2.6a1 1 0 0 0 1.5 0l4.6-4.7A1 1 0 0 0 15 7.3l-3.9 3.9L9 9.4Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path
        d="M4.6 5h14.8l-2 12.3A3 3 0 0 1 14.4 20H9.6a3 3 0 0 1-3-2.7L4.6 5Z"
        strokeLinejoin="round"
      />
      <path d="m8.6 10.6 2.4 2.4 4.4-4.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* TEMPORARY — flipped off to demo the update banner. Set back to true. */
const SHOW_ADD: boolean = false;

export default function TabBar() {
  const screen = useApp((st) => st.screen);
  const setScreen = useApp((st) => st.setScreen);
  const setAddOpen = useApp((st) => st.setAddOpen);
  const matched = useApp((st) => isMatched(st.space));

  const tab = (id: Screen, label: string, icon: (on: boolean) => React.ReactNode) => {
    const on = screen === id;
    return (
      <button
        type="button"
        className={`${s.tab} ${on ? s.on : ''}`}
        onClick={() => setScreen(id)}
        aria-current={on ? 'page' : undefined}
        aria-label={label}
      >
        {/* The pill travels between tabs instead of appearing and
            disappearing, which is what makes two icons read as one
            control rather than two buttons. */}
        {on && (
          <motion.span
            layoutId="tab-pill"
            className={s.pill}
            transition={{ type: 'spring', stiffness: 480, damping: 38 }}
          />
        )}
        <span className={s.icon}>{icon(on)}</span>
      </button>
    );
  };

  return (
    <nav className={s.dock}>
      <div className={s.inner}>
        {tab('calendar', 'Plans', (on) => <CalendarIcon on={on} />)}
        {tab('bucket', 'Bucket List', (on) => <BucketIcon on={on} />)}
      </div>

      {/* Hidden until the space has two people — create is a shared act. */}
      {SHOW_ADD && matched && (
        <motion.button
          type="button"
          className={s.make}
          onClick={() => setAddOpen(true)}
          whileTap={{ scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 600, damping: 30 }}
          aria-label="Add something"
        >
          <span className={s.plus} aria-hidden />
        </motion.button>
      )}
    </nav>
  );
}
