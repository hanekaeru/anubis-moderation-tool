import sanitizeHtml from "sanitize-html";

/**
 * Nettoyage du corps d'un article et extraction de sa version texte.
 *
 * **C'est ici que se joue la securite du wiki.** Le corps arrive en HTML depuis
 * l'editeur du dashboard : du contenu redige par un compte du staff, mais qui
 * transite par le navigateur et n'a donc aucune valeur de preuve. Un `<script>`
 * ou un `onerror=` accepte ici serait resservi a chaque lecture de l'article,
 * sur le domaine du dashboard, avec le jeton de session a portee — une porte
 * ouverte a l'escalade de privileges depuis n'importe quel compte autorise a
 * ecrire.
 *
 * Angular re-nettoie a l'affichage (`[innerHTML]` passe par son sanitizer), mais
 * cette seconde passe ne dispense pas de la premiere : l'API sert aussi des
 * clients qui ne sont pas Angular, et une base propre vaut mieux qu'une base
 * sale rendue proprement.
 *
 * Liste blanche stricte plutot que liste noire : les balises acceptees sont
 * exactement celles que l'editeur sait produire, et rien d'autre.
 */

/** Balises produites par la configuration TipTap du dashboard. */
const ALLOWED_TAGS = [
	"p",
	"br",
	"strong",
	"em",
	"s",
	"code",
	"pre",
	"blockquote",
	"h1",
	"h2",
	"h3",
	"ul",
	"ol",
	"li",
	"a",
	"hr",
];

const OPTIONS: sanitizeHtml.IOptions = {
	allowedTags: ALLOWED_TAGS,
	allowedAttributes: {
		a: ["href", "title", "target", "rel"],
	},
	// `javascript:` et `data:` sont exclus : un lien clique dans un article
	// executerait sinon du script dans la page.
	allowedSchemes: ["http", "https", "mailto"],
	allowedSchemesAppliedToAttributes: ["href"],
	// Sans cela, un `<a target="_blank">` donne a la page ouverte une reference
	// vers celle du dashboard (`window.opener`).
	transformTags: {
		a: sanitizeHtml.simpleTransform("a", {
			rel: "noopener noreferrer",
			target: "_blank",
		}),
	},
	// Une balise interdite disparait avec son contenu seulement si ce contenu
	// n'a aucun sens hors d'elle. Pour un `<div>` egare, le texte doit survivre.
	nonTextTags: ["style", "script", "textarea", "option", "noscript"],
};

export function sanitizeArticleHtml(html: string): string {
	return sanitizeHtml(html, OPTIONS);
}

/**
 * Version sans balises, pour la recherche.
 *
 * Les blocs sont separes par une espace : sans cela, `<p>ban</p><p>kick</p>`
 * donnerait « bankick » et ne repondrait a aucune des deux recherches.
 */
export function extractPlainText(html: string): string {
	const texte = sanitizeHtml(html, {
		allowedTags: [],
		allowedAttributes: {},
		// Retirer les balises ne laisse aucune trace de la coupure entre deux
		// blocs : `<p>ban</p><p>kick</p>` donnerait « bankick », introuvable par
		// une recherche sur l'un ou l'autre mot. Une espace apres chaque noeud
		// de texte retablit la separation, les blancs surnumeraires etant
		// ecrases juste apres.
		textFilter: (text) => `${text} `,
	});

	return decodeEntities(texte).replace(/\s+/g, " ").trim();
}

/**
 * `sanitize-html` rend le texte avec les entites encodees (`&amp;`), ce qui
 * ferait echouer une recherche sur un titre contenant « & ».
 */
function decodeEntities(texte: string): string {
	return texte
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ");
}

/**
 * Vrai quand l'article n'a aucun contenu utile.
 *
 * L'editeur renvoie `<p></p>` pour un corps vide : le test doit porter sur le
 * texte, pas sur la longueur du HTML.
 */
export function isBlankContent(html: string): boolean {
	return extractPlainText(html).length === 0;
}

/** Vitesse de lecture retenue, en mots par minute. */
const MOTS_PAR_MINUTE = 200;

export function readingMinutes(texte: string): number {
	if (!texte) return 0;
	const mots = texte.split(/\s+/).filter(Boolean).length;
	return Math.max(1, Math.round(mots / MOTS_PAR_MINUTE));
}

/**
 * Fabrique un identifiant d'URL a partir du titre.
 *
 * Les accents sont decomposes puis retires (`NFD` + suppression des marques
 * diacritiques) : « Procédure d'appel » donne `procedure-d-appel`, lisible et
 * sans caractere a echapper dans une URL.
 */
export function slugify(titre: string): string {
	const base = titre
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 140);

	// Un titre entierement compose de ponctuation ou d'ideogrammes ne laisse
	// rien : mieux vaut un identifiant technique qu'une chaine vide, qui
	// casserait l'URL de l'article.
	return base || "article";
}
