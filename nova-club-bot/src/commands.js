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

export const COMMANDS = [
  adminCommand("panel-infos", config.commands.panel_infos),
  adminCommand("panel-reglement", config.commands.panel_reglement),
  adminCommand("panel-tickets", config.commands.panel_tickets),
  adminCommand("panel-formation", config.commands.panel_formation),
  adminCommand("panel-outils", config.commands.panel_outils),
  adminCommand("panel-faq", config.commands.panel_faq),
  adminCommand("panel-autopilot", config.commands.panel_autopilot),
];
