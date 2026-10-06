// Construction des panneaux publiés par les commandes /panel-* et /annonce.
// Mise en page : UN message avec UN encadré (embed) : titre, texte en sections,
// bannière animée en bas de l'encadré (embed.image), barre de couleur sur le côté.
// Le menu déroulant ou les boutons sont placés sous le message.
import config from "../config.json" with { type: "json" };
import { COLOR, UserError, fill } from "./discord.js";

const SNOWFLAKE = /^\d{17,20}$/;
const EMBED_DESCRIPTION_MAX = 4096;
const EMBED_TITLE_MAX = 256;
const EMBED_TOTAL_MAX = 6000;

const IS_ANIMATED_EMBED = 1 << 5; // drapeau « image animée » des images d'encadré

const emoji = (e) => (e ? { name: e } : undefined);
const row = (...components) => ({ type: 1, components });
const linkButton = (label, url, e) => ({ type: 2, style: 5, label, url, emoji: emoji(e) });

// Ajoute ?v=<images_version> aux adresses d'images : Discord garde les images en cache
// d'après leur adresse, ce numéro force le rechargement d'une image remplacée.
export function imageUrl(url, field = "banner_url") {
  if (!url) return "";
  checkUrl(url, field);
  const version = String(config.images_version ?? "").trim();
  if (!version || url.includes("?")) return url;
  return `${url}?v=${encodeURIComponent(version)}`;
}

function checkUrl(value, field) {
  let ok = false;
  try {
    ok = new URL(value).protocol === "https:";
  } catch {
    ok = false;
  }
  if (!ok) throw new UserError(fill(config.errors.invalid_url, { field, value: value || "(vide)" }));
  return value;
}

function checkChannelIds(ids) {
  const invalid = ids.filter((id) => !SNOWFLAKE.test(String(id)));
  if (invalid.length) {
    throw new UserError(fill(config.errors.invalid_channel_ids, { ids: [...new Set(invalid)].join(", ") }));
  }
}

function checkMax(list, field, max) {
  if (list.length > max) throw new UserError(fill(config.errors.too_many_items, { field, max }));
}

// Position de la bannière (réglage `banner_position` de config.json) :
//   "fichier" (défaut) → le bot envoie le GIF « -haut » comme PIÈCE JOINTE du message (voir publish.js) :
//               aucun lien dans le texte, aucun encadré réservé à l'image ;
//   "haut_encadre" → DEUX encadrés dans le même message : le premier ne contient que la bannière
//               « -haut » (embed.image, couleur #2B2D31 = barre latérale invisible), le second est l'encadré habituel ;
//   "haut"    → l'adresse de la bannière « -haut » est le CONTENU du message (aperçu de lien de Discord) ;
//   "encadre" → l'ancienne bannière est dans l'encadré, en bas (embed.image).
const POSITIONS = ["fichier", "haut_encadre", "haut", "encadre"];

export function bannerPosition() {
  const raw = String(config.banner_position ?? "fichier").trim().toLowerCase();
  if (!POSITIONS.includes(raw)) {
    throw new UserError(fill(config.errors.invalid_banner_position, { value: config.banner_position }));
  }
  return raw;
}

// Couleur du premier encadré (bannière seule) : celle du fond de Discord, pour que sa barre soit invisible.
function bannerBarColor() {
  const n = parseInt(String(config.banner_embed_color ?? "#2B2D31").replace("#", ""), 16);
  return Number.isNaN(n) ? 0x2b2d31 : n;
}

// Renvoie { content, image, bannerEmbed, file } à utiliser pour la section de config donnée ({ banner_url, banner_haut_url }).
export function banner(section, field = "banner") {
  const position = bannerPosition();
  if (position === "encadre") return { image: section.banner_url || undefined };
  if (position === "fichier") {
    // L'adresse sert seulement à retrouver le nom du fichier dans public/ : l'image est lue par le Worker (ASSETS).
    return { file: section.banner_haut_url ? checkUrl(section.banner_haut_url, `${field}_haut_url`) : undefined };
  }
  const url = section.banner_haut_url ? imageUrl(section.banner_haut_url, `${field}_haut_url`) : undefined;
  if (position === "haut") return { content: url };
  // haut_encadre : encadré contenant UNIQUEMENT l'image (ni titre, ni texte, ni pied de page)
  return { bannerEmbed: url ? { color: bannerBarColor(), image: { url } } : undefined };
}

