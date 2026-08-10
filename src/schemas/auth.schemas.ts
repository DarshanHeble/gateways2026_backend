/**
 * Auth Zod Schemas
 *
 * All request body, param, query, and response schemas for auth endpoints.
 * Schemas use .strip() implicitly (Zod v4 default) to reject unexpected fields.
 *
 * Import pattern for routes:
 *   import { SignupBodySchema, ... } from '../schemas/auth.schemas.js';
 */

import { z } from 'zod';

// ─── Request Body Schemas ──────────────────────────────────────────────────────

export const SignupBodySchema = z.object({
  email: z
    .string()
    .email('Must be a valid email address.')
    .max(255, 'Email must not exceed 255 characters.'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .max(72, 'Password must not exceed 72 characters.'), // bcrypt processes max 72 bytes
  fullName: z
    .string()
    .min(2, 'Full name must be at least 2 characters.')
    .max(255, 'Full name must not exceed 255 characters.')
    .trim(),
});

export const VerifyEmailBodySchema = z.object({
  email: z.string().email('Must be a valid email address.'),
  otp: z
    .string()
    .length(6, 'OTP must be exactly 6 digits.')
    .regex(/^\d{6}$/, 'OTP must be a 6-digit number.'),
});

export const SigninBodySchema = z.object({
  email: z.string().email('Must be a valid email address.').max(255),
  password: z.string().min(1, 'Password is required.').max(72),
});

export const GrantRoleBodySchema = z.object({
  role: z.enum(['PARTICIPANT', 'ORGANIZER', 'SCANNER', 'ADMIN']),
  eventScopeId: z.string().uuid('eventScopeId must be a valid UUID.').optional(),
});

export const GoogleCallbackQuerySchema = z.object({
  code: z.string().min(1, 'Authorization code is required.'),
  state: z.string().optional(),
  error: z.string().optional(),
});

export const UserIdParamSchema = z.object({
  userId: z.string().uuid('userId must be a valid UUID.'),
});

// ─── Response Schemas ─────────────────────────────────────────────────────────

/** Public user shape returned to clients — never includes passwordHash */
export const PublicUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  status: z.string(),
  emailVerified: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const SignupResponseSchema = z.object({
  message: z.string(),
});

/**
 * Bearer credentials, present only when the caller sent `X-Auth-Transport: bearer`
 * (admin dashboard, mobile). Cookie callers get neither field — the token stays in
 * the httpOnly Set-Cookie header and never enters a JS-readable body.
 *
 * These must be declared here: the Zod serializer strips any field absent from the
 * response schema, so an undeclared token would be silently dropped.
 */
const BearerCredentialFields = {
  token: z.string().optional(),
  expiresAt: z.string().optional(),
};

export const VerifyEmailResponseSchema = z.object({
  message: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string(),
  }),
  ...BearerCredentialFields,
});

export const SigninResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
  }),
  ...BearerCredentialFields,
});

export const SessionResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    status: z.string(),
    emailVerified: z.string().nullable(),
  }),
});

export const SignoutResponseSchema = z.object({
  message: z.string(),
});

export const GoogleOAuthInitResponseSchema = z.object({
  url: z.string().url(),
});

export const GrantRoleResponseSchema = z.object({
  message: z.string(),
});

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type SignupBody = z.infer<typeof SignupBodySchema>;
export type VerifyEmailBody = z.infer<typeof VerifyEmailBodySchema>;
export type SigninBody = z.infer<typeof SigninBodySchema>;
export type GrantRoleBody = z.infer<typeof GrantRoleBodySchema>;
export type GoogleCallbackQuery = z.infer<typeof GoogleCallbackQuerySchema>;
export type UserIdParam = z.infer<typeof UserIdParamSchema>;
