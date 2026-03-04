import { doc, getDoc, updateDoc, increment } from "firebase/firestore";
import { getDbInstance } from "./firebase";

const ANON_CREDITS_KEY = "kyf-anon-credits";
const ANON_DATE_KEY = "kyf-anon-date";
const ANON_DAILY_LIMIT = 3;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// --- Anonymous credit tracking (localStorage) ---

export function getAnonCreditsUsed(): number {
  if (typeof window === "undefined") return 0;
  const stored = localStorage.getItem(ANON_DATE_KEY);
  if (stored !== todayStr()) {
    localStorage.setItem(ANON_DATE_KEY, todayStr());
    localStorage.setItem(ANON_CREDITS_KEY, "0");
    return 0;
  }
  return parseInt(localStorage.getItem(ANON_CREDITS_KEY) || "0", 10);
}

export function getAnonCreditsRemaining(): number {
  return Math.max(0, ANON_DAILY_LIMIT - getAnonCreditsUsed());
}

export function consumeAnonCredit(): boolean {
  const used = getAnonCreditsUsed();
  if (used >= ANON_DAILY_LIMIT) return false;
  localStorage.setItem(ANON_CREDITS_KEY, String(used + 1));
  return true;
}

// --- Signed-in credit tracking (Firestore) ---

export async function getUserCredits(uid: string): Promise<number> {
  const db = getDbInstance();
  if (!db) return 0;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? (snap.data().credits ?? 0) : 0;
}

export async function consumeUserCredit(uid: string): Promise<boolean> {
  const db = getDbInstance();
  if (!db) return false;
  const credits = await getUserCredits(uid);
  if (credits <= 0) return false;
  await updateDoc(doc(db, "users", uid), { credits: increment(-1) });
  return true;
}

export async function addUserCredits(uid: string, amount: number): Promise<number> {
  const db = getDbInstance();
  if (!db) return 0;
  await updateDoc(doc(db, "users", uid), { credits: increment(amount) });
  const newCredits = await getUserCredits(uid);
  return newCredits;
}

// --- Daily login bonus ---

const DAILY_BONUS_KEY = "kyf-daily-bonus";

export async function claimDailyBonus(uid: string): Promise<boolean> {
  const lastClaim = localStorage.getItem(DAILY_BONUS_KEY);
  if (lastClaim === todayStr()) return false;
  localStorage.setItem(DAILY_BONUS_KEY, todayStr());
  await addUserCredits(uid, 1);
  return true;
}

// --- Share-to-earn ---

export async function claimShareCredit(uid: string, resultId: string): Promise<boolean> {
  const key = `kyf-shared-${resultId}`;
  if (localStorage.getItem(key)) return false;
  localStorage.setItem(key, "1");
  await addUserCredits(uid, 1);
  return true;
}
