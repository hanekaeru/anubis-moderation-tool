-- CreateTable
CREATE TABLE "role_permission_overrides" (
    "role" "AppUserRole" NOT NULL,
    "permission" VARCHAR(64) NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_permission_overrides_pkey" PRIMARY KEY ("role","permission")
);
