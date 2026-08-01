import { motion } from 'motion/react';
import CoverArt from '../components/CoverArt';
import { useApp, partnerName, isMatched } from '../lib/store';
import { isPlan, type ExternalEvent } from '../lib/types';
import { artFor } from '../lib/art';
import { faceColor, faceIndexFor } from '../lib/tint';
import {
  MONTHS,
  dtDate,
  dtTime,
  monthGrid,
  parseISO,
  prettyLower,
  relativeDay,
  spanDays,
  todayISO,
} from '../lib/date';
import s from './Calendar.module.css';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/* What a multi-day event means depends on which day you're standing on:
   it begins today, it ends today, or it simply covers today. */
function pillWhen(e: ExternalEvent, day: string): string {
  if (e.allDay) return 'All day';
  const startsToday = dtDate(e.startsAt) === day;
  const endsToday = dtDate(e.endsAt) === day;
  if (startsToday && endsToday) return prettyLower(dtTime(e.startsAt) as string);
  if (startsToday) return `From ${prettyLower(dtTime(e.startsAt) as string)}`;
  if (endsToday) return `Until ${prettyLower(dtTime(e.endsAt) as string)}`;
  return 'All day';
}

export default function Calendar() {
  const activities = useApp((st) => st.activities);
  const external = useApp((st) => st.external);
  const config = useApp((st) => st.config);
  const picked = useApp((st) => st.picked);
  const cursor = useApp((st) => st.cursor);
  const setPicked = useApp((st) => st.setPicked);
  const openDetail = useApp((st) => st.openDetail);
  const openExternal = useApp((st) => st.openExternal);
  const setInviteShareOpen = useApp((st) => st.setInviteShareOpen);
  const space = useApp((st) => st.space);

  const cursorDate = parseISO(cursor);
  const today = todayISO();
  const matched = isMatched(space);
  const other = matched ? space?.partnerName ?? null : null;

  const faceCtx = { me: space?.me ?? config.me, myId: space?.myId };
  const ownerIndex = (ownerId: string): 0 | 1 => faceIndexFor(ownerId, faceCtx);

  /* Plans land on every day they cover, so a trip reads as one run of
     days rather than a mark on the day you leave. */
  const plansByDate = new Map<string, typeof activities>();
  for (const a of activities) {
    if (!isPlan(a)) continue;
    const from = dtDate(a.date_time);
    if (!from) continue;
    const to = dtDate(a.ends_at) ?? from;
    for (const day of spanDays(from, to)) {
      plansByDate.set(day, [...(plansByDate.get(day) ?? []), a]);
    }
  }

  /* Imported events land on every day they touch, so a four-night hotel
     booking shows up across all four. */
  const extByDate = new Map<string, ExternalEvent[]>();
  for (const e of external) {
    for (const day of spanDays(e.startsAt, e.endsAt)) {
      extByDate.set(day, [...(extByDate.get(day) ?? []), e]);
    }
  }

  const dayPlans = (plansByDate.get(picked) ?? [])
    .slice()
    .sort((a, b) => (dtTime(a.date_time) ?? '99').localeCompare(dtTime(b.date_time) ?? '99'));
  const dayExternal = (extByDate.get(picked) ?? [])
    .slice()
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const pickedDate = parseISO(picked);
  const dayHeading =
    picked === today
      ? 'Today'
      : `${MONTHS[pickedDate.getMonth()]} ${pickedDate.getDate()}`;

  return (
    <div className={s.wrap}>
      <div className={s.dow}>
        {DOW.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>

      <div className={s.grid}>
        {monthGrid(cursorDate).map((cell, i) => {
          if (cell.outside || !cell.date) {
            return (
              <div key={i} className={`${s.day} ${s.outside}`}>
                <span className={s.num}>{cell.label}</span>
              </div>
            );
          }
          const date = cell.date;
          const mine = plansByDate.get(date) ?? [];
          const theirs = extByDate.get(date) ?? [];

          // A band is drawn for any imported event that spans more than
          // this one day, and it knows whether it's an end so the
          // corners round only where the run actually stops.
          const spanning = theirs.filter((e) => spanDays(e.startsAt, e.endsAt).length > 1);
          const startsHere = spanning.some((e) => dtDate(e.startsAt) === date);
          const endsHere = spanning.some((e) => dtDate(e.endsAt) === date);

          const classes = [s.day];
          if (date === picked) classes.push(s.picked);
          if (date === today) classes.push(s.isToday);

          const bandClasses = [s.band];
          if (startsHere && endsHere) bandClasses.push(s.bandOnly);
          else if (startsHere) bandClasses.push(s.bandStart);
          else if (endsHere) bandClasses.push(s.bandEnd);

          // Only on the day a thing begins. Repeating the hotel glyph
          // across all five nights just makes the month look busy; the
          // band is already saying "this is still going".
          const glyphs = [
            ...new Set(
              theirs.filter((e) => dtDate(e.startsAt) === date).map((e) => artFor(e.title)),
            ),
          ].slice(0, 2);

          return (
            <button
              key={i}
              type="button"
              className={classes.join(' ')}
              onClick={() => setPicked(date)}
            >
              {spanning.length > 0 && <span className={bandClasses.join(' ')} />}
              {glyphs.length > 0 && (
                <span className={s.glyphs} aria-hidden>
                  {glyphs.map((g, gi) => (
                    <span key={`${g}-${gi}`} className={s.glyphMark}>
                      {g}
                    </span>
                  ))}
                </span>
              )}
              <span className={s.num}>{cell.label}</span>
              <span className={s.marks}>
                {mine.slice(0, 3).map((p) => (
                  <i key={p.id} />
                ))}
                {theirs.slice(0, 2).map((e) => (
                  <i
                    key={e.id}
                    className={s.ext}
                    style={{ color: faceColor(ownerIndex(e.ownerId)) }}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {/* Imported events live on the calendar, not in the plans list. A
          work meeting isn't something you two decided to do, so it gets
          a strip of its own above the sheet rather than a card inside it. */}
      {dayExternal.length > 0 && (
        <div className={s.busy}>
          {dayExternal.map((e) => {
            const owner = ownerIndex(e.ownerId);
            return (
              <button
                key={e.id}
                type="button"
                className={s.busyPill}
                onClick={() => openExternal(e.id)}
              >
                <span aria-hidden>{artFor(e.title)}</span>
                <span className={s.busyWhen}>{pillWhen(e, picked)}</span>
                <span className={s.busyWho} style={{ background: faceColor(owner) }}>
                  {(config.names[owner]?.[0] ?? '?').toUpperCase()}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className={s.agenda}>
        <div className={s.grip} />
        <div className={s.dayLabel}>{dayHeading}</div>

        {!dayPlans.length ? (
          <div className={s.blank}>
            {matched ? (
              <p>
                {other
                  ? picked === today
                    ? `Nothing planned between you and ${other} today`
                    : `Nothing planned between you and ${other} this day`
                  : picked === today
                    ? 'Nothing planned today'
                    : 'Nothing planned this day'}
              </p>
            ) : (
              <>
                <p>Invite your person — Someday is for the two of you</p>
                <button type="button" onClick={() => setInviteShareOpen(true)}>
                  Invite
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            {dayPlans.map((a, i) => {
              const when = relativeDay(dtDate(a.date_time) ?? picked);
              const time = dtTime(a.date_time);
              const timing = time ? `${when} · ${prettyLower(time)}` : `${when} · All day`;
              return (
                <motion.button
                  key={a.id}
                  type="button"
                  className={s.entry}
                  onClick={() => openDetail(a.id)}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.4 }}
                >
                  {a.image_url ? (
                    <CoverArt url={a.image_url} size="thumb" className={s.thumb} />
                  ) : (
                    <span className={s.glyph} aria-hidden>
                      {artFor(a.title)}
                    </span>
                  )}
                  <span>
                    <span className={s.title}>{a.title}</span>
                    <div className={s.range}>{timing}</div>
                    {a.description && <div className={s.note}>{a.description}</div>}
                    <div className={s.meta}>
                      <span
                        className={s.avatar}
                        style={{
                          background: faceColor(faceIndexFor(a.created_by, faceCtx)),
                        }}
                      >
                        {(partnerName(config, a.created_by)[0] ?? '?').toUpperCase()}
                      </span>
                      {partnerName(config, a.created_by)}
                    </div>
                  </span>
                </motion.button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
