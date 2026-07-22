-- CreateEnum
CREATE TYPE "SupplierCategory" AS ENUM ('RAW_MATERIAL', 'MANUFACTURING', 'LOGISTICS');

-- CreateEnum
CREATE TYPE "CertificateType" AS ENUM ('CSRD', 'LKSG', 'EUDR', 'CBAM', 'ISO_14001', 'SA8000', 'OEKO_TEX');

-- CreateEnum
CREATE TYPE "RiskBand" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "SourceSystem" AS ENUM ('MANUAL', 'ERP');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "tier" INTEGER NOT NULL,
    "category" "SupplierCategory" NOT NULL,
    "contactEmail" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sourceSystem" "SourceSystem" NOT NULL DEFAULT 'MANUAL',
    "lastSyncedAt" TIMESTAMP(3),
    "parentSupplierId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "type" "CertificateType" NOT NULL,
    "issuer" TEXT,
    "certificateNumber" TEXT,
    "issueDate" DATE NOT NULL,
    "expiryDate" DATE NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CountryRisk" (
    "code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "band" "RiskBand" NOT NULL,
    "baseScore" INTEGER NOT NULL,

    CONSTRAINT "CountryRisk_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ErpSyncLog" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "sourceFileHash" TEXT,
    "status" "SyncStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "recordsRead" INTEGER NOT NULL DEFAULT 0,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "recordsUnchanged" INTEGER NOT NULL DEFAULT 0,
    "recordsRejected" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,

    CONSTRAINT "ErpSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_externalId_key" ON "Supplier"("externalId");

-- CreateIndex
CREATE INDEX "Supplier_parentSupplierId_idx" ON "Supplier"("parentSupplierId");

-- CreateIndex
CREATE INDEX "Supplier_tier_idx" ON "Supplier"("tier");

-- CreateIndex
CREATE INDEX "Supplier_countryCode_idx" ON "Supplier"("countryCode");

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_storageKey_key" ON "Certificate"("storageKey");

-- CreateIndex
CREATE INDEX "Certificate_supplierId_type_idx" ON "Certificate"("supplierId", "type");

-- CreateIndex
CREATE INDEX "Certificate_expiryDate_idx" ON "Certificate"("expiryDate");

-- CreateIndex
CREATE INDEX "ErpSyncLog_startedAt_idx" ON "ErpSyncLog"("startedAt");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_parentSupplierId_fkey" FOREIGN KEY ("parentSupplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "CountryRisk"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-added integrity constraints (requirements.md §10.2).
--
-- Prisma cannot express CHECK constraints or partial indexes, so they are appended
-- to the generated migration. These are not duplicated application logic: the
-- application checks protect against a bad client, while these protect against a
-- bad backend. Every other write path — ERP sync, the seed script, a migration,
-- a manual psql session — bypasses Express entirely but cannot bypass these.
-- ---------------------------------------------------------------------------

-- tier is a derived value (depth + 1) and the domain has exactly three levels.
ALTER TABLE "Supplier"
  ADD CONSTRAINT supplier_tier_range CHECK ("tier" BETWEEN 1 AND 3);

-- A supplier cannot be its own parent. Note this catches only the trivial
-- self-reference; a longer cycle (A -> B -> A) is invisible to a row-level CHECK
-- and remains the application's responsibility (ancestor walk on every write).
ALTER TABLE "Supplier"
  ADD CONSTRAINT supplier_no_self_ref
  CHECK ("parentSupplierId" IS NULL OR "parentSupplierId" <> "id");

-- Tier 1 means "direct supplier of the company", which is exactly the set of
-- suppliers with no parent. The biconditional enforces both directions at once.
ALTER TABLE "Supplier"
  ADD CONSTRAINT supplier_tier1_root
  CHECK (("tier" = 1) = ("parentSupplierId" IS NULL));

-- A certificate that expires before it was issued is not a historical record,
-- it is a data-entry error.
ALTER TABLE "Certificate"
  ADD CONSTRAINT cert_dates_ordered CHECK ("expiryDate" > "issueDate");

-- At most one sync may be RUNNING at any moment. Enforced here rather than with an
-- application-level "is one already running?" check, which is racy by construction:
-- two concurrent requests can both read "no" before either writes. A second
-- concurrent sync now fails at the database, and the API surfaces it as 409.
CREATE UNIQUE INDEX erp_sync_single_running
  ON "ErpSyncLog" (("status")) WHERE "status" = 'RUNNING';
