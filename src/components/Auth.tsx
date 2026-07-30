import { useState } from 'react';
import { sendCode, verifyCode } from '../lib/auth';
import f from './Form.module.css';
import s from './Auth.module.css';

interface Props {
  onSignedIn: () => void;
  /** Shown when she arrived via invite before signing in. */
  inviterHint?: string | null;
}

export default function Auth({ onSignedIn, inviterHint }: Props) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode() {
    const clean = email.trim();
    if (!clean || !clean.includes('@')) {
      setError('That doesn’t look like an email');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendCode(clean);
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t send a code');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (code.trim().length < 6) {
      setError('Enter the six-digit code');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifyCode(email, code);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code didn’t work');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.wrap}>
      <h1 className={s.brand}>Someday</h1>
      <p className={s.lead}>
        {inviterHint
          ? `${inviterHint} wants to share a space with you. Sign in to join.`
          : 'A shared calendar and bucket list for two.'}
      </p>

      {step === 'email' ? (
        <>
          <span className={f.label}>Your email</span>
          <div className={f.group}>
            <input
              className={f.input}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void requestCode();
              }}
            />
          </div>
          <div className={f.row}>
            <button
              type="button"
              className={`${f.btn} ${f.accent}`}
              disabled={busy}
              onClick={() => void requestCode()}
            >
              {busy ? 'Sending…' : 'Send a code'}
            </button>
          </div>
          <p className={s.note}>
            No password. We’ll email you a six-digit code that stays inside
            the app.
          </p>
        </>
      ) : (
        <>
          <span className={f.label}>Code sent to {email}</span>
          <div className={f.group}>
            <input
              className={f.input}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void confirm();
              }}
            />
          </div>
          <div className={f.row}>
            <button
              type="button"
              className={`${f.btn} ${f.accent}`}
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </div>
          <button
            type="button"
            className={s.back}
            onClick={() => {
              setStep('email');
              setCode('');
              setError(null);
            }}
          >
            Use a different email
          </button>
        </>
      )}

      {error && <p className={s.error}>{error}</p>}
    </div>
  );
}
