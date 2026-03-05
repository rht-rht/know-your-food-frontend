import { doc, getDoc, updateDoc, increment } from "firebase/firestore";
import { getDbInstance } from "./firebase";

const ANON_CREDITS_KEY = "kyf-anon-credits";
const ANON_DATE_KEY = "kyf-anon-date";
const ANON_DAILY_LIMIT = 3;

export const CREDIT_COST_TEXT = 1;
export const CREDIT_COST_MEDIA = 2;
export const SIGNUP_BONUS = 10;
export const DAILY_LOGIN_BONUS = 2;
export const SHARE_REWARD = 1;
export const SHARE_DAILY_MAX = 5;
export const REWARDED_AD_CREDITS = 2;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getDailyCount(key: string): number {
  if (typeof window === "undefined") return 0;
  const dateKey = `${key}-date`;
  if (localStorage.getItem(dateKey) !== todayStr()) {
    localStorage.setItem(dateKey, todayStr());
    localStorage.setItem(key, "0");
    return 0;
  }
  return parseInt(localStorage.getItem(key) || "0", 10);
}

function incrementDailyCount(key: string): void {
  const dateKey = `${key}-date`;
  localStorage.setItem(dateKey, todayStr());
  const current = getDailyCount(key);
  localStorage.setItem(key, String(current + 1));
}

// --- Anonymous credit tracking (localStorage) ---

export function getAnonCreditsUsed(): number {
  return getDailyCount(ANON_CREDITS_KEY);
}

export function getAnonCreditsRemaining(): number {
  return Math.max(0, ANON_DAILY_LIMIT - getAnonCreditsUsed());
}

export function consumeAnonCredit(): boolean {
  const used = getAnonCreditsUsed();
  if (used >= ANON_DAILY_LIMIT) return false;
  incrementDailyCount(ANON_CREDITS_KEY);
  return true;
}

// --- Signed-in credit tracking (Firestore) ---

export async function getUserCredits(uid: string): Promise<number> {
  const db = getDbInstance();
  if (!db) return 0;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? (snap.data().credits ?? 0) : 0;
}

export async function consumeUserCredits(uid: string, amount: number): Promise<boolean> {
  const db = getDbInstance();
  if (!db) return false;
  const credits = await getUserCredits(uid);
  if (credits < amount) return false;
  await updateDoc(doc(db, "users", uid), { credits: increment(-amount) });
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
  await addUserCredits(uid, DAILY_LOGIN_BONUS);
  return true;
}

// --- Rewarded ad credits ---

export async function claimRewardedAdCredit(uid: string): Promise<number> {
  return await addUserCredits(uid, REWARDED_AD_CREDITS);
}

// --- Share-to-earn ---

const SHARE_COUNT_KEY = "kyf-share-count";

export function getSharesToday(): number {
  return getDailyCount(SHARE_COUNT_KEY);
}

export function canShareForCredit(): boolean {
  return getSharesToday() < SHARE_DAILY_MAX;
}

export async function claimShareCredit(uid: string, resultId: string): Promise<boolean> {
  const perResultKey = `kyf-shared-${resultId}`;
  if (localStorage.getItem(perResultKey)) return false;
  if (!canShareForCredit()) return false;
  localStorage.setItem(perResultKey, "1");
  incrementDailyCount(SHARE_COUNT_KEY);
  await addUserCredits(uid, SHARE_REWARD);
  return true;
}
