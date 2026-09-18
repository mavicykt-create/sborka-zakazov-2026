CREATE TABLE "WorkerSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkerSession_tokenHash_key" ON "WorkerSession"("tokenHash");
CREATE INDEX "WorkerSession_workerId_expiresAt_idx" ON "WorkerSession"("workerId", "expiresAt");
CREATE INDEX "WorkerSession_expiresAt_idx" ON "WorkerSession"("expiresAt");

ALTER TABLE "WorkerSession"
ADD CONSTRAINT "WorkerSession_workerId_fkey"
FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
