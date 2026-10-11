/* EvoBuskin V17 — Équipe
   1) Equipe       : appels sécurisés vers les fonctions serveur (invitations, équipe).
   2) VueEquipe    : écran patron « Inviter un vendeur », invitations, équipe, activité.
   3) CatalogueSync: côté VENDEUR, télécharge le catalogue de la boutique du patron
                     (produits, clients, taux) vers la base locale de l'appareil.
   Aucun secret serveur ici : tous les contrôles de rôle sont faits par Supabase. */

const Equipe = {
  creerInvitation(label, heures) {
    return CloudDB.rpc('v17_create_invite', { p_business_id: App.businessId, p_label: label || null, p_valid_hours: heures || 72 });
  },
  listerInvitations() { return CloudDB.rpc('v17_list_invites', { p_business_id: App.businessId }); },
  revoquerInvitation(id) { return CloudDB.rpc('v17_revoke_invite', { p_business_id: App.businessId, p_invite_id: id }); },
  listerEquipe() { return CloudDB.rpc('v17_list_team', { p_business_id: App.businessId }); },
  retirerMembre(userId) { return CloudDB.rpc('v17_remove_member', { p_business_id: App.businessId, p_user_id: userId }); },

  lienInscription(code) {
    const u = new URL(window.location.href);
    u.hash = ''; u.search = '';
    u.searchParams.set('invite', code);
    return u.toString();
  },

  messageErreur(e) {
    const m = String((e && e.message) || e || '');
    if (/PLAN_LIMIT_REACHED/.test(m)) return 'La limite d’utilisateurs de votre plan est atteinte. Passez à un plan supérieur ou retirez un membre.';
    if (/TOO_MANY_PENDING_INVITES/.test(m)) return 'Trop d’invitations en attente (20 maximum). Révoquez-en quelques-unes.';
    if (/OWNER_REQUIRED/.test(m)) return 'Seul le propriétaire de la boutique peut gérer l’équipe.';
    if (/AAL2_REQUIRED/.test(m)) return 'Une authentification à deux facteurs est requise.';
    if (/CANNOT_REMOVE/.test(m)) return 'Ce membre ne peut pas être retiré.';
    if (/INVITE_NOT_FOUND|MEMBER_NOT_FOUND/.test(m)) return 'Élément introuvable ou déjà traité.';
    if (/Failed to fetch|NetworkError|Session cloud/i.test(m)) return 'Connexion Internet nécessaire pour cette action.';
    return m || 'Une erreur est survenue.';
  },

  async copier(texte) {
    try { await navigator.clipboard.writeText(texte); toast('Copié', 'ok'); }
    catch (_) { window.prompt('Copiez ce texte :', texte); }
  }
};

