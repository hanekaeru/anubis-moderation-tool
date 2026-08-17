-- CreateEnum
CREATE TYPE "WikiCategory" AS ENUM ('SANCTIONS', 'BEHAVIOR', 'PROCEDURES', 'TOOLS', 'ONBOARDING', 'OTHER');

-- CreateTable
CREATE TABLE "wiki_articles" (
    "id" UUID NOT NULL,
    "guild_id" VARCHAR(20) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "category" "WikiCategory" NOT NULL DEFAULT 'OTHER',
    "summary" VARCHAR(300),
    "content_html" TEXT NOT NULL,
    "content_text" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "wiki_articles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wiki_articles_guild_id_category_idx" ON "wiki_articles"("guild_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "wiki_articles_guild_id_slug_key" ON "wiki_articles"("guild_id", "slug");

-- AddForeignKey
ALTER TABLE "wiki_articles" ADD CONSTRAINT "wiki_articles_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_articles" ADD CONSTRAINT "wiki_articles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_articles" ADD CONSTRAINT "wiki_articles_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
