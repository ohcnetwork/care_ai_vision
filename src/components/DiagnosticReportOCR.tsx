import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import useAuthUser from "@/hooks/useAuthUser";
import { useTranslation } from "@/hooks/useTranslation";
import { extractLabResults, highlightLabObservation } from "@/lib/ocr";
import { resolveFacilityIdFromPath } from "@/lib/facility";
import { aiVisionEnabledAtomFor } from "@/state/ai-vision-store";

type Status = "idle" | "processing" | "filling" | "success" | "error";

const FIELD_FILL_DELAY_MS = 350;

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

interface FillStep {
  apply: () => void;
  highlight: () => void;
}

interface QueuedFile {
  file: File;
  url: string | null;
}

function isLabFile(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function mapResults(
  result: Record<string, unknown>,
  definitions: ObservationDefinition[],
): ExtractedResult[] {
  const asString = (v: unknown) => (v == null ? "" : String(v));
  const results: ExtractedResult[] = [];

  for (const def of definitions) {
    if (def.component?.length) {
      const values = def.component
        .map((comp) => {
          const prefix = `${def.id}__${comp.code.code}`;
          const value = asString(result[`${prefix}__value`]);
          if (!value) return null;
          return {
            value,
            unit: asString(result[`${prefix}__unit`]) || undefined,
            componentCode: comp.code.code,
          };
        })
        .filter(Boolean) as ExtractedResult["values"];

      if (values.length) results.push({ definitionId: def.id, values });
      continue;
    }

    const value = asString(result[`${def.id}__value`]);
    if (!value) continue;
    results.push({
      definitionId: def.id,
      values: [
        { value, unit: asString(result[`${def.id}__unit`]) || undefined },
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
  const { t } = useTranslation();
  const user = useAuthUser();
  const enabledAtom = useMemo(
    () => aiVisionEnabledAtomFor(user.id ?? user.username),
    [user.id, user.username],
  );
  const enabled = useAtomValue(enabledAtom);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [queued, setQueued] = useState<QueuedFile[]>([]);
  const [filledCount, setFilledCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fillTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const queuedRef = useRef(queued);
  queuedRef.current = queued;

  const clearFillTimeouts = () => {
    fillTimeoutsRef.current.forEach(clearTimeout);
    fillTimeoutsRef.current = [];
  };

  useEffect(() => clearFillTimeouts, []);

  useEffect(() => {
    return () => {
      queuedRef.current.forEach((item) => {
        if (item.url) URL.revokeObjectURL(item.url);
      });
    };
  }, []);

  const revokeAll = (items: QueuedFile[]) => {
    items.forEach((item) => {
      if (item.url) URL.revokeObjectURL(item.url);
    });
  };

  const buildFillSteps = useCallback(
    (mapped: ExtractedResult[]): FillStep[] => {
      const steps: FillStep[] = [];
      const byId = new Map(
        observationDefinitions.map((d) => [d.id, d] as const),
      );

      for (const result of mapped) {
        const def = byId.get(result.definitionId);
        for (const val of result.values) {
          if (val.componentCode) {
            steps.push({
              apply: () =>
                handleComponentValueChange(
                  result.definitionId,
                  0,
                  val.componentCode!,
                  val.value,
                  val.unit || "",
                ),
              highlight: () =>
                def && highlightLabObservation(def, "value", val.componentCode),
            });
            continue;
          }
          steps.push({
            apply: () => handleValueChange(result.definitionId, 0, val.value),
            highlight: () => def && highlightLabObservation(def, "value"),
          });
          if (val.unit) {
            steps.push({
              apply: () => handleUnitChange(result.definitionId, 0, val.unit!),
              highlight: () => def && highlightLabObservation(def, "unit"),
            });
          }
        }
      }
      return steps;
    },
    [
      observationDefinitions,
      handleComponentValueChange,
      handleValueChange,
      handleUnitChange,
    ],
  );

  const runFillAnimation = useCallback((steps: FillStep[]) => {
    clearFillTimeouts();
    setFilledCount(0);
    setTotalCount(steps.length);

    if (steps.length === 0) {
      setStatus("success");
      return;
    }

    setStatus("filling");
    steps.forEach((step, index) => {
      const timeoutId = setTimeout(() => {
        step.apply();
        requestAnimationFrame(() => step.highlight());
        setFilledCount(index + 1);
        if (index === steps.length - 1) setStatus("success");
      }, index * FIELD_FILL_DELAY_MS);
      fillTimeoutsRef.current.push(timeoutId);
    });
  }, []);

  const appendFiles = useCallback(
    (files: File[]) => {
      const accepted = files.filter(isLabFile);
      if (!accepted.length) {
        setError(t("upload_image_error"));
        setStatus("error");
        return;
      }

      setError("");
      setStatus("idle");
      setQueued((prev) => {
        const existing = new Set(prev.map((item) => fileKey(item.file)));
        const next = [...prev];
        for (const file of accepted) {
          if (existing.has(fileKey(file))) continue;
          existing.add(fileKey(file));
          next.push({
            file,
            url: file.type.startsWith("image/")
              ? URL.createObjectURL(file)
              : null,
          });
        }
        return next;
      });
    },
    [t],
  );

  const removeAt = useCallback((index: number) => {
    setQueued((prev) => {
      const item = prev[index];
      if (item?.url) URL.revokeObjectURL(item.url);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const extract = useCallback(async () => {
    const files = queuedRef.current.map((item) => item.file);
    if (!files.length) return;

    clearFillTimeouts();
    setStatus("processing");
    setError("");
    setFilledCount(0);
    setTotalCount(0);

    try {
      const labResults = await extractLabResults(
        files,
        observationDefinitions,
        resolveFacilityIdFromPath(),
      );
      const mapped = mapResults(labResults, observationDefinitions);
      runFillAnimation(buildFillSteps(mapped));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("extraction_failed"));
      setStatus("error");
    }
  }, [observationDefinitions, t, buildFillSteps, runFillAnimation]);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    if (files.length) appendFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const reset = useCallback(() => {
    clearFillTimeouts();
    revokeAll(queuedRef.current);
    setQueued([]);
    setStatus("idle");
    setError("");
    setFilledCount(0);
    setTotalCount(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  if (disabled || !enabled) return null;

  const staging = status === "idle" || status === "error";
  const busy = status === "processing" || status === "filling";

  return (
    <div className="care-ai-vision-container">
      <div className="w-full space-y-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf,application/pdf"
          className="hidden"
          onChange={onInputChange}
        />

        {staging && (
          <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3 space-y-3">
            {queued.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {queued.map((item, i) => (
                  <div key={fileKey(item.file)} className="relative">
                    {item.url ? (
                      <img
                        src={item.url}
                        alt=""
                        className="h-14 w-14 rounded object-cover"
                      />
                    ) : (
                      <span className="flex h-14 w-14 items-center justify-center rounded bg-white text-blue-600">
                        <FileText className="h-5 w-5" />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAt(i)}
                      className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-white"
                      title={t("remove_page")}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <span className="text-xs font-medium text-blue-700">
                  {t("queued_pages", { count: queued.length })}
                </span>
              </div>
            )}

            {status === "error" && (
              <div className="flex items-center gap-2 text-sm text-red-600">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2 border-blue-200 text-blue-700 hover:bg-blue-50"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileText className="h-4 w-4" />
                {queued.length ? t("add_another") : t("choose_file")}
              </Button>
              {queued.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  className="gap-2 bg-blue-600 text-white hover:bg-blue-700"
                  onClick={extract}
                >
                  <Sparkles className="h-4 w-4" />
                  {t("extract")}
                </Button>
              )}
              {queued.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={reset}
                  className="text-gray-500"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
            <PreviewStack queued={queued} />
            <div className="flex items-center gap-2 text-sm text-blue-700">
              <Loader2 className="h-4 w-4 animate-spin" />
              {status === "processing"
                ? t("extracting_lab_results")
                : t("filling_fields", { count: totalCount })}
            </div>
          </div>
        )}

        {status === "success" && (
          <div className="flex items-center gap-3 rounded-lg border border-green-100 bg-green-50/50 p-3">
            <PreviewStack queued={queued} />
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
      </div>
    </div>
  );
}

function PreviewStack({ queued }: { queued: QueuedFile[] }) {
  if (!queued.length) return null;
  const shown = queued.slice(0, 3);
  const extra = queued.length - shown.length;

  return (
    <div className="flex -space-x-2">
      {shown.map((item, i) =>
        item.url ? (
          <img
            key={`${fileKey(item.file)}-${i}`}
            src={item.url}
            alt=""
            className="h-12 w-12 rounded border border-white object-cover"
          />
        ) : (
          <span
            key={`${fileKey(item.file)}-${i}`}
            className="flex h-12 w-12 items-center justify-center rounded border border-white bg-white text-blue-600"
          >
            <FileText className="h-5 w-5" />
          </span>
        ),
      )}
      {extra > 0 && (
        <span className="flex h-12 w-12 items-center justify-center rounded border border-white bg-blue-100 text-xs font-semibold text-blue-700">
          +{extra}
        </span>
      )}
    </div>
  );
}
