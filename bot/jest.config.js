/**
 * Configuration Jest du bot.
 *
 * Elle vivait dans `package.json` ; elle en est sortie pour que les deux
 * reglages ci-dessous puissent porter leur raison d'etre — un JSON n'accepte
 * pas de commentaire, et Jest avertit sur toute clef qu'il ne connait pas.
 */
module.exports = {
	moduleFileExtensions: ["js", "json", "ts"],
	rootDir: "src",
	testRegex: ".*\\.spec\\.ts$",

	/**
	 * **Uniquement le TypeScript.** `@anubis/shared` est une dependance `file:`,
	 * donc un lien symbolique : le client Prisma genere
	 * (`packages/shared/generated/**\/*.js`) est resolu hors de `node_modules` et
	 * echappe donc a `transformIgnorePatterns`. Avec `^.+\.(t|j)s$`, ts-jest le
	 * reprenait en entier — un avertissement par fichier (« Got a `.js` file to
	 * compile while `allowJs` option is not set to `true` ») et des milliers de
	 * lignes generees recompilees pour rien. Le bot n'a aucune source `.js`.
	 */
	transform: {
		"^.+\\.ts$": "ts-jest",
	},

	testEnvironment: "node",
};
