import {
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
  doc,
  updateDoc,
  increment,
} from "firebase/firestore";
import { getDbInstance } from "./firebase";

export interface FirestoreHistoryItem {
  id?: string;
  inputText: string;
  inputType: "text" | "url" | "audio" | "image";
  result: any;
  grade: string;
  createdAt: any;
}

export async function saveAnalysisToFirestore(
  uid: string,
  inputText: string,
  inputType: "text" | "url" | "audio" | "image",
  result: any,
  grade: string
) {
  const db = getDbInstance();
  if (!db) return;

  const historyRef = collection(db, "users", uid, "history");
  await addDoc(historyRef, {
    inputText: inputText.slice(0, 500),
    inputType,
    result,
    grade,
    createdAt: serverTimestamp(),
  });

  const userRef = doc(db, "users", uid);
  await updateDoc(userRef, { totalAnalyses: increment(1) });
}

export async function getFirestoreHistory(uid: string): Promise<FirestoreHistoryItem[]> {
  const db = getDbInstance();
  if (!db) return [];

  const historyRef = collection(db, "users", uid, "history");
  const q = query(historyRef, orderBy("createdAt", "desc"), limit(50));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as FirestoreHistoryItem));
}
