/* AIVA Caisse - écran RÉGLAGES (patron) : boutique, taux, PIN, sauvegarde, démo */
const VueReglages = {
  async afficher(conteneur) {
    const r = App.reglages;
    conteneur.innerHTML =
      '<div class="carte"><h3>Ma boutique</h3><div style="height:8px"></div>' +
        '<label class="champ"><span>Nom de la boutique (sur les reçus)</span><input id="rNom" autocomplete="off" value="' + esc(r.nomBoutique) + '"></label>' +
        '<label class="champ"><span>Téléphone de la boutique</span><input id="rTel" inputmode="tel" autocomplete="off" value="' + esc(r.telBoutique) + '"></label>' +
        '<button class="btn" id="rSaveBoutique">Enregistrer</button></div>' +

      '<div class="carte"><h3>Taux de change</h3><div style="height:8px"></div>' +
        '<label class="champ"><span>1 dollar ($) = combien de francs (FC) ?</span><input id="rTaux" inputmode="decimal" autocomplete="off" value="' + esc(r.taux) + '"></label>' +
        '<label class="champ"><span>Devise affichée en grand</span><select id="rAff"><option value="USD">Dollars ($)</option><option value="CDF">Francs (FC)</option></select></label>' +
        '<p class="petit">Les anciennes ventes gardent le taux du jour où elles ont été faites. Pensez à mettre à jour le taux chaque matin.</p>' +
        '<button class="btn" id="rSaveTaux">Enregistrer</button></div>' +

      '<div class="carte"><h3>Codes PIN</h3><div style="height:8px"></div>' +
        '<label class="champ"><span>Nouveau PIN du patron (4 chiffres)</span><input id="rPinP" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></label>' +
        '<label class="champ"><span>Nouveau PIN du vendeur (4 chiffres)</span><input id="rPinV" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></label>' +
        '<p class="petit">Laissez vide ce que vous ne voulez pas changer. Le PIN protège contre un regard curieux : gardez aussi le téléphone en lieu sûr.</p>' +
        '<button class="btn" id="rSavePin">Changer les PIN</button></div>' +

      '<div class="carte"><h3>Sauvegarde</h3><div style="height:8px"></div>' +
        '<p class="petit">' + (r.derniereSauvegarde ? 'Dernière sauvegarde : ' + formatDateHeure(r.derniereSauvegarde) : 'Aucune sauvegarde faite.') + '</p>' +
        '<div class="pile">' +
          '<button class="btn" id="rExport">Sauvegarder toutes mes données</button>' +
          '<button class="btn contour" id="rImport">Restaurer une sauvegarde</button>' +
          '<input type="file" id="fichierImport" accept="application/json,.json" hidden>' +
          '<button class="btn gris" id="rCsvVentes">Exporter les ventes (Excel/CSV)</button>' +
          '<button class="btn gris" id="rCsvStock">Exporter le stock (Excel/CSV)</button>' +
        '</div></div>' +

      '<div class="carte"><h3>Données</h3><div style="height:8px"></div><div class="pile">' +
        '<button class="btn contour" id="rDemo">Charger les données de démonstration</button>' +
        '<button class="btn rouge" id="rEffacer">Tout effacer</button></div></div>' +

      '<div class="carte"><h3>Application</h3><div style="height:8px"></div><div class="pile">' +
        '<button class="btn gris" id="rInstall">Installer sur l\'écran d\'accueil</button>' +
        '<p class="petit texte-centre">AIVA Caisse version 1.0.0 &middot; fonctionne hors connexion</p></div></div>';

    $('#rAff').value = r.affichage;

    $('#rSaveBoutique').addEventListener('click', async () => {
      const nom = $('#rNom').value.trim();
      if (!nom) { toast('Le nom de la boutique est obligatoire', 'erreur'); return; }
      await App.sauverReglage('nomBoutique', nom);
      await App.sauverReglage('telBoutique', $('#rTel').value.trim());
      toast('Boutique enregistrée', 'ok');
    });

    $('#rSaveTaux').addEventListener('click', async () => {
      const t = lireNombre($('#rTaux').value);
      if (isNaN(t) || t < 1 || t > 100000) { toast('Taux invalide (exemple : 2800)', 'erreur'); return; }
      await App.sauverReglage('taux', t);
      await App.sauverReglage('affichage', $('#rAff').value);
      toast('Taux enregistré : 1 $ = ' + formatCDF(t), 'ok');
      VueCaisse.panier = []; // les prix du panier dépendent du taux : on repart propre
    });

    $('#rSavePin').addEventListener('click', async () => {
      const p = $('#rPinP').value.trim(), v = $('#rPinV').value.trim();
      if (!p && !v) { toast('Rien à changer', 'erreur'); return; }
      if ((p && !/^\d{4}$/.test(p)) || (v && !/^\d{4}$/.test(v))) { toast('Un PIN doit avoir exactement 4 chiffres', 'erreur'); return; }
      const hp = p ? hacher(p) : r.pinPatron, hv = v ? hacher(v) : r.pinVendeur;
      if (hp === hv) { toast('Le PIN du patron et du vendeur doivent être différents', 'erreur'); return; }
      if (p) { await App.sauverReglage('pinPatron', hp); await App.sauverReglage('pinChange', true); }
      if (v) await App.sauverReglage('pinVendeur', hv);
      toast('PIN modifié(s)', 'ok'); App.rafraichir();
    });

    $('#rExport').addEventListener('click', async () => {
      const sauvegarde = await DB.exporterTout();
      await enregistrerFichier('aiva-caisse-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(sauvegarde), 'application/json');
      await App.sauverReglage('derniereSauvegarde', Date.now());
      toast('Sauvegarde créée. Gardez le fichier en lieu sûr.', 'ok'); App.rafraichir();
    });
    $('#rImport').addEventListener('click', () => $('#fichierImport').click());
    $('#fichierImport').addEventListener('change', (e) => this.restaurer(e.target.files[0]));
    $('#rCsvVentes').addEventListener('click', () => this.exporterCsvVentes());
    $('#rCsvStock').addEventListener('click', () => this.exporterCsvStock());
    $('#rDemo').addEventListener('click', () => this.chargerDemo());
    $('#rEffacer').addEventListener('click', () => this.toutEffacer());
    $('#rInstall').addEventListener('click', async () => {
      if (App.invitationInstall) { App.invitationInstall.prompt(); App.invitationInstall = null; }
      else toast('Dans Chrome : menu ⋮ puis « Ajouter à l\'écran d\'accueil »');
    });
  },

  async restaurer(fichier) {
    if (!fichier) return;
    try {
      const sauvegarde = JSON.parse(await fichier.text());
      if (!sauvegarde || sauvegarde.application !== 'AIVA Caisse') throw new Error('Ce fichier n\'est pas une sauvegarde AIVA Caisse');
      const n = (sauvegarde.donnees.produits || []).length;
      if (!(await confirmer('Restaurer la sauvegarde', 'Cela REMPLACE toutes les données actuelles par celles du fichier (' + n + ' produits). Continuer ?', 'Restaurer', true))) return;
      await DB.importerTout(sauvegarde);
      await App.chargerReglages();
      VueCaisse.panier = [];
      toast('Sauvegarde restaurée', 'ok');
      App.verrouiller(); // les PIN ont peut-être changé : on redemande le code
    } catch (e) {
      toast(e instanceof SyntaxError ? 'Fichier illisible' : e.message, 'erreur');
    }
  },

  async chargerDemo() {
    if (!(await confirmer('Données de démonstration', 'Cela remplace vos produits, ventes et clients actuels par un exemple de boutique. Vos PIN et réglages sont gardés. Continuer ?', 'Charger la démo'))) return;
    const params = await DB.tout('params');
    const demo = Demo.generer(App.taux(), params);
    await DB.importerTout(demo);
    VueCaisse.panier = [];
    toast('Démonstration chargée', 'ok');
    App.aller('caisse');
  },

  async toutEffacer() {
    if (!(await confirmer('Tout effacer', 'Produits, ventes, clients et dettes seront supprimés pour toujours. Avez-vous fait une sauvegarde ?', 'Tout effacer', true))) return;
    if (!(await confirmer('Dernière question', 'Cette action est irréversible. Effacer vraiment ?', 'Oui, effacer', true))) return;
    const params = await DB.tout('params');
    await DB.toutEffacer();
    await DB.importerTout({ application: 'AIVA Caisse', donnees: { params } }); // on garde les réglages et les PIN
    VueCaisse.panier = [];
    toast('Toutes les données ont été effacées');
    App.aller('caisse');
  },

  // CSV avec « ; » et BOM : s'ouvre correctement dans Excel en français
  csv(lignes) {
    const cellule = (x) => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"';
    return '\uFEFF' + lignes.map((l) => l.map(cellule).join(';')).join('\r\n');
  },
  async exporterCsvVentes() {
    const ventes = (await DB.tout('ventes')).sort((a, b) => a.date - b.date);
    const lignes = [['N°', 'Date', 'Heure', 'Articles', 'Total USD', 'Total FC', 'Bénéfice USD', 'Mode', 'Référence', 'Payé USD', 'Reste USD', 'Vendeur', 'Annulée']];
    ventes.forEach((v) => lignes.push([
      v.id, formatDate(v.date), formatHeure(v.date), v.lignes.map((l) => formatQuantite(l.qte) + ' x ' + l.nom).join(' | '),
      arrondi(v.totalUSD, 2), Math.round(v.totalUSD * v.taux), arrondi(v.totalUSD - (v.coutUSD || 0), 2),
      LIBELLES_MODE[v.mode] || v.mode, v.reference || '', arrondi(v.payeUSD, 2), arrondi(v.resteUSD || 0, 2), v.vendeur || '', v.annulee ? 'oui' : 'non'
    ]));
    await enregistrerFichier('aiva-caisse-ventes.csv', this.csv(lignes), 'text/csv');
  },
  async exporterCsvStock() {
    const produits = (await DB.tout('produits')).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    const lignes = [['Produit', 'Catégorie', 'Code-barres', 'Devise', 'Prix achat', 'Prix vente', 'Stock', 'Seuil alerte']];
    produits.forEach((p) => lignes.push([p.nom, p.categorie, p.codeBarres, p.devise, p.prixAchat, p.prixVente, p.stock, p.seuil]));
    await enregistrerFichier('aiva-caisse-stock.csv', this.csv(lignes), 'text/csv');
  }
};
