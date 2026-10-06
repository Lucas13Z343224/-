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
    UNFURL_WAIT_MS: "0", // pas d'attente dans les tests
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
const V2 = 1 << 15; // ancienne mise en page (composants V2)
const ORANGE = 0xff6b1a;
async function publish(name, extra = []) {
  calls = [];
  await send({ type: 2, member: admin, channel_id: "1", data: { name, options: [{ name: "salon", type: 7, value: "999000000000000000" }, ...extra] } });
  const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/channels/999000000000000000/messages"));
  return { body: post && JSON.parse(post.body), edit: JSON.parse(originalEdit().body).content };
}
const withQuestionsChannel = async (fn) => {
  const config = (await import("../config.json", { with: { type: "json" } })).default;
  config.tickets.questions_channel_id = "123456789012345678";
  try {
    return await fn(config);
  } finally {
    config.tickets.questions_channel_id = "REMPLACE_PAR_ID_SALON_QUESTIONS";
  }
};
const buttons = (body) => (body.components ?? []).flatMap((r) => r.components);
const HOST = "https://nova-club-bot.novaclub.workers.dev/";
// Mise en page commune : un seul message, un seul encadré à barre orange, pas de composants V2.
// Position « haut » (par défaut) : bannière « -haut » = contenu du message, seule sur sa ligne, rien dans l'encadré.
// Position « encadre » : ancienne bannière dans l'encadré (embed.image), pas de contenu.
function assertLayout(body, banner, title, position = "haut") {
  assert.equal(body.flags, undefined);
  assert.equal(body.embeds.length >= 1, true);
  const e = body.embeds[0];
  assert.equal(e.title, title);
  assert.equal(e.color, ORANGE);
  if (position === "haut") {
    assert.equal(body.content, `${HOST}${banner}-haut.gif?v=2`);
    assert.ok(!body.content.includes("\n"));
    assert.equal(e.image, undefined);
  } else {
    assert.equal(body.content, undefined);
    assert.equal(e.image.url, `${HOST}${banner}.gif?v=2`);
  }
  return e;
}
const withPosition = async (position, fn) => {
  const config = (await import("../config.json", { with: { type: "json" } })).default;
  const old = config.banner_position;
  config.banner_position = position;
  try {
    return await fn(config);
  } finally {
    config.banner_position = old;
  }
};

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

test("/panel-reglement : titre, règles numérotées, bannière en bas, bouton sous le message", async () => {
  const { body, edit } = await publish("panel-reglement");
  const e = assertLayout(body, "banniere-reglement", "📜 Règlement du serveur");
  assert.match(e.description, /\*\*1\.\*\*/);
  assert.match(e.description, /\*\*6\.\*\*/);
  assert.equal(buttons(body)[0].custom_id, "rules:accept");
  assert.equal(buttons(body)[0].label, "J'ai lu et j'accepte");
  assert.match(edit, /publié/);
});

test("/panel-infos : titre et salons cliquables (réglages conservés)", async () => {
  const { body } = await publish("panel-infos");
  const e = assertLayout(body, "banniere-informations", "📌 Informations");
  assert.ok(e.description.includes("📜 <#1556574078197047296> — Le règlement à lire et accepter pour accéder au serveur."));
  assert.equal(body.components, undefined);
});

test("/panel-tickets : liste des catégories, consigne, menu sans bouton", async () => {
  await withQuestionsChannel(async () => {
    const { body } = await publish("panel-tickets");
    const e = assertLayout(body, "banniere-tickets", "🎫 Support — Nova Club");
    for (const label of ["Support", "Problème d'accès", "Question sur la formation", "Autre"]) assert.ok(e.description.includes(`**${label}**`), label);
    assert.ok(e.description.includes("⚠️"));
    assert.ok(e.description.includes("<#123456789012345678>"));
    assert.equal(body.components.length, 1);
    const menu = body.components[0].components[0];
    assert.equal(menu.type, 3);
    assert.equal(menu.custom_id, "ticket:create");
    assert.equal(menu.placeholder, "Sélectionne la raison de ton ticket");
    assert.equal(menu.options.length, 4);
    assert.ok(!buttons(body).some((b) => b.type === 2)); // plus de bouton « Ouvrir un ticket »
  });
});

