/* AIVA Caisse - chiffrement des sauvegardes avec un mot de passe
   AES-256-GCM, clé dérivée du mot de passe par PBKDF2 (200 000 tours). Utilise l'API du navigateur
   (Web Crypto), qui exige une adresse sécurisée : HTTPS ou localhost.
   ATTENTION : sans le mot de passe, la sauvegarde est impossible à rouvrir (même pour nous). */
const Coffre = (() => {
  const TOURS = 200000;
  const disponible = () => !!(window.crypto && window.crypto.subtle);

  function enB64(octets) {
    let s = '';
    for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function deB64(b64) {
    const s = atob(b64);
    const o = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i);
    return o;
  }
  async function deriverCle(motDePasse, sel, tours) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(motDePasse), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sel, iterations: tours, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // texte (JSON) -> objet chiffré enregistrable dans un fichier
  async function chiffrer(texte, motDePasse) {
    if (!disponible()) throw new Error('Le chiffrement exige une connexion sécurisée (HTTPS). Hébergez l\'application en HTTPS.');
    const sel = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cle = await deriverCle(motDePasse, sel, TOURS);
    const chiffre = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cle, new TextEncoder().encode(texte));
    return {
      application: 'AIVA Caisse', chiffre: true, version: 1, kdf: 'PBKDF2-SHA256', tours: TOURS,
      sel: enB64(sel), iv: enB64(iv), donnees: enB64(new Uint8Array(chiffre))
    };
  }

  async function dechiffrer(objet, motDePasse) {
    if (!disponible()) throw new Error('Le déchiffrement exige une connexion sécurisée (HTTPS).');
    try {
      const cle = await deriverCle(motDePasse, deB64(objet.sel), objet.tours || TOURS);
      const clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(objet.iv) }, cle, deB64(objet.donnees));
      return new TextDecoder().decode(clair);
    } catch (e) {
      throw new Error('Mot de passe incorrect (ou fichier abîmé).');
    }
  }

  return { disponible, chiffrer, dechiffrer };
})();
