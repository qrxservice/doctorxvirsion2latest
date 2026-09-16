/**
 * Storage routes — local-disk backend.
 *
 * Files are stored on disk under UPLOAD_DIR (env var, default: <cwd>/uploads).
 * Each upload category gets its own subdirectory:
 *   uploads/doctors/       — doctor profile photos
 *   uploads/prescriptions/ — prescription PDFs / lab reports
 *   uploads/chat/          — chat message attachments
 *   uploads/banners/       — hero / banner images
 *   uploads/blog/          — blog post cover images
 *   uploads/shop/          — shop product images
 *   uploads/general/       — anything not assigned a category
 *
 * objectPath stored in the database: /objects/uploads/<category>/<uuid>
 * This is stable across backend changes — a future GCS migration only needs
 * to swap how files are stored/served, not the database values.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { createReadStream, createWriteStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import { eq, or, and } from "drizzle-orm";
import {
  db,
  usersTable,
  doctorsTable,
  chatMessagesTable,
  chatConversationsTable,
  appointmentsTable,
  appSettingsTable,
  blogPostsTable,
  paymentGatewaysTable,
} from "@workspace/db";
import { RequestUploadUrlBody } from "@workspace/api-zod";
import { ObjectNotFoundError, UPLOAD_CATEGORIES, isValidCategory, type UploadCategory } from "../lib/objectStorage";
import { verifyAuthToken } from "../lib/token";

const router: IRouter = Router();

// ── Storage directory ─────────────────────────────────────────────────────────
// Configurable via UPLOAD_DIR env var; defaults to <api-server cwd>/uploads.
// Set UPLOAD_DIR to an absolute path for production (e.g. /var/www/doctorx/uploads).
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(process.cwd(), "uploads");

async function ensureUploadDirs(): Promise<void> {
  for (const category of UPLOAD_CATEGORIES) {
    await fs.mkdir(path.join(UPLOAD_DIR, category), { recursive: true });
  }
}

// Ensure all category directories exist on startup.
ensureUploadDirs().catch((err) => {
  console.error("Failed to create upload directories:", err);
});

// ── Limits ────────────────────────────────────────────────────────────────────
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

// ── Auth helpers ──────────────────────────────────────────────────────────────
async function getDoctorFromAuth(auth: string | undefined) {
  const claims = verifyAuthToken(auth);
  if (!claims) return null;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    if (!user?.doctorId) return null;
    const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, user.doctorId));
    return doc ?? null;
  } catch {
    return null;
  }
}

async function getUserFromAuth(auth: string | undefined) {
  const claims = verifyAuthToken(auth);
  if (!claims) return null;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    return user ?? null;
  } catch {
    return null;
  }
}

// ── Access control ────────────────────────────────────────────────────────────

interface ObjectAccess {
  /** Whether the requesting party may read the object at all. */
  allowed: boolean;
  /**
   * true  → public asset (profile photo, banner, blog cover, shop image, QR code)
   *         → safe to cache publicly (Cache-Control: public)
   * false → private PHI (chat media, lab report, prescription upload)
   *         → must not be cached by shared/intermediate caches
   */
  isPublic: boolean;
}

/**
 * Returns access decision and cache-ability for an objectPath.
 *
 * Public assets (profile photos, QR codes, hero/banner images, blog covers,
 * shop product images) are readable by anyone and may be publicly cached.
 *
 * Private PHI (chat media, lab reports, prescription uploads) is restricted
 * to the owning doctor and must never be stored in shared caches.
 */
