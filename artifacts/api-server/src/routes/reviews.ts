import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, patientReviewsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/doctors/:id/reviews", async (req, res): Promise<void> => {
  const doctorId = parseInt(req.params.id);
  const reviews = await db.select().from(patientReviewsTable)
    .where(and(eq(patientReviewsTable.doctorId, doctorId), eq(patientReviewsTable.isApproved, true)));
  const avgRating = reviews.length > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    : 0;
  res.json({ reviews, avgRating: Math.round(avgRating * 10) / 10, total: reviews.length });
});

router.post("/reviews", async (req, res): Promise<void> => {
  const { doctorId, patientName, patientPhone, rating, reviewText, appointmentId } = req.body;
  if (!doctorId || !patientName || !rating) { res.status(400).json({ error: "doctorId, patientName, rating required" }); return; }
  if (rating < 1 || rating > 5) { res.status(400).json({ error: "Rating must be 1-5" }); return; }
  const [review] = await db.insert(patientReviewsTable).values({ doctorId, patientName, patientPhone, rating, reviewText, appointmentId, isApproved: false }).returning();
  res.status(201).json({ ...review, message: "Review submitted and pending approval" });
});

router.post("/admin/reviews/:id/approve", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const [review] = await db.update(patientReviewsTable).set({ isApproved: true }).where(eq(patientReviewsTable.id, id)).returning();
  if (!review) { res.status(404).json({ error: "Review not found" }); return; }
  res.json(review);
});

router.post("/admin/reviews/:id/reject", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  await db.delete(patientReviewsTable).where(eq(patientReviewsTable.id, id));
  res.json({ message: "Review deleted" });
});

router.get("/admin/reviews", async (req, res): Promise<void> => {
  const reviews = await db.select().from(patientReviewsTable).orderBy(patientReviewsTable.createdAt);
  res.json(reviews);
});

export default router;
