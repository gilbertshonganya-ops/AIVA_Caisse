/* EvoBuskin - écran STOCK : liste, entrées/sorties, alertes de rupture, inventaire */
const VueStock = {
  recherche: '',
  filtre: 'tous', // 'tous' | 'alertes' | 'prix' (produits sans prix de vente)
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
    this.produits = (await DB.tout('produits')).filter((p) => p.actif !== false);
    const nbAlertes = this.produits.filter((p) => this.etat(p) !== 'ok').length;
    const nbSansPrix = this.produits.filter(prixAFixer).length;
    let valeur = 0;
    if (App.estPatron()) valeur = this.produits.reduce((s, p) => s + p.stock * versUSD(p.prixAchat || 0, p.devise, App.taux()), 0);

    conteneur.innerHTML =
      (App.estPatron()
        ? '<div class="carte"><div class="ligne-flex"><div><div class="petit">Valeur du stock (prix d\'achat)</div><div>' + App.montantHtml(valeur) + '</div></div>' +
          '<div class="droite"><div class="petit">Produits</div><div class="gras">' + this.produits.length + '</div></div></div></div>'
        : '') +
      '<div class="recherche"><input id="rechStock" type="search" placeholder="Chercher un produit" autocomplete="off" value="' + esc(this.recherche) + '">' +
      (App.estPatron() ? '<button class="btn" id="btnAjout" aria-label="Ajouter un produit">+</button>' : '') + '</div>' +
      '<div class="segment" id="filtres"><button data-f="tous">Tous</button><button data-f="alertes">Alertes (' + nbAlertes + ')</button><button data-f="prix">Prix à fixer (' + nbSansPrix + ')</button></div>' +
      (App.estPatron() ? '<div class="ligne-boutons" style="margin-bottom:12px"><button class="btn contour" id="btnInventaire">Faire l\'inventaire</button><button class="btn gris" id="btnHistInv">Écarts passés</button></div>' : '') +
      '<div id="listeStock"></div>';

    $('#rechStock').addEventListener('input', (e) => { this.recherche = e.target.value; this.dessinerListe(); });
    $$('#filtres button').forEach((b) => b.addEventListener('click', () => { this.filtre = b.dataset.f; this.majFiltres(); this.dessinerListe(); }));
    if (App.estPatron()) {
      $('#btnAjout').addEventListener('click', () => this.formulaire(null));
      $('#btnInventaire').addEventListener('click', () => this.inventaire());
      $('#btnHistInv').addEventListener('click', () => this.historiqueInventaires());
    }
    this.majFiltres();
    this.dessinerListe();
  },

  majFiltres() { $$('#filtres button').forEach((b) => b.classList.toggle('actif', b.dataset.f === this.filtre)); },

  dessinerListe() {
    const mots = this.recherche.trim().toLowerCase();
    const liste = this.produits
      .filter((p) => this.filtre === 'tous' || (this.filtre === 'alertes' && this.etat(p) !== 'ok') || (this.filtre === 'prix' && prixAFixer(p)))
      .filter((p) => !mots || p.nom.toLowerCase().includes(mots) || (p.codeBarres || '').includes(mots) || (p.categorie || '').toLowerCase().includes(mots))
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    const el = $('#listeStock');
    if (!liste.length) {
      el.innerHTML = '<div class="vide">' + (this.produits.length ? 'Aucun produit trouvé.' : 'Aucun produit. ' + (App.estPatron() ? 'Touchez + pour en ajouter.' : '')) + '</div>';
      return;
    }
    el.innerHTML = '<div class="liste">' + liste.map((p) =>
      '<div class="ligne" data-id="' + p.id + '"><div><div class="nom">' + esc(p.nom) + '</div>' +
      '<div class="sous">' + esc(p.categorie || 'Sans catégorie') + ' &middot; ' + (prixAFixer(p) ? '<b style="color:var(--couleur-alerte)">Prix de vente à fixer</b>' : prixProduit(p)) + '</div></div>' +
      '<div class="droite">' + this.badge(p) + (prixAFixer(p) ? '<div style="margin-top:4px"><span class="badge orange">Prix à fixer</span></div>' : '') + '</div></div>').join('') + '</div>';
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
        '<div class="ligne"><span>Prix de vente</span><span class="gras">' + (prixAFixer(p) ? 'À fixer (touchez Modifier)' : prixProduit(p)) + '</span></div>' +
        (App.estPatron()
          ? '<div class="ligne"><span>Prix d\'achat</span><span>' + prixProduit(p, 'prixAchat') + '</span></div>' +
            (prixAFixer(p) ? '' : '<div class="ligne"><span>Bénéfice par unité</span><span class="vert-txt gras">' + formatUSD(marge) + '</span></div>')
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
          p.actif = false;
          await DB.ecrire('produits', p);
          await SyncManager.mettreEnFile('product_deactivate', { p_product_id: null, p_local_id: p.id });
          Audit.log('produit_desactive', { nom: p.nom, stock: p.stock });
          f.fermer(); toast('Produit désactivé', 'ok'); App.rafraichir();
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
        const note = $('#mNote', f.el).value.trim();
        const delta = entree ? q : -q;
        const expectedStock = p.stock;
        await DB.ajusterStock(p.id, delta, type, note, App.nomVendeur());
        await SyncManager.mettreEnFile('stock_adjust', { p_product_id: null, p_local_id: p.id, p_delta: arrondi(delta, 3), p_type: type, p_note: note, p_expected_stock: arrondi(expectedStock, 3) });
        Audit.log(entree ? 'stock_entree' : 'stock_sortie', { produit: p.nom, qte: q, note });
        f.fermer(); toast(entree ? 'Entrée enregistrée' : 'Sortie enregistrée', 'ok'); App.rafraichir();
      } catch (e) { toast(e.message, 'erreur'); }
    });
  },

  // Création ou modification d'un produit. codePrefill : code lu par le scanner.
  formulaire(p, codePrefill) {
    const nouveau = !p;
    p = p || { nom: '', categorie: '', codeBarres: codePrefill || '', devise: 'USD', prixAchat: '', prixVente: '', stock: 0, seuil: 5, actif: true };
    const f = ouvrirFenetre(nouveau ? 'Nouveau produit' : 'Modifier le produit',
      '<label class="champ"><span>Nom du produit *</span><input id="fNom" autocomplete="off" value="' + esc(p.nom) + '"></label>' +
      '<label class="champ"><span>Catégorie</span><input id="fCat" autocomplete="off" list="listeCats" value="' + esc(p.categorie) + '" placeholder="Ex : Boissons">' +
        '<datalist id="listeCats">' + Array.from(new Set(this.produits.map((x) => x.categorie).filter(Boolean))).map((c) => '<option value="' + esc(c) + '">').join('') + '</datalist></label>' +
      '<label class="champ"><span>Code-barres (facultatif)</span><div class="recherche" style="margin:0"><input id="fCode" inputmode="numeric" autocomplete="off" value="' + esc(p.codeBarres) + '"><button class="btn" id="fScan" type="button">&#128247;</button></div></label>' +
      '<label class="champ"><span>Les prix sont en</span><select id="fDev"><option value="USD">Dollars ($)</option><option value="CDF">Francs congolais (FC)</option></select></label>' +
      '<div class="deux-colonnes">' +
        '<label class="champ"><span>Prix d\'achat</span><input id="fAchat" inputmode="decimal" autocomplete="off" value="' + esc(p.prixAchat) + '"></label>' +
        '<label class="champ"><span>Prix de vente (vide = à fixer)</span><input id="fVente" inputmode="decimal" autocomplete="off" value="' + esc(p.prixVente > 0 ? p.prixVente : '') + '"></label>' +
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
      const venteBrut = $('#fVente', f.el).value.trim();
      const vente = venteBrut === '' ? 0 : lireNombre(venteBrut); // vide = prix pas encore fixé
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
      if (vente > 0 && achat > vente && !(await confirmer('Prix à vérifier', 'Le prix d\'achat est plus grand que le prix de vente : vous vendriez à perte. Continuer ?', 'Continuer'))) return;
      const objet = Object.assign({}, p, {
        nom, categorie: $('#fCat', f.el).value.trim(), codeBarres: code, devise: $('#fDev', f.el).value,
        prixAchat: achat, prixVente: vente, seuil, stock: arrondi(stockDepart, 3),
        prixGros: gros, seuilGros: gros !== null ? seuilGros : null, cartonQte, prixCarton, actif: p.actif !== false
      });
      try {
        const id = nouveau ? await DB.ajouter('produits', objet) : await DB.ecrire('produits', objet);
        if (nouveau && stockDepart > 0) {
          await DB.ajouter('mouvements', { produitId: id, nom, date: Date.now(), type: 'entree', qte: arrondi(stockDepart, 3), note: 'Stock de départ', vendeur: App.nomVendeur() });
        }
        if (nouveau) {
          await SyncManager.mettreEnFile('product_create', {
            p_local_id: id, p_nom: nom, p_categorie: objet.categorie || null, p_code_barres: code || null,
            p_devise: objet.devise, p_prix_achat: achat, p_prix_vente: vente, p_stock_initial: arrondi(stockDepart, 3),
            p_stock_min: seuil, p_prix_gros: gros, p_seuil_gros: seuilGros, p_carton_qte: cartonQte, p_prix_carton: prixCarton, p_metadata: {}
          });
          Audit.log('produit_cree', { nom, categorie: objet.categorie || '', prixAchat: achat, prixVente: vente, devise: objet.devise, stock: stockDepart });
        } else {
          const diff = {};
          [['nom', 'nom'], ['prixVente', 'prix de vente'], ['prixAchat', "prix d'achat"], ['prixGros', 'prix de gros'], ['prixCarton', 'prix du carton'], ['seuil', 'seuil'], ['devise', 'devise']]
            .forEach(([k, lib]) => { if ((p[k] == null ? null : p[k]) !== (objet[k] == null ? null : objet[k])) diff[lib] = [p[k] == null ? '-' : p[k], objet[k] == null ? '-' : objet[k]]; });
          if (Object.keys(diff).length) Audit.log('produit_modifie', Object.assign({ produit: nom }, diff));
          await SyncManager.mettreEnFile('product_update', {
            p_product_id: null, p_local_id: id, p_nom: nom, p_categorie: objet.categorie || null, p_code_barres: code || null,
            p_devise: objet.devise, p_prix_achat: achat, p_prix_vente: vente, p_stock_min: seuil,
            p_prix_gros: gros, p_seuil_gros: seuilGros, p_carton_qte: cartonQte, p_prix_carton: prixCarton, p_metadata: {}
          });
        }
        f.fermer(); toast(nouveau ? 'Produit enregistré' : 'Produit modifié', 'ok'); App.rafraichir();
      } catch (e) { toast('Erreur : ' + e.message, 'erreur'); }
    });
  },

  // Inventaire : on compte physiquement ; l'application signale les ÉCARTS (manquants / en trop),
  // corrige le stock, et le nombre compté devient le point de départ du prochain inventaire.
  async inventaire() {
    const liste = [...this.produits].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    if (!liste.length) { toast('Aucun produit à compter', 'erreur'); return; }
    const bases = await DB.lireParam('inventaireBase', {}) || {};
    const f = ouvrirFenetre('Inventaire',
      '<p class="petit">Comptez chaque produit sur l\'étagère et tapez la quantité réelle. Laissez vide un produit que vous ne comptez pas aujourd\'hui. Le nombre compté devient le point de départ du prochain inventaire.</p>' +
      liste.map((p) => {
        const b = bases[p.id];
        return '<div class="ligne-panier"><div class="info"><div class="nom">' + esc(p.nom) + '</div>' +
          '<div class="petit">Attendu : <b>' + formatQuantite(p.stock) + '</b>' + (b ? ' · dernier inventaire : ' + formatQuantite(b.compte) + ' le ' + formatDate(b.date) : '') + '</div>' +
          '<div class="petit" data-ecart="' + p.id + '"></div></div>' +
          '<div class="qte-ctrl"><input data-inv="' + p.id + '" inputmode="decimal" placeholder="Compté" autocomplete="off"></div></div>';
      }).join('') +
      '<button class="btn" id="invOk" style="margin-top:14px">Terminer l\'inventaire</button>', { verrouille: true });

    // Écart affiché en direct pendant la saisie
    $$('[data-inv]', f.el).forEach((inp) => inp.addEventListener('input', () => {
      const p = liste.find((x) => x.id === Number(inp.dataset.inv));
      const zone = $('[data-ecart="' + p.id + '"]', f.el);
      if (inp.value.trim() === '') { zone.textContent = ''; return; }
      const v = lireNombre(inp.value);
      if (isNaN(v) || v < 0) { zone.innerHTML = '<span class="rouge-txt">Quantité invalide</span>'; return; }
      const d = arrondi(v - p.stock, 3);
      zone.innerHTML = d === 0 ? '<span class="vert-txt">✔ Conforme</span>'
        : '<b class="rouge-txt">Écart : ' + (d > 0 ? '+' : '−') + formatQuantite(Math.abs(d)) + (d < 0 ? ' (manquant)' : ' (en trop)') + '</b>';
    }));

    $('#invOk', f.el).addEventListener('click', async () => {
      const lignes = [];
      for (const inp of $$('[data-inv]', f.el)) {
        if (inp.value.trim() === '') continue;
        const p = liste.find((x) => x.id === Number(inp.dataset.inv));
        const v = lireNombre(inp.value);
        if (isNaN(v) || v < 0) { toast('Quantité invalide pour « ' + p.nom + ' »', 'erreur'); inp.focus(); return; }
        lignes.push({ p, attendu: p.stock, compte: arrondi(v, 3), delta: arrondi(v - p.stock, 3) });
      }
      if (!lignes.length) { toast('Tapez au moins une quantité comptée', 'erreur'); return; }
      const ecarts = lignes.filter((l) => l.delta !== 0);
      const question = ecarts.length
        ? ecarts.length + ' écart(s) détecté(s) sur ' + lignes.length + ' produit(s) compté(s). Corriger le stock avec les quantités comptées ?'
        : 'Aucun écart sur les ' + lignes.length + ' produit(s) comptés. Enregistrer cet inventaire ?';
      if (!(await confirmer('Terminer l\'inventaire', question, 'Enregistrer'))) return;
      try {
        const taux = App.taux();
        for (const l of ecarts) {
          await DB.ajusterStock(l.p.id, l.delta, 'inventaire', 'Inventaire', App.nomVendeur());
          await SyncManager.mettreEnFile('stock_set', {
            p_product_id: null, p_local_id: l.p.id, p_counted_stock: l.compte,
            p_expected_stock: arrondi(l.attendu, 3), p_note: 'Inventaire'
          });
        }
        // Le nombre compté devient le point de départ du prochain inventaire
        const maintenant = Date.now();
        const nouvellesBases = Object.assign({}, await DB.lireParam('inventaireBase', {}) || {});
        lignes.forEach((l) => { nouvellesBases[l.p.id] = { compte: l.compte, date: maintenant }; });
        await DB.ecrireParam('inventaireBase', nouvellesBases);
        const rapport = {
          date: maintenant, auteur: App.nomVendeur(), comptes: lignes.length,
          lignes: ecarts.map((l) => ({
            nom: l.p.nom, attendu: l.attendu, compte: l.compte, ecart: l.delta,
            valeurUSD: arrondi(l.delta * versUSD(l.p.prixAchat || 0, l.p.devise, taux), 2)
          }))
        };
        const histo = (await DB.lireParam('inventaires', []) || []).concat([rapport]).slice(-30);
        await DB.ecrireParam('inventaires', histo);
        Audit.log('inventaire', { corrections: ecarts.length, details: ecarts.slice(0, 20).map((c) => c.p.nom + ' ' + (c.delta > 0 ? '+' : '') + formatQuantite(c.delta)).join(', ') });
        if (ecarts.length) {
          Audit.log('inventaire_ecart', { texte: lignes.length + ' produit(s) comptés, ' + ecarts.length + ' écart(s) : ' +
            ecarts.slice(0, 15).map((l) => l.p.nom + ' (attendu ' + formatQuantite(l.attendu) + ', compté ' + formatQuantite(l.compte) + ')').join(' ; ') });
        }
        f.fermer(); App.rafraichir();
        this.afficherRapportInventaire(rapport);
      } catch (e) { toast(Reseau.traduire(e), 'erreur'); }
    });
  },

  afficherRapportInventaire(r) {
    const manque = r.lignes.filter((l) => l.ecart < 0), trop = r.lignes.filter((l) => l.ecart > 0);
    const perte = manque.reduce((t, l) => t + l.valeurUSD, 0), gain = trop.reduce((t, l) => t + l.valeurUSD, 0);
    const html = '<p class="petit">' + esc(formatDateHeure(r.date)) + ' · ' + esc(r.auteur) + ' · ' + r.comptes + ' produit(s) compté(s)</p>' +
      (r.lignes.length
        ? '<div class="bandeau rouge"><b>' + r.lignes.length + ' écart(s)</b>' + (manque.length ? ' · manquants : ' + formatUSD(Math.abs(perte)) + ' (au prix d\'achat)' : '') + (trop.length ? ' · en trop : ' + formatUSD(gain) : '') + '</div>' +
          '<div class="liste">' + r.lignes.map((l) => '<div class="ligne" style="cursor:default"><div><div class="nom">' + esc(l.nom) + '</div><div class="sous">Attendu ' + formatQuantite(l.attendu) + ' → compté ' + formatQuantite(l.compte) + '</div></div>' +
            '<div class="droite gras ' + (l.ecart < 0 ? 'rouge-txt' : 'vert-txt') + '">' + (l.ecart > 0 ? '+' : '−') + formatQuantite(Math.abs(l.ecart)) + '</div></div>').join('') + '</div>'
        : '<div class="bandeau" style="background:#e1f3e8;color:#0b5a2e"><b>Aucun écart</b> : le stock de l\'application correspond à l\'étagère.</div>');
    ouvrirFenetre('Résultat de l\'inventaire', html + '<p class="petit" style="margin-top:10px">Ces quantités comptées serviront de point de départ au prochain inventaire.</p>');
  },

  async historiqueInventaires() {
    const histo = (await DB.lireParam('inventaires', []) || []).slice().reverse();
    if (!histo.length) { toast('Aucun inventaire enregistré pour le moment'); return; }
    const f = ouvrirFenetre('Inventaires passés',
      '<div class="liste">' + histo.map((r, i) => '<div class="ligne" data-i="' + i + '"><div><div class="nom">' + esc(formatDateHeure(r.date)) + '</div><div class="sous">' + esc(r.auteur) + ' · ' + r.comptes + ' compté(s)</div></div>' +
        '<div class="droite"><span class="badge ' + (r.lignes.length ? 'rouge' : '') + '">' + (r.lignes.length ? r.lignes.length + ' écart(s)' : 'Conforme') + '</span></div></div>').join('') + '</div>');
    $$('[data-i]', f.el).forEach((el) => el.addEventListener('click', () => this.afficherRapportInventaire(histo[Number(el.dataset.i)])));
  }
};
