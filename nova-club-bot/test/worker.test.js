// Tests locaux : Discord et KV sont simulés, rien n'est envoyé à un vrai serveur.
// Lancer avec : npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const GUILD = "100000000000000001";
const USER = { id: "200000000000000002", username: "Élodie.Test", global_name: "Élodie" };
const STAFF = { id: "300000000000000003", username: "staffeur" };
const APP = "400000000000000004";

const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const publicKeyHex = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey)).toString("hex");

let calls;
let kv;
let routes;

function makeEnv() {
  return {
    DISCORD_APPLICATION_ID: APP,
    DISCORD_PUBLIC_KEY: publicKeyHex,
    DISCORD_TOKEN: "fake-token",
    MEMBER_ROLE_ID: "500000000000000005",
    STAFF_ROLE_ID: "600000000000000006",
    TICKET_CATEGORY_ID: "700000000000000007",
    LOG_CHANNEL_ID: "800000000000000008",
    TICKETS: {
      get: async (k) => kv.get(k) ?? null,
      put: async (k, v) => void kv.set(k, v),
      delete: async (k) => void kv.delete(k),
    },
  };
}

beforeEach(() => {
  calls = [];
  kv = new Map();
  routes = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? "GET", body: init.body };
    calls.push(call);
    for (const [method, re, reply] of routes) {
      if (method === call.method && re.test(call.url)) return reply(call);
    }
    return new Response(null, { status: 204 });
  };
});

const route = (method, re, reply) => routes.push([method, re, reply]);
const jsonRes = (data, status = 200) => new Response(JSON.stringify(data), { status });

async function send(interaction, { badSignature = false } = {}) {
  const body = JSON.stringify({ application_id: APP, token: "tok", guild_id: GUILD, ...interaction });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(timestamp + body));
  let hex = Buffer.from(sig).toString("hex");
  if (badSignature) hex = (hex[0] === "a" ? "b" : "a") + hex.slice(1);
  const pending = [];
  const res = await worker.fetch(
    new Request("https://bot.example/", {
      method: "POST",
      headers: { "X-Signature-Ed25519": hex, "X-Signature-Timestamp": timestamp },
      body,
    }),
    makeEnv(),
    { waitUntil: (p) => pending.push(p) },
  );
  await Promise.all(pending);
  return { status: res.status, data: res.status === 200 ? await res.json() : null };
}

const admin = { user: STAFF, roles: [], permissions: String(1n << 3n) };
const member = { user: USER, roles: [], permissions: "0" };
const staffMember = { user: STAFF, roles: ["600000000000000006"], permissions: "0" };
const originalEdit = () => calls.find((c) => c.method === "PATCH" && c.url.includes("@original"));
const followUps = () => calls.filter((c) => c.method === "POST" && /\/webhooks\/\d+\/tok$/.test(c.url)).map((c) => JSON.parse(c.body));
const V2 = 1 << 15;
const flat = (list) => list.flatMap((c) => [c, ...flat(c.components ?? []), ...(c.accessory ? [c.accessory] : [])]);
async function publish(name) {
  calls = [];
  await send({ type: 2, member: admin, channel_id: "1", data: { name, options: [{ name: "salon", type: 7, value: "999000000000000000" }] } });
  const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/channels/999000000000000000/messages"));
  return { body: post && JSON.parse(post.body), edit: JSON.parse(originalEdit().body).content };
}

test("répond au PING de Discord", async () => {
  const r = await send({ type: 1 });
  assert.deepEqual(r.data, { type: 1 });
});

test("refuse une signature invalide (401)", async () => {
  const r = await send({ type: 1 }, { badSignature: true });
  assert.equal(r.status, 401);
});

test("/panel-tickets refusé pour un non-administrateur", async () => {
  const r = await send({ type: 2, member, data: { name: "panel-tickets" }, channel_id: "9" });
  assert.match(r.data.data.content, /administrateurs/);
  assert.equal(calls.length, 0);
});

