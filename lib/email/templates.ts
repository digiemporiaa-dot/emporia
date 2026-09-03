import type { TemplateDefinition } from "@/lib/email/types";

/**
 * The default templates.
 *
 * These are seeded into `EmailTemplate` and are editable in admin from then on
 * — the database is the source of truth at send time, not this file. What lives
 * here is the starting point, and the variable list each template declares so
 * the editor can show what may be used.
 *
 * The markup is deliberately plain: tables and inline styles, no external CSS,
 * no images, no web fonts. Mail clients are not browsers.
 */

const BRAND_RED = "#DF1F38";
const NAVY = "#002A3A";

function layout(body: string): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f4f5f6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#0f1c22;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f6;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e7e9;">
            <tr>
              <td style="background:${NAVY};padding:16px 24px;">
                <span style="color:#ffffff;font-size:16px;font-weight:600;letter-spacing:-0.02em;">Emporia</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;font-size:15px;line-height:1.55;">
${body}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;border-top:1px solid #e4e7e9;font-size:12px;color:#6b7a80;">
                {{siteName}} · <a href="{{siteUrl}}" style="color:${NAVY};">{{siteUrl}}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;">
  <tr><td style="background:${BRAND_RED};">
    <a href="${href}" style="display:inline-block;padding:11px 20px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">${label}</a>
  </td></tr>
</table>`;
}

/** Variables every template can use; the service injects them. */
export const GLOBAL_VARIABLES: Record<string, string> = {
  siteName: "The agency name from site settings",
  siteUrl: "The public site URL",
};

export const DEFAULT_TEMPLATES: TemplateDefinition[] = [
  {
    key: "NEW_LEAD",
    name: "New lead captured",
    subject: "New lead: {{leadName}}",
    html: layout(`<p style="margin:0 0 12px;">A new lead came in from <strong>{{source}}</strong>.</p>
<p style="margin:0 0 4px;"><strong>{{leadName}}</strong>{{company}}</p>
<p style="margin:0 0 12px;color:#6b7a80;font-size:14px;">{{email}} · {{phone}}</p>
<p style="margin:0 0 12px;">Interested in: {{interest}}</p>
<p style="margin:0 0 4px;color:#6b7a80;font-size:13px;">What they said:</p>
<p style="margin:0;padding:12px;background:#f4f5f6;font-size:14px;">{{message}}</p>${button("Open the lead", "{{leadUrl}}")}`),
    text: "A new lead came in from {{source}}.\n\n{{leadName}}{{company}}\n{{email}} \u00b7 {{phone}}\nInterested in: {{interest}}\n\nWhat they said:\n{{message}}\n\nOpen the lead: {{leadUrl}}",
    variables: {
      "leadName": "The lead name",
      "company": "Their company, prefixed with a dash, or empty",
      "email": "Their email address",
      "phone": "Their phone number",
      "source": "Where the lead came from",
      "interest": "The service and city they asked about",
      "message": "What they wrote",
      "leadUrl": "Admin link to the lead",
    },
  },
  {
    key: "LEAD_ASSIGNED",
    name: "Lead assigned to you",
    subject: "{{leadName}} is now yours",
    html: layout(`<p style="margin:0 0 12px;">{{assignedBy}} assigned you a lead.</p>
<p style="margin:0 0 4px;"><strong>{{leadName}}</strong>{{company}}</p>
<p style="margin:0 0 12px;color:#6b7a80;font-size:14px;">{{email}} · {{phone}} · score {{score}}</p>${button("Open the lead", "{{leadUrl}}")}`),
    text: "{{assignedBy}} assigned you a lead.\n\n{{leadName}}{{company}}\n{{email}} \u00b7 {{phone}} \u00b7 score {{score}}\n\nOpen the lead: {{leadUrl}}",
    variables: {
      "leadName": "The lead name",
      "company": "Their company, prefixed with a dash, or empty",
      "email": "Their email address",
      "phone": "Their phone number",
      "score": "The lead score",
      "assignedBy": "Who assigned it",
      "leadUrl": "Admin link to the lead",
    },
  },
  {
    key: "FOLLOW_UP",
    name: "Follow-up due",
    subject: "Follow up with {{leadName}} today",
    html: layout(`<p style="margin:0 0 12px;">A follow-up you own is due.</p>
