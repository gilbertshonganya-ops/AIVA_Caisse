/* EvoBuskin - ABONNEMENT : 3 niveaux (Gratuit, Pro, Premium), limites et paiement en ligne.
   Les limites sont APPLIQUÉES PAR LE SERVEUR ; ce module sert à informer l'utilisateur avant qu'il se heurte à une limite
   et à lui proposer de passer au niveau supérieur. Le prix vient toujours du serveur, jamais de l'application. */
const Abonnement = (() => {
  const CLE_CACHE = 'abonnementCache', CLE_PLANS = 'plansCache', CLE_ATTENTE = 'evobuskin_paiement_attente';
  let info = null, minuteur = null, ecouteurs = null;

  // Niveau minimum pour chaque fonction (texte affiché)
  const NIVEAU_MIN = { purchases: 'Pro', expenses: 'Pro', wholesale: 'Pro', whatsapp: 'Pro', inventory: 'Pro', export_csv: 'Pro', export_pdf: 'Pro', import: 'Premium' };
  const NOM_LIMITE = { shops: 'boutiques', sellers: 'vendeurs', sellers_per_shop: 'vendeurs dans cette boutique', products: 'produits', customers: 'clients à crédit', suppliers: 'fournisseurs' };

  // ---------- état de l'abonnement ----------
  async function charger() {
    try {
      if (!navigator.onLine || !Auth.getSession() || !App.businessId) throw Reseau.erreur();
      info = await CloudDB.rpc('v20_my_subscription', { p_business_id: App.businessId });
      await DB.ecrireParam(CLE_CACHE, { businessId: App.businessId, info, at: Date.now() });
    } catch (_) {
      const c = await DB.lireParam(CLE_CACHE, null);
      if (c && c.businessId === App.businessId) info = c.info;
    }
    return info;
  }
  const donnees = () => info;
  const tier = () => (info && info.tier) || 'free';
  const peut = (f) => !info || !!(info.features && info.features[f]);          // inconnu = permissif (le serveur décide)
  const limite = (k) => (info && info.limits && info.limits[k] != null ? Number(info.limits[k]) : null);

  async function utilisation(k) {
    if (k === 'products') return (await DB.tout('produits')).filter((p) => p.actif !== false).length;
    if (k === 'customers') return (await DB.tout('clients')).filter((c) => c.actif !== false).length;
    if (k === 'suppliers') return (await DB.tout('fournisseurs')).filter((f) => f.actif !== false).length;
    return Number(info && info.usage && info.usage[k]) || 0;
  }

  // ---------- messages « passez au niveau supérieur » ----------
  function proposer(titre, texte) {
    const patron = App.estPatron();
    const f = ouvrirFenetre(titre,
      '<p>' + esc(texte) + '</p>' +
      (patron ? '<button class="btn" id="abVoir">Voir les niveaux</button>'
              : '<p class="petit">Le patron peut passer au niveau supérieur dans Plus → Mon abonnement.</p>'));
    const b = $('#abVoir', f.el);
    if (b) b.addEventListener('click', () => { f.fermer(); App.aller('abonnement'); });
  }
  async function exiger(feature, libelle) {
    if (peut(feature)) return true;
    proposer('Fonction réservée', '« ' + libelle + ' » est disponible à partir du niveau ' + (NIVEAU_MIN[feature] || 'supérieur') + '.');
    return false;
  }
  async function verifierLimite(k, ajout = 1) {
    const lim = limite(k);
    if (lim === null) return true;
    const util = await utilisation(k);
    if (util + ajout <= lim) return true;
    proposer('Limite atteinte', lim === 0
      ? 'Votre niveau ne permet pas d’avoir des ' + NOM_LIMITE[k] + '. Passez au niveau supérieur pour en ajouter.'
      : 'Vous avez atteint la limite de ' + lim + ' ' + NOM_LIMITE[k] + ' de votre niveau (' + util + ' utilisé' + (util > 1 ? 's' : '') + '). Passez au niveau supérieur pour en ajouter.');
    return false;
  }
  function pageBloquee(vue, feature, titre) {
    vue.innerHTML = (App.estPatron() ? App.htmlRetour() : '') + '<h2>' + esc(titre) + '</h2>' +
      '<div class="carte" style="text-align:center"><div style="font-size:2.2rem">🔒</div>' +
      '<p><b>Disponible à partir du niveau ' + esc(NIVEAU_MIN[feature] || 'supérieur') + '</b></p>' +
      '<p class="petit">Votre niveau actuel : ' + esc((info && info.name) || 'Gratuit') + '.</p>' +
      (App.estPatron() ? '<button class="btn" id="abVoirPage">Voir les niveaux</button>' : '<p class="petit">Le patron peut passer au niveau supérieur.</p>') + '</div>';
    const b = $('#abVoirPage', vue); if (b) b.addEventListener('click', () => App.aller('abonnement'));
  }

  // ---------- rappels (bandeau en haut des écrans) ----------
  function bandeau() {
    if (!info || !App.estPatron()) return '';
    let h = '';
    if (info.tier !== 'free' && info.days_left != null && info.days_left <= 7) {
      h += '<div class="bandeau"><b>Votre abonnement ' + esc(info.name) + ' se termine ' + (info.days_left <= 0 ? 'aujourd’hui' : 'dans ' + info.days_left + ' jour' + (info.days_left > 1 ? 's' : '')) + '.</b> Renouvelez-le pour garder vos fonctions.' +
        '<button class="btn contour" data-aller-abonnement style="margin-top:8px">Renouveler</button></div>';
    }
    if (info.usage && info.usage.sellers_suspended > 0) {
      h += '<div class="bandeau rouge"><b>' + info.usage.sellers_suspended + ' vendeur(s) suspendu(s)</b> : votre niveau actuel permet moins de vendeurs.' +
        '<button class="btn contour" data-aller-abonnement style="margin-top:8px">Voir les niveaux</button></div>';
    }
    return h;
  }

  // ---------- plans ----------
  async function plans() {
    try {
      if (!navigator.onLine) throw Reseau.erreur();
      const l = await CloudDB.rpc('v20_list_plans', {});
      await DB.ecrireParam(CLE_PLANS, l);
      return l;
    } catch (e) {
      const c = await DB.lireParam(CLE_PLANS, null);
      if (c) return c;
      throw e;
    }
  }
  const prixTexte = (p) => (p.currency === 'USD' ? Number(p.amount_minor).toLocaleString('fr-FR') + ' $' : Number(p.amount_minor).toLocaleString('fr-FR') + ' FC');

  // ---------- paiement ----------
  async function payer(planId, telephone) {
    return Subscriptions.startCinetPayCheckout({ businessId: App.businessId, planId, phone: telephone });
  }
  function lireRetourPaiement() {
    try {
      const q = new URLSearchParams(location.search);
      if (q.get('payment_return') === '1' && /^[0-9a-f-]{36}$/i.test(q.get('payment_id') || '')) {
        localStorage.setItem(CLE_ATTENTE, q.get('payment_id'));
        history.replaceState(null, '', location.pathname);
      }
    } catch (_) {}
  }
  const paiementEnAttente = () => { try { return localStorage.getItem(CLE_ATTENTE) || ''; } catch (_) { return ''; } };
  const oublierPaiement = () => { try { localStorage.removeItem(CLE_ATTENTE); } catch (_) {} };
  async function statutPaiement(id) { return CloudDB.rpc('v20_payment_status', { p_payment_id: id }); }

  // ---------- cycle de vie ----------
  function demarrer() {
    arreter();
    charger().then(() => { if (window.TempsReel) TempsReel.rafraichirVue(); });
    minuteur = setInterval(() => { if (!document.hidden) charger(); }, 5 * 60 * 1000);
    ecouteurs = () => { if (!document.hidden) charger(); };
    window.addEventListener('online', ecouteurs);
    document.addEventListener('visibilitychange', ecouteurs);
  }
  function arreter() {
    if (minuteur) clearInterval(minuteur); minuteur = null;
    if (ecouteurs) { window.removeEventListener('online', ecouteurs); document.removeEventListener('visibilitychange', ecouteurs); ecouteurs = null; }
    info = null;
  }

  return { charger, donnees, tier, peut, limite, utilisation, exiger, verifierLimite, proposer, pageBloquee, bandeau, plans, prixTexte,
    payer, lireRetourPaiement, paiementEnAttente, oublierPaiement, statutPaiement, demarrer, arreter, NIVEAU_MIN, NOM_LIMITE };
})();
window.Abonnement = Abonnement;