test("/panel-reglement publie le règlement dans le salon choisi", async () => {
  const r = await send({
    type: 2,
    member: admin,
    channel_id: "1",
    data: { name: "panel-reglement", options: [{ name: "salon", type: 7, value: "999000000000000000" }] },
  });
  assert.equal(r.data.type, 5);
  const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/channels/999000000000000000/messages"));
  const body = JSON.parse(post.body);
  assert.equal(body.flags, V2);
  // Bannière animée en premier, puis l'encadré orange
  assert.equal(body.components[0].type, 12);
  assert.match(body.components[0].items[0].media.url, /banniere-reglement\.gif$/);
  assert.equal(body.components[1].type, 17);
  assert.equal(body.components[1].accent_color, 0xff6b1a);
  const all = flat(body.components);
  assert.ok(all.some((c) => c.custom_id === "rules:accept"));
  assert.ok(all.some((c) => c.type === 10 && /\*\*1\.\*\*/.test(c.content)));
  assert.match(JSON.parse(originalEdit().body).content, /publié/);
});

test("/panel-infos : bannière puis salons cliquables", async () => {
  const { body } = await publish("panel-infos");
  assert.match(body.components[0].items[0].media.url, /banniere-informations\.gif$/);
  assert.ok(flat(body.components).some((c) => c.type === 10 && c.content.includes("<#1556574078197047296>")));
});

test("/panel-tickets signale l'identifiant du salon questions à remplacer", async () => {
  const { body, edit } = await publish("panel-tickets");
  assert.equal(body, undefined);
  assert.match(edit, /REMPLACE_PAR_ID_SALON_QUESTIONS/);
});

test("/panel-formation : bannière, encadré avec prix et lien, image, bouton lien", async () => {
  const { body } = await publish("panel-formation");
  assert.equal(body.flags, V2);
  const [banner, box, image, buttons] = body.components;
  assert.match(banner.items[0].media.url, /banniere-formation\.gif$/);
  assert.equal(box.type, 17);
  const texts = flat([box]).filter((c) => c.type === 10).map((c) => c.content).join("\n");
  assert.match(texts, /Formation dropshipping eBay & Etsy/);
  assert.match(texts, /À REMPLACER \(ex\. 97 €\)/);
  assert.match(texts, /https:\/\/exemple\.com\/a-remplacer-formation/);
  assert.match(image.items[0].media.url, /decouverte-formation\.png$/);
  assert.equal(buttons.components[0].style, 5);
  assert.equal(buttons.components[0].url, "https://exemple.com/a-remplacer-formation");
  assert.equal(buttons.components[0].emoji.name, "🚀");
});

test("/panel-outils : une ligne par outil avec un bouton lien", async () => {
  const { body } = await publish("panel-outils");
  assert.match(body.components[0].items[0].media.url, /banniere-outils\.gif$/);
  const sections = flat(body.components).filter((c) => c.type === 9);
  assert.equal(sections.length, 3);
  assert.ok(sections.every((s) => s.accessory.style === 5 && s.accessory.url.startsWith("https://")));
  assert.match(sections[0].components[0].content, /À REMPLACER/);
});

test("/panel-faq : un petit encadré par question", async () => {
  const { body } = await publish("panel-faq");
  assert.match(body.components[0].items[0].media.url, /banniere-faq\.gif$/);
  const boxes = body.components.filter((c) => c.type === 17);
  assert.equal(boxes.length, 4);
  assert.match(boxes[3].components[0].content, /Chaque plateforme a ses propres règles/);
});

test("/panel-autopilot : présentation et bouton lien", async () => {
  const { body } = await publish("panel-autopilot");
  assert.match(body.components[0].items[0].media.url, /banniere-autopilot\.gif$/);
  const all = flat(body.components);
  const texts = all.filter((c) => c.type === 10).map((c) => c.content).join("\n");
  for (const word of ["produits", "Publication groupée", "Suivi des prix", "commandes", "Comptabilité"]) assert.match(texts, new RegExp(word));
  assert.ok(all.some((c) => c.style === 5 && c.url === "https://exemple.com/a-remplacer-autopilot"));
});

test("la publication indique si Discord a reconnu le GIF animé", async () => {
  route("POST", /999000000000000000\/messages/, (call) => {
    const sent = JSON.parse(call.body);
    sent.components[0].items[0].media = { url: sent.components[0].items[0].media.url, content_type: "image/gif", flags: 1 };
    return jsonRes(sent);
  });
  const { edit } = await publish("panel-faq");
  assert.match(edit, /banniere-faq\.gif : GIF animé reconnu/);
});

