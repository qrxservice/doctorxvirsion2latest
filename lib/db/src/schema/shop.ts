import { pgTable, text, serial, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const shopProductsTable = pgTable("shop_products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  originalPrice: numeric("original_price", { precision: 10, scale: 2 }),
  category: text("category").notNull().default("general"),
  imageUrl: text("image_url"),
  stockQty: integer("stock_qty").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  isFeatured: boolean("is_featured").notNull().default(false),
  rating: numeric("rating", { precision: 3, scale: 2 }).default("0"),
  reviewCount: integer("review_count").notNull().default(0),
  tags: text("tags"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const shopCartTable = pgTable("shop_cart", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => shopProductsTable.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
});

export const shopOrdersTable = pgTable("shop_orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  paymentStatus: text("payment_status").notNull().default("unpaid"), // "unpaid" | "paid" | "cod"
  paymentMethod: text("payment_method"), // "sslcommerz" | "cod" | "bangla_qr" | null
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull(),
  // Bangla QR payment confirmation fields
  qrTransactionId: text("qr_transaction_id"),  // transaction ID provided by the customer after scanning
  qrScreenshotUrl: text("qr_screenshot_url"),  // optional screenshot upload (object storage path)
  shippingName: text("shipping_name"),
  shippingPhone: text("shipping_phone"),
  shippingAddress: text("shipping_address"),
  shippingCity: text("shipping_city"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const shopOrderItemsTable = pgTable("shop_order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => shopOrdersTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => shopProductsTable.id),
  quantity: integer("quantity").notNull(),
  priceAtPurchase: numeric("price_at_purchase", { precision: 10, scale: 2 }).notNull(),
});

export const shopWishlistTable = pgTable("shop_wishlist", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => shopProductsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertShopWishlistSchema = createInsertSchema(shopWishlistTable).omit({ id: true, createdAt: true });
export type ShopWishlist = typeof shopWishlistTable.$inferSelect;

export const insertShopProductSchema = createInsertSchema(shopProductsTable).omit({ id: true, createdAt: true });
export const insertShopCartSchema = createInsertSchema(shopCartTable).omit({ id: true, createdAt: true });
export const insertShopOrderSchema = createInsertSchema(shopOrdersTable).omit({ id: true, createdAt: true });
export const insertShopOrderItemSchema = createInsertSchema(shopOrderItemsTable).omit({ id: true });

export type ShopProduct = typeof shopProductsTable.$inferSelect;
export type ShopCart = typeof shopCartTable.$inferSelect;
export type ShopOrder = typeof shopOrdersTable.$inferSelect;
export type ShopOrderItem = typeof shopOrderItemsTable.$inferSelect;
export type InsertShopProduct = z.infer<typeof insertShopProductSchema>;
export type InsertShopOrder = z.infer<typeof insertShopOrderSchema>;
