# NOVA CLUB | E-commerce — Bot Discord (Cloudflare Workers, gratuit)

Bot Discord du serveur **NOVA CLUB | E-commerce**, hébergé gratuitement sur Cloudflare Workers.
Il fonctionne par **interactions HTTP** : Discord envoie chaque clic ou commande à l'adresse de ton Worker, qui répond.
Pas de connexion permanente, pas de serveur à garder allumé.

Ce que fait le bot :

Chaque panneau est **un seul message** : la **bannière animée (GIF) tout en haut**, puis l'**encadré** (embed) avec un **titre** et un emoji,
le **texte en sections courtes** (titres en gras + emojis) et la **barre orange** (#FF6B1A) sur le côté. Le menu déroulant ou les boutons sont placés **sous** le message.

Où est la bannière ? Le réglage **`banner_position`** de `config.json` décide :

| Valeur | Effet | Fichiers utilisés |
|---|---|---|
| `"fichier"` (**par défaut**) | le bot lit le GIF « -haut » dans ses fichiers (`public/`) et l'envoie comme **pièce jointe du même message** : pas de lien dans le texte, pas d'encadré réservé à l'image. Le message ne contient que l'encadré de texte (titre, texte, barre orange) | `banniere-…-haut.gif` |
| `"haut_encadre"` | **deux encadrés** : le 1er ne contient que l'image (couleur `#2B2D31`, barre invisible), le 2e est l'encadré habituel | `banniere-…-haut.gif` |
| `"haut"` | l'adresse de la bannière est écrite dans le **texte du message** (Discord doit en faire un aperçu : ça ne marche pas toujours) | `banniere-…-haut.gif` |
| `"encadre"` | l'ancienne bannière est **dans l'encadré, en bas** | `banniere-….gif` (les anciennes) |

Pour changer de mode : modifie `banner_position`, redéploie (`npx wrangler deploy`), puis republie les panneaux. Les deux séries d'images restent dans `public/`.

**Comment fonctionne le mode `"fichier"`** : à la publication d'un panneau (`/panel-*`, `/annonce`), le Worker
1. vérifie que le bot a la permission **« Joindre des fichiers »** dans le salon (sinon : message d'erreur clair, rien n'est publié) ;
2. lit le GIF dans `public/` grâce au *binding* `ASSETS` de `wrangler.toml` (aucune adresse externe) ;
3. envoie **un seul message** à Discord en `multipart/form-data` : `payload_json` (contenu, encadrés, menus/boutons, mentions, `attachments: [{ id: 0, filename: "banniere.gif" }]`) et `files[0]` (le GIF) ;
4. **relit le message** avec l'API et te dit dans le message de confirmation si le GIF est bien reconnu comme pièce jointe `image/gif` **animée**, par exemple
   `🎞️ banniere.gif : pièce jointe reconnue par Discord (image/gif, animée, 1,8 Mo).`

Pour `/annonce`, le ping (`@everyone` ou rôle) reste dans le **texte du message**. `/panel-formation` garde `decouverte-formation.png` en grande image dans l'encadré.

> **Limites du mode `"fichier"`**
> - **Place de l'image** : l'API ne dit pas où Discord dessine la pièce jointe. Elle est censée apparaître au-dessus de l'encadré ; **regarde le salon après la première publication**. Si elle s'affiche *sous* l'encadré, voir [Si la pièce jointe s'affiche sous l'encadré](#si-la-pièce-jointe-saffiche-sous-lencadré).
> - **Poids** : un GIF joint doit rester sous la limite d'envoi du serveur (20 Mo par défaut ; le bot vérifie et te prévient). Vise moins de 10 Mo.
> - **Pièce jointe** : c'est un vrai fichier du message (les membres peuvent l'ouvrir et la télécharger), et elle compte parmi les fichiers du salon.
> - **Anciens messages** : changer de mode ne modifie pas les panneaux déjà publiés ; republie-les.

