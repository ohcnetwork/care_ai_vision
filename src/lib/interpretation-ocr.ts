import { runMedispeakOcr, type MedispeakFieldSpec } from "@/lib/ocr/medispeak";

export interface InterpretationTarget {
  code: { code: string; display?: string };
  definitionSlug: string;
}

export interface InterpretationFinding {
  name: string;
  ref_min?: string;
  ref_max?: string;
  // Present only when the printout shows separate ranges by sex.
  ref_min_male?: string;
  ref_max_male?: string;
  ref_min_female?: string;
  ref_max_female?: string;
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
    const targetKey = `${target.definitionSlug}::${target.code.code}`;

    const field = (key: string, label: string, description: string): void => {
      keyMap[key] = targetKey;
      specs.push({ key, label, type: "string", description });
    };

    field(
      `${alias}_min`,
      `${name} reference range minimum`,
      `Lower bound of the printed reference range for ${name}. Empty if not shown, or if the report only prints separate male/female ranges.`,
    );
    field(
      `${alias}_max`,
      `${name} reference range maximum`,
      `Upper bound of the printed reference range for ${name}. Empty if not shown, or if the report only prints separate male/female ranges.`,
    );
    // Some analytes (e.g. haemoglobin, creatinine) print two ranges labelled
    // by sex instead of one shared range — request both, only populated when
    // the report actually splits them out.
    field(
      `${alias}_min_male`,
      `${name} male reference range minimum`,
      `Lower bound of the male-specific reference range for ${name}, if the report prints separate ranges by sex. Empty otherwise.`,
    );
    field(
      `${alias}_max_male`,
      `${name} male reference range maximum`,
      `Upper bound of the male-specific reference range for ${name}, if the report prints separate ranges by sex. Empty otherwise.`,
    );
    field(
      `${alias}_min_female`,
      `${name} female reference range minimum`,
      `Lower bound of the female-specific reference range for ${name}, if the report prints separate ranges by sex. Empty otherwise.`,
    );
    field(
      `${alias}_max_female`,
      `${name} female reference range maximum`,
      `Upper bound of the female-specific reference range for ${name}, if the report prints separate ranges by sex. Empty otherwise.`,
    );
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
    // Check the sex-specific suffixes first — they're longer and would
    // otherwise also match the generic "_min"/"_max" checks.
    if (key.endsWith("_min_male")) finding.ref_min_male = value;
    else if (key.endsWith("_max_male")) finding.ref_max_male = value;
    else if (key.endsWith("_min_female")) finding.ref_min_female = value;
    else if (key.endsWith("_max_female")) finding.ref_max_female = value;
    else if (key.endsWith("_min")) finding.ref_min = value;
    else if (key.endsWith("_max")) finding.ref_max = value;
  }

  return [...byKey.values()];
}
