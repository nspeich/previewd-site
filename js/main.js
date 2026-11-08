/* ==========================================================================
   previewd — interactions du site
   Aucune dépendance externe, aucun appel réseau.
   ========================================================================== */

(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------------------
     1. En-tête : fond au défilement
     --------------------------------------------------------------------- */
  var header = document.getElementById("header");

  function onScroll() {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 12);
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------------------------------------------------------------------
     2. Menu mobile
     --------------------------------------------------------------------- */
  var burger = document.getElementById("burger");
  var nav = document.getElementById("nav");

  function setMenu(open) {
    if (!header || !burger) return;
    header.classList.toggle("is-open", open);
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
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

  /* ---------------------------------------------------------------------
     3. Apparition au défilement
     --------------------------------------------------------------------- */
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

  /* ---------------------------------------------------------------------
     4. Compteurs du bandeau de chiffres
     --------------------------------------------------------------------- */
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

  /* ---------------------------------------------------------------------
     5. Onglets de forge
     --------------------------------------------------------------------- */
  var tabs = document.querySelectorAll(".forge-tab");

  function selectTab(tab) {
    tabs.forEach(function (other) {
      var selected = other === tab;
      other.classList.toggle("is-active", selected);
      other.setAttribute("aria-selected", String(selected));

      var panel = document.getElementById(other.getAttribute("aria-controls"));
      if (panel) {
        panel.classList.toggle("is-active", selected);
        panel.hidden = !selected;
      }
    });
  }

  tabs.forEach(function (tab, index) {
    tab.addEventListener("click", function () {
      selectTab(tab);
    });

    // Navigation au clavier entre les onglets (flèches gauche/droite).
    tab.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      var next =
        event.key === "ArrowRight"
          ? tabs[(index + 1) % tabs.length]
          : tabs[(index - 1 + tabs.length) % tabs.length];
      selectTab(next);
      next.focus();
    });
  });

  /* ---------------------------------------------------------------------
     5 bis. Sélecteur de formule (grille tarifaire)
     --------------------------------------------------------------------- */
  var saasTabs = document.querySelectorAll(".saas-tab");

  function selectSaasTab(tab) {
    saasTabs.forEach(function (other) {
      var selected = other === tab;
      other.classList.toggle("is-active", selected);
      other.setAttribute("aria-selected", String(selected));

      var panel = document.getElementById(other.getAttribute("aria-controls"));
      if (panel) {
        panel.classList.toggle("is-active", selected);
        panel.hidden = !selected;
      }
    });
  }

  saasTabs.forEach(function (tab, index) {
    tab.addEventListener("click", function () {
      selectSaasTab(tab);
    });

    tab.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      var next =
        event.key === "ArrowRight"
          ? saasTabs[(index + 1) % saasTabs.length]
          : saasTabs[(index - 1 + saasTabs.length) % saasTabs.length];
      selectSaasTab(next);
      next.focus();
    });
  });

  /* ---------------------------------------------------------------------
     6. Boutons « Copier »
     --------------------------------------------------------------------- */
  document.querySelectorAll(".copy-btn").forEach(function (button) {
    button.addEventListener("click", function () {
      var block = document.getElementById(button.getAttribute("data-copy"));
      if (!block || !navigator.clipboard) return;

      var text = block.innerText || block.textContent || "";

      navigator.clipboard
        .writeText(text.trim())
        .then(function () {
          var label = button.textContent;
          button.textContent = "Copié";
          button.disabled = true;
          window.setTimeout(function () {
            button.textContent = label;
            button.disabled = false;
          }, 1800);
        })
        .catch(function () {
          button.textContent = "Échec";
        });
    });
  });

  /* ---------------------------------------------------------------------
     7. FAQ : une seule réponse ouverte à la fois
     --------------------------------------------------------------------- */
  var faqItems = document.querySelectorAll(".faq details");

  faqItems.forEach(function (item) {
    item.addEventListener("toggle", function () {
      if (!item.open) return;
      faqItems.forEach(function (other) {
        if (other !== item) other.open = false;
      });
    });
  });

  /* ---------------------------------------------------------------------
     8. Formulaire : composition d'un courriel, sans serveur
     --------------------------------------------------------------------- */
  var form = document.getElementById("contact-form");
  var note = document.getElementById("form-note");

  if (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();

      var nom = (document.getElementById("nom") || {}).value || "";
      var email = (document.getElementById("email") || {}).value || "";
      var org = (document.getElementById("org") || {}).value || "";
      var contexte = (document.getElementById("contexte") || {}).value || "";

      var sujet = "Demande d'évaluation previewd — " + (org || "organisation");
      var corps = [
        "Nom : " + nom,
        "Courriel : " + email,
        "Organisation : " + org,
        "",
        "Contexte :",
        contexte || "(non précisé)",
        "",
        "— Demande envoyée depuis le site previewd",
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
        note.textContent =
          "Votre logiciel de messagerie est ouvert avec la demande pré-remplie. Rien n'a été transmis à un serveur.";
        note.classList.add("is-sent");
      }
    });
  }

  /* ---------------------------------------------------------------------
     9. Année du pied de page
     --------------------------------------------------------------------- */
  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());
})();
