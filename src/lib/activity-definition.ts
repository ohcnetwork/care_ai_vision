import { getHeaders, HttpError, type PaginatedResponse } from "@/lib/request";
import type { ObservationDefinitionRead } from "@/lib/observation-definition";

export interface ActivityDefinitionRead {
  id: string;
  slug: string;
  title: string;
  status: string;
}

/** Detail view — includes the observation definitions this order type requires. */
export interface ActivityDefinitionDetail extends ActivityDefinitionRead {
  observation_result_requirements: ObservationDefinitionRead[];
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

export async function searchActivityDefinitions(
  facilityId: string,
  title = "",
  offset = 0,
): Promise<ActivityDefinitionRead[]> {
  const query: Record<string, string> = {
    status: "active",
    limit: "15",
    offset: String(offset),
    ordering: "-created_date",
  };
  if (title.trim()) query.title = title.trim();
  const res = await fetch(
    apiUrl(
      `/api/v1/facility/${encodeURIComponent(facilityId)}/activity_definition/`,
      query,
    ),
    { headers: getHeaders() },
  );
  const data = await readJson<PaginatedResponse<ActivityDefinitionRead>>(res);
  return data.results ?? [];
}

export async function getActivityDefinition(
  slug: string,
  facilityId: string,
): Promise<ActivityDefinitionDetail> {
  const res = await fetch(
    apiUrl(
      `/api/v1/facility/${encodeURIComponent(facilityId)}/activity_definition/${encodeURIComponent(slug)}/`,
    ),
    { headers: getHeaders() },
  );
  return readJson<ActivityDefinitionDetail>(res);
}
