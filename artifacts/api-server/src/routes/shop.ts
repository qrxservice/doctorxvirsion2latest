import { Router, type IRouter } from "express";
import { eq, ilike, and, or, isNull, sql } from "drizzle-orm";
import { db, shopProductsTable, shopCartTable, shopOrdersTable, shopOrderItemsTable, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { verifyAuthToken } from "../lib/token";
import { isAdmin } from "../lib/admin";
import { notify, notifyAdmins } from "../lib/notify";
import { sendEmail } from "../lib/messaging";

const router: IRouter = Router();

function authMiddleware(req: any, res: any, next: any) {
  const claims = verifyAuthToken(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Invalid token" }); return; }
  req.userId = claims.userId;
  next();
}

async function adminMiddleware(req: any, res: any, next: any) {
  const claims = verifyAuthToken(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Invalid token" }); return; }
  // Trust the persisted role, not the token's role claim.
  if (!(await isAdmin(req.headers.authorization))) { res.status(403).json({ error: "Admin only" }); return; }
  req.userId = claims.userId;
  next();
}

// GET /shop/products
router.get("/shop/products", async (req, res): Promise<void> => {
  try {
    const { category, search, featured, limit = "20", page = "1" } = req.query as Record<string, string>;
    const lim = Math.min(parseInt(limit) || 20, 100);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * lim;

    const conditions = [eq(shopProductsTable.isActive, true)];
    if (category && category !== "all") conditions.push(eq(shopProductsTable.category, category));
    if (search) conditions.push(ilike(shopProductsTable.name, `%${search}%`));
    if (featured === "true") conditions.push(eq(shopProductsTable.isFeatured, true));

    const products = await db.select().from(shopProductsTable)
      .where(and(...conditions)).limit(lim).offset(offset)
      .orderBy(shopProductsTable.isFeatured, shopProductsTable.id);
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(shopProductsTable).where(and(...conditions));

    res.json({ products, total: count });
  } catch (err) {
    logger.error({ err }, "listShopProducts error");
    res.status(500).json({ error: "Server error" });
  }
});

// POST /shop/products (admin)
router.post("/shop/products", adminMiddleware, async (req, res): Promise<void> => {
  try {
    const data = req.body;
    const [product] = await db.insert(shopProductsTable).values({
      name: data.name, description: data.description, price: data.price,
      originalPrice: data.originalPrice, category: data.category || "general",
      imageUrl: data.imageUrl, stockQty: data.stockQty ?? 0, isActive: data.isActive ?? true,
      isFeatured: data.isFeatured ?? false, tags: data.tags,
    }).returning();
    res.status(201).json(product);
  } catch (err) {
    logger.error({ err }, "createShopProduct error");
    res.status(500).json({ error: "Server error" });
  }
});

// GET /shop/products/:id
router.get("/shop/products/:id", async (req, res): Promise<void> => {
  try {
    const [product] = await db.select().from(shopProductsTable)
      .where(eq(shopProductsTable.id, parseInt(req.params.id)));
    if (!product) { res.status(404).json({ error: "Not found" }); return; }
    res.json(product);
  } catch (err) {
    logger.error({ err }, "getShopProduct error");
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /shop/products/:id (admin)
router.put("/shop/products/:id", adminMiddleware, async (req, res): Promise<void> => {
  try {
    const data = req.body;
    const [product] = await db.update(shopProductsTable).set({
      name: data.name, description: data.description, price: data.price,
      originalPrice: data.originalPrice, category: data.category,
      imageUrl: data.imageUrl, stockQty: data.stockQty, isActive: data.isActive,
      isFeatured: data.isFeatured, tags: data.tags,
    }).where(eq(shopProductsTable.id, parseInt(req.params.id))).returning();
    if (!product) { res.status(404).json({ error: "Not found" }); return; }
    res.json(product);
  } catch (err) {
    logger.error({ err }, "updateShopProduct error");
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /shop/products/:id (admin)
router.delete("/shop/products/:id", adminMiddleware, async (req, res): Promise<void> => {
  try {
    await db.delete(shopProductsTable).where(eq(shopProductsTable.id, parseInt(req.params.id)));
    res.json({ message: "Deleted" });
  } catch (err) {
    logger.error({ err }, "deleteShopProduct error");
    res.status(500).json({ error: "Server error" });
  }
});

// GET /shop/cart
router.get("/shop/cart", authMiddleware, async (req: any, res): Promise<void> => {
  try {
    const items = await db.select().from(shopCartTable).where(eq(shopCartTable.userId, req.userId));
    const itemsWithProducts = await Promise.all(items.map(async (item) => {
      const [product] = await db.select().from(shopProductsTable).where(eq(shopProductsTable.id, item.productId));
      return { ...item, product };
    }));
    res.json(itemsWithProducts);
  } catch (err) {
    logger.error({ err }, "getCart error");
    res.status(500).json({ error: "Server error" });
  }
});

// POST /shop/cart
router.post("/shop/cart", authMiddleware, async (req: any, res): Promise<void> => {
  try {
    const { productId, quantity = 1 } = req.body;
    const existing = await db.select().from(shopCartTable)
      .where(and(eq(shopCartTable.userId, req.userId), eq(shopCartTable.productId, productId)));
    if (existing.length > 0) {
      const [updated] = await db.update(shopCartTable)
        .set({ quantity: existing[0].quantity + quantity })
        .where(eq(shopCartTable.id, existing[0].id)).returning();
      res.json(updated);
    } else {
      const [item] = await db.insert(shopCartTable).values({ userId: req.userId, productId, quantity }).returning();
      res.status(201).json(item);
    }
  } catch (err) {
    logger.error({ err }, "addToCart error");
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /shop/cart/:id
router.put("/shop/cart/:id", authMiddleware, async (req: any, res): Promise<void> => {
  try {
    const { quantity } = req.body;
    const [item] = await db.update(shopCartTable).set({ quantity })
      .where(and(eq(shopCartTable.id, parseInt(req.params.id)), eq(shopCartTable.userId, req.userId))).returning();
    if (!item) { res.status(404).json({ error: "Not found" }); return; }
    res.json(item);
  } catch (err) {
    logger.error({ err }, "updateCartItem error");
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /shop/cart/:id
router.delete("/shop/cart/:id", authMiddleware, async (req: any, res): Promise<void> => {
  try {
    await db.delete(shopCartTable)
      .where(and(eq(shopCartTable.id, parseInt(req.params.id)), eq(shopCartTable.userId, req.userId)));
    res.json({ message: "Removed" });
  } catch (err) {
    logger.error({ err }, "removeFromCart error");
    res.status(500).json({ error: "Server error" });
  }
});

// GET /shop/orders
router.get("/shop/orders", authMiddleware, async (req: any, res): Promise<void> => {
  try {
    const orders = await db.select().from(shopOrdersTable)
      .where(eq(shopOrdersTable.userId, req.userId))
      .orderBy(sql`${shopOrdersTable.createdAt} desc`);
    const ordersWithItems = await Promise.all(orders.map(async (order) => {
      const items = await db.select().from(shopOrderItemsTable).where(eq(shopOrderItemsTable.orderId, order.id));
      const itemsWithProducts = await Promise.all(items.map(async (item) => {
        const [product] = await db.select().from(shopProductsTable).where(eq(shopProductsTable.id, item.productId));
        return { ...item, product };
      }));
      return { ...order, items: itemsWithProducts };
    }));
    res.json(ordersWithItems);
  } catch (err) {
    logger.error({ err }, "listMyOrders error");
    res.status(500).json({ error: "Server error" });
  }
});

// POST /shop/orders
router.post("/shop/orders", authMiddleware, async (req: any, res): Promise<void> => {
  try {
    const { shippingName, shippingPhone, shippingAddress, shippingCity, notes } = req.body;
    const cartItems = await db.select().from(shopCartTable).where(eq(shopCartTable.userId, req.userId));
    if (cartItems.length === 0) { res.status(400).json({ error: "Cart is empty" }); return; }

    const itemsWithProducts = await Promise.all(cartItems.map(async (ci) => {
      const [product] = await db.select().from(shopProductsTable).where(eq(shopProductsTable.id, ci.productId));
      return { ...ci, product };
    }));

    const totalAmount = itemsWithProducts.reduce((sum, ci) => {
      return sum + (parseFloat(ci.product?.price ?? "0") * ci.quantity);
    }, 0).toFixed(2);

    const [order] = await db.insert(shopOrdersTable).values({
      userId: req.userId, status: "pending", totalAmount,
      shippingName, shippingPhone, shippingAddress, shippingCity, notes,
    }).returning();

    const orderItems = await db.insert(shopOrderItemsTable).values(
      itemsWithProducts.map(ci => ({
        orderId: order.id, productId: ci.productId,
        quantity: ci.quantity, priceAtPurchase: ci.product?.price ?? "0",
      }))
    ).returning();

    await db.delete(shopCartTable).where(eq(shopCartTable.userId, req.userId));

    res.status(201).json({ ...order, items: orderItems });
  } catch (err) {
    logger.error({ err }, "placeOrder error");
    res.status(500).json({ error: "Server error" });
  }
});

// GET /shop/orders/track — public order tracking by phone + order id (must be before /:id)
router.get("/shop/orders/track", async (req, res): Promise<void> => {
  try {
    const { phone, orderId } = req.query as Record<string, string>;
    if (!phone || !orderId) { res.status(400).json({ error: "phone and orderId required" }); return; }
    const id = parseInt(orderId);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid orderId" }); return; }
    const [order] = await db.select().from(shopOrdersTable)
      .where(and(eq(shopOrdersTable.id, id), eq(shopOrdersTable.shippingPhone, phone)));
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    const items = await db.select().from(shopOrderItemsTable).where(eq(shopOrderItemsTable.orderId, order.id));
    const itemsWithProducts = await Promise.all(items.map(async (item) => {
      const [product] = await db.select().from(shopProductsTable).where(eq(shopProductsTable.id, item.productId));
      return { ...item, product };
    }));
    res.json({ ...order, items: itemsWithProducts });
  } catch (err) {
    logger.error({ err }, "trackOrder error");
    res.status(500).json({ error: "Server error" });
  }
});

// GET /shop/orders/:id
router.get("/shop/orders/:id", authMiddleware, async (req: any, res): Promise<void> => {
  try {
    const [order] = await db.select().from(shopOrdersTable)
      .where(and(eq(shopOrdersTable.id, parseInt(req.params.id)), eq(shopOrdersTable.userId, req.userId)));
    if (!order) { res.status(404).json({ error: "Not found" }); return; }
    const items = await db.select().from(shopOrderItemsTable).where(eq(shopOrderItemsTable.orderId, order.id));
    const itemsWithProducts = await Promise.all(items.map(async (item) => {
      const [product] = await db.select().from(shopProductsTable).where(eq(shopProductsTable.id, item.productId));
      return { ...item, product };
    }));
    res.json({ ...order, items: itemsWithProducts });
  } catch (err) {
    logger.error({ err }, "getOrder error");
    res.status(500).json({ error: "Server error" });
  }
});

// POST /shop/orders/:id/pay/bangla-qr — Customer submits transaction ID after scanning QR
router.post("/shop/orders/:id/pay/bangla-qr", authMiddleware, async (req: any, res): Promise<void> => {
  try {
    const orderId = parseInt(req.params.id);
    const { transactionId, screenshotUrl } = req.body;

    if (!transactionId || !String(transactionId).trim()) {
      res.status(400).json({ error: "Transaction ID is required" });
      return;
    }

    // Verify the order belongs to this user and is in a payable state.
    const [order] = await db.select().from(shopOrdersTable)
      .where(and(eq(shopOrdersTable.id, orderId), eq(shopOrdersTable.userId, req.userId)));
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    if (order.paymentStatus === "paid") {
      res.status(400).json({ error: "Order already paid" });
      return;
    }

    // Block re-submission if already in a terminal or pending state.
    if (["pending_verification", "paid", "rejected"].includes(order.paymentStatus ?? "")) {
      res.status(400).json({ error: `Order payment is already ${order.paymentStatus}` });
      return;
    }

    const txId = String(transactionId).trim();
    // Atomic: only update if payment is still in an "unpaid" state (null or "unpaid").
    const updateRows = await db.update(shopOrdersTable)
      .set({
        paymentMethod: "bangla_qr",
        paymentStatus: "pending_verification",
        qrTransactionId: txId,
        qrScreenshotUrl: screenshotUrl || null,
      })
      .where(and(
        eq(shopOrdersTable.id, orderId),
        eq(shopOrdersTable.userId, req.userId),
        or(isNull(shopOrdersTable.paymentStatus), eq(shopOrdersTable.paymentStatus, "unpaid")),
      ))
      .returning();
    if (!updateRows.length) {
      res.status(409).json({ error: "Order payment status has changed — please refresh and try again" });
      return;
    }
    const [updated] = updateRows;

    // Notify all admins that a QR payment is awaiting verification.
    notifyAdmins(
      "qr_payment_pending",
      "QR Payment Pending Verification",
      `Order #${orderId} (৳${order.totalAmount}) — Transaction ID: ${txId}. Please verify and approve.`,
      orderId,
    ).catch(() => {});

    res.json(updated);
  } catch (err) {
    logger.error({ err }, "payBanglaQr error");
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /admin/shop/orders/:id/verify-payment — Approve a pending QR payment
router.put("/admin/shop/orders/:id/verify-payment", adminMiddleware, async (req: any, res): Promise<void> => {
  try {
    const orderId = parseInt(req.params.id);

    // Atomic: only update if still pending_verification. Zero rows = already processed.
    const rows = await db.update(shopOrdersTable)
      .set({ paymentStatus: "paid", status: "confirmed" })
      .where(and(eq(shopOrdersTable.id, orderId), eq(shopOrdersTable.paymentStatus, "pending_verification")))
      .returning();
    if (!rows.length) {
      // Check if it just doesn't exist vs already processed
      const [exists] = await db.select({ id: shopOrdersTable.id }).from(shopOrdersTable).where(eq(shopOrdersTable.id, orderId));
      res.status(exists ? 409 : 404).json({ error: exists ? "Payment already processed" : "Order not found" });
      return;
    }
    const [updated] = rows;

    // Notify customer in-app
    notify(
      updated.userId,
      "payment_verified",
      "Payment Verified ✓",
      `Your QR payment for Order #${orderId} (৳${updated.totalAmount}) has been verified. Your order is confirmed!`,
      orderId,
    ).catch(() => {});

    // Email customer if SMTP is configured
    const [customer] = await db.select({ email: usersTable.email }).from(usersTable)
      .where(eq(usersTable.id, updated.userId));
    if (customer?.email) {
      sendEmail(
        customer.email,
        `Payment Verified – Order #${orderId}`,
        `Your QR payment for Order #${orderId} (৳${updated.totalAmount}) has been verified and your order is now confirmed. Thank you for shopping with us!`,
      ).catch(() => {});
    }

    res.json(updated);
  } catch (err) {
    logger.error({ err }, "verifyQrPayment error");
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /admin/shop/orders/:id/reject-payment — Reject a pending QR payment
router.put("/admin/shop/orders/:id/reject-payment", adminMiddleware, async (req: any, res): Promise<void> => {
  try {
    const orderId = parseInt(req.params.id);
    const { reason } = req.body;

    // Atomic: only update if still pending_verification.
    const rows = await db.update(shopOrdersTable)
      .set({ paymentStatus: "rejected", status: "cancelled" })
      .where(and(eq(shopOrdersTable.id, orderId), eq(shopOrdersTable.paymentStatus, "pending_verification")))
      .returning();
    if (!rows.length) {
      const [exists] = await db.select({ id: shopOrdersTable.id }).from(shopOrdersTable).where(eq(shopOrdersTable.id, orderId));
      res.status(exists ? 409 : 404).json({ error: exists ? "Payment already processed" : "Order not found" });
      return;
    }
    const [updated] = rows;

    const msg = reason
      ? `Your payment for Order #${orderId} was rejected. Reason: ${reason}`
      : `Your payment for Order #${orderId} could not be verified and the order has been cancelled.`;

    // Notify customer in-app
    notify(updated.userId, "payment_rejected", "Payment Rejected", msg, orderId).catch(() => {});

    // Email customer if SMTP is configured
    const [customer] = await db.select({ email: usersTable.email }).from(usersTable)
      .where(eq(usersTable.id, updated.userId));
    if (customer?.email) {
      sendEmail(
        customer.email,
        `Payment Rejected – Order #${orderId}`,
        `${msg} Please contact us if you believe this is an error.`,
      ).catch(() => {});
    }

    res.json(updated);
  } catch (err) {
    logger.error({ err }, "rejectQrPayment error");
    res.status(500).json({ error: "Server error" });
  }
});

// GET /admin/shop/orders
router.get("/admin/shop/orders", adminMiddleware, async (req: any, res): Promise<void> => {
  try {
    const orders = await db.select().from(shopOrdersTable)
      .orderBy(sql`${shopOrdersTable.createdAt} desc`);
    const ordersWithItems = await Promise.all(orders.map(async (order) => {
      const items = await db.select().from(shopOrderItemsTable).where(eq(shopOrderItemsTable.orderId, order.id));
      return { ...order, items };
    }));
    res.json(ordersWithItems);
  } catch (err) {
    logger.error({ err }, "listAllOrders error");
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /admin/shop/orders/:id/status
router.put("/admin/shop/orders/:id/status", adminMiddleware, async (req: any, res): Promise<void> => {
  try {
    const { status } = req.body;
    const [order] = await db.update(shopOrdersTable).set({ status })
      .where(eq(shopOrdersTable.id, parseInt(req.params.id))).returning();
    if (!order) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ...order, items: [] });
  } catch (err) {
    logger.error({ err }, "updateOrderStatus error");
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
