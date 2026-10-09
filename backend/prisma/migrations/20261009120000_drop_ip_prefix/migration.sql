-- The attempt log keeps no part of an address: limits are counted by a keyed hash
-- whose key changes every UTC day (src/http/clientIp.ts). Existing prefixes go too.
ALTER TABLE "LlmExtractionAttempt" DROP COLUMN "ipPrefix";
