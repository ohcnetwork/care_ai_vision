import { atom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";

import { getHeaders } from "@/lib/request";

const STORAGE_KEY_PREFIX = "care_ai_vision.enabled";
const PREFERENCE_KEY = "care_ai_vision";
const PREFERENCE_VERSION = "1.0";

/**
 * Local atom backed by localStorage — used as fast cache.
 * The settings page syncs this with the server-side user preferences API.
 */
export function aiVisionEnabledAtomFor(userId: string) {
  return atomWithStorage<boolean>(
    `${STORAGE_KEY_PREFIX}.${userId}`,
    false,
    createJSONStorage(() => localStorage),
  );
}

/** Fetch the AI Vision preference from the server (via getcurrentuser). */
export async function fetchAiVisionPreference(): Promise<boolean> {
  try {
    const res = await fetch(
      new URL("/api/v1/users/getcurrentuser/", window.CARE_API_URL).toString(),
      { headers: getHeaders() },
    );
    if (!res.ok) return false;
    const data = await res.json();
    return data?.preferences?.[PREFERENCE_KEY]?.enabled === true;
  } catch {
    return false;
  }
}

/** Persist the AI Vision preference to the server. */
export async function setAiVisionPreference(enabled: boolean): Promise<void> {
  await fetch(
    new URL("/api/v1/users/set_preferences/", window.CARE_API_URL).toString(),
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        preference: PREFERENCE_KEY,
        version: PREFERENCE_VERSION,
        value: { enabled },
      }),
    },
  );
}

/** Atom that tracks whether we've already synced from server this session. */
export const preferencesSyncedAtom = atom(false);
