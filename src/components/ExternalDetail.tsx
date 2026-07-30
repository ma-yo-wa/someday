import Sheet from './Sheet';
import { useApp } from '../lib/store';
import { artFor } from '../lib/art';
import { faceColor } from '../lib/tint';
import { formatRange } from '../lib/date';
import s from './ExternalDetail.module.css';

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="4" y="10" width="16" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
    </svg>
  );
}

/* Read-only by construction. There is no edit, no delete, no "turn this
   into a plan" — the calendar it came from owns it, and the one thing
   this sheet must never do is imply otherwise. */
export default function ExternalDetail() {
  const externalId = useApp((st) => st.externalId);
  const external = useApp((st) => st.external);
  const config = useApp((st) => st.config);
  const openExternal = useApp((st) => st.openExternal);

  const event = external.find((e) => e.id === externalId) ?? null;
  const owner = event && event.ownerId === '1' ? 1 : 0;
  const isMine = owner === config.me;
  const ownerName = isMine ? 'You' : (config.names[owner] ?? 'Your partner');
  const possessive = isMine ? 'your' : `${ownerName}’s`;

  return (
    <Sheet open={!!event} onClose={() => openExternal(null)}>
      {event && (
        <div className={s.body}>
          <div className={s.head}>
            <span className={s.glyph} aria-hidden>
              {artFor(event.title)}
            </span>
            <div>
              <h3 className={s.title}>{event.title ?? 'Busy'}</h3>
              <div className={s.range}>
                {formatRange(event.startsAt, event.endsAt, event.allDay)}
              </div>
            </div>
          </div>

          <div className={s.rows}>
            <div className={s.row}>
              <span
                className={s.avatar}
                style={{ background: faceColor(owner) }}
                aria-hidden
              >
                {(config.names[owner]?.[0] ?? '?').toUpperCase()}
              </span>
              <span>
                {ownerName}
                {event.calendar ? ` · ${event.calendar}` : ''}
              </span>
            </div>
            <div className={s.row}>
              <LockIcon />
              <span>
                {event.title
                  ? 'From a connected calendar. Read-only here.'
                  : 'Shared as busy only — the title stays private.'}
              </span>
            </div>
          </div>

          <p className={s.foot}>
            Imported events aren’t plans. They sit on the calendar so you can see
            what’s already taken, and nothing here changes {possessive} calendar.
          </p>
        </div>
      )}
    </Sheet>
  );
}
