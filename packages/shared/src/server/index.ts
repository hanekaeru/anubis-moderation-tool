/**
 * `@anubis/shared/server` — logique metier commune a l'API et au bot, qui a
 * besoin de la base.
 *
 * Le bot n'appelle jamais l'API : une regle qui s'applique des deux cotes
 * etait donc recopiee, et les copies divergeaient. Elle vit ici, et chaque
 * fonction recoit le client Prisma de l'appelant.
 *
 * **Serveur uniquement**, comme `@anubis/shared/prisma` : rien de ce dossier
 * n'est exporte par `src/index.ts`, que le dashboard importe. Les regles pures,
 * sans base, restent dans le point d'entree principal.
 */
export * from "./battlenet";
