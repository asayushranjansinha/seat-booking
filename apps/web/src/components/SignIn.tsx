'use client';

import { Building2, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { DemoAccountJson, SessionJson } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** What each role can do, for the one-line description beside a name. */
const WHAT_THEY_DO: Record<DemoAccountJson['role'], string> = {
  ADMIN: 'draws the building',
  MANAGER: 'books whole tables and cabins',
  USER: 'books a seat',
};

export function SignIn({ onSignedIn }: { onSignedIn: (session: SessionJson) => void }) {
  const [email, setEmail] = useState('admin@demo.test');
  const [password, setPassword] = useState('password');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Fetched rather than hard-coded: the page listed three accounts in markup, so adding
  // people to the demo left them invisible to the person trying to sign in as one.
  const [accounts, setAccounts] = useState<DemoAccountJson[]>([]);

  useEffect(() => { void api.demoAccounts().then(setAccounts); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.login(email, password));
    } catch {
      // The API answers identically for a wrong password and an unknown account, so this
      // message must not claim to know which it was.
      setError('That email and password did not match.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5 text-center">
          <Building2 className="mx-auto size-7 text-primary" />
          <h1 className="text-xl font-semibold">Parametric Seat Booking</h1>
          <p className="text-sm text-muted-foreground">Draw the building, then book a seat in it.</p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-xl border bg-card p-6">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="username" value={email}
              onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Sign in
          </Button>
        </form>

        {accounts.length > 0 && (
          <div className="space-y-1 rounded-xl border border-dashed p-4">
            <p className="pb-1 text-xs font-medium text-muted-foreground">
              Demo accounts — password <code className="rounded bg-muted px-1 py-0.5">password</code>
            </p>
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {accounts.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  // Fills the password too. With eleven people to try, retyping the same
                  // word each time is the part that makes switching accounts tedious.
                  onClick={() => { setEmail(account.email); setPassword('password'); }}
                  className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent"
                >
                  <span className="font-medium">{account.displayName}</span>
                  <span className="text-muted-foreground">{WHAT_THEY_DO[account.role]}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                    {account.email}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
