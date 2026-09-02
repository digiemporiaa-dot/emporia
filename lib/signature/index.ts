import { IntegrationNotConfiguredError } from "@/lib/errors";

/**
 * E-signature.
 *
 * The build plan asks for contracts to be "e-signature-ready interface, not
 * implemented", so this declares the contract a provider would satisfy and
 * nothing more. There is no provider wired up, no credentials, and no
 * pretending: every call raises IntegrationNotConfiguredError, which the UI
 * surfaces as "not configured" rather than as a silent success
 * (CLAUDE.md 2 rule 5).
 *
 * Marking a contract signed in the admin records a signature obtained
 * elsewhere. That is a different claim from having captured one, and the code
 * keeps the two apart.
 */

export type SignatureRequest = {
  contractId: string;
  documentUrl: string;
  signers: { name: string; email: string; order?: number }[];
  subject: string;
  message?: string;
};

export type SignatureEnvelope = {
  envelopeId: string;
  status: "SENT" | "DELIVERED" | "COMPLETED" | "DECLINED" | "VOIDED";
  signedAt: Date | null;
  signedDocumentUrl: string | null;
};

export interface SignatureService {
  /** Send a document for signature and return the provider's envelope. */
  requestSignature(request: SignatureRequest): Promise<SignatureEnvelope>;
  /** Poll or fetch current envelope state. */
  getEnvelope(envelopeId: string): Promise<SignatureEnvelope>;
  /** Verify and interpret a provider webhook. */
  handleWebhook(payload: unknown, signature: string): Promise<SignatureEnvelope>;
  /** Cancel an outstanding request. */
  voidEnvelope(envelopeId: string, reason: string): Promise<void>;
}

const PROVIDER = "E-signature";

/**
 * The only implementation that exists. Swapping in a real provider means
 * writing a class that satisfies SignatureService and returning it here.
 */
class UnconfiguredSignatureService implements SignatureService {
  requestSignature(): Promise<SignatureEnvelope> {
    throw new IntegrationNotConfiguredError(PROVIDER);
  }
  getEnvelope(): Promise<SignatureEnvelope> {
    throw new IntegrationNotConfiguredError(PROVIDER);
  }
  handleWebhook(): Promise<SignatureEnvelope> {
    throw new IntegrationNotConfiguredError(PROVIDER);
  }
  voidEnvelope(): Promise<void> {
    throw new IntegrationNotConfiguredError(PROVIDER);
  }
}

export function signatureService(): SignatureService {
  return new UnconfiguredSignatureService();
}

/** Whether a provider is available, for the admin to show honest state. */
export function isSignatureConfigured(): boolean {
  return false;
}