<p style="margin:0 0 4px;"><strong>{{taskTitle}}</strong></p>
<p style="margin:0 0 12px;color:#6b7a80;font-size:14px;">{{leadName}} · due {{dueDate}}</p>${button("Open the lead", "{{leadUrl}}")}`),
    text: "A follow-up you own is due.\n\n{{taskTitle}}\n{{leadName}} \u00b7 due {{dueDate}}\n\nOpen the lead: {{leadUrl}}",
    variables: {
      "taskTitle": "The follow-up title",
      "leadName": "The lead name",
      "dueDate": "When it is due",
      "leadUrl": "Admin link to the lead",
    },
  },
  {
    key: "STAFF_INVITATION",
    name: "Staff invitation",
    subject: "Your {{siteName}} account is ready to set up",
    html: layout(`<p style="margin:0 0 12px;">Hello {{name}},</p>
<p style="margin:0 0 12px;">{{invitedBy}} has set up an account for you. Choose a password to finish.</p>${button("Set my password", "{{inviteUrl}}")}<p style="margin:0;color:#6b7a80;font-size:13px;">The link expires {{expiresAt}}. If it has, ask for a new one.</p>`),
    text: "Hello {{name}},\n\n{{invitedBy}} has set up an account for you. Choose a password to finish:\n{{inviteUrl}}\n\nThe link expires {{expiresAt}}.",
    variables: {
      "name": "Their name",
      "invitedBy": "Who invited them",
      "inviteUrl": "The single-use invitation link",
      "expiresAt": "When the link expires",
    },
  },
  {
    key: "PASSWORD_RESET",
    name: "Password reset",
    subject: "Reset your {{siteName}} password",
    html: layout(`<p style="margin:0 0 12px;">Hello {{name}},</p>
<p style="margin:0 0 12px;">Someone asked to reset the password for this account. If that was not you, ignore this email — nothing has changed.</p>${button("Choose a new password", "{{resetUrl}}")}<p style="margin:0;color:#6b7a80;font-size:13px;">The link expires {{expiresAt}}.</p>`),
    text: "Hello {{name}},\n\nSomeone asked to reset the password for this account. If that was not you, ignore this email.\n\nChoose a new password: {{resetUrl}}\n\nThe link expires {{expiresAt}}.",
    variables: {
      "name": "Their name",
      "resetUrl": "The single-use reset link",
      "expiresAt": "When the link expires",
    },
  },
  {
    key: "PROPOSAL_SENT",
    name: "Proposal sent",
    subject: "Your proposal from {{siteName}}: {{proposalTitle}}",
    html: layout(`<p style="margin:0 0 12px;">Hello {{clientName}},</p>
<p style="margin:0 0 12px;">Here is the proposal we discussed.</p>
<p style="margin:0 0 4px;"><strong>{{proposalTitle}}</strong></p>
<p style="margin:0 0 12px;color:#6b7a80;font-size:14px;">{{proposalNumber}} · {{total}}{{validUntil}}</p>${button("Read the proposal", "{{proposalUrl}}")}<p style="margin:0;color:#6b7a80;font-size:13px;">Any questions, just reply to this email.</p>`),
    text: "Hello {{clientName}},\n\nHere is the proposal we discussed.\n\n{{proposalTitle}}\n{{proposalNumber}} \u00b7 {{total}}{{validUntil}}\n\nRead it: {{proposalUrl}}",
    variables: {
      "clientName": "Who it is addressed to",
      "proposalTitle": "The proposal title",
      "proposalNumber": "Its number",
      "total": "The total, formatted",
      "validUntil": "Validity, prefixed with a dot separator, or empty",
      "proposalUrl": "Portal link to the proposal",
    },
  },
  {
    key: "PROPOSAL_ACCEPTED",
    name: "Proposal accepted",
    subject: "{{clientName}} accepted {{proposalNumber}}",
    html: layout(`<p style="margin:0 0 12px;"><strong>{{clientName}}</strong> accepted a proposal.</p>
