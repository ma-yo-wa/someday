import { useState } from 'react';
import Sheet from './Sheet';
import { inviteUrl } from '../lib/auth';
import { useApp } from '../lib/store';
import f from './Form.module.css';

interface Props {
  open: boolean;
  code: string;
  onClose: () => void;
}

export default function InviteShare({ open, code, onClose }: Props) {
  const create = useApp((st) => st.create);
  const toast = useApp((st) => st.toast);
  const [first, setFirst] = useState('');
  const [busy, setBusy] = useState(false);
  const link = inviteUrl(code);

  async function share() {
    setBusy(true);
    try {
      const idea = first.trim();
      if (idea) {
        await create({
          title: idea,
          description: null,
          date_time: null,
          ends_at: null,
        });
      }

      const text = idea
        ? `I added “${idea}” to a space for us — join here: ${link}`
        : `Join me on Someday: ${link}\nOr enter this code: ${code}`;

      if (navigator.share) {
        await navigator.share({ title: 'Someday', text, url: link });
      } else {
        await navigator.clipboard.writeText(text);
        toast('Invite copied');
      }
      onClose();
    } catch (err) {
      // User cancelled the share sheet — not an error.
      if (err instanceof Error && err.name === 'AbortError') return;
      toast(err instanceof Error ? err.message : 'Couldn’t share');
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      toast('Code copied');
    } catch {
      toast(code);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} heading="Invite someone">
      <p className={f.rowNote} style={{ marginTop: 8 }}>
        They get their own login, then land in this space with you. Send a link,
        or read them the code.
      </p>

      <span className={f.label}>
        One thing you want to do{' '}
        <span className={f.hint}>— optional, but nicer than an empty space</span>
      </span>
      <div className={f.group}>
        <input
          className={f.input}
          value={first}
          onChange={(e) => setFirst(e.target.value)}
          placeholder="Kayak the Grand River"
          enterKeyHint="done"
        />
      </div>

      <span className={f.label}>Invite code</span>
      <div className={f.group}>
        <button type="button" className={f.listRow} onClick={() => void copyCode()}>
          <span className={f.rowLabel} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {code}
          </span>
          <span className={f.hint}>Tap to copy</span>
        </button>
      </div>

      <div className={f.row}>
        <button type="button" className={`${f.btn} ${f.ghost}`} onClick={onClose}>
          Later
        </button>
        <button
          type="button"
          className={`${f.btn} ${f.accent}`}
          disabled={busy}
          onClick={() => void share()}
        >
          {busy ? '…' : 'Share invite'}
        </button>
      </div>
    </Sheet>
  );
}