test("tous les panneaux respectent les limites de Discord", async () => {
  const { PANELS } = await import("../src/panels.js");
  const config = (await import("../config.json", { with: { type: "json" } })).default;
  config.tickets.questions_channel_id = "123456789012345678";
  for (const [name, panel] of Object.entries(PANELS)) {
    const msg = panel.build();
    assert.ok(flat(msg.components).length <= 40, `${name} : trop de composants`);
    const chars = flat(msg.components).filter((c) => c.type === 10).reduce((n, c) => n + c.content.length, 0);
    assert.ok(chars <= 4000, `${name} : trop de texte`);
  }
  config.tickets.questions_channel_id = "REMPLACE_PAR_ID_SALON_QUESTIONS";
});

test("bouton du règlement : donne le rôle", async () => {
  await send({ type: 3, member, data: { custom_id: "rules:accept", component_type: 2 } });
  assert.ok(calls.some((c) => c.method === "PUT" && c.url.endsWith(`/members/${USER.id}/roles/500000000000000005`)));
});

test("bouton du règlement : erreur claire si le rôle du bot est trop bas", async () => {
  route("PUT", /roles/, () => jsonRes({ code: 50013, message: "Missing Permissions" }, 403));
  await send({ type: 3, member, data: { custom_id: "rules:accept", component_type: 2 } });
  assert.match(JSON.parse(originalEdit().body).content, /au-dessus/);
});

test("le bouton « Ouvrir un ticket » des anciens panneaux renvoie vers le menu", async () => {
  const r = await send({ type: 3, member, data: { custom_id: "ticket:open", component_type: 2 } });
  assert.match(r.data.data.content, /menu/);
  assert.equal(calls.length, 0);
});

test("une raison inconnue est refusée sans rien créer", async () => {
  const r = await send({ type: 3, member, data: { custom_id: "ticket:create", component_type: 3, values: ["pirate"] } });
  assert.match(r.data.data.content, /Catégorie inconnue/);
  assert.equal(calls.length, 0);
});

