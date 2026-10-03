'use strict';
/* Role-based visibility of screens and actions.
   IMPORTANT: this is only UX. Real protection is on the server:
   - each employee can only read/write his own user_app_state row (RLS owner_id = auth.uid()),
   - companies are writable by admins only (RLS),
   - roles change only through admin_set_user_role() which checks the caller is admin. */

function cloudRole(){
  return Auth.profile?.role || 'employee';
}
function cloudIsAdmin(){ return cloudRole()==='admin'; }
function cloudRoleLabel(role){return role==='admin'?'مدير عام':role==='manager'?'مدير':'موظف';}
function cloudCan(action){
  const r=cloudRole();
  if(r==='admin') return true;
  const managerActions=['addSim','sell','renew','payment','customerNote','simNote','simStatus','reports','tools','imports','daily','search','smart'];
  if(r==='manager') return managerActions.includes(action);
  const employeeActions=['addSim','sell','renew','payment','customerNote','simNote','search','daily'];
  return employeeActions.includes(action);
}
function requireCloudPermission(action){
  if(cloudCan(action)) return true;
  alert('هذه العملية غير متاحة لصلاحيتك.');
  return false;
}
function applyRolePermissions(){
  const r=cloudRole();
  const hide=(sel,cond)=>{
    document.querySelectorAll(sel).forEach(el=>el.classList.toggle('role-hidden',!!cond));
  };
  // tabs
  hide('.tab[data-tab="reports"]', !cloudCan('reports'));
  hide('.tab[data-tab="companiesTab"]', r!=='admin');
  hide('.tab[data-tab="settings"]', r!=='admin');
  hide('.tab[data-tab="toolsTab"]', !cloudCan('tools'));
  hide('.tab[data-tab="smartCenter"]', !cloudCan('smart'));
  hide('.tab[data-tab="renewalImportsTab"]', !cloudCan('imports'));
  hide('.tab[data-tab="dailyTab"]', !cloudCan('daily'));
  hide('.tab[data-tab="searchTab"]', !cloudCan('search'));
  // quick actions
  hide('.quick-action[data-action="openQuickSell"]', !cloudCan('sell'));
  hide('.quick-action[data-action="openQuickRenew"]', !cloudCan('renew'));
  hide('.quick-action[data-tab="dailyTab"]', !cloudCan('daily'));
  hide('.quick-action[data-tab="toolsTab"]', !cloudCan('tools'));
  // admin panel
  const panel=document.getElementById('cloudAdminPanel');
  if(panel) panel.classList.toggle('role-hidden', r!=='admin');
}
function guardTabPermission(id){
  const map={
    reports:'reports', companiesTab:null, settings:null, toolsTab:'tools',
    smartCenter:'smart', renewalImportsTab:'imports', dailyTab:'daily', searchTab:'search',
    sims:'search', add:'addSim', customers:'search', renewals:'renew', dashboard:'search'
  };
  if(id==='companiesTab'||id==='settings') return cloudRole()==='admin';
  const a=map[id];
  return !a || cloudCan(a);
}
