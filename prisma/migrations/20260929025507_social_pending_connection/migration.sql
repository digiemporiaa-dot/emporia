-- CreateTable
CREATE TABLE "SocialPendingConnection" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "provider" "SocialProvider" NOT NULL,
    "startedById" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "returnTo" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialPendingConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialPendingConnection_clientId_idx" ON "SocialPendingConnection"("clientId");

-- CreateIndex
CREATE INDEX "SocialPendingConnection_startedById_idx" ON "SocialPendingConnection"("startedById");

-- CreateIndex
CREATE INDEX "SocialPendingConnection_expiresAt_idx" ON "SocialPendingConnection"("expiresAt");

-- AddForeignKey
ALTER TABLE "SocialPendingConnection" ADD CONSTRAINT "SocialPendingConnection_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPendingConnection" ADD CONSTRAINT "SocialPendingConnection_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
