export function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Variable d'environnement manquante : ${name}`);
    }
    return value;
}

/**
 * Sans valeur de repli, un `parseInt` sur une variable absente renvoie `NaN`,
 * ce qui a deja provoque des vidages de buffer a chaque appel (voir
 * l'historique de `utils/xp_manager.js`) ou des cooldowns qui se declenchaient
 * immediatement.
 */
export function readInt(name: string, fallback: number): number {
    const parsed = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
