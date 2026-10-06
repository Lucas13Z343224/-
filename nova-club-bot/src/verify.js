// Vérification de la signature Ed25519 envoyée par Discord avec chaque interaction.
// Utilise l'API Web Crypto native de Workers : aucune dépendance et très peu de temps CPU.

const keyCache = new Map();

function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function importPublicKey(publicKeyHex) {
  let key = keyCache.get(publicKeyHex);
  if (!key) {
    const raw = hexToBytes(publicKeyHex);
    if (!raw) throw new Error("DISCORD_PUBLIC_KEY n'est pas une clé hexadécimale valide");
    key = await crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
    keyCache.set(publicKeyHex, key);
  }
  return key;
}

export async function verifyDiscordRequest(body, signature, timestamp, publicKeyHex) {
  const sig = hexToBytes(signature);
  if (!sig || !timestamp) return false;
  const key = await importPublicKey(publicKeyHex);
  const data = new TextEncoder().encode(timestamp + body);
  return crypto.subtle.verify({ name: "Ed25519" }, key, sig, data);
}
