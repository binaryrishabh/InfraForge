-- CreateTable
CREATE TABLE "Infrastructure" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'test-user',
    "name" TEXT NOT NULL,
    "layout" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Infrastructure_pkey" PRIMARY KEY ("id")
);
