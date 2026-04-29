import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { useAtomValue } from "jotai";
import { useCallback, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import useAuthUser from "@/hooks/useAuthUser";
import { useTranslation } from "@/hooks/useTranslation";
import { fileToBase64 } from "@/lib/ocr";
import { aiVisionEnabledAtomFor } from "@/state/ai-vision-store";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";

type Status = "idle" | "processing" | "success" | "error";

interface ObservationDefinition {
  id: string;
  title?: string;
  code?: { code: string; display?: string };
  component?: { code: { code: string; display?: string } }[];
  permitted_unit?: {
    code: string;
    display?: string;
    system?: string;
  } | null;
  permitted_data_type?: string;
}

interface ExtractedResult {
  definitionId: string;
  values: {
    value: string;
    unit?: string;
    componentCode?: string;
  }[];
}

interface LabResult {
  test_name: string;
  value: string;
  unit?: string;
  components?: { name: string; value: string; unit?: string }[];
}

function buildPrompt(definitions: ObservationDefinition[]): string {
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

function fuzzyMatch(extracted: string, candidate: string): boolean {
  const a = extracted.toLowerCase().replace(/[^a-z0-9]/g, "");
  const b = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
  return a === b || a.includes(b) || b.includes(a);
}

function matchDefinition(
  testName: string,
  definitions: ObservationDefinition[],
): ObservationDefinition | undefined {
  return definitions.find((d) => {
    const candidates = [d.title, d.code?.display, d.code?.code].filter(
      Boolean,
    ) as string[];
    return candidates.some((c) => fuzzyMatch(testName, c));
  });
}

function mapResults(
  labResults: LabResult[],
  definitions: ObservationDefinition[],
): ExtractedResult[] {
  const results: ExtractedResult[] = [];

  for (const lr of labResults) {
    const def = matchDefinition(lr.test_name, definitions);
    if (!def) continue;

    if (lr.components?.length && def.component?.length) {
      const values = lr.components
        .map((comp) => {
          const matchedComp = def.component!.find((dc) =>
            fuzzyMatch(comp.name, dc.code.display || dc.code.code),
          );
          if (!matchedComp) return null;
          return {
            value: comp.value,
            unit: comp.unit,
            componentCode: matchedComp.code.code,
          };
        })
        .filter(Boolean) as ExtractedResult["values"];

      if (values.length) {
        results.push({ definitionId: def.id, values });
      }
    } else {
      results.push({
        definitionId: def.id,
        values: [{ value: lr.value, unit: lr.unit }],
      });
    }
  }

  return results;
}

async function extractLabResults(
  base64: string,
  mimeType: string,
  apiKey: string,
  definitions: ObservationDefinition[],
): Promise<LabResult[]> {
  const body = JSON.stringify({
    contents: [
      {
        parts: [
          { text: buildPrompt(definitions) },
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

  return JSON.parse(cleaned) as LabResult[];
}

export default function DiagnosticReportOCR({
  observationDefinitions,
  onExtracted,
  disabled,
  __meta,
}: {
  observationDefinitions: ObservationDefinition[];
  onExtracted: (results: ExtractedResult[]) => void;
  disabled?: boolean;
  __meta?: {
    config?: {
      REACT_APP_GEMINI_API_KEY?: string;
    };
    [key: string]: unknown;
  };
}) {
  const { t } = useTranslation();
  const user = useAuthUser();
  const enabledAtom = useMemo(
    () => aiVisionEnabledAtomFor(user.id ?? user.username),
    [user.id, user.username],
  );
  const enabled = useAtomValue(enabledAtom);

  const GEMINI_API_KEY =
    __meta?.config?.REACT_APP_GEMINI_API_KEY ??
    import.meta.env.REACT_APP_GEMINI_API_KEY ??
    "";

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [filledCount, setFilledCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!GEMINI_API_KEY) {
        setError(t("gemini_key_not_configured"));
        setStatus("error");
        return;
      }

      setStatus("processing");
      setError("");
      setPreview(URL.createObjectURL(file));

      try {
        const base64 = await fileToBase64(file);
        const labResults = await extractLabResults(
          base64,
          file.type,
          GEMINI_API_KEY,
          observationDefinitions,
        );
        const mapped = mapResults(labResults, observationDefinitions);
        onExtracted(mapped);

        const totalValues = mapped.reduce((s, r) => s + r.values.length, 0);
        setFilledCount(totalValues);
        setStatus("success");
      } catch (err) {
        setError(err instanceof Error ? err.message : t("extraction_failed"));
        setStatus("error");
      }
    },
    [GEMINI_API_KEY, observationDefinitions, onExtracted, t],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError("");
    setPreview(null);
    setFilledCount(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  if (disabled || !enabled || !GEMINI_API_KEY) return null;

  return (
    <div className="w-full">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleInputChange}
      />

      {status === "idle" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 border-blue-200 text-blue-700 hover:bg-blue-50"
          onClick={() => fileInputRef.current?.click()}
        >
          <Camera className="h-4 w-4" />
          {t("scan_lab_report")}
        </Button>
      )}

      {status === "processing" && (
        <div className="flex items-center gap-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
          {preview && (
            <img
              src={preview}
              alt="Lab report preview"
              className="h-12 w-12 rounded object-cover"
            />
          )}
          <div className="flex items-center gap-2 text-sm text-blue-700">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("extracting_lab_results")}
          </div>
        </div>
      )}

      {status === "success" && (
        <div className="flex items-center gap-3 rounded-lg border border-green-100 bg-green-50/50 p-3">
          {preview && (
            <img
              src={preview}
              alt="Lab report preview"
              className="h-12 w-12 rounded object-cover"
            />
          )}
          <div className="flex flex-1 items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span className="text-sm text-green-700">
              {t("filled_lab_fields", { count: filledCount })}
            </span>
            <Badge
              variant="secondary"
              className="bg-green-100 text-green-700 text-xs"
            >
              {filledCount}
            </Badge>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            className="text-gray-500 hover:text-gray-700"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {status === "error" && (
        <div className="flex items-center gap-3 rounded-lg border border-red-100 bg-red-50/50 p-3">
          <AlertCircle className="h-4 w-4 text-red-500" />
          <span className="flex-1 text-sm text-red-600">{error}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            className="text-gray-500 hover:text-gray-700"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
