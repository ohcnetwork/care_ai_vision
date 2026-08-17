import { MedispeakFieldSpec, runMedispeakOcr } from "./medispeak";
import { ExtractedData } from "./types";

/** Field schema matching `ExtractedData`, extracted via Medispeak's typed "form" output. */
const REGISTRATION_FORM_FIELDS: MedispeakFieldSpec[] = [
  { key: "name", label: "Patient full name", type: "string" },
  {
    key: "phone_number",
    label: "Phone number",
    type: "string",
    description: 'With country code, e.g. "+911234567890"',
  },
  {
    key: "emergency_phone_number",
    label: "Emergency contact phone number",
    type: "string",
    description: "With country code",
  },
  {
    key: "gender",
    label: "Gender",
    type: "single_select",
    enum: ["male", "female", "transgender", "non_binary"],
  },
  {
    key: "date_of_birth",
    label: "Date of birth",
    type: "string",
    description:
      'Full date in "YYYY-MM-DD" format, only if a full date is visible',
  },
  {
    key: "age",
    label: "Age in years",
    type: "number",
    description: "Only if just an age is written, not a full date of birth",
  },
  {
    key: "blood_group",
    label: "Blood group",
    type: "string",
    description: 'e.g. "A+", "B-", "O+", "AB+"',
  },
  { key: "address", label: "Current address", type: "string" },
  { key: "permanent_address", label: "Permanent address", type: "string" },
  { key: "pincode", label: "PIN/ZIP code", type: "number" },
  { key: "state", label: "State", type: "string" },
  { key: "district", label: "District", type: "string" },
  {
    key: "local_body",
    label: "Local body / municipality / panchayat",
    type: "string",
  },
  { key: "ward", label: "Ward name or number", type: "string" },
];

/**
 * Extract patient registration data from an image via Medispeak's
 * document/OCR pipeline (proxied through care_filly for the account secret).
 * @param imageFile - The actual File object from input
 * @param facilityId - Required to create the underlying Medispeak session
 */
export async function extractDataFromImage(
  imageFile: File,
  facilityId?: string | null,
): Promise<ExtractedData> {
  const result = await runMedispeakOcr(imageFile, {
    facilityId,
    fields: REGISTRATION_FORM_FIELDS,
  });
  return result as ExtractedData;
}

interface LabDefinitionLike {
  id: string;
  title?: string;
  code?: { code: string; display?: string };
  component?: { code: { code: string; display?: string } }[];
  permitted_unit?: { code: string; display?: string; system?: string } | null;
}

/** `<definitionId>__value` / `<definitionId>__unit` field keys, one pair per
 * test (or per component), so results map back with no fuzzy name matching. */
export function buildLabFieldSpecs(
  definitions: LabDefinitionLike[],
): MedispeakFieldSpec[] {
  const specs: MedispeakFieldSpec[] = [];
  for (const d of definitions) {
    const name = d.title || d.code?.display || d.code?.code || d.id;
    if (d.component?.length) {
      for (const c of d.component) {
        const compName = c.code.display || c.code.code;
        const prefix = `${d.id}__${c.code.code}`;
        specs.push({
          key: `${prefix}__value`,
          label: `${name} - ${compName} value`,
          type: "string",
        });
        specs.push({
          key: `${prefix}__unit`,
          label: `${name} - ${compName} unit`,
          type: "string",
        });
      }
      continue;
    }
    specs.push({
      key: `${d.id}__value`,
      label: `${name} value`,
      type: "string",
      description: d.permitted_unit
        ? `Numeric or text result; expected unit: ${d.permitted_unit.code}`
        : undefined,
    });
    specs.push({
      key: `${d.id}__unit`,
      label: `${name} unit`,
      type: "string",
    });
  }
  return specs;
}

/**
 * Extract lab results from a diagnostic report image via Medispeak's
 * document/OCR pipeline, keyed by definition id (see `buildLabFieldSpecs`).
 * @param imageFile - The actual File object from input
 * @param definitions - The report's observation definitions
 * @param facilityId - Required to create the underlying Medispeak session
 */
export async function extractLabResults(
  imageFile: File,
  definitions: LabDefinitionLike[],
  facilityId?: string | null,
): Promise<Record<string, unknown>> {
  return runMedispeakOcr(imageFile, {
    facilityId,
    fields: buildLabFieldSpecs(definitions),
  });
}
