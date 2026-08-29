import { AlertCircle, Check, ChevronDown, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PixelSpinner } from "@/components/ui/pixel-spinner";

import { useTranslation } from "@/hooks/useTranslation";
import { resolveFacilityIdFromPath } from "@/lib/facility";
import { extractInterpretationFindings } from "@/lib/interpretation-ocr";
import {
  getObservationDefinition,
  observationRangeTargets,
  searchObservationDefinitions,
  writeFindingsToDefinition,
  type ObservationDefinitionRead,
} from "@/lib/observation-definition";

function isLabFile(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

type FindingRow = {
  name: string;
  componentCode: string;
  ref_min?: string;
  ref_max?: string;
};

export function InterpretationVisionTool() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const definitionPickerRef = useRef<HTMLDivElement>(null);
  const facilityId = resolveFacilityIdFromPath();
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [rows, setRows] = useState<FindingRow[] | null>(null);
  const [definitionQuery, setDefinitionQuery] = useState("");
  const [definitionOptions, setDefinitionOptions] = useState<
    ObservationDefinitionRead[]
  >([]);
  const [definition, setDefinition] = useState<
    ObservationDefinitionRead | undefined
  >();
  const [listOpen, setListOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!facilityId) return;
    let cancelled = false;
    setSearching(true);
    const handle = window.setTimeout(
      () => {
        void searchObservationDefinitions(facilityId, definitionQuery.trim())
          .then((results) => {
            if (!cancelled) setDefinitionOptions(results);
          })
          .finally(() => {
            if (!cancelled) setSearching(false);
          });
      },
      definitionQuery.trim() ? 350 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [facilityId, definitionQuery]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (
        definitionPickerRef.current &&
        !definitionPickerRef.current.contains(event.target as Node)
      ) {
        setListOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const rangeTargets = definition ? observationRangeTargets(definition) : [];

  const selectDefinition = async (option: ObservationDefinitionRead) => {
    if (!facilityId) return;
    setDefinitionQuery(option.title);
    setListOpen(false);
    setError("");
    setSaved(false);
    setRows(null);
    try {
      setDefinition(await getObservationDefinition(option.slug, facilityId));
    } catch (err) {
      setDefinition(option);
      setError(err instanceof Error ? err.message : t("extraction_failed"));
    }
  };

  const clearDefinition = () => {
    setDefinition(undefined);
    setDefinitionQuery("");
    setRows(null);
    setError("");
    setSaved(false);
    setListOpen(false);
  };

  const onFiles = async (list: FileList | null) => {
    const files = [...(list ?? [])].filter(isLabFile);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!files.length) {
      setError(t("upload_image_error"));
      return;
    }
    if (!definition) {
      setError(t("select_observation_definition"));
      return;
    }

    setBusy(true);
    setError("");
    setSaved(false);
    setRows(null);
    try {
      const findings = await extractInterpretationFindings(
        files,
        facilityId,
        rangeTargets,
      );
      setRows(
        findings.map((finding) => ({
          name: finding.name,
          componentCode: finding.componentCode ?? "",
          ref_min: finding.ref_min,
          ref_max: finding.ref_max,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("extraction_failed"));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!facilityId || !definition || !rows?.length) return;
    const assignments = rows
      .filter(
        (row) =>
          row.componentCode && (row.ref_min?.trim() || row.ref_max?.trim()),
      )
      .map((row) => ({
        componentCode: row.componentCode,
        finding: {
          ref_min: row.ref_min?.trim() || undefined,
          ref_max: row.ref_max?.trim() || undefined,
        },
      }));

    if (!assignments.length) {
      setError(t("no_interpretation_extracted"));
      return;
    }

    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await writeFindingsToDefinition(definition.slug, facilityId, assignments);
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("failed_to_write_observation_definition"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("interpretation_vision")}</CardTitle>
        <CardDescription>
          {t("interpretation_vision_write_description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => void onFiles(e.target.files)}
        />

        <div ref={definitionPickerRef} className="relative">
          <div className="relative">
            <input
              value={definitionQuery}
              onChange={(e) => {
                const next = e.target.value;
                setDefinitionQuery(next);
                setListOpen(true);
                if (definition && next !== definition.title) {
                  setDefinition(undefined);
                  setRows(null);
                }
              }}
              onFocus={() => setListOpen(true)}
              placeholder={t("search_observation_definition")}
              className="h-8 w-full rounded-md border border-gray-300 py-1 pr-8 pl-2 text-base sm:text-sm"
              autoComplete="off"
              role="combobox"
              aria-expanded={listOpen}
              aria-controls="observation-definition-list"
            />
            {definition ? (
              <button
                type="button"
                className="absolute top-1/2 right-1 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-gray-500 hover:text-gray-900"
                aria-label={t("clear")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={clearDefinition}
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <ChevronDown className="pointer-events-none absolute top-1/2 right-2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            )}
          </div>
          {listOpen && (
            <ul
              id="observation-definition-list"
              role="listbox"
              className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-md"
            >
              {definitionOptions.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">
                  {searching ? "…" : t("no_results")}
                </li>
              ) : (
                definitionOptions.map((option) => (
                  <li key={option.slug} role="option">
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-100",
                        definition?.slug === option.slug && "bg-gray-50",
                      )}
                      onClick={() => void selectDefinition(option)}
                    >
                      <Check
                        className={cn(
                          "h-4 w-4 shrink-0",
                          definition?.slug === option.slug
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      <span className="min-w-0 truncate">{option.title}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        <Button
          type="button"
          variant="white"
          size="sm"
          className="gap-2"
          disabled={busy || !definition}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-4 w-4" />
          {t("upload_files")}
        </Button>

        {busy && (
          <div className="flex items-center gap-2 text-sm text-blue-900">
            <PixelSpinner
              name="braille"
              size="19"
              className="shrink-0 text-blue-800"
            />
            <span className="font-semibold">{t("extracting_information")}</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {rows && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("no_interpretation_extracted")}
          </p>
        )}

        {rows && rows.length > 0 && (
          <div className="space-y-3">
            {rows.map((row) => (
              <div
                key={row.componentCode}
                className="flex flex-col gap-2 rounded-md border border-gray-200 bg-white p-3 sm:flex-row sm:items-center"
              >
                <span className="min-w-0 flex-1 text-sm font-medium">
                  {row.name}
                </span>
                <div className="flex items-center gap-2">
                  <label
                    className="sr-only"
                    htmlFor={`min-${row.componentCode}`}
                  >
                    {t("range_min")}
                  </label>
                  <input
                    id={`min-${row.componentCode}`}
                    inputMode="decimal"
                    value={row.ref_min ?? ""}
                    onChange={(e) =>
                      setRows(
                        (current) =>
                          current?.map((entry) =>
                            entry.componentCode === row.componentCode
                              ? { ...entry, ref_min: e.target.value }
                              : entry,
                          ) ?? null,
                      )
                    }
                    placeholder={t("range_min")}
                    className="h-8 w-24 rounded-md border border-gray-300 px-2 text-sm"
                  />
                  <span className="text-muted-foreground">–</span>
                  <label
                    className="sr-only"
                    htmlFor={`max-${row.componentCode}`}
                  >
                    {t("range_max")}
                  </label>
                  <input
                    id={`max-${row.componentCode}`}
                    inputMode="decimal"
                    value={row.ref_max ?? ""}
                    onChange={(e) =>
                      setRows(
                        (current) =>
                          current?.map((entry) =>
                            entry.componentCode === row.componentCode
                              ? { ...entry, ref_max: e.target.value }
                              : entry,
                          ) ?? null,
                      )
                    }
                    placeholder={t("range_max")}
                    className="h-8 w-24 rounded-md border border-gray-300 px-2 text-sm"
                  />
                </div>
              </div>
            ))}

            <Button
              type="button"
              size="sm"
              disabled={saving || !facilityId}
              onClick={() => void apply()}
            >
              {saving ? t("saving") : t("write_matched_components")}
            </Button>
            {saved && (
              <p className="text-sm text-green-800">
                {t("wrote_to_definition")}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
