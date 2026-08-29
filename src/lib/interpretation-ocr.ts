import { runMedispeakOcr, type MedispeakFieldSpec } from "@/lib/ocr/medispeak";

export interface InterpretationFinding {
  name: string;
  ref_min?: string;
  ref_max?: string;
  componentCode: string;
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
  components: { code: { code: string; display?: string } }[],
): Promise<InterpretationFinding[]> {
  if (!components.length) {
    throw new Error("Select an observation definition first");
  }

  const specs: MedispeakFieldSpec[] = [];
  const keyMap: Record<string, string> = {};
  const used = new Set<string>();

  components.forEach((component, index) => {
    let alias = componentAlias(component.code.code, index);
    if (used.has(alias)) alias = `${alias}_${index}`;
    used.add(alias);
    const name = component.code.display || component.code.code;
    const minKey = `${alias}_min`;
    const maxKey = `${alias}_max`;
    keyMap[minKey] = component.code.code;
    keyMap[maxKey] = component.code.code;
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

  const byCode = new Map<string, InterpretationFinding>();
  for (const component of components) {
    byCode.set(component.code.code, {
      name: component.code.display || component.code.code,
      componentCode: component.code.code,
    });
  }

  for (const [key, raw] of Object.entries(result)) {
    const code = keyMap[key];
    const finding = code ? byCode.get(code) : undefined;
    if (!finding) continue;
    const value = asOptionalString(raw);
    if (!value) continue;
    if (key.endsWith("_min")) finding.ref_min = value;
    if (key.endsWith("_max")) finding.ref_max = value;
  }

  return [...byCode.values()];
}
