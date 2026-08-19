/**
 * Page de retour affichee au navigateur apres l'aller-retour chez Blizzard.
 *
 * Servie par l'API elle-meme plutot que par une route Angular : elle est vue
 * une fois, par quelqu'un qui n'est pas connecte au dashboard et n'a aucune
 * raison d'en telecharger le bundle. Elle n'a donc ni script, ni ressource
 * externe — seulement de quoi dire quoi faire ensuite : retourner sur Discord.
 */

export type VerificationOutcome =
	| "succes"
	| "lien-invalide"
	| "lien-expire"
	| "deja-lie"
	| "refus-blizzard"
	| "indisponible";

interface PageContent {
	statut: number;
	titre: string;
	corps: string;
}

const CONTENUS: Record<VerificationOutcome, PageContent> = {
	succes: {
		statut: 200,
		titre: "Compte vérifié",
		corps:
			"Ton compte Battle.net est lié. Retourne sur Discord : ton accès s'ouvre " +
			"dans quelques secondes.",
	},
	"lien-invalide": {
		statut: 400,
		titre: "Lien invalide",
		corps:
			"Ce lien ne correspond à aucune demande en cours, ou il a déjà servi. " +
			"Reclique sur le bouton de vérification depuis Discord pour en obtenir un neuf.",
	},
	"lien-expire": {
		statut: 400,
		titre: "Lien expiré",
		corps:
			"Cette demande de vérification a expiré. Reclique sur le bouton depuis " +
			"Discord pour en lancer une nouvelle.",
	},
	"deja-lie": {
		statut: 409,
		titre: "Compte déjà utilisé",
		corps:
			"Ce compte Battle.net est déjà lié à un autre membre du serveur. " +
			"L'équipe de modération en a été informée ; contacte-la si tu penses " +
			"qu'il s'agit d'une erreur.",
	},
	"refus-blizzard": {
		statut: 502,
		titre: "Vérification impossible",
		corps:
			"Battle.net n'a pas confirmé la connexion. Réessaie dans un moment " +
			"depuis Discord.",
	},
	indisponible: {
		statut: 503,
		titre: "Vérification indisponible",
		corps:
			"La vérification Battle.net n'est pas configurée sur ce serveur. " +
			"Préviens l'équipe de modération.",
	},
};

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function verificationPage(outcome: VerificationOutcome): {
	statut: number;
	html: string;
} {
	const contenu = CONTENUS[outcome];
	const reussi = outcome === "succes";

	const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(contenu.titre)}</title>
<style>
:root { color-scheme: light dark; }
body {
  margin: 0; min-height: 100vh; display: grid; place-items: center;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #1e1f22; color: #f2f3f5; padding: 1.5rem;
}
main { max-width: 30rem; text-align: center; }
.marque { font-size: 3rem; line-height: 1; margin-bottom: 1rem; }
h1 { font-size: 1.5rem; margin: 0 0 0.75rem; }
p { margin: 0; line-height: 1.6; color: #b5bac1; }
</style>
</head>
<body>
<main>
<div class="marque" aria-hidden="true">${reussi ? "✅" : "⚠️"}</div>
<h1>${escapeHtml(contenu.titre)}</h1>
<p>${escapeHtml(contenu.corps)}</p>
</main>
</body>
</html>`;

	return { statut: contenu.statut, html };
}
