'use client';

import { useState } from 'react';
import { api } from '@/api/client';
import type { SessionJson } from '@/api/types';

export function Login({ onSignedIn }: { onSignedIn: (session: SessionJson) => void }) {
  const [email, setEmail] = useState('admin@demo.test');
  const [password, setPassword] = useState('password');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.login(email, password));
    } catch {
      // The API deliberately gives the same answer for a wrong password and an unknown
      // account, so this message must not claim to know which it was.
      setError('That email and password did not match.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
      <form
        onSubmit={submit}
        style={{
          width: 340,
          padding: 24,
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          display: 'grid',
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ margin: '0 0 2px', fontSize: 18 }}>Parametric Seat Booking</h1>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 12 }}>Sign in to open the layout editor.</p>
        </div>
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        {error && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</div>}
        <button data-variant="primary" disabled={busy} type="submit">
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
        <div style={{ color: 'var(--muted)', fontSize: 11, lineHeight: 1.6 }}>
          Demo accounts, password <code>password</code>:
          <br />
          admin@demo.test &middot; manager@demo.test &middot; user@demo.test
        </div>
      </form>
    </div>
  );
}
