// scripts/supabase-adapter.js
// Branche AZ (app.js) sur Supabase sans toucher tes pages
(function(){
  if (!window.__SUPABASE__ || !window.supabase || !window.AZ) return;

  const SB = supabase.createClient(window.__SUPABASE__.url, window.__SUPABASE__.anon);
  const AZ = window.AZ;

  // ---- état mémoire ----
  let _profile = null;                  // profil courant (sync pour AZ.currentUser)
  let REVIEWS_CACHE = [];               // cache de tous les avis (pour la carte + "Mes avis")
  const LOCAL_REVIEWS_KEY = 'az_reviews';
  const origStore = AZ._store || { get:()=>null, set:()=>{}, del:()=>{} };

  // ---- helpers ----
  async function loadProfile() {
    const { data:{ user } } = await SB.auth.getUser();
    if (!user){ _profile = null; return null; }
    const q = SB.from('profiles').select('*').eq('id', user.id).maybeSingle
      ? SB.from('profiles').select('*').eq('id', user.id).maybeSingle()
      : SB.from('profiles').select('*').eq('id', user.id).single(); // compat
    const { data, error } = await q;
    if (error && error.code !== 'PGRST116') throw error; // ignore "not found"
    _profile = data || { id:user.id, email:user.email };
    return _profile;
  }

  async function syncReviewsFromServer(){
    const { data, error } = await SB.from('reviews').select('*').order('created_at', { ascending:false });
    if (!error && Array.isArray(data)){
      REVIEWS_CACHE = data;
      try { origStore.set(LOCAL_REVIEWS_KEY, data); } catch {}
    }
  }

  // sync au démarrage (best effort)
  loadProfile().catch(()=>{});
  syncReviewsFromServer().catch(()=>{});

  // ---- AUTH ----
  AZ.createUser = async (payload) => {
    const email = String(payload.email||'').trim().toLowerCase();
    if (!email) throw new Error('Email requis.');
    if (!payload.password || String(payload.password).length < 6)
      throw new Error('Mot de passe trop court (min 6).');

    // 1) inscription
    const { data, error } = await SB.auth.signUp({ email, password: payload.password });
    if (error) throw new Error(error.message || 'Inscription impossible.');
    const user = data.user;
    if (!user) throw new Error('Inscription incomplète (vérification email ?).');

    // 2) profil
    const profile = {
      id: user.id,
      email,
      firstname: payload.firstname || null,
      lastname:  payload.lastname  || null,
      dob:       payload.dob       || null,
      gender:    payload.gender    || null,
      phone:     payload.phone     || null,
      address:   payload.address   || null,
      zip:       payload.zip       || null,
      city:      payload.city      || null,
      country:   payload.country   || 'France',
      allergies: Array.isArray(payload.allergies) ? payload.allergies : [],
      building:      payload.building      || null,
      street_number: payload.street_number || null,
      street:        payload.street        || null,
      address_extra: payload.address_extra || null,
    };
    const { error: e2 } = await SB.from('profiles').insert(profile);
    if (e2 && e2.code !== '23505') throw new Error(e2.message || 'Enregistrement du profil impossible.');

    _profile = profile;
    await syncReviewsFromServer();
    return profile;
  };

  AZ.signIn = async (email, password) => {
    const { error } = await SB.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message || 'Connexion impossible.');
    await loadProfile();
    await syncReviewsFromServer();
    return _profile;
  };

  AZ.signOut = async () => {
    await SB.auth.signOut();
    _profile = null;
    REVIEWS_CACHE = [];
    try { origStore.set(LOCAL_REVIEWS_KEY, []); } catch {}
    location.href = AZ.path.to('index');
  };

  AZ.requireAuth = (redirect) => {
    SB.auth.getUser().then(({ data:{ user } })=>{
      if (!user) location.href = redirect;
      else loadProfile().catch(()=>{});
    });
  };

  AZ.currentUser = () => _profile;

  AZ.updateUser = async (partial) => {
    const { data:{ user } } = await SB.auth.getUser();
    if (!user) throw new Error('Non connecté.');
    const { data, error } = await SB.from('profiles').update(partial).eq('id', user.id).select('*').single();
    if (error) throw new Error(error.message || 'Mise à jour impossible.');
    _profile = data;
    return data;
  };

  // ---- REVIEWS ----
  AZ.addReview = async (review) => {
    const { data:{ user } } = await SB.auth.getUser();
    if (!user) throw new Error('Non connecté.');

    const row = {
      user_id:  user.id,
      name:     String(review.name||'').trim() || 'Établissement',
      category: String(review.category||'autre').toLowerCase(),
      note:     Number(review.note||0),
      address:  String(review.address||'').trim() || null,
      lat:      Number(review.lat),
      lng:      Number(review.lng),
      comment:  String(review.comment||'').trim() || null
    };
    const { data, error } = await SB.from('reviews').insert(row).select('*').single();
    if (error) throw new Error(error.message || 'Enregistrement de l’avis impossible.');

    // maj cache + local pour la carte + “Mes avis”
    REVIEWS_CACHE.unshift(data);
    try { origStore.set(LOCAL_REVIEWS_KEY, REVIEWS_CACHE); } catch {}
    return { ...data, user_firstname: (_profile && _profile.firstname) ? _profile.firstname : 'Anonyme' };
  };

  // retourne la liste (cache) avec mêmes filtres que AZ.getReviews(local)
  AZ.getReviews = (filter = {}) => {
    const src = (REVIEWS_CACHE && REVIEWS_CACHE.length)
      ? REVIEWS_CACHE
      : (origStore.get(LOCAL_REVIEWS_KEY, []) || []);
    return src.filter(r=>{
      if (filter.user_id && r.user_id !== filter.user_id) return false;
      if (filter.category && r.category !== filter.category) return false;
      return true;
    });
  };

  // version online (rafraîchit le cache)
  AZ.getReviewsAsync = async (filter = {}) => {
    const { data, error } = await SB.from('reviews').select('*').order('created_at', { ascending:false });
    if (!error && Array.isArray(data)){
      REVIEWS_CACHE = data;
      try { origStore.set(LOCAL_REVIEWS_KEY, data); } catch {}
    }
    return AZ.getReviews(filter);
  };

  AZ.updateReview = async (id, patch) => {
    const { data:{ user } } = await SB.auth.getUser();
    if (!user) throw new Error('Non connecté.');
    const upd = {
      name:     patch.name,
      category: patch.category,
      note:     Number(patch.note),
      address:  patch.address,
      comment:  patch.comment
    };
    if (Number.isFinite(patch.lat) && Number.isFinite(patch.lng)){
      upd.lat = Number(patch.lat); upd.lng = Number(patch.lng);
    }
    const { data, error } = await SB.from('reviews').update(upd).eq('id', id).eq('user_id', user.id).select('*').single();
    if (error) throw new Error(error.message || 'Mise à jour impossible.');

    // maj cache + local
    const i = REVIEWS_CACHE.findIndex(x=> x.id === id);
    if (i >= 0) REVIEWS_CACHE[i] = data;
    try { origStore.set(LOCAL_REVIEWS_KEY, REVIEWS_CACHE); } catch {}
    return data;
  };

  AZ.deleteReview = async (id) => {
    const { data:{ user } } = await SB.auth.getUser();
    if (!user) throw new Error('Non connecté.');
    const { error } = await SB.from('reviews').delete().eq('id', id).eq('user_id', user.id);
    if (error) throw new Error(error.message || 'Suppression impossible.');

    REVIEWS_CACHE = REVIEWS_CACHE.filter(r=> r.id !== id);
    try { origStore.set(LOCAL_REVIEWS_KEY, REVIEWS_CACHE); } catch {}
    return true;
  };

  // ---- Pont transparent avec le panneau “Mes avis” (qui manipule localStorage) ----
  // On intercepte AZ._store.set('az_reviews', <array>) pour propager en ligne (update/delete)
  let _syncing = false;
  AZ._store = {
    get(key, def){
      if (key === LOCAL_REVIEWS_KEY){
        return (REVIEWS_CACHE && REVIEWS_CACHE.length) ? REVIEWS_CACHE : (origStore.get(key, def) || []);
      }
      return origStore.get(key, def);
    },
    set(key, val){
      if (key !== LOCAL_REVIEWS_KEY || _syncing){ return origStore.set(key, val); }
      try{
        const next = Array.isArray(val) ? val : [];
        const prev = Array.isArray(REVIEWS_CACHE) ? REVIEWS_CACHE : [];

        const prevMap = new Map(prev.map(r=> [r.id, r]));
        const nextMap = new Map(next.map(r=> [r.id, r]));

        const toDelete = prev.filter(r=> !nextMap.has(r.id));
        const toUpdate = next.filter(r=>{
          const p = prevMap.get(r.id);
          if (!p) return false; // (insertion via ce flux non supportée — create passe par AZ.addReview)
          const keys = ['name','category','note','address','comment','lat','lng'];
          return keys.some(k => (p[k] ?? null) !== (r[k] ?? null));
        });

        // fire & forget (on laisse l’UI fluide)
        toDelete.forEach(r=>{
          SB.auth.getUser().then(({ data:{ user } })=>{
            if (!user) return;
            SB.from('reviews').delete().eq('id', r.id).eq('user_id', user.id)
              .then(()=> syncReviewsFromServer()).catch(()=>{});
          }).catch(()=>{});
        });

        toUpdate.forEach(r=>{
          SB.auth.getUser().then(({ data:{ user } })=>{
            if (!user) return;
            const patch = { name:r.name, category:r.category, note:r.note, address:r.address, comment:r.comment };
            if (Number.isFinite(r.lat) && Number.isFinite(r.lng)){ patch.lat = r.lat; patch.lng = r.lng; }
            SB.from('reviews').update(patch).eq('id', r.id).eq('user_id', user.id)
              .then(()=> syncReviewsFromServer()).catch(()=>{});
          }).catch(()=>{});
        });

        REVIEWS_CACHE = next;
      } finally {
        _syncing = true;
        try { origStore.set(key, val); } finally { _syncing = false; }
      }
    },
    del(key){ return origStore.del(key); }
  };

  // expose le client si besoin de debug
  AZ.sb = SB;
})();
