'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, setAuthFailureHandler } from '@/api/client';
import type { SessionJson } from '@/api/types';
import { SignIn } from '@/components/SignIn';
import { Workspace } from '@/components/Workspace';

export default function Page() {
  const [session, setSession] = useState<SessionJson | null>(null);
  const [checking, setChecking] = useState(true);

  // The access token lives in memory, so a reload restores the session from the httpOnly
  // refresh cookie rather than from anything a script on the page could have read.
  useEffect(() => {
    void api.refresh().then((s) => {
      setSession(s);
      setChecking(false);
    });
  }, []);

  // When the refresh token is finally spent or revoked there is nothing left to retry,
  // so drop back to sign-in rather than leaving a workspace that silently fails.
  useEffect(() => {
    setAuthFailureHandler(() => setSession(null));
    return () => setAuthFailureHandler(null);
  }, []);

  if (checking) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!session) return <SignIn onSignedIn={setSession} />;
  return (
    <Workspace
      session={session}
      onSignOut={async () => {
        await api.logout();
        setSession(null);
      }}
    />
  );
}
