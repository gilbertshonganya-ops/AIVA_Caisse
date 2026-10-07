/* EvoBuskin - choix d'une période : "Aujourd'hui" ou "Autre date" (calendrier : une date, ou de telle date à telle date).
   Utilisé par les écrans Rapports et Dépenses. */
const Periode = (() => {
  // Deux onglets seulement : "Aujourd'hui" et "Autre date" (qui ouvre le calendrier : une date, ou une période).
  // Les autres types (hier, semaine, mois, année, tout) restent gérés par bornes() mais ne sont plus proposés.
  const PRESETS = [['jour', 'Aujourd\'hui'], ['perso', 'Autre date']];

  const jourSuivant = (t, n = 1) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
  const iso = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const lireIso = (s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return null;
    const [a, m, j] = s.split('-').map(Number);
    const d = new Date(a, m - 1, j, 0, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d.getTime();
  };
  const nouveau = (type = 'mois') => ({ type, du: '', au: '' });

  // Retourne { debut, fin } en millisecondes ; "fin" est exclue (premier instant APRÈS la période).
  function bornes(p) {
    const auj = debutJour();
    switch (p.type) {
      case 'jour': return { debut: auj, fin: jourSuivant(auj) };
      case 'hier': return { debut: jourSuivant(auj, -1), fin: auj };
      case 'semaine': { const d = debutSemaine(); return { debut: d, fin: jourSuivant(d, 7) }; }
      case 'mois': { const d = debutMois(); const f = new Date(d); f.setMonth(f.getMonth() + 1); return { debut: d, fin: f.getTime() }; }
      case 'moisPrec': { const f = debutMois(); const d = new Date(f); d.setMonth(d.getMonth() - 1); return { debut: d.getTime(), fin: f }; }
      case 'annee': { const d = new Date(auj); d.setMonth(0, 1); const f = new Date(d); f.setFullYear(f.getFullYear() + 1); return { debut: d.getTime(), fin: f.getTime() }; }
      case 'tout': return { debut: 0, fin: Infinity };
      default: { // dates libres : "Du" et "Au" sont facultatifs
        let d = lireIso(p.du), a = lireIso(p.au), inverse = false;
        if (d !== null && a !== null && d > a) { const t = d; d = a; a = t; inverse = true; }
        return { debut: d === null ? 0 : d, fin: a === null ? Infinity : jourSuivant(a), inverse };
      }
    }
  }
  const dans = (t, b) => t >= b.debut && t < b.fin;

  function libelle(p) {
    const b = bornes(p);
    const dernier = b.fin === Infinity ? null : jourSuivant(b.fin, -1);
    switch (p.type) {
      case 'jour': return 'Aujourd\'hui, ' + formatDate(b.debut);
      case 'hier': return 'Hier, ' + formatDate(b.debut);
      case 'semaine': return 'Semaine du ' + formatDate(b.debut) + ' au ' + formatDate(dernier);
      case 'mois': case 'moisPrec': return 'Mois de ' + new Date(b.debut).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
      case 'annee': return 'Année ' + new Date(b.debut).getFullYear();
      case 'tout': return 'Toutes les dates';
      default: {
        const aDebut = b.debut > 0, aFin = dernier !== null;
        if (aDebut && aFin) return debutJour(b.debut) === debutJour(dernier) ? 'Le ' + formatDate(b.debut) : 'Du ' + formatDate(b.debut) + ' au ' + formatDate(dernier);
        if (aDebut) return 'Depuis le ' + formatDate(b.debut);
        if (aFin) return 'Jusqu\'au ' + formatDate(dernier);
        return 'Toutes les dates';
      }
    }
  }

  // Petit texte pour les noms de fichiers : "du-2026-09-01-au-2026-09-30"
  function slug(p) {
    if (p.type !== 'perso') return p.type;
    const b = bornes(p);
    return 'du-' + (b.debut > 0 ? iso(b.debut) : 'debut') + '-au-' + (b.fin === Infinity ? 'fin' : iso(jourSuivant(b.fin, -1)));
  }

  function html(p) {
    const b = bornes(p);
    return '<div class="categories" id="chipsPeriode">' + PRESETS.map((x) =>
      '<button data-p="' + x[0] + '" class="' + (p.type === x[0] ? 'actif' : '') + '">' + x[1] + '</button>').join('') + '</div>' +
      '<div class="petit" id="libPeriode" style="margin:0 2px 12px"><b>' + esc(libelle(p)) + '</b>' + (b.inverse ? ' (dates remises dans l\'ordre)' : '') + '</div>';
  }

  // ---------- Calendrier tactile ----------
  // 1er appui = une date (affiche cette seule journée) ; 2e appui = fin de la période (la plage se colore) ;
  // un 3e appui recommence. "marques" : ensemble de dates (AAAA-MM-JJ) qui ont de l'activité (petit point).
  function ouvrirCalendrier(p, marques, apresChoix) {
    const auj = debutJour();
    marques = marques || new Set();
    let debut = null, fin = null, etape = 0, vue = 'jours';
    if (p.type !== 'tout') { // on part de la période actuellement affichée
      const b = bornes(p);
      if (b.debut > 0) {
        debut = b.debut;
        fin = b.fin === Infinity ? auj : Math.min(jourSuivant(b.fin, -1), auj);
        if (fin < debut) fin = debut;
        etape = 2;
      }
    }
    let mois = new Date(debut !== null ? debut : auj); mois.setDate(1); mois.setHours(0, 0, 0, 0);
    const fenetre = ouvrirFenetre('Choisir les dates', '<div id="calCorps"></div>');
    const el = $('#calCorps', fenetre.el);
    const longue = (t) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    const courte = (t) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    const moisActuel = new Date(auj); moisActuel.setDate(1);

    function resume() {
      if (debut === null) return { texte: 'Touchez une date, puis une deuxième pour choisir une période.', bouton: 'Voir', actif: false };
      if (fin === null || fin === debut) {
        return { texte: '<b>' + esc(longue(debut)) + '</b>' + (etape === 1 ? '<br><span class="petit">Touchez une 2e date pour une période, ou affichez cette seule journée.</span>' : ''), bouton: 'Voir cette journée', actif: true };
      }
      const nb = Math.round((fin - debut) / 86400000) + 1;
      return { texte: '<b>Du ' + esc(courte(debut)) + ' au ' + esc(longue(fin)) + '</b><br><span class="petit">' + nb + ' jours</span>', bouton: 'Voir la période', actif: true };
    }

    function dessiner() {
      let corps;
      if (vue === 'mois') { // choix rapide du mois et de l'année
        const an = mois.getFullYear();
        corps = '<div class="cal-tete"><button class="cal-nav" data-an="-1" aria-label="Année précédente">&lsaquo;</button><div class="cal-titre">' + an + '</div>' +
          '<button class="cal-nav" data-an="1" aria-label="Année suivante"' + (an >= moisActuel.getFullYear() ? ' disabled' : '') + '>&rsaquo;</button></div>' +
          '<div class="cal-mois-grille">' + Array.from({ length: 12 }, (_, m) => {
            const futur = new Date(an, m, 1) > moisActuel;
            const nom = new Date(an, m, 1).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
            return '<button data-m="' + m + '" class="' + (m === mois.getMonth() ? 'actif' : '') + '"' + (futur ? ' disabled' : '') + '>' + nom + '</button>';
          }).join('') + '</div>';
      } else {
        const an = mois.getFullYear(), m = mois.getMonth();
        const decal = (new Date(an, m, 1).getDay() + 6) % 7; // la semaine commence le lundi
        const nbJours = new Date(an, m + 1, 0).getDate();
        let cases = '';
        for (let i = 0; i < decal; i++) cases += '<span class="cal-vide"></span>';
        for (let j = 1; j <= nbJours; j++) {
          const t = new Date(an, m, j).getTime();
          let cl = 'cal-j';
          if (t === auj) cl += ' auj';
          if (t > auj) cl += ' futur';
          if (debut !== null) {
            if (fin === null || fin === debut) { if (t === debut) cl += ' seul'; }
            else if (t === debut) cl += ' deb plage';
            else if (t === fin) cl += ' fin plage';
            else if (t > debut && t < fin) cl += ' mil';
          }
          cases += '<button class="' + cl + '" data-t="' + t + '"' + (t > auj ? ' disabled' : '') + ' aria-label="' + esc(longue(t)) + '"><span>' + j + '</span>' + (marques.has(iso(t)) ? '<i class="pt"></i>' : '') + '</button>';
        }
        corps = '<div class="cal-tete"><button class="cal-nav" data-nav="-1" aria-label="Mois précédent">&lsaquo;</button>' +
          '<button class="cal-titre" id="calTitre" aria-label="Choisir le mois et l\'année">' + new Date(an, m, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) + ' &#9662;</button>' +
          '<button class="cal-nav" data-nav="1" aria-label="Mois suivant"' + (new Date(an, m, 1) >= moisActuel ? ' disabled' : '') + '>&rsaquo;</button></div>' +
          '<div class="cal-sem">' + ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x) => '<span>' + x + '</span>').join('') + '</div>' +
          '<div class="cal-grille" data-mois="' + an + '-' + String(m + 1).padStart(2, '0') + '">' + cases + '</div>';
      }
      const r = resume();
      el.innerHTML = corps +
        '<div class="cal-resume">' + r.texte + '</div>' +
        '<div class="ligne-boutons"><button class="btn gris" id="calAnnuler">Annuler</button><button class="btn" id="calOk"' + (r.actif ? '' : ' disabled') + '>' + r.bouton + '</button></div>' +
        (marques.size ? '<div class="cal-legende"><i class="pt-l"></i> jour avec de l\'activité</div>' : '');

      $$('[data-nav]', el).forEach((b) => b.addEventListener('click', () => { mois.setMonth(mois.getMonth() + Number(b.dataset.nav)); dessiner(); }));
      $$('[data-an]', el).forEach((b) => b.addEventListener('click', () => { mois.setFullYear(mois.getFullYear() + Number(b.dataset.an)); dessiner(); }));
      $$('[data-m]', el).forEach((b) => b.addEventListener('click', () => { mois.setMonth(Number(b.dataset.m)); vue = 'jours'; dessiner(); }));
      const titre = $('#calTitre', el); if (titre) titre.addEventListener('click', () => { vue = 'mois'; dessiner(); });
      $$('[data-t]', el).forEach((b) => b.addEventListener('click', () => {
        const t = Number(b.dataset.t);
        if (etape !== 1) { debut = t; fin = null; etape = 1; }               // 1er appui : une date
        else { if (t < debut) { fin = debut; debut = t; } else fin = t; etape = 2; } // 2e appui : fin de la période
        dessiner();
      }));
      $('#calAnnuler', el).addEventListener('click', () => fenetre.fermer());
      $('#calOk', el).addEventListener('click', () => {
        const du = iso(debut), au = iso(fin === null ? debut : fin);
        fenetre.fermer(); apresChoix(du, au);
      });
    }
    dessiner();
  }

  // Branche les raccourcis et le calendrier. "rappel" est appelé à chaque changement (pour réafficher l'écran).
  // options.marques : dates (AAAA-MM-JJ) à marquer d'un point dans le calendrier.
  function brancher(conteneur, p, rappel, options) {
    const chips = $('#chipsPeriode', conteneur);
    $$('button', chips).forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.p === 'perso') {
        ouvrirCalendrier(p, options && options.marques, (du, au) => { p.type = 'perso'; p.du = du; p.au = au; rappel(); });
        return;
      }
      p.type = b.dataset.p; rappel();
    }));
    const actif = $('.actif', chips);
    if (actif) { // la liste défile pour que le choix actuel reste visible
      const r = actif.getBoundingClientRect(), c = chips.getBoundingClientRect();
      chips.scrollLeft += (r.left - c.left) - (c.width - r.width) / 2;
    }
  }

  return { nouveau, bornes, dans, libelle, slug, html, brancher, iso };
})();