test("cycle complet : menu, ouverture, doublon, prise en charge, fermeture", async () => {
  route("POST", /\/guilds\/\d+\/channels$/, () => jsonRes({ id: "910000000000000000", name: "ticket-elodie-test" }));
  route("GET", /\/channels\/910000000000000000$/, () => jsonRes({ id: "910000000000000000" }));
  route("GET", /\/messages\?limit=100$/, () =>
    jsonRes(
      Array.from({ length: 100 }, (_, i) => ({
        id: String(2000 - i),
        content: `msg ${200 - i}`,
        timestamp: new Date().toISOString(),
        author: USER,
        attachments: [],
        embeds: [],
      })),
    ),
  );
  route("GET", /before=/, () =>
    jsonRes([{ id: "1", content: "premier", timestamp: new Date().toISOString(), author: USER, attachments: [], embeds: [] }]),
  );

  const config = (await import("../config.json", { with: { type: "json" } })).default;
  config.tickets.questions_channel_id = "123456789012345678";
  // 1-2. Choisir une raison dans le menu crée directement le ticket
  const sel = await send({ type: 3, member, message: { flags: V2 }, data: { custom_id: "ticket:create", component_type: 3, values: ["acces"] } });
  assert.equal(sel.data.type, 7); // le panneau est republié pour vider le menu
  assert.ok(flat(sel.data.data.components).some((c) => c.custom_id === "ticket:create"));
  config.tickets.questions_channel_id = "REMPLACE_PAR_ID_SALON_QUESTIONS";
  const create = JSON.parse(calls.find((c) => /\/guilds\/\d+\/channels$/.test(c.url)).body);
  assert.equal(create.name, "ticket-elodie-test");
  assert.equal(create.parent_id, "700000000000000007");
  assert.deepEqual(create.permission_overwrites.map((o) => o.id), [GUILD, USER.id, "600000000000000006", APP]);
  assert.equal(kv.get(`open:${GUILD}:${USER.id}`), "910000000000000000");
  assert.match(followUps().at(-1).content, /<#910000000000000000>/);
  assert.equal(followUps().at(-1).flags, 64);
  assert.match(JSON.parse(calls.find((c) => c.url.endsWith("/channels/910000000000000000/messages")).body).embeds[0].title, /Problème d'accès/);

  // 3. Une seule demande ouverte (y compris depuis un ancien panneau)
  calls = [];
  const old = await send({ type: 3, member, message: { flags: 0 }, data: { custom_id: "ticket:category", component_type: 3, values: ["support"] } });
  assert.equal(old.data.type, 6);
  assert.match(followUps().at(-1).content, /déjà une demande ouverte/);
  assert.ok(!calls.some((c) => c.method === "POST" && /\/guilds\/\d+\/channels$/.test(c.url)));

  // 4. "Je m'en occupe" : refusé pour un membre, accepté pour le staff
  const ticketChannel = { id: "910000000000000000", name: "ticket-elodie-test", parent_id: "700000000000000007" };
  const msg = { embeds: [{ title: "Ticket" }] };
  const refused = await send({ type: 3, member, channel_id: ticketChannel.id, channel: ticketChannel, message: msg, data: { custom_id: "ticket:claim" } });
  assert.match(refused.data.data.content, /Seule l'équipe/);
  const claimed = await send({ type: 3, member: staffMember, channel_id: ticketChannel.id, channel: ticketChannel, message: msg, data: { custom_id: "ticket:claim" } });
  assert.equal(claimed.data.type, 7);
  assert.equal(claimed.data.data.components[0].components[1].disabled, true);
  assert.equal(JSON.parse(kv.get("chan:910000000000000000")).claimedBy.id, STAFF.id);

  // 5. Fermeture avec confirmation
  const confirm = await send({ type: 3, member, channel_id: ticketChannel.id, channel: ticketChannel, data: { custom_id: "ticket:close" } });
  assert.equal(confirm.data.data.flags, 64);
  calls = [];
  const closing = await send({ type: 3, member, channel_id: ticketChannel.id, channel: ticketChannel, data: { custom_id: "ticket:close-confirm" } });
  assert.equal(closing.data.type, 7);
  const upload = calls.find((c) => c.method === "POST" && c.url.endsWith("/channels/800000000000000008/messages"));
  assert.ok(upload.body instanceof FormData);
  const text = await upload.body.get("files[0]").text();
  assert.match(text, /msg 101/);
  assert.match(text, /premier/);
  assert.equal(text.split("\n").filter((l) => l.startsWith("[")).length, 101);
  assert.ok(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/channels/910000000000000000")));
  assert.equal(kv.size, 0);
  const external = calls.length;
  assert.ok(external <= 10, `trop de sous-requêtes : ${external}`);
});

test("la fermeture refuse un salon hors de la catégorie des tickets", async () => {
  const ch = { id: "5", name: "general", parent_id: "123" };
  await send({ type: 3, member, channel_id: "5", channel: ch, data: { custom_id: "ticket:close-confirm" } });
  assert.ok(!calls.some((c) => c.method === "DELETE"));
  assert.match(JSON.parse(originalEdit().body).content, /pas un ticket/);
});

test("le salon n'est pas supprimé si la transcription échoue", async () => {
  route("GET", /messages/, () => jsonRes([]));
  route("POST", /800000000000000008\/messages/, () => jsonRes({ code: 50001, message: "Missing Access" }, 403));
  const ch = { id: "910000000000000000", name: "ticket-x", parent_id: "700000000000000007" };
  await send({ type: 3, member, channel_id: ch.id, channel: ch, data: { custom_id: "ticket:close-confirm" } });
  assert.ok(!calls.some((c) => c.method === "DELETE"));
  assert.match(JSON.parse(originalEdit().body).content, /PAS été supprimé/);
});

test("page d'accueil en ligne et 404 pour un fichier absent", async () => {
  const ctx = { waitUntil() {} };
  const home = await worker.fetch(new Request("https://bot.example/"), makeEnv(), ctx);
  assert.match(await home.text(), /en ligne ✅/);
  const missing = await worker.fetch(new Request("https://bot.example/absent.gif"), makeEnv(), ctx);
  assert.equal(missing.status, 404);
});
