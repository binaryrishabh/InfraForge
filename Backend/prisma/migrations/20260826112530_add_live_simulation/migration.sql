-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN     "seed" TEXT,
ADD COLUMN     "simulationState" JSONB,
ADD COLUMN     "workloadProfile" JSONB;
