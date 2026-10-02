/* AIVA Caisse - écran RAPPORTS (patron) : ventes, bénéfice, produits les plus vendus */
const VueRapports = {
  periode: 'jour', // 'jour' | 'semaine' | 'mois'

  debut() {
    return { jour: debutJour, semaine: debutSemaine, mois: debutMois }[this.periode]();
  },

  async afficher(conteneur) {
    const [ventesTout, dettes, produits, clients] = await Promise.all([DB.tout('ventes'), DB.tout('dettes'), DB.tout('produits'), DB.tout('clients')]);
    const valides = ventesTout.filter((v) => !v.annulee);
    const debut = this.debut();
    const ventes = valides.filter((v) => v.date >= debut);
    const paiementsDettes = dettes.filter((d) => d.type === 'paiement' && d.date >= debut);

    const ca = ventes.reduce((s, v) => s + v.totalUSD, 0);
    const cout = ventes.reduce((s, v) => s + (v.coutUSD || 0), 0);
    const benefice = ca - cout;
    const encaisseVentes = ventes.reduce((s, v) => s + v.payeUSD, 0);
    const encaisseDettes = paiementsDettes.reduce((s, d) => s + d.montantUSD, 0);
    const resteAcrediter = ventes.reduce((s, v) => s + (v.resteUSD || 0), 0);
    const totalDettes = clients.reduce((s, c) => s + Math.max(0, VueDettes.soldeDepuis(dettes, c.id)), 0);

    // Produits les plus vendus
    const parProduit = {};
    ventes.forEach((v) => v.lignes.forEach((l) => {
      const x = parProduit[l.nom] || (parProduit[l.nom] = { nom: l.nom, qte: 0, total: 0 });
      x.qte += l.qte; x.total += l.qte * l.prixUnitaireUSD;
    }));
    const top = Object.values(parProduit).sort((a, b) => b.qte - a.qte).slice(0, 5);
    const maxQte = top.length ? top[0].qte : 1;

    // Répartition par moyen de paiement
    const parMode = {};
    ventes.forEach((v) => { parMode[v.mode] = (parMode[v.mode] || 0) + v.totalUSD; });
    const modes = Object.keys(parMode).sort((a, b) => parMode[b] - parMode[a]);

    // Graphique des 7 derniers jours
    const jours = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dj = debutJour(d);
      const total = valides.filter((v) => v.date >= dj && v.date < dj + 86400000).reduce((s, v) => s + v.totalUSD, 0);
      jours.push({ lib: d.toLocaleDateString('fr-FR', { weekday: 'short' }).slice(0, 3), total });
    }
    const maxJour = Math.max(...jours.map((j) => j.total), 0.01);
    const alertes = produits.filter((p) => VueStock.etat(p) !== 'ok').length;
    const dernieres = [...ventesTout].filter((v) => v.date >= debut).sort((a, b) => b.date - a.date).slice(0, 12);

    conteneur.innerHTML =
      (await App.bandeaux()) +
      '<div class="segment" id="periodes"><button data-p="jour">Aujourd\'hui</button><button data-p="semaine">Cette semaine</button><button data-p="mois">Ce mois</button></div>' +
      '<div class="stats">' +
        '<div class="stat"><div class="lib">Ventes</div><div class="val">' + formatUSD(ca) + '</div><div class="val2">' + formatCDF(ca * App.taux()) + '</div></div>' +
        '<div class="stat vert"><div class="lib">Bénéfice</div><div class="val">' + formatUSD(benefice) + '</div><div class="val2">' + formatCDF(benefice * App.taux()) + '</div></div>' +
        '<div class="stat"><div class="lib">Nombre de ventes</div><div class="val">' + ventes.length + '</div><div class="val2">Panier moyen : ' + formatUSD(ventes.length ? ca / ventes.length : 0) + '</div></div>' +
        '<div class="stat"><div class="lib">Argent encaissé</div><div class="val">' + formatUSD(encaisseVentes + encaisseDettes) + '</div><div class="val2">dont dettes payées : ' + formatUSD(encaisseDettes) + '</div></div>' +
        '<div class="stat ' + (resteAcrediter > 0.005 ? 'rouge' : '') + '"><div class="lib">Vendu à crédit (période)</div><div class="val">' + formatUSD(resteAcrediter) + '</div></div>' +
        '<div class="stat ' + (totalDettes > 0.005 ? 'rouge' : '') + '"><div class="lib">Dettes clients (total)</div><div class="val">' + formatUSD(totalDettes) + '</div></div>' +
      '</div>' +
      (alertes ? '<div class="carte alerte ligne-flex" id="versStock" style="cursor:pointer"><span><b>' + alertes + '</b> produit(s) en rupture ou stock bas</span><span>&rsaquo;</span></div>' : '') +
      '<div class="carte"><h3>7 derniers jours</h3><div class="graphique">' + jours.map((j) =>
        '<div class="col"><div class="petit" style="font-size:.65rem">' + (j.total > 0 ? Math.round(j.total) : '') + '</div><div class="barre-g" style="height:' + Math.max(2, Math.round(j.total / maxJour * 90)) + '%"></div><div class="lib-g">' + j.lib + '</div></div>').join('') + '</div></div>' +
      '<div class="carte"><h3>Produits les plus vendus</h3>' + (top.length ? top.map((t) =>
        '<div style="margin-top:10px"><div class="ligne-flex"><span>' + esc(t.nom) + '</span><span class="gras">' + formatQuantite(t.qte) + ' vendu(s)</span></div>' +
        '<div class="barre-h"><i style="width:' + Math.round(t.qte / maxQte * 100) + '%"></i></div><div class="petit">' + formatUSD(t.total) + '</div></div>').join('') : '<p class="petit">Aucune vente sur cette période.</p>') + '</div>' +
      '<div class="carte"><h3>Par moyen de paiement</h3>' + (modes.length ? modes.map((m) =>
        '<div class="ligne-flex" style="margin-top:8px"><span>' + (LIBELLES_MODE[m] || m) + '</span><span class="gras">' + formatUSD(parMode[m]) + '</span></div>').join('') : '<p class="petit">Rien à afficher.</p>') + '</div>' +
      '<h3 style="margin:6px 0 8px">Dernières ventes</h3>' +
      (dernieres.length ? '<div class="liste">' + dernieres.map((v) =>
        '<div class="ligne" data-id="' + v.id + '"><div><div class="nom">Vente n° ' + v.id + (v.annulee ? ' <span class="badge gris">Annulée</span>' : '') + '</div>' +
        '<div class="sous">' + formatDateHeure(v.date) + ' &middot; ' + (LIBELLES_MODE[v.mode] || v.mode) + ' &middot; ' + esc(v.vendeur || '') + '</div></div>' +
        '<div class="droite gras">' + formatUSD(v.totalUSD) + '</div></div>').join('') + '</div>' : '<div class="vide">Aucune vente sur cette période.</div>');

    $$('#periodes button').forEach((b) => {
      b.classList.toggle('actif', b.dataset.p === this.periode);
      b.addEventListener('click', () => { this.periode = b.dataset.p; this.afficher(conteneur); });
    });
    const versStock = $('#versStock'); if (versStock) versStock.addEventListener('click', () => { VueStock.filtre = 'alertes'; App.aller('stock'); });
    $$('.liste .ligne[data-id]', conteneur).forEach((l) => l.addEventListener('click', () => this.detailVente(Number(l.dataset.id), clients)));
  },

  async detailVente(id, clients) {
    const v = await DB.lire('ventes', id);
    if (!v) return;
    const client = clients.find((c) => c.id === v.clientId);
    const texte = construireRecu(v, client);
    const f = ouvrirFenetre('Vente n° ' + v.id,
      '<div class="recu">' + esc(texte.replace(/\*/g, '')) + '</div>' +
      '<div class="petit" style="margin-bottom:10px">Vendeur : ' + esc(v.vendeur || '-') + ' &middot; Bénéfice : ' + formatUSD(v.totalUSD - (v.coutUSD || 0)) + '</div>' +
      '<div class="pile"><button class="btn" id="vWa">Envoyer le reçu sur WhatsApp</button>' +
      (v.annulee ? '' : '<button class="btn rouge" id="vAnnuler">Annuler cette vente</button>') + '</div>');
    $('#vWa', f.el).addEventListener('click', () => ouvrirLien(lienWhatsApp(client ? client.tel : '', texte)));
    const ann = $('#vAnnuler', f.el);
    if (ann) ann.addEventListener('click', async () => {
      if (!(await confirmer('Annuler la vente', 'Le stock sera remis et la dette éventuelle supprimée. Continuer ?', 'Annuler la vente', true))) return;
      try { await DB.annulerVente(v.id); f.fermer(); toast('Vente annulée', 'ok'); App.rafraichir(); }
      catch (e) { toast(e.message, 'erreur'); }
    });
  }
};

// Calcul du solde d'un client à partir d'une liste de mouvements déjà chargée
VueDettes.soldeDepuis = function (mouvements, idClient) {
  return arrondi(mouvements.filter((m) => m.clientId === idClient)
    .reduce((s, m) => s + (m.type === 'dette' ? m.montantUSD : -m.montantUSD), 0), 6);
};
