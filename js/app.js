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
  sansJeton: false,      // true = ouvert sans Internet, sans jeton serveur (envoi en attente)

  // Liste des écrans. "roles" = qui a le droit de les voir. "parent" = écran rangé dans le menu Plus.
  onglets: [
    { id: 'caisse',   titre: 'Caisse',   icone: '\u{1F6D2}', roles: ['patron', 'vendeur'], vue: () => VueCaisse },
    { id: 'stock',    titre: 'Stock',    icone: '\u{1F4E6}', roles: ['patron', 'vendeur'], vue: () => VueStock },
    { id: 'dettes',   titre: 'Dettes',   icone: '\u{1F4D2}', roles: ['patron', 'vendeur'], vue: () => VueDettes },
    { id: 'rapports', titre: 'Rapports', icone: '\u{1F4CA}', roles: ['patron'],            vue: () => VueRapports },
    { id: 'compte',   titre: 'Réglages',   icone: '\u2699\uFE0F', roles: ['vendeur'],           vue: () => VueCompte },
    { id: 'plus',     titre: 'Plus',     icone: '\u2630',    roles: ['patron'],            vue: () => VuePlus },
    { id: 'depenses', titre: 'Dépenses',  roles: ['patron'], parent: 'plus', vue: () => VueDepenses },
    { id: 'achats',   titre: 'Achats',    roles: ['patron'], parent: 'plus', vue: () => VueAchats },
    { id: 'import',   titre: 'Import',    roles: ['patron'], parent: 'plus', vue: () => VueImport },
    { id: 'audit',    titre: 'Journal',   roles: ['patron'], parent: 'plus', vue: () => VueAudit },
    { id: 'reglages', titre: 'Réglages',  roles: ['patron'], parent: 'plus', vue: () => VueReglages },
    { id: 'equipe',   titre: 'Équipe',    roles: ['patron'], parent: 'plus', vue: () => VueEquipe },
    { id: 'boutiques', titre: 'Mes boutiques', roles: ['patron'], parent: 'plus', vue: () => VueBoutiques },
    { id: 'abonnement', titre: 'Mon abonnement', roles: ['patron'], parent: 'plus', vue: () => VueAbonnement },
  ],

  // Bouton « Retour » placé en haut des écrans rangés dans Plus
  htmlRetour() { return '<button class="btn gris petit-btn" data-retour style="margin-bottom:12px">&lsaquo; Retour</button>'; },

  // En-tête d'un écran du menu Plus : bouton Retour + titre
  entete(titre) { return this.htmlRetour() + '<h2>' + esc(titre) + '</h2>'; },
  // Le bouton Retour est géré par un écouteur unique (voir installerEvenements) : rien à brancher ici
  brancherRetour() {},

  estPatron() { return this.role === 'patron'; },
  taux() { return Number(this.reglages.taux) || 2800; },
  nomComplet: '',
  nomVendeur() { return this.nomComplet || (this.role === 'patron' ? 'Patron' : 'Vendeur'); },

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
    if (recoveryToken) { AuthUI.afficherNouveauMotDePasse(recoveryToken); return; }
    Abonnement.lireRetourPaiement();
    await this.restaurerSession();
  },

  // Session longue : un simple rafraîchissement de la page (ou la fermeture/réouverture de l'application)
  // ne demande plus le mot de passe. Fonctionne aussi sans Internet grâce au profil gardé sur l'appareil.
  async restaurerSession() {
    const session = Auth.getSession();
    if (!session || !session.user) { this.afficherConnexion(); return; }
    try {
      await Chargeur.pendant(async () => {
        if (navigator.onLine) { try { await Auth.ensureFreshSession(); } catch (e) { if (!e.reseau) throw e; } }
        await this.apresAuthentification(Auth.getSession() || session);
      }, 'Ouverture de votre boutique…');
    } catch (e) {
      console.warn('Session non restaurée :', e);
      if (!Auth.getSession() && !(Reseau.estErreurReseau(e))) { this.afficherConnexion(); return; }
      this.afficherConnexion();
      const m = $('#authMessage'); if (m) { m.textContent = Reseau.traduire(e); m.className = 'auth-message erreur'; }
    }
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

    $('#btnQuitter').addEventListener('click', async () => {
      if (await confirmer('Se déconnecter', 'Vous devrez retaper votre mot de passe pour revenir dans l’application.', 'Se déconnecter')) this.deconnecter();
    });
    // Bouton « Retour » des écrans du menu Plus (un seul écouteur pour tous les écrans)
    $('#vue').addEventListener('click', (e) => { if (e.target.closest('[data-retour]')) this.aller('plus'); });
    $('#vue').addEventListener('click', async (e) => {
      if (e.target.closest('#btnAbandonSync')) { this.abandonnerBloquees(); return; }
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
      } catch (err) { toast(Reseau.estErreurReseau(err) ? Reseau.MESSAGE : 'Synchronisation impossible : ' + (err.message || err), 'erreur'); }
      finally { if (bouton.isConnected) bouton.disabled = false; await this.rafraichir(); }
    });
    ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { this.derniereActivite = Date.now(); }, { passive: true }));
    // Retour d'Internet : on propose de se reconnecter si l'ouverture s'est faite sans Internet
    window.addEventListener('online', () => {
      AuthHorsLigne.envoyerEchecsEnAttente();
      if (this.role && this.sansJeton && !Auth.getSession()) toast('Connexion rétablie. Reconnectez-vous pour envoyer vos ventes.', 'ok');
    });
    $('#vue').addEventListener('click', (e) => {
      if (e.target.closest('#btnReconnecter')) this.reconnecter();
      if (e.target.closest('[data-aller-compte]')) this.aller(this.estPatron() ? 'reglages' : 'compte');
      if (e.target.closest('[data-aller-abonnement]')) this.aller('abonnement');
    });
    $('#nomBoutique').addEventListener('click', () => { if (this.estPatron() && this.role) this.aller('boutiques'); });

    // Bouton "Installer l'application" proposé par Chrome
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.invitationInstall = e; });
  },

  // ---------- Authentification SaaS ----------
  verrouiller() {
    this.role = null;
    this.businessId = null;
    this.sansJeton = false;
    this.suppressionPrevue = null;
    TempsReel.arreter();
    Abonnement.arreter();
    SyncManager.stop();
    CloudSnapshotSync.arreter();
    SyncManager.configure(null);
    $$('.fond-fenetre').forEach((f) => f.remove());
    document.body.classList.remove('modal-ouvert');
    Auth.signOut().finally(() => this.afficherConnexion());
  },

  // Déconnexion volontaire : on note l'événement dans le journal AVANT de fermer la session
  async deconnecter() {
    try {
      if (this.businessId && navigator.onLine && Auth.getSession()) {
        await Promise.race([
          CloudDB.rpc('v19_log_event', { p_business_id: this.businessId, p_action: 'deconnexion', p_payload: { par: this.nomVendeur() }, p_op_id: SyncManager.uuid() }),
          new Promise((ok) => setTimeout(ok, 2500))
        ]);
      }
      await Audit.log('deconnexion', {});
    } catch (_) { /* la déconnexion ne doit jamais être bloquée */ }
    this.verrouiller();
  },

  afficherConnexion() {
    this.role = null;
    if (window.AuthUI) AuthUI.afficherConnexion();
  },

  async apresAuthentification(data) {
    const session = data || Auth.getSession();
    const user = session?.user;
    if (!user) throw new Error('Session d’authentification introuvable.');

    this.nomComplet = String(user.user_metadata?.full_name || '').trim();
    // Le rôle doit venir de la base sécurisée, jamais d'un champ contrôlé par le client.
    // Le profil sera créé/attribué par le backend Supabase dans l'étape suivante.
    let profile = null;
    try {
      profile = await Auth.getProfile(user.id, session.access_token);
      if (profile) AuthHorsLigne.memoriserProfil(user.id, profile);
    } catch (e) {
      if (e.status === 401 || e.status === 403) {
        Auth.clearSession();
        throw new Error('Votre session a expiré. Reconnectez-vous.');
      }
      // Pas d'Internet ou serveur momentanément indisponible : profil gardé sur l'appareil
      profile = AuthHorsLigne.profil(user.id);
      if (!profile) throw (Reseau.estErreurReseau(e) || !navigator.onLine ? Reseau.erreur() : new Error('Impossible de charger votre profil. Réessayez dans un instant.'));
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
      toast('Vos données n’ont pas pu être mises à jour. Vérifiez votre connexion puis réessayez.', 'erreur');
    }
    TempsReel.demarrer(this.businessId);
    Abonnement.demarrer();
    this.ouvrirSession(profile.role);
    if (profile.role === 'patron' && Abonnement.paiementEnAttente()) this.aller('abonnement');
    this.verifierSuppression();
  },

  // Changer de boutique (patron avec plusieurs boutiques). Les données de chaque boutique restent en ligne ;
  // l'appareil ne garde que celles de la boutique ouverte, après avoir tout envoyé.
  async changerBoutique(id) {
    if (!navigator.onLine || !Auth.getSession()) throw Reseau.erreur();
    if (String(id) === String(this.businessId)) return;
    await SyncManager.syncNow();
    const enAttente = (await DB.syncQueueListe({ businessId: this.businessId })).filter((x) => x.status !== 'synced');
    if (enAttente.length) throw new Error('PENDING_OPERATIONS');
    await CloudDB.rpc('v19_set_active_business', { p_business_id: id });
    SyncManager.stop(); CloudSnapshotSync.arreter(); TempsReel.arreter(); Abonnement.arreter(); SyncManager.configure(null);
    await DB.toutEffacer(['audit', 'sync_queue']);
    Object.assign(this.reglages, { taux: 2800, nomBoutique: 'Ma Boutique', telBoutique: '', affichage: 'USD', derniereSauvegarde: 0 });
    this.suppressionPrevue = null;
    await this.apresAuthentification(Auth.getSession());
  },

  // Abandonne les opérations bloquées (elles ne seront jamais envoyées) — après confirmation
  async abandonnerBloquees() {
    const uid = DB.uidCourant();
    const bloquees = (await DB.syncQueueListe({ businessId: this.businessId, userId: uid })).filter((x) => x.status === 'blocked' || x.status === 'failed');
    if (!bloquees.length) return;
    if (!(await confirmer('Abandonner les opérations bloquées', bloquees.length + ' opération(s) ne seront jamais envoyées au serveur (par exemple une vente de test). Cette action est définitive.', 'Abandonner', true))) return;
    for (const r of bloquees) await DB.marquerSync(r.id, { status: 'synced', lastError: 'Abandonnée par l\'utilisateur' });
    toast(bloquees.length + ' opération(s) abandonnée(s)', 'ok');
    this.rafraichir();
  },

  // Suppression de compte demandée ? (affiche un rappel avec le bouton Annuler)
  async verifierSuppression() {
    try {
      if (!navigator.onLine || !Auth.getSession()) return;
      const quand = await CloudDB.rpc('v19_account_deletion_status', {});
      this.suppressionPrevue = quand || null;
    } catch (_) { /* sans importance */ }
  },

  // Connexion sans Internet : le profil vient de l'appareil (voir auth-hors-ligne.js)
  async ouvrirSessionHorsLigne(user, profile) {
    this.role = profile.role;
    this.businessId = profile.business_id;
    this.sansJeton = !Auth.getSession();
    this.utilisateurLocal = user;
    this.nomComplet = String(user.user_metadata?.full_name || '').trim();
    SyncManager.configure(this.businessId);
    this.reglages.nomBoutique = profile.business_name || this.reglages.nomBoutique;
    $('#nomBoutique').textContent = this.reglages.nomBoutique || 'EvoBuskin';
    Abonnement.demarrer();
    this.ouvrirSession(profile.role);
    toast('Mode hors ligne : vos ventes seront envoyées dès le retour d’Internet.');
  },

  // Après une ouverture hors ligne : se reconnecter avec Internet pour envoyer les opérations en attente
  reconnecter() {
    const email = this.utilisateurLocal?.email || '';
    const f = ouvrirFenetre('Reconnexion au serveur',
      '<p class="petit">Entrez votre mot de passe pour envoyer vos ventes et mettre à jour vos données.</p>' +
      '<label class="champ"><span>Mot de passe</span><input id="rcMdp" type="password" autocomplete="current-password"></label>' +
      '<div class="bandeau rouge" id="rcErr" hidden></div><button class="btn" id="rcOk">Se reconnecter</button>');
    $('#rcOk', f.el).addEventListener('click', async () => {
      const mdp = $('#rcMdp', f.el).value;
      if (!mdp) return;
      try {
        const data = await Auth.signIn(email, mdp);
        f.fermer();
        this.sansJeton = false; await this.apresAuthentification(data);
      } catch (e) { const er = $('#rcErr', f.el); er.textContent = /invalid login/i.test(e.message || '') ? 'Mot de passe incorrect.' : Reseau.traduire(e); er.hidden = false; }
    });
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
    // Fonctions réservées à certains niveaux d'abonnement (le serveur applique aussi la règle)
    const exigence = { achats: 'purchases', depenses: 'expenses', import: 'import' }[id];
    if (exigence && !Abonnement.peut(exigence)) { Abonnement.pageBloquee(vue, exigence, onglet.titre); return; }
    try {
      await onglet.vue().afficher(vue);
    } catch (e) {
      console.error(e);
      vue.innerHTML = '<div class="carte danger"><b>Une erreur est survenue</b><p class="petit">' + esc(Reseau.traduire(e)) + '</p></div>';
    }
  },

  // Recharge l'écran en cours (après une modification)
  rafraichir() { return this.aller(this.onglet); },

  // ---------- Messages d'avertissement pour le patron ----------
  async bandeaux() {
    let html = Abonnement.bandeau();
    if (this.suppressionPrevue) {
      html += '<div class="bandeau rouge"><b>Suppression de votre compte prévue le ' + esc(formatDate(new Date(this.suppressionPrevue).getTime())) + '.</b> Vos données seront alors effacées définitivement.' +
        '<button class="btn contour" data-aller-compte style="margin-top:8px">Voir / annuler</button></div>';
    }
    if (this.sansJeton && navigator.onLine && !Auth.getSession()) {
      html += '<div class="bandeau"><b>Mode hors ligne</b> : vos opérations ne sont pas encore envoyées.' +
        '<button class="btn contour" id="btnReconnecter" style="margin-top:8px">Se reconnecter pour envoyer</button></div>';
    }
    if (this.businessId) {
      const uid = DB.uidCourant();
      const toutes = await DB.syncQueueListe({ businessId: this.businessId });
      const file = toutes.filter((x) => !x.userId || x.userId === uid);
      const autresComptes = toutes.length - file.length;
      const bloquees = file.filter((x) => x.status === 'blocked' || x.status === 'failed');
      const enAttente = file.filter((x) => x.status === 'pending' || x.status === 'sending');
      if (file.length) {
        const dernierMessage = file.slice().reverse().find((x) => x.lastError)?.lastError;
        html += '<div class="bandeau ' + (bloquees.length ? 'rouge' : '') + '"><b>Envoi des données</b> : ' +
          enAttente.length + ' en attente, ' + bloquees.length + ' en échec/bloquée.' +
          (dernierMessage ? '<div class="petit">Dernière erreur : ' + esc(Reseau.lisible(dernierMessage)) + '</div>' : '') +
          '<button class="btn contour" id="btnRetrySync" style="margin-top:8px">Réessayer la synchronisation</button>' +
          (bloquees.length ? '<button class="btn gris" id="btnAbandonSync" style="margin:8px 0 0 8px">Abandonner les opérations bloquées</button>' : '') + '</div>';
      }
      if (autresComptes > 0) html += '<div class="bandeau">' + autresComptes + ' opération(s) enregistrée(s) avec un autre compte sur ce téléphone seront envoyées dès que ce compte se reconnecte.</div>';
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
