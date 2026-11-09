/* ==========================================================================
   Preview-d — moteur i18n
   --------------------------------------------------------------------------
   Un dictionnaire (json/translate.json), quatre langues possibles, et un
   sélecteur persistant dans l'en-tête. Aucune dépendance, aucun appel réseau
   autre que le fichier de traductions lui-même.

   Utilisation dans le HTML :
     <h2 data-i18n="problem.h2">…texte français…</h2>
     <input data-i18n-placeholder="contact.placeholder">
     <nav data-i18n-aria-label="a11y.nav">

   Utilisation dans le JS :
     i18n.t("js.copied")
     i18n.t("js.fileProtocol", { plan: "pro" })

   Le HTML reste lisible et complet en français sans JavaScript : si le
   dictionnaire ne peut pas être chargé (page ouverte en file://), le site
   s'affiche tel quel et le sélecteur reste masqué.
   ========================================================================== */

(function () {
  "use strict";

  var SCRIPT = document.currentScript;
  var DICT_URL = new URL("../json/translate.json", SCRIPT ? SCRIPT.src : window.location.href);
  var DEFAULT_STORAGE_KEY = "Preview-d.lang";
  var PARAM = "lang";

  var state = {
    dict: null,
    meta: null,
    lang: null,
    storageKey: DEFAULT_STORAGE_KEY,
    supported: [],
  };

  /* ---------------------------------------------------------------------
     Utilitaires
     --------------------------------------------------------------------- */

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null; // Navigation privée, stockage refusé : on continue sans.
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      /* Sans stockage, le choix vaut pour la page courante seulement. */
    }
  }

  function normalize(code) {
    return String(code || "").trim().toLowerCase().split("-")[0];
  }

  /* ---------------------------------------------------------------------
     Résolution de la langue : ?lang= > choix mémorisé > <html lang> > défaut
     --------------------------------------------------------------------- */

  function resolveLanguage() {
    var supported = state.supported;
    var fromUrl = new URLSearchParams(window.location.search).get(PARAM);
    if (fromUrl && supported.indexOf(normalize(fromUrl)) !== -1) {
      // Un lien partagé en ?lang=es vaut choix explicite : on le mémorise pour
      // que la navigation suivante reste dans la même langue.
      storageSet(state.storageKey, normalize(fromUrl));
      return normalize(fromUrl);
    }

    var stored = storageGet(state.storageKey);
    if (stored && supported.indexOf(normalize(stored)) !== -1) return normalize(stored);

    var declared = normalize(document.documentElement.getAttribute("lang"));
    if (declared && supported.indexOf(declared) !== -1) return declared;

    return normalize(state.meta.default) || supported[0];
  }

  /* ---------------------------------------------------------------------
     Application du dictionnaire au document
     --------------------------------------------------------------------- */

  function t(key, vars) {
    var locale = state.dict && state.dict[state.lang];
    var fallback = state.dict && state.dict[state.meta.default];
    var value = (locale && locale[key]) || (fallback && fallback[key]);

    if (value === undefined || value === null) return "";

    if (vars) {
      return String(value).replace(/\{(\w+)\}/g, function (match, name) {
        return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match;
      });
    }

    return String(value);
  }

  function applyAttributes(root) {
    var attributes = [
      ["data-i18n-placeholder", "placeholder"],
      ["data-i18n-aria-label", "aria-label"],
      ["data-i18n-title", "title"],
      ["data-i18n-content", "content"],
      ["data-i18n-alt", "alt"],
    ];

    attributes.forEach(function (pair) {
      root.querySelectorAll("[" + pair[0] + "]").forEach(function (el) {
        var value = t(el.getAttribute(pair[0]));
        if (value) el.setAttribute(pair[1], value);
      });
    });
  }

  function applyText(root) {
    root.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      var value = t(key);
      if (!value) return; // Clé absente : on garde le texte d'origine.

      // Les traductions viennent d'un fichier local et maîtrisé ; elles
      // contiennent volontairement du balisage (<code>, <em>, <br>).
      el.innerHTML = value;
    });
  }

  function applyLanguage(lang) {
    var known = state.supported.indexOf(lang) !== -1;
    state.lang = known ? lang : state.meta.default;

    var entry = state.meta.languages.filter(function (item) {
      return normalize(item.code) === state.lang;
    })[0];

    document.documentElement.setAttribute("lang", (entry && entry.htmlLang) || state.lang);
    applyText(document);
    applyAttributes(document);
    syncSelect();

    window.dispatchEvent(
      new CustomEvent("Preview-d:lang", {
        detail: {
          lang: state.lang,
          label: entry ? entry.label : state.lang,
          dict: state.dict[state.lang],
          t: t,
        },
      })
    );
  }

  /* ---------------------------------------------------------------------
     Sélecteur de langue
     --------------------------------------------------------------------- */

  function buildSelect(select) {
    select.innerHTML = "";

    state.meta.languages.forEach(function (entry) {
      var option = document.createElement("option");
      option.value = normalize(entry.code);
      option.textContent = entry.short || entry.label;
      option.label = entry.label; // Nom complet dans la liste déroulante.
      option.setAttribute("lang", entry.htmlLang || entry.code);
      select.appendChild(option);
    });

    // Le HTML contient une option de repli : on reconstruit donc dès que la
    // liste ne correspond pas au dictionnaire, pas seulement quand elle est vide.
    if (!select.dataset.langBound) {
      select.dataset.langBound = "1";
      select.addEventListener("change", function () {
        var chosen = normalize(select.value);
        storageSet(state.storageKey, chosen);
        applyLanguage(chosen);
      });
    }
  }

  function syncSelect() {
    var expected = state.meta.languages.length;
    document.querySelectorAll("[data-lang-select]").forEach(function (select) {
      if (select.options.length !== expected) buildSelect(select);
      select.value = state.lang;
    });
  }

  function enableSelectors() {
    document.querySelectorAll("[data-lang-select]").forEach(function (select) {
      select.disabled = false;
      select.hidden = false;
      var holder = select.closest("[data-lang-switch]");
      if (holder) holder.hidden = false;
    });
    document.documentElement.classList.add("i18n-ready");
  }

  /* ---------------------------------------------------------------------
     Chargement
     --------------------------------------------------------------------- */

  function load() {
    return fetch(DICT_URL, { cache: "no-cache" }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    });
  }

  function init() {
    var api = {
      t: t,
      get lang() {
        return state.lang;
      },
      setLanguage: function (code) {
        var value = normalize(code);
        if (state.supported.indexOf(value) === -1) return false;
        storageSet(state.storageKey, value);
        applyLanguage(value);
        return true;
      },
      languages: function () {
        return state.meta ? state.meta.languages.slice() : [];
      },
      apply: function () {
        if (state.dict) applyLanguage(state.lang);
      },
      ready: false,
    };

    window.i18n = api;

    load()
      .then(function (dict) {
        if (!dict || !dict.meta || !dict.locales) throw new Error("dictionnaire incomplet");

        state.dict = dict.locales;
        state.meta = dict.meta;
        state.supported = dict.meta.languages.map(function (entry) {
          return normalize(entry.code);
        });
        if (dict.meta.storageKey) state.storageKey = dict.meta.storageKey;

        api.ready = true;
        api.languages = function () {
          return dict.meta.languages.slice();
        };

        applyLanguage(resolveLanguage());
        enableSelectors();
      })
      .catch(function (error) {
        // Ouverture directe du fichier (file://) ou JSON absent : le français
        // du HTML fait le travail, et le sélecteur reste hors du chemin.
        document.documentElement.setAttribute("data-i18n", "off");
        console.info("[i18n] dictionnaire non chargé (" + error.message + ") — page en français.");
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