test("/panel-tickets signale l'identifiant du salon questions à remplacer", async () => {
  const { body, edit } = await publish("panel-tickets");
  assert.equal(body, undefined);
  assert.match(edit, /REMPLACE_PAR_ID_SALON_QUESTIONS/);
});

test("/panel-formation : encadré avec prix et lien, 2e encadré image, bouton lien", async () => {
  const { body } = await publish("panel-formation");
  assert.equal(body.embeds.length, 2);
  const e = assertLayout(body, "banniere-formation", "🎓 Formation dropshipping eBay & Etsy");
  assert.match(e.description, /eBay\*\* et \*\*Etsy/);
  assert.match(e.description, /communauté privée/);
  assert.match(e.description, /Nova Autopilot/);
  assert.match(e.description, /À REMPLACER \(ex\. 97 €\)/);
  assert.match(e.description, /https:\/\/exemple\.com\/a-remplacer-formation/);
  const second = body.embeds[1];
  assert.equal(second.color, ORANGE);
  assert.match(second.image.url, /decouverte-formation\.png\?v=2$/);
  const [btn] = buttons(body);
  assert.equal(btn.style, 5);
  assert.equal(btn.label, "Découvrir la formation");
  assert.equal(btn.emoji.name, "🚀");
  assert.equal(btn.url, "https://exemple.com/a-remplacer-formation");
});

test("/panel-outils : liste des outils avec liens, 3 exemples À REMPLACER", async () => {
  const { body } = await publish("panel-outils");
  const e = assertLayout(body, "banniere-outils", "🛠️ Outils pour ton business");
  assert.equal(e.description.match(/À REMPLACER/g).length, 3);
  assert.equal(e.description.match(/\]\(https:\/\/exemple\.com\/a-remplacer-outil-\d\)/g).length, 3);
});

test("/panel-faq : une section par question", async () => {
  const { body } = await publish("panel-faq");
  const e = assertLayout(body, "banniere-faq", "❓ FAQ");
  for (const q of ["Qu'est-ce que le dropshipping ?", "Comment accéder à Nova Autopilot ?", "Comment ouvrir un ticket ?", "Est-ce autorisé par les plateformes ?"]) {
    assert.ok(e.description.includes(`**💬 ${q}**`), q);
  }
  assert.ok(e.description.includes("Chaque plateforme a ses propres règles. Lis-les avant de vendre et ne vends que des produits que tu as le droit de vendre. L'équipe ne peut pas garantir les décisions des plateformes."));
});

test("/panel-autopilot : présentation, bouton lien, aucune promesse de gains", async () => {
  const { body } = await publish("panel-autopilot");
  const e = assertLayout(body, "banniere-autopilot", "🤖 Nova Autopilot");
  for (const word of ["Trouver des produits", "Publication groupée", "Suivi des prix", "commandes", "Comptabilité"]) assert.match(e.description, new RegExp(word));
  assert.match(e.description, /ne garantit aucun résultat ni aucun revenu/);
  assert.equal(buttons(body)[0].url, "https://exemple.com/a-remplacer-autopilot");
});

test("une image remplacée change d'adresse quand images_version change", async () => {
  const config = (await import("../config.json", { with: { type: "json" } })).default;
  const { imageUrl } = await import("../src/panels.js");
  const old = config.images_version;
  config.images_version = "3";
  assert.equal(imageUrl("https://x.example/a.gif"), "https://x.example/a.gif?v=3");
  config.images_version = "";
  assert.equal(imageUrl("https://x.example/a.gif"), "https://x.example/a.gif");
  config.images_version = old;
});

test("position « encadre » : GIF d'encadré reconnu animé par Discord", () =>
  withPosition("encadre", async () => {
    route("POST", /999000000000000000\/messages/, (call) => {
      const sent = JSON.parse(call.body);
      sent.embeds[0].image = { ...sent.embeds[0].image, content_type: "image/gif", width: 600, height: 200, flags: 1 << 5 };
      return jsonRes(sent);
    });
    const { edit } = await publish("panel-faq");
    assert.match(edit, /banniere-faq\.gif : GIF animé reconnu/);
  }));

