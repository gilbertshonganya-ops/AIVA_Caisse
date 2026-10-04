/* AIVA Caisse - écran STOCK : liste, entrées/sorties, alertes de rupture, inventaire */
const VueStock = {
  recherche: '',
  filtre: 'tous', // 'tous' | 'alertes'
  produits: [],

  // État d'un produit : 'rupture' (0), 'bas' (sous le seuil) ou 'ok'
  etat(p) {
    if (p.stock <= 0) return 'rupture';
    if (p.stock <= (p.seuil || 0)) return 'bas';
    return 'ok';
  },
  badge(p) {
    const e = this.etat(p);
    if (e === 'rupture') return '<span class="badge rouge">Rupture</span>';
    if (e === 'bas') return '<span class="badge orange">Stock bas : ' + formatQuantite(p.stock) + '</span>';
    return '<span class="badge">' + formatQuantite(p.stock) + ' en stock</span>';
  },

  async afficher(conteneur) {
    this.produits = await DB.tout('produits');
    const nbAlertes = this.produits.filter((p) => this.etat(p) !== 'ok').length;
    let valeur = 0;
    if (App.estPatron()) valeur = this.produits.reduce((s, p) => s + p.stock * versUSD(p.prixAchat || 0, p.devise, App.taux()), 0);

    conteneur.innerHTML =
      (App.estPatron()
        ? '<div class="carte"><div class="ligne-flex"><div><div class="petit">Valeur du stock (prix d\'achat)</div><div>' + App.montantHtml(valeur) + '</div></div>' +
          '<div class="droite"><div class="petit">Produits</div><div class="gras">' + this.produits.length + '</div></div></div></div>'
        : '') +
      '<div class="recherche"><input id="rechStock" type="search" placeholder="Chercher un produit" autocomplete="off" value="' + esc(this.recherche) + '">' +
      (App.estPatron() ? '<button class="btn" id="btnAjout" aria-label="Ajouter un produit">+</button>' : '') + '</div>' +
      '<div class="segment" id="filtres"><button data-f="tous">Tous</button><button data-f="alertes">Alertes (' + nbAlertes + ')</button></div>' +
      (App.estPatron() ? '<button class="btn contour" id="btnInventaire" style="margin-bottom:12px">Faire l\'inventaire</button>' : '') +
      '<div id="listeStock"></div>';

    $('#rechStock').addEventListener('input', (e) => { this.recherche = e.target.value; this.dessinerListe(); });
    $$('#filtres button').forEach((b) => b.addEventListener('click', () => { this.filtre = b.dataset.f; this.majFiltres(); this.dessinerListe(); }));
    if (App.estPatron()) {
      $('#btnAjout').addEventListener('click', () => this.formulaire(null));
      $('#btnInventaire').addEventListener('click', () => this.inventaire());
    }
    this.majFiltres();
    this.dessinerListe();
  },

  majFiltres() { $$('#filtres button').forEach((b) => b.classList.toggle('actif', b.dataset.f === this.filtre)); },

  dessinerListe() {
    const mots = this.recherche.trim().toLowerCase();
    const liste = this.produits
      .filter((p) => this.filtre === 'tous' || this.etat(p) !== 'ok')
      .filter((p) => !mots || p.nom.toLowerCase().includes(mots) || (p.codeBarres || '').includes(mots) || (p.categorie || '').toLowerCase().includes(mots))
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    const el = $('#listeStock');
    if (!liste.length) {
      el.innerHTML = '<div class="vide">' + (this.produits.length ? 'Aucun produit trouvé.' : 'Aucun produit. ' + (App.estPatron() ? 'Touchez + pour en ajouter.' : '')) + '</div>';
      return;
    }
    el.innerHTML = '<div class="liste">' + liste.map((p) =>
      '<div class="ligne" data-id="' + p.id + '"><div><div class="nom">' + esc(p.nom) + '</div>' +
      '<div class="sous">' + esc(p.categorie || 'Sans catégorie') + ' &middot; ' + prixProduit(p) + '</div></div>' +
      '<div class="droite">' + this.badge(p) + '</div></div>').join('') + '</div>';
    $$('.ligne', el).forEach((l) => l.addEventListener('click', () => this.detail(Number(l.dataset.id))));
  },

  async detail(id) {
    const p = await DB.lire('produits', id);
    if (!p) return;
    const mouvements = (await DB.tout('mouvements')).filter((m) => m.produitId === id).sort((a, b) => b.date - a.date).slice(0, 8);
    const marge = versUSD(p.prixVente - (p.prixAchat || 0), p.devise, App.taux());
    const f = ouvrirFenetre(p.nom,
      '<div class="ligne-flex"><span>' + this.badge(p) + '</span><span class="petit">Alerte à ' + formatQuantite(p.seuil || 0) + '</span></div>' +
      '<div class="liste" style="margin-top:10px">' +
        '<div class="ligne"><span>Prix de vente</span><span class="gras">' + prixProduit(p) + '</span></div>' +
        (App.estPatron()
          ? '<div class="ligne"><span>Prix d\'achat</span><span>' + prixProduit(p, 'prixAchat') + '</span></div>' +
            '<div class="ligne"><span>Bénéfice par unité</span><span class="vert-txt gras">' + formatUSD(marge) + '</span></div>'
          : '') +
        (p.prixGros != null ? '<div class="ligne"><span>Prix de gros (dès ' + formatQuantite(p.seuilGros) + ')</span><span class="gras">' + prixProduit(p, 'prixGros') + '</span></div>' : '') +
        (p.cartonQte ? '<div class="ligne"><span>Carton de ' + p.cartonQte + '</span><span class="gras">' + (p.prixCarton != null ? prixProduit(p, 'prixCarton') : 'au prix normal') + '</span></div>' : '') +
        '<div class="ligne"><span>Code-barres</span><span>' + esc(p.codeBarres || '-') + '</span></div>' +
        '<div class="ligne"><span>Catégorie</span><span>' + esc(p.categorie || '-') + '</span></div>' +
      '</div>' +
      (App.estPatron()
        ? '<div class="ligne-boutons"><button class="btn" id="bEntree">+ Entrée</button><button class="btn jaune" id="bSortie">&minus; Sortie</button></div>' +
          '<div class="ligne-boutons"><button class="btn gris" id="bModif">Modifier</button><button class="btn rouge" id="bSuppr">Supprimer</button></div>'
        : '') +
      '<h3 style="margin:16px 0 6px">Derniers mouvements</h3>' +
      (mouvements.length
        ? '<div class="liste">' + mouvements.map((m) =>
            '<div class="ligne" style="cursor:default"><div><div class="nom">' + esc(this.libelleMouvement(m.type)) + '</div><div class="sous">' + formatDateHeure(m.date) + (m.note ? ' &middot; ' + esc(m.note) : '') + '</div></div>' +
            '<div class="' + (m.qte < 0 ? 'rouge-txt' : 'vert-txt') + ' gras">' + (m.qte > 0 ? '+' : '') + formatQuantite(m.qte) + '</div></div>').join('') + '</div>'
        : '<p class="petit">Aucun mouvement enregistré.</p>'));

    if (App.estPatron()) {
      $('#bEntree', f.el).addEventListener('click', () => { f.fermer(); this.mouvement(p, 'entree'); });
      $('#bSortie', f.el).addEventListener('click', () => { f.fermer(); this.mouvement(p, 'sortie'); });
      $('#bModif', f.el).addEventListener('click', () => { f.fermer(); this.formulaire(p); });
      $('#bSuppr', f.el).addEventListener('click', async () => {
        if (await confirmer('Supprimer le produit', 'Supprimer « ' + p.nom + ' » ? Les anciennes ventes restent dans les rapports.', 'Supprimer', true)) {
          await DB.supprimer('produits', p.id);
          Audit.log('produit_supprime', { nom: p.nom, stock: p.stock });
          f.fermer(); toast('Produit supprimé'); App.rafraichir();
        }
      });
    }
  },

  libelleMouvement(type) {
    return { entree: 'Entrée de stock', sortie: 'Sortie de stock', vente: 'Vente', inventaire: 'Inventaire', annulation: 'Vente annulée' }[type] || type;
  },

  // Entrée (réapprovisionnement) ou sortie (casse, vol, usage personnel...)
  mouvement(p, type) {
    const entree = type === 'entree';
    const f = ouvrirFenetre((entree ? 'Entrée : ' : 'Sortie : ') + p.nom,
      '<p class="petit">Stock actuel : <b>' + formatQuantite(p.stock) + '</b></p>' +
      '<label class="champ"><span>Quantité ' + (entree ? 'reçue' : 'sortie') + '</span><input id="mQte" inputmode="decimal" autocomplete="off"></label>' +
      '<label class="champ"><span>Note (facultatif)</span><input id="mNote" autocomplete="off" placeholder="' + (entree ? 'Ex : achat chez le grossiste' : 'Ex : produit cassé, périmé, volé') + '"></label>' +
      '<button class="btn" id="mOk">Enregistrer</button>');
    $('#mQte', f.el).focus();
    $('#mOk', f.el).addEventListener('click', async () => {
      const q = lireNombre($('#mQte', f.el).value);
      if (isNaN(q) || q <= 0) { toast('Entrez une quantité supérieure à 0', 'erreur'); return; }
      if (!entree && q > p.stock) { toast('Impossible : il ne reste que ' + formatQuantite(p.stock), 'erreur'); return; }
      try {
        await DB.ajusterStock(p.id, entree ? q : -q, type, $('#mNote', f.el).value.trim(), App.nomVendeur());
        Audit.log(entree ? 'stock_entree' : 'stock_sortie', { produit: p.nom, qte: q, note: $('#mNote', f.el).value.trim() });
        f.fermer(); toast(entree ? 'Entrée enregistrée' : 'Sortie enregistrée', 'ok'); App.rafraichir();
      } catch (e) { toast(e.message, 'erreur'); }
    });
  },

  // Création ou modification d'un produit. codePrefill : code lu par le scanner.
  formulaire(p, codePrefill) {
    const nouveau = !p;
    p = p || { nom: '', categorie: '', codeBarres: codePrefill || '', devise: 'USD', prixAchat: '', prixVente: '', stock: 0, seuil: 5 };
    const f = ouvrirFenetre(nouveau ? 'Nouveau produit' : 'Modifier le produit',
      '<label class="champ"><span>Nom du produit *</span><input id="fNom" autocomplete="off" value="' + esc(p.nom) + '"></label>' +
      '<label class="champ"><span>Catégorie</span><input id="fCat" autocomplete="off" list="listeCats" value="' + esc(p.categorie) + '" placeholder="Ex : Boissons">' +
        '<datalist id="listeCats">' + Array.from(new Set(this.produits.map((x) => x.categorie).filter(Boolean))).map((c) => '<option value="' + esc(c) + '">').join('') + '</datalist></label>' +
      '<label class="champ"><span>Code-barres (facultatif)</span><div class="recherche" style="margin:0"><input id="fCode" inputmode="numeric" autocomplete="off" value="' + esc(p.codeBarres) + '"><button class="btn" id="fScan" type="button">&#128247;</button></div></label>' +
      '<label class="champ"><span>Les prix sont en</span><select id="fDev"><option value="USD">Dollars ($)</option><option value="CDF">Francs congolais (FC)</option></select></label>' +
      '<div class="deux-colonnes">' +
        '<label class="champ"><span>Prix d\'achat</span><input id="fAchat" inputmode="decimal" autocomplete="off" value="' + esc(p.prixAchat) + '"></label>' +
        '<label class="champ"><span>Prix de vente *</span><input id="fVente" inputmode="decimal" autocomplete="off" value="' + esc(p.prixVente) + '"></label>' +
      '</div>' +
      '<details class="options"' + ((p.prixGros != null || p.cartonQte) ? ' open' : '') + '><summary>Prix de gros et cartons (facultatif)</summary>' +
        '<p class="petit">Le prix de gros s\'applique tout seul quand le client prend assez d\'unités. Le carton se vend en un clic dans le panier.</p>' +
        '<div class="deux-colonnes">' +
          '<label class="champ"><span>Prix de gros (par unité)</span><input id="fGros" inputmode="decimal" autocomplete="off" value="' + esc(p.prixGros == null ? '' : p.prixGros) + '"></label>' +
          '<label class="champ"><span>à partir de (unités)</span><input id="fSeuilGros" inputmode="decimal" autocomplete="off" value="' + esc(p.seuilGros == null ? '' : p.seuilGros) + '"></label>' +
        '</div><div class="deux-colonnes">' +
          '<label class="champ"><span>Unités par carton</span><input id="fCartonQte" inputmode="numeric" autocomplete="off" value="' + esc(p.cartonQte == null ? '' : p.cartonQte) + '"></label>' +
          '<label class="champ"><span>Prix du carton</span><input id="fCartonPrix" inputmode="decimal" autocomplete="off" value="' + esc(p.prixCarton == null ? '' : p.prixCarton) + '"></label>' +
        '</div></details>' +
      '<div class="deux-colonnes">' +
        (nouveau ? '<label class="champ"><span>Stock de départ</span><input id="fStock" inputmode="decimal" autocomplete="off" value="0"></label>' : '<div class="champ"><span>Stock actuel</span><div class="gras" style="padding:12px 0">' + formatQuantite(p.stock) + '</div></div>') +
        '<label class="champ"><span>Alerte quand il reste</span><input id="fSeuil" inputmode="decimal" autocomplete="off" value="' + esc(p.seuil) + '"></label>' +
      '</div>' +
      '<button class="btn" id="fOk">Enregistrer</button>');
    $('#fDev', f.el).value = p.devise;
    $('#fScan', f.el).addEventListener('click', async () => {
      const code = await Scanner.scanner();
      if (code) $('#fCode', f.el).value = code;
    });
    $('#fOk', f.el).addEventListener('click', async () => {
      const nom = $('#fNom', f.el).value.trim();
      const achat = $('#fAchat', f.el).value.trim() === '' ? 0 : lireNombre($('#fAchat', f.el).value);
      const vente = lireNombre($('#fVente', f.el).value);
      const seuil = $('#fSeuil', f.el).value.trim() === '' ? 0 : lireNombre($('#fSeuil', f.el).value);
      const stockDepart = nouveau ? ($('#fStock', f.el).value.trim() === '' ? 0 : lireNombre($('#fStock', f.el).value)) : p.stock;
      const code = $('#fCode', f.el).value.trim();
      if (!nom) { toast('Le nom du produit est obligatoire', 'erreur'); return; }
      if (isNaN(vente) || vente < 0) { toast('Le prix de vente est invalide', 'erreur'); return; }
      if (isNaN(achat) || achat < 0) { toast('Le prix d\'achat est invalide', 'erreur'); return; }
      if (isNaN(seuil) || seuil < 0) { toast('Le seuil d\'alerte est invalide', 'erreur'); return; }
      if (isNaN(stockDepart) || stockDepart < 0) { toast('Le stock ne peut pas être négatif', 'erreur'); return; }
      const lireOpt = (id) => { const v = $(id, f.el).value.trim(); return v === '' ? null : lireNombre(v); };
      const gros = lireOpt('#fGros'), seuilGros = lireOpt('#fSeuilGros'), cartonQte = lireOpt('#fCartonQte'), prixCarton = lireOpt('#fCartonPrix');
      if (gros !== null && (isNaN(gros) || gros < 0)) { toast('Le prix de gros est invalide', 'erreur'); return; }
      if (gros !== null && (seuilGros === null || isNaN(seuilGros) || seuilGros < 2)) { toast('Indiquez à partir de combien d\'unités le prix de gros s\'applique (2 ou plus)', 'erreur'); return; }
      if (cartonQte !== null && (isNaN(cartonQte) || cartonQte < 2 || !Number.isInteger(cartonQte))) { toast('Un carton contient au moins 2 unités (nombre entier)', 'erreur'); return; }
      if (prixCarton !== null && (isNaN(prixCarton) || prixCarton < 0)) { toast('Le prix du carton est invalide', 'erreur'); return; }
      if (prixCarton !== null && cartonQte === null) { toast('Indiquez combien d\'unités contient un carton', 'erreur'); return; }
      if (code && this.produits.some((x) => x.codeBarres === code && x.id !== p.id)) { toast('Ce code-barres existe déjà pour un autre produit', 'erreur'); return; }
      if (achat > vente && !(await confirmer('Prix à vérifier', 'Le prix d\'achat est plus grand que le prix de vente : vous vendriez à perte. Continuer ?', 'Continuer'))) return;
      const objet = Object.assign({}, p, {
        nom, categorie: $('#fCat', f.el).value.trim(), codeBarres: code, devise: $('#fDev', f.el).value,
        prixAchat: achat, prixVente: vente, seuil, stock: arrondi(stockDepart, 3),
        prixGros: gros, seuilGros: gros !== null ? seuilGros : null, cartonQte, prixCarton
      });
      try {
        const id = await DB.ecrire('produits', objet);
        if (nouveau) Audit.log('produit_cree', { nom, prixVente: vente + ' ' + objet.devise, stock: stockDepart });
        else {
          const diff = {};
          [['nom', 'nom'], ['prixVente', 'prix de vente'], ['prixAchat', 'prix d\'achat'], ['prixGros', 'prix de gros'], ['prixCarton', 'prix du carton'], ['seuil', 'seuil'], ['devise', 'devise']]
            .forEach(([k, lib]) => { if ((p[k] == null ? null : p[k]) !== (objet[k] == null ? null : objet[k])) diff[lib] = [p[k] == null ? '-' : p[k], objet[k] == null ? '-' : objet[k]]; });
          if (Object.keys(diff).length) Audit.log('produit_modifie', Object.assign({ produit: nom }, diff));
        }
        if (nouveau && stockDepart > 0) {
          await DB.ajouter('mouvements', { produitId: id, nom, date: Date.now(), type: 'entree', qte: arrondi(stockDepart, 3), note: 'Stock de départ', vendeur: App.nomVendeur() });
        }
        f.fermer(); toast('Produit enregistré', 'ok'); App.rafraichir();
      } catch (e) { toast('Erreur : ' + e.message, 'erreur'); }
    });
  },

  // Inventaire : on compte physiquement et l'application corrige les différences
  inventaire() {
    const liste = [...this.produits].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    if (!liste.length) { toast('Aucun produit à compter', 'erreur'); return; }
    const f = ouvrirFenetre('Inventaire',
      '<p class="petit">Comptez chaque produit sur l\'étagère et écrivez la quantité réelle. Seules les différences seront corrigées.</p>' +
      liste.map((p) => '<div class="ligne-panier"><div class="info"><div class="nom">' + esc(p.nom) + '</div><div class="petit">Dans l\'application : ' + formatQuantite(p.stock) + '</div></div>' +
        '<div class="qte-ctrl"><input data-inv="' + p.id + '" inputmode="decimal" value="' + formatQuantite(p.stock).replace(/\s/g, '') + '"></div></div>').join('') +
      '<button class="btn" id="invOk" style="margin-top:14px">Appliquer l\'inventaire</button>', { verrouille: true });
    $('#invOk', f.el).addEventListener('click', async () => {
      const changements = [];
      for (const inp of $$('[data-inv]', f.el)) {
        const p = liste.find((x) => x.id === Number(inp.dataset.inv));
        const v = lireNombre(inp.value);
        if (isNaN(v) || v < 0) { toast('Quantité invalide pour « ' + p.nom + ' »', 'erreur'); inp.focus(); return; }
        const delta = arrondi(v - p.stock, 3);
        if (delta !== 0) changements.push({ p, delta });
      }
      if (!changements.length) { f.fermer(); toast('Aucune différence : le stock est exact'); return; }
      if (!(await confirmer('Confirmer', changements.length + ' produit(s) seront corrigés. Continuer ?', 'Appliquer'))) return;
      try {
        for (const c of changements) await DB.ajusterStock(c.p.id, c.delta, 'inventaire', 'Inventaire', App.nomVendeur());
        Audit.log('inventaire', { corrections: changements.length, details: changements.slice(0, 20).map((c) => c.p.nom + ' ' + (c.delta > 0 ? '+' : '') + formatQuantite(c.delta)).join(', ') });
        f.fermer(); toast(changements.length + ' produit(s) corrigé(s)', 'ok'); App.rafraichir();
      } catch (e) { toast(e.message, 'erreur'); }
    });
  }
};
