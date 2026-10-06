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
export function imageUrl(url) {
  if (!url) return "";
  checkUrl(url, "banner_url");
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

// Un encadré : titre, description (sections de texte), bannière en bas, barre de couleur.
export function embed({ title, description, image }) {
  const e = { title, description, color: COLOR };
  if (image) e.image = { url: imageUrl(image) };
  return e;
}

// Sections de texte séparées par une ligne vide. Un titre de section s'écrit en gras.
const section = (heading, body) => (heading ? `**${heading}**\n${body}` : body);
const join = (...parts) => parts.filter(Boolean).join("\n\n");

// Vérifie les limites de Discord avant l'envoi, avec un message clair.
function message(embeds, components) {
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
  const msg = { embeds, allowed_mentions: { parse: [] } };
  if (components?.length) msg.components = components;
  return msg;
}

// ── Panneaux ────────────────────────────────────────────────────────────────
export function infosPanel() {
  const c = config.infos;
  checkChannelIds(c.channels.map((ch) => ch.id));
  const list = c.channels.map((ch) => `${ch.emoji ?? "•"} <#${ch.id}> — ${ch.description}`).join("\n");
  return message([
    embed({ title: c.title, description: join(c.welcome, section(c.channels_title, list)), image: c.banner_url }),
  ]);
}

export function reglementPanel() {
  const r = config.reglement;
  const rules = r.rules.map((rule, i) => `**${i + 1}.** ${rule}`).join("\n");
  return message(
    [
      embed({
        title: r.title,
        description: join(r.intro, section(r.rules_title, rules), section(r.outro_title, r.outro)),
        image: r.banner_url,
      }),
    ],
    [row({ type: 2, style: 3, custom_id: "rules:accept", label: r.button_label, emoji: emoji(r.button_emoji) })],
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
  return message(
    [
      embed({
        title: t.panel_title,
        description: fill(t.panel_description, { categories, salon_questions: `<#${t.questions_channel_id}>` }),
        image: t.banner_url,
      }),
    ],
    [ticketSelectRow()],
  );
}

export function formationPanel() {
  const f = config.formation;
  const lien = checkUrl(f.lien, "formation.lien");
  const vars = { prix: f.prix, lien };
  const points = f.points.map((p) => `• ${p}`).join("\n");
  const embeds = [
    embed({
      title: f.title,
      description: join(fill(f.description, vars), section(f.points_title, points), section(f.details_title, fill(f.details, vars))),
      image: f.banner_url,
    }),
  ];
  // Deuxième encadré : l'image de présentation en grande image.
  if (f.image_url) embeds.push({ color: COLOR, image: { url: imageUrl(f.image_url) } });
  return message(embeds, [row(linkButton(f.button_label, lien, f.button_emoji))]);
}

export function outilsPanel() {
  const o = config.outils;
  checkMax(o.tools, "outils.tools", 15);
  const tools = o.tools
    .map((tool, i) => `🔹 **${tool.name}**\n${tool.description}\n[${o.link_label} →](${checkUrl(tool.url, `outils.tools[${i}].url`)})`)
    .join("\n\n");
  return message([embed({ title: o.title, description: join(o.intro, tools), image: o.banner_url })]);
}

export function faqPanel() {
  const q = config.faq;
  checkMax(q.questions, "faq.questions", 15);
  const body = q.questions.map((item) => section(`${q.question_emoji} ${item.question}`, item.answer)).join("\n\n");
  return message([embed({ title: q.title, description: body, image: q.banner_url })]);
}

export function autopilotPanel() {
  const a = config.autopilot;
  const lien = checkUrl(a.lien_autopilot, "autopilot.lien_autopilot");
  const features = a.features.map((f) => `• ${f}`).join("\n");
  return message(
    [
      embed({
        title: a.title,
        description: join(a.description, section(a.features_title, features), `*${a.disclaimer}*`),
        image: a.banner_url,
      }),
    ],
    [row(linkButton(a.button_label, lien, a.button_emoji))],
  );
}

// ── Annonce (/annonce) ──────────────────────────────────────────────────────
export function annonceImages() {
  return config.annonce.images;
}

export function annoncePanel({ title, text, imageValue }) {
  const choice = annonceImages().find((i) => i.value === imageValue) ?? annonceImages().find((i) => i.value === config.annonce.default_image);
  return message([embed({ title, description: text, image: choice?.banner_url })]);
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

// Vérifie, dans la réponse de Discord, comment les images des encadrés ont été lues.
export function mediaReport(sentMessage) {
  return (sentMessage?.embeds ?? [])
    .filter((e) => e.image)
    .map((e) => ({
      url: e.image.url,
      contentType: e.image.content_type ?? null,
      known: e.image.width != null || e.image.content_type != null,
      animated: Boolean((e.image.flags ?? 0) & IS_ANIMATED_EMBED),
    }));
}
