import { getHeaders } from "@/lib/request";

interface FileCreateResponse {
  id: string;
  signed_url: string;
  internal_name: string;
}

/**
 * Persist a scanned file to CARE's file storage, attached to a diagnostic report.
 * Mirrors care_fe's useFileUpload flow: create -> PUT to signed URL -> mark upload completed.
 */
export async function uploadDiagnosticReportFile(
  file: File,
  reportId: string,
  displayName: string,
): Promise<void> {
  const createUrl = new URL("/api/v1/files/", window.CARE_API_URL);
  const createRes = await fetch(createUrl.toString(), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      original_name: file.name,
      name: displayName,
      file_type: "diagnostic_report",
      file_category: "unspecified",
      associating_id: reportId,
      mime_type: file.type,
    }),
  });

  if (!createRes.ok) {
    throw new Error(`Failed to register file: ${createRes.status}`);
  }

  const created: FileCreateResponse = await createRes.json();
  // The signed URL expects the object to be named after internal_name, not the original filename.
  const renamedFile = new File([file], created.internal_name, {
    type: file.type,
  });

  const uploadRes = await fetch(created.signed_url, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: renamedFile,
  });

  if (!uploadRes.ok) {
    throw new Error(`Failed to upload file: ${uploadRes.status}`);
  }

  const completeUrl = new URL(
    `/api/v1/files/${created.id}/mark_upload_completed/`,
    window.CARE_API_URL,
  );
  const completeRes = await fetch(completeUrl.toString(), {
    method: "POST",
    headers: getHeaders(),
  });

  if (!completeRes.ok) {
    throw new Error(`Failed to finalize file upload: ${completeRes.status}`);
  }
}
