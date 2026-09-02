import { z } from "zod";

/** Portal input validation. Nothing here ever accepts a client id. */

const id = z.string().trim().min(1).max(40);

export const portalMessageSchema = z.object({
  body: z.string().trim().min(1, "Write something first.").max(5000),
  /** Optional: attach the message to one of the client's own projects. */
  projectId: z.string().trim().max(40).nullable().optional(),
});

export type PortalMessageInput = z.infer<typeof portalMessageSchema>;

export const portalApprovalDecisionSchema = z.object({
  approvalId: id,
  decision: z.enum(["APPROVED", "CHANGES_REQUESTED"]),
  feedback: z.string().trim().max(5000).nullable().optional(),
});

export type PortalApprovalDecisionInput = z.infer<typeof portalApprovalDecisionSchema>;

export const portalProfileSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(120),
  phone: z.string().trim().max(30).nullable().optional(),
});

export type PortalProfileInput = z.infer<typeof portalProfileSchema>;

export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(200, "That is too long.");

export const portalPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "The two passwords do not match.",
    path: ["confirmPassword"],
  });

export const acceptInviteSchema = z
  .object({
    token: z.string().trim().min(20).max(200),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "The two passwords do not match.",
    path: ["confirmPassword"],
  });

export const invitePortalUserSchema = z.object({
  clientId: id,
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
  name: z.string().trim().min(2, "Enter their name.").max(120),
});

export type InvitePortalUserInput = z.infer<typeof invitePortalUserSchema>;
