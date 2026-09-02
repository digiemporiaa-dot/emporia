import type { Metadata } from "next";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { getProfile } from "@/lib/services/portal.service";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { PasswordForm, ProfileForm } from "./profile-forms";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default async function PortalProfilePage() {
  const actor = await requirePortalActorPage();
  const profile = await getProfile(actor);

  return (
    <>
      <header className="mb-5">
        <h1 className="text-2xl text-navy-800">Profile</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Signed in as {profile.email} for {profile.client?.name}
          {profile.lastLoginAt ? ` · last signed in ${DATE.format(profile.lastLoginAt)}` : ""}.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your details</CardTitle>
          </CardHeader>
          <CardBody>
            <ProfileForm name={profile.name} phone={profile.phone} />
            <p className="mt-4 text-2xs text-ink-subtle">
              Your email address is how you sign in. Ask your account manager to change it.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
          </CardHeader>
          <CardBody>
            <PasswordForm />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
