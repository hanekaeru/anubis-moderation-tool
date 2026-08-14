-- CreateTable
CREATE TABLE "quarantine_config" (
    "guild_id" VARCHAR(20) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "role_id" VARCHAR(20),
    "channel_id" VARCHAR(20),
    "message" TEXT,
    "button_label" TEXT NOT NULL DEFAULT 'J''accepte le reglement',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quarantine_config_pkey" PRIMARY KEY ("guild_id")
);

-- CreateTable
CREATE TABLE "quarantine_status" (
    "guild_id" VARCHAR(20) NOT NULL,
    "user_id" VARCHAR(20) NOT NULL,
    "quarantined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "released_by_id" UUID,
    "discord_synced_at" TIMESTAMP(3),

    CONSTRAINT "quarantine_status_pkey" PRIMARY KEY ("guild_id","user_id")
);

-- CreateTable
CREATE TABLE "account_link_codes" (
    "app_user_id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_link_codes_pkey" PRIMARY KEY ("app_user_id")
);

-- CreateTable
CREATE TABLE "bot_heartbeat" (
    "id" TEXT NOT NULL DEFAULT 'bot',
    "started_at" TIMESTAMP(3) NOT NULL,
    "last_heartbeat_at" TIMESTAMP(3) NOT NULL,
    "ws_ping_ms" INTEGER,
    "avg_ping_ms" INTEGER,
    "guild_count" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_heartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_link_codes_code_key" ON "account_link_codes"("code");

-- AddForeignKey
ALTER TABLE "quarantine_config" ADD CONSTRAINT "quarantine_config_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quarantine_status" ADD CONSTRAINT "quarantine_status_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quarantine_status" ADD CONSTRAINT "quarantine_status_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "discord_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quarantine_status" ADD CONSTRAINT "quarantine_status_released_by_id_fkey" FOREIGN KEY ("released_by_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_link_codes" ADD CONSTRAINT "account_link_codes_app_user_id_fkey" FOREIGN KEY ("app_user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
