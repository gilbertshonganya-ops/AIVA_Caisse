/* EvoBuskin - noyau de l'application
   Démarrage, réglages, connexion par PIN, navigation entre les écrans. */
const App = {
  // Réglages par défaut (modifiables dans l'écran Réglages)
  reglages: { taux: 2800, nomBoutique: 'Ma Boutique', telBoutique: '', affichage: 'USD', pinPatron: '', pinVendeur: '', pinChange: false, derniereSauvegarde: 0 },
  role: null,            // 'patron' ou 'vendeur' (null = verrouillé)
  onglet: null,
  derniereActivite: Date.now(),
  invitationInstall: null,
  essaisPin: 0,
  bloquePinJusqua: 0,
  DELAI_VERROU_MS: 10 * 60 * 1000, // verrouillage automatique après 10 minutes sans toucher l'écran

  // Liste des écrans. "roles" = qui a le droit de les voir. "parent" = écran rangé dans le menu Plus.
  onglets: [
    { id: 'caisse',   titre: 'Caisse',   icone: '\u{1F6D2}', roles: ['patron', 'vendeur'], vue: () => VueCaisse },
    { id: 'stock',    titre: 'Stock',    icone: '\u{1F4E6}', roles: ['patron', 'vendeur'], vue: () => VueStock },
    { id: 'dettes',   titre: 'Dettes',   icone: '\u{1F4D2}', roles: ['patron', 'vendeur'], vue: () => VueDettes },
    { id: 'rapports', titre: 'Rapports', icone: '\u{1F4CA}', roles: ['patron'],            vue: () => VueRapports },
    { id: 'plus',     titre: 'Plus',     icone: '\u2630',    roles: ['patron'],            vue: () => VuePlus },
    { id: 'depenses', titre: 'Dépenses',  roles: ['patron'], parent: 'plus', vue: () => VueDepenses },
    { id: 'achats',   titre: 'Achats',    roles: ['patron'], parent: 'plus', vue: () => VueAchats },
    { id: 'import',   titre: 'Import',    roles: ['patron'], parent: 'plus', vue: () => VueImport },
    { id: 'audit',    titre: 'Journal',   roles: ['patron'], parent: 'plus', vue: () => VueAudit },
    { id: 'reglages', titre: 'Réglages',  roles: ['patron'], parent: 'plus', vue: () => VueReglages }
  ],

  // Bouton « Retour » placé en haut des écrans rangés dans Plus
  htmlRetour() { return '<button class="btn gris petit-btn" data-retour style="margin-bottom:12px">&lsaquo; Retour</button>'; },

  // En-tête d'un écran du menu Plus : bouton Retour + titre
  entete(titre) { return this.htmlRetour() + '<h2>' + esc(titre) + '</h2>'; },
  // Le bouton Retour est géré par un écouteur unique (voir installerEvenements) : rien à brancher ici
  brancherRetour() {},

  estPatron() { return this.role === 'patron'; },
  taux() { return Number(this.reglages.taux) || 2800; },
  nomVendeur() { return this.role === 'patron' ? 'Patron' : 'Vendeur'; },

  // Montant (en USD) affiché dans la devise principale choisie, l'autre devise en petit
  montantHtml(usd) {
    const t = this.taux();
    if (this.reglages.affichage === 'CDF') {
      return '<span class="gras">' + formatCDF(usd * t) + '</span> <small class="petit">' + formatUSD(usd) + '</small>';
    }
    return '<span class="gras">' + formatUSD(usd) + '</span> <small class="petit">' + formatCDF(usd * t) + '</small>';
  },
  montantTexte(usd) { return formatDeuxDevises(usd, this.taux()); },

  // ---------- Démarrage ----------
  async demarrer() {
    try {
      await DB.ouvrir();
      await this.chargerReglages();
    } catch (e) {
      $('#chargement').innerHTML = '<div class="carte"><b>Erreur au démarrage</b><p>' + esc(e.message) +
        '</p><p class="petit">Fermez le mode navigation privée ou libérez de l\'espace sur le téléphone.</p></div>';
      return;
    }
    this.installerEvenements();
    this.enregistrerServiceWorker();
    $('#chargement').hidden = true;
    $('#app').hidden = false;
    this.afficherConnexion();
  },

  async chargerReglages() {
    const r = this.reglages;
    for (const cle of Object.keys(r)) r[cle] = await DB.lireParam(cle, r[cle]);
    // Première ouverture : PIN par défaut (patron 1234, vendeur 0000)
    if (!r.pinPatron) { r.pinPatron = hacher('1234'); await DB.ecrireParam('pinPatron', r.pinPatron); }
    if (!r.pinVendeur) { r.pinVendeur = hacher('0000'); await DB.ecrireParam('pinVendeur', r.pinVendeur); }
    $('#nomBoutique').textContent = r.nomBoutique || 'EvoBuskin';
  },

  async sauverReglage(cle, valeur) {
    this.reglages[cle] = valeur;
    await DB.ecrireParam(cle, valeur);
    if (cle === 'nomBoutique') $('#nomBoutique').textContent = valeur || 'EvoBuskin';
  },

  enregistrerServiceWorker() {
    // Fonctionne en https ou sur localhost. Sans effet (et sans erreur) ailleurs.
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* pas grave : l'app marche quand même en ligne */ });
    }
  },

  installerEvenements() {
    const majReseau = () => {
      const el = $('#etatReseau');
      el.textContent = navigator.onLine ? 'En ligne' : 'Hors ligne';
      el.classList.toggle('hors-ligne', !navigator.onLine);
    };
    window.addEventListener('online', majReseau);
    window.addEventListener('offline', majReseau);
    majReseau();

    $('#btnQuitter').addEventListener('click', () => this.verrouiller());
    // Bouton « Retour » des écrans du menu Plus (un seul écouteur pour tous les écrans)
    $('#vue').addEventListener('click', (e) => { if (e.target.closest('[data-retour]')) this.aller('plus'); });
    ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { this.derniereActivite = Date.now(); }, { passive: true }));
    setInterval(() => {
      if (this.role && Date.now() - this.derniereActivite > this.DELAI_VERROU_MS) {
        this.verrouiller();
        toast('Verrouillé automatiquement');
      }
    }, 20000);

    // Bouton "Installer l'application" proposé par Chrome
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.invitationInstall = e; });
  },

  // ---------- Connexion par PIN ----------
  verrouiller() {
    this.role = null;
    $$('.fond-fenetre').forEach((f) => f.remove());
    document.body.classList.remove('modal-ouvert');
    this.afficherConnexion();
  },

  afficherConnexion() {
    this.role = null;
    $('#menu').hidden = true;
    $('#btnQuitter').hidden = true;
    $('#infoRole').textContent = 'Verrouillé';
    let roleChoisi = 'vendeur';
    let saisie = '';
    const vue = $('#vue');
    vue.innerHTML =
      '<div id="ecranPin">' +
        '<img class="logo-login" src="icons/logo.png" alt="EvoBuskin" width="96" height="96">' +
        '<h2 style="margin:0">EvoBuskin</h2><p class="petit" style="margin:0 0 4px">Qui êtes-vous ?</p>' +
        '<div class="roles"><button data-role="vendeur" class="actif">Vendeur</button><button data-role="patron">Patron</button></div>' +
        '<p class="petit texte-centre">Tapez votre code PIN à 4 chiffres</p>' +
        '<div class="points" id="points"><i></i><i></i><i></i><i></i></div>' +
        '<div class="erreur-pin" id="erreurPin"></div>' +
        '<div class="clavier">' +
          [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => '<button data-n="' + n + '">' + n + '</button>').join('') +
          '<button data-n="eff" aria-label="Effacer">&#9003;</button><button data-n="0">0</button><button data-n="ok" aria-label="Valider">&#10003;</button>' +
        '</div>' +
      '</div>';

    const majPoints = () => $$('#points i').forEach((p, i) => p.classList.toggle('plein', i < saisie.length));
    const erreur = (m) => { $('#erreurPin').textContent = m; };

    const valider = () => {
      const maintenant = Date.now();
      if (maintenant < this.bloquePinJusqua) {
        erreur('Trop d\'essais. Attendez ' + Math.ceil((this.bloquePinJusqua - maintenant) / 1000) + ' secondes.');
        saisie = ''; majPoints(); return;
      }
      if (saisie.length < 4) { erreur('Le code a 4 chiffres'); return; }
      const attendu = roleChoisi === 'patron' ? this.reglages.pinPatron : this.reglages.pinVendeur;
      if (hacher(saisie) === attendu) {
        this.essaisPin = 0;
        this.ouvrirSession(roleChoisi);
        Audit.log('connexion', { role: roleChoisi });
      } else {
        this.essaisPin += 1;
        Audit.log('echec_connexion', { role: roleChoisi, essai: this.essaisPin });
        saisie = ''; majPoints();
        if (this.essaisPin >= 5) {
          this.bloquePinJusqua = maintenant + 30000; this.essaisPin = 0;
          erreur('Trop d\'essais. Patientez 30 secondes.');
        } else {
          erreur('Code incorrect');
        }
      }
    };

    $$('.roles button', vue).forEach((b) => b.addEventListener('click', () => {
      roleChoisi = b.dataset.role;
      $$('.roles button', vue).forEach((x) => x.classList.toggle('actif', x === b));
      saisie = ''; majPoints(); erreur('');
    }));
    $$('.clavier button', vue).forEach((b) => b.addEventListener('click', () => {
      const n = b.dataset.n;
      erreur('');
      if (n === 'eff') saisie = saisie.slice(0, -1);
      else if (n === 'ok') { valider(); return; }
      else if (saisie.length < 4) saisie += n;
      majPoints();
      if (saisie.length === 4 && n !== 'eff') valider();
    }));
  },

  ouvrirSession(role) {
    this.role = role;
    this.derniereActivite = Date.now();
    $('#infoRole').textContent = role === 'patron' ? 'Patron' : 'Vendeur';
    $('#menu').hidden = false;
    $('#btnQuitter').hidden = false;
    const visibles = this.onglets.filter((o) => o.roles.includes(role) && !o.parent);
    $('#menu').innerHTML = visibles.map((o) =>
      '<button data-onglet="' + o.id + '"><span class="ico">' + o.icone + '</span>' + o.titre + '</button>').join('');
    $$('#menu button').forEach((b) => b.addEventListener('click', () => this.aller(b.dataset.onglet)));
    this.aller('caisse');
  },

  async aller(id) {
    const onglet = this.onglets.find((o) => o.id === id);
    if (!onglet || !onglet.roles.includes(this.role)) return; // sécurité : pas d'accès sans le bon rôle
    this.onglet = id;
    $$('#menu button').forEach((b) => b.classList.toggle('actif', b.dataset.onglet === (onglet.parent || id)));
    const vue = $('#vue');
    vue.scrollTop = 0;
    try {
      await onglet.vue().afficher(vue);
    } catch (e) {
      console.error(e);
      vue.innerHTML = '<div class="carte danger"><b>Une erreur est survenue</b><p class="petit">' + esc(e.message) + '</p></div>';
    }
  },

  // Recharge l'écran en cours (après une modification)
  rafraichir() { return this.aller(this.onglet); },

  // ---------- Messages d'avertissement pour le patron ----------
  async bandeaux() {
    if (!this.estPatron()) return '';
    let html = '';
    if (!this.reglages.pinChange) {
      html += '<div class="bandeau rouge">Votre code PIN est celui par défaut (1234). Changez-le dans <b>Réglages</b> pour protéger vos chiffres.</div>';
    }
    const produits = await DB.tout('produits');
    const sansPrix = produits.filter(prixAFixer).length;
    if (sansPrix > 0) {
      html += '<div class="bandeau">' + sansPrix + ' produit(s) attendent leur prix de vente. Allez dans <b>Stock</b> puis « Prix à fixer ».</div>';
    }
    const ageJours = (Date.now() - (this.reglages.derniereSauvegarde || 0)) / 86400000;
    if (produits.length > 0 && ageJours > 7) {
      html += '<div class="bandeau">' + (this.reglages.derniereSauvegarde
        ? 'Dernière sauvegarde il y a ' + Math.floor(ageJours) + ' jours.'
        : 'Aucune sauvegarde faite pour l\'instant.') + ' Faites une sauvegarde dans <b>Réglages</b> (si le téléphone est perdu, les données le sont aussi).</div>';
    }
    return html;
  }
};

window.addEventListener('DOMContentLoaded', () => App.demarrer());