// Dernière ligne invisible (caractères « ⠀ » U+2800, qui ne sont pas des espaces pour Discord) : elle force
// l'encadré à s'afficher à la largeur maximale (520 px) même si le texte est court, pour que la bannière
// (520 px de large) soit toujours centrée au-dessus. Longueur réglable : `largeur_invisible` dans config.json.
// Une seule ligne : si le nombre est trop grand, elle passe à la ligne et ajoute une ligne vide.
const INVISIBLE = "\u2800";
const INVISIBLE_MAX = 200;
export function widthPadding() {
  const n = Math.min(Math.floor(Number(config.largeur_invisible)), INVISIBLE_MAX);
  return n > 0 ? `\n${INVISIBLE.repeat(n)}` : "";
}

// Un encadré : titre, description (sections de texte), bannière en bas, barre de couleur.
export function embed({ title, description, image }) {
  const e = { title, description: `${description}${widthPadding()}`, color: COLOR };
  if (image) e.image = { url: imageUrl(image) };
  return e;
}

// Sections de texte séparées par une ligne vide. Un titre de section s'écrit en gras.
const section = (heading, body) => (heading ? `**${heading}**\n${body}` : body);
const join = (...parts) => parts.filter(Boolean).join("\n\n");

// Vérifie les limites de Discord avant l'envoi, avec un message clair.
function message(embeds, components, content, bannerEmbed, bannerFile) {
  for (const e of embeds) {
    if ((e.title ?? "").length > EMBED_TITLE_MAX) {
      throw new UserError(fill(config.errors.embed_too_long, { max: EMBED_TITLE_MAX, size: e.title.length }));
    }
    if ((e.description ?? "").length > EMBED_DESCRIPTION_MAX) {
      throw new UserError(fill(config.errors.embed_too_long, { max: EMBED_DESCRIPTION_MAX, size: e.description.length }));
    }
  }
  const total = embeds.reduce((n, e) => n + (e.title ?? "").length + (e.description ?? "").length, 0);
  if (total > EMBED_TOTAL_MAX) throw new UserError(fill(config.errors.embed_too_long, { max: EMBED_TOTAL_MAX, size: total }));
  const msg = { embeds: bannerEmbed ? [bannerEmbed, ...embeds] : embeds, allowed_mentions: { parse: [] } };
  if (content) msg.content = content;
  if (bannerFile) msg._bannerFile = bannerFile; // retiré avant l'envoi (publish.js) : sert à joindre le fichier
  if (components?.length) msg.components = components;
  return msg;
}

// ── Panneaux ────────────────────────────────────────────────────────────────
export function infosPanel() {
  const c = config.infos;
  checkChannelIds(c.channels.map((ch) => ch.id));
  const list = c.channels.map((ch) => `${ch.emoji ?? "•"} <#${ch.id}> — ${ch.description}`).join("\n");
  const b = banner(c, "infos.banner");
  return message(
    [embed({ title: c.title, description: join(c.welcome, section(c.channels_title, list)), image: b.image })],
    undefined,
    b.content,
    b.bannerEmbed,
    b.file,
  );
}

export function reglementPanel() {
  const r = config.reglement;
  const rules = r.rules.map((rule, i) => `**${i + 1}.** ${rule}`).join("\n");
  const b = banner(r, "reglement.banner");
  return message(
    [
      embed({
        title: r.title,
        description: join(r.intro, section(r.rules_title, rules), section(r.outro_title, r.outro)),
        image: b.image,
      }),
    ],
    [row({ type: 2, style: 3, custom_id: "rules:accept", label: r.button_label, emoji: emoji(r.button_emoji) })],
    b.content,
    b.bannerEmbed,
    b.file,
  );
}

// Menu déroulant des tickets (aussi utilisé pour le « vider » après un choix).
export function ticketSelectRow() {
  const t = config.tickets;
  return row({
    type: 3,
    custom_id: "ticket:create",
    placeholder: t.select_placeholder,
    min_values: 1,
    max_values: 1,
    options: t.categories.map((cat) => ({
      value: cat.value,
      label: cat.label,
      description: cat.description || undefined,
      emoji: emoji(cat.emoji),
    })),
  });
}

export function ticketsPanel() {
  const t = config.tickets;
  checkChannelIds([t.questions_channel_id]);
  const categories = t.categories
    .map((cat) => `${cat.emoji ?? "•"} **${cat.label}**${cat.description ? ` — ${cat.description}` : ""}`)
    .join("\n");
  const b = banner(t, "tickets.banner");
  return message(
    [
      embed({
        title: t.panel_title,
        description: fill(t.panel_description, { categories, salon_questions: `<#${t.questions_channel_id}>` }),
        image: b.image,
      }),
    ],
    [ticketSelectRow()],
    b.content,
    b.bannerEmbed,
    b.file,
  );
}