async function checkObjectAccess(
  objectPath: string,
  doctorId: number | null,
): Promise<ObjectAccess> {
  // ── Public assets ─────────────────────────────────────────────────────────
  // Doctor profile photos — public.
  const [photoOwner] = await db
    .select({ id: doctorsTable.id })
    .from(doctorsTable)
    .where(eq(doctorsTable.photoUrl, objectPath))
    .limit(1);
  if (photoOwner) return { allowed: true, isPublic: true };

  // User profile pictures — public.
  const [userPhotoOwner] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.profilePicture, objectPath))
    .limit(1);
  if (userPhotoOwner) return { allowed: true, isPublic: true };

  // Homepage hero background, site logo, favicon, footer logo — public.
  const [appSettingMatch] = await db
    .select({ id: appSettingsTable.id })
    .from(appSettingsTable)
    .where(
      or(
        eq(appSettingsTable.heroImageUrl, objectPath),
        eq(appSettingsTable.siteLogoUrl, objectPath),
        eq(appSettingsTable.faviconUrl, objectPath),
        eq(appSettingsTable.footerLogoUrl, objectPath),
      ),
    )
    .limit(1);
  if (appSettingMatch) return { allowed: true, isPublic: true };

  // Bangla QR code image — public.
  const [qrOwner] = await db
    .select({ id: paymentGatewaysTable.id })
    .from(paymentGatewaysTable)
    .where(eq(paymentGatewaysTable.qrImageUrl, objectPath))
    .limit(1);
  if (qrOwner) return { allowed: true, isPublic: true };

  // Blog cover images — public.
  const [blogCover] = await db
    .select({ id: blogPostsTable.id })
    .from(blogPostsTable)
    .where(eq(blogPostsTable.coverImageUrl, objectPath))
    .limit(1);
  if (blogCover) return { allowed: true, isPublic: true };

  // Shop product images — public.
  try {
    const { shopProductsTable } = await import("@workspace/db");
    const [productImg] = await db
      .select({ id: shopProductsTable.id })
      .from(shopProductsTable)
      .where(eq(shopProductsTable.imageUrl, objectPath))
      .limit(1);
    if (productImg) return { allowed: true, isPublic: true };
  } catch {
    /* table may not exist in older schema — ignore */
  }

  // ── Private / PHI assets (doctor-restricted) ──────────────────────────────
  if (!doctorId) return { allowed: false, isPublic: false };

  // Appointment lab reports / prescription uploads.
  const [apptDoc] = await db
    .select({ id: appointmentsTable.id })
    .from(appointmentsTable)
    .where(
      and(
        eq(appointmentsTable.doctorId, doctorId),
        or(
          eq(appointmentsTable.labReportUrl, objectPath),
          eq(appointmentsTable.prescriptionUploadUrl, objectPath),
        ),
      ),
    )
    .limit(1);
  if (apptDoc) return { allowed: true, isPublic: false };

  // Chat media — restricted to conversation participants.
  const [row] = await db
    .select({ convId: chatMessagesTable.conversationId })
    .from(chatMessagesTable)
    .innerJoin(
      chatConversationsTable,
      eq(chatMessagesTable.conversationId, chatConversationsTable.id),
    )
    .where(
      and(
        eq(chatMessagesTable.attachmentUrl, objectPath),
        or(
          eq(chatConversationsTable.doctor1Id, doctorId),
          eq(chatConversationsTable.doctor2Id, doctorId),
        ),
      ),
    )
    .limit(1);
  if (row) return { allowed: true, isPublic: false };

  return { allowed: false, isPublic: false };
}

// ── Path helpers ──────────────────────────────────────────────────────────────

/** Strict UUID v4 pattern. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Convert an objectPath to the absolute filesystem path under UPLOAD_DIR.
 *
 * Supported formats:
 *   /objects/uploads/<category>/<uuid>   — current (categorized)
 *   /objects/uploads/<uuid>             — legacy (flat, pre-category migration)
 *
 * Legacy paths fall back to UPLOAD_DIR/general/<uuid> so old database records
 * continue to resolve after the migration.
 */
function objectPathToFilePath(objectPath: string): string {
  const PREFIX = "/objects/uploads/";
  if (!objectPath.startsWith(PREFIX)) {
    throw new ObjectNotFoundError();
  }
  const relative = objectPath.slice(PREFIX.length); // e.g. "doctors/<uuid>" or "<uuid>"
  const parts = relative.split("/");

  let resolvedRelative: string;
  if (parts.length === 1) {
    // Legacy flat path: /objects/uploads/<uuid> → general/<uuid>
    resolvedRelative = path.join("general", parts[0]);
  } else {
    // Categorized path: /objects/uploads/<category>/<uuid>
    resolvedRelative = path.join(...parts);
  }

  // Guard against path traversal
  const resolved = path.resolve(UPLOAD_DIR, resolvedRelative);
  if (!resolved.startsWith(UPLOAD_DIR + path.sep)) {
    throw new ObjectNotFoundError();
  }
  return resolved;
}