| Commande / bouton | Effet |
|---|---|
| `/panel-infos [salon]` | « 📌 Informations » : texte de bienvenue, salons utiles en liste cliquable, bannière `banniere-informations-haut.gif`. |
| `/panel-reglement [salon]` | « 📜 Règlement du serveur » : règles numérotées, bannière `banniere-reglement-haut.gif`, bouton **J'ai lu et j'accepte** sous le message (donne le rôle Membre). |
| `/panel-tickets [salon]` | « 🎫 Support — Nova Club » : liste des catégories (Support, Problème d'accès, Question sur la formation, Autre), consigne vers le salon questions, bannière `banniere-tickets-haut.gif`, et menu **Sélectionne la raison de ton ticket** (pas de bouton). |
| `/panel-formation [salon]` | « 🎓 Formation dropshipping eBay & Etsy » : texte court avec prix et lien, bannière `banniere-formation-haut.gif`, `decouverte-formation.png` en grande image dans un encadré, bouton **🚀 Découvrir la formation** sous le message. |
| `/panel-outils [salon]` | « 🛠️ Outils pour ton business » : liste modifiable (nom, description, lien), `banniere-outils-haut.gif`. |
| `/panel-faq [salon]` | « ❓ FAQ » : une section par question, `banniere-faq-haut.gif`. |
| `/panel-autopilot [salon]` | « 🤖 Nova Autopilot » : présentation de l'outil, `banniere-autopilot-haut.gif`, bouton lien. Aucune promesse de gains. |
| `/annonce [salon] [ping] [role] [image]` | Ouvre un **formulaire** (Titre + Texte) puis publie un encadré (titre, texte, barre orange) avec la bannière choisie (`banniere-annonce-haut.gif` par défaut) au-dessus. Si tu mentionnes quelqu'un, le **ping est dans le texte du message, avant les encadrés**. |
| Choix dans le menu des tickets | Crée **directement** un salon privé `ticket-pseudo` (visible par la personne et le rôle Staff) dans la catégorie dédiée. Une seule demande ouverte par personne. |
| Bouton *Je m'en occupe* | Réservé au staff : indique qui prend en charge le ticket. |
| Bouton *Fermer le ticket* | Demande confirmation, envoie la transcription (200 derniers messages max, fichier `.txt`) dans le salon de logs, puis supprime le salon. |

Les commandes `/panel-*` et `/annonce` sont réservées aux administrateurs (masquées pour les autres et revérifiées par le bot).
Les boutons et menus utilisent des `custom_id` fixes : ils continuent de fonctionner après chaque redéploiement.

**Tous les textes sont dans [`config.json`](config.json)** : titres, règles, catégories, liens, adresses des images, messages d'erreur, couleur…

Les images sont dans le dossier [`public/`](public/) et servies gratuitement par le Worker (fichiers statiques Cloudflare) à des adresses stables,
par exemple `https://nova-club-bot.novaclub.workers.dev/banniere-tickets.gif`. La page « en ligne ✅ » reste à la racine.
Le bot ajoute `?v=3` à ces adresses quand il publie (réglage `images_version`) : cela force Discord à recharger une image que tu as remplacée.

> **Tu mets à jour un bot déjà installé ?** Va directement à la section [Mise à jour : bannière en pièce jointe](#mise-à-jour--bannière-en-pièce-jointe).

---

## Sommaire

1. [Limites du forfait gratuit Cloudflare](#1-limites-du-forfait-gratuit-cloudflare)
2. [Installer Node.js](#2-installer-nodejs-windows)
3. [Récupérer le dossier et installer wrangler](#3-récupérer-le-dossier-et-installer-wrangler)
4. [Créer l'application Discord](#4-créer-lapplication-discord)
5. [Préparer le serveur et copier les identifiants](#5-préparer-le-serveur-et-copier-les-identifiants)
6. [Remplir le fichier .env](#6-remplir-le-fichier-env)
7. [Créer le compte Cloudflare (gratuit)](#7-créer-le-compte-cloudflare-gratuit)
8. [Créer le stockage KV](#8-créer-le-stockage-kv)
9. [Déployer le Worker](#9-déployer-le-worker)
10. [Configurer les secrets](#10-configurer-les-secrets)
11. [Coller l'URL dans « Interactions Endpoint URL »](#11-coller-lurl-dans--interactions-endpoint-url-)
12. [Inviter le bot](#12-inviter-le-bot-sur-le-serveur)
13. [Placer le rôle du bot](#13-placer-le-rôle-du-bot-au-dessus-des-rôles-quil-donne)
14. [Enregistrer les commandes slash](#14-enregistrer-les-commandes-slash)
15. [Tester chaque commande](#15-tester-chaque-commande)
16. [Personnaliser les textes](#16-personnaliser-les-textes)
17. [Déploiement automatique depuis GitHub](#17-déploiement-automatique-depuis-github)
18. [Ce que cette méthode ne peut pas faire](#18-ce-que-cette-méthode-ne-peut-pas-faire)
19. [Dépannage](#19-dépannage)
20. [Mise à jour : bannière en pièce jointe](#mise-à-jour--bannière-en-pièce-jointe)

---

## 1. Limites du forfait gratuit Cloudflare

Vérifiées le 6 octobre 2026 dans la documentation officielle de Cloudflare
([limites Workers](https://developers.cloudflare.com/workers/platform/limits/), [limites KV](https://developers.cloudflare.com/kv/platform/limits/)) :

| Limite (forfait Workers Free) | Valeur |
|---|---|
| Requêtes | 100 000 par jour (remise à zéro à minuit UTC) |
| Temps **CPU** par requête | 10 ms (l'attente du réseau, de Discord ou de KV ne compte pas) |
| Sous-requêtes (`fetch`) par requête | 50 |
| Sous-requêtes vers les services Cloudflare (KV…) | 1 000 par requête |
| Travail après la réponse (`ctx.waitUntil`) | 30 secondes maximum |
| Mémoire | 128 Mo |
| KV : lectures | 100 000 par jour |
| KV : écritures (clés différentes) | 1 000 par jour |
| KV : écritures sur la même clé | 1 par seconde |
| KV : stockage | 1 Go |

Comment le code les respecte :

- **10 ms de CPU** : aucune bibliothèque lourde. La signature est vérifiée avec la cryptographie native de Workers (Ed25519), la clé est mise en cache, et la transcription utilise un seul formateur de dates réutilisé.
- **50 sous-requêtes** : l'action la plus lourde (fermer un ticket) en utilise environ 4 à 5 : 2 pages de 100 messages, 1 envoi du fichier, 1 suppression du salon (+1 seul nouvel essai si Discord demande d'attendre). Ouvrir un ticket : 2 à 4.
- **Réponse sous 3 secondes** exigée par Discord : le bot répond tout de suite (réponse différée « … réfléchit ») et termine le travail avec `ctx.waitUntil`, bien en dessous des 30 s.
- **KV** : 2 écritures à l'ouverture d'un ticket (+1 si le staff le prend en charge) et 2 suppressions à la fermeture. Avec 1 000 écritures par jour, environ 400 tickets par jour.
- **Images** : les fichiers de `public/` sont servis directement par Cloudflare. D'après la [documentation des fichiers statiques](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), ces requêtes sont **gratuites, illimitées** et ne comptent pas dans les 100 000 requêtes par jour. Limite : 25 Mo par fichier, 20 000 fichiers.

---

## 2. Installer Node.js (Windows)

1. Va sur <https://nodejs.org> et télécharge la version **LTS** (bouton de gauche).
2. Lance le fichier `.msi` et clique sur *Suivant* jusqu'à la fin (garde les options par défaut).
3. Ouvre **PowerShell** : touche Windows, tape `powershell`, Entrée.
4. Vérifie l'installation :
   ```powershell
   node -v
   npm -v
   ```
   Tu dois voir deux numéros de version (Node.js 20.6 ou plus récent).

> Si PowerShell affiche « l'exécution de scripts est désactivée sur ce système » quand tu lances `npx` ou `npm`,
> tape une seule fois :
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```
> puis réponds `O` (Oui).

## 3. Récupérer le dossier et installer wrangler

1. Télécharge le ZIP de la branche GitHub et décompresse-le (clic droit > *Extraire tout*).
2. Ouvre le dossier `nova-club-bot` dans l'Explorateur, clique dans la barre d'adresse, tape `powershell` puis Entrée : PowerShell s'ouvre directement dans le bon dossier.
3. Installe les dépendances (dont **wrangler**, l'outil officiel de Cloudflare) :
   ```powershell
   npm install
   ```
   Wrangler s'utilise ensuite avec `npx wrangler …` (pas besoin de l'installer globalement).

## 4. Créer l'application Discord

1. Va sur <https://discord.com/developers/applications> et clique sur **New Application**. Nomme-la par exemple `NOVA CLUB`.
2. Onglet **General Information** : note l'**Application ID** et la **Public Key** (bouton *Copy*).
3. Onglet **Bot** :
   - Clique sur **Reset Token**, confirme, puis copie le **token**. Il ne sera plus affiché : garde-le précieusement et ne le partage jamais.
   - Désactive **Public Bot** pour que personne d'autre ne puisse l'inviter.
   - Aucun « Privileged Gateway Intent » n'est nécessaire : laisse-les désactivés.
4. Onglet **Installation** (s'il existe) : dans *Install Link*, choisis **None** (on utilisera notre propre lien d'invitation).

## 5. Préparer le serveur et copier les identifiants

1. Dans Discord : **Paramètres utilisateur > Avancés > Mode développeur** : active-le.
2. Sur ton serveur, crée si besoin :
   - un rôle **Membre** (donné quand on accepte le règlement) ;
   - un rôle **Staff** (l'équipe qui gère les tickets) ;
   - une **catégorie** « Tickets » (privée : retire « Voir les salons » à @everyone) ;
   - un **salon de logs** privé, visible par le staff (les transcriptions y arrivent).
3. Copie les identifiants par **clic droit > Copier l'identifiant** :
   - l'icône du serveur → `DISCORD_GUILD_ID`
   - le rôle Membre (Paramètres du serveur > Rôles) → `MEMBER_ROLE_ID`
   - le rôle Staff → `STAFF_ROLE_ID`
   - la catégorie Tickets → `TICKET_CATEGORY_ID`
   - le salon de logs → `LOG_CHANNEL_ID`
   - les salons à présenter dans `/panel-infos` → à mettre dans `config.json` (voir étape 16).

## 6. Remplir le fichier .env

Dans PowerShell (dossier `nova-club-bot`) :

```powershell
copy .env.example .env
notepad .env
```

Remplis chaque ligne après le `=` (sans espace, sans guillemets), puis enregistre.
Le fichier `.env` est listé dans `.gitignore` : il ne sera **jamais** envoyé sur GitHub.

## 7. Créer le compte Cloudflare (gratuit)

1. Inscris-toi sur <https://dash.cloudflare.com/sign-up> et valide ton adresse e-mail. Aucune carte bancaire n'est nécessaire pour Workers Free.
2. Connecte wrangler à ton compte :
   ```powershell
   npx wrangler login
   ```
   Une page s'ouvre dans le navigateur : clique sur **Allow**.

## 8. Créer le stockage KV

```powershell
npx wrangler kv namespace create TICKETS
```

Wrangler affiche un bloc contenant `id = "xxxxxxxx…"`. Ouvre `wrangler.toml` (`notepad wrangler.toml`)
et mets cet identifiant dans la ligne `id = "…"` de `[[kv_namespaces]]`. (Ce n'est pas un secret : il ne donne aucun accès sans ton compte.)
Pour NOVA CLUB, c'est déjà fait : `a693b12728f0444e95be152943f837e3`.

## 9. Déployer le Worker

Place d'abord les images dans le dossier `public/` (voir [la section Images](#images-du-dossier-public)), vérifie-les, puis déploie :

```powershell
npm run check-images -- --local
npx wrangler deploy
```

À la première utilisation, Cloudflare peut te demander de choisir un sous-domaine `workers.dev` : accepte.
À la fin, wrangler affiche l'adresse du bot, par exemple :

```
https://nova-club-bot.ton-sous-domaine.workers.dev
```

Ouvre-la dans le navigateur : tu dois voir « Bot NOVA CLUB | E-commerce en ligne ✅ ».

## 10. Configurer les secrets

Envoie tout le contenu de `.env` dans les secrets chiffrés de Cloudflare, en une commande :

```powershell
npm run secrets
```

(équivalent de `npx wrangler secret bulk .env`). Vérifie avec :

```powershell
npx wrangler secret list
```

Pour changer une seule valeur plus tard : `npx wrangler secret put DISCORD_TOKEN` (puis colle la valeur).
Les secrets restent en place lors des déploiements suivants.

## 11. Coller l'URL dans « Interactions Endpoint URL »

1. Portail développeur Discord > ton application > **General Information**.
2. Dans **Interactions Endpoint URL**, colle l'adresse du Worker (étape 9).
3. Clique sur **Save Changes**.

Discord envoie alors un test signé au bot. Si l'enregistrement réussit, la signature fonctionne.
S'il échoue : vérifie que `DISCORD_PUBLIC_KEY` est correct (étape 10) et que l'adresse ouvre bien la page « en ligne ✅ ».

## 12. Inviter le bot sur le serveur

```powershell
npm run invite
```

Ouvre le lien affiché, choisis ton serveur et valide. Permissions demandées (le minimum utile) :

| Permission | Pourquoi |
|---|---|
| Gérer les salons | créer et supprimer les salons de tickets |
| Gérer les rôles | donner le rôle Membre et régler les accès privés des tickets |
| Voir les salons | voir les salons où il publie (indispensable pour agir) |
| Envoyer des messages | publier les panneaux et les messages de ticket |
| Intégrer des liens | afficher les encadrés (embeds) |
| Joindre des fichiers | envoyer la transcription `.txt` dans les logs |
| Voir les anciens messages | lire les messages du ticket pour la transcription |

« Voir les salons » et « Joindre des fichiers » s'ajoutent à ta liste : sans elles, le bot ne peut ni voir les salons ni envoyer la transcription.

Ensuite, donne au rôle du bot l'accès à la **catégorie Tickets** et au **salon de logs** (Modifier le salon > Permissions > ajouter le rôle du bot : Voir le salon, Envoyer des messages, Joindre des fichiers, Voir les anciens messages, Gérer les salons).

## 13. Placer le rôle du bot au-dessus des rôles qu'il donne

**Paramètres du serveur > Rôles** : fais glisser le rôle du bot (même nom que l'application) **au-dessus** du rôle **Membre**.
Sinon Discord refuse de donner le rôle et le bot affiche « le bot n'a pas les permissions nécessaires… ».

Pour que le rôle Staff soit vraiment notifié à l'ouverture d'un ticket, active « Autoriser tout le monde à @mentionner ce rôle » sur le rôle Staff
(sinon la mention s'affiche mais ne sonne pas).

## 14. Enregistrer les commandes slash

```powershell
npm run register
```

Résultat attendu : `✅ 8 commandes enregistrées : /panel-infos, /panel-reglement, /panel-tickets, /panel-formation, /panel-outils, /panel-faq, /panel-autopilot, /annonce`.
Les commandes sont enregistrées pour ton serveur uniquement : elles apparaissent tout de suite.
Relance cette commande si tu modifies les descriptions des commandes dans `config.json`.

## 15. Tester chaque commande

Avec un compte administrateur :

Après chaque publication, le message privé de confirmation indique ce que Discord a lu pour chaque image, par exemple
`🎞️ banniere-tickets.gif : GIF animé reconnu par Discord.` C'est Discord lui-même qui le confirme dans sa réponse (si l'image n'est pas encore analysée, le message le dit : regarde alors l'affichage dans le salon).

1. **`/panel-infos`** dans un salon de test → la bannière animée tout en haut, puis un encadré orange : titre, texte, salons cliquables.
   Message « remplace les identifiants de salon » ? Complète `infos.channels` dans `config.json` puis redéploie.
2. **`/panel-reglement salon:#règlement`** → le règlement numéroté apparaît avec le bouton.
   Avec un compte **non** administrateur (un second compte), clique sur **J'ai lu et j'accepte** → message privé de confirmation et rôle Membre ajouté. Un second clic indique « tu as déjà accepté ».
3. **`/panel-tickets salon:#support`** → la bannière en haut, l'encadré « 🎫 Support — Nova Club », puis le menu « Sélectionne la raison de ton ticket » en dessous.
   (Message « remplace les identifiants de salon : REMPLACE_PAR_ID_SALON_QUESTIONS » ? Mets l'identifiant du salon questions dans `tickets.questions_channel_id`.)
   - Avec le second compte : choisis une raison → un message privé donne le lien vers `#ticket-pseudo`, et le menu se vide.
   - Choisis à nouveau une raison → « Tu as déjà une demande ouverte ».
   - Dans le ticket, avec le second compte, clique sur *Je m'en occupe* → refusé (réservé au staff). Avec un compte Staff → bouton grisé « Pris en charge ».
   - Clique sur *Fermer le ticket* → confirmation → *Oui, fermer* → la transcription arrive dans le salon de logs, puis le salon disparaît.
4. **`/panel-formation`**, **`/panel-outils`**, **`/panel-faq`**, **`/panel-autopilot`** → vérifie la bannière, l'encadré et que chaque bouton ouvre le bon lien.
   Tant que les liens d'exemple (`https://exemple.com/a-remplacer-…`) sont là, les boutons mènent vers une page d'exemple : remplace-les dans `config.json`.
5. **`/annonce`** → un formulaire s'ouvre avec « Titre » et « Texte ». Teste avec `ping` = Aucun d'abord, puis `image` = Outils : la bannière choisie apparaît au-dessus de l'encadré. Avec un ping, la mention est sur la ligne au-dessus de l'image.
   Le texte accepte le gras (`**gras**`), les emojis et les listes (une ligne par `- élément`).
   Pour tester un ping : voir [les pings d'annonce](#les-pings-de-annonce).
6. Avec le second compte (non administrateur), vérifie que les commandes `/panel-*` et `/annonce` n'apparaissent pas.

Pour voir les erreurs éventuelles en direct : `npx wrangler tail` (ou tableau de bord Cloudflare > Workers > nova-club-bot > Logs).

Tests automatiques hors ligne (Discord est simulé, rien n'est envoyé à ton serveur) : `npm test`.

## 16. Personnaliser les textes

Ouvre `config.json` avec le Bloc-notes ou VS Code. Les valeurs **À REMPLACER** sont des exemples :

| Où | Quoi |
|---|---|
| `color` | couleur de la barre des encadrés, `#FF6B1A` |
| `…banner_url`, `formation.image_url` | adresses des images (dossier `public/`). Laisse `""` pour ne pas afficher d'image. |
| `banner_position` | `"fichier"` (défaut : GIF « -haut » en pièce jointe), `"haut_encadre"` (encadré de bannière seule + encadré habituel), `"haut"` (adresse dans le texte du message) ou `"encadre"` (ancienne bannière dans l'encadré) |
| `banner_embed_color` | couleur du 1er encadré en mode `"haut_encadre"` uniquement : `#2B2D31` = fond du thème sombre de Discord (barre invisible) |
| `…banner_haut_url` | adresse de la bannière « -haut » de chaque panneau (le **nom du fichier** doit exister dans `public/` ; modes `"fichier"`, `"haut_encadre"` et `"haut"`) ; `…banner_url` = l'ancienne bannière (mode `"encadre"`) |
| `largeur_invisible` | nombre de caractères invisibles « ⠀ » (U+2800) ajoutés en **dernière ligne** de chaque encadré de texte, pour qu'il s'affiche à la **largeur maximale** de Discord (520 px) même avec un texte court. `0` = désactivé, maximum 200. Voir [Régler la largeur des encadrés](#régler-la-largeur-des-encadrés) |
| `images_version` | numéro ajouté aux adresses (`?v=3`). **Augmente-le** (3, 4…) quand tu remplaces une image par une nouvelle version, puis redéploie et republie |
| `annonce.images` | les choix de l'option `image` de `/annonce` (nom affiché + bannière). `default_image` = choix par défaut |
| `infos.channels` | pour chaque salon : identifiant (`"id"`), emoji, description |
| `reglement.rules` | une règle par ligne, numérotation automatique |
| `tickets.questions_channel_id` | identifiant du salon questions (remplace `{salon_questions}` dans le texte des tickets) |
| `tickets.categories` | `value` = code interne (sans espace ni accent, ne pas changer après publication), `label` = texte affiché |
| `formation.prix`, `formation.lien` | prix et lien de la formation (le bouton ouvre `lien`) |
| `outils.tools` | pour chaque outil : `name`, `description`, `url` (15 outils maximum) |
| `faq.questions` | pour chaque question : `question`, `answer` (15 maximum) |
| `autopilot.lien_autopilot` | lien du bouton Nova Autopilot |

Les liens doivent commencer par `https://`, sinon le bot affiche une erreur claire au lieu de publier.

Dans les textes des encadrés : `**gras**`, `*italique*`, listes avec `- `, et `\n` pour aller à la ligne. Le titre d'un encadré (`title`) n'accepte pas la mise en forme. Limites de Discord : 256 caractères pour le titre, 4096 pour le texte (6000 en tout par message) ; le bot t'avertit si c'est trop long.

### Images du dossier public

Le dossier `public/` doit contenir ces fichiers (noms exacts, en minuscules) :

```
Bannières « -haut » ("fichier", "haut_encadre", "haut")   Anciennes bannières ("encadre")
banniere-tickets-haut.gif                banniere-tickets.gif
banniere-reglement-haut.gif              banniere-reglement.gif
banniere-informations-haut.gif           banniere-informations.gif
banniere-formation-haut.gif              banniere-formation.gif
banniere-outils-haut.gif                 banniere-outils.gif
banniere-faq-haut.gif                    banniere-faq.gif
banniere-autopilot-haut.gif              banniere-autopilot.gif
banniere-annonce-haut.gif                banniere-annonce.gif

decouverte-formation.png   (image de /panel-formation, dans l'encadré, quelle que soit la position)
```

`npm run check-images` ne contrôle que la série de la position choisie (plus `decouverte-formation.png`) : tant que tu es en `"fichier"`, `"haut_encadre"` ou `"haut"`, les anciennes bannières peuvent rester dans `public/` sans être vérifiées.

- Vérifie-les avant de déployer : `npm run check-images -- --local` (présence, vrai GIF **animé**, poids).
- Après le déploiement : `npm run check-images` télécharge chaque adresse en ligne et refait les mêmes contrôles.
- Vise **moins de 10 Mo** par GIF pour un affichage rapide dans Discord (maximum absolu : 25 Mo chez Cloudflare).
- Pour **remplacer** une image : copie la nouvelle dans `public/` (même nom), **augmente `images_version`** dans `config.json` (ex. `"3"`), redéploie, puis republie le panneau. Discord garde les images en cache d'après leur adresse : sans nouveau numéro, tu pourrais revoir l'ancienne.
- Les images doivent aussi être envoyées sur GitHub (dossier `public/`) si tu utilises le déploiement automatique, sinon l'Action s'arrête avec « fichier introuvable » (c'est voulu : elle ferait disparaître les images du site).

Attention à garder des guillemets droits `"` et des virgules entre les éléments. En cas de doute, colle le fichier sur <https://jsonlint.com> pour le vérifier.

Puis redéploie : `npx wrangler deploy` (ou pousse sur GitHub, étape 17).
Les panneaux déjà publiés ne changent pas : relance la commande `/panel-…` et supprime l'ancien message.

### Les pings d'annonce

`/annonce` propose l'option `ping` : **Aucun**, **@everyone** ou **Un rôle** (avec l'option `role` pour choisir lequel ; si tu renseignes seulement `role`, ce rôle est mentionné).
Le bot demande à Discord de mentionner uniquement la cible choisie. Mais **Discord n'envoie la notification que si le bot a le droit de la déclencher** :

- pour `@everyone`, ou pour un rôle non mentionnable : le bot doit avoir la permission **« Mentionner @everyone, @here et tous les rôles »** ;
- sinon, rends le rôle visé **mentionnable** (Paramètres du serveur > Rôles > le rôle > « Autoriser tout le monde à @mentionner ce rôle »).

Cette permission **n'est pas** dans le lien d'invitation (permissions minimales) : ajoute-la toi-même au rôle du bot seulement si tu veux utiliser `@everyone`.
Sans elle, l'annonce est publiée normalement mais personne n'est notifié ; le message de confirmation te le rappelle.

## 17. Déploiement automatique depuis GitHub

Le fichier `.github/workflows/deploy-nova-club-bot.yml` (à la racine du dépôt) lance les tests puis déploie
à chaque modification du dossier `nova-club-bot/` poussée sur la branche **main**. Tu peux aussi le lancer à la main : onglet **Actions > Déployer nova-club-bot > Run workflow**.

À faire une seule fois :

1. **Jeton Cloudflare** : tableau de bord Cloudflare > icône de profil > **My Profile > API Tokens > Create Token** > modèle **Edit Cloudflare Workers** > *Continue to summary* > *Create Token*. Copie le jeton.
2. **Account ID** : tableau de bord Cloudflare > *Workers & Pages* : l'Account ID est affiché à droite (ou lance `npx wrangler whoami`).
3. Sur GitHub : ton dépôt > **Settings > Secrets and variables > Actions > New repository secret** :
   - `CLOUDFLARE_API_TOKEN` = le jeton de l'étape 1
   - `CLOUDFLARE_ACCOUNT_ID` = l'identifiant de l'étape 2

Les secrets Discord (token, clé publique, identifiants) restent dans Cloudflare (étape 10) : GitHub n'en a pas besoin.
N'oublie pas d'avoir remplacé l'id KV dans `wrangler.toml` (étape 8) avant de pousser, sinon le déploiement échoue.

> Si tu places ce dossier dans **son propre dépôt** (le contenu de `nova-club-bot/` à la racine), déplace aussi
> le dossier `.github/` à la racine de ce dépôt, puis dans le fichier du workflow : supprime le bloc `defaults:`
> (3 lignes), remplace `nova-club-bot/package-lock.json` par `package-lock.json` et retire `nova-club-bot/**` des `paths`.

## 18. Ce que cette méthode ne peut pas faire

Un bot par interactions HTTP ne reçoit **que** les commandes slash, les clics sur les boutons et les choix dans les menus.
Il n'a pas de connexion permanente (« Gateway ») avec Discord. Concrètement, il **ne peut pas** :

- réagir à l'**arrivée d'un nouveau membre** (message de bienvenue automatique, rôle donné à l'arrivée) ni à son départ ;
- lire ou réagir aux **messages** écrits dans les salons (modération automatique, anti-spam, réponses à des mots-clés, compteur de messages, niveaux/XP) ;
- réagir aux **réactions emoji** (rôles par réaction : il faut utiliser des boutons à la place, comme pour le règlement) ;
- journaliser les **messages supprimés ou modifiés**, les changements de pseudo, les bannissements ;
- gérer la **voix** (salons vocaux temporaires, musique) ;
- voir les **statuts et présences** des membres ;
- apparaître **« En ligne »** ou afficher une activité (« Joue à… ») : le bot apparaîtra toujours hors ligne dans la liste des membres, c'est normal, il fonctionne quand même ;
- agir **de lui-même** sans qu'on clique : pas de fermeture automatique des tickets inactifs, pas de rappel. (Possible plus tard avec les Cron Triggers de Cloudflare, mais non inclus.)

Autres limites à connaître :

- La transcription contient au maximum les **200 derniers messages** ; les liens des pièces jointes qu'elle contient pointent vers Discord et **expirent** quelques heures après la suppression du salon (le texte reste).
- Le travail en arrière-plan est limité à **30 secondes** par clic : largement suffisant ici.
- KV est « finalement cohérent » : en cas de double clic très rapide depuis deux appareils, deux tickets pourraient exceptionnellement être créés.
- Une catégorie Discord contient au maximum **50 salons** : au-delà, l'ouverture de ticket affiche une erreur claire.

## 19. Dépannage

| Problème | Solution |
|---|---|
| Discord refuse d'enregistrer l'Interactions Endpoint URL | Vérifie `DISCORD_PUBLIC_KEY` (`npx wrangler secret list`), redéploie, réessaie. |
| « L'application n'a pas répondu » | Regarde `npx wrangler tail` pendant le clic. Vérifie que l'URL du Worker est la bonne. |
| « Configuration incomplète : il manque le secret … » | Ajoute la valeur dans `.env` puis `npm run secrets`. |
| Le rôle n'est pas donné | Place le rôle du bot au-dessus du rôle Membre (étape 13). |
| Le ticket ne se crée pas | Vérifie `TICKET_CATEGORY_ID` et que le bot voit la catégorie avec « Gérer les salons ». |
| La transcription n'arrive pas | Vérifie `LOG_CHANNEL_ID` et que le bot peut voir, écrire et joindre des fichiers dans ce salon. Le ticket n'est pas supprimé tant que la transcription n'est pas envoyée. |
| Les commandes n'apparaissent pas | `npm run register`, puis redémarre Discord (Ctrl+R). |
| « Le bot n'a pas la permission « Joindre des fichiers » » | Mode `"fichier"` : donne cette permission au rôle du bot, ou dans le salon (Modifier le salon > Permissions > rôle du bot > Joindre des fichiers). Elle est dans le lien d'invitation (`npm run invite`). |
| « binding ASSETS absent » | Ton `wrangler.toml` est l'ancien : copie celui du ZIP (section `[assets]` avec `binding = "ASSETS"`), puis `npx wrangler deploy`. |
| « Image introuvable dans public/ » | Le fichier `banniere-…-haut.gif` n'est pas dans `nova-club-bot/public/` (ou pas déployé) : copie-le puis `npx wrangler deploy`. |
| « pièce jointe NON signalée comme animée » | Le fichier de `public/` n'est pas un GIF animé : `npm run check-images -- --local`. |
| On ne voit que l'adresse de l'image en bleu | Tu es en mode `"haut"` : Discord n'a pas créé l'aperçu du lien. Mets `"banner_position": "haut_encadre"` (défaut), redéploie et republie le panneau. |
| Un trait coloré ou gris est visible à gauche de la bannière | En mode `"haut_encadre"`, la barre du 1er encadré imite le fond du thème sombre (`#2B2D31`). Ajuste `banner_embed_color` si tu utilises un autre thème. |
| La bannière n'apparaît pas ou ne bouge pas | `npm run check-images`. Ouvre l'adresse dans le navigateur : elle doit afficher le GIF animé. Si tu as remplacé l'image, augmente `images_version` dans `config.json` (cache de Discord), redéploie et republie. Un GIF ne s'anime pas si Discord est réglé sur « Ne jamais lire les GIF » (Paramètres > Accessibilité). |
| `/annonce` : « Si personne n'a été notifié » | Voir [les pings d'annonce](#les-pings-de-annonce). |
| « Ce panneau a été mis à jour » en cliquant sur un ancien bouton | Republie `/panel-tickets` et supprime l'ancien message. |
| Le token a fuité | Portail développeur > Bot > Reset Token, puis mets à jour `.env` et `npx wrangler secret put DISCORD_TOKEN`. |

## Structure du dossier

```
nova-club-bot/
├── config.json              ← tous les textes et adresses d'images (à personnaliser)
├── public/                  ← images servies par Cloudflare (bannières GIF, etc.)
├── wrangler.toml            ← configuration Cloudflare (id du KV)
├── .env.example             ← modèle du fichier .env (secrets locaux)
├── src/
│   ├── index.js             ← réception et tri des interactions
│   ├── verify.js            ← vérification de la signature Discord
│   ├── discord.js           ← appels à l'API Discord, messages d'erreur
│   ├── panels.js            ← les panneaux (un encadré chacun)
│   ├── annonce.js           ← la commande /annonce (formulaire)
│   ├── tickets.js           ← ouverture, prise en charge, fermeture, transcription
│   └── commands.js          ← définition des commandes slash
├── scripts/
│   ├── register-commands.js ← npm run register
│   ├── check-images.js      ← npm run check-images
│   └── invite-url.js        ← npm run invite
└── test/worker.test.js      ← npm test (Discord simulé)
```

### Régler la largeur des encadrés

Les bannières « -haut » font **520 px de large** (marges transparentes pour centrer le cadre au-dessus de l'encadré). Pour que le centrage soit juste, chaque encadré de texte doit lui aussi faire 520 px, même avec un texte court.
Le bot ajoute donc à la fin de chaque encadré de texte **une dernière ligne invisible** de `largeur_invisible` caractères « ⠀ » (U+2800, qui ne sont pas des espaces pour Discord, donc non supprimés).
Elle n'est pas ajoutée au 2e encadré de `/panel-formation` (l'image) ni à l'encadré de bannière du mode `"haut_encadre"`.

La valeur par défaut est **50**. Je ne peux pas mesurer le rendu dans Discord : règle-la à l'œil après avoir republié un panneau **à texte court** (par exemple `/panel-faq` avec une seule question) :

| Ce que tu vois | Quoi faire |
|---|---|
| L'encadré est plus étroit que la bannière (la bannière dépasse de chaque côté) | **Augmente** `largeur_invisible` (+5 à la fois) |
| Une **ligne vide en plus** apparaît sous le texte (la ligne invisible passe à la ligne) | **Diminue** `largeur_invisible` (−2 à la fois) |
| Rien à signaler : encadré à la largeur de la bannière, pas de ligne vide | C'est bon |

Après chaque changement : `npx wrangler deploy`, puis republie le panneau (les anciens messages ne changent pas). La largeur dépend un peu de l'appareil (ordinateur, téléphone) : vérifie sur les deux si tu peux.
La ligne invisible compte dans les limites de Discord (4096 caractères par texte d'encadré) : le bot te prévient si c'est trop long.

## Mise à jour : bannière en pièce jointe

Pour un bot **déjà installé et déployé** avec la version précédente (mode `"haut_encadre"`).

### 1. Fichiers à copier depuis le ZIP de la branche

Télécharge le ZIP, décompresse-le, puis copie **depuis `nova-club-bot/` du ZIP vers ton dossier `nova-club-bot/`** (remplace s'il le demande) :

| Copier (remplacer) | |
|---|---|
| `src/` (tout le dossier) | code du bot (nouveau fichier `publish.js`) |
| `scripts/` (tout le dossier) | |
| `test/` (tout le dossier) | tests |
| `wrangler.toml` | **nouveau** : ajoute `binding = "ASSETS"` dans `[assets]` (ton id KV `a693b127…` y est déjà) |
| `config.json` | passe `banner_position` à `"fichier"` et ajoute les nouveaux messages ; recopie dedans tes valeurs déjà remplies (salon questions, prix, liens, outils) |
| `README.md` | ce guide |

| Garder (ne pas toucher) | |
|---|---|
| `.env` | tes secrets locaux (token, identifiants) |
| `package.json`, `package-lock.json`, `.github/…` | rien n'a changé |
| `public/` | **ne copie pas ce dossier** : tes images y sont déjà (les 8 bannières `-haut` suffisent) |
| `node_modules/`, `.wrangler/` | se gèrent tout seuls |

Copie bien le nouveau `config.json` : sans lui, les messages du mode fichier (erreurs de permission, relecture de la pièce jointe) seraient absents.

> **`wrangler.toml` est obligatoire** : sans le *binding* `ASSETS`, le bot ne peut pas lire ses images et affiche « binding ASSETS absent ».

### 2. Relancer

Dans PowerShell, dossier `nova-club-bot` :

```powershell
npm test
npm run check-images -- --local
npx wrangler deploy
npm run check-images
```

> **Bannières 520 px** : remplace tes 8 fichiers `banniere-…-haut.gif` dans `public/` par les nouveaux (même noms) **avant** `npx wrangler deploy`. Le `config.json` du ZIP a `images_version` à `"3"` : Discord recharge ainsi les nouvelles images au lieu des anciennes en cache. Voir aussi [Régler la largeur des encadrés](#régler-la-largeur-des-encadrés).

- `npm test` doit afficher `fail 0`.
- `npm run check-images -- --local` doit afficher « Position des bannières : « fichier » » puis « Toutes les images sont prêtes ».
- `npx wrangler deploy` publie le code, la configuration et le binding `ASSETS`.
- `npm run check-images` vérifie les adresses en ligne.

Pas besoin de `npm run register` (les commandes n'ont pas changé), ni de `npm install`, ni de `npm run secrets`. La permission « Joindre des fichiers » était déjà dans le lien d'invitation : vérifie seulement qu'elle n'a pas été retirée au rôle du bot.

### 3. Republier les panneaux et regarder le résultat

Relance `/panel-infos`, `/panel-reglement`, `/panel-tickets`, `/panel-formation`, `/panel-outils`, `/panel-faq` et `/panel-autopilot`, puis supprime les anciens messages.
Le message de confirmation doit contenir `🎞️ banniere.gif : pièce jointe reconnue par Discord (image/gif, animée, …)`. **Regarde ensuite le salon** : la bannière doit être au-dessus de l'encadré.

### Si la pièce jointe s'affiche sous l'encadré

Discord décide seul de l'ordre d'affichage, et l'API ne permet pas de le vérifier depuis le bot. Si la bannière apparaît **sous** l'encadré, trois solutions de repli :

1. **Repasser en `"haut_encadre"`** (une ligne dans `config.json`) : la bannière est dans un premier encadré, toujours au-dessus ; il reste une légère boîte autour de l'image.
2. **Deux messages à la suite** : un premier message avec la seule pièce jointe, puis un second avec l'encadré. Aucune boîte autour de l'image et une bannière toujours au-dessus ; en contrepartie, ce sont deux messages (à supprimer ensemble). Ce mode n'est pas encore dans le bot : demande-le si le mode `"fichier"` ne convient pas.
3. **Mise en page « composants » de Discord** : une galerie d'images (la bannière jointe) au-dessus d'un conteneur avec barre orange, dans le même message, sans boîte autour de l'image. Mais ce format ne permet plus ni encadré classique, ni texte de contenu : le ping de `/annonce` devrait passer dans le conteneur. Non inclus pour l'instant.

### Changer de mode

Dans `config.json`, mets `"banner_position"` à `"fichier"`, `"haut_encadre"`, `"haut"` ou `"encadre"`, puis `npx wrangler deploy` et republie les panneaux.
