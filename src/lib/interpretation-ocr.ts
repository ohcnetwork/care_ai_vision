import { runMedispeakOcr, type MedispeakFieldSpec } from "@/lib/ocr/medispeak";

export interface InterpretationTarget {
  code: { code: string; display?: string };
  definitionSlug: string;
}

export interface InterpretationFinding {
  name: string;
  ref_min?: string;
  ref_max?: string;
  componentCode: string;
  definitionSlug: string;
}

function componentAlias(code: string, index: number): string {
  const slug = code
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);
  return slug || `c${index}`;
}

function asOptionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}

export async function extractInterpretationFindings(
  files: File | File[],
  facilityId: string | null | undefined,
  targets: InterpretationTarget[],
): Promise<InterpretationFinding[]> {
  if (!targets.length) {
    throw new Error("Select an observation definition first");
  }

  const specs: MedispeakFieldSpec[] = [];
  // Keyed by definitionSlug + component code, since the same code can appear
  // in more than one observation definition (e.g. a standalone test and a
  // panel that both measure the same analyte).
  const keyMap: Record<string, string> = {};
  const used = new Set<string>();

  targets.forEach((target, index) => {
    let alias = componentAlias(target.code.code, index);
    if (used.has(alias)) alias = `${alias}_${index}`;
    used.add(alias);
    const name = target.code.display || target.code.code;
    const minKey = `${alias}_min`;
    const maxKey = `${alias}_max`;
    const targetKey = `${target.definitionSlug}::${target.code.code}`;
    keyMap[minKey] = targetKey;
    keyMap[maxKey] = targetKey;
    specs.push({
      key: minKey,
      label: `${name} reference range minimum`,
      type: "string",
      description: `Lower bound of the printed reference range for ${name}. Empty if not shown.`,
    });
    specs.push({
      key: maxKey,
      label: `${name} reference range maximum`,
      type: "string",
      description: `Upper bound of the printed reference range for ${name}. Empty if not shown.`,
    });
  });

  const result = await runMedispeakOcr(files, { facilityId, fields: specs });

  const byKey = new Map<string, InterpretationFinding>();
  for (const target of targets) {
    byKey.set(`${target.definitionSlug}::${target.code.code}`, {
      name: target.code.display || target.code.code,
      componentCode: target.code.code,
      definitionSlug: target.definitionSlug,
    });
  }

  for (const [key, raw] of Object.entries(result)) {
    const targetKey = keyMap[key];
    const finding = targetKey ? byKey.get(targetKey) : undefined;
    if (!finding) continue;
    const value = asOptionalString(raw);
    if (!value) continue;
    if (key.endsWith("_min")) finding.ref_min = value;
    if (key.endsWith("_max")) finding.ref_max = value;
  }

  return [...byKey.values()];
}