const VueEquipe = {
  dernierCode: null,

  async afficher(conteneur) {
    this.conteneur = conteneur;
    const enLigne = navigator.onLine && CloudDB.ready();
    conteneur.innerHTML =
      '<h2>Équipe</h2>' +
      (enLigne ? '' : '<div class="carte alerte"><b>Connexion nécessaire</b><p class="petit">Connectez-vous à Internet pour inviter ou gérer vos vendeurs.</p></div>') +
      '<div class="carte"><h3 style="margin-top:0">Inviter un vendeur</h3>' +
      '<p class="petit">Le vendeur crée son compte avec un code à usage unique. Il pourra vendre, encaisser et consulter le stock, sans accès à vos finances, achats, dépenses ni réglages.</p>' +
      '<label class="champ"><span>Nom du vendeur (facultatif, pour vous repérer)</span><input id="eqNom" maxlength="60" autocomplete="off" placeholder="Ex. Marie"></label>' +
      '<label class="champ"><span>Durée de validité du code</span><select id="eqDuree"><option value="24">24 heures</option><option value="72" selected>3 jours</option><option value="168">7 jours</option></select></label>' +
      '<button class="btn" id="eqCreer"' + (enLigne ? '' : ' disabled') + '>Générer une invitation</button>' +
      '<div id="eqResultat"></div></div>' +
      '<div class="carte"><h3 style="margin-top:0">Invitations</h3><div id="eqInvitations" class="petit">Chargement…</div></div>' +
      '<div class="carte"><h3 style="margin-top:0">Votre équipe</h3><div id="eqEquipe" class="petit">Chargement…</div></div>' +
      '<div class="carte"><h3 style="margin-top:0">Activité des vendeurs (7 derniers jours)</h3><div id="eqActivite" class="petit">Chargement…</div></div>';

    $('#eqCreer', conteneur).addEventListener('click', () => this.creer());
    if (this.dernierCode) this.montrerCode(this.dernierCode);
    if (enLigne) { this.chargerInvitations(); this.chargerEquipe(); this.chargerActivite(); }
    else ['#eqInvitations', '#eqEquipe', '#eqActivite'].forEach((s) => { $(s, conteneur).textContent = 'Hors connexion.'; });
  },

  async creer() {
    const btn = $('#eqCreer', this.conteneur);
    btn.disabled = true;
    try {
      const r = await Equipe.creerInvitation($('#eqNom', this.conteneur).value.trim(), Number($('#eqDuree', this.conteneur).value));
      this.dernierCode = r;
      this.montrerCode(r);
      toast('Invitation créée', 'ok');
      this.chargerInvitations();
    } catch (e) { toast(Equipe.messageErreur(e), 'erreur'); }
    finally { btn.disabled = false; }
  },

  montrerCode(r) {
    const lien = Equipe.lienInscription(r.code);
    const exp = new Date(r.expires_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    const msg = 'Bonjour' + (r.label ? ' ' + r.label : '') + ', rejoins ma boutique sur EvoBuskin.\nOuvre ce lien, choisis « Vendeur » et crée ton compte :\n' + lien + '\nCode d\'invitation : ' + r.code + '\n(valable jusqu\'au ' + exp + ', usage unique)';
    const el = $('#eqResultat', this.conteneur);
    el.innerHTML =
      '<div class="carte alerte" style="margin-top:12px"><div class="petit">Code à transmettre (affiché une seule fois) :</div>' +
      '<div style="font-size:1.4rem;font-weight:800;letter-spacing:1px;margin:6px 0;word-break:break-all">' + esc(r.code) + '</div>' +
      '<div class="petit">Valable jusqu\'au ' + esc(exp) + ' · usage unique</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
      '<button class="btn contour" id="eqCopCode">Copier le code</button>' +
      '<button class="btn contour" id="eqCopLien">Copier le lien</button>' +
      '<a class="btn" id="eqWa" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(msg) + '" style="text-decoration:none;text-align:center">Envoyer par WhatsApp</a>' +
      '</div></div>';
    $('#eqCopCode', el).addEventListener('click', () => Equipe.copier(r.code));
    $('#eqCopLien', el).addEventListener('click', () => Equipe.copier(lien));
  },

  async chargerInvitations() {
    const el = $('#eqInvitations', this.conteneur);
    try {
      const rows = await Equipe.listerInvitations();
      if (!rows.length) { el.textContent = 'Aucune invitation pour le moment.'; return; }
      const etat = { actif: ['badge', 'En attente'], utilise: ['badge gris', 'Utilisée'], expire: ['badge orange', 'Expirée'], revoque: ['badge rouge', 'Révoquée'] };
      el.innerHTML = '<div class="liste">' + rows.map((r) => {
        const e = etat[r.status] || ['badge gris', r.status];
        const det = r.status === 'utilise'
          ? 'Utilisée par ' + esc(r.used_by_name || 'un vendeur') + ' le ' + new Date(r.used_at).toLocaleDateString('fr-FR')
          : 'Expire le ' + new Date(r.expires_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
        return '<div class="ligne"><div><div class="nom">' + esc(r.label || 'Invitation') + ' <span class="petit">· …' + esc(r.code_hint) + '</span></div><div class="petit">' + det + '</div></div>' +
          '<div style="text-align:right"><span class="' + e[0] + '">' + e[1] + '</span>' +
          (r.status === 'actif' ? '<div><button class="btn gris" data-rev="' + esc(r.id) + '" style="margin-top:6px;padding:4px 10px">Révoquer</button></div>' : '') + '</div></div>';
      }).join('') + '</div>';
      $$('[data-rev]', el).forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmer('Révoquer l\'invitation', 'Ce code ne pourra plus être utilisé.', 'Révoquer', true))) return;
        try { await Equipe.revoquerInvitation(b.dataset.rev); toast('Invitation révoquée', 'ok'); this.dernierCode = null; this.afficher(this.conteneur); }
        catch (e) { toast(Equipe.messageErreur(e), 'erreur'); }
      }));
    } catch (e) { el.textContent = Equipe.messageErreur(e); }
  },

  async chargerEquipe() {
    const el = $('#eqEquipe', this.conteneur);
    try {
      const rows = await Equipe.listerEquipe();
      el.innerHTML = '<div class="liste">' + rows.map((m) =>
        '<div class="ligne"><div><div class="nom">' + esc(m.full_name || m.email || 'Sans nom') + '</div><div class="petit">' + esc(m.email || '') + '</div></div>' +
        '<div style="text-align:right"><span class="badge' + (m.is_owner ? '' : ' orange') + '">' + (m.is_owner ? 'Propriétaire' : 'Vendeur') + '</span>' +
        (m.is_owner ? '' : '<div><button class="btn gris" data-ret="' + esc(m.user_id) + '" data-nom="' + esc(m.full_name || m.email) + '" style="margin-top:6px;padding:4px 10px">Retirer l\'accès</button></div>') + '</div></div>').join('') + '</div>';
      $$('[data-ret]', el).forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmer('Retirer l\'accès', b.dataset.nom + ' ne pourra plus accéder à votre boutique.', 'Retirer', true))) return;
        try { await Equipe.retirerMembre(b.dataset.ret); toast('Accès retiré', 'ok'); this.afficher(this.conteneur); }
        catch (e) { toast(Equipe.messageErreur(e), 'erreur'); }
      }));
    } catch (e) { el.textContent = Equipe.messageErreur(e); }
  },

  async chargerActivite() {
    const el = $('#eqActivite', this.conteneur);
    try {
      const depuis = new Date(Date.now() - 7 * 86400000).toISOString();
      const [ventes, equipe] = await Promise.all([
        CloudDB.list('sales', App.businessId, 'annulee=eq.false&date=gte.' + encodeURIComponent(depuis) + '&order=date.desc&limit=1000'),
        Equipe.listerEquipe()
      ]);
      const noms = {}; equipe.forEach((m) => { noms[m.user_id] = m.full_name || m.email || 'Vendeur'; });
      const agr = {};
      ventes.forEach((v) => {
        if (!v.vendeur_user_id) return;
        const k = v.vendeur_user_id;
        agr[k] = agr[k] || { n: 0, tot: {} };
        agr[k].n += 1;
        const d = v.devise || 'USD';
        agr[k].tot[d] = (agr[k].tot[d] || 0) + Number(v.total || 0);
      });
      const cles = Object.keys(agr).filter((k) => !equipe.find((m) => m.user_id === k && m.is_owner));
      if (!cles.length) { el.textContent = 'Aucune vente de vos vendeurs sur cette période.'; return; }
      el.innerHTML = '<div class="liste">' + cles.map((k) =>
        '<div class="ligne"><div class="nom">' + esc(noms[k] || 'Vendeur') + '</div><div style="text-align:right"><b>' + agr[k].n + ' vente(s)</b><div class="petit">' +
        Object.keys(agr[k].tot).map((d) => agr[k].tot[d].toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' ' + esc(d)).join(' · ') + '</div></div></div>').join('') + '</div>' +
        '<p class="petit">Ces ventes sont lues depuis le serveur. Elles seront ajoutées à vos rapports locaux dans une prochaine version.</p>';
    } catch (e) { el.textContent = 'Activité indisponible : ' + Equipe.messageErreur(e); }
  }
};

