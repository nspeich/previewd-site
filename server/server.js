#!/usr/bin/env node
/**
 * Preview-d — serveur du site et du paiement
 * =========================================================================
 * Rôle : servir les pages du site et créer les sessions Stripe Checkout.
 *
 * Principes (les mêmes que le produit qu'il accompagne) :
 *   - aucune dépendance npm : uniquement la bibliothèque standard Node ;
 *   - la clé secrète Stripe ne quitte jamais ce processus, elle n'est jamais
 *     envoyée au navigateur, jamais journalisée ;
 *   - le montant facturé est décidé ici, jamais par le client : un plan inconnu
 *     ou non payant est refusé, sans repli silencieux ;
 *   - le webhook est authentifié par signature et comparé à temps constant.
 *
 * Ce que ce serveur n'est PAS : un système de comptes. Il ne crée pas
 * d'utilisateur et ne provisionne pas d'environnement. Voir README.md.
 * =========================================================================
 */

import { createServer } from "node:http";
import { readFile, stat, appendFile, mkdir } from "node:fs/promises";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { extname, join, resolve, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/* -------------------------------------------------------------------------
   0. Fichier .env (chargement minimal, sans dépendance)
   Les variables déjà présentes dans l'environnement ont priorité.
   ------------------------------------------------------------------------- */
async function loadEnvFile() {
  let raw;
  try {
    raw = await readFile(join(HERE, ".env"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && !(key in process.env)) process.env[key] = value;
  }
}

await loadEnvFile();

/* -------------------------------------------------------------------------
   1. Configuration
   ------------------------------------------------------------------------- */
const SITE_DIR = resolve(HERE, "..");

// Un port vide, « 0 » ou non numérique ne doit pas produire une écoute sur un
// port aléatoire : on retombe explicitement sur 8787.
const PORT_RAW = Number.parseInt(process.env.PORT ?? "", 10);
const PORT = Number.isInteger(PORT_RAW) && PORT_RAW > 0 && PORT_RAW < 65536 ? PORT_RAW : 8787;
const HOST = process.env.HOST || "127.0.0.1";
const CURRENCY = (process.env.CURRENCY || "eur").toLowerCase();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const STRIPE_API_BASE = (process.env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/+$/, "");

// Origine utilisée pour les URL de retour. Volontairement pas déduite de
// l'en-tête Host : un Host forgé ne doit pas pouvoir détourner la redirection.
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");

const WEBHOOK_TOLERANCE_SECONDS = 300;
const MAX_JSON_BODY = 4 * 1024;
const MAX_WEBHOOK_BODY = 1024 * 1024;
const CHECKOUT_RATE_LIMIT = 10; // par fenêtre et par adresse
const CHECKOUT_RATE_WINDOW_MS = 60_000;

/* Catalogue. Les montants sont en centimes et font foi : le client envoie un
   identifiant de plan, jamais un prix. */
const PLANS = {
  hobby: {
    id: "hobby",
    label: "Hobby",
    amount: 0,
    interval: "month",
    purchasable: false,
    description: "Jusqu'à 3 environnements actifs, TTL de 24 heures.",
  },
  pro: {
    id: "pro",
    label: "Pro",
    amount: 1900,
    interval: "month",
    purchasable: true,
    description:
      "Prévisualisations illimitées, domaines personnalisés, sidecars, logs de build. TTL 7 jours.",
  },
  agence: {
    id: "agence",
    label: "Agence",
    amount: 7900,
    interval: "month",
    purchasable: true,
    description:
      "Tout le plan Pro, liens de revue protégés pour vos clients, espaces séparés par projet.",
  },
};

const stripeConfigured = () => Boolean(STRIPE_SECRET_KEY);
const stripeMode = () => {
  if (!STRIPE_SECRET_KEY) return "non configuré";
  if (STRIPE_SECRET_KEY.startsWith("sk_live_")) return "LIVE — prélèvements réels";
  if (STRIPE_SECRET_KEY.startsWith("sk_test_")) return "test (aucun prélèvement réel)";
  return "clé non reconnue";
};

/* -------------------------------------------------------------------------
   2. Petites aides HTTP
   ------------------------------------------------------------------------- */
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; " +
    "connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function readBody(req, limit) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Corps de requête trop volumineux"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolvePromise(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/* Limitation simple : N requêtes par fenêtre et par adresse. */
const rateBuckets = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const bucket = (rateBuckets.get(ip) || []).filter((t) => now - t < CHECKOUT_RATE_WINDOW_MS);

  if (bucket.length >= CHECKOUT_RATE_LIMIT) {
    rateBuckets.set(ip, bucket);
    return true;
  }

  bucket.push(now);
  rateBuckets.set(ip, bucket);
  return false;
}

// Purge périodique pour que la table ne grossisse pas indéfiniment.
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of rateBuckets) {
    const kept = times.filter((t) => now - t < CHECKOUT_RATE_WINDOW_MS);
    if (kept.length === 0) rateBuckets.delete(ip);
    else rateBuckets.set(ip, kept);
  }
}, CHECKOUT_RATE_WINDOW_MS).unref();

