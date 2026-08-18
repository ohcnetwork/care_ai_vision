const BLOOD_GROUP_BY_NOTATION: Record<string, string> = {
  "A+": "A_positive",
  "A-": "A_negative",
  "B+": "B_positive",
  "B-": "B_negative",
  "AB+": "AB_positive",
  "AB-": "AB_negative",
  "O+": "O_positive",
  "O-": "O_negative",
};

export function normalizeBloodGroup(value?: string): string | undefined {
  if (!value) return undefined;
  const compact = value.trim().replace(/\s+/g, "");
  const fromNotation = BLOOD_GROUP_BY_NOTATION[compact.toUpperCase()];
  if (fromNotation) return fromNotation;

  const named = compact.match(/^(AB|A|B|O)_(positive|negative)$/i);
  if (named) return `${named[1].toUpperCase()}_${named[2].toLowerCase()}`;

  if (compact.toLowerCase() === "unknown" || compact.toUpperCase() === "UNK") {
    return "unknown";
  }
  return undefined;
}

export const BLOOD_GROUP_MAP = BLOOD_GROUP_BY_NOTATION;

export function normalizePhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/[^+\d]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+91${digits}`;
  return `+91${digits}`;
}

export function normalizeIsoDate(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function normalizePincode(value?: string | number): number | undefined {
  if (value == null || value === "") return undefined;
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return undefined;
  return Number(digits);
}

const HIGHLIGHT_CLASS = "ocr-field-highlight";

export function highlightElement(el: HTMLElement | null | undefined): void {
  if (!el) return;

  el.classList.remove(HIGHLIGHT_CLASS);
  void el.offsetWidth;
  el.classList.add(HIGHLIGHT_CLASS);
  el.scrollIntoView({ behavior: "smooth", block: "center" });

  setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), 1200);
}

export function highlightField(field: string): void {
  highlightElement(
    document.querySelector<HTMLElement>(`[name="${CSS.escape(field)}"]`),
  );
}

type LabHighlightDef = {
  title?: string;
  code?: { code?: string; display?: string };
  component?: { code: { code: string; display?: string } }[];
};

export function highlightLabObservation(
  definition: LabHighlightDef,
  kind: "value" | "unit",
  componentCode?: string,
): void {
  const heading =
    definition.title || definition.code?.display || definition.code?.code;
  if (!heading) return;

  const headingLabel = [...document.querySelectorAll("label")].find(
    (label) => label.textContent?.trim() === heading,
  );
  const card = headingLabel?.closest(".rounded-lg") as HTMLElement | null;
  if (!card) return;

  let scope: ParentNode = card;
  if (componentCode) {
    const comp = definition.component?.find(
      (c) => c.code.code === componentCode,
    );
    const name = comp?.code.display || comp?.code.code || componentCode;
    const compLabel = [...card.querySelectorAll("label")].find((label) =>
      (label.textContent || "").includes(name),
    );
    if (compLabel?.parentElement) scope = compLabel.parentElement;
  }

  highlightElement(
    kind === "unit"
      ? scope.querySelector<HTMLElement>('[role="combobox"]')
      : scope.querySelector<HTMLElement>("input"),
  );
}
