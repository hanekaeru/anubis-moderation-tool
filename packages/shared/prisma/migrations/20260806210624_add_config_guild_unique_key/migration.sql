-- AlterTable
CREATE UNIQUE INDEX "config_guild_guild_id_config_name_key" ON "config_guild"("guild_id", "config_name");
