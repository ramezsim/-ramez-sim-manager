'use strict';
/* Revision-based sync with Supabase (replaces the old "upload everything every 5 seconds").

   - Save on change only, debounced; nothing is sent when nothing changed.
   - Every save carries the revision it is based on; the server (save_app_state)
     rejects it if another device saved in between -> conflict dialog.
     An old device can therefore never overwrite newer data automatically.
   - Offline: changes stay local and are retried with back-off when back online.
   - Other devices: a tiny revision check on focus and every 60s while visible;
     if the server is newer and this device has no pending changes, it reloads.
   - Local copy: IndexedDB only when "تذكرني" is on (needed for offline work);
     otherwise memory only. Everything local is wiped on logout. */

const Cache = (() => {
  const DB = 'ramez-sim-cache', STORE = 'kv';
  let dbp = null;
  function open(){
    if(dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      try{
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }catch(e){ reject(e); }
    }).catch(e => { dbp = null; throw e; });
    return dbp;
  }
  async function tx(mode, fn){
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode), s = t.objectStore(STORE);
      const req = fn(s);
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  return {
    get: async (k) => { try{ return await tx('readonly', s => s.get(k)); }catch(e){ return null; } },
    set: async (k, v) => { try{ await tx('readwrite', s => s.put(v, k)); return true; }catch(e){ console.warn('cache write failed', e); return false; } },
    del: async (k) => { try{ await tx('readwrite', s => s.delete(k)); }catch(e){} }
  };
})();

