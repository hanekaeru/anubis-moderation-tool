# Recette des mini-jeux

Tester tout le calendrier des mini-jeux **avant la mise en production**, sans
attendre minuit ni une semaine entière.

Le principe : en mode test, le bot accepte une **horloge simulée**. La commande
`/minijeu-test` la déplace, et le vrai cycle (`bot/src/tasks/minigameSync.ts`)
fait le reste — publication, ping, corrections, fermeture, XP. Rien n'est
contourné : ce qui passe la recette est exactement ce qui tournera en
production.

> L'API et le dashboard restent **à l'heure réelle**. Le verrou « veille 23:59 »
> se teste donc sur de vrais jours (section 2).

---

## 0. Préparer l'environnement

À faire **sur un serveur Discord de test, avec un bot de test** — jamais avec le
jeton du bot de production.

1. Dans `bot/.env` : `MINIGAME_TEST_MODE=true`.
2. Publier les commandes (la commande de recette n'est publiée qu'avec la
   variable) :

   ```bash
   npm run refresh --prefix bot
   ```

3. Démarrer le bot. La console doit afficher
   `[Mini-jeux] MODE TEST ACTIF` au démarrage.
4. Dans le dashboard, page **Mini-jeux → Réglages** : salon d'annonce, salon de
   jeu, rôle pingé, heure du ping. Le bot doit avoir, dans le salon d'annonce,
   les permissions **Envoyer des messages**, **Joindre des fichiers** et
   **Créer des sondages**.
5. Idéalement deux comptes Discord : un administrateur (pour `/minijeu-test`)
   et un membre ordinaire (pour jouer comme un vrai joueur).

`/minijeu-test etat` résume à tout moment : heure simulée, réglage, jeu du jour
avec sa réponse (sous spoiler), étapes franchies, nombre de joueurs, dernière
erreur, jours suivants.

## 1. Les commandes de recette

| Commande | Effet |
| --- | --- |
| `/minijeu-test semaine [depart]` | Crée un jeu `[TEST]` de chaque type (héros, map, skin, vrai ou faux, duel, clip), un par jour libre à partir de `depart` (défaut : lendemain du jour simulé). Donne les réponses. |
| `/minijeu-test etape <publication\|ping\|fermeture> [date]` | Place l'horloge 5 s après l'étape du jeu de ce jour et lance le cycle tout de suite. |
| `/minijeu-test horloge <date> <heure>` | Place l'horloge à une date et une heure de Paris précises (tester 23:59, minuit pile…). |
| `/minijeu-test rejouer [date] [parties-seulement]` | Remet un jeu à zéro : retire ses messages Discord, efface publication, ping, fermeture et parties. Avec `parties-seulement`, n'efface que les essais des joueurs. |
| `/minijeu-test heure-reelle` | Revient à l'heure réelle. Un redémarrage du bot fait de même. |

L'XP gagnée pendant la recette est **réelle** dans la base de test : `rejouer`
ne la reprend pas (`/xp-admin retirer` si besoin).

## 2. Dashboard — calendrier et verrou

Avec un compte **modérateur** (`minigames:write`) puis un compte
**administrateur** (`minigames:manage`) :

- [ ] Créer un jeu pour demain, de chaque type : les champs affichés suivent le
      type, et le message d'erreur dit ce qui manque (héros, map, skin, réponse
      vrai/faux, deux réponses de duel minimum…).
- [ ] Un jour passé ne se crée pas.
- [ ] Ajouter jusqu'à 4 images à un jeu ; la 5ᵉ est refusée, ainsi qu'un type
      de fichier non accepté.
