/* EvoBuskin - JOURNAL D'ACTIVITÉ (patron)
   Qui a fait quoi, quand, dans quelle boutique. Phrases simples, filtres par date, boutique, vendeur et type.
   Les informations viennent de votre compte en ligne ; sans Internet, la dernière version enregistrée est affichée. */
const VueAudit = {
  etat: { boutique: '', acteur: '', categorie: '' },
  periode: Periode.nouveau('jour'), // « Aujourd'hui » ou « Autre date » : exactement comme dans les Rapports
  lignes: [], boutiques: [], depuisCache: false, dateCache: 0,

  CATEGORIES: {
    securite: ['connexion', 'deconnexion', 'connexion_echec', 'mot_de_passe_oublie', 'mot_de_passe_modifie', 'mot_de_passe_incorrect'],
    ventes: ['vente', 'vente_annulee', 'vente_annulee'],
    stock: ['produit_cree', 'produit_modifie', 'produit_desactive', 'produit_supprime', 'stock_ajuste', 'stock_entree', 'stock_sortie', 'inventaire', 'inventaire_ecart', 'import_produits', 'achat', 'achat_fournisseur'],
    argent: ['dette_client_ajoutee', 'dette_ajoutee', 'paiement_dette_client', 'paiement_dette', 'paiement_fournisseur', 'depense_ajoutee', 'depense_supprimee', 'taux_change', 'taux_modifie', 'client_cree', 'client_modifie', 'client_desactive', 'client_supprime', 'fournisseur_cree', 'fournisseur_modifie', 'fournisseur_desactive', 'fournisseur_supprime'],
    equipe: ['invitation_creee', 'invitation_utilisee', 'invitation_revoquee', 'invitation_supprimee', 'invitations_nettoyees', 'vendeur_rejoint_equipe', 'vendeur_retrait_equipe', 'patron_compte_cree', 'vendeur_retire']
  },
  ALERTES: ['connexion_echec', 'mot_de_passe_oublie', 'mot_de_passe_incorrect'],

  // Transforme un événement en phrases compréhensibles : { icone, titre, detail: [lignes] }
  phrase(e) {
    const p = e.payload || {}, nom = e.subject || '';
    const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; };
    const usd = (v) => formatUSD(num(v));
    const qte = (v) => formatQuantite(num(v));
    const signe = (v) => (num(v) > 0 ? '+' : '−') + qte(Math.abs(num(v)));
    const t = p.texte ? String(p.texte) : '';
    const mode = (m) => (typeof LIBELLES_MODE !== 'undefined' && LIBELLES_MODE[m]) || m || '';
    const cap = (x) => String(x).charAt(0).toUpperCase() + String(x).slice(1);
    const val = (v) => (v === null || v === undefined || v === '' ? '—' : (typeof v === 'number' ? String(v).replace('.', ',') : String(v)));
    // « Prix de vente : 5 → 6 » pour chaque champ modifié (avant → après)
    const diff = (exclure) => Object.entries(p).filter(([k, v]) => !exclure.includes(k) && Array.isArray(v) && v.length === 2)
      .map(([k, v]) => cap(k) + ' : ' + val(v[0]) + ' → ' + val(v[1]));
    const articles = () => Array.isArray(p.articles) && p.articles.length
      ? ['Articles : ' + p.articles.map((a) => a.nom + ' ×' + formatQuantite(a.qte) + (a.total != null ? ' (' + usd(a.total) + ')' : (a.prix ? ' à ' + a.prix : ''))).join(' · ')] : [];
    const L = (...l) => l.flat().filter(Boolean);

    const P = {
      connexion: ['🔓', 'S’est connecté(e)', [p.mode === 'sans Internet' ? 'Sans connexion Internet' : '']],
      deconnexion: ['🔒', 'S’est déconnecté(e)', []],
      connexion_echec: ['⚠️', 'Tentative de connexion refusée', ['Adresse email ou mot de passe incorrect']],
      mot_de_passe_oublie: ['🔑', 'A demandé un lien pour retrouver son mot de passe', []],
      mot_de_passe_modifie: ['🔑', 'A changé son mot de passe', []],
      mot_de_passe_incorrect: ['⚠️', 'Mot de passe actuel incorrect lors d’un changement de mot de passe', []],
      vente: ['🛒', 'Vente de ' + usd(p.total) + (p.client ? ' à ' + p.client : ''),
        L(articles(),
          'Payé par : ' + (mode(p.mode) || '—') + (p.devise === 'CDF' ? ' (en francs)' : '') + (p.reference ? ' · réf. ' + p.reference : ''),
          'Total : ' + usd(p.total) + ' · Payé : ' + usd(p.paye != null ? p.paye : num(p.total) - num(p.reste)) + ' · Reste à payer : ' + usd(p.reste || 0))],
      vente_annulee: ['↩️', 'Vente annulée' + (p.id ? ' n°' + p.id : ''), L(p.total != null ? 'Total : ' + usd(p.total) : '', p.mode ? 'Payée par : ' + mode(p.mode) : '')],
      produit_cree: ['📦', 'Produit ajouté : ' + (p.nom || nom),
        L(p.categorie ? 'Catégorie : ' + p.categorie : '', p.prixAchat != null ? 'Prix d’achat : ' + val(p.prixAchat) + ' ' + (p.devise || '') : '',
          p.prixVente != null ? 'Prix de vente : ' + (p.prixVente === 'à fixer' ? 'à fixer' : val(p.prixVente) + ' ' + (p.devise || '').trim()) : '',
          p.stock != null ? 'Stock de départ : ' + qte(p.stock) : '', p.via ? 'Ajouté via : ' + p.via : '')],
      produit_modifie: ['✏️', 'Produit modifié : ' + (p.produit || nom), diff(['produit'])],
      produit_desactive: ['🗑️', 'Produit supprimé : ' + (p.nom || nom), L(p.stock != null ? 'Stock au moment de la suppression : ' + qte(p.stock) : '')],
      stock_entree: ['📥', 'Entrée de stock : ' + (p.produit || nom), L('Quantité : +' + qte(p.qte), p.note ? 'Motif : ' + p.note : '')],
      stock_sortie: ['📤', 'Sortie de stock : ' + (p.produit || nom), L('Quantité : −' + qte(p.qte), p.note ? 'Motif : ' + p.note : '')],
      stock_ajuste: ['📦', 'Stock ajusté' + (nom ? ' : ' + nom : ''), L(p.delta != null ? signe(p.delta) : '', p.nouveau_stock != null ? 'Nouveau stock : ' + qte(p.nouveau_stock) : '')],
      inventaire: ['📋', 'Inventaire' + (nom ? ' : ' + nom : ''), L(p.corrections != null ? p.corrections + ' correction(s) de stock' : '', p.details || '', p.delta != null ? 'Écart constaté : ' + signe(p.delta) : '')],
      inventaire_ecart: ['📋', 'Inventaire terminé avec des écarts', [t]],
      import_produits: ['📥', 'Produits importés', [t]],
      achat: ['🚚', 'Achat de marchandises' + (p.fournisseur ? ' chez ' + p.fournisseur : ''),
        L(articles(), p.total != null ? 'Total : ' + usd(p.total) + ' · Payé : ' + usd(p.paye || 0) + ' · Reste à payer : ' + usd(p.reste || 0) : t)],
      achat_fournisseur: ['🚚', 'Achat de marchandises : ' + usd(p.total), [num(p.reste) > 0.005 ? 'Reste à payer au fournisseur : ' + usd(p.reste) : 'Payé en totalité']],
      paiement_fournisseur: ['💵', 'Paiement au fournisseur' + (p.fournisseur || nom ? ' ' + (p.fournisseur || nom) : ''),
        L('Montant : ' + usd(p.montant != null ? p.montant : (p.amount_usd != null ? p.amount_usd : p.amount)) + (p.devise === 'CDF' ? ' (payé en francs)' : ''), p.reste != null ? 'Reste dû : ' + usd(p.reste) : t)],
      paiement_dette: ['💵', (p.client || nom || 'Un client') + ' a payé sur sa dette',
        L('Montant : ' + usd(p.montant) + (p.mode ? ' · ' + mode(p.mode) : '') + (p.devise === 'CDF' ? ' (en francs)' : ''), p.reste != null ? 'Reste à payer : ' + usd(p.reste) : '')],
      paiement_dette_client: ['💵', (nom || 'Un client') + ' a payé sur sa dette', [usd(p.amount_usd) + (p.mode ? ' · ' + mode(p.mode) : '')]],
      dette_ajoutee: ['📒', 'Dette ajoutée à ' + (p.client || nom), ['Montant : ' + usd(p.montant)]],
      dette_client_ajoutee: ['📒', 'Dette ajoutée' + (nom ? ' à ' + nom : ''), [usd(p.amount_usd)]],
      client_cree: ['👤', 'Client ajouté : ' + (p.nom || ''), L(p.tel && p.tel !== '-' ? 'Téléphone : ' + p.tel : '')],
      client_modifie: ['👤', 'Client modifié : ' + (p.client || nom), diff(['client'])],
      client_desactive: ['🗑️', 'Client supprimé : ' + (p.nom || nom), []],
      fournisseur_cree: ['🚚', 'Fournisseur ajouté : ' + (p.nom || ''), L(p.tel && p.tel !== '-' ? 'Téléphone : ' + p.tel : '')],
      fournisseur_modifie: ['🚚', 'Fournisseur modifié : ' + (p.fournisseur || nom), diff(['fournisseur'])],
      fournisseur_supprime: ['🗑️', 'Fournisseur supprimé : ' + (p.fournisseur || nom), []],
      fournisseur_desactive: ['🗑️', 'Fournisseur supprimé' + (nom ? ' : ' + nom : ''), []],
      depense_ajoutee: ['💸', 'Dépense ajoutée', L(t, p.amount_usd != null ? usd(p.amount_usd) : (p.amount != null ? usd(p.amount) : ''))],
      depense_supprimee: ['💸', 'Dépense supprimée', [t]],
      taux_modifie: ['💱', 'Taux de change modifié', Array.isArray(p.taux) ? ['Avant : 1 $ = ' + val(p.taux[0]) + ' FC → Après : 1 $ = ' + val(p.taux[1]) + ' FC'] : []],
      taux_change: ['💱', 'Taux de change modifié', [p.rate ? '1 $ = ' + Math.round(num(p.rate)).toLocaleString('fr-FR') + ' FC' : '']],
      reglages_modifies: ['⚙️', 'Réglages de la boutique modifiés', []],
      invitation_creee: ['✉️', 'Code d’invitation créé pour un vendeur', []],
      invitation_utilisee: ['✉️', 'Un vendeur a utilisé son code d’invitation', []],
      invitation_revoquee: ['✉️', 'Invitation annulée', []],
      invitation_supprimee: ['🗑️', 'Invitation supprimée', [p.nom || '']],
      invitations_nettoyees: ['🧹', 'Invitations expirées supprimées', [(p.nombre || 0) + ' invitation(s)']],
      vendeur_rejoint_equipe: ['👥', 'Un vendeur a rejoint l’équipe', []],
      vendeur_retrait_equipe: ['👥', 'Accès d’un vendeur retiré', []],
      patron_compte_cree: ['🏪', 'Compte et boutique créés', []],
      boutique_creee: ['🏪', 'Nouvelle boutique créée', [p.nom || t]],
      boutique_modifiee: ['🏪', 'Boutique renommée', [p.nom || t]],
      sauvegarde: ['💾', 'Sauvegarde des données', []],
      restauration: ['💾', 'Données restaurées depuis une sauvegarde', []],
      compte_suppression_demandee: ['⚠️', 'Suppression du compte demandée', [p.effacement_le ? 'Effacement définitif le ' + formatDate(new Date(p.effacement_le).getTime()) : '']],
      compte_suppression_annulee: ['✅', 'Suppression du compte annulée', []]
    };
    const x = P[e.action];
    if (x) return { icone: x[0], titre: x[1], detail: (x[2] || []).filter((l) => l && String(l).trim()) };
    const lisible = String(e.action || 'Activité').replace(/_/g, ' ');
    return { icone: '•', titre: cap(lisible), detail: t ? [t] : [] };
  },

  bornes() {
    const b = Periode.bornes(this.periode);
    return { du: b.debut, au: b.fin };
  },

  async charger() {
    const { du, au } = this.bornes();
    const cleCache = 'journalCache';
    try {
      if (!navigator.onLine) throw Reseau.erreur();
      const [boutiques, lignes] = await Promise.all([
        CloudDB.rpc('v19_my_businesses', {}),
        CloudDB.rpc('v19_audit_feed', { p_business_id: this.etat.boutique || null, p_from: du > 0 ? new Date(du).toISOString() : null, p_to: isFinite(au) ? new Date(au).toISOString() : null, p_actor: null, p_limit: 1000 })
      ]);
      this.boutiques = boutiques || []; this.lignes = lignes || []; this.depuisCache = false;
      await DB.ecrireParam(cleCache, { boutiques: this.boutiques, lignes: this.lignes, du, au, boutique: this.etat.boutique, at: Date.now() });
    } catch (e) {
      const c = await DB.lireParam(cleCache, null);
      if (!c) throw e;
      this.boutiques = c.boutiques || []; this.depuisCache = true; this.dateCache = c.at;
      this.lignes = (c.lignes || []).filter((l) => { const t = new Date(l.created_at).getTime(); return t >= du && t < au && (!this.etat.boutique || l.business_id === this.etat.boutique); });
    }
  },

  filtrees() {
    const s = this.etat, cat = s.categorie ? this.CATEGORIES[s.categorie] : null;
    return this.lignes.filter((l) => (!s.acteur || l.actor_user_id === s.acteur) && (!cat || cat.includes(l.action)));
  },

  nomActeur(l) {
    const p = l.payload || {};
    return String(p.par && p.par !== 'Patron' && p.par !== 'Vendeur' ? p.par : l.actor_name || 'Utilisateur');
  },

  libelleJour(ts) {
    const d = new Date(ts); d.setHours(0, 0, 0, 0);
    const auj = new Date(); auj.setHours(0, 0, 0, 0);
    const diff = Math.round((auj - d) / 86400000);
    return diff === 0 ? 'Aujourd’hui' : diff === 1 ? 'Hier' : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  },

  async afficher(conteneur) {
    this.conteneur = conteneur;
    conteneur.innerHTML = App.entete('Journal d’activité') + '<p class="petit">Chargement…</p>';
    try { await this.charger(); }
    catch (e) { conteneur.innerHTML = App.entete('Journal d’activité') + '<div class="bandeau rouge">' + esc(Reseau.traduire(e)) + '</div><p class="petit">Le journal s’affiche dès que vous êtes connecté à Internet.</p>'; return; }
    this.dessiner();
  },

  dessiner() {
    const s = this.etat, el = this.conteneur;
    const acteurs = new Map();
    this.lignes.forEach((l) => { if (l.actor_user_id && !acteurs.has(l.actor_user_id)) acteurs.set(l.actor_user_id, this.nomActeur(l) + (l.actor_role === 'vendeur' ? ' (vendeur)' : l.actor_role === 'patron' ? ' (patron)' : '')); });
    const liste = this.filtrees();
    const plusieurs = this.boutiques.length > 1;
    const noms = {}; this.boutiques.forEach((b) => { noms[b.id] = b.name; });
    const opt = (v, lib, cur) => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(lib) + '</option>';
    let html = App.entete('Journal d’activité') +
      (this.depuisCache ? '<div class="bandeau">Pas de connexion Internet : dernière version enregistrée le ' + esc(formatDateHeure(this.dateCache)) + '.</div>' : '') +
      '<div class="carte">' + Periode.html(this.periode) +

      (plusieurs ? '<label class="champ"><span>Boutique</span><select id="jBoutique">' + opt('', 'Toutes mes boutiques', s.boutique) + this.boutiques.map((b) => opt(b.id, b.name, s.boutique)).join('') + '</select></label>' : '') +
      '<label class="champ"><span>Vendeur / utilisateur</span><select id="jActeur">' + opt('', 'Tout le monde', s.acteur) + [...acteurs].map(([id, n]) => opt(id, n, s.acteur)).join('') + '</select></label>' +
      '<label class="champ" style="margin-bottom:0"><span>Type d’activité</span><select id="jCategorie">' + opt('', 'Tout', s.categorie) + opt('securite', 'Connexions et mots de passe', s.categorie) + opt('ventes', 'Ventes', s.categorie) + opt('stock', 'Stock et produits', s.categorie) + opt('argent', 'Argent, dettes et dépenses', s.categorie) + opt('equipe', 'Équipe', s.categorie) + '</select></label></div>' +
      '<div class="ligne-boutons" style="margin:0 0 12px"><button class="btn gris" id="jCsv">Exporter (CSV)</button></div>' +
      '<p class="petit">' + liste.length + ' activité(s)</p>';
    if (!liste.length) html += '<div class="vide">Aucune activité pour ces filtres.</div>';
    else {
      let jour = '';
      html += '<div class="liste">' + liste.slice(0, 400).map((l) => {
        const ph = this.phrase(l), alerte = this.ALERTES.includes(l.action);
        const j = this.libelleJour(l.created_at);
        const entete = j !== jour ? '<div class="petit gras" style="padding:10px 4px 4px;text-transform:capitalize">' + esc(j) + '</div>' : '';
        jour = j;
        const role = l.actor_role === 'vendeur' ? 'Vendeur' : (l.actor_role === 'patron' ? 'Patron' : '');
        return entete + '<div class="ligne" style="cursor:default;align-items:flex-start"><div style="min-width:0">' +
          '<div class="nom">' + ph.icone + ' ' + esc(ph.titre) + (alerte ? ' <span class="badge rouge">!</span>' : '') + '</div>' +
          ph.detail.map((d) => '<div class="sous" style="word-break:break-word">' + esc(d) + '</div>').join('') +
          '<div class="sous">' + esc(formatHeure(new Date(l.created_at).getTime())) + ' · ' + esc(this.nomActeur(l)) + (role ? ' (' + role + ')' : '') + (plusieurs ? ' · ' + esc(noms[l.business_id] || l.business_name || '') : '') + '</div></div></div>';
      }).join('') + '</div>' + (liste.length > 400 ? '<p class="petit">Les 400 plus récentes sont affichées. Réduisez la période pour voir le reste.</p>' : '');
    }
    el.innerHTML = html;

    Periode.brancher(el, this.periode, () => this.recharger(), { marques: new Set(this.lignes.map((l) => Periode.iso(new Date(l.created_at).getTime()))) });
    const ch = (id, cle, recharge) => { const x = $(id, el); if (x) x.addEventListener('change', async () => { s[cle] = x.value; recharge ? await this.recharger() : this.dessiner(); }); };
    ch('#jBoutique', 'boutique', true); ch('#jActeur', 'acteur', false); ch('#jCategorie', 'categorie', false);
    $('#jCsv', el).addEventListener('click', async () => {
      const l = [['Date', 'Heure', 'Boutique', 'Utilisateur', 'Rôle', 'Activité', 'Détail']];
      liste.forEach((e) => { const ph = this.phrase(e), t = new Date(e.created_at).getTime(); l.push([formatDate(t), formatHeure(t), noms[e.business_id] || e.business_name || '', this.nomActeur(e), e.actor_role === 'vendeur' ? 'Vendeur' : 'Patron', ph.titre, ph.detail.join(' | ')]); });
      await enregistrerFichier('journal-activite.csv', VueReglages.csv(l), 'text/csv');
    });
  },

  async recharger() {
    try { await this.charger(); } catch (e) { toast(Reseau.traduire(e), 'erreur'); }
    this.dessiner();
  }
};
