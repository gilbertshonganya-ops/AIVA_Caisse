/* EvoBuskin - écran DÉPENSES (patron) : loyer, transport, électricité, salaires...
   Le bénéfice net = ventes - coût des marchandises vendues - dépenses. */
const CATEGORIES_DEPENSES = ['Loyer', 'Électricité', 'Eau', 'Transport', 'Salaires', 'Internet et crédit téléphone', 'Taxes et patentes', 'Entretien et réparations', 'Emballages et sacs', 'Autre'];

const VueDepenses = {
  periode: Periode.nouveau('jour'),

  async afficher(conteneur) {
    const toutes = await DB.tout('depenses');
    const bornes = Periode.bornes(this.periode);
    const liste = toutes.filter((d) => Periode.dans(d.date, bornes)).sort((a, b) => b.date - a.date);
    const total = liste.reduce((s, d) => s + d.montantUSD, 0);
    const parCat = {};
    liste.forEach((d) => { parCat[d.categorie] = (parCat[d.categorie] || 0) + d.montantUSD; });
    const cats = Object.keys(parCat).sort((a, b) => parCat[b] - parCat[a]);

    conteneur.innerHTML =
      App.entete('Dépenses') +
      Periode.html(this.periode) +
      '<div class="carte"><div class="petit">Total des dépenses (' + liste.length + ')</div><div style="font-size:1.3rem">' + App.montantHtml(total) + '</div></div>' +
      '<button class="btn" id="btnDep" style="margin-bottom:12px">+ Ajouter une dépense</button>' +
      (cats.length ? '<div class="carte"><h3>Par catégorie</h3>' + cats.map((c) =>
        '<div style="margin-top:10px"><div class="ligne-flex"><span>' + esc(c) + '</span><span class="gras">' + formatUSD(parCat[c]) + '</span></div>' +
        '<div class="barre-h"><i style="width:' + Math.round(parCat[c] / parCat[cats[0]] * 100) + '%"></i></div></div>').join('') + '</div>' : '') +
      (liste.length ? '<div class="liste">' + liste.map((d) =>
        '<div class="ligne" data-id="' + d.id + '"><div><div class="nom">' + esc(d.categorie) + '</div>' +
        '<div class="sous">' + formatDate(d.date) + (d.note ? ' &middot; ' + esc(d.note) : '') + '</div></div>' +
        '<div class="droite rouge-txt gras">-' + formatUSD(d.montantUSD) + '</div></div>').join('') + '</div>'
        : '<div class="vide">Aucune dépense sur cette période.</div>');

    Periode.brancher(conteneur, this.periode, () => this.afficher(conteneur), { marques: new Set(toutes.map((x) => Periode.iso(x.date))) });
    $('#btnDep').addEventListener('click', () => this.formulaire());
    $$('.liste .ligne[data-id]', conteneur).forEach((l) => l.addEventListener('click', () => this.detail(toutes.find((d) => d.id === Number(l.dataset.id)))));
    App.brancherRetour(conteneur);
  },

  formulaire() {
    const aujourdhui = new Date(); const iso = aujourdhui.getFullYear() + '-' + String(aujourdhui.getMonth() + 1).padStart(2, '0') + '-' + String(aujourdhui.getDate()).padStart(2, '0');
    const f = ouvrirFenetre('Nouvelle dépense',
      '<label class="champ"><span>Catégorie</span><select id="dCat">' + CATEGORIES_DEPENSES.map((c) => '<option>' + esc(c) + '</option>').join('') + '</select></label>' +
      '<div class="segment" id="devises"><button data-dev="USD" class="actif">Dollars ($)</button><button data-dev="CDF">Francs (FC)</button></div>' +
      '<label class="champ"><span>Montant</span><input id="dMontant" inputmode="decimal" autocomplete="off"></label>' +
      '<label class="champ"><span>Date</span><input id="dDate" type="date" value="' + iso + '" max="' + iso + '"></label>' +
      '<label class="champ"><span>Note (facultatif)</span><input id="dNote" autocomplete="off" placeholder="Ex : loyer d\'octobre"></label>' +
      '<button class="btn" id="dOk">Enregistrer</button>');
    let devise = 'USD';
    $$('#devises button', f.el).forEach((b) => b.addEventListener('click', () => {
      devise = b.dataset.dev; $$('#devises button', f.el).forEach((x) => x.classList.toggle('actif', x === b));
    }));
    $('#dOk', f.el).addEventListener('click', async () => {
      const v = lireNombre($('#dMontant', f.el).value);
      if (isNaN(v) || v <= 0) { toast('Entrez un montant supérieur à 0', 'erreur'); return; }
      const d = $('#dDate', f.el).value;
      if (!d) { toast('Choisissez la date', 'erreur'); return; }
      const [a, m, j] = d.split('-').map(Number);
      let date = new Date(a, m - 1, j, 12, 0, 0).getTime();
      if (debutJour(date) === debutJour()) date = Date.now();
      if (date > Date.now()) { toast('La date ne peut pas être dans le futur', 'erreur'); return; }
      const dep = {
        date, categorie: $('#dCat', f.el).value, devise, montant: v,
        montantUSD: arrondi(versUSD(v, devise, App.taux()), 6), taux: App.taux(),
        note: $('#dNote', f.el).value.trim(), vendeur: App.nomVendeur()
      };
      const id = await DB.ajouter('depenses', dep);
      Audit.noter('Dépense ajoutée', 'n°' + id + ' ' + dep.categorie + ' ' + formatUSD(dep.montantUSD));
      f.fermer(); toast('Dépense enregistrée', 'ok'); this.afficher($('#vue'));
    });
  },

  detail(d) {
    if (!d) return;
    const f = ouvrirFenetre(d.categorie,
      '<div class="liste"><div class="ligne" style="cursor:default"><span>Montant</span><span class="gras">' + formatUSD(d.montantUSD) + ' (' + formatCDF(d.montantUSD * (d.taux || App.taux())) + ')</span></div>' +
      '<div class="ligne" style="cursor:default"><span>Date</span><span>' + formatDate(d.date) + '</span></div>' +
      '<div class="ligne" style="cursor:default"><span>Note</span><span>' + esc(d.note || '-') + '</span></div></div>' +
      '<button class="btn rouge" id="dSuppr">Supprimer cette dépense</button>');
    $('#dSuppr', f.el).addEventListener('click', async () => {
      if (!(await confirmer('Supprimer la dépense', 'Supprimer cette dépense de ' + formatUSD(d.montantUSD) + ' ?', 'Supprimer', true))) return;
      await DB.supprimer('depenses', d.id);
      Audit.noter('Dépense supprimée', 'n°' + d.id + ' ' + d.categorie + ' ' + formatUSD(d.montantUSD));
      f.fermer(); toast('Dépense supprimée'); this.afficher($('#vue'));
    });
  }
};
