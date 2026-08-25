import { ExtractedData } from "./types";
import { getHeaders } from "@/lib/request";

const EXTRACTION_PROMPT = `You are an OCR data extraction assistant. Analyze this image of a patient registration form and extract the following fields. Return ONLY a valid JSON object with these keys (omit keys if the value is not found):

- name: patient full name (string)
- phone_number: phone number with country code, e.g. "+911234567890" (string)
- emergency_phone_number: emergency contact phone with country code (string)
- gender: one of "male", "female", "transgender", "non_binary" (string, lowercase)
- date_of_birth: date of birth in "YYYY-MM-DD" format (string) — extract this if a full date is visible
- age: age in years (number) — extract this if only age is written, not a full date
- blood_group: blood group like "A+", "B-", "O+", "AB+" etc. (string)
- address: current address (string)
- permanent_address: permanent address (string)
- pincode: PIN/ZIP code (number)
- state: state name (string) — extract if visible
- district: district name (string) — extract if visible
- local_body: local body / municipality / panchayat name (string) — extract if visible
- ward: ward name or number (string) — extract if visible

Return ONLY the JSON object, no markdown, no explanation.`;

/**
 * Extract patient registration data from image using care_ai backend
 * @param imageFile - The actual File object from input
 */
export async function extractDataFromImage(
  imageFile: File,
): Promise<ExtractedData> {
  const url = new URL("/api/care_ai/ask/", window.CARE_API_URL);

  // Create FormData for multipart upload
  const formData = new FormData();

  // Add the extraction prompt as 'prompt' field
  formData.append("prompt", EXTRACTION_PROMPT);

  // Append the actual File object directly
  formData.append("images", imageFile);

  // Get auth headers (without Content-Type, let browser set it for multipart)
  const headers = getHeaders();
  headers.delete("Content-Type"); // Let browser set boundary for multipart/form-data

  const res = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "Unknown error");
    throw new Error(`AI API error: ${res.status} - ${errorText}`);
  }

  const json = await res.json();
  const result: string = json?.result ?? "";

  // Clean up markdown formatting if present
  const cleaned = result
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  return JSON.parse(cleaned) as ExtractedData;
}

/**
 * Build prompt for lab results extraction
 */
export function buildLabResultsPrompt(
  definitions: Array<{
    id: string;
    title?: string;
    code?: { code: string; display?: string };
    component?: { code: { code: string; display?: string } }[];
    permitted_unit?: { code: string; display?: string; system?: string } | null;
  }>,
): string {
  const testList = definitions
    .map((d) => {
      const name = d.title || d.code?.display || d.code?.code;
      if (d.component?.length) {
        const comps = d.component
          .map((c) => c.code.display || c.code.code)
          .join(", ");
        return `- ${name} (components: ${comps})`;
      }
      return `- ${name}${d.permitted_unit ? ` (unit: ${d.permitted_unit.code})` : ""}`;
    })
    .join("\n");

  return `Extract lab results from this image. Return ONLY valid JSON (no markdown).
I need results for these specific tests:
${testList}

Return format:
[
  {
    "test_name": "exact test name from above",
    "value": "numeric or text result",
    "unit": "unit if visible",
    "components": [
      { "name": "component name", "value": "result", "unit": "unit" }
    ]
  }
]`;
}

/**
 * Extract lab results from diagnostic report image using care_ai backend
 * @param imageFile - The actual File object from input
 * @param prompt - The lab extraction prompt
 */
export async function extractLabResults<T>(
  imageFile: File,
  prompt: string,
): Promise<T> {
  const url = new URL("/api/care_ai/ask/", window.CARE_API_URL);

  const formData = new FormData();

  // Add the lab extraction prompt as 'prompt' field
  formData.append("prompt", prompt);

  // Append the actual File object directly
  formData.append("images", imageFile);

  const headers = getHeaders();
  headers.delete("Content-Type");

  const res = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "Unknown error");
    throw new Error(`AI API error: ${res.status} - ${errorText}`);
  }

  const json = await res.json();
  const result: string = json?.result ?? "";

  const cleaned = result
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  return JSON.parse(cleaned) as T;
}

export interface EkaLabResult {
  test_name: string;
  value: string;
  unit?: string;
}

/**
 * Parse a lab report via eka.care (presigned upload + structured vitals), scoped to a patient.
 * @param file - The lab report image/PDF to upload
 * @param patientId - CARE patient external_id, forwarded to eka.care as the record owner
 */
export async function extractLabResultsViaEka(
  file: File,
  patientId: string,
): Promise<EkaLabResult[]> {
  const url = new URL("/api/care_ai/eka/lab-report/", window.CARE_API_URL);

  const formData = new FormData();
  formData.append("file", file);
  formData.append("patient", patientId);

  const headers = getHeaders();
  headers.delete("Content-Type");

  const res = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new Error(errorBody?.detail ?? `eka.care API error: ${res.status}`);
  }

  const json = await res.json();
  return (json?.result ?? []) as EkaLabResult[];
}
