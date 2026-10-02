/* AIVA Caisse - données de démonstration
   Génère une petite boutique de Kinshasa avec 20 produits, 3 clients endettés
   et ~14 jours de ventes pour que les rapports soient remplis. */
const Demo = (() => {
  // Générateur pseudo-aléatoire reproductible (même démo à chaque fois)
  function alea(graine) {
    return function () {
      graine |= 0; graine = (graine + 0x6D2B79F5) | 0;
      let t = Math.imul(graine ^ (graine >>> 15), 1 | graine);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // [nom, catégorie, devise, prix achat, prix vente, stock FINAL voulu, seuil d'alerte]
  const PRODUITS = [
    ['Sucre 1 kg', 'Alimentation', 'USD', 1.20, 1.60, 40, 10],
    ['Riz 5 kg', 'Alimentation', 'USD', 5.50, 7.00, 25, 5],
    ['Huile végétale 1 L', 'Alimentation', 'USD', 2.30, 3.00, 30, 8],
    ['Farine de maïs 5 kg', 'Alimentation', 'USD', 4.00, 5.50, 18, 5],
    ['Lait en poudre sachet', 'Alimentation', 'USD', 0.90, 1.30, 50, 12],
    ['Savon de toilette', 'Hygiène', 'CDF', 1500, 2000, 60, 15],
    ['Savon de lessive barre', 'Hygiène', 'CDF', 1800, 2500, 45, 10],
    ['Dentifrice', 'Hygiène', 'USD', 1.10, 1.60, 24, 6],
    ['Eau minérale 1,5 L', 'Boissons', 'CDF', 1800, 2500, 80, 20],
    ['Jus en bouteille 50 cl', 'Boissons', 'CDF', 1500, 2000, 70, 15],
    ['Boisson gazeuse 33 cl', 'Boissons', 'CDF', 1200, 1800, 100, 24],
    ['Biscuits paquet', 'Alimentation', 'CDF', 800, 1200, 90, 20],
    ['Allumettes boîte', 'Divers', 'CDF', 100, 200, 200, 40],
    ['Bougie', 'Divers', 'CDF', 500, 800, 60, 15],
    ['Piles AA (paire)', 'Divers', 'USD', 0.50, 0.80, 30, 8],
    ['Cahier 96 pages', 'Papeterie', 'CDF', 1500, 2200, 35, 10],
    ['Stylo bille', 'Papeterie', 'CDF', 300, 500, 120, 30],
    ['Tomate concentrée boîte', 'Alimentation', 'USD', 0.60, 0.90, 4, 6],   // stock bas : alerte
    ['Sel 1 kg', 'Alimentation', 'USD', 0.40, 0.70, 0, 5],                  // rupture
    ['Sardines boîte', 'Alimentation', 'USD', 0.80, 1.20, 3, 8]             // stock bas : alerte
  ];

  const CLIENTS = [
    { id: 1, nom: 'Mama Julie', tel: '0812345678' },
    { id: 2, nom: 'Papa Joseph', tel: '0998765432' },
    { id: 3, nom: 'Tantine Grâce', tel: '0850001122' }
  ];

  function generer(taux, parametres) {
    const rnd = alea(2026);
    const maintenant = Date.now();
    const produits = PRODUITS.map((p, i) => ({
      id: i + 1, nom: p[0], categorie: p[1], devise: p[2], prixAchat: p[3], prixVente: p[4],
      stock: p[5], seuil: p[6],
      codeBarres: i < 12 ? '20000000' + String(i + 1).padStart(5, '0') : ''
    }));
    const vendus = {}; // quantités vendues par produit (pour calculer le stock de départ)
    const ventes = [], mouvements = [], dettes = [];
    let idVente = 1, idMvt = 1, idDette = 1;

    const prixUSD = (p) => versUSD(p.prixVente, p.devise, taux);
    const coutUSD = (p) => versUSD(p.prixAchat, p.devise, taux);

    function creerVente(date, lignesChoisies, mode, extra) {
      const lignes = lignesChoisies.map(([p, q]) => ({
        produitId: p.id, nom: p.nom, qte: q, prixUnitaireUSD: arrondi(prixUSD(p), 6), prixAchatUSD: arrondi(coutUSD(p), 6)
      }));
      const total = arrondi(lignes.reduce((s, l) => s + l.qte * l.prixUnitaireUSD, 0), 6);
      const cout = arrondi(lignes.reduce((s, l) => s + l.qte * l.prixAchatUSD, 0), 6);
      const v = Object.assign({
        id: idVente++, date, lignes, totalUSD: total, coutUSD: cout, taux, mode,
        devisePaiement: 'USD', reference: '', clientId: null, payeUSD: total, resteUSD: 0,
        vendeur: rnd() < 0.5 ? 'Patron' : 'Vendeur', annulee: false
      }, extra || {});
      ventes.push(v);
      lignes.forEach((l) => {
        vendus[l.produitId] = (vendus[l.produitId] || 0) + l.qte;
        mouvements.push({ id: idMvt++, produitId: l.produitId, nom: l.nom, date, type: 'vente', qte: -l.qte, note: 'Vente', vendeur: v.vendeur });
      });
      return v;
    }

    // Ventes des 14 derniers jours
    for (let j = 13; j >= 0; j--) {
      const nb = j === 0 ? 3 : 4 + Math.floor(rnd() * 6);
      for (let k = 0; k < nb; k++) {
        const d = new Date(maintenant); d.setDate(d.getDate() - j);
        d.setHours(8 + Math.floor(rnd() * 11), Math.floor(rnd() * 60), 0, 0);
        if (d.getTime() > maintenant) d.setTime(maintenant - 60000 * (k + 1));
        const nbLignes = 1 + Math.floor(rnd() * 4);
        const choisis = [];
        const deja = new Set();
        while (choisis.length < nbLignes) {
          const p = produits[Math.floor(rnd() * 17)]; // les 17 premiers ont toujours du stock
          if (deja.has(p.id)) continue;
          deja.add(p.id);
          choisis.push([p, 1 + Math.floor(rnd() * 3)]);
        }
        const tirage = rnd();
        let mode = 'especes', extra = { devisePaiement: rnd() < 0.5 ? 'USD' : 'CDF' };
        if (tirage > 0.55 && tirage <= 0.8) { mode = 'mpesa'; extra = { reference: 'MP' + (100000 + Math.floor(rnd() * 899999)) }; }
        else if (tirage > 0.8 && tirage <= 0.92) { mode = 'airtel'; extra = { reference: 'AM' + (100000 + Math.floor(rnd() * 899999)) }; }
        else if (tirage > 0.92) { mode = 'orange'; extra = { reference: 'OM' + (100000 + Math.floor(rnd() * 899999)) }; }
        creerVente(d.getTime(), choisis, mode, extra);
      }
    }

    // Trois ventes à crédit (dettes) et un paiement partiel
    const credits = [[12, 1, [[produits[1], 2], [produits[2], 1]], 0], [8, 2, [[produits[3], 3], [produits[0], 4]], 0], [3, 3, [[produits[4], 4], [produits[7], 1]], 0]];
    credits.forEach(([j, idClient, lignes, paye]) => {
      const d = new Date(maintenant); d.setDate(d.getDate() - j); d.setHours(11, 20, 0, 0);
      const v = creerVente(d.getTime(), lignes, 'dette', { clientId: idClient, payeUSD: paye, resteUSD: 0 });
      v.resteUSD = arrondi(v.totalUSD - paye, 6);
      dettes.push({ id: idDette++, clientId: idClient, date: v.date, type: 'dette', montantUSD: v.resteUSD, note: 'Vente n° ' + v.id, venteId: v.id });
    });
    const dPaiement = new Date(maintenant); dPaiement.setDate(dPaiement.getDate() - 5); dPaiement.setHours(16, 10, 0, 0);
    dettes.push({ id: idDette++, clientId: 2, date: dPaiement.getTime(), type: 'paiement', montantUSD: 10, mode: 'especes', note: 'Paiement partiel' });

    // Stock de départ = stock final voulu + quantités vendues (le stock final reste celui de la liste ci-dessus)
    produits.forEach((p) => { p.stock = arrondi(p.stock, 3); });
    // (le stock affiché est donc le stock FINAL : les ventes de démo ne le diminuent pas une 2e fois)

    // Réglages : on garde ceux déjà existants (PIN, taux...) s'il y en a
    const params = parametres && parametres.length ? parametres : [
      { cle: 'taux', valeur: taux },
      { cle: 'nomBoutique', valeur: 'Ma Boutique' },
      { cle: 'telBoutique', valeur: '' },
      { cle: 'affichage', valeur: 'USD' },
      { cle: 'pinPatron', valeur: hacher('1234') },
      { cle: 'pinVendeur', valeur: hacher('0000') }
    ];

    return {
      application: 'AIVA Caisse', version: 1, date: maintenant,
      donnees: { produits, ventes, clients: CLIENTS.map((c) => ({ ...c })), dettes, mouvements, params }
    };
  }

  return { generer };
})();
