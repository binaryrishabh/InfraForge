-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "infrastructureId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resourceCount" INTEGER NOT NULL DEFAULT 0,
    "stages" JSONB NOT NULL DEFAULT '[]',
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "chaosEvents" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_infrastructureId_fkey" FOREIGN KEY ("infrastructureId") REFERENCES "Infrastructure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
