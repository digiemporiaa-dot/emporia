import type { ActionConfig } from "@/lib/validation/automation";

/**
 * Human labels for action types.
 *
 * Separate from `lib/automation/actions` because that module is `server-only`
 * and the editor is a client component — the labels are the one part of it a
 * browser may see.
 */
export const ACTION_LABEL: Record<ActionConfig["type"], string> = {
  ASSIGN_LEAD: "Assign the lead",
  CREATE_LEAD_TASK: "Create a follow-up task",
  SEND_EMAIL: "Send an email",
  NOTIFY_USER: "Notify someone in the app",
  CREATE_CLIENT: "Create the client",
  CREATE_PROJECT: "Create a project",
  CREATE_PROJECT_TASKS: "Create onboarding tasks",
  SET_LEAD_STATUS: "Set the lead's status",
  ADD_TAG: "Tag the lead",
};
