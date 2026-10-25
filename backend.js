/* REMIDAY backend: a small adapter that gives the app the same `claude.use("db")`
   and `claude.use("assets")` API it was written against, backed by Supabase.
   Data lives in two tables: `docs` (collection, id, data jsonb) and `media` (id, data text). */
(function(){
  const cfg = window.REMIDAY_CONFIG || {};
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "remiday-auth" }
  });
  window.REMIDAY_SB = sb;

  /* ---------- live cache of the docs table ---------- */
  const cache = {};          // collection -> Map(id -> data)
  const listeners = new Set();
  let channel = null;

  function coll(c){ if(!cache[c]) cache[c] = new Map(); return cache[c]; }
  function emit(c){ listeners.forEach(l => { if(l.c === c) l.fire(); }); }
  function snapDoc(id, data){ return { id, exists: !!data, data: () => data ? JSON.parse(JSON.stringify(data)) : undefined, metadata:{fromCache:false,hasPendingWrites:false} }; }

  async function loadAll(){
    const { data, error } = await sb.from("docs").select("collection,id,data");
    if(error) throw error;
    Object.keys(cache).forEach(k => cache[k].clear());
    (data || []).forEach(r => coll(r.collection).set(r.id, r.data));
    Object.keys(cache).forEach(emit);
  }

  function startRealtime(){
    if(channel) return;
    channel = sb.channel("remiday-docs")
      .on("postgres_changes", { event: "*", schema: "public", table: "docs" }, p => {
        if(p.eventType === "DELETE"){ const o = p.old || {}; if(o.collection){ coll(o.collection).delete(o.id); emit(o.collection); } }
        else { const n = p.new; coll(n.collection).set(n.id, n.data); emit(n.collection); }
      })
      .subscribe();
  }

  // iOS pauses sockets in the background: refetch whenever the app comes back.
  document.addEventListener("visibilitychange", () => { if(!document.hidden && ready) loadAll().catch(()=>{}); });

  let ready = false, readyP = null;
  function ensureReady(){
    if(!readyP) readyP = loadAll().then(() => { ready = true; startRealtime(); });
    return readyP;
  }

  function query(c, ops){
    return {
      orderBy(f, dir){ return query(c, {...ops, order:[f, dir || "asc"]}); },
      limit(n){ return query(c, {...ops, limit:n}); },
      where(){ return query(c, ops); },
      onSnapshot(next, err){
        const l = { c, fire(){
          let rows = [...coll(c).entries()];
          if(ops.order){ const [f, d] = ops.order; rows.sort((x,y)=>{ const a=x[1][f], b=y[1][f]; return (a>b?1:a<b?-1:0) * (d==="desc"?-1:1); }); }
          if(ops.limit) rows = rows.slice(0, ops.limit);
          const docs = rows.map(([id, d]) => snapDoc(id, d));
          next({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata:{fromCache:false,hasPendingWrites:false} });
        }};
        listeners.add(l);
        ensureReady().then(() => l.fire()).catch(e => err && err({code:"unavailable", message:String(e && e.message || e)}));
        return () => listeners.delete(l);
      },
      async get(){ await ensureReady(); let out; const l = query(c, ops).onSnapshot(s => out = s); l(); return out; }
    };
  }

  function docRef(c, id){
    return {
      id, path: c + "/" + id,
      async get(){ await ensureReady(); return snapDoc(id, coll(c).get(id)); },
      async set(data){
        coll(c).set(id, data); emit(c);
        const { error } = await sb.from("docs").upsert({ collection: c, id, data, updated_at: new Date().toISOString() });
        if(error) throw { code: "invalid_argument", message: error.message };
      },
      async update(patch){
        const merged = { ...(coll(c).get(id) || {}), ...patch };
        return docRef(c, id).set(merged);
      },
      async delete(){
        coll(c).delete(id); emit(c);
        const { error } = await sb.from("docs").delete().match({ collection: c, id });
        if(error) throw { code: "invalid_argument", message: error.message };
      },
      onSnapshot(next, err){
        const l = { c, fire(){ next(snapDoc(id, coll(c).get(id))); } };
        listeners.add(l);
        ensureReady().then(() => l.fire()).catch(e => err && err({code:"unavailable", message:String(e)}));
        return () => listeners.delete(l);
      }
    };
  }

  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), b => (b % 36).toString(36)).join("");

  const db = {
    collection(c){ return Object.assign(query(c, {}), { path: c, doc: id => docRef(c, id || rid()), async add(d){ const r = docRef(c, rid()); await r.set(d); return r; } }); },
    doc(path){ const [c, id] = path.split("/"); return docRef(c, id); }
  };

  /* ---------- media (images stored as data URIs, readable only when signed in) ---------- */
  const mediaCache = {};
  window.blobUrl = id => mediaCache[id] || "";
  window.loadMedia = async ids => {
    const need = ids.filter(id => id && !(id in mediaCache));
    if(!need.length) return false;
    const { data, error } = await sb.from("media").select("id,data").in("id", need);
    if(error) return false;
    (data || []).forEach(r => mediaCache[r.id] = r.data);
    return true;
  };
  const assets = {
    async upload(blob){
      const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
      const id = "photo-" + rid();
      const { error } = await sb.from("media").insert({ id, mime: blob.type || "image/jpeg", data: dataUrl });
      if(error) throw { code: "store_unavailable", message: error.message };
      mediaCache[id] = dataUrl;
      return { id, url: dataUrl, sizeBytes: blob.size, contentType: blob.type };
    }
  };

  /* ---------- the claude.use() shim the app expects ---------- */
  /* ---------- passcode sign-in ---------- */
  const authed = new Promise(resolve => {
    sb.auth.getSession().then(({ data }) => { if(data && data.session) resolve(); else showLogin(resolve); });
  });
  function showLogin(resolve){
    const wrap = document.createElement("div");
    wrap.className = "lock";
    wrap.innerHTML = `<form class="lockcard" novalidate>
      <img src="mascot.png" alt="" class="lockicon">
      <div class="lockname"><span>REMI</span>DAY</div>
      <label class="locklbl" for="lockcode">Enter your family passcode</label>
      <input id="lockcode" type="password" autocomplete="current-password" enterkeyhint="go" required>
      <button type="submit" class="lockbtn">Unlock</button>
      <div class="lockerr" role="alert"></div>
    </form>`;
    document.body.appendChild(wrap);
    const form = wrap.querySelector("form"), input = wrap.querySelector("input"), err = wrap.querySelector(".lockerr"), btn = wrap.querySelector("button");
    setTimeout(() => input.focus(), 100);
    form.addEventListener("submit", async e => {
      e.preventDefault(); err.textContent = ""; btn.disabled = true; btn.textContent = "Unlocking…";
      const { error } = await sb.auth.signInWithPassword({ email: cfg.loginEmail, password: input.value });
      btn.disabled = false; btn.textContent = "Unlock";
      if(error){ const offline = !error.status || /fetch|network/i.test(error.message || ""); err.textContent = offline ? "Can't reach the server right now. Check your connection and try again." : "That passcode didn't work. Try again."; input.select(); return; }
      wrap.remove(); resolve();
    });
  }

  window.claude = { use: async name => { await authed; return name === "db" ? db : name === "assets" ? assets : null; } };
})();
