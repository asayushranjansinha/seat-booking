'use client';

import { Building2, Eye, EyeOff, Loader2, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { DemoAccountJson, SessionJson } from '@/api/types';
import { SignInArt } from '@/components/SignInArt';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** What each role can do, for the one-line description beside a name. */
const WHAT_THEY_DO: Record<DemoAccountJson['role'], string> = {
  ADMIN: 'draws the building',
  MANAGER: 'books whole tables and cabins',
  USER: 'books a seat',
};

/** The three seat states, named once here and on the canvas. */
const LEGEND = [
  { label: 'Available', token: 'var(--seat-free)' },
  { label: 'Booked', token: 'var(--seat-booked)' },
  { label: 'Yours', token: 'var(--seat-mine)' },
];

/**
 * Sign in.
 *
 * <p>Split so the form keeps a narrow, quiet column and the floor plan carries the
 * product: someone arriving here has usually been sent a link and does not yet know what
 * this is. The plan is drawn with the same seat tokens the canvas uses, so green, red and
 * blue already mean something by the time the workspace opens.
 */
export function SignIn({ onSignedIn }: { onSignedIn: (session: SessionJson) => void }) {
  const [email, setEmail] = useState('admin@demo.test');
  const [password, setPassword] = useState('password');
  const [showPassword, setShowPassword] = useState(false);
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
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      {/* ---------------------------------------------------------------- form */}
      <div className="flex flex-col px-6 py-8 sm:px-10 lg:px-14 xl:px-20">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-md bg-primary/10 text-primary">
            <Building2 className="size-4.5" />
          </div>
          <span className="text-sm font-semibold tracking-tight">Parametric Seat Booking</span>
        </div>

        <div className="flex flex-1 items-center py-12">
          <div className="mx-auto w-full max-w-sm lg:mx-0">
            <h1 className="text-2xl font-semibold tracking-tight">Sign in to your workspace</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Plan a floor, or book a seat on one.
            </p>

            <form onSubmit={submit} className="mt-8 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Work email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-10"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-10 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  {error}
                </p>
              )}

              <Button type="submit" className="h-10 w-full" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Sign in
              </Button>
            </form>

            {accounts.length > 0 && (
              <section className="mt-10">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-xs font-medium text-muted-foreground">Sign in as</h2>
                  <p className="text-xs text-muted-foreground">
                    password{' '}
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                      password
                    </code>
                  </p>
                </div>

                <div className="mt-2 max-h-64 divide-y divide-border overflow-y-auto rounded-lg border">
                  {accounts.map((account) => (
                    <button
                      key={account.email}
                      type="button"
                      // Fills the password too. With eleven people to try, retyping the
                      // same word each time is the part that makes switching tedious.
                      onClick={() => { setEmail(account.email); setPassword('password'); }}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {account.displayName}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">
                          {account.email}
                        </span>
                      </span>
                      <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                        {WHAT_THEY_DO[account.role]}
                      </span>
                      <Badge variant="outline" className="shrink-0 text-[10px] tracking-wide">
                        {account.role}
                      </Badge>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Bookings open 6 days ahead, 6 hours at a time.
        </p>
      </div>

      {/* --------------------------------------------------------- floor plan */}
      <aside className="relative hidden flex-col justify-center overflow-hidden border-l bg-canvas px-14 lg:flex">
        <div className="max-w-xl">
          <SignInArt />

          <h2 className="mt-12 text-xl font-semibold tracking-tight text-balance">
            Draw the building, then book a seat in it.
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Rooms, tables and seats of any shape. Move a table and its seats come with it,
            because every seat is placed relative to the one it belongs to.
          </p>

          <ul className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2">
            {LEGEND.map((item) => (
              <li key={item.label} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  aria-hidden
                  className="size-2.5 rounded-[3px]"
                  style={{ backgroundColor: item.token }}
                />
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </main>
  );
}
