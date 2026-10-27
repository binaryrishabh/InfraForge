-- A Model 2 run executes in the browser; when it ends, the browser submits its stop second and the actions it
-- applied (each with its simulated second). The server replays them for the official record. Additive.
ALTER TABLE "Deployment" ADD COLUMN "browserSubmission" JSONB;
