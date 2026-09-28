import { redirect } from "next/navigation";

/** The social section is the queue, until a later phase gives it more. */
export default function SocialIndexPage() {
  redirect("/admin/social/queue");
}
