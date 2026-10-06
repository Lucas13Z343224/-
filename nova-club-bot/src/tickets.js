// Système de tickets : choix de catégorie, ouverture, prise en charge, fermeture avec transcription.
import config from "../config.json" with { type: "json" };
import {
  COLOR,
  DiscordError,
  EPHEMERAL,
  Perm,
  ResponseType,
  UserError,
  discord,
  editOriginal,
  ephemeral,
  fill,
  followUp,
  isStaff,
  userOf,
} from "./discord.js";

const t = config.tickets;
const MAX_TRANSCRIPT_MESSAGES = 200; // 2 pages de 100 messages = 2 sous-requêtes

// Clés du stockage KV
const choiceKey = (guildId, userId) => `choice:${guildId}:${userId}`;
const openKey = (guildId, userId) => `open:${guildId}:${userId}`;
const chanKey = (channelId) => `chan:${channelId}`;

const OWNER_ALLOW = Perm.VIEW_CHANNEL | Perm.SEND_MESSAGES | Perm.READ_MESSAGE_HISTORY | Perm.ATTACH_FILES | Perm.EMBED_LINKS;
const STAFF_ALLOW = OWNER_ALLOW;
const BOT_ALLOW = OWNER_ALLOW | Perm.MANAGE_CHANNELS;

function categoryLabel(value) {
  return t.categories.find((c) => c.value === value)?.label ?? value;
}

function displayName(user) {
  return user.global_name || user.username;
}

export function channelNameFor(user) {
  const base = String(user.username || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (t.channel_prefix + (base || user.id)).slice(0, 100);
}

function ticketButtons(claimedBy) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 4, custom_id: "ticket:close", label: t.close_button_label, emoji: { name: t.close_button_emoji } },
        claimedBy
          ? { type: 2, style: 2, custom_id: "ticket:claim", label: t.claimed_button_label, emoji: { name: t.claim_button_emoji }, disabled: true }
          : { type: 2, style: 1, custom_id: "ticket:claim", label: t.claim_button_label, emoji: { name: t.claim_button_emoji } },
      ],
    },
  ];
}

