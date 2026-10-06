"""Ajoute un rôle à tous les membres (humains) d'un serveur Discord.

Le script peut être relancé sans risque : les membres qui ont déjà le rôle
sont sautés, donc seul le travail restant est refait.

Configuration dans le fichier .env (voir .env.example).
"""

import asyncio
import os
import sys
from datetime import datetime

import discord
from dotenv import load_dotenv

FICHIER_ERREURS = "erreurs.log"


def lire_config():
    load_dotenv()
    token = os.getenv("DISCORD_TOKEN", "").strip()
    guild_id = os.getenv("GUILD_ID", "").strip()
    role_id = os.getenv("ROLE_ID", "").strip()
    delai = os.getenv("DELAY_SECONDS", "1").strip() or "1"

    manquants = [nom for nom, val in
                 (("DISCORD_TOKEN", token), ("GUILD_ID", guild_id), ("ROLE_ID", role_id))
                 if not val]
    if manquants:
        sys.exit(f"Valeur(s) manquante(s) dans le fichier .env : {', '.join(manquants)}")
    try:
        return token, int(guild_id), int(role_id), float(delai)
    except ValueError:
        sys.exit("GUILD_ID et ROLE_ID doivent être des nombres, DELAY_SECONDS un nombre de secondes.")


def noter_erreur(message):
    """Affiche l'erreur et l'ajoute au fichier erreurs.log."""
    ligne = f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {message}"
    print("  ERREUR :", message, flush=True)
    with open(FICHIER_ERREURS, "a", encoding="utf-8") as f:
        f.write(ligne + "\n")


TOKEN, GUILD_ID, ROLE_ID, DELAI = lire_config()

intents = discord.Intents.default()
intents.members = True  # nécessite "Server Members Intent" sur le portail développeur
client = discord.Client(intents=intents)
deja_lance = False  # on_ready peut se déclencher à nouveau après une reconnexion


async def ajouter_role_a_tous():
    guild = client.get_guild(GUILD_ID)
    if guild is None:
        print(f"Serveur {GUILD_ID} introuvable : le bot est-il invité sur ce serveur ?")
        return

    role = guild.get_role(ROLE_ID)
    if role is None:
        print(f"Rôle {ROLE_ID} introuvable sur le serveur « {guild.name} ».")
        return

    moi = guild.me
    if not moi.guild_permissions.manage_roles:
        print("Le bot n'a pas la permission « Gérer les rôles » sur ce serveur.")
        return
    if role >= moi.top_role:
        print(f"Le rôle « {role.name} » est placé au-dessus (ou au même niveau) que le rôle du bot.\n"
              "Dans Paramètres du serveur > Rôles, glissez le rôle du bot AU-DESSUS de ce rôle.")
        return
    if role.managed:
        print(f"Le rôle « {role.name} » est géré par une intégration et ne peut pas être attribué.")
        return

    print(f"Serveur : {guild.name}  |  Rôle : {role.name}")
    print("Récupération de la liste des membres…", flush=True)
    await guild.chunk()

    humains = [m for m in guild.members if not m.bot]
    a_faire = [m for m in humains if role not in m.roles]
    deja = len(humains) - len(a_faire)
    total = len(a_faire)

    print(f"{len(humains)} membres humains, {deja} ont déjà le rôle, {total} à traiter.")
    if total == 0:
        print("Rien à faire. Terminé !")
        return
    minutes = total * DELAI / 60
    print(f"Durée estimée : environ {minutes:.0f} minute(s). Ctrl+C pour arrêter (relançable ensuite).\n")

    ajoutes = erreurs = 0
    for i, membre in enumerate(a_faire, start=1):
        prefixe = f"[{i} / {total}] {membre} ({membre.id})"
        try:
            await membre.add_roles(role, reason="Ajout du rôle à tous les membres (script unique)")
            ajoutes += 1
            print(f"{prefixe} : rôle ajouté", flush=True)
        except discord.NotFound:
            erreurs += 1
            noter_erreur(f"{prefixe} : membre introuvable (a sans doute quitté le serveur)")
        except discord.Forbidden:
            erreurs += 1
            noter_erreur(f"{prefixe} : permission refusée par Discord")
        except discord.HTTPException as e:
            erreurs += 1
            noter_erreur(f"{prefixe} : erreur Discord {e.status} - {e.text}")
        except Exception as e:  # on ne plante jamais : on note et on continue
            erreurs += 1
            noter_erreur(f"{prefixe} : erreur inattendue {type(e).__name__} - {e}")

        if i < total:
            await asyncio.sleep(DELAI)

    print(f"\nTerminé : {ajoutes} rôle(s) ajouté(s), {erreurs} erreur(s), {deja} déjà en place.")
    if erreurs:
        print(f"Détail des erreurs dans {FICHIER_ERREURS}. Relancez le script pour réessayer.")


@client.event
async def on_ready():
    global deja_lance
    if deja_lance:
        return
    deja_lance = True
    print(f"Connecté en tant que {client.user}", flush=True)
    try:
        await ajouter_role_a_tous()
    except Exception as e:
        noter_erreur(f"Erreur générale : {type(e).__name__} - {e}")
    finally:
        await client.close()


if __name__ == "__main__":
    try:
        client.run(TOKEN)
    except discord.LoginFailure:
        sys.exit("Token invalide : vérifiez DISCORD_TOKEN dans le fichier .env.")
    except discord.PrivilegedIntentsRequired:
        sys.exit("Activez « Server Members Intent » dans le portail développeur (onglet Bot).")
