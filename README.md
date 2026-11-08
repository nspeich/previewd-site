# previewd — site de vente

Site statique et tunnel de paiement pour **previewd**, l'agent d'environnements de
prévisualisation souverains.

## Structure

```text
previewd_site/
├── index.html          page de vente (hero, fonctionnement, preuves, tarifs, FAQ)
├── paiement.html       récapitulatif d'abonnement + ouverture de Stripe Checkout
├── succes.html         retour après paiement, avec vérification de la session
├── annulation.html     retour après abandon
├── css/
│   └── style.css       feuille de style unique (thème sombre, responsive)
├── js/
│   ├── main.js         navigation, apparitions, onglets, FAQ, formulaire
│   └── paiement.js     sélection du plan, appel serveur, vérification au retour
└── server/
    ├── server.js       serveur HTTP sans dépendance (statique + Stripe)
    ├── package.json    scripts npm, aucune dépendance
    ├── .env.example    modèle de configuration
    └── .gitignore      protège .env et data/
```

Aucune ressource externe n'est chargée : le site s'ouvre et s'affiche même sans
Internet. Seul le paiement a besoin du serveur, donc d'un accès à Stripe.

## Lancer le site

Le site fonctionne en double-cliquant `index.html`, mais **le paiement exige le
serveur** : une session Stripe doit être créée côté serveur, avec la clé secrète.

```bash
cd previewd_site/server
npm start          # http://localhost:8787
```

Node.js 20 ou plus est requis. Aucun `npm install` n'est nécessaire : il n'y a
pas une seule dépendance.

## Configurer Stripe (mode test)

1. Créez un compte sur [stripe.com](https://stripe.com) et activez le **mode test**.
2. Tableau de bord → Développeurs → Clés API : copiez la **clé secrète** `sk_test_…`.
3. `cp .env.example .env`, puis renseignez `STRIPE_SECRET_KEY`.
4. Redémarrez le serveur : la bannière indique `test (aucun prélèvement réel)`.
5. Ouvrez `http://localhost:8787/paiement.html?plan=pro` et payez avec la carte
   de test `4242 4242 4242 4242`, une date future quelconque, un CVC à 3 chiffres.

Autres cartes utiles : `4000 0025 0000 3155` (3D Secure requis),
`4000 0000 0000 9995` (refus pour fonds insuffisants).

### Webhook

Le serveur écoute `POST /api/webhook`. Sans ce secret, les paiements aboutissent
mais rien n'est journalisé.

En local :

```bash
stripe listen --forward-to localhost:8787/api/webhook
# recopiez le whsec_... affiché dans STRIPE_WEBHOOK_SECRET, puis redémarrez
```

En production, ajoutez l'endpoint `https://votre-domaine.tld/api/webhook` dans le
tableau de bord Stripe, avec au moins les événements
`checkout.session.completed`, `customer.subscription.updated` et
`customer.subscription.deleted`.

## Parcours de paiement

```text
index.html#tarifs
  └─ « Choisir Pro » → paiement.html?plan=pro
       └─ POST /api/checkout  { "plan": "pro" }
            └─ serveur → POST https://api.stripe.com/v1/checkout/sessions
                 └─ redirection vers Stripe Checkout (page hébergée)
                      ├─ succès    → succes.html?session_id=cs_...
                      │                └─ GET /api/session?id=… (vérification)
                      └─ abandon   → annulation.html
```

Le montant n'est **jamais** transmis par le navigateur : il envoie un identifiant
de formule (`pro`, `agence`), et le serveur applique le tarif du catalogue. Un
plan inconnu, gratuit ou absent est refusé.

## Ce que le serveur ne fait pas

C'est un tunnel de paiement de démonstration, pas une plateforme d'abonnement
complète. Il manque, volontairement à ce stade :

- **les comptes** : aucun utilisateur n'est créé, aucun espace n'est provisionné ;
  le webhook journalise l'événement, il n'ouvre pas d'accès ;
- **le portail client** : Stripe Billing en fournit un, il n'est pas branché ici ;
- **la TVA** : Stripe Tax n'est pas activé ; les prix sont affichés hors taxes ;
- **la persistance** : `server/data/events.jsonl` est un journal d'exploitation,
  pas une base d'abonnements. Il ne doit pas servir de source de vérité ;
- **la haute disponibilité** : un seul processus, une limitation de débit en
  mémoire, pas de file d'attente.

## Mise en production — minimum vital

- Servir le site derrière un reverse proxy TLS (Caddy, nginx, Traefik).
- Renseigner `PUBLIC_BASE_URL` avec l'origine publique **exacte** : les URL de
  retour de Stripe en dépendent.
- Garder `HOST=127.0.0.1` si le proxy est sur la même machine.
- Ne jamais exposer `server/` ni `.env` : le serveur les refuse déjà, le proxy
  doit faire de même.
- Passer en clé `sk_live_` seulement après un parcours complet en mode test.
- Vérifier que `server/data/` est bien ignoré par Git et sauvegardé séparément.
- Activer le portail client Stripe et la collecte de TVA avant la première vente.

## Vérifications faites

- Pages HTML : balises équilibrées, aucune ressource externe.
- Serveur lancé sans clé : `/api/checkout` répond 503 avec un message explicite
  (le paiement est désactivé, jamais simulé).
- Accès direct à `/server/.env`, `/server/server.js` et aux fichiers cachés : 403.
- Signature de webhook : rejet d'un en-tête absent, malformé, trop ancien ou
  incorrect ; acceptation d'une signature valide.
- Parcours complet testé contre un faux Stripe local (`STRIPE_API_BASE`) :
  création de session, redirection, vérification au retour.

*Les identifiants de démonstration (`contact@previewd.example`, montants,
mentions légales) sont à remplacer avant toute mise en ligne réelle.*
# previewd-site
