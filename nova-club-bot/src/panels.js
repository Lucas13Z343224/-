// Construction des trois panneaux publiés par les commandes /panel-*.
import config from "../config.json" with { type: "json" };
import { COLOR, UserError, fill } from "./discord.js";

const SNOWFLAKE = /^\d{17,20}$/;

function emoji(e) {
  return e ? { name: e } : undefined;
}

export function infosPanel() {
  const c = config.infos;
  const invalid = c.channels.filter((ch) => !SNOWFLAKE.test(String(ch.id))).map((ch) => ch.id);
  if (invalid.length) {
    throw new UserError(fill(config.errors.invalid_channel_ids, { ids: [...new Set(invalid)].join(", ") }));
  }
  const list = c.channels.map((ch) => `${ch.emoji ?? "•"} <#${ch.id}> — ${ch.description}`).join("\n");
  const embed = {
    title: c.title,
    description: `${c.welcome}\n\n**${c.channels_title}**\n${list}`,
    color: COLOR,
    footer: { text: config.footer },
  };
  if (c.banner_url) embed.image = { url: c.banner_url };
  return { embeds: [embed], allowed_mentions: { parse: [] } };
}

export function reglementPanel() {
  const r = config.reglement;
  const rules = r.rules.map((rule, i) => `**${i + 1}.** ${rule}`).join("\n");
  return {
    embeds: [
      {
        title: r.title,
        description: `${r.intro}\n\n${rules}\n\n${r.outro}`,
        color: COLOR,
        footer: { text: config.footer },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 3, custom_id: "rules:accept", label: r.button_label, emoji: emoji(r.button_emoji) },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

export function ticketsPanel() {
  const t = config.tickets;
  return {
    embeds: [{ title: t.panel_title, description: t.panel_description, color: COLOR, footer: { text: config.footer } }],
    components: [
      {
        type: 1,
        components: [
          {
            type: 3, // menu déroulant
            custom_id: "ticket:category",
            placeholder: t.select_placeholder,
            min_values: 1,
            max_values: 1,
            options: t.categories.map((cat) => ({
              value: cat.value,
              label: cat.label,
              description: cat.description || undefined,
              emoji: emoji(cat.emoji),
            })),
          },
        ],
      },
      {
        type: 1,
        components: [
          { type: 2, style: 1, custom_id: "ticket:open", label: t.open_button_label, emoji: emoji(t.open_button_emoji) },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

export const PANELS = {
  "panel-infos": { build: infosPanel, published: () => config.infos.published },
  "panel-reglement": { build: reglementPanel, published: () => config.reglement.published },
  "panel-tickets": { build: ticketsPanel, published: () => config.tickets.published },
};
