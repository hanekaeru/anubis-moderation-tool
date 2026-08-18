-- CreateTable
CREATE TABLE "shadowban_role_backups" (
    "guild_id" VARCHAR(20) NOT NULL,
    "user_id" VARCHAR(20) NOT NULL,
    "role_ids" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shadowban_role_backups_pkey" PRIMARY KEY ("guild_id","user_id")
);

-- AddForeignKey
ALTER TABLE "shadowban_role_backups" ADD CONSTRAINT "shadowban_role_backups_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shadowban_role_backups" ADD CONSTRAINT "shadowban_role_backups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "discord_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
