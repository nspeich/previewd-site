/* ==========================================================================
   previewd — paiement
   Deux responsabilités :
     1. afficher la bonne offre et ouvrir une session Stripe Checkout ;
     2. au retour de Stripe, re-vérifier la session côté serveur avant de
        prétendre que le paiement a réussi.
   Aucune clé n'est présente ici : la clé secrète reste sur le serveur.
   --------------------------------------------------------------------------
   Les libellés viennent de json/translate.json via i18n.js. Si le dictionnaire
   n'a pas pu être chargé, les valeurs françaises passées en second argument
   servent de repli.
   ========================================================================== */

(function () {
  "use strict";

  var INTL_LOCALES = { fr: "fr-FR", en: "en-IE", es: "es-ES" };

  /* --- Offres : seuls les faits commerciaux vivent ici. ----------------- */
  /* Les montants qui font foi sont définis côté serveur (server/server.js). */
  var PLANS = {
    hobby: { free: true },
    pro: { free: false },
    agence: { free: false },
  };

  function lang() {
    if (window.i18n && window.i18n.ready) return window.i18n.lang;
    return document.documentElement.getAttribute("lang") || "fr";
  }

  function t(key, fallback) {
    if (window.i18n && window.i18n.ready) {
      var value = window.i18n.t(key);
      if (value) return value;
    }
    return fallback === undefined ? "" : fallback;
  }

  function param(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function showError(element, message) {
    if (!element) return;
    element.textContent = message;
    element.hidden = false;
  }

  function formatMoney(cents) {
    var locale = INTL_LOCALES[lang()] || "fr-FR";
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "EUR",
        minimumFractionDigits: 2,
      }).format(cents / 100);
    } catch (error) {
      return (cents / 100).toFixed(2).replace(".", ",") + " €";
    }
  }

  /* ---------------------------------------------------------------------
     A. Page de paiement
     --------------------------------------------------------------------- */
  var payButton = document.getElementById("pay-btn");

  if (payButton) {
    var requested = (param("plan") || "pro").toLowerCase();
    var planKey = PLANS[requested] ? requested : "pro";
    var freePlan = PLANS[planKey].free;
    var busy = false;

    var nameEl = document.getElementById("plan-name");
    var priceEl = document.getElementById("plan-price");
    var perEl = document.getElementById("plan-per");
    var vatEl = document.getElementById("plan-vat");
    var listEl = document.getElementById("plan-features");
    var errorEl = document.getElementById("pay-error");

    function renderPlan() {
      var base = "plans." + planKey + ".";

      if (nameEl) nameEl.textContent = t(base + "name", "Plan");
      if (priceEl) priceEl.textContent = t(base + "price", "");
      if (perEl) perEl.textContent = t("plans.per", "/ mois");
      if (vatEl) {
        vatEl.textContent = PLANS[planKey].free
          ? t(base + "foot", "Aucune carte demandée")
          : t("plans.vat", "Hors taxes · TVA ajoutée au paiement");
      }

      if (listEl) {
        listEl.innerHTML = "";
        ["f1", "f2", "f3", "f4", "f5"].forEach(function (suffix) {
          var label = t(base + suffix);
          if (!label) return;
          var li = document.createElement("li");
          li.textContent = label;
          listEl.appendChild(li);
        });
      }

      if (!busy) payButton.textContent = t(base + "pay", "Payer par carte");
    }

    function hobbyMailto() {
      return (
        "mailto:contact@previewd.example?subject=" +
        encodeURIComponent(t("js.hobbySubject", "Activation du plan Hobby previewd"))
      );
    }

    renderPlan();
    window.addEventListener("previewd:lang", renderPlan);

    payButton.addEventListener("click", function () {
      if (freePlan) {
        window.location.href = hobbyMailto();
        return;
      }

      if (window.location.protocol === "file:") {
        showError(
          errorEl,
          t(
            "js.fileProtocol",
            "Cette page doit être servie par le petit serveur du site. Lancez « npm start » " +
              "dans le dossier server, puis ouvrez http://localhost:8787/pages/paiement.html?plan=" +
              planKey +
              "."
          ).replace("{plan}", planKey)
        );
        return;
      }

      busy = true;
      payButton.disabled = true;
      payButton.textContent = t("js.opening", "Ouverture du paiement…");
      if (errorEl) errorEl.hidden = true;

      fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey }),
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

          var message;
          if (result.status === 503) {
            message = t(
              "js.stripeMissing",
              "Stripe n'est pas encore configuré sur ce serveur : renseignez STRIPE_SECRET_KEY " +
                "dans server/.env (clé de test fournie par Stripe), puis redémarrez le serveur."
            );
          } else if (lang() === "fr" && result.data && result.data.message) {
            // Le serveur répond en français : on ne l'affiche que dans cette langue.
            message = result.data.message;
          } else {
            message = t("js.checkoutFailed", "Le paiement n'a pas pu être ouvert.");
          }

          showError(errorEl, message);
          busy = false;
          payButton.disabled = false;
          renderPlan();
        })
        .catch(function () {
          showError(
            errorEl,
            t(
              "js.serverUnreachable",
              "Impossible de joindre le serveur de paiement. Vérifiez qu'il est démarré, puis réessayez."
            )
          );
          busy = false;
          payButton.disabled = false;
          renderPlan();
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
    var apiSession = null;
    var failed = false;
    var paid = false;

    function setText(id, value) {
      var el = document.getElementById(id);
      if (el) el.textContent = value;
    }

    function renderStatus() {
      if (!sessionId) {
        if (textEl) {
          textEl.textContent = t(
            "js.sessionMissing",
            "Cette page s'affiche après un paiement. Aucune session n'est indiquée : si vous " +
              "venez de payer, retrouvez votre abonnement dans le courriel de confirmation de Stripe."
          );
        }
        return;
      }

      if (failed) {
        if (textEl) {
          textEl.textContent = t(
            "js.serverOffline",
            "Le paiement a été transmis à Stripe. La vérification locale est indisponible " +
              "(serveur arrêté) ; le courriel de confirmation de Stripe fait foi."
          );
        }
        return;
      }

      if (!apiSession) return;

      if (titleEl) titleEl.textContent = paid ? t("js.paidTitle", "C'est parti.") : t("js.pendingTitle", "Paiement en cours de confirmation.");
      if (textEl) {
        textEl.textContent = paid
          ? t(
              "js.paidText",
              "Votre abonnement est actif. Vous allez recevoir les instructions pour relier " +
                "votre première forge et lancer votre premier aperçu."
            )
          : t(
              "js.pendingText",
              "Stripe n'a pas encore confirmé le paiement (certains moyens de paiement prennent " +
                "quelques minutes). Actualisez cette page dans un instant."
            );
      }

      var knownPlan = apiSession.plan && PLANS[apiSession.plan];
      setText(
        "status-plan",
        knownPlan ? t("plans." + apiSession.plan + ".name") : apiSession.plan_label || apiSession.plan || "—"
      );

      if (typeof apiSession.amount === "number") {
        setText(
          "status-amount",
          formatMoney(apiSession.amount) +
            (apiSession.interval === "month" ? " " + t("js.perMonth", "/ mois") : "")
        );
      }

      setText("status-email", apiSession.email || "—");
      setText(
        "status-state",
        paid
          ? t("js.paid", "Payé")
          : apiSession.status === "unpaid"
            ? t("js.waiting", "En attente")
            : apiSession.status || "—"
      );
    }

    window.addEventListener("previewd:lang", renderStatus);

    if (!sessionId) {
      renderStatus();
    } else {
      fetch("/api/session?id=" + encodeURIComponent(sessionId))
        .then(function (response) {
          return response.json().then(function (data) {
            return { ok: response.ok, data: data };
          });
        })
        .then(function (result) {
          if (!result.ok || !result.data) {
            if (textEl) {
              textEl.textContent = t(
                "js.verifFailed",
                "Le paiement a bien été transmis à Stripe, mais nous n'avons pas pu vérifier la " +
                  "session depuis ce navigateur. Gardez le courriel de confirmation : il fait foi."
              );
            }
            return;
          }

          apiSession = result.data;
          paid = apiSession.status === "paid" || apiSession.status === "no_payment_required";

          statusCard.hidden = false;
          renderStatus();
        })
        .catch(function () {
          failed = true;
          renderStatus();
        });
    }
  }
})();
