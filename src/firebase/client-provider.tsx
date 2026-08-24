'use client';

import React, { useEffect, useState, type ReactNode } from 'react';
import { FirebaseProvider } from '@/firebase/provider';
import { initializeFirebase } from '@/firebase';
import { signInAnonymously } from 'firebase/auth';

interface FirebaseClientProviderProps {
  children: ReactNode;
}

export function FirebaseClientProvider({ children }: FirebaseClientProviderProps) {
  const [firebaseServices, setFirebaseServices] = useState<ReturnType<typeof initializeFirebase> | null>(null);

  useEffect(() => {
    const services = initializeFirebase();
    setFirebaseServices(services);

    if (!services.auth.currentUser) {
      signInAnonymously(services.auth)
        .then(() => {
          console.log("Authenticated anonymously");
        })
        .catch((error) => {
          console.error("Authentication error:", error);
        });
    }
  }, []);

  if (!firebaseServices) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">
        Connecting to secure services...
      </div>
    );
  }

  return (
    <FirebaseProvider
      firebaseApp={firebaseServices.firebaseApp}
      auth={firebaseServices.auth}
      firestore={firebaseServices.firestore}
      database={firebaseServices.database}
    >
      {children}
    </FirebaseProvider>
  );
}