<p style="margin:0 0 4px;"><strong>{{proposalTitle}}</strong></p>
<p style="margin:0 0 12px;color:#6b7a80;font-size:14px;">{{proposalNumber}} · {{total}}</p>${button("Open the client", "{{clientUrl}}")}`),
    text: "{{clientName}} accepted a proposal.\n\n{{proposalTitle}}\n{{proposalNumber}} \u00b7 {{total}}\n\nOpen the client: {{clientUrl}}",
    variables: {
      "clientName": "The client name",
      "proposalTitle": "The proposal title",
      "proposalNumber": "Its number",
      "total": "The total, formatted",
      "clientUrl": "Admin link to the client",
    },
  },
  {
    key: "INVOICE_SENT",
    name: "Invoice sent",
    subject: "Invoice {{invoiceNumber}} from {{siteName}}",
    html: layout(`<p style="margin:0 0 12px;">Hello {{clientName}},</p>
<p style="margin:0 0 12px;">Invoice <strong>{{invoiceNumber}}</strong> for {{total}} is due on {{dueDate}}.</p>${button("View the invoice", "{{invoiceUrl}}")}`),
    text: "Hello {{clientName}},\n\nInvoice {{invoiceNumber}} for {{total}} is due on {{dueDate}}.\n\nView it: {{invoiceUrl}}",
    variables: {
      "clientName": "The client name",
      "invoiceNumber": "The invoice number",
      "total": "The total, formatted",
      "dueDate": "When it is due",
      "invoiceUrl": "Portal link to the invoice",
    },
  },
  {
    key: "PAYMENT_RECEIVED",
    name: "Payment received",
    subject: "We received your payment for {{invoiceNumber}}",
    html: layout(`<p style="margin:0 0 12px;">Hello {{clientName}},</p>
<p style="margin:0 0 12px;">Thank you — we have received {{amount}} against invoice <strong>{{invoiceNumber}}</strong>.</p>
<p style="margin:0 0 12px;color:#6b7a80;font-size:14px;">Outstanding on this invoice: {{outstanding}}</p>${button("View the invoice", "{{invoiceUrl}}")}`),
    text: "Hello {{clientName}},\n\nThank you \u2014 we have received {{amount}} against invoice {{invoiceNumber}}.\nOutstanding on this invoice: {{outstanding}}\n\nView it: {{invoiceUrl}}",
    variables: {
      "clientName": "The client name",
      "invoiceNumber": "The invoice number",
      "amount": "What was received, formatted",
      "outstanding": "What is still owed, formatted",
      "invoiceUrl": "Portal link to the invoice",
    },
  },
  {
    key: "PAYMENT_REMINDER",
    name: "Payment reminder",
    subject: "Invoice {{invoiceNumber}} is due {{dueDate}}",
    html: layout(`<p style="margin:0 0 12px;">Hello {{clientName}},</p>
<p style="margin:0 0 12px;">A reminder that invoice <strong>{{invoiceNumber}}</strong> for {{outstanding}} is due on {{dueDate}}.</p>${button("View the invoice", "{{invoiceUrl}}")}<p style="margin:0;color:#6b7a80;font-size:13px;">If you have already paid, thank you — please ignore this.</p>`),
    text: "Hello {{clientName}},\n\nA reminder that invoice {{invoiceNumber}} for {{outstanding}} is due on {{dueDate}}.\n\nView it: {{invoiceUrl}}\n\nIf you have already paid, please ignore this.",
    variables: {
      "clientName": "The client name",
      "invoiceNumber": "The invoice number",
      "outstanding": "What is owed, formatted",
      "dueDate": "When it is due",
      "invoiceUrl": "Portal link to the invoice",
    },
  },
  {
    key: "CLIENT_NOTIFICATION",
    name: "Client notification",
    subject: "{{subject}}",
    html: layout(`<p style="margin:0 0 12px;">Hello {{clientName}},</p>
<p style="margin:0 0 12px;">{{body}}</p>${button("{{actionLabel}}", "{{actionUrl}}")}`),
    text: "Hello {{clientName}},\n\n{{body}}\n\n{{actionLabel}}: {{actionUrl}}",
    variables: {
      "clientName": "The client name",
      "subject": "The subject line",
      "body": "The message",
      "actionLabel": "What the button says",
      "actionUrl": "Where the button goes",
    },
  },
];

export function templateByKey(key: string): TemplateDefinition | undefined {
  return DEFAULT_TEMPLATES.find((template) => template.key === key);
}
