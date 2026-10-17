/* EvoBuskin - animation du logo (chargeur) + messages d'erreur réseau.
   Chargé en premier : utilisé UNIQUEMENT à l'ouverture de la boutique (démarrage, connexion, changement de boutique).
   Il disparaît dès que la boutique est prête : aucune animation pendant les changements de page.
   Animation : une barre lumineuse traverse l'œil de gauche à droite, les quatre auvents orange
   s'illuminent l'un après l'autre en suivant le balayage, et l'iris bleu se déplace légèrement. */

const Reseau = (() => {
  const MESSAGE = 'Vérifiez votre connexion puis réessayez.';
  // Reconnaît les erreurs de réseau, quel que soit le navigateur
  function estErreurReseau(e) {
    if (e && e.reseau) return true;
    const m = String((e && e.message) || e || '');
    return /failed to fetch|networkerror|network request failed|load failed|fetch failed|network error|err_internet|err_network|the internet connection appears/i.test(m);
  }
  // Renvoie un texte lisible : le message réseau en français ou le message d'origine
  function traduire(e) {
    if (estErreurReseau(e)) return MESSAGE;
    return String((e && e.message) || e || 'Une erreur est survenue.');
  }
  // Crée une erreur marquée "réseau"
  function erreur() { const e = new Error(MESSAGE); e.reseau = true; e.code = 'NETWORK'; return e; }
  return { MESSAGE, estErreurReseau, traduire, erreur };
})();
window.Reseau = Reseau;

const Chargeur = (() => {
  let compteur = 0;
  let racine = null, visibleDepuis = 0, minuteur = null, profondeur = 0;
  const DUREE_MIN_MS = 500;     // une fois affiché, le chargeur reste au moins ce temps (pas de clignotement)

  // Dessin du logo (auvents, œil, iris). Identifiants uniques pour pouvoir afficher plusieurs logos.
  function svg(taille = 112) {
    const n = ++compteur;
    const id = (s) => 'eb' + s + n;
    return '<svg class="eb-logo" width="' + taille + '" height="' + taille + '" viewBox="0 0 512 512" role="img" aria-label="Chargement">' +
      '<defs>' +
        '<linearGradient id="' + id('o') + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb800"/><stop offset="1" stop-color="#ff5200"/></linearGradient>' +
        '<linearGradient id="' + id('w') + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfd9ee"/></linearGradient>' +
        '<radialGradient id="' + id('i') + '" cx="0.5" cy="0.4" r="0.7"><stop offset="0" stop-color="#00c8ff"/><stop offset="1" stop-color="#0050ff"/></radialGradient>' +
        '<linearGradient id="' + id('b') + '" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7fdcff" stop-opacity="0"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="1" stop-color="#7fdcff" stop-opacity="0"/></linearGradient>' +
        '<clipPath id="' + id('c') + '"><path d="M52 322 Q256 88 460 322 Q256 556 52 322 Z"/></clipPath>' +
      '</defs>' +
      '<rect width="512" height="512" rx="112" fill="#060d1f"/>' +
      // quatre auvents, éclairés l'un après l'autre
      '<g fill="url(#' + id('o') + ')">' +
        '<path class="eb-auvent a1" d="M110 86 L178 86 L156 188 Q151 212 126 214 L90 214 Q62 212 68 178 Z"/>' +
        '<path class="eb-auvent a2" d="M186 86 L258 86 L262 190 Q262 212 242 214 L170 214 Q152 212 158 190 Z"/>' +
        '<path class="eb-auvent a3" d="M268 86 L338 86 L354 190 Q356 212 338 214 L270 214 Q264 212 266 190 Z"/>' +
        '<path class="eb-auvent a4" d="M346 86 L414 86 Q432 130 452 180 Q458 212 432 214 L370 214 Q350 212 354 190 Z"/>' +
      '</g>' +
      // œil : contour blanc, fond sombre, iris bleu qui se déplace légèrement
      '<path d="M52 322 Q256 88 460 322 Q256 556 52 322 Z" fill="url(#' + id('w') + ')"/>' +
      '<path d="M106 322 Q256 154 406 322 Q256 490 106 322 Z" fill="#060d1f"/>' +
      '<g class="eb-iris">' +
        '<circle cx="256" cy="322" r="84" fill="url(#' + id('i') + ')"/>' +
        '<circle cx="256" cy="322" r="46" fill="#060d1f"/>' +
        '<circle cx="222" cy="288" r="13" fill="#fff"/>' +
      '</g>' +
      // barre lumineuse qui traverse l'œil de bout en bout
      '<g clip-path="url(#' + id('c') + ')"><rect class="eb-barre" x="-70" y="170" width="70" height="300" fill="url(#' + id('b') + ')"/></g>' +
    '</svg>';
  }

  function creerRacine() {
    if (racine) return racine;
    racine = document.createElement('div');
    racine.id = 'chargeurGlobal';
    racine.setAttribute('role', 'status');
    racine.setAttribute('aria-live', 'polite');
    racine.hidden = true;
    document.body.appendChild(racine);
    return racine;
  }

  // mode 'plein' : fond sombre (connexion, démarrage) ; mode 'page' : voile léger (changement d'écran)
  function afficher(message, mode = 'plein') {
    const r = creerRacine();
    r.className = 'chargeur-' + mode;
    r.innerHTML = '<div class="chargeur-contenu">' + svg(mode === 'plein' ? 120 : 92) +
      (message ? '<p class="chargeur-texte">' + String(message).replace(/[<>&]/g, '') + '</p>' : '') + '</div>';
    r.hidden = false;
    visibleDepuis = Date.now();
  }

  function masquer() {
    if (!racine || racine.hidden) return Promise.resolve();
    const reste = Math.max(0, DUREE_MIN_MS - (Date.now() - visibleDepuis));
    return new Promise((ok) => setTimeout(() => { if (profondeur === 0 && racine) racine.hidden = true; ok(); }, reste));
  }

  // Affiche le chargeur pendant une opération asynchrone (retourne son résultat).
  async function pendant(operation, message, mode = 'plein') {
    profondeur++;
    afficher(message, mode);
    try { return await operation(); }
    finally { profondeur--; await masquer(); }
  }

  return { svg, afficher, masquer, pendant };
})();
window.Chargeur = Chargeur;

// Écran de démarrage : on remplace l'image fixe par le logo animé
document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('chargement');
  if (zone) zone.innerHTML = Chargeur.svg(132) + '<p>EvoBuskin</p>';
});
