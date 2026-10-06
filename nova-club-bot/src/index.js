// Point d'entrée du Worker : reçoit les interactions HTTP de Discord.
// Chaque interaction reçoit une réponse immédiate (ou différée) ; le travail long
// est terminé ensuite avec ctx.waitUntil (jusqu'à 30 s après la réponse).
import config from "../config.json" with { type: "json" };
import {
  InteractionType,
  ResponseType,
  UserError,
  deferredEphemeral,
  discord,
  editOriginal,
  ephemeral,
  explainError,
  fill,
  isAdmin,
  userOf,
} from "./discord.js";
import { PANELS } from "./panels.js";
import { askCloseConfirmation, cancelClose, claimTicket, closeTicket, openTicket, selectCategory } from "./tickets.js";
import { verifyDiscordRequest } from "./verify.js";

const REQUIRED_SECRETS = [
  "DISCORD_APPLICATION_ID",
  "DISCORD_PUBLIC_KEY",
  "DISCORD_TOKEN",
  "MEMBER_ROLE_ID",
  "STAFF_ROLE_ID",
  "TICKET_CATEGORY_ID",
  "LOG_CHANNEL_ID",
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

// Lance une tâche en arrière-plan et affiche son erreur éventuelle à l'utilisateur.
function runDeferred(ctx, interaction, task) {
  ctx.waitUntil(
    task().catch(async (err) => {
      if (!(err instanceof UserError)) console.error(err);
      await editOriginal(interaction, { content: explainError(err), components: [] });
    }),
  );
}

async function handleCommand(interaction, env, ctx) {
  const panel = PANELS[interaction.data.name];
  if (!panel) return ephemeral(config.errors.unknown_action);
  if (!isAdmin(interaction.member)) return ephemeral(config.errors.admin_only);

  const channelId = interaction.data.options?.find((o) => o.name === "salon")?.value ?? interaction.channel_id;
  runDeferred(ctx, interaction, async () => {
    await discord(env, "POST", `/channels/${channelId}/messages`, { body: panel.build() });
    await editOriginal(interaction, { content: fill(panel.published(), { channel: `<#${channelId}>` }) });
  });
  return deferredEphemeral();
}

function acceptRules(interaction, env, ctx) {
  const user = userOf(interaction);
  const role = `<@&${env.MEMBER_ROLE_ID}>`;
  if (interaction.member?.roles?.includes(env.MEMBER_ROLE_ID)) {
    return ephemeral(fill(config.reglement.already, { role }));
  }
  runDeferred(ctx, interaction, async () => {
    await discord(env, "PUT", `/guilds/${interaction.guild_id}/members/${user.id}/roles/${env.MEMBER_ROLE_ID}`, {
      reason: "Règlement accepté",
    });
    await editOriginal(interaction, { content: fill(config.reglement.success, { role }) });
  });
  return deferredEphemeral();
}

function handleComponent(interaction, env, ctx) {
  switch (interaction.data.custom_id) {
    case "rules:accept":
      return acceptRules(interaction, env, ctx);
    case "ticket:category":
      return selectCategory(interaction, env, ctx);
    case "ticket:open":
      runDeferred(ctx, interaction, () => openTicket(interaction, env));
      return deferredEphemeral();
    case "ticket:claim":
      return claimTicket(interaction, env, ctx);
    case "ticket:close":
      return askCloseConfirmation();
    case "ticket:close-confirm":
      runDeferred(ctx, interaction, () => closeTicket(interaction, env));
      return { type: ResponseType.UPDATE_MESSAGE, data: { content: config.tickets.closing, components: [] } };
    case "ticket:close-cancel":
      return cancelClose();
    default:
      return ephemeral(config.errors.unknown_action);
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "GET") {
      return new Response(`Bot ${config.server_name} en ligne ✅`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (request.method !== "POST") return new Response("Méthode non autorisée", { status: 405 });

    if (!env.DISCORD_PUBLIC_KEY) return new Response("Secret DISCORD_PUBLIC_KEY manquant", { status: 500 });

    const signature = request.headers.get("X-Signature-Ed25519");
    const timestamp = request.headers.get("X-Signature-Timestamp");
    const body = await request.text();
    let valid = false;
    try {
      valid = await verifyDiscordRequest(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);
    } catch (err) {
      console.error("Vérification de signature", err);
    }
    if (!valid) return new Response("Signature invalide", { status: 401 });

    const interaction = JSON.parse(body);
    if (interaction.type === InteractionType.PING) return json({ type: ResponseType.PONG });

    const missing = REQUIRED_SECRETS.find((name) => !env[name]);
    if (missing) return json(ephemeral(fill(config.errors.missing_config, { name: missing })));
    if (!env.TICKETS) return json(ephemeral(fill(config.errors.missing_config, { name: "TICKETS (KV)" })));
    if (!interaction.guild_id) return json(ephemeral(config.errors.guild_only));

    try {
      if (interaction.type === InteractionType.APPLICATION_COMMAND) return json(await handleCommand(interaction, env, ctx));
      if (interaction.type === InteractionType.MESSAGE_COMPONENT) return json(handleComponent(interaction, env, ctx));
      return json(ephemeral(config.errors.unknown_action));
    } catch (err) {
      console.error(err);
      return json(ephemeral(explainError(err)));
    }
  },
};
