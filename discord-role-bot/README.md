# Ajouter un rôle à tous les membres d'un serveur Discord

Petit script à lancer **une seule fois**. Il ajoute un rôle à tous les membres humains d'un serveur :

- il ignore les bots et saute les membres qui ont déjà le rôle ;
- il attend environ 1 seconde entre deux ajouts (3000 membres ≈ 50 min à 1 h) ;
- il affiche la progression `[X / total]` ;
- en cas d'erreur, il l'affiche, l'écrit dans `erreurs.log`, puis continue ;
- vous pouvez le relancer à tout moment (même après un Ctrl+C) : il ne refait que ce qui reste.

---

## 1. Créer le bot sur le portail développeur

1. Allez sur <https://discord.com/developers/applications> et connectez-vous.
2. Cliquez sur **New Application**, donnez-lui un nom (par ex. « Ajout rôle »), acceptez les conditions, puis **Create**.
3. Dans le menu de gauche, ouvrez l'onglet **Bot**.
4. Dans la section **Privileged Gateway Intents**, activez **Server Members Intent**, puis cliquez sur **Save Changes**.
   (Sans cette option, le bot ne peut pas voir la liste des membres.)
5. Toujours dans l'onglet **Bot**, décochez **Public Bot** pour que personne d'autre ne puisse l'inviter (facultatif mais conseillé).
6. Cliquez sur **Reset Token**, confirmez, puis **Copy**. C'est le **token** : gardez-le secret, il donne le contrôle du bot.

## 2. Inviter le bot sur le serveur

1. Dans le menu de gauche, ouvrez **OAuth2** puis **URL Generator**.
2. Dans **Scopes**, cochez **bot**.
3. Dans **Bot Permissions** qui apparaît en dessous, cochez **Manage Roles** (Gérer les rôles).
4. Copiez l'URL générée en bas de la page, ouvrez-la dans votre navigateur, choisissez le serveur, puis **Autoriser**.
   (Il faut avoir la permission « Gérer le serveur » sur ce serveur.)
5. **Important** : dans Discord, allez dans **Paramètres du serveur → Rôles** et **glissez le rôle du bot au-dessus** du rôle à attribuer.
   Un bot ne peut attribuer que des rôles situés en dessous de son propre rôle.

## 3. Récupérer les identifiants du serveur et du rôle

1. Dans Discord : **Paramètres utilisateur → Avancés → Mode développeur** : activez-le.
2. Clic droit sur l'icône du serveur → **Copier l'identifiant du serveur**. C'est le `GUILD_ID`.
3. **Paramètres du serveur → Rôles** → clic droit sur le rôle → **Copier l'identifiant du rôle**. C'est le `ROLE_ID`.

## 4. Installer et configurer

### Récupérer le dossier sur votre ordinateur

Le dossier est sur GitHub, dans le dépôt `Lucas13Z343224/-`, branche `claude/great-cori-bbbuh3`.
Téléchargez le ZIP : <https://github.com/Lucas13Z343224/-/archive/refs/heads/claude/great-cori-bbbuh3.zip>,
faites clic droit → **Extraire tout…**, puis déplacez le sous-dossier `discord-role-bot` où vous voulez,
par exemple dans `C:\Users\VOTRE_NOM\Documents\discord-role-bot`.

### Installer Python (si besoin)

Windows 10/11, dans PowerShell :

```powershell
winget install -e --id Python.Python.3.12
```

Fermez puis rouvrez PowerShell, et vérifiez avec `python --version`.
Sans winget : téléchargez l'installateur sur <https://www.python.org/downloads/> et **cochez « Add python.exe to PATH »** au premier écran.

### Installer les dépendances

Dans l'Explorateur de fichiers, ouvrez le dossier `discord-role-bot`, cliquez dans la barre d'adresse, tapez `powershell` puis Entrée : un terminal s'ouvre **dans ce dossier**.

```bash
# Créer un environnement isolé (une seule fois)
python -m venv .venv

# L'activer
#   Windows :
.venv\Scripts\activate
#   macOS / Linux :
source .venv/bin/activate

# Installer les dépendances
pip install -r requirements.txt
```

Copiez `.env.example` en `.env` et remplissez-le :

```
DISCORD_TOKEN=le_token_copié_à_l_étape_1
GUILD_ID=identifiant_du_serveur
ROLE_ID=identifiant_du_rôle
DELAY_SECONDS=1
DRY_RUN=true
MAX_MEMBERS=5
```

- `DRY_RUN=true` : **mode test**, aucun rôle n'est ajouté, le script affiche seulement ce qu'il ferait.
- `MAX_MEMBERS=5` : ne traite que les 5 premiers membres qui n'ont pas encore le rôle (`0` = tous).

Ces deux valeurs sont prudentes par défaut. Procédure conseillée :
1. Lancez une première fois tel quel (test sur 5 membres, rien n'est modifié).
2. Mettez `DRY_RUN=false` (toujours `MAX_MEMBERS=5`) : 5 vrais ajouts, vérifiez dans Discord.
3. Mettez `MAX_MEMBERS=0` et relancez pour tous les autres.

Le fichier `.env` est exclu de git (`.gitignore`) : ne le partagez jamais.

## 5. Lancer le script

```bash
python ajouter_role.py
```

Vous verrez par exemple :

```
Connecté en tant que Ajout rôle#1234
Serveur : Mon serveur  |  Rôle : Membre
Récupération de la liste des membres…
3012 membres humains, 0 ont déjà le rôle, 3012 à traiter.
Durée estimée : environ 50 minute(s). Ctrl+C pour arrêter (relançable ensuite).

[1 / 3012] alice (1234…) : rôle ajouté
[2 / 3012] bob (5678…) : rôle ajouté
...
Terminé : 3010 rôle(s) ajouté(s), 2 erreur(s), 0 déjà en place.
```

- Laissez le terminal ouvert et l'ordinateur allumé (pas de mise en veille) pendant toute la durée.
- Vous pouvez arrêter à tout moment avec **Ctrl+C** puis relancer la même commande : les membres déjà traités sont sautés.
- Si des erreurs apparaissent, consultez `erreurs.log` et relancez le script pour réessayer.

**Problèmes fréquents**

| Message | Solution |
|---|---|
| Token invalide | Recopiez le token (étape 1.6) dans `.env`. |
| Activez « Server Members Intent » | Étape 1.4. |
| Serveur introuvable | Le bot n'est pas invité (étape 2) ou `GUILD_ID` est faux. |
| Rôle placé au-dessus du rôle du bot | Étape 2.5. |
| Permission « Gérer les rôles » manquante | Réinvitez le bot avec la permission (étape 2), ou ajoutez-la à son rôle. |

## 6. Supprimer le bot ensuite

Une fois le travail terminé :

1. **Retirer le bot du serveur** : dans Discord, clic droit sur le bot dans la liste des membres → **Expulser**.
   Son rôle automatique disparaît avec lui. Les rôles déjà ajoutés aux membres **restent en place**.
2. **Supprimer l'application** : sur <https://discord.com/developers/applications>, ouvrez l'application → onglet **General Information** → tout en bas, **Delete App**, puis confirmez. Le token devient alors inutilisable.
3. **Effacer le token de votre ordinateur** : supprimez le fichier `.env` (et, si vous voulez, tout le dossier `discord-role-bot`).
