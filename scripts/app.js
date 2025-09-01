/* scripts/app.js — AllergoZyme front “core”
 * - DB locale (localStorage) : users, session, reviews
 * - Auth : createUser, signIn, signOut, currentUser, requireAuth, updateUser
 * - Reviews : addReview, getReviews (+ migration des anciens avis)
 * - Utils : geocode (Nominatim), colorByNote, path helper, export/import JSON
 * - API stable pour migration ultérieure (ex: Supabase) sans changer tes pages
 */
(function(){
  'use strict';

  const AZ_VERSION = '1.2.0';

  /* ---------- Écrans nommés (centralisé) ---------- */
  const SCREENS = {
    index:     'index.html',
    signIn:    'sign-in.html',
    signUp:    'sign-up.html',
    dashboard: 'Dashboard.html',
  };

  /* ---------- Keys localStorage ---------- */
  const K = {
    USERS:    'az_users',
    SESSION:  'az_session',
    REVIEWS:  'az_reviews',
    SETTINGS: 'az_settings',
  };

  /* ---------- Constantes & helpers ---------- */
  const CATEGORIES = new Set(['restaurant','snack','boulangerie','autre']);

  const hasCrypto = typeof window.crypto !== 'undefined';
  const hasSubtle = hasCrypto && crypto.subtle && crypto.subtle.digest;

  function uuid() {
    if (hasCrypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{
      const r = Math.random()*16|0, v = c==='x'?r:(r&0x3|0x8); return v.toString(16);
    });
  }

  function toHex(buffer){
    return Array.prototype.map.call(new Uint8Array(buffer), x => x.toString(16).padStart(2,'0')).join('');
  }

  async function sha256(text){
    if (hasSubtle) {
      const enc = new TextEncoder().encode(text);
      const buf = await crypto.subtle.digest('SHA-256', enc);
      return toHex(buf);
    } else {
      // fallback (faible, à remplacer dès qu’on passe en ligne)
      return btoa(unescape(encodeURIComponent(text)));
    }
  }

  function normEmail(email){ return String(email||'').trim().toLowerCase(); }
  function sanitize(s){ return String(s||'').trim(); }
  function isEmail(str){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str); }
  function normCat(v){ v = String(v||'').toLowerCase().trim(); return CATEGORIES.has(v) ? v : 'autre'; }
  function isFiniteNumber(n){ return Number.isFinite(Number(n)); }

  /* ---------- Path / Routing (résistant aux chemins) ---------- */
  function detectScreensBase(){
    const p = location.pathname;
    // si l’URL contient déjà /screens/, on garde cette base
    const i = p.lastIndexOf('/screens/');
    if (i >= 0) return p.slice(0, i+9); // inclut '/screens/'

    // si on est exactement sur /screens ou /screens/
    if (p.endsWith('/screens') || p.endsWith('/screens/')) return p.endsWith('/')?p:p+'/';

    // par défaut, pointer vers ./screens/ depuis la page actuelle
    return p.endsWith('/') ? p + 'screens/' : p.replace(/[^/]+$/, 'screens/');
  }
  let SCREENS_BASE = detectScreensBase();

  function pathTo(name){
    const file = SCREENS[name] || name;
    if (location.pathname.includes('/screens/')) return './' + file; // déjà dans /screens
    return SCREENS_BASE + file; // sinon, lien absolu vers /screens/
  }
  function go(name){ location.href = pathTo(name); }

  /* ---------- Stockage (localStorage) ---------- */
  const store = {
    get(key, def){
      try{
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : (def ?? null);
      }catch{
        return def ?? null;
      }
    },
    set(key, value){
      localStorage.setItem(key, JSON.stringify(value));
    },
    del(key){
      localStorage.removeItem(key);
    }
  };

  /* ---------- Modèles & Requêtes locales ---------- */
  function listUsers(){ return store.get(K.USERS, []); }
  function saveUsers(arr){ store.set(K.USERS, arr); }

  function session(){ return store.get(K.SESSION, null); }
  function saveSession(s){ store.set(K.SESSION, s); }
  function clearSession(){ store.del(K.SESSION); }

  function listReviews(){ return store.get(K.REVIEWS, []); }
  function saveReviews(arr){ store.set(K.REVIEWS, arr); }

  /* ---------- Auth ---------- */
  async function createUser(payload){
    const email = normEmail(payload.email);
    if (!isEmail(email)) throw new Error('Email invalide.');
    if (!payload.password || String(payload.password).length < 6)
      throw new Error('Mot de passe trop court (min 6).');

    const users = listUsers();
    if (users.some(u => normEmail(u.email) === email))
      throw new Error('Cet email est déjà utilisé.');

    const salt = uuid();
    const password_hash = await sha256(String(payload.password) + ':' + salt);

    const user = {
      id: uuid(),
      email,
      password_hash: `sha256$${salt}$${password_hash}`,
      firstname: sanitize(payload.firstname),
      lastname:  sanitize(payload.lastname),
      dob:       sanitize(payload.dob),
      gender:    sanitize(payload.gender),
      address:   sanitize(payload.address),
      zip:       sanitize(payload.zip),
      city:      sanitize(payload.city),
      country:   sanitize(payload.country || 'France'),
      phone:     sanitize(payload.phone),
      allergies: Array.isArray(payload.allergies) ? payload.allergies.slice(0,3).map(sanitize) : (payload.allergies || []),
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    users.push(user);
    saveUsers(users);

    // session auto
    saveSession({ user_id: user.id, ts: Date.now() });
    return redactedUser(user);
  }

  function redactedUser(u){
    if (!u) return null;
    const { password_hash, ...safe } = u;
    return safe;
  }

  async function verifyPassword(storedHash, password){
    if (!storedHash) return false;
    // format: "sha256$<salt>$<hex>"
    const parts = String(storedHash).split('$');
    if (parts[0] !== 'sha256') return false;
    const salt = parts[1]; const hashHex = parts[2];
    const calc = await sha256(String(password)+':'+salt);
    return calc === hashHex;
  }

  async function signIn(email, password){
    const e = normEmail(email);
    const u = listUsers().find(x => normEmail(x.email) === e);
    if (!u) throw new Error('Compte introuvable.');
    const ok = await verifyPassword(u.password_hash, password);
    if (!ok) throw new Error('Mot de passe incorrect.');
    saveSession({ user_id: u.id, ts: Date.now() });
    return redactedUser(u);
  }

  function currentUser(){
    const s = session(); if (!s) return null;
    const u = listUsers().find(x => x.id === s.user_id);
    return redactedUser(u);
  }

  function requireAuth(redirect = pathTo('signIn')){
    if (!currentUser()) location.href = redirect;
  }

  function signOut(){
    clearSession();
    location.href = pathTo('index');
  }

  function updateUser(partial){
    const s = session(); if (!s) throw new Error('Non connecté.');
    const arr = listUsers();
    const i = arr.findIndex(x => x.id === s.user_id);
    if (i < 0) throw new Error('Utilisateur introuvable.');
    const u = arr[i];

    // on n’autorise pas la modif email ici
    const patch = { ...u, ...partial, email: u.email, updated_at: Date.now() };
    arr[i] = patch;
    saveUsers(arr);
    return redactedUser(patch);
  }

  /* ---------- Reviews ---------- */
  function colorByNote(note){
    const n = Number(note);
    if (n >= 4) return 'green';
    if (n === 3) return 'orange';
    return 'red';
  }

  // Migration : garantir le bon “shape” même si des avis plus anciens existent
  function migrateReviews(){
    const arr = listReviews();
    if (!Array.isArray(arr) || !arr.length) return;
    let changed = false;

    const users = listUsers();

    for (let r of arr){
      // 1) name (ancien schéma ne l’avait pas)
      if (!('name' in r) || !r.name){
        r.name = (r.address && String(r.address).split(',')[0].trim()) || 'Établissement';
        changed = true;
      }

      // 2) catégorie
      const cat = normCat(r.category);
      if (cat !== r.category){ r.category = cat; changed = true; }

      // 3) note numérique
      const n = Number(r.note || 0) || 0;
      if (n !== r.note){ r.note = n; changed = true; }

      // 4) lat/lng numériques
      const lat = Number(r.lat), lng = Number(r.lng);
      if (Number.isFinite(lat) && lat !== r.lat){ r.lat = lat; changed = true; }
      if (Number.isFinite(lng) && lng !== r.lng){ r.lng = lng; changed = true; }

      // 5) prénom auteur (nouveau champ)
      if (!('user_firstname' in r) || !r.user_firstname){
        if (r.user_id){
          const u = users.find(x => x.id === r.user_id);
          r.user_firstname = (u && u.firstname) ? sanitize(u.firstname) : 'Anonyme';
        } else {
          r.user_firstname = 'Anonyme';
        }
        changed = true;
      }
    }

    if (changed) saveReviews(arr);
  }

  function addReview(review){
    const u = currentUser();
    const arr = listReviews();

    const rec = {
      id: uuid(),
      user_id: u ? u.id : null,
      user_firstname: u ? sanitize(u.firstname || 'Anonyme') : 'Anonyme', // prêt pour affichage sur la carte
      name: sanitize(review.name || ''),            // nom de l’établissement
      category: normCat(review.category || 'restaurant'),
      note: Number(review.note || 5),
      address: sanitize(review.address || ''),
      lat: Number(review.lat),
      lng: Number(review.lng),
      comment: sanitize(review.comment || ''),
      created_at: Date.now(),
    };

    if (!rec.name) rec.name = (rec.address && rec.address.split(',')[0].trim()) || 'Établissement';
    if (!isFiniteNumber(rec.lat) || !isFiniteNumber(rec.lng))
      throw new Error('Coordonnées invalides.');

    arr.push(rec);
    saveReviews(arr);
    return rec;
  }

  function getReviews(filter = {}){
    migrateReviews(); // garantit la cohérence avant toute lecture
    const arr = listReviews();
    return arr.filter(r=>{
      if (filter.user_id && r.user_id !== filter.user_id) return false;
      if (filter.category && r.category !== filter.category) return false;
      return true;
    });
  }

  /* ---------- Geocoding (Nominatim / OpenStreetMap) ---------- */
  async function geocode(address){
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', address);
    url.searchParams.set('format','json');
    url.searchParams.set('limit','1');
    const res = await fetch(url.toString(), { headers: { 'Accept-Language':'fr' } });
    if (!res.ok) throw new Error('Erreur géocodage');
    const data = await res.json();
    if (!data.length) throw new Error('Adresse introuvable');
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  }

  /* ---------- Export / Import JSON ---------- */
  function exportJSON(){
    const data = {
      version: AZ_VERSION,
      users:   listUsers(),
      reviews: listReviews(),
    };
    return JSON.stringify(data, null, 2);
  }

  function downloadExport(filename = 'allergozyme-export.json'){
    const content = exportJSON();
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function importJSON(jsonString){
    const data = JSON.parse(jsonString);
    if (!data || typeof data !== 'object') throw new Error('JSON invalide.');
    if (Array.isArray(data.users))   saveUsers(data.users);
    if (Array.isArray(data.reviews)) saveReviews(data.reviews);
    migrateReviews(); // normalise le shape après import
    return { users: listUsers().length, reviews: listReviews().length };
  }

  /* ---------- API publique ---------- */
  const AZ = {
    version: AZ_VERSION,

    // routing
    path: { to: pathTo, go },

    // auth
    createUser, signIn, signOut, currentUser, requireAuth, updateUser,

    // reviews
    addReview, getReviews, colorByNote,

    // utils
    geocode,

    // data migration / sauvegarde
    exportJSON, downloadExport, importJSON,

    // accès “safe” si besoin (debug / migration)
    _store: { get: store.get, set: store.set, del: store.del },
  };

  // Expose global non-modifiable
  Object.defineProperty(window, 'AZ', { value: AZ, writable: false });

  // Signal “prêt” pour les écrans
  document.dispatchEvent(new CustomEvent('AZ_READY', { detail: { version: AZ_VERSION }}));
})();
