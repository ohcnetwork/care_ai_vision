import { atomWithStorage, createJSONStorage } from "jotai/utils";

const STORAGE_KEY_PREFIX = "care_ai_vision.enabled";

export function aiVisionEnabledAtomFor(userId: string) {
  return atomWithStorage<boolean>(
    `${STORAGE_KEY_PREFIX}.${userId}`,
    false,
    createJSONStorage(() => localStorage),
  );
}
