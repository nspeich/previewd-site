/* 
 interactions du site
Aucune dépendance externe, aucun appel réseau.
*/

(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Les textes produits par le script passent par le même dictionnaire que
  // le HTML. Si i18n.js n'a pas pu charger (page ouverte en file://), on
  // retombe sur les libellés français d'origine.
  function t(key, fallback) {
    if (window.i18n && window.i18n.ready) {
      var value = window.i18n.t(key);
      if (value) return value;
    }
    return fallback;
  }

/* En-tête : fond au défilement */
  var header = document.getElementById("header");

  function onScroll() {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 12);
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

/* Menu mobile */
  var burger = document.getElementById("burger");
  var nav = document.getElementById("nav");

  function setMenu(open) {
    if (!header || !burger) return;
    header.classList.toggle("is-open", open);
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute(
      "aria-label",
      open ? t("a11y.menuClose", "Fermer le menu") : t("a11y.menuOpen", "Ouvrir le menu")
    );
  }

  if (burger) {
    burger.addEventListener("click", function () {
      setMenu(burger.getAttribute("aria-expanded") !== "true");
    });
  }

  if (nav) {
    nav.addEventListener("click", function (event) {
      if (event.target.tagName === "A") setMenu(false);
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") setMenu(false);
  });

/* Apparition au défilement */
  var revealables = document.querySelectorAll(".reveal");

  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealables.forEach(function (el) {
      el.classList.add("is-visible");
    });
  } else {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
    );

    revealables.forEach(function (el) {
      observer.observe(el);
    });
  }

/* Compteurs du bandeau de chiffres */
  var counters = document.querySelectorAll(".stat-value[data-count]");

  function animateCounter(el) {
    var target = parseInt(el.getAttribute("data-count"), 10);
    if (isNaN(target)) return;

    // Un « 0 » n'a rien à animer : la valeur est elle-même le message.
    if (reduceMotion || target <= 1) {
      el.textContent = String(target);
      return;
    }

    var start = null;
    var duration = 900;

    function frame(now) {
      if (start === null) start = now;
      var progress = Math.min((now - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = String(Math.round(target * eased));
      if (progress < 1) window.requestAnimationFrame(frame);
    }

    window.requestAnimationFrame(frame);
  }

  if ("IntersectionObserver" in window && counters.length) {
    var counterObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          animateCounter(entry.target);
          counterObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.5 }
    );

    counters.forEach(function (el) {
      counterObserver.observe(el);
    });
  }

