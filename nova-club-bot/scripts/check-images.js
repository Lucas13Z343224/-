// Vérifie les images utilisées par les panneaux (toutes les adresses *_url de config.json).
//   npm run check-images            → télécharge chaque adresse en ligne (après déploiement)
//   npm run check-images -- --local → vérifie seulement les fichiers du dossier public/
// Contrôles : fichier présent, type image, taille, et GIF réellement animé (plusieurs images).
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(await readFile(path.join(root, "config.json"), "utf8"));
const local = process.argv.includes("--local");
const MAX_ASSET_BYTES = 25 * 1024 * 1024; // limite Cloudflare par fichier statique
const HEAVY_BYTES = 10 * 1024 * 1024; // au-delà, Discord peut être lent à afficher le GIF

// Seules les images de la position choisie (banner_position) sont vérifiées.
const position = String(config.banner_position ?? "fichier").toLowerCase();
const INACTIVE_KEY = position === "encadre" ? "banner_haut_url" : "banner_url";

function collectUrls(obj, prefix = "", out = []) {
  for (const [key, value] of Object.entries(obj)) {
    const field = prefix ? `${prefix}.${key}` : key;
    if (field === "errors" || field === "media") continue;
    if (key === INACTIVE_KEY) continue; // bannière de l'autre position : non utilisée, donc non vérifiée
    if (typeof value === "string" && key.endsWith("_url") && value) out.push({ field, url: value });
    else if (value && typeof value === "object") collectUrls(value, field, out);
  }
  return out;
}

// Un GIF animé contient plusieurs blocs « Graphic Control Extension » (0x21 0xF9 0x04).
function gifFrames(bytes) {
  let frames = 0;
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) frames++;
  }
  return frames;
}

function describe(name, bytes) {
  const problems = [];
  const mb = (bytes.length / 1024 / 1024).toFixed(1);
  const isGif = bytes.subarray(0, 4).toString("latin1") === "GIF8";
  const isPng = bytes.subarray(1, 4).toString("latin1") === "PNG";
  if (name.endsWith(".gif")) {
    if (!isGif) problems.push("ce n'est pas un vrai fichier GIF");
    else if (gifFrames(bytes) < 2) problems.push("GIF NON animé (une seule image)");
  }
  if (name.endsWith(".png") && !isPng) problems.push("ce n'est pas un vrai fichier PNG");
  if (bytes.length > MAX_ASSET_BYTES) problems.push(`trop lourd (${mb} Mo, maximum 25 Mo chez Cloudflare)`);
  const info = isGif ? `${mb} Mo, ${gifFrames(bytes)} images` : `${mb} Mo`;
  const warn = bytes.length > HEAVY_BYTES ? " (lourd : vise moins de 10 Mo pour un affichage rapide)" : "";
  return { problems, info: info + warn };
}

let errors = 0;
// Une même image peut être utilisée à plusieurs endroits (ex. /annonce) : on ne la vérifie qu'une fois.
const urls = collectUrls(config).filter((item, i, all) => all.findIndex((o) => o.url === item.url) === i);
console.log(local ? "Vérification des fichiers du dossier public/ :\n" : "Vérification des adresses en ligne :\n");
console.log(`Position des bannières : « ${position} » (${position === "encadre" ? "anciennes bannières" : "bannières « -haut »"} vérifiées)\n`);

for (const { field, url } of urls) {
  let u;
  try {
    u = new URL(url);
  } catch {
    console.log(`❌ ${field} : adresse invalide « ${url} »`);
    errors++;
    continue;
  }
  const name = decodeURIComponent(u.pathname.split("/").pop());

  if (local) {
    if (!u.hostname.endsWith(".workers.dev")) {
      console.log(`⏭️  ${field} : image hébergée ailleurs (${u.hostname}), non vérifiée`);
      continue;
    }
    const file = path.join(root, "public", name);
    const exists = await stat(file).catch(() => null);
    if (!exists) {
      console.log(`❌ ${field} : fichier public/${name} introuvable`);
      errors++;
      continue;
    }
    const { problems, info } = describe(name, await readFile(file));
    if (problems.length) errors++;
    console.log(`${problems.length ? "❌" : "✅"} public/${name} — ${info}${problems.length ? " — " + problems.join(", ") : ""}`);
    continue;
  }

  try {
    const res = await fetch(url);
    const type = res.headers.get("content-type") ?? "?";
    if (!res.ok) {
      console.log(`❌ ${field} : ${url} répond ${res.status}`);
      errors++;
      continue;
    }
    const { problems, info } = describe(name, Buffer.from(await res.arrayBuffer()));
    if (!type.startsWith("image/")) problems.push(`type reçu « ${type} » au lieu d'une image`);
    if (problems.length) errors++;
    console.log(`${problems.length ? "❌" : "✅"} ${url} — ${type}, ${info}${problems.length ? " — " + problems.join(", ") : ""}`);
  } catch (err) {
    console.log(`❌ ${field} : impossible de télécharger ${url} (${err.message})`);
    errors++;
  }
}

if (errors) {
  console.log(`\n${errors} problème(s). ${local ? "Copie les images dans nova-club-bot/public/." : "Déploie d'abord (npx wrangler deploy)."}`);
  process.exit(1);
}
console.log("\nToutes les images sont prêtes.");
