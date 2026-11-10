# Previewd — site de vente

Site statique et tunnel de paiement pour **Previewd**, l'agent d'environnements de
prévisualisation souverains.

## Structure

```text
Previewd_site/
├── index.html            page de vente (hero avec bandeau tarifaire, onglets
│                         problème / fonctionnement / preuves / pour qui,
│                         déploiement, tarifs mis en avant, FAQ)
├── pages/
│   ├── paiement.html     récapitulatif d'abonnement + ouverture de Stripe Checkout
│   ├── succes.html       retour après paiement, avec vérification de la session
│   └── annulation.html   retour après abandon
├── css/
│   └── style.css         feuille de style unique (thème sombre, responsive)
├── js/
│   ├── i18n.js           moteur de traduction (dictionnaire, sélecteur, mémoire)
│   ├── main.js           navigation, apparitions, onglets, FAQ, formulaire
│   └── paiement.js       sélection du plan, appel serveur, vérification au retour
├── json/
│   └── translate.json    dictionnaire fr / en / es (source unique des textes)
└── server/
    ├── server.js         serveur HTTP sans dépendance (statique + Stripe)
    ├── package.json      scripts npm, aucune dépendance
    ├── .env.example      modèle de configuration
    └── .gitignore        protège .env et data/
```

Aucune ressource externe n'est chargée : ni police, ni CDN, ni script tiers. Seul
le paiement a besoin du serveur, donc d'un accès à Stripe.

## Langues (i18n)

Le site existe en **français, anglais et espagnol**. Le sélecteur se trouve dans
l'en-tête de chaque page et le choix est mémorisé (`localStorage`, clé
`Previewd.lang`) ; il survit d'une page à l'autre et d'une visite à l'autre.

- Les textes vivent dans [`json/translate.json`](json/translate.json), sous trois
  objets de clés identiques (`fr`, `en`, `es`). C'est la source unique.
- Le HTML porte les attributs `data-i18n`, `data-i18n-content`,
  `data-i18n-aria-label` et `data-i18n-placeholder` ; le texte français reste
  dans la page et sert de repli si le dictionnaire n'est pas chargé.
- `js/i18n.js` expose `i18n.t(clé, variables?)` et rediffuse l'événement
  `Previewd:lang` ; les textes produits par les scripts (bouton « Copier »,
  formulaire, page de retour Stripe) se retraduisent donc en direct.
- Les prix suivent la langue : euro en français, dollar américain en anglais
  et en espagnol (`19 €` / `$19`). Le navigateur envoie aussi la devise au
  serveur, qui facture le montant correspondant dans Stripe.

**Une limite à connaître** : le dictionnaire est chargé en `fetch`. Ouvert en
`file://` (double-clic sur `index.html`), le navigateur refuse cette lecture —
la page reste alors en français et le sélecteur est masqué. Servez le site
(`npm start` dans `server/`) pour disposer des trois langues.

### Ajouter une langue

1. Copier un bloc de langue dans `json/translate.json` (même liste de clés),
   puis l'ajouter à `meta.languages`.
2. Ajouter la correspondance de format dans `INTL_LOCALES` (`js/paiement.js`)
   pour les montants.
3. C'est tout : le sélecteur se construit à partir du dictionnaire.

## Lancer le site

Le site fonctionne en double-cliquant `index.html`, mais **le paiement exige le
serveur** : une session Stripe doit être créée côté serveur, avec la clé secrète.

```bash
cd Previewd_site/server
npm start          # http://localhost:8787
```

Node.js 20 ou plus est requis. Aucun `npm install` n'est nécessaire : il n'y a
pas une seule dépendance.

## Configurer Stripe (mode test)

1. Créez un compte sur [stripe.com](https://stripe.com) et activez le **mode test**.
2. Tableau de bord → Développeurs → Clés API : copiez la **clé secrète** `sk_test_…`.
3. `cp .env.example .env`, puis renseignez `STRIPE_SECRET_KEY`.
4. Redémarrez le serveur : la bannière indique `test (aucun prélèvement réel)`.
5. Ouvrez `http://localhost:8787/pages/paiement.html?plan=pro` et payez avec la carte
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
  └─ « Choisir Pro » → pages/paiement.html?plan=pro
       └─ POST /api/checkout  { "plan": "pro" }
            └─ serveur → POST https://api.stripe.com/v1/checkout/sessions
                 └─ redirection vers Stripe Checkout (page hébergée)
                      ├─ succès    → pages/succes.html?session_id=cs_...
                      │                └─ GET /api/session?id=… (vérification)
                      └─ abandon   → pages/annulation.html
```

Les anciennes adresses (`/paiement.html`, `/succes.html`, `/annulation.html`)
redirigent en 301 vers `pages/`, pour ne pas casser les liens déjà diffusés.

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
- i18n : 389 clés, parité stricte entre `fr`, `en` et `es` (aucune clé manquante
  ni vide) ; toutes les clés `data-i18n` du HTML existent dans les trois
  langues ; bascule vérifiée dans le navigateur, y compris après rechargement
  (mémoire du choix) et sur les pages de paiement (`79 €` en français, `$79` en
  anglais et en espagnol).
- Serveur lancé sans clé : `/api/checkout` répond 503 avec un message explicite
  (le paiement est désactivé, jamais simulé).
- Accès direct à `/server/.env`, `/server/server.js` et aux fichiers cachés : 403.
- Signature de webhook : rejet d'un en-tête absent, malformé, trop ancien ou
  incorrect ; acceptation d'une signature valide.
- Parcours complet testé contre un faux Stripe local (`STRIPE_API_BASE`) :
  création de session, redirection, vérification au retour.

*Les tarifs, montants et mentions légales restent des valeurs de démonstration,
à valider avant toute vente réelle.*

## Contact

Le formulaire de la page de vente compose un courriel destiné à
`previewd@previewd.dev` (aucun serveur n'est sollicité : le message s'ouvre dans
le logiciel de messagerie du visiteur). Un bouton WhatsApp ouvre la conversation
avec le `+33 6 65 11 03 38` (`https://wa.me/33665110338`).

Les feuilles de style et les scripts sont appelés avec un paramètre de version
(`css/style.css?v=20261111`) : sans lui, l'hébergeur sert l'ancien fichier
pendant plusieurs heures après un déploiement et la page apparaît à moitié
stylée. À incrémenter à chaque modification de `style.css`, `main.js`,
`i18n.js` ou `paiement.js`.
# Previewd-site
