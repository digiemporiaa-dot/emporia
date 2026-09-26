import { redirect } from "next/navigation";

/** The section's landing tab. Overview arrives with Phase 8's analytics. */
export default async function ClientSocialIndex({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  redirect(`/admin/clients/${clientId}/social/accounts`);
}