async function kvGetJSON(env, key) {
  const raw = await env.TICKETS.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── 1. Choix de la catégorie dans le menu ────────────────────────────────────
export function selectCategory(interaction, env, ctx) {
  const value = interaction.data.values?.[0];
  const user = userOf(interaction);
  if (!t.categories.some((c) => c.value === value)) return ephemeral(config.errors.unknown_category);
  // Mémorisé 15 minutes. Écrit en arrière-plan pour répondre tout de suite à Discord.
  ctx.waitUntil(
    env.TICKETS.put(choiceKey(interaction.guild_id, user.id), value, { expirationTtl: 900 }).catch((err) =>
      console.error("KV put choice", err),
    ),
  );
  return ephemeral(fill(t.category_selected, { category: categoryLabel(value) }));
}

// ── 2. Ouverture d'un ticket (travail en arrière-plan) ───────────────────────
export async function openTicket(interaction, env) {
  const guildId = interaction.guild_id;
  const user = userOf(interaction);

  const category = await env.TICKETS.get(choiceKey(guildId, user.id));
  if (!category) throw new UserError(t.choose_category_first);

  // Une seule demande ouverte par personne.
  const existing = await env.TICKETS.get(openKey(guildId, user.id));
  if (existing) {
    try {
      await discord(env, "GET", `/channels/${existing}`);
      throw new UserError(fill(t.already_open, { channel: `<#${existing}>` }));
    } catch (err) {
      // Le salon a été supprimé à la main : on nettoie et on continue.
      if (!(err instanceof DiscordError && err.status === 404)) throw err;
      await env.TICKETS.delete(openKey(guildId, user.id));
      await env.TICKETS.delete(chanKey(existing));
    }
  }

  const botId = interaction.application_id;
  const channel = await discord(env, "POST", `/guilds/${guildId}/channels`, {
    reason: `Ticket ouvert par ${user.username}`,
    body: {
      name: channelNameFor(user),
      type: 0,
      parent_id: env.TICKET_CATEGORY_ID,
      topic: `${categoryLabel(category)} — ${displayName(user)} (${user.id})`,
      permission_overwrites: [
        { id: guildId, type: 0, allow: "0", deny: String(Perm.VIEW_CHANNEL) }, // @everyone
        { id: user.id, type: 1, allow: String(OWNER_ALLOW), deny: "0" },
        { id: env.STAFF_ROLE_ID, type: 0, allow: String(STAFF_ALLOW), deny: "0" },
        { id: botId, type: 1, allow: String(BOT_ALLOW), deny: "0" },
      ],
    },
  });

  const meta = {
    userId: user.id,
    username: user.username,
    category,
    openedAt: new Date().toISOString(),
    claimedBy: null,
  };
  await Promise.all([
    env.TICKETS.put(openKey(guildId, user.id), channel.id),
    env.TICKETS.put(chanKey(channel.id), JSON.stringify(meta)),
  ]);

  const vars = { user: `<@${user.id}>`, staff: `<@&${env.STAFF_ROLE_ID}>`, category: categoryLabel(category) };
  await discord(env, "POST", `/channels/${channel.id}/messages`, {
    body: {
      content: `<@${user.id}> <@&${env.STAFF_ROLE_ID}>`,
      embeds: [
        {
          title: fill(t.welcome_title, vars),
          description: fill(t.welcome_description, vars),
          color: COLOR,
          footer: { text: config.footer },
        },
      ],
      components: ticketButtons(null),
      allowed_mentions: { users: [user.id], roles: [env.STAFF_ROLE_ID] },
    },
  });

  await editOriginal(interaction, { content: fill(t.created, { channel: `<#${channel.id}>` }) });
}

// ── 3. "Je m'en occupe" (staff uniquement) ───────────────────────────────────
export function claimTicket(interaction, env, ctx) {
  if (!isStaff(interaction.member, env)) return ephemeral(t.claim_staff_only);
  const user = userOf(interaction);
  const channelId = interaction.channel_id;

  const embeds = (interaction.message?.embeds ?? []).map((e) => ({ ...e }));
  if (embeds[0]) {
    embeds[0].fields = [...(embeds[0].fields ?? []), { name: t.claimed_field, value: `<@${user.id}>`, inline: true }];
  }

  ctx.waitUntil(
    (async () => {
      await followUp(interaction, {
        content: fill(t.claimed_message, { user: `<@${user.id}>` }),
        allowed_mentions: { parse: [] },
      });
      const meta = await kvGetJSON(env, chanKey(channelId));
      if (meta) {
        meta.claimedBy = { id: user.id, username: user.username };
        await env.TICKETS.put(chanKey(channelId), JSON.stringify(meta));
      }
    })().catch((err) => console.error("claim", err)),
  );

  return {
    type: ResponseType.UPDATE_MESSAGE,
    data: { embeds, components: ticketButtons(user.id) },
  };
}

// ── 4. Fermeture : demande de confirmation ───────────────────────────────────
// Le salon n'est visible que par la personne et l'équipe : toute personne qui voit le bouton peut fermer.
export function askCloseConfirmation() {
  return {
    type: ResponseType.CHANNEL_MESSAGE,
    data: {
      content: t.close_confirm,
      flags: EPHEMERAL,
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 4, custom_id: "ticket:close-confirm", label: t.close_confirm_yes },
            { type: 2, style: 2, custom_id: "ticket:close-cancel", label: t.close_confirm_no },
          ],
        },
      ],
    },
  };
}

export function cancelClose() {
  return { type: ResponseType.UPDATE_MESSAGE, data: { content: t.close_cancelled, components: [] } };
}

