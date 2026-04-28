import { ExtractedData } from "./types";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";

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

export async function extractDataFromImage(
  base64: string,
  mimeType: string,
  apiKey: string,
): Promise<ExtractedData> {
  const body = JSON.stringify({
    contents: [
      {
        parts: [
          { text: EXTRACTION_PROMPT },
          { inline_data: { mime_type: mimeType, data: base64 } },
        ],
      },
    ],
    generationConfig: { temperature: 0.1 },
  });

  const MAX_RETRIES = 3;
  let res: Response | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body,
    });
    if (res.status !== 429 || attempt === MAX_RETRIES) break;
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }

  if (!res || !res.ok) {
    throw new Error(`Gemini API error: ${res?.status ?? "unknown"}`);
  }

  const json = await res.json();
  const text: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  const cleaned = text
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  return JSON.parse(cleaned) as ExtractedData;
}
