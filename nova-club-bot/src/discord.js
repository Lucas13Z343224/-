// Petits utilitaires pour l'API REST de Discord (v10).
import config from "../config.json" with { type: "json" };

export const API = "https://discord.com/api/v10";

export const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3, MODAL_SUBMIT: 5 };

export const ResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  DEFERRED_CHANNEL_MESSAGE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
};

export const EPHEMERAL = 64;

export const Perm = {
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MANAGE_ROLES: 1n << 28n,
};

export const COLOR = parseInt(String(config.color).replace("#", ""), 16) || 0x7c3aed;

const USER_AGENT = "DiscordBot (https://github.com/Lucas13Z343224/-, 1.0.0)";

export class DiscordError extends Error {
  constructor(status, code, message, path) {
    super(`Discord ${status} (${code ?? "?"}) sur ${path} : ${message ?? ""}`);
    this.status = status;
    this.code = code;
  }
}

// Erreur dont le message est déjà prêt à être affiché à l'utilisateur.
export class UserError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Appel à l'API REST de Discord avec le token du bot.
 * Chaque appel compte comme une sous-requête (50 maximum par interaction sur le forfait gratuit).
 * Un seul nouvel essai est fait en cas de limite de débit (429) courte.
 */
export async function discord(env, method, path, { body, form, reason } = {}) {
  const headers = { Authorization: `Bot ${env.DISCORD_TOKEN}`, "User-Agent": USER_AGENT };
  if (reason) headers["X-Audit-Log-Reason"] = encodeURIComponent(reason);
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res = await fetch(API + path, { method, headers, body: payload });
  if (res.status === 429) {
    const info = await res.json().catch(() => ({}));
    const wait = Number(info.retry_after ?? 1);
    if (wait > 3) throw new DiscordError(429, info.code, info.message, path);
    await sleep(wait * 1000);
    res = await fetch(API + path, { method, headers, body: payload });
  }

  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new DiscordError(res.status, data?.code, data?.message ?? text.slice(0, 200), path);
  return data;
}

// Modifie la réponse (différée) d'une interaction. N'a pas besoin du token du bot.
export async function editOriginal(interaction, body) {
  const url = `${API}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...body }),
  });
  if (!res.ok) console.error("Échec de la modification de la réponse", res.status, await res.text());
}

// Envoie un message de suivi lié à l'interaction.
export async function followUp(interaction, body) {
  const url = `${API}/webhooks/${interaction.application_id}/${interaction.token}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error("Échec du message de suivi", res.status, await res.text());
}

// Remplace {clé} par la valeur correspondante.
export function fill(text, vars = {}) {
  return String(text ?? "").replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function ephemeral(content) {
  return {
    type: ResponseType.CHANNEL_MESSAGE,
    data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
  };
}

export function deferredEphemeral() {
  return { type: ResponseType.DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } };
}

export function hasPermission(member, perm) {
  try {
    return (BigInt(member?.permissions ?? 0) & perm) === perm;
  } catch {
    return false;
  }
}

export function isAdmin(member) {
  return hasPermission(member, Perm.ADMINISTRATOR);
}

export function isStaff(member, env) {
  return isAdmin(member) || (member?.roles ?? []).includes(env.STAFF_ROLE_ID);
}

export function userOf(interaction) {
  return interaction.member?.user ?? interaction.user;
}

// Traduit une erreur technique en message clair en français.
export function explainError(err) {
  const e = config.errors;
  if (err instanceof UserError) return err.message;
  if (err instanceof DiscordError) {
    switch (err.code) {
      case 50013:
        return e.missing_permissions;
      case 50001:
        return e.missing_access;
      case 10003:
        return e.unknown_channel;
      case 10011:
        return e.unknown_role;
      case 30013:
        return e.too_many_channels;
      case 50035:
        // Une catégorie est limitée à 50 salons : Discord renvoie alors une erreur de formulaire.
        return /maximum/i.test(err.message) ? e.too_many_channels : e.invalid_form;
    }
    if (err.status === 401) return e.bad_token;
    if (err.status === 403) return e.missing_permissions;
    if (err.status === 429) return e.rate_limited;
    if (err.status === 404) return e.unknown_channel;
  }
  return e.generic;
}

// ── Permissions du bot dans un salon ────────────────────────────────────────
// Si le salon visé est celui de la commande, Discord fournit directement les permissions du bot
// (interaction.app_permissions). Sinon on les calcule : rôles du bot + règles propres au salon.
export async function botPermissionsIn(env, interaction, channelId) {
  if (channelId === interaction.channel_id && interaction.app_permissions != null) {
    return BigInt(interaction.app_permissions);
  }
  const guildId = interaction.guild_id;
  const botId = interaction.application_id;
  const [channel, member, roles] = await Promise.all([
    discord(env, "GET", `/channels/${channelId}`),
    discord(env, "GET", `/guilds/${guildId}/members/${botId}`),
    discord(env, "GET", `/guilds/${guildId}/roles`),
  ]);
  const mine = new Set(member.roles ?? []);
  const rolePerms = (id) => BigInt(roles.find((r) => r.id === id)?.permissions ?? 0);

  let perms = rolePerms(guildId); // @everyone
  for (const id of mine) perms |= rolePerms(id);
  if (perms & Perm.ADMINISTRATOR) return ~0n;

  const rules = channel.permission_overwrites ?? [];
  const apply = (list) => {
    const deny = list.reduce((a, o) => a | BigInt(o.deny), 0n);
    const allow = list.reduce((a, o) => a | BigInt(o.allow), 0n);
    perms = (perms & ~deny) | allow;
  };
  apply(rules.filter((o) => o.id === guildId)); // @everyone
  apply(rules.filter((o) => o.type === 0 && mine.has(o.id))); // rôles du bot
  apply(rules.filter((o) => o.type === 1 && o.id === botId)); // le bot lui-même
  return perms;
}
