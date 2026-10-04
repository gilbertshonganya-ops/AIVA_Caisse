/* AIVA Caisse - IMPORT de produits depuis un fichier Excel (.xlsx) ou CSV (patron)
   Le fichier .xlsx est lu directement dans le téléphone (aucune bibliothèque, aucun envoi sur Internet).
   Les anciens fichiers .xls (Excel 97-2003) ne sont pas lus : les enregistrer en .xlsx ou en CSV. */

// Lit un fichier .xlsx (une archive ZIP de fichiers XML) et retourne les lignes de la première feuille.
async function lireXlsx(tampon) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Ce navigateur ne sait pas ouvrir les fichiers .xlsx. Enregistrez le fichier en CSV.');
  const u8 = new Uint8Array(tampon), dv = new DataView(tampon), dec = new TextDecoder();
  // 1) annuaire du ZIP (fin du fichier)
  let fin = u8.length - 22;
  while (fin >= 0 && dv.getUint32(fin, true) !== 0x06054b50) fin--;
  if (fin < 0) throw new Error('Fichier .xlsx illisible (ce n\'est pas un vrai fichier Excel).');
  const nb = dv.getUint16(fin + 10, true);
  let pos = dv.getUint32(fin + 16, true);
  const entrees = {};
  for (let i = 0; i < nb && dv.getUint32(pos, true) === 0x02014b50; i++) {
    const ln = dv.getUint16(pos + 28, true), le = dv.getUint16(pos + 30, true), lc = dv.getUint16(pos + 32, true);
    entrees[dec.decode(u8.subarray(pos + 46, pos + 46 + ln))] = { methode: dv.getUint16(pos + 10, true), taille: dv.getUint32(pos + 20, true), local: dv.getUint32(pos + 42, true) };
    pos += 46 + ln + le + lc;
  }
  // 2) lecture (et décompression) d'un fichier de l'archive
  const lire = async (nom) => {
    const e = entrees[nom];
    if (!e) return null;
    const debut = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
    const brut = u8.subarray(debut, debut + e.taille);
    if (e.methode === 0) return dec.decode(brut);
    if (e.methode !== 8) throw new Error('Compression .xlsx non prise en charge. Enregistrez le fichier en CSV.');
    const flux = new Blob([brut]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return dec.decode(await new Response(flux).arrayBuffer());
  };
  const xml = (t) => new DOMParser().parseFromString(t, 'text/xml');
  // 3) textes partagés
  const partages = [];
  const tPartages = await lire('xl/sharedStrings.xml');
  if (tPartages) xml(tPartages).querySelectorAll('si').forEach((si) => {
    partages.push(Array.from(si.querySelectorAll('t')).filter((t) => !t.closest('rPh')).map((t) => t.textContent).join(''));
  });
  // 4) première feuille
  const feuilles = Object.keys(entrees).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10));
  if (!feuilles.length) throw new Error('Aucune feuille trouvée dans ce fichier Excel.');
  const doc = xml(await lire(feuilles[0]));
  const numCol = (ref) => ref.replace(/\d/g, '').split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const lignes = [];
  doc.querySelectorAll('row').forEach((row) => {
    const ligne = [];
    row.querySelectorAll('c').forEach((c, k) => {
      const ref = c.getAttribute('r');
      const i = ref ? numCol(ref) : k;
      const v = c.querySelector('v');
      let texte = '';
      const type = c.getAttribute('t');
      if (type === 's') texte = partages[Number(v && v.textContent)] || '';
      else if (type === 'inlineStr') texte = Array.from(c.querySelectorAll('t')).map((t) => t.textContent).join('');
      else if (v) {
        texte = v.textContent;
        if (!type && /^-?\d+(\.\d+)?(E[+-]?\d+)?$/i.test(texte)) texte = String(Number(Number(texte).toPrecision(12))); // 1.6000000000000001 -> 1.6
      }
      while (ligne.length < i) ligne.push('');
      ligne[i] = texte;
    });
    if (ligne.some((x) => String(x).trim() !== '')) lignes.push(ligne);
  });
  return lignes;
}