/* -------------------------------------------------------------------------
   3. Appels Stripe
   ------------------------------------------------------------------------- */
async function stripeRequest(path, { method = "GET", body, idempotencyKey } = {}) {
  const headers = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(15_000),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(
      (data && data.error && data.error.message) || `Stripe a répondu ${response.status}`
    );
    error.status = response.status;
    error.stripeType = data && data.error ? data.error.type : undefined;
    throw error;
  }

  return data;
}

async function createCheckoutSession(plan) {
  const params = new URLSearchParams();

  params.set("mode", "subscription");
  params.set("success_url", `${PUBLIC_BASE_URL}/pages/succes.html?session_id={CHECKOUT_SESSION_ID}`);
  params.set("cancel_url", `${PUBLIC_BASE_URL}/pages/annulation.html?plan=${plan.id}`);

  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", CURRENCY);
  params.set("line_items[0][price_data][unit_amount]", String(plan.amount));
  params.set("line_items[0][price_data][recurring][interval]", plan.interval);
  params.set(
    "line_items[0][price_data][product_data][name]",
    `Preview-d Cloud — ${plan.label}`
  );
  params.set("line_items[0][price_data][product_data][description]", plan.description);

  params.set("allow_promotion_codes", "true");
  params.set("billing_address_collection", "required");
  params.set("locale", "fr");
  params.set("metadata[plan]", plan.id);
  params.set("subscription_data[metadata][plan]", plan.id);
  params.set("client_reference_id", randomUUID());

  return stripeRequest("/v1/checkout/sessions", {
    method: "POST",
    body: params.toString(),
    // Un clic double ne doit pas produire deux abonnements.
    idempotencyKey: randomUUID(),
  });
}

function formatAmount(amountInCents) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: CURRENCY.toUpperCase(),
  }).format(amountInCents / 100);
}

/* -------------------------------------------------------------------------
   4. Vérification de la signature Stripe
   Format d'en-tête : t=<horodatage>,v1=<hex>,v1=<hex>…
   La signature porte sur "<t>.<corps brut>".
   ------------------------------------------------------------------------- */
