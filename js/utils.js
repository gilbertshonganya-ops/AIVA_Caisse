/* AIVA Caisse - utilitaires communs
   Fonctions simples réutilisées partout : sélecteurs, formats d'argent, dates, fenêtres. */

// ---------- Raccourcis DOM ----------
const $ = (sel, racine = document) => racine.querySelector(sel);
const $$ = (sel, racine = document) => Array.from(racine.querySelectorAll(sel));

// Protège le texte saisi par l'utilisateur avant de l'afficher dans le HTML
function esc(texte) {
  return String(texte == null ? '' : texte).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ---------- Nombres et argent ----------
function arrondi(n, decimales = 2) {
  const f = Math.pow(10, decimales);
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
}

// Lit un nombre saisi (accepte la virgule). Retourne NaN si invalide.
function lireNombre(valeur) {
  if (valeur === null || valeur === undefined) return NaN;
  const t = String(valeur).trim().replace(/\s/g, '').replace(',', '.');
  if (t === '') return NaN;
  return Number(t);
}

// Convertit un montant d'une devise vers le dollar, avec le taux (1 USD = taux FC)
function versUSD(montant, devise, taux) {
  return devise === 'CDF' ? montant / taux : montant;
}
function depuisUSD(montantUSD, devise, taux) {
  return devise === 'CDF' ? montantUSD * taux : montantUSD;
}

function formatUSD(n) {
  const v = arrondi(n, 2);
  return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $';
}
function formatCDF(n) {
  return Math.round(n).toLocaleString('fr-FR') + ' FC';
}
// Affiche un montant (en USD) dans la devise choisie, avec l'autre devise en petit
function formatDeuxDevises(montantUSD, taux) {
  return formatUSD(montantUSD) + ' (' + formatCDF(montantUSD * taux) + ')';
}
function formatQuantite(n) {
  return Number(arrondi(n, 3)).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

// ---------- Dates ----------
function debutJour(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime();
}
function debutSemaine(d = new Date()) { // la semaine commence le lundi
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const jour = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - jour);
  return x.getTime();
}
function debutMois(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(1); return x.getTime();
}
function formatDate(ts) {
  return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatHeure(ts) {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function formatDateHeure(ts) { return formatDate(ts) + ' ' + formatHeure(ts); }

// ---------- Téléphone et WhatsApp ----------
// Transforme 0895006995 ou +243 895 006 995 en 243895006995
function normaliserTel(tel) {
  let chiffres = String(tel || '').replace(/\D/g, '');
  if (chiffres.startsWith('00')) chiffres = chiffres.slice(2);
  if (chiffres.startsWith('0')) chiffres = '243' + chiffres.slice(1);
  if (chiffres.length === 9) chiffres = '243' + chiffres; // numéro sans le 0 de tête
  return chiffres;
}
function lienWhatsApp(tel, message) {
  const n = normaliserTel(tel);
  const base = n ? 'https://wa.me/' + n : 'https://wa.me/';
  return base + '?text=' + encodeURIComponent(message);
}
function ouvrirLien(url) {
  window.open(url, '_blank', 'noopener');
}

// ---------- Mini hachage pour les codes PIN ----------
// Fonction cyrb53 : identique partout (même sans HTTPS). Protège contre un regard
// curieux, pas contre un pirate déterminé (un PIN à 4 chiffres reste court).
function hacher(texte) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  const s = 'aiva-caisse|' + texte;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

// ---------- Messages et fenêtres ----------
let minuteurToast = null;
function toast(message, type = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'visible ' + type;
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => { el.className = ''; }, 3200);
}

// Fenêtre qui monte du bas de l'écran. Retourne { fermer, el }.
function ouvrirFenetre(titre, html, options = {}) {
  const fond = document.createElement('div');
  fond.className = 'fond-fenetre';
  fond.innerHTML =
    '<div class="fenetre" role="dialog" aria-modal="true">' +
      '<div class="fenetre-tete"><h3>' + esc(titre) + '</h3>' +
      '<button class="btn-icone fermer" aria-label="Fermer">&times;</button></div>' +
      '<div class="fenetre-corps">' + html + '</div>' +
    '</div>';
  document.body.appendChild(fond);
  document.body.classList.add('modal-ouvert');
  const fermer = () => {
    fond.remove();
    if (!$('.fond-fenetre')) document.body.classList.remove('modal-ouvert');
    if (options.auFermer) options.auFermer();
  };
  $('.fermer', fond).addEventListener('click', fermer);
  fond.addEventListener('click', (e) => { if (e.target === fond && !options.verrouille) fermer(); });
  return { fermer, el: fond };
}

// Question Oui / Non. Retourne une promesse (true si Oui).
function confirmer(titre, message, texteOui = 'Oui', danger = false) {
  return new Promise((resolve) => {
    let reponse = false;
    const f = ouvrirFenetre(titre,
      '<p class="texte-centre">' + esc(message) + '</p>' +
      '<div class="ligne-boutons">' +
        '<button class="btn gris" data-r="non">Annuler</button>' +
        '<button class="btn ' + (danger ? 'rouge' : '') + '" data-r="oui">' + esc(texteOui) + '</button>' +
      '</div>',
      { auFermer: () => resolve(reponse), verrouille: true });
    $('[data-r="non"]', f.el).addEventListener('click', () => f.fermer());
    $('[data-r="oui"]', f.el).addEventListener('click', () => { reponse = true; f.fermer(); });
  });
}

// Enregistre un fichier sur le téléphone (téléchargement ou partage)
async function enregistrerFichier(nom, contenu, type) {
  const blob = new Blob([contenu], { type });
  try {
    const fichier = new File([blob], nom, { type });
    if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
      await navigator.share({ files: [fichier], title: nom });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // l'utilisateur a annulé le partage
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Pour pouvoir tester les fonctions pures avec Node (sans effet dans le navigateur)
if (typeof module !== 'undefined') {
  module.exports = { arrondi, lireNombre, versUSD, depuisUSD, normaliserTel, hacher, debutSemaine, formatUSD, formatCDF };
}
