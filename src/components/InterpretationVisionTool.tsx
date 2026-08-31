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
import {
  getActivityDefinition,
  searchActivityDefinitions,
  type ActivityDefinitionDetail,
  type ActivityDefinitionRead,
} from "@/lib/activity-definition";
import { resolveFacilityIdFromPath } from "@/lib/facility";
import {
  extractInterpretationFindings,
  type InterpretationTarget,
} from "@/lib/interpretation-ocr";
import {
  getObservationDefinition,
  observationRangeTargets,
  searchObservationDefinitions,
  writeFindingsBatch,
  type ObservationDefinitionRead,
  type PrintedRangeFinding,
} from "@/lib/observation-definition";

function isLabFile(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

type Mode = "observation" | "activity";

type FindingRow = {
  name: string;
  componentCode: string;
  definitionSlug: string;
  ref_min?: string;
  ref_max?: string;
  ref_min_male?: string;
  ref_max_male?: string;
  ref_min_female?: string;
  ref_max_female?: string;
};

function rowHasSexSpecificRange(row: FindingRow): boolean {
  return !!(
    row.ref_min_male ||
    row.ref_max_male ||
    row.ref_min_female ||
    row.ref_max_female
  );
}

/** A min–max input pair, reused for the general range and the male/female ranges. */
function RangeInputs({
  idPrefix,
  min,
  max,
  onMinChange,
  onMaxChange,
  minLabel,
  maxLabel,
}: {
  idPrefix: string;
  min?: string;
  max?: string;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
  minLabel: string;
  maxLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor={`min-${idPrefix}`}>
        {minLabel}
      </label>
      <input
        id={`min-${idPrefix}`}
        inputMode="decimal"
        value={min ?? ""}
        onChange={(e) => onMinChange(e.target.value)}
        placeholder={minLabel}
        className="h-8 w-24 rounded-md border border-gray-300 px-2 text-sm"
      />
      <span className="text-muted-foreground">–</span>
      <label className="sr-only" htmlFor={`max-${idPrefix}`}>
        {maxLabel}
      </label>
      <input
        id={`max-${idPrefix}`}
        inputMode="decimal"
        value={max ?? ""}
        onChange={(e) => onMaxChange(e.target.value)}
        placeholder={maxLabel}
        className="h-8 w-24 rounded-md border border-gray-300 px-2 text-sm"
      />
    </div>
  );
}

export function InterpretationVisionTool() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const definitionPickerRef = useRef<HTMLDivElement>(null);
  const facilityId = resolveFacilityIdFromPath();
  const [mode, setMode] = useState<Mode>("observation");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(0);
  const [rows, setRows] = useState<FindingRow[] | null>(null);
  // Rows where the male/female range inputs are shown even though no value
  // was extracted yet — toggled on manually via "Add sex-specific range".
  const [sexSplitRows, setSexSplitRows] = useState<Set<string>>(new Set());
  const [definitionQuery, setDefinitionQuery] = useState("");
  const [definitionOptions, setDefinitionOptions] = useState<
    ObservationDefinitionRead[]
  >([]);
  const [definition, setDefinition] = useState<
    ObservationDefinitionRead | undefined
  >();
  const [activityQuery, setActivityQuery] = useState("");
  const [activityOptions, setActivityOptions] = useState<
    ActivityDefinitionRead[]
  >([]);
  const [activityDefinition, setActivityDefinition] = useState<
    ActivityDefinitionDetail | undefined
  >();
  const [listOpen, setListOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  const isActivityMode = mode === "activity";
  const query = isActivityMode ? activityQuery : definitionQuery;
  const selectedTitle = isActivityMode
    ? activityDefinition?.title
    : definition?.title;

  useEffect(() => {
    if (!facilityId) return;
    let cancelled = false;
    setSearching(true);
    const handle = window.setTimeout(
      () => {
        const search = isActivityMode
          ? searchActivityDefinitions(facilityId, query.trim())
          : searchObservationDefinitions(facilityId, query.trim());
        void search
          .then((results) => {
            if (cancelled) return;
            if (isActivityMode) {
              setActivityOptions(results as ActivityDefinitionRead[]);
            } else {
              setDefinitionOptions(results as ObservationDefinitionRead[]);
            }
          })
          .finally(() => {
            if (!cancelled) setSearching(false);
          });
      },
      query.trim() ? 350 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [facilityId, isActivityMode, query]);

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

  // Flatten every observation definition's range targets into one list,
  // tagged with the definition they belong to — an activity definition (order
  // type) can require several observation definitions, each written back
  // independently.
  const definitionTitleBySlug = new Map<string, string>();
  const rangeTargets: InterpretationTarget[] = (() => {
    if (isActivityMode) {
      const defs = activityDefinition?.observation_result_requirements ?? [];
      return defs.flatMap((def) => {
        definitionTitleBySlug.set(def.slug, def.title);
        return observationRangeTargets(def).map((target) => ({
          code: target.code,
          definitionSlug: def.slug,
        }));
      });
    }
    if (!definition) return [];
    definitionTitleBySlug.set(definition.slug, definition.title);
    return observationRangeTargets(definition).map((target) => ({
      code: target.code,
      definitionSlug: definition.slug,
    }));
  })();

  const groupedRows = (() => {
    if (!rows) return [];
    const order: string[] = [];
    const bySlug = new Map<string, FindingRow[]>();
    for (const row of rows) {
      if (!bySlug.has(row.definitionSlug)) {
        bySlug.set(row.definitionSlug, []);
        order.push(row.definitionSlug);
      }
      bySlug.get(row.definitionSlug)?.push(row);
    }
    return order.map((slug) => ({
      definitionSlug: slug,
      definitionTitle: definitionTitleBySlug.get(slug) ?? slug,
      rows: bySlug.get(slug) ?? [],
    }));
  })();

  const resetSelection = () => {
    setError("");
    setSaved(0);
    setRows(null);
    setListOpen(false);
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setDefinition(undefined);
    setDefinitionQuery("");
    setActivityDefinition(undefined);
    setActivityQuery("");
    resetSelection();
  };

  const selectDefinition = async (option: ObservationDefinitionRead) => {
    if (!facilityId) return;
    setDefinitionQuery(option.title);
    resetSelection();
    try {
      setDefinition(await getObservationDefinition(option.slug, facilityId));
    } catch (err) {
      setDefinition(option);
      setError(err instanceof Error ? err.message : t("extraction_failed"));
    }
  };

  const selectActivityDefinition = async (option: ActivityDefinitionRead) => {
    if (!facilityId) return;
    setActivityQuery(option.title);
    resetSelection();
    try {
      setActivityDefinition(
        await getActivityDefinition(option.slug, facilityId),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("extraction_failed"));
    }
  };

  const clearDefinition = () => {
    if (isActivityMode) {
      setActivityDefinition(undefined);
      setActivityQuery("");
    } else {
      setDefinition(undefined);
      setDefinitionQuery("");
    }
    resetSelection();
  };

  const onFiles = async (list: FileList | null) => {
    const files = [...(list ?? [])].filter(isLabFile);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!files.length) {
      setError(t("upload_image_error"));
      return;
    }
    if (!rangeTargets.length) {
      setError(
        isActivityMode
          ? t("select_activity_definition")
          : t("select_observation_definition"),
      );
      return;
    }

    setBusy(true);
    setError("");
    setSaved(0);
    setRows(null);
    setSexSplitRows(new Set());
    try {
      const findings = await extractInterpretationFindings(
        files,
        facilityId,
        rangeTargets,
      );
      setRows(
        findings.map((finding) => ({
          name: finding.name,
          componentCode: finding.componentCode,
          definitionSlug: finding.definitionSlug,
          ref_min: finding.ref_min,
          ref_max: finding.ref_max,
          ref_min_male: finding.ref_min_male,
          ref_max_male: finding.ref_max_male,
          ref_min_female: finding.ref_min_female,
          ref_max_female: finding.ref_max_female,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("extraction_failed"));
    } finally {
      setBusy(false);
    }
  };

  const updateRow = (
    definitionSlug: string,
    componentCode: string,
    patch: Partial<FindingRow>,
  ) => {
    setRows(
      (current) =>
        current?.map((entry) =>
          entry.componentCode === componentCode &&
          entry.definitionSlug === definitionSlug
            ? { ...entry, ...patch }
            : entry,
        ) ?? null,
    );
  };

  const apply = async () => {
    if (!facilityId || !rows?.length) return;
    // Each observation definition is written back independently, so group the
    // rows by definition to build one batch request per definition.
    const assignmentsBySlug = new Map<
      string,
      {
        componentCode: string;
        finding: PrintedRangeFinding;
      }[]
    >();
    for (const row of rows) {
      if (!row.componentCode) continue;
      const finding: PrintedRangeFinding = {
        ref_min: row.ref_min?.trim() || undefined,
        ref_max: row.ref_max?.trim() || undefined,
        ref_min_male: row.ref_min_male?.trim() || undefined,
        ref_max_male: row.ref_max_male?.trim() || undefined,
        ref_min_female: row.ref_min_female?.trim() || undefined,
        ref_max_female: row.ref_max_female?.trim() || undefined,
      };
      if (!Object.values(finding).some(Boolean)) continue;
      const assignments = assignmentsBySlug.get(row.definitionSlug) ?? [];
      assignments.push({ componentCode: row.componentCode, finding });
      assignmentsBySlug.set(row.definitionSlug, assignments);
    }

    if (!assignmentsBySlug.size) {
      setError(t("no_interpretation_extracted"));
      return;
    }

    setSaving(true);
    setError("");
    setSaved(0);
    try {
      // Writes all definitions in one atomic /api/v1/batch_requests/ call
      // instead of a sequential PUT per definition.
      await writeFindingsBatch(
        facilityId,
        [...assignmentsBySlug].map(([slug, assignments]) => ({
          slug,
          assignments,
        })),
      );
      setSaved(assignmentsBySlug.size);
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

        <div className="flex gap-1 rounded-md border border-gray-200 bg-gray-50 p-1">
          {(["observation", "activity"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={cn(
                "flex-1 rounded px-2 py-1 text-sm font-medium",
                mode === option
                  ? "bg-white shadow-sm"
                  : "text-muted-foreground hover:text-gray-900",
              )}
              onClick={() => switchMode(option)}
            >
              {option === "observation"
                ? t("match_by_observation")
                : t("match_by_activity")}
            </button>
          ))}
        </div>

        <div ref={definitionPickerRef} className="relative">
          <div className="relative">
            <input
              value={query}
              onChange={(e) => {
                const next = e.target.value;
                if (isActivityMode) {
                  setActivityQuery(next);
                  if (activityDefinition && next !== activityDefinition.title) {
                    setActivityDefinition(undefined);
                    setRows(null);
                  }
                } else {
                  setDefinitionQuery(next);
                  if (definition && next !== definition.title) {
                    setDefinition(undefined);
                    setRows(null);
                  }
                }
                setListOpen(true);
              }}
              onFocus={() => setListOpen(true)}
              placeholder={
                isActivityMode
                  ? t("search_activity_definition")
                  : t("search_observation_definition")
              }
              className="h-8 w-full rounded-md border border-gray-300 py-1 pr-8 pl-2 text-base sm:text-sm"
              autoComplete="off"
              role="combobox"
              aria-expanded={listOpen}
              aria-controls="definition-picker-list"
            />
            {selectedTitle ? (
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
              id="definition-picker-list"
              role="listbox"
              className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-md"
            >
              {(isActivityMode ? activityOptions : definitionOptions).length ===
              0 ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">
                  {searching ? "…" : t("no_results")}
                </li>
              ) : isActivityMode ? (
                activityOptions.map((option) => (
                  <li key={option.slug} role="option">
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-100",
                        activityDefinition?.slug === option.slug &&
                          "bg-gray-50",
                      )}
                      onClick={() => void selectActivityDefinition(option)}
                    >
                      <Check
                        className={cn(
                          "h-4 w-4 shrink-0",
                          activityDefinition?.slug === option.slug
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      <span className="min-w-0 truncate">{option.title}</span>
                    </button>
                  </li>
                ))
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

        {isActivityMode && activityDefinition && (
          <p className="text-xs text-muted-foreground">
            {(() => {
              const count =
                activityDefinition.observation_result_requirements.length;
              return count
                ? t("activity_definition_observation_count", { count })
                : t("no_observations_in_activity_definition");
            })()}
          </p>
        )}

        <Button
          type="button"
          variant="white"
          size="sm"
          className="gap-2"
          disabled={busy || !rangeTargets.length}
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
          <div className="space-y-4">
            {groupedRows.map((group) => (
              <div key={group.definitionSlug} className="space-y-3">
                {isActivityMode && groupedRows.length > 1 && (
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {group.definitionTitle}
                  </p>
                )}
                {group.rows.map((row) => {
                  const rowKey = `${row.definitionSlug}::${row.componentCode}`;
                  const showSexRanges =
                    sexSplitRows.has(rowKey) || rowHasSexSpecificRange(row);
                  return (
                    <div
                      key={rowKey}
                      className="space-y-2 rounded-md border border-gray-200 bg-white p-3"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <span className="min-w-0 flex-1 text-sm font-medium">
                          {row.name}
                        </span>
                        <RangeInputs
                          idPrefix={rowKey}
                          min={row.ref_min}
                          max={row.ref_max}
                          minLabel={t("range_min")}
                          maxLabel={t("range_max")}
                          onMinChange={(value) =>
                            updateRow(row.definitionSlug, row.componentCode, {
                              ref_min: value,
                            })
                          }
                          onMaxChange={(value) =>
                            updateRow(row.definitionSlug, row.componentCode, {
                              ref_max: value,
                            })
                          }
                        />
                      </div>

                      {showSexRanges ? (
                        <div className="space-y-2 border-t border-gray-100 pt-2">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <span className="w-16 shrink-0 text-xs text-muted-foreground">
                              {t("male")}
                            </span>
                            <RangeInputs
                              idPrefix={`${rowKey}-male`}
                              min={row.ref_min_male}
                              max={row.ref_max_male}
                              minLabel={t("range_min_male")}
                              maxLabel={t("range_max_male")}
                              onMinChange={(value) =>
                                updateRow(
                                  row.definitionSlug,
                                  row.componentCode,
                                  { ref_min_male: value },
                                )
                              }
                              onMaxChange={(value) =>
                                updateRow(
                                  row.definitionSlug,
                                  row.componentCode,
                                  { ref_max_male: value },
                                )
                              }
                            />
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <span className="w-16 shrink-0 text-xs text-muted-foreground">
                              {t("female")}
                            </span>
                            <RangeInputs
                              idPrefix={`${rowKey}-female`}
                              min={row.ref_min_female}
                              max={row.ref_max_female}
                              minLabel={t("range_min_female")}
                              maxLabel={t("range_max_female")}
                              onMinChange={(value) =>
                                updateRow(
                                  row.definitionSlug,
                                  row.componentCode,
                                  { ref_min_female: value },
                                )
                              }
                              onMaxChange={(value) =>
                                updateRow(
                                  row.definitionSlug,
                                  row.componentCode,
                                  { ref_max_female: value },
                                )
                              }
                            />
                          </div>
                          <button
                            type="button"
                            className="text-xs text-muted-foreground underline"
                            onClick={() => {
                              setSexSplitRows((current) => {
                                const next = new Set(current);
                                next.delete(rowKey);
                                return next;
                              });
                              updateRow(row.definitionSlug, row.componentCode, {
                                ref_min_male: undefined,
                                ref_max_male: undefined,
                                ref_min_female: undefined,
                                ref_max_female: undefined,
                              });
                            }}
                          >
                            {t("remove_sex_specific_range")}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline"
                          onClick={() =>
                            setSexSplitRows((current) =>
                              new Set(current).add(rowKey),
                            )
                          }
                        >
                          {t("add_sex_specific_range")}
                        </button>
                      )}
                    </div>
                  );
                })}
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
            {saved > 0 && (
              <p className="text-sm text-green-800">
                {saved > 1
                  ? t("wrote_to_definitions", { count: saved })
                  : t("wrote_to_definition")}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
