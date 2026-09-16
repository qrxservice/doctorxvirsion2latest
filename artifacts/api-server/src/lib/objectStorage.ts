/**
 * Object Storage — local-disk implementation.
 *
 * The public API (ObjectNotFoundError + UPLOAD_CATEGORIES) is kept intentionally
 * thin so that a future GCS migration only needs to swap the implementation in
 * routes/storage.ts without touching the database schema.
 *
 * Database design contract (never change these):
 *   - objectPath values always start with "/objects/uploads/"
 *   - The path segments after that prefix mirror the on-disk layout:
 *       /objects/uploads/<category>/<uuid>
 *   - storageUrl() in the frontend converts objectPath → the API serve URL
 *
 * Future GCS migration checklist:
 *   1. Restore @google-cloud/storage dependency
 *   2. Implement GCS upload signing here
 *   3. Implement GCS object serving here
 *   4. Update routes/storage.ts to call GCS methods instead of local fs
 *   5. No database column changes required — objectPaths remain identical
 */

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

/** All valid upload categories, each maps to a subdirectory under UPLOAD_DIR. */
export const UPLOAD_CATEGORIES = [
  "doctors",
  "prescriptions",
  "chat",
  "banners",
  "blog",
  "shop",
  "general",
] as const;

export type UploadCategory = (typeof UPLOAD_CATEGORIES)[number];

export function isValidCategory(value: unknown): value is UploadCategory {
  return typeof value === "string" && (UPLOAD_CATEGORIES as readonly string[]).includes(value);
}
