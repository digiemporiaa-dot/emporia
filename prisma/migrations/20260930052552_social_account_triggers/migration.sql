-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AutomationTriggerType" ADD VALUE 'SOCIAL_ACCOUNT_EXPIRING';
ALTER TYPE "AutomationTriggerType" ADD VALUE 'SOCIAL_ACCOUNT_NEEDS_RECONNECT';
ALTER TYPE "AutomationTriggerType" ADD VALUE 'SOCIAL_CONTENT_CREATED';

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "expiryWarnedFor" TIMESTAMP(3);
