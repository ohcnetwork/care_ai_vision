import {
  executeBatchRequests,
  type BatchRequestItem,
} from "@/lib/batch-request";
import { getHeaders, HttpError, type PaginatedResponse } from "@/lib/request";

export interface ObservationCode {
  code: string;
  display?: string;
  system?: string;
}

export interface ObservationComponentDef {
  code: ObservationCode;
  permitted_data_type: string;
  permitted_unit?: ObservationCode | null;
  qualified_ranges: unknown[];
}

export interface ObservationDefinitionRead {
  id: string;
  slug: string;
  title: string;
  status: string;
  description: string;
  category: string;
  code: ObservationCode;
  permitted_data_type: string;
  component: ObservationComponentDef[] | null;
  body_site?: ObservationCode | null;
  method?: ObservationCode | null;
  permitted_unit?: ObservationCode | null;
  derived_from_uri?: string | null;
  qualified_ranges: unknown[];
  slug_config?: { slug_value?: string; facility?: string };
}

function apiUrl(path: string, query?: Record<string, string>) {
  const url = new URL(path, window.CARE_API_URL);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });
  }
  return url.toString();
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      typeof (data as { detail?: string }).detail === "string"
        ? (data as { detail: string }).detail
        : JSON.stringify(data);
    throw new HttpError({
      message: detail || `Request failed (${res.status})`,
      status: res.status,
      silent: false,
      cause: data as Record<string, unknown>,
    });
  }
  return data as T;
}

export async function searchObservationDefinitions(
  facilityId: string,
  title = "",
  offset = 0,
): Promise<ObservationDefinitionRead[]> {
  const query: Record<string, string> = {
    facility: facilityId,
    status: "active",
    limit: "15",
    offset: String(offset),
    ordering: "-created_date",
  };
  if (title.trim()) query.title = title.trim();
  const res = await fetch(apiUrl("/api/v1/observation_definition/", query), {
    headers: getHeaders(),
  });
  const data =
    await readJson<PaginatedResponse<ObservationDefinitionRead>>(res);
  return data.results ?? [];
}

export async function getObservationDefinition(
  slug: string,
  facilityId: string,
): Promise<ObservationDefinitionRead> {
  const res = await fetch(
    apiUrl(`/api/v1/observation_definition/${encodeURIComponent(slug)}/`, {
      facility: facilityId,
    }),
    { headers: getHeaders() },
  );
  return readJson<ObservationDefinitionRead>(res);
}

/** Panel components, or the definition itself when it has no components. */
export function observationRangeTargets(
  definition: ObservationDefinitionRead,
): { code: { code: string; display?: string } }[] {
  if (definition.component?.length) return definition.component;
  return [
    {
      code: {
        code: definition.code.code,
        display: definition.code.display || definition.title,
      },
    },
  ];
}

export interface PrintedRangeFinding {
  ref_min?: string;
  ref_max?: string;
  // Present only when the printout shows separate ranges by sex.
  ref_min_male?: string;
  ref_max_male?: string;
  ref_min_female?: string;
  ref_max_female?: string;
}

function bandsFromPrintedRange(finding: PrintedRangeFinding) {
  const male = numericBands(finding.ref_min_male, finding.ref_max_male);
  const female = numericBands(finding.ref_min_female, finding.ref_max_female);

  // Sex-specific ranges take precedence — they're gated by the backend's
  // `patient_gender` condition metric instead of applying unconditionally.
  if (male || female) {
    const entries: {
      conditions: {
        metric: string;
        operation: string;
        value: string;
      }[];
      ranges: NumericBand[];
    }[] = [];
    if (male) {
      entries.push({
        conditions: [
          { metric: "patient_gender", operation: "equality", value: "male" },
        ],
        ranges: male,
      });
    }
    if (female) {
      entries.push({
        conditions: [
          {
            metric: "patient_gender",
            operation: "equality",
            value: "female",
          },
        ],
        ranges: female,
      });
    }
    return entries;
  }

  const ranges = numericBands(finding.ref_min, finding.ref_max);
  if (!ranges) {
    throw new Error("No reference range to write");
  }
  return [{ ranges, conditions: [] }];
}

interface NumericBand {
  interpretation: { display: string };
  min?: string;
  max?: string;
}

function numericBands(min?: string, max?: string): NumericBand[] | null {
  if (!min && !max) return null;

  const ranges: NumericBand[] = [];

  if (min && max) {
    ranges.push({ max: min, interpretation: { display: "Low" } });
    ranges.push({ min, max, interpretation: { display: "Normal" } });
    ranges.push({ min: max, interpretation: { display: "High" } });
  } else if (max) {
    ranges.push({ max, interpretation: { display: "Normal" } });
    ranges.push({ min: max, interpretation: { display: "High" } });
  } else if (min) {
    ranges.push({ max: min, interpretation: { display: "Low" } });
    ranges.push({ min, interpretation: { display: "Normal" } });
  }

  return ranges;
}

function updateBody(
  definition: ObservationDefinitionRead,
  assignments: { componentCode?: string; finding: PrintedRangeFinding }[],
) {
  const slug_value = definition.slug_config?.slug_value;
  if (!slug_value) {
    throw new Error("Observation definition is missing a slug");
  }

  const components = definition.component ?? [];
  let qualified_ranges = definition.qualified_ranges ?? [];
  let component = definition.component;

  if (components.length) {
    const byCode = new Map(
      assignments
        .filter((item) => item.componentCode)
        .map((item) => [item.componentCode as string, item.finding]),
    );
    component = components.map((entry) => {
      const finding = byCode.get(entry.code.code);
      if (!finding) return entry;
      return { ...entry, qualified_ranges: bandsFromPrintedRange(finding) };
    });
  } else {
    const finding = assignments[0]?.finding;
    if (!finding) throw new Error("No reference range to write");
    qualified_ranges = bandsFromPrintedRange(finding);
  }

  return {
    title: definition.title,
    status: definition.status,
    description: definition.description,
    category: definition.category,
    code: definition.code,
    permitted_data_type: definition.permitted_data_type,
    component,
    body_site: definition.body_site ?? null,
    method: definition.method ?? null,
    permitted_unit: definition.permitted_unit ?? null,
    derived_from_uri: definition.derived_from_uri ?? null,
    qualified_ranges,
    slug_value,
  };
}

export async function writeFindingsBatch(
  facilityId: string,
  entries: {
    slug: string;
    assignments: {
      componentCode?: string;
      finding: PrintedRangeFinding;
    }[];
  }[],
): Promise<void> {
  if (!entries.length) return;

  const currents = await Promise.all(
    entries.map((entry) => getObservationDefinition(entry.slug, facilityId)),
  );

  const requests: BatchRequestItem[] = entries.map((entry, index) => ({
    // Batch sub-request URLs are resolved by Django's router against the
    // path only, so no origin here (unlike the direct-fetch helpers above).
    url: `/api/v1/observation_definition/${encodeURIComponent(entry.slug)}/?facility=${encodeURIComponent(facilityId)}`,
    method: "PUT",
    body: updateBody(currents[index], entry.assignments),
    reference_id: entry.slug,
  }));

  const results = await executeBatchRequests(requests);
  const failed = results.filter(
    (result) => result.status_code < 200 || result.status_code >= 300,
  );
  if (failed.length) {
    throw new HttpError({
      message: `Failed to update ${failed.length} of ${entries.length} observation definition(s)`,
      status: failed[0].status_code,
      silent: false,
      cause: { results } as unknown as Record<string, unknown>,
    });
  }
}
