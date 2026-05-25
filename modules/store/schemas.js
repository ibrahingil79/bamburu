import { z } from 'zod';

const strOpt = (max = 255) => z.string().trim().max(max).optional().or(z.literal(''));
const price = z.coerce.number().nonnegative().max(1_000_000);
const intPos = z.coerce.number().int().nonnegative();
const optId = z.union([z.null(), z.coerce.number().int().positive()]).optional();

export const validateCouponSchema = z.object({
  code: z.string().trim().min(1).max(50),
  subtotal: z.coerce.number().nonnegative(),
});

const checkoutItemSchema = z.object({
  id: z.coerce.number().int().positive(),
  variant_id: optId,
  name: z.string().max(200),
  price,
  qty: z.coerce.number().int().positive(),
});

const checkoutClientSchema = z.object({
  name: strOpt(200),
  email: z.string().trim().email().max(255).optional().or(z.literal('')),
  phone: strOpt(50),
  address: strOpt(500),
  notes: strOpt(1000),
}).optional();

export const checkoutSchema = z.object({
  client: checkoutClientSchema,
  items: z.array(checkoutItemSchema).min(1),
  shipping_method_id: optId,
  discount_code: strOpt(50),
});

export const newsletterSchema = z.object({
  email: z.string().trim().email().max(255),
  name: strOpt(200),
});

export const storeReviewSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  customer_name: z.string().trim().max(100).optional(),
  email: z.string().trim().email().max(255).optional().or(z.literal('')),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().min(5).max(2000),
});

export const accountRegisterSchema = z.object({
  name: strOpt(200),
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(200),
  phone: strOpt(50),
});

export const accountLoginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(200),
});

export const wishlistSchema = z.object({
  product_id: z.coerce.number().int().positive(),
});
