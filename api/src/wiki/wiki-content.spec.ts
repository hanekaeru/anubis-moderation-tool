import {
	extractPlainText,
	isBlankContent,
	readingMinutes,
	sanitizeArticleHtml,
	slugify,
} from "./wiki-content";

describe("sanitizeArticleHtml", () => {
	it("garde le balisage que l'editeur produit", () => {
		const html =
			"<h2>Bannissement</h2><p>Un <strong>ban</strong> se pose apres <em>trois</em> avertissements.</p><ul><li>Premier</li></ul>";

		expect(sanitizeArticleHtml(html)).toBe(html);
	});

	it("retire les scripts en conservant le texte alentour", () => {
		// Le cas qui compte : un article est resservi a chaque lecture, sur le
		// domaine du dashboard, jeton de session a portee.
		const propre = sanitizeArticleHtml(
			"<p>Avant</p><script>fetch('//pirate')</script><p>Apres</p>",
		);

		expect(propre).not.toContain("script");
		expect(propre).not.toContain("pirate");
		expect(propre).toContain("Avant");
		expect(propre).toContain("Apres");
	});

	it("retire les gestionnaires d'evenement inline", () => {
		const propre = sanitizeArticleHtml(
			`<p onmouseover="alert(1)">Passe la souris</p>`,
		);

		expect(propre).not.toContain("onmouseover");
		expect(propre).toContain("Passe la souris");
	});

	it("refuse un lien javascript: mais garde son libelle", () => {
		const propre = sanitizeArticleHtml(
			`<a href="javascript:alert(1)">Cliquer</a>`,
		);

		expect(propre).not.toContain("javascript:");
		expect(propre).toContain("Cliquer");
	});

	it("pose rel=noopener sur les liens sortants", () => {
		// Sans lui, la page ouverte garde une reference vers celle du dashboard.
		const propre = sanitizeArticleHtml(`<a href="https://exemple.fr">Doc</a>`);

		expect(propre).toContain('rel="noopener noreferrer"');
	});

	it("laisse passer une image inexistante sans son attribut d'erreur", () => {
		const propre = sanitizeArticleHtml(
			`<img src="x" onerror="alert(document.cookie)" />`,
		);

		expect(propre).not.toContain("onerror");
		expect(propre).not.toContain("img");
	});
});

describe("extractPlainText", () => {
	it("separe les blocs pour que la recherche trouve chaque mot", () => {
		// Sans separation, « bankick » ne repondrait ni a « ban » ni a « kick ».
		expect(extractPlainText("<p>ban</p><p>kick</p>")).toBe("ban kick");
	});

	it("redecode les entites, sinon un titre avec & serait introuvable", () => {
		expect(extractPlainText("<p>Sanctions &amp; recours</p>")).toBe(
			"Sanctions & recours",
		);
	});
});

describe("isBlankContent", () => {
	it("reconnait le paragraphe vide que renvoie l'editeur", () => {
		expect(isBlankContent("<p></p>")).toBe(true);
		expect(isBlankContent("<p>   </p>")).toBe(true);
		expect(isBlankContent("<p>Texte</p>")).toBe(false);
	});
});

describe("slugify", () => {
	it("retire les accents et la ponctuation", () => {
		expect(slugify("Procédure d'appel")).toBe("procedure-d-appel");
	});

	it("retombe sur une valeur utilisable quand le titre ne laisse rien", () => {
		// Une chaine vide casserait l'URL de l'article.
		expect(slugify("!!!")).toBe("article");
	});
});

describe("readingMinutes", () => {
	it("ne descend jamais sous une minute pour un article non vide", () => {
		expect(readingMinutes("trois mots ici")).toBe(1);
		expect(readingMinutes("")).toBe(0);
	});
});