test("position « encadre » : GIF reconnu mais non animé signalé", () =>
  withPosition("encadre", async () => {
    route("POST", /999000000000000000\/messages/, (call) => {
      const sent = JSON.parse(call.body);
      sent.embeds[0].image = { ...sent.embeds[0].image, content_type: "image/gif", width: 600, height: 200, flags: 0 };
      return jsonRes(sent);
    });
    const { edit } = await publish("panel-faq");
    assert.match(edit, /pas signalé comme animé/);
  }));

// Position « haut » : Discord crée l'aperçu de l'adresse après coup, le bot relit donc le message.
const unfurlRoutes = (unfurl) => {
  route("POST", /999000000000000000\/messages$/, (call) => jsonRes({ id: "888000000000000000", ...JSON.parse(call.body) }));
  route("GET", /999000000000000000\/messages\/888000000000000000$/, (call) => {
    const posted = JSON.parse(calls.find((c) => c.method === "POST" && c.url.endsWith("/messages")).body);
    return jsonRes({ id: "888000000000000000", ...posted, embeds: [...(unfurl ? [unfurl(posted.content)] : []), ...posted.embeds] });
  });
};

test("position « haut » : le bot relit le message et confirme le GIF animé", async () => {
  unfurlRoutes((url) => ({ type: "image", url, thumbnail: { url, width: 800, height: 200, flags: 1 << 5 } }));
  const { edit, body } = await publish("panel-faq");
  assert.match(edit, /banniere-faq-haut\.gif : GIF animé reconnu/);
  assert.equal(calls.filter((c) => c.method === "GET" && c.url.includes("/messages/888")).length, 1);
  assert.equal(body.content, `${HOST}banniere-faq-haut.gif?v=2`);
});