/* ---------- Vendeur : catalogue de la boutique du patron ---------- */
const CatalogueSync = (() => {
  let timer = null, enCours = false, businessId = null, avertiAppareil = false, onlineHandler = null;
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

  async function appareilCompatible() {
    const lie = await DB.lireParam('cloudBusinessId', null);
    if (lie) return lie === businessId;
    // Appareil jamais lié : accepté seulement s'il ne contient aucune donnée produit
    return (await DB.tout('produits')).length === 0;
  }

  async function tirer() {
    if (enCours || !businessId) return { ok: false, raison: 'occupe' };
    if (!navigator.onLine || !CloudDB.ready()) return { ok: false, raison: 'hors-ligne' };
    enCours = true;
    try {
      if (!(await appareilCompatible())) return { ok: false, raison: 'appareil' };
      await SyncManager.syncNow();
      const attente = (await DB.syncQueueListe({ businessId })).filter((r) => r.status === 'pending' || r.status === 'sending');
      if (attente.length) return { ok: false, raison: 'en-attente' };

      const [produits, clients, reglages] = await Promise.all([
        CloudDB.list('products', businessId, 'actif=eq.true&order=nom.asc&limit=5000'),
        CloudDB.list('customers', businessId, 'order=nom.asc&limit=5000'),
        CloudDB.list('business_settings', businessId).catch(() => [])
      ]);

      const ids = new Set();
      for (const r of produits) {
        const id = Number(r.local_id);
        if (!Number.isInteger(id) || id <= 0) continue;
        ids.add(id);
        const local = await DB.lire('produits', id);
        await DB.ecrire('produits', Object.assign({}, local || {}, {
          id, nom: r.nom, categorie: r.categorie || '', codeBarres: r.code_barres || '',
          devise: r.devise || 'USD', prixAchat: 0, prixVente: num(r.prix_vente) || 0,
          seuil: num(r.stock_min) || 0, stock: num(r.stock) || 0,
          prixGros: num(r.prix_gros), seuilGros: num(r.seuil_gros),
          cartonQte: num(r.carton_qte), prixCarton: num(r.prix_carton), actif: true
        }));
      }
      for (const p of await DB.tout('produits')) {
        if (!ids.has(p.id) && p.actif !== false) await DB.ecrire('produits', Object.assign({}, p, { actif: false }));
      }

      for (const c of clients) {
        const id = Number(c.local_id);
        if (!Number.isInteger(id) || id <= 0 || c.actif === false || c.deleted_at) continue;
        const local = await DB.lire('clients', id);
        await DB.ecrire('clients', Object.assign({}, local || {}, { id, nom: c.nom, tel: c.tel || '' }));
      }

      const taux = Number(reglages && reglages[0] && reglages[0].settings && reglages[0].settings.taux);
      if (taux > 0) { App.reglages.taux = taux; await DB.ecrireParam('taux', taux); }

      await DB.ecrireParam('cloudBusinessId', businessId);
      await DB.ecrireParam('catalogueSyncAt', Date.now());
      return { ok: true, produits: ids.size };
    } catch (e) {
      console.warn('Catalogue vendeur :', e);
      return { ok: false, raison: 'erreur', erreur: e };
    } finally { enCours = false; }
  }

  async function premierChargement() {
    const r = await tirer();
    if (r.ok) { if (App.onglet === 'caisse' || App.onglet === 'stock') App.rafraichir(); }
    else if (r.raison === 'appareil' && !avertiAppareil) {
      avertiAppareil = true;
      toast('Cet appareil contient déjà les données d’une autre boutique. Utilisez un autre téléphone ou une fenêtre privée pour le compte vendeur.', 'erreur');
    } else if (r.raison === 'hors-ligne') toast('Hors connexion : catalogue non mis à jour.');
    return r;
  }

  function demarrer(id) {
    arreter();
    businessId = id;
    premierChargement();
    timer = setInterval(() => { tirer(); }, 120000);
    onlineHandler = () => { tirer(); };
    window.addEventListener('online', onlineHandler);
  }
  function arreter() {
    if (timer) clearInterval(timer);
    timer = null; businessId = null; avertiAppareil = false;
    if (onlineHandler) window.removeEventListener('online', onlineHandler);
    onlineHandler = null;
  }
  return { demarrer, arreter, tirer };
})();

window.Equipe = Equipe; window.VueEquipe = VueEquipe; window.CatalogueSync = CatalogueSync;