// Lit un texte CSV (séparateur ; , ou tabulation, guillemets gérés). Retourne un tableau de lignes.
function parserCsv(texte) {
  texte = String(texte).replace(/^\uFEFF/, '');
  const premiere = texte.split(/\r?\n/)[0] || '';
  const compter = (c) => premiere.split(c).length - 1;
  const delim = [';', ',', '\t'].sort((a, b) => compter(b) - compter(a))[0];
  const lignes = [];
  let ligne = [], cellule = '', entre = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (entre) {
      if (c === '"' && texte[i + 1] === '"') { cellule += '"'; i++; }
      else if (c === '"') entre = false;
      else cellule += c;
    } else if (c === '"') entre = true;
    else if (c === delim) { ligne.push(cellule); cellule = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i++;
      ligne.push(cellule); cellule = '';
      if (ligne.some((x) => x.trim() !== '')) lignes.push(ligne);
      ligne = [];
    } else cellule += c;
  }
  ligne.push(cellule);
  if (ligne.some((x) => x.trim() !== '')) lignes.push(ligne);
  return lignes;
}

const VueImport = {
  SYNONYMES: {
    nom: ['nom', 'produit', 'designation', 'article', 'libelle'],
    categorie: ['categorie', 'famille', 'rayon'],
    codeBarres: ['codebarres', 'codebarre', 'code', 'ean', 'barcode', 'codeabarres'],
    devise: ['devise', 'monnaie'],
    prixAchat: ['prixachat', 'prixdachat', 'achat', 'pa', 'cout', 'coutachat'],
    prixVente: ['prixvente', 'vente', 'pv', 'prix', 'prixunitaire'],
    stock: ['stock', 'quantite', 'qte', 'qty'],
    seuil: ['seuil', 'seuilalerte', 'alerte'],
    prixGros: ['prixgros', 'gros'],
    seuilGros: ['seuilgros', 'grosapartirde', 'qtegros', 'quantitegros'],
    cartonQte: ['cartonqte', 'quantiteparcarton', 'parcarton', 'carton', 'conditionnement']
  },
  analyse: null,

  normaliser(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); },

  async afficher(conteneur) {
    this.analyse = null;
    conteneur.innerHTML =
      App.entete('Importer des produits') +
      '<div class="carte"><p><b>Comment faire ?</b></p><ol style="margin:0 0 0 18px;padding:0">' +
        '<li>Préparez votre liste dans Excel (fichier <b>.xlsx</b>) ou enregistrez-la en <b>CSV</b>.</li><li>Gardez une ligne de titres : <b>nom</b> et <b>prix_vente</b> sont obligatoires.</li>' +
        '<li>Choisissez le fichier ci-dessous et vérifiez l\'aperçu avant d\'importer.</li></ol></div>' +
      '<div class="pile">' +
        '<button class="btn gris" id="iModele">Télécharger un modèle de fichier</button>' +
        '<label class="champ" style="margin:0"><span>Devise des prix si le fichier n\'a pas de colonne « devise »</span><select id="iDevise"><option value="USD">Dollars ($)</option><option value="CDF">Francs congolais (FC)</option></select></label>' +
        '<button class="btn" id="iChoisir">Choisir mon fichier Excel ou CSV</button>' +
        '<input type="file" id="iFichier" accept=".xlsx,.csv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>' +
      '</div><div id="iApercu" style="margin-top:14px"></div>';
    $('#iModele').addEventListener('click', () => this.modele());
    $('#iChoisir').addEventListener('click', () => $('#iFichier').click());
    $('#iFichier').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; this.lire(f); });
    App.brancherRetour(conteneur);
  },

  async modele() {
    const lignes = [
      ['nom', 'categorie', 'code_barres', 'devise', 'prix_achat', 'prix_vente', 'stock', 'seuil_alerte', 'prix_gros', 'gros_a_partir_de', 'quantite_par_carton'],
      ['Sucre 1 kg', 'Alimentation', '6001234567890', 'USD', '1,20', '1,60', '40', '10', '1,40', '10', '10'],
      ['Eau minérale 1,5 L', 'Boissons', '', 'CDF', '1800', '2500', '80', '20', '2000', '12', '12'],
      ['Stylo bille', 'Papeterie', '', 'CDF', '300', '500', '120', '30', '', '', '']
    ];
    await enregistrerFichier('modele-import-produits.csv', VueReglages.csv(lignes), 'text/csv');
  },

  // Excel en français enregistre souvent en Windows-1252 : on essaie UTF-8 puis on bascule
  async lireTexte(fichier) {
    const octets = await fichier.arrayBuffer();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(octets); }
    catch (e) { return new TextDecoder('windows-1252').decode(octets); }
  },

  async lire(fichier) {
    if (!fichier) return;
    const zone = $('#iApercu');
    if (/\.xls$/i.test(fichier.name)) { zone.innerHTML = '<div class="bandeau rouge">Ce fichier est un ancien format Excel (.xls). Dans Excel, faites « Enregistrer sous » puis choisissez <b>Classeur Excel (.xlsx)</b> ou <b>CSV</b>.</div>'; return; }
    try {
      const lignes = /\.xlsx$/i.test(fichier.name) ? await lireXlsx(await fichier.arrayBuffer()) : parserCsv(await this.lireTexte(fichier));
      if (lignes.length < 2) throw new Error('Le fichier est vide ou n\'a qu\'une ligne de titres');
      const existants = await DB.tout('produits');
      this.analyse = this.analyser(lignes, existants, $('#iDevise').value);
      this.afficherApercu();
    } catch (e) { zone.innerHTML = '<div class="bandeau rouge">' + esc(e.message) + '</div>'; }
  },

  analyser(lignes, existants, deviseDefaut) {
    const entetes = lignes[0].map((h) => this.normaliser(h));
    const col = {};
    Object.keys(this.SYNONYMES).forEach((cle) => {
      const i = entetes.findIndex((h) => this.SYNONYMES[cle].includes(h));
      if (i >= 0) col[cle] = i;
    });
    if (col.nom === undefined) throw new Error('Colonne « nom » introuvable. Vérifiez la première ligne du fichier.');
    if (col.prixVente === undefined) throw new Error('Colonne « prix_vente » introuvable. Vérifiez la première ligne du fichier.');

    const parNom = new Map(existants.map((p) => [p.nom.trim().toLowerCase(), p]));
    const parCode = new Map(existants.filter((p) => p.codeBarres).map((p) => [p.codeBarres, p]));
    const vusNoms = new Set(), vusCodes = new Set();
    const nouveaux = [], misesAJour = [], erreurs = [];
    const val = (l, cle) => (col[cle] === undefined ? '' : String(l[col[cle]] == null ? '' : l[col[cle]]).trim());
    const nombre = (l, cle, defaut) => { const v = val(l, cle); return v === '' ? defaut : lireNombre(v); };

    lignes.slice(1).forEach((l, k) => {
      const n = k + 2; // numéro de ligne dans le fichier
      const nom = val(l, 'nom');
      if (!nom) { erreurs.push('Ligne ' + n + ' : nom vide'); return; }
      const prixVente = nombre(l, 'prixVente', NaN), prixAchat = nombre(l, 'prixAchat', 0);
      const stock = nombre(l, 'stock', 0), seuil = nombre(l, 'seuil', 5);
      const prixGros = nombre(l, 'prixGros', 0), seuilGros = nombre(l, 'seuilGros', 0), cartonQte = nombre(l, 'cartonQte', 0);
      if ([prixVente, prixAchat, stock, seuil, prixGros, seuilGros, cartonQte].some((x) => isNaN(x) || x < 0)) { erreurs.push('Ligne ' + n + ' (' + nom + ') : un nombre est invalide ou négatif'); return; }
      if (prixGros > 0 && !(seuilGros > 0)) { erreurs.push('Ligne ' + n + ' (' + nom + ') : prix de gros sans « gros_a_partir_de »'); return; }
      const dv = this.normaliser(val(l, 'devise'));
      const devise = ['cdf', 'fc', 'franc', 'francs', 'francscongolais'].includes(dv) ? 'CDF' : (['usd', 'dollar', 'dollars', 'us'].includes(dv) ? 'USD' : deviseDefaut);
      const code = val(l, 'codeBarres');
      const cle = nom.toLowerCase();
      if ((code && vusCodes.has(code)) || vusNoms.has(cle)) { erreurs.push('Ligne ' + n + ' (' + nom + ') : doublon dans le fichier, ignoré'); return; }
      vusNoms.add(cle); if (code) vusCodes.add(code);
      const champs = { nom, categorie: val(l, 'categorie'), codeBarres: code, devise, prixAchat, prixVente, seuil, prixGros, seuilGros, cartonQte };
      const existant = (code && parCode.get(code)) || parNom.get(cle);
      if (existant) misesAJour.push(Object.assign({}, existant, champs, { stock: existant.stock })); // le stock existant n'est pas touché
      else nouveaux.push(Object.assign(champs, { stock: arrondi(stock, 3) }));
    });
    return { nouveaux, misesAJour, erreurs };
  },

  afficherApercu() {
    const { nouveaux, misesAJour, erreurs } = this.analyse;
    const zone = $('#iApercu');
    const rien = !nouveaux.length && !misesAJour.length;
    zone.innerHTML =
      '<div class="carte"><h3>Aperçu</h3>' +
      '<div class="ligne-flex" style="margin-top:8px"><span>Nouveaux produits</span><b class="vert-txt">' + nouveaux.length + '</b></div>' +
      '<div class="ligne-flex"><span>Produits mis à jour (prix, catégorie...)</span><b>' + misesAJour.length + '</b></div>' +
      '<div class="ligne-flex"><span>Lignes ignorées</span><b class="' + (erreurs.length ? 'rouge-txt' : '') + '">' + erreurs.length + '</b></div>' +
      '<p class="petit" style="margin-top:8px">Le stock des produits déjà existants n\'est pas modifié.</p></div>' +
      (nouveaux.length ? '<div class="liste">' + nouveaux.slice(0, 5).map((p) =>
        '<div class="ligne" style="cursor:default"><div><div class="nom">' + esc(p.nom) + '</div><div class="sous">' + esc(p.categorie || 'Sans catégorie') + ' &middot; stock ' + formatQuantite(p.stock) + '</div></div><div class="droite gras">' + prixProduit(p) + '</div></div>').join('') +
        (nouveaux.length > 5 ? '<div class="ligne petit" style="cursor:default">... et ' + (nouveaux.length - 5) + ' autres</div>' : '') + '</div>' : '') +
      (erreurs.length ? '<div class="bandeau rouge"><b>À corriger dans le fichier :</b><br>' + erreurs.slice(0, 6).map(esc).join('<br>') + (erreurs.length > 6 ? '<br>... et ' + (erreurs.length - 6) + ' autres' : '') + '</div>' : '') +
      '<button class="btn" id="iGo"' + (rien ? ' disabled' : '') + '>Importer ' + (nouveaux.length + misesAJour.length) + ' produit(s)</button>';
    const go = $('#iGo');
    if (!rien) go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        await DB.importerProduits(nouveaux, misesAJour, App.nomVendeur());
        Audit.noter('Import CSV', nouveaux.length + ' nouveaux, ' + misesAJour.length + ' mis à jour, ' + erreurs.length + ' ignorés');
        toast('Import terminé : ' + nouveaux.length + ' nouveaux, ' + misesAJour.length + ' mis à jour', 'ok');
        App.aller('stock');
      } catch (e) { go.disabled = false; toast(e.message || 'Import impossible', 'erreur'); }
    });
  }
};
