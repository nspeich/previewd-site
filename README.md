# previewd — site vitrine

Site statique, sans build ni dépendance.

```
previewd-site/
├── index.html      structure et contenu
├── css/style.css   design tokens (clair/sombre) + composants
└── js/main.js      onglets tarifs, facturation annuelle, formulaire, animations
```

## Lancer en local
    python3 -m http.server 8080   # puis http://localhost:8080

## À brancher
- Formulaire de contact : remplacer le `submit` simulé dans `js/main.js` par un appel à votre API.
- Paiement des plans Pro/Agence : Stripe Checkout.
- Polices : Fraunces et Inter via Google Fonts (à auto-héberger en production si besoin de souveraineté stricte).
# previewd-site
