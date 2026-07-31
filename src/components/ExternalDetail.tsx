import Sheet from './Sheet';
import { useApp } from '../lib/store';
import { artFor } from '../lib/art';
import { faceColor } from '../lib/tint';
import { formatRange } from '../lib/date';
import s from './ExternalDetail.module.css';

function resolveOwner(
  ownerId: string,
  me: 0 | 1,
  myId: string | undefined,
): 0 | 1 {
  if (ownerId === '0' || ownerId === '1') return ownerId === '1' ? 1 : 0;
  if (myId && ownerId === myId) return me;
  return (1 - me) as 0 | 1;
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="4" y="10" width="16" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path
        d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11z"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.2" />
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

  const space = useApp((st) => st.space);
  const event = external.find((e) => e.id === externalId) ?? null;
  const owner = event
    ? resolveOwner(event.ownerId, space?.me ?? config.me, space?.myId)
    : config.me;
  const isMine = owner === (space?.me ?? config.me);
  const ownerName = isMine
    ? 'You'
    : (space?.partnerName ?? config.names[owner] ?? 'Them');
  const possessive = isMine ? 'your' : `${ownerName}’s`;
  const initial = (
    (isMine ? space?.myName : space?.partnerName) ??
    config.names[owner] ??
    '?'
  )
    .trim()
    .charAt(0)
    .toUpperCase() || '?';

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
                {initial}
              </span>
              <span>
                {ownerName}
                {event.calendar ? ` · ${event.calendar}` : ''}
              </span>
            </div>
            {event.location && (
              <div className={s.row}>
                <PinIcon />
                <span className={s.place}>{event.location}</span>
              </div>
            )}
            <div className={s.row}>
              <LockIcon />
              <span>
                {event.title
                  ? `From ${possessive} calendar — not a shared plan`
                  : 'Busy only — the title stays private'}
              </span>
            </div>
          </div>

          <p className={s.foot}>
            Imported events aren’t plans — they just show what’s already on{' '}
            {possessive} calendar
          </p>
        </div>
      )}
    </Sheet>
  );
}
