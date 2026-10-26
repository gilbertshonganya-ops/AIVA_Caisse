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
  function traduire(e) { return lisible(e); }
  // Codes du serveur -> phrases simples (bandeau « Envoi des données » et messages)
  const CODES = [
    [/CUSTOMER_REQUIRED_FOR_DEBT/, 'Une vente a un reste à payer mais aucun client : choisissez un client ou vérifiez les prix, puis appuyez sur Réessayer.'],
    [/CUSTOMER_NOT_SYNCED|CUSTOMER_NOT_FOUND/, 'Le client de cette opération n’a pas encore pu être enregistré. Réessayez.'],
    [/OWNER_REQUIRED/, 'Cette opération doit être envoyée avec le compte du patron. Connectez-vous avec le compte du patron puis appuyez sur Réessayer, ou abandonnez-la.'],
    [/INSUFFICIENT_STOCK/, 'Stock insuffisant sur le serveur pour cette vente. Vérifiez le stock du produit.'],
    [/PRODUCT_NOT_FOUND|PRODUCT_ID_REQUIRED/, 'Un produit de cette opération est introuvable. Actualisez vos données.'],
    [/EXCHANGE_RATE_NOT_CONFIGURED/, 'Le taux de change n’est pas encore enregistré. Enregistrez-le dans Réglages.'],
    [/INVALID_PAYMENT_AMOUNT|INVALID_SALE_LINE|INVALID_SALE_QUANTITY|EMPTY_CART/, 'Cette vente contient une valeur incorrecte.'],
    [/IDEMPOTENCY_KEY_REUSE/, 'Cette opération a déjà été envoyée avec d’autres valeurs.'],
    [/BUSINESS_ACCESS_DENIED|FORBIDDEN/, 'Vous n’avez pas accès à cette boutique pour cette opération.']
  ];
  const AUTRES = [
    [/Invalid TOTP|TOTP code|code.*(invalid|incorrect)/i, 'Code de sécurité incorrect. Vérifiez le code à 6 chiffres affiché dans votre application d’authentification.'],
    [/AAL2|MFA is enabled|multi-?factor/i, 'Une vérification de sécurité est nécessaire : entrez le code à 6 chiffres de votre application d’authentification.'],
    [/Email not confirmed|EMAIL_NOT_CONFIRMED/i, 'Votre adresse email doit d’abord être confirmée. Ouvrez le message reçu par email.'],
    [/User already registered|already been registered/i, 'Un compte existe déjà avec cette adresse email.'],
    [/Invalid login credentials/i, 'Adresse email ou mot de passe incorrect.'],
    [/Password should|weak password|password.*(short|least)/i, 'Mot de passe trop faible : 12 caractères minimum, avec majuscule, minuscule, chiffre et caractère spécial.'],
    [/same password|different from the old/i, 'Le nouveau mot de passe doit être différent de l’ancien.'],
    [/rate limit|too many requests|over_.*_rate_limit|429/i, 'Trop de demandes. Patientez quelques minutes puis réessayez.'],
    [/JWT|token.*(expired|invalid)|refresh_token|session.*(expired|missing|not found)|AUTH_REQUIRED/i, 'Votre session a expiré. Reconnectez-vous.'],
    [/duplicate key|already exists/i, 'Cet élément existe déjà.'],
    [/permission denied|row-level security|not authorized|unauthorized|forbidden/i, 'Vous n’avez pas l’autorisation d’effectuer cette action.'],
    [/timeout|timed out/i, 'Le serveur met trop de temps à répondre. Réessayez dans un instant.'],
    [/CUSTOMER_NAME_REQUIRED/, 'Le nom du client est obligatoire.'],
    [/TOO_MANY_PENDING_INVITES|PLAN_LIMIT_REACHED/, 'La limite de votre abonnement est atteinte.'],
    [/IDEMPOTENCY/, 'Cette opération a déjà été enregistrée.'],
    [/5\d\d|internal server error|bad gateway|service unavailable|unexpected_failure/i, 'Le service est momentanément indisponible. Réessayez dans un instant.']
  ];
  const GENERIQUE = 'Une erreur est survenue. Réessayez dans un instant ; si le problème continue, contactez le support.';
  // Transforme TOUT message technique en phrase française ; un texte déjà en français est conservé
  const NOMS_LIMITES = { shops: 'boutiques', sellers: 'vendeurs', sellers_per_shop: 'vendeurs dans cette boutique', products: 'produits', customers: 'clients à crédit', suppliers: 'fournisseurs', businesses: 'boutiques' };
  function lisible(texte) {
    const m = String((texte && texte.message) || texte || '');
    const lim = m.match(/PLAN_LIMIT_REACHED:(\w+)/);
    if (lim) return 'Votre niveau d’abonnement ne permet pas d’ajouter plus de ' + (NOMS_LIMITES[lim[1]] || 'éléments') + '. Le patron peut passer au niveau supérieur dans Plus → Mon abonnement.';
    if (/FEATURE_NOT_INCLUDED/.test(m)) return 'Cette fonction n’est pas incluse dans votre niveau d’abonnement. Le patron peut passer au niveau supérieur dans Plus → Mon abonnement.';
    if (/CINETPAY_INITIALIZATION_FAILED|CINETPAY_NOT_CONFIGURED|SERVER_CONFIG_MISSING|CHECKOUT_CREATE_FAILED/.test(m)) return 'Le service de paiement est momentanément indisponible. Réessayez dans un instant.';
    if (/PLAN_NOT_AVAILABLE|PLAN_NOT_FOUND/.test(m)) return 'Ce niveau d’abonnement n’est pas disponible pour le moment.';
    if (/PAYMENT_NOT_FOUND/.test(m)) return 'Paiement introuvable.';
    if (/SUBSCRIPTION_/.test(m)) return 'L’abonnement n’a pas pu être traité. Contactez le support si vous avez payé.';
    for (const [re, phrase] of CODES) if (re.test(m)) return phrase;
    for (const [re, phrase] of AUTRES) if (re.test(m)) return phrase;
    if (estErreurReseau(m)) return MESSAGE;
    if (!m.trim()) return GENERIQUE;
    // code technique (EN_MAJUSCULES, snake_case) ou message anglais : phrase française générale
    if (/^[A-Z0-9_:\- .]{4,}$/.test(m.trim()) || /\b[a-z]+_[a-z_]+\b/.test(m) || /\b(error|failed|invalid|required|not found|denied|unable|cannot|could not|exception|undefined|null|object)\b/i.test(m)) return GENERIQUE;
    return m;
  }
  // Crée une erreur marquée "réseau"
  function erreur() { const e = new Error(MESSAGE); e.reseau = true; e.code = 'NETWORK'; return e; }
  return { MESSAGE, estErreurReseau, traduire, erreur, lisible };
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
