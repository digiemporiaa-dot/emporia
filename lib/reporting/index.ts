import "server-only";
import { IntegrationNotConfiguredError } from "@/lib/errors";
import {
  REPORTING_PROVIDERS,
  type DailyMetric,
  type ReportingProvider,
  type ReportingProviderName,
} from "@/lib/reporting/types";

export {
  REPORTING_PROVIDERS,
  REPORTING_PROVIDER_LABEL,
  type DailyMetric,
  type ReportingProvider,
  type ReportingProviderName,
} from "@/lib/reporting/types";

/**
 * Reporting providers.
 *
 * None is implemented. Each is present as an unconfigured provider that throws
 * a typed error, which is deliberate: the admin can see the integration exists
 * and is switched off, and any attempt to sync fails loudly instead of
 * returning numbers nobody measured (CLAUDE.md 2 rule 5).
 *
 * Implementing one means replacing its entry here. Callers do not change.
 */
class UnimplementedReporting implements ReportingProvider {
  readonly configured = false;

  constructor(readonly name: ReportingProviderName) {}

  async fetchDailyMetrics(): Promise<DailyMetric[]> {
    throw new IntegrationNotConfiguredError(
      `${this.name} reporting is not implemented. Enter or import the numbers instead.`,
    );
  }
}

const providers = new Map<ReportingProviderName, ReportingProvider>(
  REPORTING_PROVIDERS.map((name) => [name, new UnimplementedReporting(name)]),
);

export function reporting(name: ReportingProviderName): ReportingProvider {
  const provider = providers.get(name);
  if (!provider) throw new IntegrationNotConfiguredError(`Unknown reporting provider ${name}.`);
  return provider;
}

/** Which providers could actually be synced right now. Currently none. */
export function configuredReportingProviders(): ReportingProviderName[] {
  return REPORTING_PROVIDERS.filter((name) => reporting(name).configured);
}