test("position « haut » : aperçu pas encore créé par Discord → message d'attente", async () => {
  unfurlRoutes(null);
  const { edit } = await publish("panel-faq");
  assert.match(edit, /banniere-faq-haut\.gif : Discord n'a pas encore affiché la bannière du haut/);
});

test("position « haut » : l'aperçu d'un autre lien du texte n'est pas pris pour la bannière", async () => {
  unfurlRoutes(() => ({ type: "image", url: "https://autre.example/x.gif", thumbnail: { width: 1, flags: 1 << 5 } }));
  const { edit } = await publish("panel-faq");
  assert.doesNotMatch(edit, /GIF animé reconnu/);
  assert.match(edit, /pas encore affiché/);
});

test("tous les panneaux respectent les limites de Discord", async () => {
  await withQuestionsChannel(async () => {
    const { PANELS } = await import("../src/panels.js");
    for (const [name, panel] of Object.entries(PANELS)) {
      const msg = panel.build();
      assert.ok(msg.embeds.length <= 10, name);
      let total = 0;
      for (const e of msg.embeds) {
        assert.ok((e.title ?? "").length <= 256, `${name} : titre trop long`);
        assert.ok((e.description ?? "").length <= 4096, `${name} : description trop longue`);
        total += (e.title ?? "").length + (e.description ?? "").length;
      }
      assert.ok(total <= 6000, `${name} : trop de texte`);
      assert.ok((msg.components ?? []).length <= 5, name);
    }
  });
});

test("un texte trop long est refusé avec un message clair", async () => {
  const config = (await import("../config.json", { with: { type: "json" } })).default;
  const old = config.faq.questions[0].answer;
  config.faq.questions[0].answer = "x".repeat(4100);
  try {
    const { edit, body } = await publish("panel-faq");
    assert.equal(body, undefined);
    assert.match(edit, /trop long pour Discord/);
  } finally {
    config.faq.questions[0].answer = old;
  }
});

test("/annonce : réservé aux administrateurs", async () => {
  const r = await send({ type: 2, member, channel_id: "1", data: { name: "annonce" } });
  assert.match(r.data.data.content, /administrateurs/);
});

test("/annonce : ouvre un formulaire Titre + Texte, sans texte d'exemple", async () => {
  const r = await send({ type: 2, member: admin, channel_id: "1", data: { name: "annonce" } });
  assert.equal(r.data.type, 9);
  const fields = r.data.data.components.map((c) => c.component);
  assert.deepEqual(r.data.data.components.map((c) => c.label), ["Titre", "Texte"]);
  assert.equal(fields[0].style, 1);
  assert.equal(fields[1].style, 2);
  assert.equal(fields[1].max_length, 4000);
  assert.ok(fields.every((f) => f.required && !f.placeholder && !f.value));
  assert.ok(r.data.data.custom_id.length <= 100);
  assert.equal(calls.length, 0);
});

test("/annonce : ping sur un rôle sans rôle choisi → erreur claire", async () => {
  const r = await send({ type: 2, member: admin, channel_id: "1", data: { name: "annonce", options: [{ name: "ping", type: 3, value: "role" }] } });
  assert.match(r.data.data.content, /option « role »/);
});

const submitAnnonce = (customId, titre, texte, who = admin) =>
  send({
    type: 5,
    member: who,
    channel_id: "1",
    data: {
      custom_id: customId,
      components: [
        { type: 18, id: 1, component: { type: 4, id: 2, custom_id: "titre", value: titre } },
        { type: 18, id: 3, component: { type: 4, id: 4, custom_id: "texte", value: texte } },
      ],
    },
  });

test("/annonce : options → formulaire → publication (bannière par défaut, sans ping)", async () => {
  const modal = await send({ type: 2, member: admin, channel_id: "1", data: { name: "annonce", options: [{ name: "salon", type: 7, value: "999000000000000000" }] } });
  calls = [];
  const r = await submitAnnonce(modal.data.data.custom_id, "Titre de test", "**Gras** et une liste :\n- un\n- deux");
  assert.equal(r.data.type, 5);
  const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/channels/999000000000000000/messages"));
  const body = JSON.parse(post.body);
  const e = assertLayout(body, "banniere-annonce", "Titre de test");
  assert.equal(e.description, "**Gras** et une liste :\n- un\n- deux");
  assert.equal(body.content, `${HOST}banniere-annonce-haut.gif?v=2`); // pas de ping : l'adresse seule
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  assert.match(JSON.parse(originalEdit().body).content, /<#999000000000000000>/);
});

test("/annonce : salon par défaut = salon actuel, image choisie, @everyone", async () => {
  const modal = await send({
    type: 2, member: admin, channel_id: "1",
    data: { name: "annonce", options: [{ name: "ping", type: 3, value: "everyone" }, { name: "image", type: 3, value: "outils" }] },
  });
  calls = [];
  await submitAnnonce(modal.data.data.custom_id, "T", "Texte");
  const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/channels/1/messages"));
  const body = JSON.parse(post.body);
  assert.equal(body.embeds[0].image, undefined);
  // Le ping est seul sur sa ligne, AVANT l'adresse de la bannière du haut
  assert.equal(body.content, `@everyone\n${HOST}banniere-outils-haut.gif?v=2`);
  assert.deepEqual(body.allowed_mentions, { parse: ["everyone"] });
  assert.match(JSON.parse(originalEdit().body).content, /Mentionner @everyone/);
});

test("/annonce : ping d'un rôle précis, image « aucune »", async () => {
  const modal = await send({
    type: 2, member: admin, channel_id: "1",
    data: { name: "annonce", options: [{ name: "ping", type: 3, value: "role" }, { name: "role", type: 8, value: "555000000000000000" }, { name: "image", type: 3, value: "aucune" }] },
  });
  calls = [];
  await submitAnnonce(modal.data.data.custom_id, "T", "Texte");
  const body = JSON.parse(calls.find((c) => c.method === "POST" && c.url.endsWith("/channels/1/messages")).body);
  assert.equal(body.content, "<@&555000000000000000>"); // image « aucune » : seulement le ping
  assert.deepEqual(body.allowed_mentions, { roles: ["555000000000000000"] });
  assert.equal(body.embeds[0].image, undefined);
});

test("/annonce : un rôle donné sans ping explicite est mentionné", async () => {
  const modal = await send({ type: 2, member: admin, channel_id: "1", data: { name: "annonce", options: [{ name: "role", type: 8, value: "555000000000000000" }] } });
  assert.match(modal.data.data.custom_id, /\|role\|555000000000000000\|/);
});

test("/annonce : formulaire envoyé par un non-administrateur ou vide → refusé", async () => {
  const id = "annonce|-|none|-|annonce";
  const refused = await submitAnnonce(id, "T", "x", member);
  assert.match(refused.data.data.content, /administrateurs/);
  assert.equal(calls.length, 0);
  await submitAnnonce(id, "   ", "x");
  assert.match(JSON.parse(originalEdit().body).content, /ne peuvent pas être vides/);
  assert.ok(!calls.some((c) => c.method === "POST" && c.url.endsWith("/messages")));
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

  // 1-2. Choisir une raison dans le menu crée directement le ticket
  const sel = await send({ type: 3, member, message: { flags: 0 }, data: { custom_id: "ticket:create", component_type: 3, values: ["acces"] } });
  assert.equal(sel.data.type, 7); // le menu est remis à zéro, l'encadré n'est pas touché
  assert.equal(sel.data.data.embeds, undefined);
  assert.equal(sel.data.data.components[0].components[0].custom_id, "ticket:create");
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
  const old = await send({ type: 3, member, message: { flags: V2 }, data: { custom_id: "ticket:category", component_type: 3, values: ["support"] } });
  assert.equal(old.data.type, 6); // ancien panneau : on n'y touche pas
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

// ── Position de la bannière : retour en arrière avec banner_position: "encadre" ──
test("banner_position « encadre » : tous les panneaux reprennent l'ancienne bannière dans l'encadré", () =>
  withPosition("encadre", () =>
    withQuestionsChannel(async () => {
      const names = { "panel-infos": "informations", "panel-reglement": "reglement", "panel-tickets": "tickets", "panel-formation": "formation", "panel-outils": "outils", "panel-faq": "faq", "panel-autopilot": "autopilot" };
      for (const [cmd, n] of Object.entries(names)) {
        const { body } = await publish(cmd);
        assert.equal(body.content, undefined, cmd);
        assert.equal(body.embeds[0].image.url, `${HOST}banniere-${n}.gif?v=2`, cmd);
      }
    }),
  ));

test("banner_position « encadre » : /annonce met la bannière dans l'encadré et le ping seul dans le contenu", () =>
  withPosition("encadre", async () => {
    const modal = await send({ type: 2, member: admin, channel_id: "1", data: { name: "annonce", options: [{ name: "ping", type: 3, value: "everyone" }] } });
    calls = [];
    await submitAnnonce(modal.data.data.custom_id, "T", "Texte");
    const body = JSON.parse(calls.find((c) => c.method === "POST" && c.url.endsWith("/channels/1/messages")).body);
    assert.equal(body.content, "@everyone");
    assert.equal(body.embeds[0].image.url, `${HOST}banniere-annonce.gif?v=2`);
  }));

test("banner_position « haut » : /panel-formation garde decouverte-formation.png dans l'encadré", async () => {
  const { body } = await publish("panel-formation");
  assert.equal(body.embeds[0].image, undefined);
  assert.equal(body.embeds[1].image.url, `${HOST}decouverte-formation.png?v=2`);
  assert.equal(body.content, `${HOST}banniere-formation-haut.gif?v=2`);
});

test("banner_position invalide → message clair, rien n'est publié", () =>
  withPosition("dessous", async () => {
    const { body, edit } = await publish("panel-faq");
    assert.equal(body, undefined);
    assert.match(edit, /« banner_position » doit valoir "haut" ou "encadre"/);
  }));

test("le menu des tickets est remis à zéro sans toucher au contenu (bannière du haut conservée)", async () => {
  const r = await send({ type: 3, member, message: { flags: 0 }, data: { custom_id: "ticket:create", component_type: 3, values: ["support"] } });
  assert.equal(r.data.type, 7);
  assert.equal(r.data.data.content, undefined); // seul le menu est renvoyé : le contenu et l'encadré restent
  assert.equal(r.data.data.embeds, undefined);
});