/* ---------------- Écran « Mon abonnement » ---------------- */
const VueAbonnement = {
  mois: 1, ordre: ['free', 'pro', 'premium'],
  SOUTIEN: { free: 'Aide dans l’application', pro: 'Support WhatsApp', premium: 'Support WhatsApp prioritaire' },

  lignes(p) {
    const f = p.features || {}, l = p.limits || {};
    const dur = (j) => (j === undefined || j === null ? 'illimité' : (j >= 365 ? Math.round(j / 30) + ' mois' : (j >= 60 ? Math.round(j / 30) + ' mois' : j + ' jours')));
    const oui = (t, ok) => '<li class="' + (ok ? 'ok' : 'non') + '">' + (ok ? '✓ ' : '✗ ') + t + '</li>';
    return [
      oui(l.shops == null ? 'Boutiques illimitées' : l.shops + ' boutique' + (l.shops > 1 ? 's' : ''), true),
      oui(l.sellers == null ? 'Vendeurs illimités' : (l.sellers === 0 ? 'Pas de vendeur (patron seul)' : l.sellers + ' vendeur' + (l.sellers > 1 ? 's' : '') + (l.sellers_per_shop ? ' (' + l.sellers_per_shop + ' par boutique)' : '')), l.sellers !== 0),
      oui(l.products == null ? 'Produits illimités' : l.products + ' produits par boutique', true),
      oui(l.customers == null ? 'Clients à crédit illimités' : l.customers + ' clients à crédit par boutique', true),
      oui(l.suppliers == null ? 'Fournisseurs illimités' : (l.suppliers === 0 ? 'Pas de fournisseurs' : l.suppliers + ' fournisseurs par boutique'), l.suppliers !== 0),
      oui('Achats et dépenses', !!f.purchases),
      oui('Prix de gros et carton', !!f.wholesale),
      oui('Import de produits', !!f.import),
      oui('Rappel de dette par WhatsApp', !!f.whatsapp),
      oui('Inventaire avec écarts', !!f.inventory),
      oui('Rapports complets', true),
      oui('Rapport en PDF', !!f.export_pdf),
      oui('Export CSV', !!f.export_csv),
      oui('Journal d’activité : ' + dur(l.audit_days), true),
      oui(this.SOUTIEN[p.tier] || '', true)
    ].join('');
  },

  async afficher(conteneur) {
    this.conteneur = conteneur;
    conteneur.innerHTML = App.htmlRetour() + '<h2>Mon abonnement</h2><p class="petit">Chargement…</p>';
    let plans;
    try {
      await Abonnement.charger();
      plans = await Abonnement.plans();
    } catch (e) {
      conteneur.innerHTML = App.htmlRetour() + '<h2>Mon abonnement</h2><div class="bandeau rouge">' + esc(Reseau.traduire(e)) + '</div>';
      return;
    }
    this.plans = plans;
    this.dessiner();
    const id = Abonnement.paiementEnAttente();
    if (id) this.suivre(id);
  },

  dessiner() {
    const info = Abonnement.donnees() || { tier: 'free', name: 'Gratuit', usage: {}, limits: {}, features: {} };
    const el = this.conteneur;
    const barre = (cle, titre) => {
      const lim = info.limits && info.limits[cle] != null ? Number(info.limits[cle]) : null, util = Number((info.usage || {})[cle]) || 0;
      const pct = lim === null ? 0 : (lim === 0 ? 100 : Math.min(100, Math.round(util * 100 / lim)));
      return '<div class="ab-ligne"><div class="ab-tete"><span>' + titre + '</span><b>' + util + ' / ' + (lim === null ? 'illimité' : lim) + '</b></div>' +
        '<div class="ab-barre"><div class="ab-rempli' + (pct >= 90 ? ' plein' : '') + '" style="width:' + (lim === null ? 8 : pct) + '%"></div></div></div>';
    };
    const fin = info.period_end ? formatDate(new Date(info.period_end).getTime()) : null;
    let html = App.htmlRetour() + '<h2>Mon abonnement</h2>' +
      '<div id="abSuivi"></div>' +
      '<div class="carte"><div class="ab-niveau">Niveau actuel : <b>' + esc(info.name) + '</b></div>' +
      (info.tier !== 'free' && fin ? '<p class="petit">Actif jusqu’au <b>' + esc(fin) + '</b> (' + info.days_left + ' jour' + (info.days_left > 1 ? 's' : '') + ' restant' + (info.days_left > 1 ? 's' : '') + ').</p>' : '<p class="petit">Niveau gratuit : vos données restent en ligne et sauvegardées.</p>') +
      barre('shops', 'Boutiques') + barre('sellers', 'Vendeurs') + barre('products', 'Produits (cette boutique)') + barre('customers', 'Clients à crédit (cette boutique)') + barre('suppliers', 'Fournisseurs (cette boutique)') +
      (info.usage && info.usage.sellers_suspended > 0 ? '<p class="petit rouge-txt">' + info.usage.sellers_suspended + ' vendeur(s) suspendu(s) : ils retrouvent l’accès dès que votre niveau le permet.</p>' : '') +
      '</div>' +
      '<div class="segment" id="abDuree"><button data-m="1" class="' + (this.mois === 1 ? 'actif' : '') + '">1 mois</button><button data-m="3" class="' + (this.mois === 3 ? 'actif' : '') + '">3 mois</button><button data-m="12" class="' + (this.mois === 12 ? 'actif' : '') + '">12 mois</button></div>' +
      '<div class="ab-grille">';
    this.ordre.forEach((t) => {
      const p = t === 'free' ? this.plans.find((x) => x.tier === 'free') : this.plans.find((x) => x.tier === t && x.period_months === this.mois);
      if (!p) return;
      const courant = info.tier === t;
      html += '<div class="ab-plan' + (courant ? ' courant' : '') + (t === 'pro' ? ' vedette' : '') + '">' +
        (t === 'pro' ? '<div class="ab-badge">Le plus choisi</div>' : '') +
        '<h3>' + esc(p.name) + '</h3>' +
        '<div class="ab-prix">' + (t === 'free' ? '0 $' : formatUSD(Number(p.price_usd))) + (t !== 'free' ? '<small> / ' + (this.mois === 1 ? 'mois' : this.mois + ' mois') + '</small>' : '') + '</div>' +
        (t !== 'free' ? '<div class="petit">≈ ' + esc(Abonnement.prixTexte(p)) + '</div>' : '<div class="petit">Pour démarrer</div>') +
        '<ul class="ab-liste">' + this.lignes(p) + '</ul>' +
        (t === 'free' ? (courant ? '<div class="petit">Votre niveau actuel</div>' : '<div class="petit">Retour automatique à la fin d’un abonnement</div>')
          : '<button class="btn' + (t === 'pro' ? '' : ' contour') + '" data-choisir="' + esc(p.id) + '">' + (courant ? 'Renouveler' : 'Choisir ' + esc(p.name)) + '</button>') +
        '</div>';
    });
    html += '</div><p class="petit">Paiement sécurisé : Orange Money, Airtel Money, M-Pesa ou carte bancaire. Aucune donnée n’est supprimée si un abonnement se termine.</p>';
    el.innerHTML = html;
    $$('#abDuree button', el).forEach((b) => b.addEventListener('click', () => { this.mois = Number(b.dataset.m); this.dessiner(); }));
    $$('[data-choisir]', el).forEach((b) => b.addEventListener('click', () => this.choisir(b.dataset.choisir)));
  },

  choisir(planId) {
    const p = this.plans.find((x) => x.id === planId);
    if (!p) return;
    if (!navigator.onLine) { toast(Reseau.MESSAGE, 'erreur'); return; }
    const f = ouvrirFenetre('Payer : ' + p.name,
      '<div class="carte" style="margin:0 0 10px"><div class="ligne-flex"><span class="petit">Niveau</span><b>' + esc(p.name) + '</b></div>' +
      '<div class="ligne-flex"><span class="petit">Durée</span><b>' + p.period_months + ' mois</b></div>' +
      '<div class="ligne-flex"><span class="petit">Montant</span><b>' + esc(Abonnement.prixTexte(p)) + ' (≈ ' + formatUSD(Number(p.price_usd)) + ')</b></div></div>' +
      '<label class="champ"><span>Votre numéro de téléphone</span><input id="abTel" inputmode="tel" maxlength="17" autocomplete="tel" placeholder="Ex : 0895006995"></label>' +
      '<p class="petit">Vous serez envoyé sur la page sécurisée de paiement : choisissez Orange Money, Airtel Money, M-Pesa ou carte bancaire. Revenez ensuite dans l’application : l’abonnement s’active automatiquement.</p>' +
      '<div class="bandeau rouge" id="abErr" hidden></div><button class="btn" id="abPayer">Payer ' + esc(Abonnement.prixTexte(p)) + '</button>');
    $('#abPayer', f.el).addEventListener('click', async () => {
      const err = (m) => { const e = $('#abErr', f.el); e.textContent = m; e.hidden = !m; };
      err('');
      const vt = validerTelRDC($('#abTel', f.el).value);
      if (!vt.ok || vt.vide) return err(MESSAGE_TEL_RDC);
      const b = $('#abPayer', f.el); b.disabled = true; b.textContent = 'Ouverture de la page de paiement…';
      try { await Abonnement.payer(p.id, vt.intl); }
      catch (e) { b.disabled = false; b.textContent = 'Payer ' + Abonnement.prixTexte(p); err(Reseau.traduire(e)); }
    });
  },

  // Suivi du paiement après le retour de la page de paiement (ou si une réponse est encore attendue)
  async suivre(id) {
    const zone = () => $('#abSuivi', this.conteneur);
    const carte = (cls, html) => { const z = zone(); if (z) z.innerHTML = '<div class="carte ' + cls + '">' + html + '</div>'; };
    carte('', '<b>Vérification de votre paiement…</b><p class="petit">Cela peut prendre quelques instants (Mobile Money : confirmez sur votre téléphone).</p>');
    for (let essai = 0; essai < 24; essai++) {
      try {
        const s = await Abonnement.statutPaiement(id);
        if (s.status === 'paid') {
          Abonnement.oublierPaiement(); await Abonnement.charger();
          if (App.onglet === 'abonnement') this.dessiner();
          carte('ab-ok', '<b>✅ Paiement confirmé. Merci !</b><p class="petit">Votre abonnement ' + esc((Abonnement.donnees() || {}).name || '') + ' est actif.</p>');
          toast('Abonnement activé', 'ok');
          return;
        }
        if (s.status === 'failed' || s.status === 'canceled') {
          Abonnement.oublierPaiement();
          carte('danger', '<b>Le paiement n’a pas abouti.</b><p class="petit">Aucun montant n’a été prélevé par EvoBuskin. Vous pouvez réessayer.</p>');
          return;
        }
      } catch (e) {
        if (!Reseau.estErreurReseau(e) && !/PAYMENT_NOT_FOUND/.test(String(e.message))) break;
        if (/PAYMENT_NOT_FOUND/.test(String(e.message))) { Abonnement.oublierPaiement(); carte('', ''); return; }
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    carte('', '<b>Paiement en cours de confirmation…</b><p class="petit">Si vous avez payé, votre abonnement s’activera automatiquement dans quelques minutes. <button class="btn contour" id="abReverif" style="margin-top:8px">Vérifier maintenant</button></p>');
    const r = $('#abReverif', this.conteneur); if (r) r.addEventListener('click', () => this.suivre(id));
  }
};
window.VueAbonnement = VueAbonnement;
