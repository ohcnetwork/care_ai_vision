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
import { uploadDiagnosticReportFile } from "@/lib/files";
import { extractLabResultsViaEka } from "@/lib/ocr";
import { resolveDiagnosticReportContext } from "@/lib/service-request";
import { aiVisionEnabledAtomFor } from "@/state/ai-vision-store";

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
}

function fuzzyMatch(extracted: string, candidate: string): boolean {
  const a = extracted.toLowerCase().replace(/[^a-z0-9]/g, "");
  const b = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
  return a === b || a.includes(b) || b.includes(a);
}

type DefinitionMatch =
  | { definitionId: string; componentCode?: undefined }
  | { definitionId: string; componentCode: string };

/**
 * eka.care returns each analyte (e.g. "WBC") as its own flat result, but CARE
 * often models a panel (e.g. "Complete Blood Count") as a single definition
 * with those analytes as components. Try a direct definition match first,
 * then fall back to matching against every definition's components.
 */
function matchDefinition(
  testName: string,
  definitions: ObservationDefinition[],
): DefinitionMatch | undefined {
  for (const d of definitions) {
    const candidates = [d.title, d.code?.display, d.code?.code].filter(
      Boolean,
    ) as string[];
    if (candidates.some((c) => fuzzyMatch(testName, c))) {
      return { definitionId: d.id };
    }
  }

  for (const d of definitions) {
    const match = d.component?.find((c) =>
      fuzzyMatch(testName, c.code.display || c.code.code),
    );
    if (match) {
      return { definitionId: d.id, componentCode: match.code.code };
    }
  }

  return undefined;
}

function mapResults(
  labResults: LabResult[],
  definitions: ObservationDefinition[],
): ExtractedResult[] {
  const results: ExtractedResult[] = [];

  for (const lr of labResults) {
    const match = matchDefinition(lr.test_name, definitions);
    if (!match) {
      console.warn(
        `eka.care result "${lr.test_name}" did not match any observation definition`,
        definitions.map((d) => d.title || d.code?.display || d.code?.code),
      );
      continue;
    }

    results.push({
      definitionId: match.definitionId,
      values: [
        {
          value: lr.value,
          unit: lr.unit,
          componentCode: match.componentCode,
        },
      ],
    });
  }

  return results;
}

export default function DiagnosticReportOCR({
  observationDefinitions,
  handleComponentValueChange,
  handleValueChange,
  handleUnitChange,
  disabled,
}: {
  observationDefinitions: ObservationDefinition[];
  handleComponentValueChange: (
    definitionId: string,
    index: number,
    componentCode: string,
    value: string,
    unit: string,
  ) => void;
  handleValueChange: (
    definitionId: string,
    index: number,
    value: string,
  ) => void;
  handleUnitChange: (definitionId: string, index: number, unit: string) => void;
  disabled?: boolean;
}) {
  const onExtracted = useCallback(
    (
      results: {
        definitionId: string;
        values: {
          value: string;
          unit?: string;
          componentCode?: string;
        }[];
      }[],
    ) => {
      for (const result of results) {
        for (const val of result.values) {
          if (val.componentCode) {
            handleComponentValueChange(
              result.definitionId,
              0,
              val.componentCode,
              val.value,
              val.unit || "",
            );
          } else {
            handleValueChange(result.definitionId, 0, val.value);
            if (val.unit) {
              handleUnitChange(result.definitionId, 0, val.unit);
            }
          }
        }
      }
    },
    [handleComponentValueChange, handleValueChange, handleUnitChange],
  );

  const { t } = useTranslation();
  const user = useAuthUser();
  const enabledAtom = useMemo(
    () => aiVisionEnabledAtomFor(user.id ?? user.username),
    [user.id, user.username],
  );
  const enabled = useAtomValue(enabledAtom);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [filledCount, setFilledCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setStatus("processing");
      setError("");
      setPreview(URL.createObjectURL(file));

      try {
        const context = await resolveDiagnosticReportContext();
        if (!context) {
          throw new Error(t("extraction_failed"));
        }

        const labResults: LabResult[] = await extractLabResultsViaEka(
          file,
          context.patientId,
        );
        const mapped = mapResults(labResults, observationDefinitions);
        onExtracted(mapped);

        const totalValues = mapped.reduce((s, r) => s + r.values.length, 0);
        setFilledCount(totalValues);
        setStatus("success");

        // Only keep the scan once the form has actually been filled from it.
        const displayName = `${context.patientName} - ${context.testName}`;
        uploadDiagnosticReportFile(file, context.reportId, displayName).catch(
          (err) =>
            console.error("Failed to attach scanned file to report", err),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : t("extraction_failed"));
        setStatus("error");
      }
    },
    [observationDefinitions, onExtracted, t],
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

  if (disabled || !enabled) return null;

  return (
    <div className="w-full">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
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
