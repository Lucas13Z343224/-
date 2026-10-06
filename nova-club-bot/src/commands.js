// Définition des commandes slash (utilisée par scripts/register-commands.js).
import config from "../config.json" with { type: "json" };

const ADMINISTRATOR = String(1 << 3);

const salonOption = {
  type: 7, // CHANNEL
  name: "salon",
  description: config.commands.option_salon,
  required: false,
  channel_types: [0, 5], // salon textuel ou salon d'annonces
};

function adminCommand(name, description) {
  return {
    name,
    description,
    type: 1,
    default_member_permissions: ADMINISTRATOR, // masquée pour les non-administrateurs
    contexts: [0], // uniquement sur un serveur
    options: [salonOption],
  };
}

const annonceCommand = {
  name: "annonce",
  description: config.commands.annonce,
  type: 1,
  default_member_permissions: ADMINISTRATOR,
  contexts: [0],
  options: [
    { ...salonOption, description: config.commands.option_salon_annonce },
    {
      type: 3, // texte avec choix
      name: "ping",
      description: config.commands.option_ping,
      required: false,
      choices: [
        { name: config.annonce.ping_none, value: "none" },
        { name: config.annonce.ping_everyone, value: "everyone" },
        { name: config.annonce.ping_role, value: "role" },
      ],
    },
    { type: 8, name: "role", description: config.commands.option_role, required: false }, // rôle
    {
      type: 3,
      name: "image",
      description: config.commands.option_image,
      required: false,
      choices: config.annonce.images.map((i) => ({ name: i.label, value: i.value })),
    },
  ],
};

export const COMMANDS = [
  adminCommand("panel-infos", config.commands.panel_infos),
  adminCommand("panel-reglement", config.commands.panel_reglement),
  adminCommand("panel-tickets", config.commands.panel_tickets),
  adminCommand("panel-formation", config.commands.panel_formation),
  adminCommand("panel-outils", config.commands.panel_outils),
  adminCommand("panel-faq", config.commands.panel_faq),
  adminCommand("panel-autopilot", config.commands.panel_autopilot),
  annonceCommand,
];
