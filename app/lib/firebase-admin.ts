import { initializeApp, cert, App } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

let adminApp: App | null = null;

function getAdminApp(): App | null {
  if (adminApp) return adminApp;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!projectId || !saJson) return null;
  try {
    const credential = cert(JSON.parse(saJson) as object);
    adminApp = initializeApp({ credential, projectId });
    return adminApp;
  } catch {
    return null;
  }
}

export function getAdminDb() {
  const app = getAdminApp();
  if (!app) return null;
  return getFirestore(app);
}

export async function addCreditsToUser(uid: string, amount: number): Promise<boolean> {
  const db = getAdminDb();
  if (!db) return false;
  const ref = db.collection("users").doc(uid);
  try {
    await ref.update({ credits: FieldValue.increment(amount) });
    return true;
  } catch {
    try {
      await ref.set({ credits: amount }, { merge: true });
      return true;
    } catch {
      return false;
    }
  }
}
