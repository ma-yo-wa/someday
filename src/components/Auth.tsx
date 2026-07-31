import { useState } from 'react';
import { motion } from 'motion/react';
import { signInWithPassword, signUpWithPassword } from '../lib/auth';
import f from './Form.module.css';
import s from './Auth.module.css';

interface Props {
  onSignedIn: () => void | Promise<void>;
  /** Shown when she arrived via invite before signing in. */
  inviterHint?: string | null;
}

export default function Auth({ onSignedIn, inviterHint }: Props) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const clean = email.trim();
    if (!clean || !clean.includes('@')) {
      setError('That doesn’t look like an email');
      return;
    }
    if (mode === 'signup' && !name.trim()) {
      setError('Add your name — it shows on your avatar');
      return;
    }
    if (password.length < 6) {
      setError('Password needs at least 6 characters');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') await signUpWithPassword(clean, password, name);
      else await signInWithPassword(clean, password);
      await onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t sign in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.wrap}>
      <h1 className={s.brand}>Someday</h1>
      <p className={s.lead}>
        {inviterHint
          ? `${inviterHint} wants to share a space with you — sign in to join`
          : 'A shared calendar and bucket list for two'}
      </p>

      <div className={`${f.segmented} ${s.modes}`} role="tablist" aria-label="Account">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signin'}
          className={`${f.segment} ${mode === 'signin' ? f.segmentOn : ''}`}
          onClick={() => {
            setMode('signin');
            setError(null);
          }}
        >
          {mode === 'signin' && (
            <motion.span
              layoutId="auth-mode-knob"
              className={f.segmentKnob}
              transition={{ type: 'spring', stiffness: 520, damping: 38 }}
            />
          )}
          <span className={f.segmentLabel}>Sign in</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signup'}
          className={`${f.segment} ${mode === 'signup' ? f.segmentOn : ''}`}
          onClick={() => {
            setMode('signup');
            setError(null);
          }}
        >
          {mode === 'signup' && (
            <motion.span
              layoutId="auth-mode-knob"
              className={f.segmentKnob}
              transition={{ type: 'spring', stiffness: 520, damping: 38 }}
            />
          )}
          <span className={f.segmentLabel}>Create account</span>
        </button>
      </div>

      {mode === 'signup' && (
        <>
          <span className={f.label}>Your name</span>
          <div className={f.group}>
            <input
              className={f.input}
              type="text"
              autoComplete="name"
              autoCapitalize="words"
              placeholder="Mayowa"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </>
      )}

      <span className={f.label}>Email</span>
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
        />
      </div>

      <span className={f.label}>Password</span>
      <div className={f.group}>
        <input
          className={f.input}
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
      </div>

      <div className={f.row}>
        <button
          type="button"
          className={`${f.btn} ${f.accent}`}
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy
            ? '…'
            : mode === 'signup'
              ? 'Create account'
              : 'Sign in'}
        </button>
      </div>

      <p className={s.note}>
        Stays in the app — no email codes, no browser bounce.
      </p>

      {error && <p className={s.error}>{error}</p>}
    </div>
  );
}
