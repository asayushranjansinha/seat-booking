'use client';

import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { SessionJson } from '@/api/types';
import { Editor } from '@/ui/Editor';
import { Login } from '@/ui/Login';

export default function Page() {
  const [session, setSession] = useState<SessionJson | null>(null);
  const [checking, setChecking] = useState(true);

  // The access token lives in memory, so a reload restores the session from the
  // httpOnly refresh cookie rather than from anything a script could have read.
  useEffect(() => {
    api.refresh().then((s) => {
      setSession(s);
      setChecking(false);
    });
  }, []);

  if (checking) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--muted)' }}>Loading...</div>;
  }
  if (!session) return <Login onSignedIn={setSession} />;
  return (
    <Editor
      session={session}
      onSignOut={async () => {
        await api.logout();
        setSession(null);
      }}
    />
  );
}
