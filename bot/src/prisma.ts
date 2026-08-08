import { PrismaClient } from '@anubis/shared/prisma';

/**
 * Client Prisma partage avec l'API.
 *
 * Le schema vit dans packages/shared : le bot ecrit dans les memes tables que
 * celles lues par le dashboard, avec les memes types. Une colonne renommee
 * casse des la generation du client, au lieu de passer inapercue jusqu'a la
 * production.
 *
 * Une seule instance pour tout le processus : ouvrir un pool par module
 * epuiserait les connexions PostgreSQL.
 */
const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export default prisma;
