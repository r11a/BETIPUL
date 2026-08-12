export function apiUrl(path, ingressPath=globalThis.document?.querySelector('meta[name="betipul-ingress-path"]')?.content||'') {
  const apiPath=path.startsWith('/')?path:`/${path}`;
  if(ingressPath&&ingressPath!=='__BETIPUL_INGRESS_PATH__')return `${ingressPath.replace(/\/+$/,'')}/api${apiPath}`;
  return `./api${apiPath}`;
}

export async function api(path, options={}) {
  const response=await fetch(apiUrl(path),{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options,body:options.body&&typeof options.body!=='string'?JSON.stringify(options.body):options.body});
  if(response.status===204)return null;
  const data=await response.json().catch(()=>({error:`שגיאת תקשורת (${response.status})`}));
  if(!response.ok){const error=new Error(data.error||'הפעולה נכשלה');error.status=response.status;error.code=data.code;throw error;}
  return data;
}

export const fmtMoney=(value)=>new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',maximumFractionDigits:0}).format(Number(value)||0);
export const fmtDate=(value,options={})=>value?new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',year:'numeric',...options}).format(new Date(value)):'—';
export const fmtTime=(value)=>value?new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'—';
