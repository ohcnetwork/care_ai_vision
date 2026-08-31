import { getHeaders, HttpError } from "@/lib/request";

export interface BatchRequestItem {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  reference_id: string;
}

export interface BatchRequestResult<T = unknown> {
  reference_id: string;
  status_code: number;
  data?: T;
}

export interface BatchRequestResponse<T = unknown> {
  results: BatchRequestResult<T>[];
}

/** care backend caps sub-requests per call (MAX_REQUESTS_PER_BATCH_REQUEST, default 20). */
export const BATCH_REQUEST_CHUNK_SIZE = 20;

/**
 * Runs `requests` against POST /api/v1/batch_requests/, chunked to stay under
 * the backend's per-call limit. Each chunk runs as its own atomic transaction
 * (see care/emr/api/viewsets/batch_request.py) — a failure in one chunk does
 * not roll back an already-committed earlier chunk.
 */
export async function executeBatchRequests<T = unknown>(
  requests: BatchRequestItem[],
): Promise<BatchRequestResult<T>[]> {
  const results: BatchRequestResult<T>[] = [];
  for (let i = 0; i < requests.length; i += BATCH_REQUEST_CHUNK_SIZE) {
    const chunk = requests.slice(i, i + BATCH_REQUEST_CHUNK_SIZE);
    const res = await fetch(new URL("/api/v1/batch_requests/", window.CARE_API_URL), {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ requests: chunk }),
    });
    const data = await res.json().catch(() => ({}));
    const response = data as BatchRequestResponse<T>;
    if (!Array.isArray(response.results)) {
      throw new HttpError({
        message: `Batch request failed (${res.status})`,
        status: res.status,
        silent: false,
        cause: data as Record<string, unknown>,
      });
    }
    results.push(...response.results);
  }
  return results;
}
