// Affiche le lien d'invitation du bot avec uniquement les permissions nécessaires.
// Utilisation : npm run invite
const PERMISSIONS = {
  "Gérer les salons": 1n << 4n,
  "Voir les salons": 1n << 10n,
  "Envoyer des messages": 1n << 11n,
  "Intégrer des liens": 1n << 14n,
  "Joindre des fichiers (transcriptions)": 1n << 15n,
  "Voir les anciens messages": 1n << 16n,
  "Gérer les rôles": 1n << 28n,
};

const { DISCORD_APPLICATION_ID, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_APPLICATION_ID) {
  console.error("❌ DISCORD_APPLICATION_ID est vide dans le fichier .env.");
  process.exit(1);
}

const total = Object.values(PERMISSIONS).reduce((a, b) => a | b, 0n);
const params = new URLSearchParams({
  client_id: DISCORD_APPLICATION_ID,
  scope: "bot applications.commands",
  permissions: String(total),
});
if (DISCORD_GUILD_ID) {
  params.set("guild_id", DISCORD_GUILD_ID);
  params.set("disable_guild_select", "true");
}

console.log("Permissions demandées :");
for (const name of Object.keys(PERMISSIONS)) console.log("  • " + name);
console.log(`\nLien d'invitation (permissions = ${total}) :\nhttps://discord.com/oauth2/authorize?${params}`);
