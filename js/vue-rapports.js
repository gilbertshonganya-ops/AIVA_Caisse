/* AIVA Caisse - écran RAPPORTS (patron) : ventes, bénéfices, dépenses, rapport PDF */
const VueRapports = {
  periode: 'jour', // 'jour' | 'semaine' | 'mois'

  debut() { return { jour: debutJour, semaine: debutSemaine, mois: debutMois }[this.periode](); },
  libellePeriode() {
    const d = this.debut();
    if (this.periode === 'jour') return 'Aujourd\'hui, ' + formatDate(d);
    if (this.periode === 'semaine') return 'Semaine du ' + formatDate(d) + ' au ' + formatDate(Date.now());
    return 'Mois de ' + new Date(d).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  },

  // Calcule tous les chiffres de la période (utilisé par l'écran ET par le PDF)
  async collecter() {
    const [ventesTout, dettes, produits, clients, depensesTout, achatsTout, dettesF, fournisseurs] = await Promise.all([
      DB.tout('ventes'), DB.tout('dettes'), DB.tout('produits'), DB.tout('clients'),
      DB.tout('depenses'), DB.tout('achats'), DB.tout('dettesFournisseurs'), DB.tout('fournisseurs')]);
    const debut = this.debut();
    const valides = ventesTout.filter((v) => !v.annulee);
    const ventes = valides.filter((v) => v.date >= debut);
    const depenses = depensesTout.filter((d) => d.date >= debut);
    const achats = achatsTout.filter((a) => a.date >= debut);
    const paiementsDettes = dettes.filter((d) => d.type === 'paiement' && d.date >= debut);

    const d = { debut, ventesTout, valides, ventes, depenses, achats, produits };
    d.ca = ventes.reduce((s, v) => s + v.totalUSD, 0);
    d.cout = ventes.reduce((s, v) => s + (v.coutUSD || 0), 0);
    d.beneficeBrut = d.ca - d.cout;
    d.totalDepenses = depenses.reduce((s, x) => s + x.montantUSD, 0);
    d.beneficeNet = d.beneficeBrut - d.totalDepenses;
    d.encaisseVentes = ventes.reduce((s, v) => s + v.payeUSD, 0);
    d.encaisseDettes = paiementsDettes.reduce((s, x) => s + x.montantUSD, 0);
    d.resteACrediter = ventes.reduce((s, v) => s + (v.resteUSD || 0), 0);
    d.dettesClients = clients.map((c) => ({ nom: c.nom, tel: c.tel, solde: VueDettes.soldeDepuis(dettes, c.id) })).filter((x) => x.solde > 0.005).sort((a, b) => b.solde - a.solde);
    d.totalDettesClients = d.dettesClients.reduce((s, x) => s + x.solde, 0);
    d.dettesFournisseurs = fournisseurs.map((f) => ({
      nom: f.nom, solde: arrondi(dettesF.filter((m) => m.fournisseurId === f.id).reduce((s, m) => s + (m.type === 'dette' ? m.montantUSD : -m.montantUSD), 0), 6)
    })).filter((x) => x.solde > 0.005).sort((a, b) => b.solde - a.solde);
    d.totalDettesFournisseurs = d.dettesFournisseurs.reduce((s, x) => s + x.solde, 0);
    d.totalAchats = achats.reduce((s, a) => s + a.totalUSD, 0);

    const parProduit = {};
    ventes.forEach((v) => v.lignes.forEach((l) => {
      const x = parProduit[l.nom] || (parProduit[l.nom] = { nom: l.nom, qte: 0, total: 0 });
      x.qte += l.qte; x.total += l.qte * l.prixUnitaireUSD;
    }));
    d.top = Object.values(parProduit).sort((a, b) => b.qte - a.qte);
    d.parMode = {};
    ventes.forEach((v) => { d.parMode[v.mode] = (d.parMode[v.mode] || 0) + v.totalUSD; });
    d.parCategorie = {};
    depenses.forEach((x) => { d.parCategorie[x.categorie] = (d.parCategorie[x.categorie] || 0) + x.montantUSD; });
    d.stockBas = produits.filter((p) => VueStock.etat(p) !== 'ok').sort((a, b) => a.stock - b.stock);
    return d;
  },

  async afficher(conteneur) {
    const d = await this.collecter();
    const jours = [];
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(); dt.setDate(dt.getDate() - i);
      const dj = debutJour(dt);
      jours.push({ lib: dt.toLocaleDateString('fr-FR', { weekday: 'short' }).slice(0, 3), total: d.valides.filter((v) => v.date >= dj && v.date < dj + 86400000).reduce((s, v) => s + v.totalUSD, 0) });
    }
    const maxJour = Math.max(...jours.map((j) => j.total), 0.01);
    const top = d.top.slice(0, 5), maxQte = top.length ? top[0].qte : 1;
    const modes = Object.keys(d.parMode).sort((a, b) => d.parMode[b] - d.parMode[a]);
    const dernieres = d.ventesTout.filter((v) => v.date >= d.debut).sort((a, b) => b.date - a.date).slice(0, 12);
    const t = App.taux();
    const stat = (cls, lib, usd, sous) => '<div class="stat ' + cls + '"><div class="lib">' + lib + '</div><div class="val">' + formatUSD(usd) + '</div><div class="val2">' + (sous || formatCDF(usd * t)) + '</div></div>';

    conteneur.innerHTML =
      (await App.bandeaux()) +
      '<div class="segment" id="periodes"><button data-p="jour">Aujourd\'hui</button><button data-p="semaine">Cette semaine</button><button data-p="mois">Ce mois</button></div>' +
      '<div class="stats">' +
        stat('', 'Ventes', d.ca) +
        stat('', 'Bénéfice sur ventes', d.beneficeBrut) +
        stat('', 'Dépenses', d.totalDepenses) +
        stat(d.beneficeNet >= 0 ? 'vert' : 'rouge', 'Bénéfice net', d.beneficeNet) +
        '<div class="stat"><div class="lib">Nombre de ventes</div><div class="val">' + d.ventes.length + '</div><div class="val2">Panier moyen : ' + formatUSD(d.ventes.length ? d.ca / d.ventes.length : 0) + '</div></div>' +
        stat('', 'Argent encaissé', d.encaisseVentes + d.encaisseDettes, 'dont dettes payées : ' + formatUSD(d.encaisseDettes)) +
        stat(d.resteACrediter > 0.005 ? 'rouge' : '', 'Vendu à crédit (période)', d.resteACrediter, ' ') +
        stat(d.totalDettesClients > 0.005 ? 'rouge' : '', 'Dettes clients (total)', d.totalDettesClients, ' ') +
        stat(d.totalDettesFournisseurs > 0.005 ? 'rouge' : '', 'Dettes fournisseurs (total)', d.totalDettesFournisseurs, ' ') +
        stat('', 'Achats de la période', d.totalAchats, ' ') +
      '</div>' +
      '<p class="petit" style="margin:-4px 2px 12px">Bénéfice net = ventes − coût des marchandises vendues − dépenses.</p>' +
      '<button class="btn contour" id="btnPdf" style="margin-bottom:12px">Télécharger le rapport PDF</button>' +
      (d.stockBas.length ? '<div class="carte alerte ligne-flex" id="versStock" style="cursor:pointer"><span><b>' + d.stockBas.length + '</b> produit(s) en rupture ou stock bas</span><span>&rsaquo;</span></div>' : '') +
      '<div class="carte"><h3>7 derniers jours</h3><div class="graphique">' + jours.map((j) =>
        '<div class="col"><div class="petit" style="font-size:.65rem">' + (j.total > 0 ? Math.round(j.total) : '') + '</div><div class="barre-g" style="height:' + Math.max(2, Math.round(j.total / maxJour * 90)) + '%"></div><div class="lib-g">' + j.lib + '</div></div>').join('') + '</div></div>' +
      '<div class="carte"><h3>Produits les plus vendus</h3>' + (top.length ? top.map((x) =>
        '<div style="margin-top:10px"><div class="ligne-flex"><span>' + esc(x.nom) + '</span><span class="gras">' + formatQuantite(x.qte) + ' vendu(s)</span></div>' +
        '<div class="barre-h"><i style="width:' + Math.round(x.qte / maxQte * 100) + '%"></i></div><div class="petit">' + formatUSD(x.total) + '</div></div>').join('') : '<p class="petit">Aucune vente sur cette période.</p>') + '</div>' +
      '<div class="carte"><h3>Par moyen de paiement</h3>' + (modes.length ? modes.map((m) =>
        '<div class="ligne-flex" style="margin-top:8px"><span>' + (LIBELLES_MODE[m] || m) + '</span><span class="gras">' + formatUSD(d.parMode[m]) + '</span></div>').join('') : '<p class="petit">Rien à afficher.</p>') + '</div>' +
      '<h3 style="margin:6px 0 8px">Dernières ventes</h3>' +
      (dernieres.length ? '<div class="liste">' + dernieres.map((v) =>
        '<div class="ligne" data-id="' + v.id + '"><div><div class="nom">Vente n° ' + v.id + (v.annulee ? ' <span class="badge gris">Annulée</span>' : '') + '</div>' +
        '<div class="sous">' + formatDateHeure(v.date) + ' &middot; ' + (LIBELLES_MODE[v.mode] || v.mode) + ' &middot; ' + esc(v.vendeur || '') + '</div></div>' +
        '<div class="droite gras">' + formatUSD(v.totalUSD) + '</div></div>').join('') + '</div>' : '<div class="vide">Aucune vente sur cette période.</div>');

    $$('#periodes button').forEach((b) => {
      b.classList.toggle('actif', b.dataset.p === this.periode);
      b.addEventListener('click', () => { this.periode = b.dataset.p; this.afficher(conteneur); });
    });
    $('#btnPdf').addEventListener('click', async () => {
      try {
        const nom = 'rapport-aiva-caisse-' + this.periode + '-' + new Date().toISOString().slice(0, 10) + '.pdf';
        await enregistrerFichier(nom, this.genererPdf(d), 'application/pdf');
      } catch (e) { toast('Impossible de créer le PDF : ' + e.message, 'erreur'); }
    });
    const versStock = $('#versStock'); if (versStock) versStock.addEventListener('click', () => { VueStock.filtre = 'alertes'; App.aller('stock'); });
    const clients = await DB.tout('clients');
    $$('.liste .ligne[data-id]', conteneur).forEach((l) => l.addEventListener('click', () => this.detailVente(Number(l.dataset.id), clients)));
  },

  // ---------- Rapport PDF ----------
  genererPdf(d) {
    const doc = Pdf.creer();
    const VERT = [11, 122, 62], GRIS = [93, 107, 100], ROUGE = [198, 40, 40], FOND = [243, 245, 244];
    const ML = 40, MR = 40, LARG = doc.largeur - ML - MR, BAS = doc.hauteur - 50;
    const t = App.taux();
    let y = 0;

    const entete = () => {
      doc.nouvellePage();
      doc.rect(0, 0, doc.largeur, 70, VERT);
      doc.texte(ML, 34, App.reglages.nomBoutique || 'AIVA Caisse', { taille: 18, gras: true, couleur: [255, 255, 255] });
      doc.texte(ML, 54, 'Rapport de gestion - ' + this.libellePeriode(), { taille: 10, couleur: [255, 255, 255] });
      doc.texte(doc.largeur - MR, 34, 'Taux : 1 $ = ' + formatCDF(t), { taille: 9, couleur: [255, 255, 255], align: 'right' });
      doc.texte(doc.largeur - MR, 54, 'Édité le ' + formatDateHeure(Date.now()), { taille: 9, couleur: [255, 255, 255], align: 'right' });
      y = 96;
    };
    const place = (hauteur) => { if (y + hauteur > BAS) entete(); };
    const titre = (texte) => {
      place(44);
      doc.texte(ML, y, texte, { taille: 12, gras: true, couleur: VERT });
      doc.ligne(ML, y + 5, ML + LARG, y + 5, VERT, 1);
      y += 22;
    };
    // Colonnes : x = position depuis la marge gauche ; "droite" = le texte se termine à x ; max = largeur maximale du texte
    const COL2 = [{ x: 0, max: 380 }, { x: LARG - 6, droite: true }];
    const COL3 = [{ x: 0, max: 280 }, { x: 390, droite: true }, { x: LARG - 6, droite: true }];
    const tableau = (colonnes, lignes, options = {}) => {
      lignes.forEach((cells, i) => {
        place(16);
        if (i % 2 === 0) doc.rect(ML, y - 11, LARG, 15, FOND);
        const rouge = options.rouge && options.rouge(cells, i);
        const gras = (options.gras && options.gras(cells, i)) || (options.entete && i === 0);
        cells.forEach((c, k) => {
          const col = colonnes[k];
          const o = { taille: 9.5, gras: !!gras, couleur: rouge ? ROUGE : [0, 0, 0] };
          if (col.droite) doc.texte(ML + col.x, y, String(c), Object.assign({ align: 'right' }, o));
          else doc.texte(ML + col.x + 4, y, Pdf.tronquer(String(c), col.max, 9.5, !!gras), o);
        });
        y += 15;
      });
      y += 8;
    };

    entete();

    titre('Résultats de la période');
    tableau(COL2, [
      ['Ventes', formatUSD(d.ca)],
      ['Coût des marchandises vendues', formatUSD(d.cout)],
      ['Bénéfice sur ventes', formatUSD(d.beneficeBrut)],
      ['Dépenses de la boutique', formatUSD(d.totalDepenses)],
      ['BÉNÉFICE NET', formatUSD(d.beneficeNet)],
      ['Nombre de ventes', String(d.ventes.length)],
      ['Panier moyen', formatUSD(d.ventes.length ? d.ca / d.ventes.length : 0)],
      ['Argent encaissé (ventes + dettes payées)', formatUSD(d.encaisseVentes + d.encaisseDettes)],
      ['Vendu à crédit sur la période', formatUSD(d.resteACrediter)],
      ['Achats aux fournisseurs sur la période', formatUSD(d.totalAchats)]
    ], { gras: (c) => c[0] === 'BÉNÉFICE NET', rouge: (c) => c[0] === 'BÉNÉFICE NET' && d.beneficeNet < 0 });

    titre('Ventes par moyen de paiement');
    const modes = Object.keys(d.parMode).sort((a, b) => d.parMode[b] - d.parMode[a]);
    tableau(COL2, modes.length ? modes.map((m) => [LIBELLES_MODE[m] || m, formatUSD(d.parMode[m])]) : [['Aucune vente sur cette période', '']]);

    titre('Produits les plus vendus');
    tableau(COL3, d.top.length
      ? [['Produit', 'Quantité', 'Montant']].concat(d.top.slice(0, 10).map((x) => [x.nom, formatQuantite(x.qte), formatUSD(x.total)]))
      : [['Aucune vente sur cette période', '', '']], { entete: d.top.length > 0 });

    titre('Dépenses par catégorie');
    const cats = Object.keys(d.parCategorie).sort((a, b) => d.parCategorie[b] - d.parCategorie[a]);
    tableau(COL2, cats.length ? cats.map((c) => [c, formatUSD(d.parCategorie[c])]) : [['Aucune dépense sur cette période', '']]);

    titre('Dettes des clients (total : ' + formatUSD(d.totalDettesClients) + ')');
    tableau(COL2, d.dettesClients.length ? d.dettesClients.slice(0, 25).map((x) => [x.nom + (x.tel ? '  (' + x.tel + ')' : ''), formatUSD(x.solde)]) : [['Aucune dette', '']], { rouge: (c) => c[1] !== '' });

    titre('Dettes envers les fournisseurs (total : ' + formatUSD(d.totalDettesFournisseurs) + ')');
    tableau(COL2, d.dettesFournisseurs.length ? d.dettesFournisseurs.map((x) => [x.nom, formatUSD(x.solde)]) : [['Aucune dette', '']]);

    titre('Produits à réapprovisionner');
    tableau(COL2, d.stockBas.length ? d.stockBas.slice(0, 30).map((p) => [p.nom, p.stock <= 0 ? 'RUPTURE' : formatQuantite(p.stock) + ' restant(s)']) : [['Aucun produit en alerte', '']], { rouge: (c) => c[1] === 'RUPTURE' });

    const n = doc.nbPages();
    for (let i = 0; i < n; i++) {
      doc.texte(ML, doc.hauteur - 28, 'AIVA Caisse - ' + (App.reglages.nomBoutique || ''), { taille: 8, couleur: GRIS, page: i });
      doc.texte(doc.largeur - MR, doc.hauteur - 28, 'Page ' + (i + 1) + ' / ' + n, { taille: 8, couleur: GRIS, align: 'right', page: i });
    }
    return doc.octets('Rapport ' + this.libellePeriode());
  },

  async detailVente(id, clients) {
    const v = await DB.lire('ventes', id);
    if (!v) return;
    const client = clients.find((c) => c.id === v.clientId);
    const texte = construireRecu(v, client);
    const f = ouvrirFenetre('Vente n° ' + v.id,
      '<div class="recu">' + esc(texte.replace(/\*/g, '')) + '</div>' +
      '<div class="petit" style="margin-bottom:10px">Vendeur : ' + esc(v.vendeur || '-') + ' &middot; Bénéfice : ' + formatUSD(v.totalUSD - (v.coutUSD || 0)) + '</div>' +
      '<div class="pile"><button class="btn" id="vWa">Envoyer le reçu sur WhatsApp</button><button class="btn gris" id="vImp">Imprimer le ticket</button>' +
      (v.annulee ? '' : '<button class="btn rouge" id="vAnnuler">Annuler cette vente</button>') + '</div>');
    $('#vWa', f.el).addEventListener('click', () => ouvrirLien(lienWhatsApp(client ? client.tel : '', texte)));
    $('#vImp', f.el).addEventListener('click', () => Imprimante.imprimerVente(v, client));
    const ann = $('#vAnnuler', f.el);
    if (ann) ann.addEventListener('click', async () => {
      if (!(await confirmer('Annuler la vente', 'Le stock sera remis et la dette éventuelle supprimée. Continuer ?', 'Annuler la vente', true))) return;
      try {
        await DB.annulerVente(v.id);
        Audit.log('vente_annulee', { id: v.id, total: arrondi(v.totalUSD, 2) + ' USD', mode: v.mode });
        f.fermer(); toast('Vente annulée', 'ok'); App.rafraichir();
      } catch (e) { toast(e.message, 'erreur'); }
    });
  }
};

// Calcul du solde d'un client à partir d'une liste de mouvements déjà chargée
VueDettes.soldeDepuis = function (mouvements, idClient) {
  return arrondi(mouvements.filter((m) => m.clientId === idClient)
    .reduce((s, m) => s + (m.type === 'dette' ? m.montantUSD : -m.montantUSD), 0), 6);
};
