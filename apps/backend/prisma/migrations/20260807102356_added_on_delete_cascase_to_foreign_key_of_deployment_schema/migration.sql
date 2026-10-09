-- DropForeignKey
ALTER TABLE "Deployment" DROP CONSTRAINT "Deployment_infrastructureId_fkey";

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_infrastructureId_fkey" FOREIGN KEY ("infrastructureId") REFERENCES "Infrastructure"("id") ON DELETE CASCADE ON UPDATE CASCADE;
