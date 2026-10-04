import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { getGoogleSettings } from "@/lib/services/seo-intel/google-settings.service";
import { Card, CardBody } from "@/components/ui";
import { SeoHeader } from "../seo-header";
import { GoogleSettingsForm } from "./google-settings-form";

export const metadata: Metadata = { title: "SEO settings" };
export const dynamic = "force-dynamic";

export default async function SeoSettingsPage() {
  const actor = await requireActorPage("/admin/marketing/seo/settings");
  requirePermission(actor, "seo.intelligence.connect");
  const settings = await getGoogleSettings(actor);

  return (
    <>
      <SeoHeader
        current="settings"
        title="SEO settings"
        description="The agency's Google credentials. Each website then connects its own Search Console with one of them; nothing here is ever sent to a browser."
        canConnect
      />
      <Card>
        <CardBody>
          <GoogleSettingsForm settings={settings} />
        </CardBody>
      </Card>
      <p className="mt-4 text-xs text-ink-muted">
        What counts as a finding — minimum clicks, drops, shares — is set in{" "}
        <Link href="/admin/marketing/seo/settings/thresholds" className="text-navy-800 underline underline-offset-2">
          thresholds
        </Link>
        .
      </p>
    </>
  );
}
