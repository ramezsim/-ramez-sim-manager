'use strict';
/* Thin Supabase REST/Auth client (no SDK).
   Session handling:
   - Only access/refresh tokens + user id/email are stored, never the password.
   - "تذكرني" ON  -> localStorage (survives closing the browser)
     "تذكرني" OFF -> sessionStorage (gone when the tab/browser closes)
   - Access tokens are refreshed automatically before expiry and on 401. */
const Cloud = (() => {
  const BASE = APP_CONFIG.supabaseUrl;
  const KEY = APP_CONFIG.supabaseKey;
  const SESSION_KEY = 'ramez_supabase_session_v1';
  let session = null;
  let refreshing = null;

  function configured(){ return !!(BASE && KEY && /^https:\/\/[a-z0-9-]+\.supabase\.co$|^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(BASE)); }

  function shape(s, remember){
    if(!s?.access_token) return null;
    const expiresAt = Number(s.expires_at) || Math.floor(Date.now()/1000) + Number(s.expires_in || 3600);
    const u = s.user || session?.user || null;
    return {
      access_token: s.access_token,
      refresh_token: s.refresh_token || session?.refresh_token || '',
      expires_at: expiresAt,
      user: u ? {id: u.id, email: u.email || ''} : null,
      remember: !!remember
    };
  }
  function persist(){
    try{
      if(!session){ localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); return; }
      // Write the chosen store first and only then clear the other one, so other
      // tabs never see a "session removed" event during a normal token refresh.
      const keep = session.remember ? localStorage : sessionStorage;
      const drop = session.remember ? sessionStorage : localStorage;
      keep.setItem(SESSION_KEY, JSON.stringify(session));
      drop.removeItem(SESSION_KEY);
    }catch(e){ console.warn('session storage unavailable', e); }
  }
  function setSession(s, remember){ session = shape(s, remember ?? session?.remember); persist(); return session; }
  function setUser(u){ if(session && u?.id){ session.user = {id:u.id, email:u.email||''}; persist(); } }
  function loadStored(){
    try{
      const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
      const s = raw ? JSON.parse(raw) : null;
      session = s?.access_token ? s : null;
    }catch(e){ session = null; }
    return session;
  }
  function clearSession(){
    session = null;
    try{ localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); }catch(e){}
  }

  function netError(e){ const err = new Error('NETWORK'); err.network = true; err.cause = e; return err; }

  async function refresh(){
    if(!session?.refresh_token) return 'invalid';
    if(refreshing) return refreshing;
    refreshing = (async () => {
      try{
        const res = await fetch(BASE + '/auth/v1/token?grant_type=refresh_token', {
          method:'POST', cache:'no-store',
          headers:{'apikey':KEY, 'Content-Type':'application/json'},
          body: JSON.stringify({refresh_token: session.refresh_token})
        });
        if(!res.ok) return 'invalid';
        const j = await res.json();
        setSession({...j, user: j.user || session?.user}, session?.remember);
        return 'ok';
      }catch(e){ return 'network'; }
      finally{ refreshing = null; }
    })();
    return refreshing;
  }

  async function request(path, {method='GET', body, headers={}, auth=true, retry=true} = {}){
    if(auth && session?.expires_at && session.expires_at*1000 - Date.now() < 60000) await refresh();
    const h = new Headers(headers);
    h.set('apikey', KEY);
    if(auth && session?.access_token) h.set('Authorization', 'Bearer ' + session.access_token);
    if(body !== undefined && !h.has('Content-Type')) h.set('Content-Type', 'application/json');
    let res;
    try{ res = await fetch(BASE + path, {method, headers:h, body, cache:'no-store'}); }
    catch(e){ throw netError(e); }
    if(res.status === 401 && auth && retry && session?.refresh_token){
      const r = await refresh();
      if(r === 'ok') return request(path, {method, body, headers, auth, retry:false});
      if(r === 'network') throw netError();
    }
    const text = await res.text();
    let json = null; try{ json = text ? JSON.parse(text) : null; }catch(_){ json = null; }
    if(!res.ok){
      const msg = json?.msg || json?.message || json?.error_description || json?.error || ('HTTP ' + res.status);
      const err = new Error(msg); err.status = res.status; err.code = json?.code || json?.error_code; err.payload = json;
      throw err;
    }
    return json;
  }

  const enc = encodeURIComponent;
  return {
    configured, loadStored, setSession, setUser, clearSession,
    get session(){ return session; },
    get user(){ return session?.user || null; },
    request,
    signIn: async (email, password, remember) => {
      const s = await request('/auth/v1/token?grant_type=password', {method:'POST', auth:false, body: JSON.stringify({email, password})});
      if(!s?.access_token || !s?.user) throw new Error('لم يتم إنشاء جلسة دخول.');
      return setSession(s, remember);
    },
    getUser: () => request('/auth/v1/user'),
    signOutRemote: () => request('/auth/v1/logout?scope=local', {method:'POST'}),
    recover: (email, redirectTo) => request('/auth/v1/recover?redirect_to=' + enc(redirectTo), {method:'POST', auth:false, body: JSON.stringify({email})}),
    updatePassword: (password) => request('/auth/v1/user', {method:'PUT', body: JSON.stringify({password})}),
    select: (table, query) => request('/rest/v1/' + table + '?' + query),
    rpc: (fn, rawJsonBody) => request('/rest/v1/rpc/' + fn, {method:'POST', body: rawJsonBody}),
    insert: (table, row) => request('/rest/v1/' + table, {method:'POST', headers:{'Prefer':'return=representation'}, body: JSON.stringify(row)}),
    update: (table, query, patch) => request('/rest/v1/' + table + '?' + query, {method:'PATCH', headers:{'Prefer':'return=representation'}, body: JSON.stringify(patch)})
  };
})();