// ── POST /storage/uploads/request-url ────────────────────────────────────────
// Returns a direct-upload URL pointing at this server, plus the objectPath to
// store in the database.
//
// Request body:
//   { name, size, contentType, category? }
//   category: one of doctors|prescriptions|chat|banners|blog|shop|general
//             Defaults to "general" if omitted or unrecognised.
//
// Access rules:
//   - Any authenticated user may upload.
//   - Patients are restricted to the "general" category only (profile photos
//     land there). PHI categories (prescriptions, chat) require a doctor/admin.
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const user = await getUserFromAuth(req.headers.authorization);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  const { name, size, contentType, category: rawCategory } = parsed.data;

  if (typeof size === "number" && (size <= 0 || size > MAX_UPLOAD_BYTES)) {
    res.status(400).json({ error: "File exceeds the 5 MB limit" });
    return;
  }
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    res.status(400).json({ error: "Unsupported file type" });
    return;
  }

  // Patients may only upload to the "general" category.
  // PHI categories (prescriptions, chat) require a doctor or admin account.
  const isPatient = user.role === "patient";
  const PHI_CATEGORIES: UploadCategory[] = ["prescriptions", "chat"];
  if (isPatient && isValidCategory(rawCategory) && PHI_CATEGORIES.includes(rawCategory)) {
    res.status(403).json({ error: "Not permitted" });
    return;
  }

  // Patients always land in "general" regardless of what category they request.
  const resolvedCategory = isPatient ? "general" : (isValidCategory(rawCategory) ? rawCategory : "general");
  const category: UploadCategory = resolvedCategory;
  const uuid = randomUUID();

  // Ensure the category directory exists.
  await fs.mkdir(path.join(UPLOAD_DIR, category), { recursive: true });

  const uploadURL = `/api/storage/uploads/direct/${category}/${uuid}`;
  const objectPath = `/objects/uploads/${category}/${uuid}`;

  res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
});

// ── PUT /storage/uploads/direct/:category/:uuid ───────────────────────────────
// Receives the raw file body PUT by the browser and saves it to disk.
// No bearer auth — the <category>/<uuid> path acts as the upload token
// (equivalent to a presigned URL).
router.put("/storage/uploads/direct/:category/:uuid", async (req: Request, res: Response) => {
  const category = String(req.params.category ?? "");
  const uuid = String(req.params.uuid ?? "");

  if (!isValidCategory(category)) {
    res.status(400).json({ error: "Invalid upload category" });
    return;
  }
  if (!UUID_RE.test(uuid)) {
    res.status(400).json({ error: "Invalid upload ID" });
    return;
  }

  // Enforce content-type allowlist on the actual upload, not just on the
  // request-url step, so a caller cannot swap the MIME type between the two
  // requests.
  const contentType = (req.headers["content-type"] || "").split(";")[0].trim();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    res.status(400).json({ error: "Unsupported file type" });
    return;
  }

  try {
    await fs.mkdir(path.join(UPLOAD_DIR, category), { recursive: true });

    const filePath = path.join(UPLOAD_DIR, category, uuid);

    // Stream request body → file
    await pipeline(req, createWriteStream(filePath));

    // Persist content-type so we can serve the correct MIME type later
    await fs.writeFile(`${filePath}.meta`, JSON.stringify({ contentType }), "utf-8");

    res.json({ ok: true });
  } catch (error) {
    req.log.error({ err: error }, "Error saving uploaded file");
    res.status(500).json({ error: "Failed to save file" });
  }
});

// ── GET /storage/objects/*path ────────────────────────────────────────────────
// Serve stored objects after access-control check.
// objectPath in DB: /objects/uploads/<category>/<uuid>
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    const doc = await getDoctorFromAuth(req.headers.authorization);
    const access = await checkObjectAccess(objectPath, doc?.id ?? null);
    if (!access.allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    let filePath: string;
    try {
      filePath = objectPathToFilePath(objectPath);
    } catch {
      res.status(404).json({ error: "File not found" });
      return;
    }

    try {
      await fs.access(filePath);
    } catch {
      res.status(404).json({ error: "File not found" });
      return;
    }

    let contentType = "application/octet-stream";
    try {
      const meta = JSON.parse(await fs.readFile(`${filePath}.meta`, "utf-8"));
      contentType = meta.contentType || contentType;
    } catch {
      /* no meta file — use default */
    }

    res.setHeader("Content-Type", contentType);
    // Public assets (profile photos, banners, etc.) may be cached by CDNs and
    // browsers. Private PHI (chat media, lab reports, prescriptions) must never
    // be stored in shared/intermediate caches.
    res.setHeader(
      "Cache-Control",
      access.isPublic ? "public, max-age=86400" : "private, no-store",
    );
    createReadStream(filePath).pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

// ── GET /storage/public-objects/*filePath ─────────────────────────────────────
// Kept for API compatibility. Public objects are now served via the regular
// /storage/objects/ route with the canReadObject access-control function.
// This endpoint returns 404 in local-disk mode (no separate public bucket).
router.get("/storage/public-objects/*filePath", async (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not available — use /storage/objects/ instead" });
});

export default router;