/* Onglets : forge, formules d'abonnement, sections de contenu */
  function bindTabs(selector) {
    var tabs = Array.prototype.slice.call(document.querySelectorAll(selector));
    if (!tabs.length) return null;

    function selectTab(tab, focus) {
      tabs.forEach(function (other) {
        var selected = other === tab;
        other.classList.toggle("is-active", selected);
        other.setAttribute("aria-selected", String(selected));
        other.tabIndex = selected ? 0 : -1;

        var panel = document.getElementById(other.getAttribute("aria-controls"));
        if (!panel) return;
        panel.classList.toggle("is-active", selected);
        panel.hidden = !selected;

        // Un panneau caché n'a pas pu déclencher l'apparition au défilement :
        // on rend ses blocs visibles dès qu'il est affiché.
        if (selected) {
          panel.querySelectorAll(".reveal").forEach(function (el) {
            el.classList.add("is-visible");
          });
        }
      });
      if (focus) tab.focus();
    }

    tabs.forEach(function (tab, index) {
      tab.tabIndex = tab.classList.contains("is-active") ? 0 : -1;

      tab.addEventListener("click", function () {
        selectTab(tab);
      });

      // Navigation au clavier entre les onglets (flèches, origine, fin).
      tab.addEventListener("keydown", function (event) {
        var key = event.key;
        if (key !== "ArrowRight" && key !== "ArrowLeft" && key !== "Home" && key !== "End") return;
        event.preventDefault();
        var next;
        if (key === "Home") next = tabs[0];
        else if (key === "End") next = tabs[tabs.length - 1];
        else if (key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
        else next = tabs[(index - 1 + tabs.length) % tabs.length];
        selectTab(next, true);
      });
    });

    return { tabs: tabs, select: selectTab };
  }

  bindTabs(".forge-tab");
  bindTabs(".saas-tab");
  var contentTabs = bindTabs(".content-tab");

  // Les liens du menu pointent vers des panneaux masqués : on ouvre l'onglet
  // correspondant avant que le navigateur ne fasse défiler la page.
  if (contentTabs) {
    function tabForPanel(id) {
      return contentTabs.tabs.filter(function (tab) {
        return tab.getAttribute("aria-controls") === id;
      })[0];
    }

    // Le panneau commence sous l'en-tête fixe et la barre d'onglets collante :
    // c'est le `scroll-margin-top` de .tab-panel qui fixe le décalage.
    function scrollToPanel(panel, smooth) {
      panel.scrollIntoView({
        block: "start",
        behavior: smooth && !reduceMotion ? "smooth" : "auto",
      });
    }

    function openPanelFromHash() {
      var id = window.location.hash.replace(/^#/, "");
      if (!id) return;
      var panel = document.getElementById(id);
      if (!panel || !panel.classList.contains("tab-panel")) return;
      var tab = tabForPanel(id);
      if (!tab) return;
      contentTabs.select(tab);
      scrollToPanel(panel, false);
    }

    openPanelFromHash();
    window.addEventListener("hashchange", openPanelFromHash);

    // Un lien du menu pointe vers un panneau masqué : on ouvre l'onglet et on
    // positionne le défilement nous-mêmes, le panneau venant d'être affiché.
    document.addEventListener("click", function (event) {
      var link = event.target.closest ? event.target.closest('a[href^="#"]') : null;
      if (!link) return;
      var id = link.getAttribute("href").replace(/^#/, "");
      var tab = tabForPanel(id);
      if (!tab) return;
      event.preventDefault();
      contentTabs.select(tab);
      scrollToPanel(document.getElementById(id), true);
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", "#" + id);
      }
    });
  }

/* Boutons « Copier » */
  document.querySelectorAll(".copy-btn").forEach(function (button) {
    button.addEventListener("click", function () {
      var block = document.getElementById(button.getAttribute("data-copy"));
      if (!block || !navigator.clipboard) return;

      var text = block.innerText || block.textContent || "";

      navigator.clipboard
        .writeText(text.trim())
        .then(function () {
          var label = button.textContent;
          button.textContent = t("js.copied", "Copié");
          button.disabled = true;
          window.setTimeout(function () {
            // Le libellé d'origine peut avoir changé de langue entre-temps.
            button.textContent = t("deploy.copy", label);
            button.disabled = false;
          }, 1800);
        })
        .catch(function () {
          button.textContent = t("js.copyFailed", "Échec");
        });
    });
  });

/*  FAQ : une seule réponse ouverte à la fois */
  var faqItems = document.querySelectorAll(".faq details");

  faqItems.forEach(function (item) {
    item.addEventListener("toggle", function () {
      if (!item.open) return;
      faqItems.forEach(function (other) {
        if (other !== item) other.open = false;
      });
    });
  });

/*  Formulaire : composition d'un courriel, sans serveur */
  var form = document.getElementById("contact-form");
  var note = document.getElementById("form-note");

  if (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();

      var nom = (document.getElementById("nom") || {}).value || "";
      var email = (document.getElementById("email") || {}).value || "";
      var org = (document.getElementById("org") || {}).value || "";
      var contexte = (document.getElementById("contexte") || {}).value || "";

      var sujet =
        t("js.mailSubject", "Demande d'évaluation Previewd") +
        " — " +
        (org || t("js.mailOrg", "organisation"));
      var corps = [
        t("js.mailName", "Nom") + ": " + nom,
        t("js.mailEmail", "Courriel") + ": " + email,
        t("js.mailOrgLabel", "Organisation") + ": " + org,
        "",
        t("js.mailContext", "Contexte") + ":",
        contexte || t("js.mailUnspecified", "(non précisé)"),
        "",
        t("js.mailFooter", "— Demande envoyée depuis le site Previewd"),
      ].join("\n");

      var destination = (form.getAttribute("action") || "")
        .replace(/^mailto:/, "")
        .split("?")[0];

      window.location.href =
        "mailto:" +
        destination +
        "?subject=" +
        encodeURIComponent(sujet) +
        "&body=" +
        encodeURIComponent(corps);

      if (note) {
        note.textContent = t(
          "contact.noteSent",
          "Votre logiciel de messagerie est ouvert avec la demande pré-remplie. Rien n'a été transmis à un serveur."
        );
        note.classList.add("is-sent");
      }
    });
  }
/* 9. Année du pied de page */
  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());
})();
