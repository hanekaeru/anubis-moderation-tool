-- CreateTable
CREATE TABLE "config_guild" (
    "id" BIGSERIAL NOT NULL,
    "guild_id" VARCHAR(20) NOT NULL,
    "config_name" VARCHAR(50) NOT NULL,
    "config_value" VARCHAR(100) NOT NULL,
    "config_description" TEXT NOT NULL,

    CONSTRAINT "config_guild_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "config_guild_config_name_idx" ON "config_guild"("config_name");

-- AddForeignKey
ALTER TABLE "config_guild" ADD CONSTRAINT "config_guild_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
