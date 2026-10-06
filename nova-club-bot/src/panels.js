// Construction des panneaux publiés par les commandes /panel-*.
// Mise en page « composants V2 » de Discord : la bannière (GIF animé) en grande image
// tout en haut, puis un encadré (conteneur) avec la barre de couleur sur le côté.
import config from "../config.json" with { type: "json" };
import { COLOR, UserError, fill } from "./discord.js";

export const IS_COMPONENTS_V2 = 1 << 15;
const MAX_COMPONENTS = 40; // limite Discord par message

const SNOWFLAKE = /^\d{17,20}$/;

// ── Briques de mise en page ──────────────────────────────────────────────────
const text = (content) => ({ type: 10, content });
const separator = () => ({ type: 14, divider: true, spacing: 1 });
const row = (...components) => ({ type: 1, components });
const container = (...components) => ({ type: 17, accent_color: COLOR, components });
const gallery = (url, description) => ({ type: 12, items: [{ media: { url }, description: description || undefined }] });
const emoji = (e) => (e ? { name: e } : undefined);
const linkButton = (label, url, e) => ({ type: 2, style: 5, label, url, emoji: emoji(e) });
const footer = () => text(`-# ${config.footer}`);

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

function countComponents(components) {
  return components.reduce(
    (n, c) => n + 1 + countComponents(c.components ?? []) + (c.accessory ? 1 : 0),
    0,
  );
}

// Bannière en haut (si une adresse est définie) puis le reste du message.
function message(bannerUrl, bannerField, ...components) {
  const all = bannerUrl ? [gallery(checkUrl(bannerUrl, bannerField)), ...components] : components;
  if (countComponents(all) > MAX_COMPONENTS) {
    throw new UserError(fill(config.errors.too_many_items, { field: "composants", max: MAX_COMPONENTS }));
  }
  return { flags: IS_COMPONENTS_V2, components: all, allowed_mentions: { parse: [] } };
}

// ── Panneaux ────────────────────────────────────────────────────────────────
export function infosPanel() {
  const c = config.infos;
  checkChannelIds(c.channels.map((ch) => ch.id));
  const list = c.channels.map((ch) => `${ch.emoji ?? "•"} <#${ch.id}> — ${ch.description}`).join("\n");
  return message(
    c.banner_url,
    "infos.banner_url",
    container(text(`## ${c.title}\n${c.welcome}`), separator(), text(`### ${c.channels_title}\n${list}`), footer()),
  );
}

export function reglementPanel() {
  const r = config.reglement;
  const rules = r.rules.map((rule, i) => `**${i + 1}.** ${rule}`).join("\n");
  return message(
    r.banner_url,
    "reglement.banner_url",
    container(
      text(`## ${r.title}\n${r.intro}`),
      separator(),
      text(rules),
      separator(),
      text(r.outro),
      row({ type: 2, style: 3, custom_id: "rules:accept", label: r.button_label, emoji: emoji(r.button_emoji) }),
      footer(),
    ),
  );
}

export function ticketsPanel() {
  const t = config.tickets;
  checkChannelIds([t.questions_channel_id]);
  return message(
    t.banner_url,
    "tickets.banner_url",
    container(
      text(`## ${t.panel_title}\n${fill(t.panel_description, { salon_questions: `<#${t.questions_channel_id}>` })}`),
      separator(),
      row({
        type: 3, // menu déroulant : choisir une raison crée directement le ticket
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
      }),
      footer(),
    ),
  );
}

export function formationPanel() {
  const f = config.formation;
  const lien = checkUrl(f.lien, "formation.lien");
  const vars = { prix: f.prix, lien };
  const points = f.points.map((p) => `• ${p}`).join("\n");
  const parts = [
    container(
      text(`## ${f.title}\n${fill(f.description, vars)}`),
      separator(),
      text(points),
      separator(),
      text(fill(f.details, vars)),
    ),
  ];
  if (f.image_url) parts.push(gallery(checkUrl(f.image_url, "formation.image_url")));
  parts.push(row(linkButton(f.button_label, lien, f.button_emoji)));
  return message(f.banner_url, "formation.banner_url", ...parts);
}

export function outilsPanel() {
  const o = config.outils;
  checkMax(o.tools, "outils.tools", 10);
  const tools = o.tools.flatMap((tool, i) => [
    ...(i ? [separator()] : []),
    {
      type: 9, // section : texte + bouton « Ouvrir » à droite
      components: [text(`**${tool.name}**\n${tool.description}`)],
      accessory: linkButton(o.button_label, checkUrl(tool.url, `outils.tools[${i}].url`)),
    },
  ]);
  return message(
    o.banner_url,
    "outils.banner_url",
    container(text(`## ${o.title}\n${o.intro}`), separator(), ...tools, footer()),
  );
}

export function faqPanel() {
  const q = config.faq;
  checkMax(q.questions, "faq.questions", 15);
  return message(
    q.banner_url,
    "faq.banner_url",
    text(`## ${q.title}`),
    // un petit encadré par question
    ...q.questions.map((item) => container(text(`### ${item.question}\n${item.answer}`))),
  );
}

export function autopilotPanel() {
  const a = config.autopilot;
  const lien = checkUrl(a.lien_autopilot, "autopilot.lien_autopilot");
  return message(
    a.banner_url,
    "autopilot.banner_url",
    container(
      text(`## ${a.title}\n${a.description}`),
      separator(),
      text(a.features.map((f) => `• ${f}`).join("\n")),
      separator(),
      text(`-# ${a.disclaimer}`),
      row(linkButton(a.button_label, lien, a.button_emoji)),
    ),
  );
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

// Vérifie, dans la réponse de Discord, que les images ont bien été chargées.
// Discord remplit content_type et le drapeau IS_ANIMATED (1 << 0) des médias qu'il a lus.
export function mediaReport(sentMessage) {
  const items = [];
  const walk = (list) => {
    for (const c of list ?? []) {
      if (c.type === 12) items.push(...c.items.map((i) => i.media));
      walk(c.components);
    }
  };
  walk(sentMessage?.components);
  return items.map((m) => ({
    url: m.url,
    contentType: m.content_type ?? null,
    animated: Boolean((m.flags ?? 0) & 1),
  }));
}
