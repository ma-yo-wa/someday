import { useEffect, useState } from 'react';
import Sheet from './Sheet';
import {
  clearInviteFromUrl,
  joinInvite,
  peekInvite,
  type InvitePeek,
} from '../lib/auth';
import f from './Form.module.css';

interface Props {
  code: string;
  open: boolean;
  onJoined: () => void;
  onDismiss: () => void;
}

export default function InviteAccept({ code, open, onJoined, onDismiss }: Props) {
  const [peek, setPeek] = useState<InvitePeek | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsChoice, setNeedsChoice] = useState(false);

  useEffect(() => {
    if (!open || !code) return;
    let cancelled = false;
    setError(null);
    setPeek(null);
    void peekInvite(code)
      .then((p) => {
        if (cancelled) return;
        if (!p) {
          setError('That invite isn’t valid. Ask for a fresh link.');
          return;
        }
        setPeek(p);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Couldn’t look up that invite');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, code]);

  async function accept(bringItems: boolean) {
    setBusy(true);
    setError(null);
    try {
      await joinInvite(code, bringItems);
      clearInviteFromUrl();
      onJoined();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Couldn’t join';
      if (/already have a space/i.test(msg)) {
        setNeedsChoice(true);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        clearInviteFromUrl();
        onDismiss();
      }}
      heading={peek ? `${peek.inviterName} invited you` : 'Join a space'}
    >
      {!needsChoice && (
        <>
          <p className={f.rowNote} style={{ marginTop: 8 }}>
            {peek?.isOpen === false
              ? 'This invite is already full'
              : peek
                ? `You’ll share a calendar and a bucket list with ${peek.inviterName}`
                : 'Looking up the invite…'}
          </p>
          <div className={f.row}>
            <button
              type="button"
              className={`${f.btn} ${f.ghost}`}
              onClick={() => {
                clearInviteFromUrl();
                onDismiss();
              }}
            >
              Not now
            </button>
            <button
              type="button"
              className={`${f.btn} ${f.accent}`}
              disabled={busy || !peek?.isOpen}
              onClick={() => void accept(false)}
            >
              {busy ? 'Joining…' : 'Join'}
            </button>
          </div>
        </>
      )}

      {needsChoice && (
        <>
          <p className={f.rowNote} style={{ marginTop: 8 }}>
            You already have things in your own space. Join {peek?.inviterName}’s
            and bring them with you, or leave them behind.
          </p>
          <div className={f.row}>
            <button
              type="button"
              className={`${f.btn} ${f.ghost}`}
              disabled={busy}
              onClick={() => void accept(false)}
            >
              Leave them
            </button>
            <button
              type="button"
              className={`${f.btn} ${f.accent}`}
              disabled={busy}
              onClick={() => void accept(true)}
            >
              Bring them
            </button>
          </div>
        </>
      )}

      {error && (
        <p className={f.rowNote} style={{ color: 'var(--rose-ink)', marginTop: 12 }}>
          {error}
        </p>
      )}
    </Sheet>
  );
}
