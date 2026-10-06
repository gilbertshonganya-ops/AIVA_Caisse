/* EvoBuskin - onglet PLUS (patron) : accès aux outils avancés + journal d'audit */
const VuePlus = {
  async afficher(conteneur) {
    const entrees = [
      ['depenses', '\u{1F4B8}', 'Dépenses', 'Loyer, transport, électricité, salaires'],
      ['achats', '\u{1F69A}', 'Achats et fournisseurs', 'Entrées de stock, dettes envers les fournisseurs'],
      ['import', '\u{1F4E5}', 'Importer des produits', 'Depuis un fichier Excel ou CSV'],
      ['audit', '\u{1F50E}', 'Journal d\'audit', 'Qui a fait quoi, et quand'],
      ['reglages', '\u2699\uFE0F', 'Réglages', 'Boutique, taux, PIN, sauvegarde']
    ];
    conteneur.innerHTML =
      (await App.bandeaux()) +
      '<h2>Plus</h2><div class="liste">' + entrees.map((e) =>
        '<div class="ligne" data-aller="' + e[0] + '"><div style="display:flex;gap:12px;align-items:center"><span style="font-size:1.5rem">' + e[1] + '</span><div><div class="nom">' + e[2] + '</div><div class="sous">' + e[3] + '</div></div></div><span>&rsaquo;</span></div>').join('') + '</div>';
    $$('[data-aller]', conteneur).forEach((l) => l.addEventListener('click', () => App.aller(l.dataset.aller)));
  }
};
