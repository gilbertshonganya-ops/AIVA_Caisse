/* EvoBuskin - noyau de l'application
   Démarrage, réglages, connexion par PIN, navigation entre les écrans. */
const App = {
  // Réglages par défaut (modifiables dans l'écran Réglages)
  reglages: { taux: 2800, nomBoutique: 'Ma Boutique', telBoutique: '', affichage: 'USD', derniereSauvegarde: 0 },
  role: null,            // 'patron' ou 'vendeur' (null = verrouillé)
  businessId: null,      // fourni par le profil serveur, jamais par le frontend
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
    { id: 'reglages', titre: 'Réglages',  roles: ['patron'], parent: 'plus', vue: () => VueReglages },
    { id: 'equipe',   titre: 'Équipe',    roles: ['patron'], parent: 'plus', vue: () => VueEquipe }
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
    const recoveryToken = window.AuthUI?.recupererTokenDeRecuperation?.();
    if (recoveryToken) AuthUI.afficherNouveauMotDePasse(recoveryToken);
    else this.afficherConnexion();
  },

  async chargerReglages() {
    const r = this.reglages;
    for (const cle of Object.keys(r)) r[cle] = await DB.lireParam(cle, r[cle]);
    // Les anciens PIN locaux ne servent plus à authentifier un compte SaaS.
    // Ils pourront éventuellement être conservés plus tard comme verrouillage local
    // après authentification, mais jamais comme preuve d'identité côté serveur.
    $('#nomBoutique').textContent = r.nomBoutique || 'EvoBuskin';
  },

  async sauverReglage(cle, valeur) {
    this.reglages[cle] = valeur;
    await DB.ecrireParam(cle, valeur);
    if (cle === 'nomBoutique') $('#nomBoutique').textContent = valeur || 'EvoBuskin';
    // Les réglages partagés suivent le compte, pas le navigateur. Les changements
    // restent en file locale hors connexion puis sont envoyés par SyncManager.
    if (this.role === 'patron' && this.businessId && ['nomBoutique', 'telBoutique', 'affichage'].includes(cle)) {
      try { await SyncManager.mettreEnFile('settings_update', { p_settings: { [cle]: valeur } }); }
      catch (e) { console.warn('Réglage local conservé; synchronisation serveur en attente.', e); }
    }
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
    $('#vue').addEventListener('click', async (e) => {
      const bouton = e.target.closest('#btnRetrySync');
      if (!bouton) return;
      bouton.disabled = true;
      try {
        await SyncManager.retryBlocked();
        await SyncManager.syncNow();
        const cloud = await CloudSnapshotSync.tirer({ force: true });
        const enAttente = await DB.syncQueueListe({ businessId: this.businessId });
        if (!enAttente.length && cloud.ok) toast('Toutes les opérations sont synchronisées.', 'ok');
        else toast(enAttente.length + ' opération(s) restent à synchroniser. Consultez le message d’erreur et vérifiez la connexion.', 'erreur');
      } catch (err) { toast('Synchronisation impossible : ' + (err.message || err), 'erreur'); }
      finally { if (bouton.isConnected) bouton.disabled = false; await this.rafraichir(); }
    });
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

  // ---------- Authentification SaaS ----------
  verrouiller() {
    this.role = null;
    this.businessId = null;
    SyncManager.stop();
    CatalogueSync.arreter();
    CloudSnapshotSync.arreter();
    SyncManager.configure(null);
    $$('.fond-fenetre').forEach((f) => f.remove());
    document.body.classList.remove('modal-ouvert');
    Auth.signOut().finally(() => this.afficherConnexion());
  },

  afficherConnexion() {
    this.role = null;
    if (window.AuthUI) AuthUI.afficherConnexion();
  },

  async apresAuthentification(data) {
    const session = data || Auth.getSession();
    const user = session?.user;
    if (!user) throw new Error('Session d’authentification introuvable.');

    // Le rôle doit venir de la base sécurisée, jamais d'un champ contrôlé par le client.
    // Le profil sera créé/attribué par le backend Supabase dans l'étape suivante.
    let profile = null;
    try {
      profile = await Auth.getProfile(user.id, session.access_token);
    } catch (e) {
      throw new Error('Impossible de charger votre profil sécurisé. Vérifiez la configuration Supabase.');
    }
    if (!profile || !profile.role || !['patron', 'vendeur'].includes(profile.role)) {
      throw new Error('Votre compte est créé, mais votre rôle n’est pas encore configuré. Contactez l’administrateur.');
    }
    this.role = profile.role;
    this.businessId = profile.business_id;
    if (!this.businessId) throw new Error('Boutique sécurisée introuvable.');
    if (profile.role === 'patron') {
      const mfa = (window.AUTH_CONFIG && window.AUTH_CONFIG.requireMfa === true) ? await Auth.requirePatronMfa() : { enrolled: true, aal2: true };
      if (!mfa.enrolled || !mfa.aal2) {
        AuthUI.afficherMfaSetup(mfa, () => this.apresAuthentification(Auth.getSession()));
        return;
      }
    }
    SyncManager.configure(this.businessId);
    // Réessayer d'abord les opérations locales en attente, puis télécharger l'état serveur.
    await SyncManager.syncNow();
    SyncManager.start();
    this.reglages.nomBoutique = profile.business_name || this.reglages.nomBoutique;
    $('#nomBoutique').textContent = this.reglages.nomBoutique || 'EvoBuskin';
    // Télécharger le jeu de données partagé AVANT d'ouvrir les écrans :
    // ventes, dettes, achats, dépenses et rapports viennent du serveur sur chaque appareil.
    const cloudPull = await CloudSnapshotSync.demarrer(this.businessId);
    if (cloudPull?.raison === 'appareil-autre-boutique') {
      const message = 'Cet appareil contient déjà les données d’une autre boutique. Pour éviter de mélanger deux commerces, utilisez un autre téléphone ou un profil de navigateur séparé.';
      this.role = null; this.businessId = null;
      await Auth.signOut();
      throw new Error(message);
    }
    if (!cloudPull?.ok && cloudPull?.raison !== 'hors-ligne') {
      toast('Données serveur non téléchargées. Vérifiez la connexion et exécutez la migration V18 avant de gérer les ventes.', 'erreur');
    }
    if (profile.role === 'vendeur') CatalogueSync.demarrer(this.businessId);
    this.ouvrirSession(profile.role);
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
    let html = '';
    if (this.businessId) {
      const file = await DB.syncQueueListe({ businessId: this.businessId });
      const bloquees = file.filter((x) => x.status === 'blocked' || x.status === 'failed');
      const enAttente = file.filter((x) => x.status === 'pending' || x.status === 'sending');
      if (file.length) {
        const dernierMessage = file.slice().reverse().find((x) => x.lastError)?.lastError;
        html += '<div class="bandeau ' + (bloquees.length ? 'rouge' : '') + '"><b>Synchronisation serveur</b> : ' +
          enAttente.length + ' en attente, ' + bloquees.length + ' en échec/bloquée.' +
          (dernierMessage ? '<div class="petit">Dernière erreur : ' + esc(dernierMessage) + '</div>' : '') +
          '<button class="btn contour" id="btnRetrySync" style="margin-top:8px">Réessayer la synchronisation</button></div>';
      }
    }
    if (!this.estPatron()) return html;
    const produits = (await DB.tout('produits')).filter((p) => p.actif !== false);
    const sansPrix = produits.filter(prixAFixer).length;
    if (sansPrix > 0) {
      html += '<div class="bandeau">' + sansPrix + ' produit(s) attendent leur prix de vente. Allez dans <b>Stock</b> puis « Prix à fixer ».</div>';
    }
    const ageJours = (Date.now() - (this.reglages.derniereSauvegarde || 0)) / 86400000;
    if (produits.length > 0 && ageJours > 7) {
      html += '<div class="bandeau">' + (this.reglages.derniereSauvegarde
        ? 'Dernière sauvegarde locale il y a ' + Math.floor(ageJours) + ' jours.'
        : 'Aucune sauvegarde locale faite pour l’instant.') + ' Les opérations synchronisées sont conservées sur le serveur; gardez aussi une copie de sauvegarde indépendante dans <b>Réglages</b>.</div>';
    }
    return html;
  }
};

window.addEventListener('DOMContentLoaded', () => App.demarrer());
