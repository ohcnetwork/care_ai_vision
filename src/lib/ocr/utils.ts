export const BLOOD_GROUP_MAP: Record<string, string> = {
  "A+": "A_POSITIVE",
  "A-": "A_NEGATIVE",
  "B+": "B_POSITIVE",
  "B-": "B_NEGATIVE",
  "AB+": "AB_POSITIVE",
  "AB-": "AB_NEGATIVE",
  "O+": "O_POSITIVE",
  "O-": "O_NEGATIVE",
};

export function normalizePhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/[^+\d]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+91${digits}`;
  return `+91${digits}`;
}

const HIGHLIGHT_CLASS = "ocr-field-highlight";

/** Pulses the form control named `field` (react-hook-form sets a matching
 * `name` attribute on the underlying input) so a direct fill is visible
 * without a separate results popover. No-ops if the field has no plain
 * input (e.g. Select/RadioInput controls don't expose a `name` attribute). */
export function highlightField(field: string): void {
  const el = document.querySelector<HTMLElement>(
    `[name="${CSS.escape(field)}"]`,
  );
  if (!el) return;

  el.classList.remove(HIGHLIGHT_CLASS);
  void el.offsetWidth;
  el.classList.add(HIGHLIGHT_CLASS);
  el.scrollIntoView({ behavior: "smooth", block: "center" });

  setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), 1200);
}
