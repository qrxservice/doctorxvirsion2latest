import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, blogPostsTable } from "@workspace/db";
import { getActor, writeAudit } from "../lib/admin";

const router: IRouter = Router();

function serialize(p: typeof blogPostsTable.$inferSelect) {
  return {
    ...p,
    publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function uniqueSlug(base: string, ignoreId?: number): Promise<string> {
  let candidate = base || `post-${Date.now()}`;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const [existing] = await db.select().from(blogPostsTable).where(eq(blogPostsTable.slug, candidate));
    if (!existing || existing.id === ignoreId) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

// Public list (published only) / admin list (all when ?all=true).
router.get("/blog-posts", async (req, res): Promise<void> => {
  const wantAll = req.query.all === "true";
  let rows = await db.select().from(blogPostsTable).orderBy(desc(blogPostsTable.createdAt));
  if (wantAll) {
    const actor = await getActor(req.headers.authorization);
    if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  } else {
    rows = rows.filter(p => p.status === "published");
    rows.sort((a, b) => {
      const at = (a.publishedAt ?? a.createdAt).getTime();
      const bt = (b.publishedAt ?? b.createdAt).getTime();
      return bt - at;
    });
  }
  res.json(rows.map(serialize));
});

// Public — fetch a published post by slug.
router.get("/blog-posts/slug/:slug", async (req, res): Promise<void> => {
  const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
  const [post] = await db.select().from(blogPostsTable).where(eq(blogPostsTable.slug, slug));
  if (!post || post.status !== "published") { res.status(404).json({ error: "Not found" }); return; }
  res.json(serialize(post));
});

// Admin — fetch any post (incl. drafts) by id for editing.
router.get("/blog-posts/:id", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [post] = await db.select().from(blogPostsTable).where(eq(blogPostsTable.id, id));
  if (!post) { res.status(404).json({ error: "Not found" }); return; }
  res.json(serialize(post));
});

router.post("/blog-posts", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const { title, slug, excerpt, content, coverImageUrl, authorName, status,
          category, tags, seoTitle, metaDescription, focusKeyword, canonicalUrl } = req.body;
  if (!title) { res.status(400).json({ error: "Title required" }); return; }
  const finalStatus = status === "published" ? "published" : "draft";
  const finalSlug = await uniqueSlug(slugify(slug || title));
  const [post] = await db.insert(blogPostsTable).values({
    title,
    slug: finalSlug,
    excerpt: excerpt ?? null,
    content: content ?? "",
    coverImageUrl: coverImageUrl || null,
    authorName: authorName ?? actor.name ?? null,
    category: category ?? null,
    tags: tags ?? null,
    seoTitle: seoTitle ?? null,
    metaDescription: metaDescription ?? null,
    focusKeyword: focusKeyword ?? null,
    canonicalUrl: canonicalUrl ?? null,
    status: finalStatus,
    publishedAt: finalStatus === "published" ? new Date() : null,
  }).returning();
  await writeAudit(actor, "create", "blog_post", post.id, title);
  res.status(201).json(serialize(post));
});

router.patch("/blog-posts/:id", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [current] = await db.select().from(blogPostsTable).where(eq(blogPostsTable.id, id));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }
  const { title, slug, excerpt, content, coverImageUrl, authorName, status,
          category, tags, seoTitle, metaDescription, focusKeyword, canonicalUrl } = req.body;
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (slug !== undefined) updates.slug = await uniqueSlug(slugify(slug || title || current.title), id);
  if (excerpt !== undefined) updates.excerpt = excerpt;
  if (content !== undefined) updates.content = content;
  if (coverImageUrl !== undefined) updates.coverImageUrl = coverImageUrl || null;
  if (authorName !== undefined) updates.authorName = authorName;
  if (category !== undefined) updates.category = category ?? null;
  if (tags !== undefined) updates.tags = tags ?? null;
  if (seoTitle !== undefined) updates.seoTitle = seoTitle ?? null;
  if (metaDescription !== undefined) updates.metaDescription = metaDescription ?? null;
  if (focusKeyword !== undefined) updates.focusKeyword = focusKeyword ?? null;
  if (canonicalUrl !== undefined) updates.canonicalUrl = canonicalUrl ?? null;
  if (status !== undefined) {
    const finalStatus = status === "published" ? "published" : "draft";
    updates.status = finalStatus;
    // Stamp publishedAt the first time it goes live; clear when reverted to draft.
    if (finalStatus === "published" && current.status !== "published") updates.publishedAt = new Date();
    if (finalStatus === "draft") updates.publishedAt = null;
  }
  const [post] = await db.update(blogPostsTable).set(updates).where(eq(blogPostsTable.id, id)).returning();
  await writeAudit(actor, "update", "blog_post", id);
  res.json(serialize(post));
});

router.delete("/blog-posts/:id", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  await db.delete(blogPostsTable).where(eq(blogPostsTable.id, id));
  await writeAudit(actor, "delete", "blog_post", id);
  res.sendStatus(204);
});

export default router;
