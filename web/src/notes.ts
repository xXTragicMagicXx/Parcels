import { createStore, del, entries, get, set, setMany } from "idb-keyval";

export interface ParcelNote {
  uid: string;
  county: string;
  pid: string;
  label: string; // address or owner, for the list
  lon: number;
  lat: number;
  starred: boolean;
  note: string;
  updated: string; // ISO timestamp
}

const store = createStore("idaho-parcels", "notes");
type Listener = () => void;
const listeners = new Set<Listener>();

export function onNotesChange(fn: Listener): void {
  listeners.add(fn);
}
function emit() {
  listeners.forEach((fn) => fn());
}

export async function allNotes(): Promise<ParcelNote[]> {
  const rows = await entries<string, ParcelNote>(store);
  return rows.map(([, v]) => v).sort((a, b) => b.updated.localeCompare(a.updated));
}

export function getNote(uid: string): Promise<ParcelNote | undefined> {
  return get<ParcelNote>(uid, store);
}

/** Save, or delete when the parcel is neither starred nor has a note. */
export async function saveNote(n: ParcelNote): Promise<void> {
  if (!n.starred && !n.note.trim()) await del(n.uid, store);
  else await set(n.uid, { ...n, updated: new Date().toISOString() }, store);
  emit();
}

export async function starredUids(): Promise<string[]> {
  return (await allNotes()).filter((n) => n.starred).map((n) => n.uid);
}

export async function exportNotes(): Promise<Blob> {
  const notes = await allNotes();
  const body = { app: "idaho-parcels", version: 1, exported: new Date().toISOString(), notes };
  return new Blob([JSON.stringify(body, null, 1)], { type: "application/json" });
}

/** Merge a backup: for each parcel the most recently updated copy wins. */
export async function importNotes(file: File): Promise<number> {
  const data = JSON.parse(await file.text());
  if (data?.app !== "idaho-parcels" || !Array.isArray(data.notes)) {
    throw new Error("This file is not an Idaho Parcels notes backup.");
  }
  const current = new Map((await allNotes()).map((n) => [n.uid, n]));
  const updates: [string, ParcelNote][] = [];
  for (const n of data.notes as ParcelNote[]) {
    if (typeof n?.uid !== "string" || typeof n.updated !== "string") continue;
    const mine = current.get(n.uid);
    if (!mine || mine.updated < n.updated) updates.push([n.uid, n]);
  }
  await setMany(updates, store);
  emit();
  return updates.length;
}
