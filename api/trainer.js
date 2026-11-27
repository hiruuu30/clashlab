// Only read the public endpoints used without authentication by the official client.
const BASE='https://pokeclashleague.xyz/api';
let cache=null;
let pending=null;
async function read(path){
 const response=await fetch(BASE+path,{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new Error('Public endpoint returned HTTP '+response.status);
 return response.json();
}
const cleanName=v=>String(v||'').replace(/^@+/,'').trim().slice(0,80);
const validId=v=>/^\d{1,15}$/.test(String(v))&&Number.isSafeInteger(Number(v))&&Number(v)>0;
async function directory(){
 if(cache&&Date.now()-cache.at<60000)return cache.rows;
 if(pending)return pending;
 pending=(async()=>{
  const out=await Promise.allSettled([read('/feed?since=0'),read('/chat?since=0')]);
  if(out.every(v=>v.status==='rejected'))throw Error('Public activity directory unavailable');
  const rows=new Map();
  for(const [i,r] of out.entries())if(r.status==='fulfilled'){
   const list=i===0?r.value.e:r.value.m;
   if(!Array.isArray(list))continue;
   for(const row of list)if(validId(row.u)&&cleanName(row.n))rows.set(String(row.u),{id:Number(row.u),name:cleanName(row.n)});
  }
  cache={at:Date.now(),rows:[...rows.values()]};return cache.rows;
 })().finally(()=>{pending=null});
 return pending;
}
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'GET only'});
 try{
  const id=req.query.id,q=cleanName(req.query.q);
  if(id!==undefined){
   if(!validId(id))return res.status(400).json({error:'Invalid trainer ID'});
   const p=await read('/chat/who?id='+encodeURIComponent(String(id)));
   if(!validId(p.id)||Number(p.id)!==Number(id)||!cleanName(p.n)||!Array.isArray(p.six))return res.status(404).json({error:'Trainer profile unavailable'});
   const six=p.six.slice(0,6).map(m=>({id:String(m.id),lv:Number(m.lv),mega:m.mega===2?2:m.mega?1:0,shiny:!!m.shiny}));
   return res.status(200).json({id:Number(p.id),name:cleanName(p.n),six});
  }
  if(q.length<2)return res.status(400).json({error:'Enter at least two username characters'});
  const rows=await directory(),needle=q.toLowerCase();
  const matches=rows.filter(x=>x.name.toLowerCase().includes(needle)).sort((a,b)=>(b.name.toLowerCase()===needle)-(a.name.toLowerCase()===needle)||a.name.localeCompare(b.name)).slice(0,20);
  return res.status(200).json({matches,scope:'recent public activity and chat only'});
 }catch(e){return res.status(502).json({error:'PokeClash public data unavailable. Try again or use a copied trainer ID.'});}
};
