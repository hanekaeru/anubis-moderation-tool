-- CreateTable
CREATE TABLE "voice_hubs" (
    "id" UUID NOT NULL,
    "guild_id" VARCHAR(20) NOT NULL,
    "channel_id" VARCHAR(20),
    "name" TEXT NOT NULL,
    "name_pattern" TEXT NOT NULL DEFAULT '{name} #{index}',
    "user_limit" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_hubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temporary_voice_channels" (
    "id" UUID NOT NULL,
    "hub_id" UUID NOT NULL,
    "guild_id" VARCHAR(20) NOT NULL,
    "channel_id" VARCHAR(20) NOT NULL,
    "name" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "owner_id" VARCHAR(20) NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "temporary_voice_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voice_hubs_channel_id_key" ON "voice_hubs"("channel_id");

-- CreateIndex
CREATE INDEX "voice_hubs_guild_id_idx" ON "voice_hubs"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "temporary_voice_channels_channel_id_key" ON "temporary_voice_channels"("channel_id");

-- CreateIndex
CREATE INDEX "temporary_voice_channels_guild_id_closed_at_idx" ON "temporary_voice_channels"("guild_id", "closed_at");

-- AddForeignKey
ALTER TABLE "voice_hubs" ADD CONSTRAINT "voice_hubs_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_voice_channels" ADD CONSTRAINT "temporary_voice_channels_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "voice_hubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_voice_channels" ADD CONSTRAINT "temporary_voice_channels_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_voice_channels" ADD CONSTRAINT "temporary_voice_channels_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "discord_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
