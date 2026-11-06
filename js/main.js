(() => {
  'use strict';

  /** section tarifs (Communauté / Cloud / Enterprise). */
  const initPricingTabs = () => {
    const tabs = document.querySelectorAll('.tabs button');
    const panels = document.querySelectorAll('.panel');

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
        panels.forEach((panel) => {
          panel.hidden = panel.id !== `p-${tab.dataset.t}`;
        });
      });
    });
  };

  /** Bascule mensuel / annuel sur les prix des plans Cloud. */
  const initBillingSwitch = () => {
    const toggle = document.getElementById('sw');
    if (!toggle) return;

    toggle.addEventListener('click', () => {
      const yearly = toggle.getAttribute('aria-checked') !== 'true';
      toggle.setAttribute('aria-checked', String(yearly));

      document.querySelectorAll('.amt').forEach((el) => {
        el.textContent = yearly ? el.dataset.a : el.dataset.m;
      });
      document.querySelectorAll('.per').forEach((el) => {
        el.textContent = yearly ? ' / an' : ' / mois';
      });
    });
  };

  /** Formulaire de contact (simulé : à brancher sur une API réelle). */
  const initContactForm = () => {
    const form = document.getElementById('f');
    const status = document.getElementById('msg');
    if (!form || !status) return;

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = form.elements.n.value.trim();
      status.textContent = `Merci${name ? `, ${name}` : ''}. Votre message nous est bien parvenu, nous vous répondons très vite.`;
      form.reset();
    });
  };

  /** Apparition douce des blocs au défilement. */
  const initRevealOnScroll = () => {
    const targets = document.querySelectorAll('.rv');
    if (!('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('in'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('in');
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.15 },
    );
    targets.forEach((el) => observer.observe(el));
  };

  initPricingTabs();
  initBillingSwitch();
  initContactForm();
  initRevealOnScroll();
})();