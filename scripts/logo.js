// scripts/logo.js
// Force le bon chemin du logo sur toutes les pages, quel que soit l'endroit où se trouve la page (screens/, racine, etc.)
(function () {
  function findWorkingPath(candidates, done) {
    let i = 0;
    const tryNext = () => {
      if (i >= candidates.length) return done(null);
      const p = candidates[i++] + '?v=' + Date.now();
      const img = new Image();
      img.onload = () => done(p.split('?')[0]);
      img.onerror = tryNext;
      img.src = p;
    };
    tryNext();
  }

  document.addEventListener('DOMContentLoaded', function () {
    const candidates = [
      '../assets/logo.png',  // pages dans /screens/
      './assets/logo.png',   // pages à la racine
      'assets/logo.png',     // si servi depuis /
      '/assets/logo.png'     // serveur avec racine web /
    ];

    findWorkingPath(candidates, function (path) {
      // Si aucune voie ne marche, on ne fait rien (le fallback texte restera)
      if (!path) return;
      // Cible tous les logos possibles
      document.querySelectorAll('.logo img, img[data-az-logo], img[alt="Logo AllergoZyme"]').forEach(function (el) {
        el.src = path;
        el.removeAttribute('onerror'); // évite de remplacer par le fallback si ça charge
        el.alt = 'Logo AllergoZyme';
      });
      // Bonus : favicons si tu en ajoutes plus tard
    });
  });
})();
