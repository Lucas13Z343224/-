// Publication d'un message dans un salon. Si le panneau a une bannière « fichier », le GIF est lu dans les
// fichiers statiques du Worker (binding ASSETS) puis envoyé comme PIÈCE JOINTE du même message
// (requête multipart/form-data : payload_json + files[0]).
import config from "../config.json" with { type: "json" };
import { DiscordError, Perm, UserError, botPermissionsIn, discord, fill } from "./discord.js";

const TYPES = { ".gif": "image/gif", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
const IS_ANIMATED_ATTACHMENT = 1 << 5;

const baseName = (url) => decodeURIComponent(new URL(url).pathname.split("/").pop());
export const formatSize = (bytes) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;

// Lit l'image dans public/ (via ASSETS). Aucune requête réseau externe.
async function readAsset(env, bannerUrl, sizeLimit) {
  const file = baseName(bannerUrl);
  if (!env.ASSETS) throw new UserError(config.errors.missing_assets_binding);
  const res = await env.ASSETS.fetch(new Request(`https://assets.invalid${new URL(bannerUrl).pathname}`));
  if (!res.ok) throw new UserError(fill(config.errors.banner_file_missing, { file }));
  const ext = file.includes(".") ? file.slice(file.lastIndexOf(".")).toLowerCase() : ".gif";
  const blob = new Blob([await res.arrayBuffer()], { type: TYPES[ext] ?? "application/octet-stream" });
  if (sizeLimit && blob.size > Number(sizeLimit)) {
    throw new UserError(fill(config.errors.banner_file_too_big, { file, size: formatSize(blob.size), limit: formatSize(Number(sizeLimit)) }));
  }
  return { blob, filename: `banniere${ext}` };
}

/**
 * Publie `body` dans `channelId`. Renvoie { sent, attachment } où `attachment` vaut le nom de la pièce jointe
 * (null si le message n'en contient pas).
 */
export async function publishMessage(env, interaction, channelId, body) {
  const { _bannerFile, ...payload } = body;
  if (!_bannerFile) return { sent: await discord(env, "POST", `/channels/${channelId}/messages`, { body: payload }), attachment: null };

  // 1. Le bot doit pouvoir joindre des fichiers dans ce salon.
  const perms = await botPermissionsIn(env, interaction, channelId);
  if (!(perms & Perm.ATTACH_FILES)) throw new UserError(fill(config.errors.missing_attach_files, { channel: `<#${channelId}>` }));

  // 2. Lecture du GIF dans les fichiers statiques du Worker, puis envoi en multipart/form-data.
  const { blob, filename } = await readAsset(env, _bannerFile, interaction.attachment_size_limit);
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ ...payload, attachments: [{ id: 0, filename }] }));
  form.append("files[0]", blob, filename);
  try {
    return { sent: await discord(env, "POST", `/channels/${channelId}/messages`, { form }), attachment: filename };
  } catch (err) {
    if (err instanceof DiscordError && (err.code === 50013 || err.status === 403)) throw new UserError(config.errors.publish_with_file_failed);
    throw err;
  }
}

// Relit le message avec l'API et dit si la pièce jointe est bien reconnue (image/gif, animée).
export async function attachmentLine(env, channelId, sent, filename) {
  const m = config.media;
  let message = sent;
  if (sent?.id) {
    try {
      message = await discord(env, "GET", `/channels/${channelId}/messages/${sent.id}`);
    } catch (err) {
      console.error("relecture du message", err);
    }
  }
  const att = (message?.attachments ?? []).find((a) => a.filename === filename);
  if (!att) return fill(m.attachment_missing, { file: filename });
  const vars = { file: filename, type: att.content_type ?? "type inconnu", size: formatSize(att.size ?? 0) };
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (att.content_type !== (TYPES[ext] ?? att.content_type)) return fill(m.attachment_wrong_type, vars);
  if (att.content_type !== "image/gif") return fill(m.image_ok, { file: filename });
  return fill(att.flags & IS_ANIMATED_ATTACHMENT ? m.attachment_animated : m.attachment_static, vars);
}
