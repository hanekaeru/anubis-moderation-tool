import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/**
 * Ouvre une route sans authentification. Le guard JWT est applique globalement,
 * donc l'acces libre est toujours un choix explicite et visible.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
