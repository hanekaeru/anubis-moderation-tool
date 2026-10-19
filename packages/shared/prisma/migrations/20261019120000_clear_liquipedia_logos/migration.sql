-- Logos d'equipe repris de Liquipedia : le site refuse ses images aux autres
-- domaines (403), dans le dashboard comme dans le proxy de Discord. L'import
-- n'en reprend plus aucun ; ceux deja poses sont vides, l'equipe s'affiche
-- sans logo jusqu'a ce que le staff en saisisse un.
UPDATE "esport_teams" SET "logo_url" = NULL WHERE "logo_url" LIKE 'https://liquipedia.net/%';
