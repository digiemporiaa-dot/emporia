-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AutomationTriggerType" ADD VALUE 'SOCIAL_REVIEW_SUBMITTED';
ALTER TYPE "AutomationTriggerType" ADD VALUE 'SOCIAL_SENT_FOR_APPROVAL';
ALTER TYPE "AutomationTriggerType" ADD VALUE 'SOCIAL_POST_SCHEDULED';
ALTER TYPE "AutomationTriggerType" ADD VALUE 'SOCIAL_METRICS_SYNCED';
