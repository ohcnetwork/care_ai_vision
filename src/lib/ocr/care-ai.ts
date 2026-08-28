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
  loinc_code?: string;
}

const EKA_POLL_INTERVAL_MS = 2000;
const EKA_POLL_TIMEOUT_MS = 90000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse a lab report via eka.care, scoped to a patient. eka.care parses async and
 * notifies our backend via webhook, so this uploads the file then polls our own
 * backend (not eka.care directly) until the webhook has populated the result.
 * @param file - The lab report image/PDF to upload
 * @param patientId - CARE patient external_id, forwarded to eka.care as the record owner
 */
export async function extractLabResultsViaEka(
  file: File,
  patientId: string,
): Promise<EkaLabResult[]> {
  const uploadUrl = new URL(
    "/api/care_ai/eka/lab-report/",
    window.CARE_API_URL,
  );

  const formData = new FormData();
  formData.append("file", file);
  formData.append("patient", patientId);

  const uploadHeaders = getHeaders();
  uploadHeaders.delete("Content-Type");

  const uploadRes = await fetch(uploadUrl.toString(), {
    method: "POST",
    headers: uploadHeaders,
    body: formData,
  });

  if (!uploadRes.ok) {
    const errorBody = await uploadRes.json().catch(() => null);
    throw new Error(
      errorBody?.detail ?? `eka.care API error: ${uploadRes.status}`,
    );
  }

  const { document_id: documentId } = await uploadRes.json();
  if (!documentId) {
    throw new Error("eka.care upload response did not include a document id");
  }

  const resultUrl = new URL(
    `/api/care_ai/eka/lab-report/${documentId}/`,
    window.CARE_API_URL,
  );
  const deadline = Date.now() + EKA_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const res = await fetch(resultUrl.toString(), { headers: getHeaders() });
    const json = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(json?.detail ?? `eka.care API error: ${res.status}`);
    }
    if (json?.status === "completed") {
      return (json?.result ?? []) as EkaLabResult[];
    }

    await sleep(EKA_POLL_INTERVAL_MS);
  }

  throw new Error(
    "eka.care is taking longer than expected to process this document",
  );
}

export interface DefinitionSummary {
  id: string;
  title?: string;
  code?: { code: string; display?: string };
  component?: { code: { code: string; display?: string } }[];
}

export interface AiLabMatch {
  test_name: string;
  definition_id: string;
  component_code?: string;
}

/**
 * Ask the AI model to match extracted lab result names to CARE observation
 * definitions (and their components) using its own knowledge of lab test
 * abbreviations and synonyms — e.g. "HGB" -> "Hemoglobin", "RBC" ->
 * "Erythrocytes" — instead of a hardcoded, panel-specific lookup table, so it
 * generalizes to any test panel.
 */
export async function matchLabResultsWithAI(
  labResults: { test_name: string; loinc_code?: string }[],
  definitions: DefinitionSummary[],
): Promise<AiLabMatch[]> {
  if (labResults.length === 0) return [];

  const resultList = labResults
    .map(
      (r, i) =>
        `${i + 1}. test_name: "${r.test_name}"${r.loinc_code ? `, loinc_code: "${r.loinc_code}"` : ""}`,
    )
    .join("\n");

  const definitionList = definitions
    .map((d) => {
      const name = d.title || d.code?.display || d.code?.code;
      const code = d.code?.code ? ` [code: ${d.code.code}]` : "";
      if (d.component?.length) {
        const comps = d.component
          .map(
            (c) =>
              `"${c.code.display || c.code.code}" (component_code: "${c.code.code}")`,
          )
          .join(", ");
        return `- id: "${d.id}", name: "${name}"${code}, components: ${comps}`;
      }
      return `- id: "${d.id}", name: "${name}"${code}`;
    })
    .join("\n");

  const prompt = `You are a clinical data mapping assistant. Match each extracted lab result to the correct observation definition below (or, if the definition models a panel with components, to the correct component). Use your knowledge of lab test abbreviations, synonyms, and LOINC codes — e.g. "HGB" is "Hemoglobin", "RBC" is "Erythrocytes"/"Red Blood Cell Count".

Extracted lab results:
${resultList}

Observation definitions:
${definitionList}

Return ONLY a valid JSON array (no markdown, no explanation) with one entry per lab result that has a clear, confident match. Skip results with no reasonable match — do not guess. Format:
[
  { "test_name": "HGB", "definition_id": "<id from above>", "component_code": "<component_code from above, omit if matching the definition itself>" }
]`;

  const url = new URL("/api/care_ai/ask/", window.CARE_API_URL);
  const formData = new FormData();
  formData.append("prompt", prompt);

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

  try {
    return JSON.parse(cleaned) as AiLabMatch[];
  } catch {
    console.warn("AI lab result matching returned invalid JSON", cleaned);
    return [];
  }
}