const Sync = (() => {
  const st = {
    uid:null, remember:false, started:false,
    revision:0, changeSeq:0, syncedSeq:0, lastSyncedJson:null,
    saving:false, timer:null, retryTimer:null, retryDelay:0, cacheTimer:null, pollTimer:null,
    conflict:null, status:'ok', statusMsg:''
  };
  const DEBOUNCE_MS = 1500, POLL_MS = 60000;

  const cacheKey = () => 'state:' + st.uid;
  const hasUnsynced = () => st.changeSeq !== st.syncedSeq;

  function setStatus(s, msg){
    if(s) st.status = s;
    else st.status = st.conflict ? 'conflict' : (!navigator.onLine && hasUnsynced()) ? 'offline' : 'ok';
    st.statusMsg = msg || '';
    if(typeof renderSyncBanner === 'function') renderSyncBanner(st.status, st.statusMsg, st.remember);
  }

  function scheduleCache(){
    if(!st.remember || !st.uid) return;
    clearTimeout(st.cacheTimer);
    st.cacheTimer = setTimeout(persistCache, 800);
  }
  async function persistCache(){
    if(!st.remember || !st.uid) return;
    await Cache.set(cacheKey(), {revision: st.revision, dirty: hasUnsynced(), state: data, savedAt: Date.now()});
  }

  function markChanged(){
    if(!st.started) return;
    st.changeSeq++;
    scheduleCache();
    schedule(DEBOUNCE_MS);
  }
  function schedule(ms){ clearTimeout(st.timer); st.timer = setTimeout(flush, ms); }
  function scheduleRetry(){
    if(!hasUnsynced()) return;
    st.retryDelay = Math.min(60000, Math.max(5000, st.retryDelay * 2));
    clearTimeout(st.retryTimer);
    st.retryTimer = setTimeout(flush, st.retryDelay);
  }

  async function flush(){
    clearTimeout(st.timer);
    if(!st.started) return 'stopped';
    if(st.conflict) return 'conflict';
    if(st.saving) return 'busy';
    if(!hasUnsynced()) return 'ok';
    if(!navigator.onLine){ setStatus('offline'); return 'offline'; }
    st.saving = true; setStatus('saving');
    const seq = st.changeSeq;
    const json = JSON.stringify(data);
    try{
      if(json === st.lastSyncedJson){ st.syncedSeq = seq; persistCache(); return 'ok'; }
      const body = '{"p_base_revision":' + Number(st.revision || 0) + ',"p_state":' + json + '}';
      const r = await Cloud.rpc('save_app_state', body);
      if(r?.status === 'ok'){
        st.revision = Number(r.revision); st.lastSyncedJson = json; st.syncedSeq = seq; st.retryDelay = 0;
        persistCache();
        if(hasUnsynced()) schedule(500);
        return 'ok';
      }
      if(r?.status === 'conflict'){
        st.conflict = {revision: Number(r.revision), updatedAt: r.updated_at || ''};
        persistCache();
        showSyncConflict(st.conflict);
        return 'conflict';
      }
      throw new Error('استجابة غير متوقعة من الخادم');
    }catch(e){
      if(e.network){ setStatus('offline'); scheduleRetry(); return 'offline'; }
      if(e.code === 'PGRST202') e.message = 'قاعدة البيانات لم تُحدَّث بعد (save_app_state غير موجودة).';
      console.error('sync failed', e);
      setStatus('error', e.message || String(e)); scheduleRetry(); return 'error';
    }finally{
      st.saving = false;
      if(st.status === 'saving') setStatus();
    }
  }

  async function flushNow(){
    for(let i=0; i<100 && st.saving; i++) await new Promise(r => setTimeout(r, 100));
    const r = await flush();
    return r === 'ok';
  }

  async function fetchServer(full = true){
    const sel = full ? 'state,revision,updated_at' : 'revision,updated_at';
    try{
      const rows = await Cloud.select('user_app_state', 'select=' + sel + '&owner_id=eq.' + encodeURIComponent(st.uid) + '&limit=1');
      return Array.isArray(rows) ? (rows[0] || null) : null;
    }catch(e){
      if(e.code === '42703') e.message = 'قاعدة البيانات لم تُحدَّث بعد (عمود revision غير موجود). شغّل ملف migration الأمني أولًا.';
      throw e;
    }
  }

  function adopt(state, revision){
    data = (state && typeof state === 'object') ? state : defaultState();
    normalize();
    st.revision = Number(revision || 0);
    st.lastSyncedJson = JSON.stringify(data);
    st.changeSeq = st.syncedSeq = 0;
  }

  async function start(uid, remember){
    stop();
    st.uid = uid; st.remember = !!remember; st.conflict = null; st.retryDelay = 0;
    if(!st.remember) await Cache.del('state:' + uid);   // respect the current "تذكرني" choice
    const cached = st.remember ? await Cache.get(cacheKey()) : null;
    let server = null, offline = false;
    try{ server = await fetchServer(true); }
    catch(e){ if(e.network) offline = true; else throw e; }

    let mode;
    if(offline){
      if(!cached?.state) throw new Error('لا يوجد اتصال بالإنترنت، ولا توجد نسخة محفوظة على هذا الجهاز.');
      adopt(cached.state, cached.revision);
      if(cached.dirty) st.changeSeq = 1, st.lastSyncedJson = null;
      mode = 'offline';
    }else if(!server){
      adopt(cached?.dirty ? cached.state : defaultState(), 0);
      st.changeSeq = 1; st.lastSyncedJson = null;          // create the row
      mode = 'new';
    }else if(cached?.dirty && cached.state){
      adopt(cached.state, cached.revision);
      st.changeSeq = 1; st.lastSyncedJson = null;
      if(Number(cached.revision) === Number(server.revision)) mode = 'resume';
      else { st.conflict = {revision: Number(server.revision), updatedAt: server.updated_at || ''}; mode = 'conflict'; }
    }else{
      adopt(server.state, server.revision);
      mode = 'server';
    }
    st.started = true;
    installWatchers();
    persistCache();
    setStatus(mode === 'offline' ? 'offline' : undefined);
    if(mode === 'offline') scheduleRetry();
    else if(mode === 'conflict') showSyncConflict(st.conflict);
    else if(mode === 'new' || mode === 'resume'){ if(mode === 'resume') notify('⏫ جاري رفع تغييرات محفوظة على هذا الجهاز'); flush(); }
    return mode;
  }

  async function checkRemote(){
    if(!st.started || st.saving || !navigator.onLine || document.visibilityState === 'hidden') return;
    try{
      const row = await fetchServer(false);
      if(!row || Number(row.revision) <= st.revision) return;
      if(hasUnsynced() || st.conflict){
        if(!st.conflict){ st.conflict = {revision: Number(row.revision), updatedAt: row.updated_at || ''}; showSyncConflict(st.conflict); setStatus(); }
        return;
      }
      const full = await fetchServer(true);
      if(!full || hasUnsynced()) return;
      adopt(full.state, full.revision);
      persistCache();
      applyTheme(); renderAll();
      notify('🔄 تم تحديث البيانات من جهاز آخر');
    }catch(e){ if(!e.network) console.warn('revision check failed', e); }
  }

  // ---- conflict resolution (explicit user choice only) ----
  async function resolveUseServer(){
    const row = await fetchServer(true);
    adopt(row?.state || defaultState(), row?.revision || 0);
    st.conflict = null; persistCache(); setStatus();
    applyTheme(); renderAll();
    notify('☁️ تم اعتماد النسخة الأحدث من السحابة');
  }
  async function resolveUseLocal(){
    const row = await fetchServer(false);
    st.revision = Number(row?.revision || 0);
    st.conflict = null; st.lastSyncedJson = null;
    if(!hasUnsynced()) st.changeSeq++;
    setStatus();
    const r = await flush();
    notify(r === 'ok' ? '☁️ تم حفظ نسخة هذا الجهاز في السحابة' : '⚠️ تعذر الحفظ، حاول مرة أخرى');
  }

  const onOnline = () => { setStatus(); flush(); checkRemote(); };
  const onOffline = () => setStatus();
  const onVisible = () => { if(document.visibilityState === 'visible') checkRemote(); else if(hasUnsynced()) flush(); };
  const onBeforeUnload = (e) => {
    if(st.started && hasUnsynced() && !st.remember){ e.preventDefault(); e.returnValue = ''; }
  };
  function installWatchers(){
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('beforeunload', onBeforeUnload);
    st.pollTimer = setInterval(checkRemote, POLL_MS);
  }
  function stop(){
    st.started = false;
    [st.timer, st.retryTimer, st.cacheTimer].forEach(clearTimeout);
    clearInterval(st.pollTimer);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('beforeunload', onBeforeUnload);
  }

  return {
    start, stop, markChanged, flush, flushNow, checkRemote, hasUnsynced,
    resolveUseServer, resolveUseLocal,
    get conflict(){ return st.conflict; },
    get revision(){ return st.revision; },
    get remember(){ return st.remember; },
    clearCache: (uid) => Cache.del('state:' + uid),
    _state: st
  };
})();
