"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { getAuthInstance, getDbInstance, googleProvider, isConfigured } from "../lib/firebase";
import { SIGNUP_BONUS } from "../lib/credits";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  credits: number;
  firebaseReady: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshCredits: () => Promise<void>;
  setCredits: (c: number) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  credits: 0,
  firebaseReady: false,
  signInWithGoogle: async () => {},
  signOut: async () => {},
  refreshCredits: async () => {},
  setCredits: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [credits, setCredits] = useState(0);

  const firebaseReady = isConfigured;

  async function ensureUserDoc(u: User) {
    const db = getDbInstance();
    if (!db) return;
    const ref = doc(db, "users", u.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        displayName: u.displayName || "",
        email: u.email || "",
        photoURL: u.photoURL || "",
        credits: SIGNUP_BONUS,
        totalAnalyses: 0,
        createdAt: serverTimestamp(),
      });
      setCredits(SIGNUP_BONUS);
    } else {
      setCredits(snap.data().credits ?? 0);
    }
  }

  async function refreshCredits() {
    const db = getDbInstance();
    if (!user || !db) return;
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      setCredits(snap.data().credits ?? 0);
    }
  }

  useEffect(() => {
    if (!firebaseReady) {
      setLoading(false);
      return;
    }

    const auth = getAuthInstance();
    if (!auth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          await ensureUserDoc(u);
        } catch (e) {
          console.error("Error ensuring user doc:", e);
        }
      } else {
        setCredits(0);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  async function signInWithGoogle() {
    const auth = getAuthInstance();
    if (!auth || !googleProvider) return;
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await ensureUserDoc(result.user);
    } catch (e: any) {
      if (e.code !== "auth/popup-closed-by-user") {
        console.error("Sign-in error:", e);
      }
    }
  }

  async function signOut() {
    const auth = getAuthInstance();
    if (!auth) return;
    await firebaseSignOut(auth);
    setUser(null);
    setCredits(0);
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, credits, firebaseReady, signInWithGoogle, signOut, refreshCredits, setCredits }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
