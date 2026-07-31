import { motion } from 'motion/react';
import { useApp } from '../lib/store';
import { faceColor } from '../lib/tint';
import { MONTHS, iso, parseISO, todayISO } from '../lib/date';
import s from './NavBar.module.css';

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
      <path
        d={dir === 'left' ? 'M15 5 8 12l7 7' : 'M9 5l7 7-7 7'}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* Two bar styles, because iOS has two and uses them for different things:
   a list gets a large title that collapses as you scroll it, and a fixed
   view like a month grid gets a compact bar. Using the large title
   everywhere is the most common way this ends up looking almost-native
   rather than native. */
export default function NavBar() {
  const screen = useApp((st) => st.screen);
  const config = useApp((st) => st.config);
  const live = useApp((st) => st.live);
  const liveLabel = useApp((st) => st.liveLabel);
  const backendName = useApp((st) => st.backendName);
  const navScroll = useApp((st) => st.navScroll);
  const cursor = useApp((st) => st.cursor);
  const setCursor = useApp((st) => st.setCursor);
  const setPicked = useApp((st) => st.setPicked);
  const setSettingsOpen = useApp((st) => st.setSettingsOpen);
  const space = useApp((st) => st.space);

  const cursorDate = parseISO(cursor);
  const isCalendar = screen === 'calendar';
  // Two seats = you + partner. Until they join, the open seat is "+"
  // (invite) — not a fake "You" avatar from the old demo defaults.
  const seatEmpty = !!space && !space.partner2Id;
  const me = space?.me ?? config.me;
  const labelFor = (i: 0 | 1) => {
    if (space) {
      if (i === space.me) return space.myName;
      return space.partnerName ?? '';
    }
    return config.names[i] ?? '';
  };

  const monthLabel = `${MONTHS[cursorDate.getMonth()]}${
    cursorDate.getFullYear() === new Date().getFullYear()
      ? ''
      : ` ${cursorDate.getFullYear()}`
  }`;
  const title = isCalendar ? monthLabel : 'Bucket List';

  /* The large title hands off to the compact one over ~22px of travel,
     which is roughly where iOS makes the swap. A compact bar has no
     handoff to do — its title is always up. */
  const t = isCalendar ? 1 : Math.min(1, Math.max(0, (navScroll - 4) / 22));
  const collapsed = t > 0.5;
  // The glass only appears once there's something behind it to blur.
  const scrolled = navScroll > 2;

  const now = new Date();
  const offCurrentMonth =
    cursorDate.getMonth() !== now.getMonth() ||
    cursorDate.getFullYear() !== now.getFullYear();

  const shiftMonth = (delta: number) =>
    setCursor(iso(new Date(cursorDate.getFullYear(), cursorDate.getMonth() + delta, 1)));

  const goToday = () => {
    setPicked(todayISO());
    setCursor(iso(new Date(now.getFullYear(), now.getMonth(), 1)));
  };

  return (
    <header className={s.nav}>
      <div className={`${s.material} ${scrolled ? s.materialOn : ''}`} />

      <div className={s.bar}>
        <div className={s.leading}>
          <button
            type="button"
            className={s.who}
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
          >
            {([0, 1] as const).map((i) => {
              const empty = seatEmpty && i !== me;
              const label = labelFor(i);
              return (
                <span
                  key={i}
                  className={`${s.face} ${empty ? s.empty : ''} ${
                    !empty && me !== i ? s.dim : ''
                  }`}
                  style={empty ? undefined : { background: faceColor(i) }}
                >
                  {empty ? '+' : (label[0] ?? '?').toUpperCase()}
                </span>
              );
            })}
            <span
              className={`${s.bulb} ${live ? s.bulbOn : ''} ${
                !live && backendName === 'supabase' ? s.bulbWait : ''
              }`}
              aria-hidden
            />
            <span className="vh">{liveLabel}</span>
            {!live && backendName === 'supabase' && (
              <span className={s.liveHint} aria-live="polite">
                {liveLabel}
              </span>
            )}
          </button>
        </div>

        <motion.div
          className={s.compactTitle}
          animate={{ opacity: t, y: (1 - t) * 8 }}
          transition={{ duration: 0.16, ease: [0.25, 0.1, 0.25, 1] }}
          aria-hidden={!collapsed}
        >
          {title}
        </motion.div>

        <div className={s.trailing}>
          {isCalendar && (
            <>
              {/* Contextual: there's no point offering "Today" while you're
                  already looking at today's month. */}
              {offCurrentMonth && (
                <button type="button" className={s.todayPill} onClick={goToday}>
                  Today
                </button>
              )}
              <button
                type="button"
                className={s.action}
                onClick={() => shiftMonth(-1)}
                aria-label="Previous month"
              >
                <Chevron dir="left" />
              </button>
              <button
                type="button"
                className={s.action}
                onClick={() => shiftMonth(1)}
                aria-label="Next month"
              >
                <Chevron dir="right" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Fades and lifts in place rather than collapsing its box: an
          animated height here would drag the whole screen up and down
          under the user's finger while they scroll. */}
      {!isCalendar && (
        <motion.div
          className={s.large}
          animate={{ opacity: 1 - t, y: -10 * t }}
          initial={false}
          transition={{ duration: 0.16, ease: [0.25, 0.1, 0.25, 1] }}
          aria-hidden={collapsed}
        >
          <h1 className={s.largeTitle}>{title}</h1>
        </motion.div>
      )}
    </header>
  );
}
