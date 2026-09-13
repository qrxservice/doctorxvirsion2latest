export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function storageUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("/objects/")) return `/api/storage${path}`;
  return path;
}

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImageType(type?: string | null): boolean {
  return !!type && type.startsWith("image/");
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Fetch a stored object with the doctor's bearer token and return a local blob
 * object URL. Required for PRIVATE objects (chat media): browser `<img>`/`<a>`
 * requests don't carry the localStorage token, so direct URLs 403. Public
 * objects (doctor photos) can still use `storageUrl()` directly in `<img src>`.
 * Caller owns the returned URL and must `URL.revokeObjectURL` it when done.
 */
export async function fetchObjectBlobUrl(path?: string | null): Promise<string | undefined> {
  const url = storageUrl(path);
  if (!url) return undefined;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load attachment");
  return URL.createObjectURL(await res.blob());
}

/** Download a private object by fetching it (with auth) then triggering a save. */
export async function downloadObject(path?: string | null, filename?: string | null): Promise<void> {
  const objectUrl = await fetchObjectBlobUrl(path);
  if (!objectUrl) return;
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