export function verifyStripeSignature(payload, header, secret, tolerance = WEBHOOK_TOLERANCE_SECONDS) {
  if (!header || !secret) return false;

  let timestamp = null;
  const signatures = [];

  for (const part of header.split(",")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);

    if (key === "t") timestamp = Number(value);
    else if (key === "v1") signatures.push(value);
  }

  if (!timestamp || !Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > tolerance) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest();

  return signatures.some((signature) => {
    let given;
    try {
      given = Buffer.from(signature, "hex");
    } catch {
      return false;
    }
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/* Journal minimal des événements de facturation. Aucune donnée de carte,
   aucun nom, aucune adresse : uniquement des identifiants Stripe. */
const EVENTS_DIR = join(HERE, "data");
const EVENTS_FILE = join(EVENTS_DIR, "events.jsonl");

async function recordBillingEvent(event) {
  await mkdir(EVENTS_DIR, { recursive: true, mode: 0o700 });

  const object = (event.data && event.data.object) || {};
  const objectType = object.object || "";

  const entry = {
    at: new Date().toISOString(),
    type: event.type,
    event_id: event.id,
    plan: (object.metadata && object.metadata.plan) || null,
    // Une session de paiement n'est pas un abonnement : on ne confond pas
    // les deux identifiants dans le journal.
    session_id: objectType === "checkout.session" ? object.id || null : null,
    subscription_id:
      typeof object.subscription === "string"
        ? object.subscription
        : objectType === "subscription"
          ? object.id || null
          : null,
    amount_total: typeof object.amount_total === "number" ? object.amount_total : null,
    currency: object.currency || null,
  };

  await appendFile(EVENTS_FILE, JSON.stringify(entry) + "\n", { mode: 0o600 });
}

/* -------------------------------------------------------------------------
   5. Fichiers statiques
   ------------------------------------------------------------------------- */
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

const NOT_FOUND_PAGE = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Page introuvable — Preview-d</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{background:#07080a;color:#e8ecf1;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center}
a{color:#5eead4}code{font-family:ui-monospace,monospace;color:#8e99a8}</style></head>
<body><main><h1>404</h1><p>Cette page n'existe pas.</p>
<p><a href="/">Retour à l'accueil</a></p></main></body></html>`;

const LEGACY_PAGE_REDIRECTS = new Set(["/paiement.html", "/succes.html", "/annulation.html"]);

async function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { ...SECURITY_HEADERS, Allow: "GET, HEAD" });
    res.end();
    return;
  }

  if (pathname === "/") pathname = "/index.html";
  if (pathname.includes("\0")) return sendText(res, 400, "Requête invalide");

  const target = resolve(SITE_DIR, "." + pathname);

  // Un seul répertoire autorisé, et rien en dehors de sa racine.
  if (target !== SITE_DIR && !target.startsWith(SITE_DIR + sep)) {
    return sendText(res, 403, "Accès refusé");
  }

  const relative = target.slice(SITE_DIR.length).replace(/^[\\/]/, "");
  const segments = relative.split(/[\\/]/).filter(Boolean);

  // Jamais de fichier caché, jamais le dossier du serveur (il contient .env).
  if (segments.some((segment) => segment.startsWith("."))) {
    return sendText(res, 403, "Accès refusé");
  }
  if (segments[0] === "server" || segments[0] === "node_modules") {
    return sendText(res, 403, "Accès refusé");
  }

  let info;
  try {
    info = await stat(target);
  } catch {
    res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8" });
    res.end(NOT_FOUND_PAGE);
    return;
  }

  // Pas de listage de répertoire.
  if (!info.isFile()) {
    res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8" });
    res.end(NOT_FOUND_PAGE);
    return;
  }

  const extension = extname(target).toLowerCase();
  const contentType = MIME_TYPES[extension] || "application/octet-stream";
  const isHTML = extension === ".html";

  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "Content-Type": contentType,
    "Content-Length": info.size,
    "Cache-Control": isHTML ? "no-store" : "public, max-age=300",
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  const content = await readFile(target);
  res.end(content);
}

/* -------------------------------------------------------------------------
   6. Routes
   ------------------------------------------------------------------------- */
async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  const ip = req.socket.remoteAddress || "inconnue";

  if (pathname === "/api/health") {
    return sendJSON(res, 200, {
      ok: true,
      stripe: stripeConfigured(),
      webhook: Boolean(STRIPE_WEBHOOK_SECRET),
      currency: CURRENCY,
    });
  }

  if (pathname === "/api/checkout") {
    if (req.method !== "POST") return sendJSON(res, 405, { error: "method_not_allowed" });
    if (rateLimited(ip)) {
      return sendJSON(res, 429, {
        error: "rate_limited",
        message: "Trop de tentatives. Patientez une minute avant de réessayer.",
      });
    }

    let plan;
    try {
      const raw = await readBody(req, MAX_JSON_BODY);
      const parsed = JSON.parse(raw.toString("utf8") || "{}");
      plan = typeof parsed.plan === "string" ? parsed.plan.toLowerCase() : "";
    } catch (error) {
      const status = error.status || 400;
      return sendJSON(res, status, {
        error: status === 413 ? "payload_too_large" : "invalid_json",
        message: "Requête invalide.",
      });
    }

    if (!Object.prototype.hasOwnProperty.call(PLANS, plan)) {
      return sendJSON(res, 400, { error: "unknown_plan", message: "Formule inconnue." });
    }

    const selected = PLANS[plan];

    if (!selected.purchasable) {
      return sendJSON(res, 400, {
        error: "plan_not_purchasable",
        message: "Cette formule est gratuite : aucun paiement n'est nécessaire.",
      });
    }

    if (!stripeConfigured()) {
      return sendJSON(res, 503, {
        error: "stripe_not_configured",
        message:
          "Stripe n'est pas configuré sur ce serveur (STRIPE_SECRET_KEY absent). " +
          "Le paiement est volontairement désactivé plutôt que simulé.",
      });
    }

    try {
      const session = await createCheckoutSession(selected);
      if (!session || !session.url) throw new Error("Session sans URL de paiement");
      return sendJSON(res, 200, { url: session.url, id: session.id });
    } catch (error) {
      console.error("[checkout] échec :", error.message);
      return sendJSON(res, 502, {
        error: "stripe_error",
        message:
          "Le paiement n'a pas pu être ouvert. Réessayez dans un instant ; si le problème " +
          "persiste, écrivez-nous.",
      });
    }
  }

  if (pathname === "/api/session") {
    if (req.method !== "GET") return sendJSON(res, 405, { error: "method_not_allowed" });

    const id = url.searchParams.get("id") || "";
    if (!/^cs_[A-Za-z0-9_]{8,200}$/.test(id)) {
      return sendJSON(res, 400, { error: "invalid_session_id" });
    }
    if (!stripeConfigured()) {
      return sendJSON(res, 503, { error: "stripe_not_configured" });
    }

    try {
      const session = await stripeRequest(`/v1/checkout/sessions/${encodeURIComponent(id)}`);
      const planId = (session.metadata && session.metadata.plan) || "";

      return sendJSON(res, 200, {
        id: session.id,
        status: session.payment_status || session.status,
        plan: planId || null,
        plan_label: PLANS[planId] ? PLANS[planId].label : null,
        amount: typeof session.amount_total === "number" ? session.amount_total : null,
        currency: session.currency || CURRENCY,
        interval: session.subscription ? "month" : null,
        email: (session.customer_details && session.customer_details.email) || null,
      });
    } catch (error) {
      console.error("[session] échec :", error.message);
      return sendJSON(res, 502, { error: "stripe_error" });
    }
  }

  if (pathname === "/api/webhook") {
    if (req.method !== "POST") return sendJSON(res, 405, { error: "method_not_allowed" });

    if (!STRIPE_WEBHOOK_SECRET) {
      return sendJSON(res, 503, { error: "webhook_not_configured" });
    }

    let raw;
    try {
      raw = await readBody(req, MAX_WEBHOOK_BODY);
    } catch (error) {
      return sendJSON(res, error.status || 400, { error: "invalid_body" });
    }

    const payload = raw.toString("utf8");
    const signature = req.headers["stripe-signature"];

    if (!verifyStripeSignature(payload, signature, STRIPE_WEBHOOK_SECRET)) {
      return sendJSON(res, 400, { error: "invalid_signature" });
    }

    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      return sendJSON(res, 400, { error: "invalid_json" });
    }

    try {
      await recordBillingEvent(event);
    } catch (error) {
      console.error("[webhook] écriture impossible :", error.message);
      return sendJSON(res, 500, { error: "storage_error" });
    }

    console.log(`[webhook] ${event.type} reçu et vérifié`);
    return sendJSON(res, 200, { received: true });
  }

  // Les pages ont déménagé dans pages/ : on garde les anciens liens valables.
  if (LEGACY_PAGE_REDIRECTS.has(pathname)) {
    res.writeHead(301, {
      ...SECURITY_HEADERS,
      Location: `/pages${pathname}${url.search}`,
      "Content-Length": 0,
    });
    res.end();
    return;
  }

  // Tout le reste : fichiers statiques.
  return serveStatic(req, res, pathname);
}

/* -------------------------------------------------------------------------
   7. Démarrage
   ------------------------------------------------------------------------- */
const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error("[serveur] erreur non gérée :", error.message);
    if (!res.headersSent) {
      sendJSON(res, 500, { error: "internal_error" });
    } else {
      res.end();
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("  Preview-d — site et paiement");
  console.log(`  adresse      : http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`  origine Stripe : ${PUBLIC_BASE_URL}`);
  console.log(`  Stripe       : ${stripeMode()}`);
  console.log(`  webhook      : ${STRIPE_WEBHOOK_SECRET ? "configuré" : "non configuré"}`);
  console.log("");

  if (STRIPE_SECRET_KEY.startsWith("sk_live_")) {
    console.log("  ATTENTION : clé live détectée. Les paiements seront réels.");
    console.log("");
  }
  if (!stripeConfigured()) {
    console.log("  Paiement désactivé : renseignez STRIPE_SECRET_KEY dans server/.env");
    console.log("  (clé de test : https://dashboard.stripe.com/test/apikeys)");
    console.log("");
  }
});

function shutdown(signal) {
  console.log(`\n[serveur] ${signal} reçu, arrêt propre.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