- [ ] `/minijeu-test semaine depart:<aujourd'hui, date réelle>` pour avoir un
      jeu **du jour réel** : le modérateur ne peut plus le modifier (bouton
      grisé **et** refus de l'API), l'administrateur si.
- [ ] Un jeu fermé ne se modifie plus, même par l'administrateur.
- [ ] Une fois un duel ou un vrai ou faux publié, son type et son sondage ne se
      modifient plus (le texte de l'embed, si).
- [ ] La semaine type des réglages pré-remplit le type d'un jour qu'on ouvre.

## 3. Cycle d'une journée (à faire pour chaque type)

Partir d'une semaine de test (`/minijeu-test semaine`), puis pour chaque jour :

1. [ ] `etape publication date:<jour>` → l'embed part dans le salon d'annonce,
       **sans ping**. Pour un duel ou un vrai ou faux, le sondage suit dans un
       message à part. Les images s'affichent en galerie sous un seul titre.
2. [ ] Modifier le texte du jeu dans le dashboard → l'embed est corrigé en place
       dans les 5 s (`etat` affiche « Correction en attente » entre-temps).
3. [ ] Supprimer l'embed à la main sur Discord, puis modifier à nouveau → l'embed
       est republié.
4. [ ] `etape ping` → un **message séparé** mentionne le rôle, en réponse à
       l'embed, et notifie réellement les membres du rôle.
5. [ ] Jouer (voir section 4).
6. [ ] `etape fermeture` → annonce de fin sans ping, avec la réponse et le
       nombre de gagnants ; `/devine` répond qu'il n'y a plus de jeu.
       Attention : le jour suivant est publié dans le même passage s'il a un
       jeu — c'est le comportement normal de minuit.

Cas limites du cycle :

- [ ] **Ping désactivé** sur un jeu, ou aucun rôle réglé → aucun message de ping,
      et l'étape est tout de même marquée faite.
- [ ] **Bot éteint toute une journée** : `horloge` de J-1 directement à J+1
      (`/minijeu-test horloge date:<J+1> heure:10:00`) → le jeu du jour J
      n'est **pas** publié en retard.
- [ ] **Salon d'annonce supprimé** dans les réglages → `etat` affiche l'erreur,
      le dashboard aussi, et la publication est retentée au plus une fois par
      minute.
- [ ] **Minuit pile** : `horloge date:<J> heure:23:59`, jouer, puis attendre
      une minute → le jeu se ferme tout seul au passage suivant.

## 4. Jouer — chaque type

Avec le compte membre, dans le salon de jeu (et une fois **hors** du salon de
jeu : `/devine` renvoie vers le bon salon ; un fil du salon de jeu compte).

**Devine le héros / Devine la map**
- [ ] L'autocomplétion propose les héros (ou les maps) actifs, rien d'autre.
- [ ] Un nom inconnu ou un doublon ne coûte **pas** d'essai.
- [ ] Mauvaise réponse → essais restants affichés ; dernier essai raté → message
      « plus d'essais » du réglage (ou celui du jeu s'il en a un).
- [ ] Bonne réponse → XP selon le barème de l'essai (100/60/30 par défaut) ;
      `/devine` répond ensuite « déjà trouvé ».
- [ ] Une montée de niveau déclenchée par un mini-jeu s'annonce comme une
      montée par message (et pose les rôles de palier).

**Devine le skin** (réponse de la semaine de test : `Anubis`)
- [ ] Pas d'autocomplétion (elle dévoilerait la réponse).
- [ ] Donner le héros seul → « héros trouvé », moitié du barème de l'essai.
- [ ] Redonner le héros → ne coûte pas d'essai.
- [ ] Trouver le skin ensuite → total porté au barème de **cet** essai, jamais
      cumulé (héros au 1er = 50, skin au 2e = 60 au total, pas 110).
- [ ] Tolérance : `anubiss`, `ANUBIS`, `Anûbis` passent ; un skin de 4 lettres
      ou moins n'en tolère aucune.

**Vrai ou faux** (réponse de la semaine de test : Vrai)
- [ ] Voter, **changer d'avis**, puis fermer → seuls les votes finaux comptent ;
      les bons votants reçoivent l'XP du réglage, une seule fois.
- [ ] `/devine` ce jour-là renvoie vers le sondage.

**Duel**
- [ ] Le sondage porte les réponses saisies ; aucune XP à la fermeture.

**Clip**
- [ ] Pas de sondage ; `/devine` explique qu'il n'y a rien à deviner.

## 5. Avant de passer en production

- [ ] `/minijeu-test heure-reelle`.
- [ ] Supprimer les jeux `[TEST]` restants depuis le calendrier (la suppression
      ne retire rien de Discord : nettoyer le salon à la main).
- [ ] Retirer `MINIGAME_TEST_MODE` du `.env`, puis `npm run refresh --prefix bot`
      pour retirer `/minijeu-test` de la liste des commandes.
- [ ] Vérifier que la variable **n'existe pas** dans l'environnement du
      conteneur `bot` de production (Coolify) : au démarrage, la ligne
      `MODE TEST ACTIF` ne doit pas apparaître dans les journaux.
