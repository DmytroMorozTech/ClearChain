-- CreateEnum
CREATE TYPE "LlmAttemptOutcome" AS ENUM ('PENDING', 'SUCCESS', 'INVALID_OUTPUT', 'REFUSED', 'UPSTREAM_ERROR', 'QUOTA_IP', 'QUOTA_GLOBAL');

-- CreateTable
CREATE TABLE "LlmExtractionAttempt" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash" TEXT NOT NULL,
    "ipPrefix" TEXT NOT NULL,
    "supplierId" UUID,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "outcome" "LlmAttemptOutcome" NOT NULL,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "warningCount" INTEGER,

    CONSTRAINT "LlmExtractionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LlmExtractionAttempt_createdAt_idx" ON "LlmExtractionAttempt"("createdAt");

-- CreateIndex
CREATE INDEX "LlmExtractionAttempt_ipHash_createdAt_idx" ON "LlmExtractionAttempt"("ipHash", "createdAt");
