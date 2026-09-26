import "server-only";
import { IntegrationNotConfiguredError } from "@/lib/errors";
import { CAPABILITIES, PROVIDER_LABEL } from "@/lib/social/capabilities";
import type { SocialProvider } from "@/generated/prisma/enums";
import type { SocialProviderAdapter } from "@/lib/social/types";

/**
 * A provider with no app credentials configured.
 *
 * Every method throws the same typed error the rest of the application already
 * uses for an unconfigured integration, so an operator sees "Instagram is not
 * connected in Settings" rather than a network failure at 7:30pm. The
 * capabilities are still reported, so the UI can describe what *would* be
 * possible once it is configured — the screen says "Not configured", it does
 * not go blank.
 *
 * This is the same shape `lib/payments` and `lib/ai` use. Nothing here
 * pretends to succeed (CLAUDE.md 2 rule 5).
 */
export class UnconfiguredSocialProvider implements SocialProviderAdapter {
  readonly configured = false;

  constructor(readonly provider: SocialProvider) {}

  get label(): string {
    return PROVIDER_LABEL[this.provider];
  }

  get capabilities() {
    return CAPABILITIES[this.provider];
  }

  private fail(): never {
    // The error builds its own message from the provider name, and that
    // message already tells the operator to add credentials.
    throw new IntegrationNotConfiguredError(this.label);
  }

  // `authorizationUrl` is synchronous, so it throws. The rest are declared
  // async on purpose: a method typed `Promise<T>` that throws synchronously
  // escapes the caller's `.catch()` and surfaces somewhere unrelated. Every
  // real adapter has to behave the same way.
  authorizationUrl(): string {
    this.fail();
  }
  async exchangeCode(): Promise<never> {
    this.fail();
  }
  async refresh(): Promise<never> {
    this.fail();
  }
  async getAccount(): Promise<never> {
    this.fail();
  }
  async publish(): Promise<never> {
    this.fail();
  }
  async getMetrics(): Promise<never> {
    this.fail();
  }
}
