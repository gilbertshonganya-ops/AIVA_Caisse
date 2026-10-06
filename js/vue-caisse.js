/* EvoBuskin - écran CAISSE : vente rapide, scan, paiement, reçu WhatsApp (ventes à crédit) */

const LIBELLES_MODE = { especes: 'Espèces', mpesa: 'M-Pesa', airtel: 'Airtel Money', orange: 'Orange Money', dette: 'À crédit' };

// Prix d'un produit dans sa propre devise (pour l'affichage sur la grille)
function prixProduit(p, champ = 'prixVente') {
  return p.devise === 'CDF' ? formatCDF(p[champ]) : formatUSD(p[champ]);
}

// Construit le texte du reçu (mis en forme pour WhatsApp : *gras*)
function construireRecu(vente, client) {
  const t = vente.taux || App.taux();
  const lignes = vente.lignes.map((l) =>
    formatQuantite(l.qte) + ' x ' + l.nom + ' = ' + formatUSD(l.qte * l.prixUnitaireUSD));
  const sortie = [
    '*' + (App.reglages.nomBoutique || 'EvoBuskin') + '*',
    'Reçu n° ' + vente.id + ' - ' + formatDateHeure(vente.date),
    '--------------------',
    ...lignes,
    '--------------------',
    'TOTAL : ' + formatDeuxDevises(vente.totalUSD, t),
    'Paiement : ' + (LIBELLES_MODE[vente.mode] || vente.mode) + (vente.reference ? ' (réf. ' + vente.reference + ')' : '')
  ];
  if (vente.payeUSD > 0.0001) sortie.push('Payé : ' + formatDeuxDevises(vente.payeUSD, t));
  if (vente.resteUSD > 0.0001) sortie.push('Reste à payer : ' + formatDeuxDevises(vente.resteUSD, t));
  if (client) sortie.push('Client : ' + client.nom);
  if (vente.annulee) sortie.push('*VENTE ANNULÉE*');
  sortie.push('Merci de votre confiance !');
  return sortie.join('\n');
}