export function formationPanel() {
  const f = config.formation;
  const lien = checkUrl(f.lien, "formation.lien");
  const vars = { prix: f.prix, lien };
  const points = f.points.map((p) => `• ${p}`).join("\n");
  const b = banner(f, "formation.banner");
  const embeds = [
    embed({
      title: f.title,
      description: join(fill(f.description, vars), section(f.points_title, points), section(f.details_title, fill(f.details, vars))),
      image: b.image,
    }),
  ];
  // Deuxième encadré : l'image de présentation en grande image.
  if (f.image_url) embeds.push({ color: COLOR, image: { url: imageUrl(f.image_url) } });
  return message(embeds, [row(linkButton(f.button_label, lien, f.button_emoji))], b.content, b.bannerEmbed, b.file);
}

export function outilsPanel() {
  const o = config.outils;
  checkMax(o.tools, "outils.tools", 15);
  const tools = o.tools
    .map((tool, i) => `🔹 **${tool.name}**\n${tool.description}\n[${o.link_label} →](${checkUrl(tool.url, `outils.tools[${i}].url`)})`)
    .join("\n\n");
  const b = banner(o, "outils.banner");
  return message([embed({ title: o.title, description: join(o.intro, tools), image: b.image })], undefined, b.content, b.bannerEmbed, b.file);
}

export function faqPanel() {
  const q = config.faq;
  checkMax(q.questions, "faq.questions", 15);
  const body = q.questions.map((item) => section(`${q.question_emoji} ${item.question}`, item.answer)).join("\n\n");
  const b = banner(q, "faq.banner");
  return message([embed({ title: q.title, description: body, image: b.image })], undefined, b.content, b.bannerEmbed, b.file);
}

export function autopilotPanel() {
  const a = config.autopilot;
  const lien = checkUrl(a.lien_autopilot, "autopilot.lien_autopilot");
  const features = a.features.map((f) => `• ${f}`).join("\n");
  const b = banner(a, "autopilot.banner");
  return message(
    [
      embed({
        title: a.title,
        description: join(a.description, section(a.features_title, features), `*${a.disclaimer}*`),
        image: b.image,
      }),
    ],
    [row(linkButton(a.button_label, lien, a.button_emoji))],
    b.content,
    b.bannerEmbed,
    b.file,
  );
}

// ── Annonce (/annonce) ──────────────────────────────────────────────────────
export function annonceImages() {
  return config.annonce.images;
}

export function annoncePanel({ title, text, imageValue }) {
  const choice = annonceImages().find((i) => i.value === imageValue) ?? annonceImages().find((i) => i.value === config.annonce.default_image);
  const b = banner(choice ?? {}, "annonce.images.banner");
  return message([embed({ title, description: text, image: b.image })], undefined, b.content, b.bannerEmbed, b.file);
}

export const PANELS = {
  "panel-infos": { build: infosPanel, published: () => config.infos.published },
  "panel-reglement": { build: reglementPanel, published: () => config.reglement.published },
  "panel-tickets": { build: ticketsPanel, published: () => config.tickets.published },
  "panel-formation": { build: formationPanel, published: () => config.formation.published },
  "panel-outils": { build: outilsPanel, published: () => config.outils.published },
  "panel-faq": { build: faqPanel, published: () => config.faq.published },
  "panel-autopilot": { build: autopilotPanel, published: () => config.autopilot.published },
};

// Dernière ligne du contenu si c'est une adresse https seule sur sa ligne (= la bannière du haut).
export function bannerUrlOf(content) {
  const last = String(content ?? "").split("\n").pop().trim();
  return /^https:\/\/\S+$/.test(last) ? last : null;
}

const toReport = (url, media) => ({
  url,
  contentType: media?.content_type ?? null,
  known: media?.width != null || media?.content_type != null,
  animated: Boolean((media?.flags ?? 0) & IS_ANIMATED_EMBED),
});

// Images d'encadré (position « encadre » et image de la formation), telles que Discord les a lues.
export function mediaReport(sentMessage) {
  return (sentMessage?.embeds ?? []).filter((e) => e.image && e.type !== "image").map((e) => toReport(e.image.url, e.image));
}

// Aperçu créé par Discord pour l'adresse de la bannière du haut (embed de type « image » ou « gifv »).
// Renvoie null tant que Discord n'a pas encore créé l'aperçu.
export function unfurlReport(message, bannerUrl) {
  const e = (message?.embeds ?? []).find((x) => (x.type === "image" || x.type === "gifv") && x.url === bannerUrl);
  if (!e) return null;
  return toReport(bannerUrl, e.thumbnail ?? e.image ?? e.video);
}
