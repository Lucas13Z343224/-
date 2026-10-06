// Point d'entrée du Worker : reçoit les interactions HTTP de Discord.
// Chaque interaction reçoit une réponse immédiate (ou différée) ; le travail long
// est terminé ensuite avec ctx.waitUntil (jusqu'à 30 s après la réponse).
import config from "../config.json" with { type: "json" };
import {
  EPHEMERAL,
  InteractionType,
  ResponseType,
  UserError,
  deferredEphemeral,
  discord,
  editOriginal,
  ephemeral,
  explainError,
  fill,
  followUp,
  isAdmin,
  userOf,
} from "./discord.js";
import { IS_COMPONENTS_V2, PANELS, mediaReport, ticketsPanel } from "./panels.js";
import { askCloseConfirmation, cancelClose, claimTicket, closeTicket, openTicket } from "./tickets.js";
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

// Laisse à Discord le temps d'enregistrer la première réponse avant de la modifier
// ou d'envoyer un message de suivi (l'attente ne consomme pas de temps CPU).
const MIN_DELAY_MS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Lance une tâche en arrière-plan et affiche son erreur éventuelle à l'utilisateur.
function runDeferred(ctx, interaction, task) {
  const ready = sleep(MIN_DELAY_MS);
  ctx.waitUntil(
    (async () => {
      try {
        await task(ready);
      } catch (err) {
        if (!(err instanceof UserError)) console.error(err);
        await ready;
        await editOriginal(interaction, { content: explainError(err), components: [] });
      }
    })(),
  );
}

// Comme runDeferred, mais le résultat est envoyé dans un nouveau message privé (éphémère).
function runWithFollowUp(ctx, interaction, task) {
  const reply = (content) =>
    followUp(interaction, { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } });
  const ready = sleep(MIN_DELAY_MS);
  ctx.waitUntil(
    (async () => {
      let content;
      try {
        content = await task();
      } catch (err) {
        if (!(err instanceof UserError)) console.error(err);
        content = explainError(err);
      }
      await ready;
      await reply(content);
    })(),
  );
}

// Résumé de la vérification des images faite par Discord après publication.
function mediaLines(sentMessage) {
  const m = config.media;
  return mediaReport(sentMessage).map((item) => {
    const file = decodeURIComponent(item.url.split("/").pop().split("?")[0]);
    if (item.animated) return fill(m.animated, { file });
    if (item.contentType?.startsWith("image/")) return fill(m.image_ok, { file });
    if (item.contentType) return fill(m.not_image, { file, type: item.contentType });
    return fill(m.pending, { file });
  });
}

async function handleCommand(interaction, env, ctx) {
  const panel = PANELS[interaction.data.name];
  if (!panel) return ephemeral(config.errors.unknown_action);
  if (!isAdmin(interaction.member)) return ephemeral(config.errors.admin_only);

  const channelId = interaction.data.options?.find((o) => o.name === "salon")?.value ?? interaction.channel_id;
  runDeferred(ctx, interaction, async (ready) => {
    const sent = await discord(env, "POST", `/channels/${channelId}/messages`, { body: panel.build() });
    const lines = [fill(panel.published(), { channel: `<#${channelId}>` }), ...mediaLines(sent)];
    await ready;
    await editOriginal(interaction, { content: lines.join("\n") });
  });
  return deferredEphemeral();
}

function acceptRules(interaction, env, ctx) {
  const user = userOf(interaction);
  const role = `<@&${env.MEMBER_ROLE_ID}>`;
  if (interaction.member?.roles?.includes(env.MEMBER_ROLE_ID)) {
    return ephemeral(fill(config.reglement.already, { role }));
  }
  runDeferred(ctx, interaction, async (ready) => {
    await discord(env, "PUT", `/guilds/${interaction.guild_id}/members/${user.id}/roles/${env.MEMBER_ROLE_ID}`, {
      reason: "Règlement accepté",
    });
    await ready;
    await editOriginal(interaction, { content: fill(config.reglement.success, { role }) });
  });
  return deferredEphemeral();
}

// Choisir une raison dans le menu crée directement le ticket.
function createTicketFromMenu(interaction, env, ctx) {
  const category = interaction.data.values?.[0];
  if (!config.tickets.categories.some((c) => c.value === category)) return ephemeral(config.errors.unknown_category);
  runWithFollowUp(ctx, interaction, () => openTicket(interaction, env, category));

  // On republie le même panneau pour vider le menu : la personne pourra rechoisir plus tard.
  if ((interaction.message?.flags ?? 0) & IS_COMPONENTS_V2) {
    try {
      const { components } = ticketsPanel();
      return { type: ResponseType.UPDATE_MESSAGE, data: { components } };
    } catch {
      // config.json invalide : on ne touche pas au panneau.
    }
  }
  return { type: ResponseType.DEFERRED_UPDATE_MESSAGE };
}

function handleComponent(interaction, env, ctx) {
  switch (interaction.data.custom_id) {
    case "rules:accept":
      return acceptRules(interaction, env, ctx);
    case "ticket:create":
    case "ticket:category": // menu des anciens panneaux : crée aussi le ticket directement
      return createTicketFromMenu(interaction, env, ctx);
    case "ticket:open": // bouton des anciens panneaux (supprimé)
      return ephemeral(config.tickets.old_panel);
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
    // Les images de public/ sont servies directement par Cloudflare, sans passer par ce code.
    if (request.method === "GET" && new URL(request.url).pathname !== "/") {
      return new Response("Fichier introuvable", { status: 404 });
    }
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
