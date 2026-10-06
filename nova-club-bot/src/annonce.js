// Commande /annonce : ouvre un formulaire (titre + texte) puis publie l'annonce dans un encadré.
// Les options de la commande (salon, ping, rôle, image) sont gardées dans le custom_id du formulaire,
// donc rien n'est stocké et le formulaire fonctionne même après un redéploiement.
import config from "../config.json" with { type: "json" };
import { UserError, fill } from "./discord.js";
import { annonceImages, annoncePanel } from "./panels.js";

const SNOWFLAKE = /^\d{17,20}$/;
const PINGS = ["none", "everyone", "role"];
const PREFIX = "annonce";
const NONE = "-";

export const TITLE_MAX = 256;
export const TEXT_MAX = 4000;

const optionValue = (interaction, name) => interaction.data.options?.find((o) => o.name === name)?.value;

// Étape 1 : la commande est lancée → on vérifie les options puis on ouvre le formulaire.
export function annonceModal(interaction) {
  const a = config.annonce;
  const role = optionValue(interaction, "role");
  const ping = optionValue(interaction, "ping") ?? (role ? "role" : "none");
  const image = optionValue(interaction, "image") ?? a.default_image;
  const channel = optionValue(interaction, "salon");

  if (ping === "role" && !role) throw new UserError(config.errors.annonce_role_missing);

  const customId = [PREFIX, channel ?? NONE, ping, ping === "role" ? role : NONE, image].join("|");
  return {
    type: 9, // fenêtre (modal)
    data: {
      custom_id: customId,
      title: a.modal_title,
      components: [
        {
          type: 18, // Label
          label: a.label_title,
          component: { type: 4, custom_id: "titre", style: 1, min_length: 1, max_length: TITLE_MAX, required: true },
        },
        {
          type: 18,
          label: a.label_text,
          description: a.label_text_help,
          component: { type: 4, custom_id: "texte", style: 2, min_length: 1, max_length: TEXT_MAX, required: true },
        },
      ],
    },
  };
}

export const isAnnonceModal = (customId) => String(customId).startsWith(`${PREFIX}|`);

// Récupère les champs du formulaire (que les champs soient dans un Label ou une ligne classique).
function fieldValues(components, out = {}) {
  for (const c of components ?? []) {
    if (c.type === 4 && c.custom_id) out[c.custom_id] = c.value ?? "";
    if (c.component) fieldValues([c.component], out);
    if (c.components) fieldValues(c.components, out);
  }
  return out;
}

// Étape 2 : le formulaire est envoyé → on prépare le message à publier.
// Renvoie { channelId, body, ping }.
export function annonceFromSubmit(interaction) {
  const [, channel, ping, role, image] = interaction.data.custom_id.split("|");
  if (!PINGS.includes(ping) || (channel !== NONE && !SNOWFLAKE.test(channel)) || (ping === "role" && !SNOWFLAKE.test(role))) {
    throw new UserError(config.errors.unknown_action);
  }
  const { titre = "", texte = "" } = fieldValues(interaction.data.components);
  const title = titre.trim();
  const text = texte.trim();
  if (!title || !text) throw new UserError(config.errors.annonce_empty);

  const imageValue = annonceImages().some((i) => i.value === image) ? image : config.annonce.default_image;
  const body = annoncePanel({ title, text, imageValue });

  // Le ping est dans le contenu, sur sa propre ligne, AVANT l'adresse de la bannière du haut (si elle existe).
  let pingLine = null;
  if (ping === "everyone") {
    pingLine = "@everyone";
    body.allowed_mentions = { parse: ["everyone"] };
  } else if (ping === "role") {
    pingLine = `<@&${role}>`;
    body.allowed_mentions = { roles: [role] };
  }
  const content = [pingLine, body.content].filter(Boolean).join("\n");
  if (content) body.content = content;
  return { channelId: channel === NONE ? interaction.channel_id : channel, body, ping };
}

export function annonceSummary(channelId, ping) {
  const lines = [fill(config.annonce.published, { channel: `<#${channelId}>` })];
  if (ping !== "none") lines.push(config.annonce.ping_note);
  return lines;
}