// ── 5. Fermeture confirmée (travail en arrière-plan) ─────────────────────────
export async function closeTicket(interaction, env) {
  const channelId = interaction.channel_id;
  const meta = await kvGetJSON(env, chanKey(channelId));
  // Sécurité : on ne supprime jamais un salon hors de la catégorie des tickets.
  const parentId = interaction.channel?.parent_id;
  const inTicketCategory = parentId ? parentId === env.TICKET_CATEGORY_ID : Boolean(meta);
  if (!inTicketCategory) throw new UserError(config.errors.not_a_ticket);

  const closer = userOf(interaction);
  const messages = await fetchMessages(env, channelId, MAX_TRANSCRIPT_MESSAGES);
  const channelName = interaction.channel?.name ?? channelId;
  const closedAt = new Date();

  const transcript = buildTranscript({ channelName, meta, closer, closedAt, messages });
  const fmt = dateFormatter();
  const fields = [
    { name: t.label_owner, value: meta ? `<@${meta.userId}> (${meta.username})` : t.label_unknown, inline: true },
    { name: t.label_category, value: meta ? categoryLabel(meta.category) : t.label_unknown, inline: true },
    { name: t.label_claimed, value: meta?.claimedBy ? `<@${meta.claimedBy.id}>` : t.label_nobody, inline: true },
    { name: t.label_closed_by, value: `<@${closer.id}>`, inline: true },
    { name: t.label_opened, value: meta ? fmt.format(new Date(meta.openedAt)) : t.label_unknown, inline: true },
    { name: t.label_messages, value: String(messages.length), inline: true },
  ];

  const filename = `${channelName}-${closedAt.toISOString().slice(0, 10)}.txt`;
  const form = new FormData();
  form.append(
    "payload_json",
    JSON.stringify({
      embeds: [{ title: t.log_title, description: `#${channelName}`, color: COLOR, fields, timestamp: closedAt.toISOString() }],
      attachments: [{ id: 0, filename }],
      allowed_mentions: { parse: [] },
    }),
  );
  form.append("files[0]", new Blob([transcript], { type: "text/plain; charset=utf-8" }), filename);

  try {
    await discord(env, "POST", `/channels/${env.LOG_CHANNEL_ID}/messages`, { form });
  } catch (err) {
    console.error("log transcript", err);
    throw new UserError(config.errors.log_failed); // on garde le salon pour ne rien perdre
  }

  await discord(env, "DELETE", `/channels/${channelId}`, { reason: `Ticket fermé par ${closer.username}` });

  const cleanup = [env.TICKETS.delete(chanKey(channelId))];
  if (meta) cleanup.push(env.TICKETS.delete(openKey(interaction.guild_id, meta.userId)));
  await Promise.all(cleanup).catch((err) => console.error("KV cleanup", err));
}

// Récupère jusqu'à `max` messages, du plus ancien au plus récent (100 par appel).
async function fetchMessages(env, channelId, max) {
  const all = [];
  let before;
  while (all.length < max) {
    const limit = Math.min(100, max - all.length);
    const page = await discord(env, "GET", `/channels/${channelId}/messages?limit=${limit}${before ? `&before=${before}` : ""}`);
    all.push(...page);
    if (page.length < limit) break;
    before = page[page.length - 1].id;
  }
  return all.reverse();
}

function dateFormatter() {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: config.timezone, dateStyle: "short", timeStyle: "medium" });
}

export function buildTranscript({ channelName, meta, closer, closedAt, messages }) {
  const fmt = dateFormatter();
  const lines = [
    `${t.transcript_header} #${channelName} — ${config.server_name}`,
    `${t.label_owner} : ${meta ? `${meta.username} (${meta.userId})` : t.label_unknown}`,
    `${t.label_category} : ${meta ? categoryLabel(meta.category) : t.label_unknown}`,
    `${t.label_opened} : ${meta ? fmt.format(new Date(meta.openedAt)) : t.label_unknown}`,
    `${t.label_claimed} : ${meta?.claimedBy ? meta.claimedBy.username : t.label_nobody}`,
    `${t.label_closed_by} : ${closer.username} (${closer.id})`,
    `${t.label_closed} : ${fmt.format(closedAt)}`,
    `${t.label_messages} : ${messages.length} (max ${MAX_TRANSCRIPT_MESSAGES})`,
    "─".repeat(60),
  ];
  for (const m of messages) {
    const author = m.author ? `${m.author.global_name || m.author.username}${m.author.bot ? " [bot]" : ""}` : "?";
    lines.push(`[${fmt.format(new Date(m.timestamp))}] ${author} : ${m.content || ""}`);
    for (const e of m.embeds ?? []) {
      const parts = [e.title, e.description].filter(Boolean).join(" — ");
      if (parts) lines.push(`    [${t.label_embed}] ${parts}`);
    }
    for (const a of m.attachments ?? []) lines.push(`    [${t.label_attachment}] ${a.filename} : ${a.url}`);
  }
  return lines.join("\n") + "\n";
}
