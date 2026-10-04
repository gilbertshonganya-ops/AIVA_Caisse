/* AIVA Caisse - générateur de PDF minimal (aucune bibliothèque, marche hors connexion)
   Écrit un vrai fichier PDF A4 avec les polices standard Helvetica (accents français inclus).
   Les positions sont en points, MESURÉES DEPUIS LE HAUT de la page (y croissant vers le bas), couleurs en RVB 0-255.
     const doc = Pdf.creer();  doc.nouvellePage();
     doc.rect(0, 0, doc.largeur, 70, [11, 122, 62]);
     doc.texte(40, 34, 'Bonjour', { taille: 18, gras: true, couleur: [255, 255, 255] });
     doc.texte(doc.largeur - 40, 54, 'à droite', { align: 'right' });
     const octets = doc.octets('Titre du document'); */
const Pdf = (() => {
  const LARGEUR = 595.28, HAUTEUR = 841.89;

  // Largeurs des caractères Helvetica (pour 1000 unités) : sert à aligner et couper le texte
  const W = { ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191, '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015, 'A': 667, 'B': 667, 'C': 722, 'D': 722, 'E': 667, 'F': 611, 'G': 778, 'H': 722, 'I': 278, 'J': 500, 'K': 667, 'L': 556, 'M': 833, 'N': 722, 'O': 778, 'P': 667, 'Q': 778, 'R': 722, 'S': 667, 'T': 611, 'U': 722, 'V': 667, 'W': 944, 'X': 667, 'Y': 667, 'Z': 611, '[': 278, '\\': 278, ']': 278, '^': 469, '_': 556, '`': 333, 'a': 556, 'b': 556, 'c': 500, 'd': 556, 'e': 556, 'f': 278, 'g': 556, 'h': 556, 'i': 222, 'j': 222, 'k': 500, 'l': 222, 'm': 833, 'n': 556, 'o': 556, 'p': 556, 'q': 556, 'r': 333, 's': 500, 't': 278, 'u': 556, 'v': 500, 'w': 722, 'x': 500, 'y': 500, 'z': 500, '{': 334, '|': 260, '}': 334, '~': 584 };
  for (let d = 0; d <= 9; d++) W[String(d)] = 556;

  // Remplace ce que la police standard ne sait pas afficher
  function nettoyer(s) {
    return String(s == null ? '' : s)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[\u202F\u00A0\u2009]/g, ' ')
      .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...').replace(/\u20AC/g, 'EUR')
      .replace(/[\u{10000}-\u{10FFFF}]/gu, '')
      .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
  }
  const echapper = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  function largeurTexte(s, taille, gras) {
    let total = 0;
    for (const c of nettoyer(s)) total += W[c.normalize('NFD')[0]] || 556;
    return total / 1000 * taille * (gras ? 1.07 : 1);
  }

  // Coupe un texte trop long avec "..."
  function tronquer(s, max, taille, gras) {
    s = nettoyer(s);
    if (largeurTexte(s, taille, gras) <= max) return s;
    while (s.length > 1 && largeurTexte(s + '...', taille, gras) > max) s = s.slice(0, -1);
    return s.trimEnd() + '...';
  }

  const n2 = (n) => Number(n).toFixed(2);
  const coul = (c) => (c || [0, 0, 0]).map((x) => (x / 255).toFixed(3)).join(' ');

  function creer() {
    const pages = [];
    let courante = null;

    const api = {
      largeur: LARGEUR,
      hauteur: HAUTEUR,
      nbPages: () => pages.length,
      nouvellePage() { courante = []; pages.push(courante); return api; },
      rect(x, y, w, h, couleur) {
        courante.push(coul(couleur) + ' rg ' + n2(x) + ' ' + n2(HAUTEUR - y - h) + ' ' + n2(w) + ' ' + n2(h) + ' re f');
      },
      ligne(x1, y1, x2, y2, couleur, epaisseur) {
        courante.push(coul(couleur) + ' RG ' + n2(epaisseur || 1) + ' w ' + n2(x1) + ' ' + n2(HAUTEUR - y1) + ' m ' + n2(x2) + ' ' + n2(HAUTEUR - y2) + ' l S');
      },
      // o : { taille, gras, couleur, align: 'right', page: numéro de page (sinon la page courante) }
      texte(x, y, s, o = {}) {
        const page = o.page !== undefined ? pages[o.page] : courante;
        const taille = o.taille || 10;
        if (o.align === 'right') x -= largeurTexte(s, taille, o.gras);
        page.push('BT /' + (o.gras ? 'F2' : 'F1') + ' ' + taille + ' Tf ' + coul(o.couleur) + ' rg ' + n2(x) + ' ' + n2(HAUTEUR - y) + ' Td (' + echapper(nettoyer(s)) + ') Tj ET');
      },
      // Fichier PDF complet sous forme d'octets
      octets(titre) {
        const toutes = pages.length ? pages : [[]];
        const objs = [];
        objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
        objs[1] = '<< /Type /Pages /Kids [' + toutes.map((_, i) => (6 + 2 * i) + ' 0 R').join(' ') + '] /Count ' + toutes.length + ' >>';
        objs[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
        objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
        objs[4] = '<< /Title (' + echapper(nettoyer(titre || 'AIVA Caisse')) + ') /Producer (AIVA Caisse) >>';
        toutes.forEach((contenu, i) => {
          const flux = contenu.join('\n');
          objs[5 + 2 * i] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + LARGEUR + ' ' + HAUTEUR + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + (7 + 2 * i) + ' 0 R >>';
          objs[6 + 2 * i] = '<< /Length ' + flux.length + ' >>\nstream\n' + flux + '\nendstream';
        });
        let sortie = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
        const positions = [];
        objs.forEach((o, i) => { positions.push(sortie.length); sortie += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
        const debutXref = sortie.length;
        sortie += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' +
          positions.map((p) => String(p).padStart(10, '0') + ' 00000 n \n').join('');
        sortie += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R /Info 5 0 R >>\nstartxref\n' + debutXref + '\n%%EOF\n';
        const octets = new Uint8Array(sortie.length);
        for (let i = 0; i < sortie.length; i++) octets[i] = sortie.charCodeAt(i) & 255;
        return octets;
      }
    };
    return api;
  }

  return { creer, tronquer, largeurTexte };
})();
