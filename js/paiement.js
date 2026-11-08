/* ==========================================================================
   previewd — paiement
   Deux responsabilités :
     1. afficher la bonne offre et ouvrir une session Stripe Checkout ;
     2. au retour de Stripe, re-vérifier la session côté serveur avant de
        prétendre que le paiement a réussi.
   Aucune clé n'est présente ici : la clé secrète reste sur le serveur.
   ========================================================================== */

(function () {
  "use strict";

  /* --- Offres (affichage uniquement ; les montants font foi côté serveur) - */
  var PLANS = {
    hobby: {
      name: "Plan Hobby",
      price: "0 €",
      per: "/ mois",
      vat: "Aucune carte demandée",
      free: true,
      cta: "Demander l'accès gratuit",
      features: [
        "Jusqu'à 3 environnements actifs",
        "TTL court : 24 heures",
        "Sous-domaine fourni",
        "Une personne, un projet",
        "Support communautaire",
      ],
      mailto:
        "mailto:contact@previewd.example" +
        "?subject=" +
        encodeURIComponent("Activation du plan Hobby previewd"),
    },
    pro: {
      name: "Plan Pro",
      price: "19 €",
      per: "/ mois",
      vat: "Hors taxes · TVA ajoutée au paiement",
      free: false,
      cta: "Payer 19 € par mois",
      features: [
        "Prévisualisations illimitées",
        "Domaines personnalisés",
        "Sidecars compose pris en charge",
        "Logs de build dans le navigateur",
        "TTL de 7 jours, reconstruit à chaque poussée",
      ],
    },
    agence: {
      name: "Plan Agence",
      price: "79 €",
      per: "/ mois",
      vat: "Hors taxes · TVA ajoutée au paiement",
      free: false,
      cta: "Payer 79 € par mois",
      features: [
        "Tout le plan Pro, pour toute l'équipe",
        "Liens de revue protégés par mot de passe",
        "Validation client sans créer de compte",
        "Espaces séparés par projet ou par client",
        "Support prioritaire",
      ],
    },
  };

  function param(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function showError(element, message) {
    if (!element) return;
    element.textContent = message;
    element.hidden = false;
  }

  /* ---------------------------------------------------------------------
     A. Page de paiement
     --------------------------------------------------------------------- */
  var payButton = document.getElementById("pay-btn");

  if (payButton) {
    var key = (param("plan") || "pro").toLowerCase();
    var plan = PLANS[key] || PLANS.pro;
    if (!PLANS[key]) key = "pro";

    var nameEl = document.getElementById("plan-name");
    var priceEl = document.getElementById("plan-price");
    var perEl = document.getElementById("plan-per");
    var vatEl = document.getElementById("plan-vat");
    var listEl = document.getElementById("plan-features");
    var errorEl = document.getElementById("pay-error");

    if (nameEl) nameEl.textContent = plan.name;
    if (priceEl) priceEl.textContent = plan.price;
    if (perEl) perEl.textContent = plan.per;
    if (vatEl) vatEl.textContent = plan.vat;
    if (listEl) {
      listEl.innerHTML = "";
      plan.features.forEach(function (feature) {
        var li = document.createElement("li");
        li.textContent = feature;
        listEl.appendChild(li);
      });
    }
    payButton.textContent = plan.cta;

    // Le plan gratuit n'appelle pas Stripe : il n'y a rien à encaisser.
    var freePlan = plan.free;

    payButton.addEventListener("click", function () {
      if (freePlan) {
        window.location.href = plan.mailto;
        return;
      }

      if (window.location.protocol === "file:") {
        showError(
          errorEl,
          "Cette page doit être servie par le petit serveur du site (le paiement ne peut pas " +
            "être créé sans lui). Lancez « npm start » dans le dossier server, puis ouvrez " +
            "http://localhost:8787/paiement.html?plan=" +
            key +
            "."
        );
        return;
      }

      var label = payButton.textContent;
      payButton.disabled = true;
      payButton.textContent = "Ouverture du paiement…";
      if (errorEl) errorEl.hidden = true;

      fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: key }),
      })
        .then(function (response) {
          return response.json().then(function (data) {
            return { ok: response.ok, status: response.status, data: data };
          });
        })
        .then(function (result) {
          if (result.ok && result.data && result.data.url) {
            window.location.href = result.data.url;
            return;
          }

          var message = "Le paiement n'a pas pu être ouvert.";
          if (result.data && result.data.message) {
            message = result.data.message;
          }
          if (result.status === 503) {
            message =
              "Stripe n'est pas encore configuré sur ce serveur : renseignez STRIPE_SECRET_KEY " +
              "dans server/.env (clé de test fournie par Stripe), puis redémarrez le serveur.";
          }

          showError(errorEl, message);
          payButton.disabled = false;
          payButton.textContent = label;
        })
        .catch(function () {
          showError(
            errorEl,
            "Impossible de joindre le serveur de paiement. Vérifiez qu'il est démarré, puis réessayez."
          );
          payButton.disabled = false;
          payButton.textContent = label;
        });
    });
  }

  /* ---------------------------------------------------------------------
     B. Page de retour : on ne se contente pas de « merci », on vérifie
     --------------------------------------------------------------------- */
  var statusCard = document.getElementById("status-card");

  if (statusCard) {
    var sessionId = param("session_id");
    var titleEl = document.getElementById("status-title");
    var textEl = document.getElementById("status-text");

    if (!sessionId) {
      if (textEl) {
        textEl.textContent =
          "Cette page s'affiche après un paiement. Aucune session n'est indiquée : si vous " +
          "venez de payer, retrouvez votre abonnement dans le courriel de confirmation de Stripe.";
      }
      return;
    }

    fetch("/api/session?id=" + encodeURIComponent(sessionId))
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.data) {
          if (textEl) {
            textEl.textContent =
              "Le paiement a bien été transmis à Stripe, mais nous n'avons pas pu vérifier la " +
              "session depuis ce navigateur. Gardez le courriel de confirmation : il fait foi.";
          }
          return;
        }

        var session = result.data;
        var paid = session.status === "paid" || session.status === "no_payment_required";

        if (titleEl) {
          titleEl.textContent = paid ? "C'est parti." : "Paiement en cours de confirmation.";
        }
        if (textEl) {
          textEl.textContent = paid
            ? "Votre abonnement est actif. Vous allez recevoir les instructions pour relier " +
              "votre première forge et lancer votre premier aperçu."
            : "Stripe n'a pas encore confirmé le paiement (certains moyens de paiement prennent " +
              "quelques minutes). Actualisez cette page dans un instant.";
        }

        statusCard.hidden = false;

        var setText = function (id, value) {
          var el = document.getElementById(id);
          if (el) el.textContent = value;
        };

        setText("status-plan", session.plan_label || session.plan || "—");

        if (typeof session.amount === "number") {
          setText(
            "status-amount",
            (session.amount / 100).toFixed(2).replace(".", ",") +
              " €" +
              (session.interval === "month" ? " / mois" : "")
          );
        }

        setText("status-email", session.email || "—");
        setText(
          "status-state",
          paid ? "Payé" : session.status === "unpaid" ? "En attente" : session.status || "—"
        );
      })
      .catch(function () {
        if (textEl) {
          textEl.textContent =
            "Le paiement a été transmis à Stripe. La vérification locale est indisponible " +
            "(serveur arrêté) ; le courriel de confirmation de Stripe fait foi.";
        }
      });
  }
})();
