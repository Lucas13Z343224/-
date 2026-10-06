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
  assert.equal(body.components[0].components[0].custom_id, "rules:accept");
  assert.match(body.embeds[0].description, /\*\*1\.\*\*/);
  assert.match(JSON.parse(originalEdit().body).content, /publié/);
});

test("/panel-infos signale les identifiants de salon à remplacer", async () => {
  await send({ type: 2, member: admin, channel_id: "1", data: { name: "panel-infos" } });
  assert.match(JSON.parse(originalEdit().body).content, /config\.json/);
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

test("ouvrir un ticket sans catégorie demande d'en choisir une", async () => {
  await send({ type: 3, member, data: { custom_id: "ticket:open", component_type: 2 } });
  assert.match(JSON.parse(originalEdit().body).content, /catégorie/);
});

test("cycle complet : catégorie, ouverture, doublon, prise en charge, fermeture", async () => {
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

  // 1. Choix de catégorie
  const sel = await send({ type: 3, member, data: { custom_id: "ticket:category", component_type: 3, values: ["acces"] } });
  assert.match(sel.data.data.content, /Problème d'accès/);

  // 2. Ouverture
  await send({ type: 3, member, data: { custom_id: "ticket:open", component_type: 2 } });
  const create = JSON.parse(calls.find((c) => /\/guilds\/\d+\/channels$/.test(c.url)).body);
  assert.equal(create.name, "ticket-elodie-test");
  assert.equal(create.parent_id, "700000000000000007");
  assert.deepEqual(create.permission_overwrites.map((o) => o.id), [GUILD, USER.id, "600000000000000006", APP]);
  assert.equal(kv.get(`open:${GUILD}:${USER.id}`), "910000000000000000");
  assert.match(JSON.parse(originalEdit().body).content, /<#910000000000000000>/);

  // 3. Une seule demande ouverte
  calls = [];
  await send({ type: 3, member, data: { custom_id: "ticket:open", component_type: 2 } });
  assert.match(JSON.parse(originalEdit().body).content, /déjà une demande ouverte/);
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
  assert.equal(kv.size, 1); // seul le choix de catégorie (expire tout seul) reste
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