const VueCaisse = {
  panier: [],          // lignes du panier : { produitId, nom, qte, prixUSD, coutUSD, stock }
  recherche: '',
  categorie: 'Tous',
  produits: [],

  async afficher(conteneur) {
    this.produits = await DB.tout('produits');
    const bandeaux = await App.bandeaux();
    conteneur.innerHTML =
      bandeaux +
      '<div class="recherche">' +
        '<input id="rech" type="search" placeholder="Chercher ou taper un code-barres" autocomplete="off" value="' + esc(this.recherche) + '">' +
        '<button class="btn" id="btnScan" aria-label="Scanner">&#128247;</button>' +
      '</div>' +
      '<div class="categories" id="cats"></div>' +
      '<div id="grille" class="grille-produits"></div>' +
      '<div class="barre-panier" id="barrePanier"></div>';

    $('#rech').addEventListener('input', (e) => { this.recherche = e.target.value; this.dessinerGrille(); });
    // Les scanners USB/Bluetooth tapent le code puis "Entrée"
    $('#rech').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const code = e.target.value.trim();
      if (this.ajouterParCode(code)) { e.target.value = ''; this.recherche = ''; this.dessinerGrille(); }
    });
    $('#btnScan').addEventListener('click', () => this.scanner());
    this.dessinerCategories();
    this.dessinerGrille();
    this.dessinerBarrePanier();
  },

  dessinerCategories() {
    const cats = ['Tous', ...Array.from(new Set(this.produits.map((p) => p.categorie).filter(Boolean))).sort()];
    if (!cats.includes(this.categorie)) this.categorie = 'Tous';
    const el = $('#cats');
    el.innerHTML = cats.length > 2 ? cats.map((c) => '<button class="' + (c === this.categorie ? 'actif' : '') + '" data-c="' + esc(c) + '">' + esc(c) + '</button>').join('') : '';
    $$('button', el).forEach((b) => b.addEventListener('click', () => { this.categorie = b.dataset.c; this.dessinerCategories(); this.dessinerGrille(); }));
  },

  dessinerGrille() {
    const grille = $('#grille');
    if (!this.produits.length) {
      grille.style.display = 'block';
      grille.innerHTML = '<div class="carte vide">Aucun produit pour l\'instant.' +
        (App.estPatron()
          ? '<div class="pile" style="margin-top:12px"><button class="btn" id="vaStock">Ajouter mes produits</button><button class="btn contour" id="vaDemo">Essayer avec des données de démonstration</button></div>'
          : '<br>Demandez au patron d\'ajouter les produits.') + '</div>';
      if (App.estPatron()) {
        $('#vaStock').addEventListener('click', () => App.aller('stock'));
        $('#vaDemo').addEventListener('click', () => VueReglages.chargerDemo());
      }
      return;
    }
    grille.style.display = '';
    const mots = this.recherche.trim().toLowerCase();
    const liste = this.produits
      .filter((p) => this.categorie === 'Tous' || p.categorie === this.categorie)
      .filter((p) => !mots || p.nom.toLowerCase().includes(mots) || (p.codeBarres && p.codeBarres.includes(mots)))
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    if (!liste.length) { grille.style.display = 'block'; grille.innerHTML = '<div class="vide">Aucun produit trouvé.</div>'; return; }
    grille.innerHTML = liste.map((p) => {
      const ligne = this.panier.find((l) => l.produitId === p.id);
      const rupture = p.stock <= 0;
      const sansPrix = prixAFixer(p);
      return '<button class="produit ' + ((rupture || sansPrix) ? 'rupture' : '') + '" data-id="' + p.id + '">' +
        (ligne ? '<span class="p-qte">' + formatQuantite(ligne.qte) + '</span>' : '') +
        '<span class="p-nom">' + esc(p.nom) + '</span>' +
        (sansPrix ? '<span class="p-prix" style="color:var(--couleur-alerte)">Prix à fixer</span>' : '<span class="p-prix">' + prixProduit(p) + '</span>') +
        '<span class="p-stock">' + (rupture ? 'Rupture de stock' : 'Stock : ' + formatQuantite(p.stock)) + '</span>' +
        '</button>';
    }).join('');
    $$('.produit', grille).forEach((b) => b.addEventListener('click', () => this.ajouter(Number(b.dataset.id))));
  },

  // ---------- Panier ----------
  ajouter(idProduit, quantite = 1) {
    const p = this.produits.find((x) => x.id === idProduit);
    if (!p) return false;
    if (prixAFixer(p)) {
      toast(App.estPatron() ? 'Le prix de « ' + p.nom + ' » n\'est pas encore fixé : allez dans Stock, touchez le produit puis Modifier.' : 'Le prix de « ' + p.nom + ' » n\'est pas encore fixé : demandez au patron.', 'erreur');
      return false;
    }
    if (p.stock <= 0) { toast('« ' + p.nom + ' » est en rupture de stock', 'erreur'); return false; }
    let ligne = this.panier.find((l) => l.produitId === idProduit);
    const nouvelle = (ligne ? ligne.qte : 0) + quantite;
    if (nouvelle > p.stock) { toast('Stock insuffisant : il reste ' + formatQuantite(p.stock) + ' « ' + p.nom + ' »', 'erreur'); return false; }
    if (!ligne) {
      ligne = {
        produitId: p.id, nom: p.nom, qte: 0, stock: p.stock,
        prixUSD: versUSD(p.prixVente, p.devise, App.taux()),
        coutUSD: versUSD(p.prixAchat || 0, p.devise, App.taux()),
        // Tarifs de gros et de carton (facultatifs, définis dans la fiche produit)
        prixGrosUSD: p.prixGros != null ? versUSD(p.prixGros, p.devise, App.taux()) : null,
        seuilGros: p.seuilGros || 0,
        cartonQte: p.cartonQte || 0,
        prixCartonUSD: p.prixCarton != null ? versUSD(p.prixCarton, p.devise, App.taux()) : null
      };
      this.panier.push(ligne);
    }
    ligne.qte = arrondi(nouvelle, 3);
    this.dessinerGrille();
    this.dessinerBarrePanier();
    if (navigator.vibrate) navigator.vibrate(15);
    return true;
  },

  ajouterParCode(code) {
    if (!code) return false;
    const p = this.produits.find((x) => x.codeBarres && x.codeBarres === code);
    if (p) { this.ajouter(p.id); return true; }
    return false;
  },

  async scanner() {
    const code = await Scanner.scanner();
    if (!code) return;
    if (this.ajouterParCode(code)) { toast('Produit ajouté', 'ok'); return; }
    if (App.estPatron()) {
      const creer = await confirmer('Code inconnu', 'Le code ' + code + ' n\'est pas dans votre stock. Voulez-vous créer ce produit ?', 'Créer le produit');
      if (creer) { await App.aller('stock'); VueStock.formulaire(null, code); }
    } else {
      toast('Code inconnu : demandez au patron d\'ajouter ce produit', 'erreur');
    }
  },

  totalUSD() { return arrondi(this.panier.reduce((s, l) => s + totalLigne(l), 0), 6); },
  nbArticles() { return this.panier.reduce((s, l) => s + l.qte, 0); },

  dessinerBarrePanier() {
    const el = $('#barrePanier');
    if (!el) return;
    if (!this.panier.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<button class="btn" id="ouvrirPanier"><span>Panier (' + formatQuantite(this.nbArticles()) + ')</span><span>' +
      (App.reglages.affichage === 'CDF' ? formatCDF(this.totalUSD() * App.taux()) : formatUSD(this.totalUSD())) + ' &rsaquo;</span></button>';
    $('#ouvrirPanier').addEventListener('click', () => this.ouvrirPanier());
  },

  ouvrirPanier() {
    const f = ouvrirFenetre('Panier', '<div id="corpsPanier"></div>', { auFermer: () => { this.dessinerGrille(); this.dessinerBarrePanier(); } });
    const dessiner = () => {
      const corps = $('#corpsPanier', f.el);
      if (!this.panier.length) { f.fermer(); this.dessinerGrille(); this.dessinerBarrePanier(); return; }
      corps.innerHTML = this.panier.map((l, i) =>
        '<div class="ligne-panier"><div class="info"><div class="nom">' + esc(l.nom) + '</div>' +
        '<div class="petit">' + descriptionTarif(l) + '</div>' +
        (l.cartonQte >= 2 ? '<button class="btn gris petit-btn" data-carton="' + i + '" style="margin-top:6px;padding:6px 10px">+ 1 carton (' + l.cartonQte + ')</button>' : '') + '</div>' +
        '<div class="qte-ctrl"><button data-moins="' + i + '">&minus;</button>' +
        '<input data-qte="' + i + '" inputmode="decimal" value="' + formatQuantite(l.qte).replace(/\s/g, '') + '">' +
        '<button data-plus="' + i + '">+</button></div>' +
        '<div class="droite gras" style="min-width:74px">' + formatUSD(totalLigne(l)) + '</div></div>'
      ).join('') +
      '<div class="ligne-flex" style="margin:14px 0 4px"><span>Total à payer</span><span class="total-grand">' + formatUSD(this.totalUSD()) + '</span></div>' +
      '<div class="droite petit" style="margin-bottom:10px">' + formatCDF(this.totalUSD() * App.taux()) + '</div>' +
      '<div class="ligne-boutons"><button class="btn gris" id="viderPanier">Vider</button><button class="btn" id="encaisser">Encaisser</button></div>';

      $$('[data-moins]', corps).forEach((b) => b.addEventListener('click', () => {
        const l = this.panier[Number(b.dataset.moins)];
        l.qte = arrondi(l.qte - 1, 3);
        if (l.qte <= 0) this.panier.splice(Number(b.dataset.moins), 1);
        dessiner();
      }));
      $$('[data-plus]', corps).forEach((b) => b.addEventListener('click', () => {
        const l = this.panier[Number(b.dataset.plus)];
        if (l.qte + 1 > l.stock) { toast('Stock insuffisant : il reste ' + formatQuantite(l.stock), 'erreur'); return; }
        l.qte = arrondi(l.qte + 1, 3);
        dessiner();
      }));
      $$('[data-carton]', corps).forEach((b) => b.addEventListener('click', () => {
        const l = this.panier[Number(b.dataset.carton)];
        if (l.qte + l.cartonQte > l.stock) { toast('Stock insuffisant : il reste ' + formatQuantite(l.stock), 'erreur'); return; }
        l.qte = arrondi(l.qte + l.cartonQte, 3);
        dessiner();
      }));
      $$('[data-qte]', corps).forEach((inp) => inp.addEventListener('change', () => {
        const i = Number(inp.dataset.qte);
        const l = this.panier[i];
        const v = lireNombre(inp.value);
        if (isNaN(v) || v < 0) { toast('Quantité invalide', 'erreur'); dessiner(); return; }
        if (v === 0) { this.panier.splice(i, 1); dessiner(); return; }
        if (v > l.stock) { toast('Stock insuffisant : il reste ' + formatQuantite(l.stock), 'erreur'); dessiner(); return; }
        l.qte = arrondi(v, 3);
        dessiner();
      }));
      $('#viderPanier', corps).addEventListener('click', async () => {
        if (await confirmer('Vider le panier', 'Retirer tous les articles ?', 'Vider', true)) { this.panier = []; f.fermer(); this.dessinerGrille(); this.dessinerBarrePanier(); }
      });
      $('#encaisser', corps).addEventListener('click', () => { f.fermer(); this.ouvrirPaiement(); });
    };
    dessiner();
  },

  // ---------- Paiement ----------
  async ouvrirPaiement() {
    if (!this.panier.length) return;
    const clients = (await DB.tout('clients')).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    const taux = App.taux();
    const total = this.totalUSD();
    const etat = { mode: 'especes', devise: App.reglages.affichage === 'CDF' ? 'CDF' : 'USD' };

    const f = ouvrirFenetre('Encaisser',
      '<div class="ligne-flex"><span>Total</span><span class="total-grand">' + formatUSD(total) + '</span></div>' +
      '<div class="droite petit" style="margin-bottom:10px">' + formatCDF(total * taux) + ' (taux : 1 $ = ' + formatCDF(taux) + ')</div>' +
      '<div class="modes" id="modes">' +
        Object.keys(LIBELLES_MODE).map((m) => '<button data-mode="' + m + '">' + LIBELLES_MODE[m] + '</button>').join('') +
      '</div>' +
      '<div class="segment" id="devises"><button data-dev="USD">Dollars ($)</button><button data-dev="CDF">Francs (FC)</button></div>' +
      '<label class="champ"><span id="libMontant">Montant reçu</span><input id="montantRecu" inputmode="decimal" autocomplete="off"></label>' +
      '<div id="infoReste" class="petit" style="margin:-6px 0 10px"></div>' +
      '<label class="champ" id="blocRef"><span>Référence de la transaction (facultatif)</span><input id="reference" autocomplete="off" placeholder="Ex : code reçu par SMS"></label>' +
      '<div id="blocClient">' +
        '<label class="champ"><span>Client (obligatoire s\'il reste une dette)</span><select id="clientId"><option value="">-- Choisir --</option>' +
        clients.map((c) => '<option value="' + c.id + '">' + esc(c.nom) + '</option>').join('') +
        '<option value="new">+ Nouveau client</option></select></label>' +
        '<div id="nouveauClient" hidden><div class="deux-colonnes">' +
          '<label class="champ"><span>Nom</span><input id="ncNom" autocomplete="off"></label>' +
          '<label class="champ"><span>Téléphone</span><input id="ncTel" inputmode="tel" autocomplete="off" placeholder="08..."></label>' +
        '</div><div class="bandeau rouge" id="ncErreur" hidden></div></div>' +
      '</div>' +
      '<button class="btn" id="validerVente">Valider la vente</button>');

    const el = f.el;
    const defautMontant = () => {
      if (etat.mode === 'dette') return '0';
      return etat.devise === 'CDF' ? String(Math.round(total * taux)) : String(arrondi(total, 2));
    };
    const montantSaisi = () => {
      const brut = $('#montantRecu', el).value;
      if (String(brut).trim() === '') return etat.mode === 'dette' ? 0 : NaN;
      return lireNombre(brut);
    };
    const calculer = () => {
      const saisi = montantSaisi();
      if (isNaN(saisi) || saisi < 0) return null;
      const recuUSD = versUSD(saisi, etat.devise, taux);
      let paye = Math.min(recuUSD, total);
      let reste = total - paye;
      if (reste * taux < 0.5) { reste = 0; paye = total; } // moins d'un franc : on ignore
      const monnaieUSD = Math.max(0, recuUSD - total);
      return { saisi, recuUSD, paye: arrondi(paye, 6), reste: arrondi(reste, 6), monnaieUSD };
    };
    const maj = () => {
      $$('#modes button', el).forEach((b) => b.classList.toggle('actif', b.dataset.mode === etat.mode));
      $$('#devises button', el).forEach((b) => b.classList.toggle('actif', b.dataset.dev === etat.devise));
      $('#libMontant', el).textContent = etat.mode === 'dette' ? 'Acompte versé maintenant (0 si rien)' : 'Montant reçu';
      $('#blocRef', el).hidden = !['mpesa', 'airtel', 'orange'].includes(etat.mode);
      const c = calculer();
      const info = $('#infoReste', el);
      if (!c) { info.textContent = 'Entrez un montant valide.'; info.className = 'petit rouge-txt'; $('#blocClient', el).hidden = true; return; }
      $('#blocClient', el).hidden = !(c.reste > 0);
      if (c.reste > 0) {
        info.className = 'petit rouge-txt';
        info.textContent = 'Reste à payer (dette) : ' + formatUSD(c.reste) + ' (' + formatCDF(c.reste * taux) + ')';
      } else if (c.monnaieUSD * taux >= 0.5) {
        info.className = 'petit vert-txt';
        info.textContent = 'Monnaie à rendre : ' + (etat.devise === 'CDF' ? formatCDF(c.monnaieUSD * taux) : formatUSD(c.monnaieUSD));
      } else { info.textContent = ''; }
    };
    const reinitMontant = () => { $('#montantRecu', el).value = defautMontant(); maj(); };

    $$('#modes button', el).forEach((b) => b.addEventListener('click', () => { etat.mode = b.dataset.mode; reinitMontant(); }));
    $$('#devises button', el).forEach((b) => b.addEventListener('click', () => { etat.devise = b.dataset.dev; reinitMontant(); }));
    $('#montantRecu', el).addEventListener('input', maj);
    $('#clientId', el).addEventListener('change', (e) => { $('#nouveauClient', el).hidden = e.target.value !== 'new'; });
    reinitMontant();

    $('#validerVente', el).addEventListener('click', async () => {
      const bouton = $('#validerVente', el);
      const c = calculer();
      if (!c) { toast('Entrez un montant valide', 'erreur'); return; }
      if (etat.mode === 'dette' && c.reste <= 0) { toast('Pour une vente à crédit, l\'acompte doit être inférieur au total', 'erreur'); return; }
      let clientId = null;
      let client = null;
      if (c.reste > 0) {
        const choix = $('#clientId', el).value;
        if (!choix) { toast('Choisissez le client qui doit le reste', 'erreur'); return; }
        if (choix === 'new') {
          const nom = $('#ncNom', el).value.trim();
          if (!nom) { toast('Écrivez le nom du nouveau client', 'erreur'); return; }
          const telSaisi = $('#ncTel', el).value.trim();
          const refus = (m) => { const e = $('#ncErreur', el); e.textContent = m; e.hidden = false; toast('Client non enregistré', 'erreur'); };
          if (telSaisi && normaliserTel(telSaisi).length < 11) { refus('Numéro de téléphone trop court.'); return; }
          const doublon = VueDettes.verifierClient(nom, telSaisi, clients, null); // même nom ou même numéro : refusé
          if (doublon) { refus(doublon + ' Choisissez-le dans la liste ou changez le nom ou le numéro.'); return; }
          client = { nom, tel: telSaisi };
        } else {
          clientId = Number(choix);
          client = clients.find((x) => x.id === clientId);
        }
      }
      bouton.disabled = true;
      try {
        if (client && !clientId) { clientId = await DB.ajouter('clients', client); client.id = clientId; }
        const vente = {
          date: Date.now(),
          lignes: this.panier.map((l) => ({
            produitId: l.produitId, nom: l.nom, qte: l.qte,
            prixUnitaireUSD: arrondi(totalLigne(l) / l.qte, 6), prixAchatUSD: arrondi(l.coutUSD, 6)
          })),
          totalUSD: total,
          coutUSD: arrondi(this.panier.reduce((s, l) => s + l.qte * l.coutUSD, 0), 6),
          taux,
          mode: etat.mode,
          devisePaiement: etat.devise,
          reference: $('#reference', el).value.trim(),
          clientId,
          payeUSD: c.paye,
          resteUSD: c.reste,
          vendeur: App.nomVendeur(),
          annulee: false
        };
        const enregistree = await DB.enregistrerVente(vente);
        Audit.log('vente', { id: enregistree.id, total: arrondi(total, 2) + ' USD', mode: etat.mode, reste: arrondi(c.reste, 2) + ' USD' });
        this.panier = [];
        f.fermer();
        this.produits = await DB.tout('produits');
        this.dessinerGrille();
        this.dessinerBarrePanier();
        this.afficherRecu(enregistree, client);
      } catch (e) {
        bouton.disabled = false;
        toast(e.message || 'Erreur pendant l\'enregistrement', 'erreur');
        this.produits = await DB.tout('produits'); // le stock a peut-être changé
      }
    });
  },

  // Le reçu WhatsApp n'est proposé que pour une vente à crédit (le client garde une preuve de sa dette).
  afficherRecu(vente, client) {
    const texte = construireRecu(vente, client);
    const aCredit = vente.resteUSD > 0.005 && !!client;
    const f = ouvrirFenetre('Vente enregistrée',
      '<div class="recu">' + esc(texte.replace(/\*/g, '')) + '</div>' +
      '<div class="pile">' +
        (aCredit ? '<button class="btn" id="recuWa">Envoyer le reçu à ' + esc(client.nom) + ' sur WhatsApp</button>' : '') +
        '<button class="btn gris" id="recuOk">Nouvelle vente</button>' +
      '</div>');
    if (aCredit) $('#recuWa', f.el).addEventListener('click', () => ouvrirLien(lienWhatsApp(client.tel, texte)));
    $('#recuOk', f.el).addEventListener('click', () => f.fermer());
  }
};
