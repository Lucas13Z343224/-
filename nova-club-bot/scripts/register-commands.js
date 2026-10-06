// Enregistre (ou met à jour) les commandes slash sur ton serveur Discord.
// Utilisation : npm run register   (lit le fichier .env)
import { COMMANDS } from "../src/commands.js";

const { DISCORD_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID } = process.env;

for (const [name, value] of Object.entries({ DISCORD_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID })) {
  if (!value) {
    console.error(`❌ ${name} est vide dans le fichier .env. Remplis-le puis relance : npm run register`);
    process.exit(1);
  }
}

// Commandes de serveur (guild) : elles apparaissent immédiatement.
const url = `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/guilds/${DISCORD_GUILD_ID}/commands`;
const res = await fetch(url, {
  method: "PUT",
  headers: { Authorization: `Bot ${DISCORD_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(COMMANDS),
});

if (res.ok) {
  const data = await res.json();
  console.log(`✅ ${data.length} commandes enregistrées : ${data.map((c) => "/" + c.name).join(", ")}`);
} else {
  const text = await res.text();
  console.error(`❌ Échec (${res.status}) : ${text}`);
  if (res.status === 401) console.error("→ Le token DISCORD_TOKEN est invalide.");
  if (res.status === 403) console.error("→ Le bot n'est pas encore sur le serveur : invite-le d'abord (npm run invite).");
  if (res.status === 404) console.error("→ Vérifie DISCORD_APPLICATION_ID et DISCORD_GUILD_ID.");
  process.exit(1);
}
