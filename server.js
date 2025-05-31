// server.js – Shopify‑Middleware | Metaobjects lesen per GraphQL‑Fallback
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';

const app  = express();
const PORT = process.env.PORT || 3000;
const SHOP = 'la-profumoteca-gmbh.myshopify.com';
const TOKEN= process.env.SHOPIFY_TOKEN;

app.use(cors({ origin:true }));
app.use(bodyParser.json());

/************ kleine Helper‑Funktion ************/
async function fetchGraphQL(query, variables={}){
  const res = await fetch(`https://${SHOP}/admin/api/2023-10/graphql.json`, {
    method:'POST',
    headers:{'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN},
    body:JSON.stringify({query,variables})
  });
  return res.json();
}

/**************** 1. Kunde anlegen ****************/
app.post('/create-customer', async (req,res)=>{
  try{
    const r=await fetch(`https://${SHOP}/admin/api/2023-10/customers.json`,{
      method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN},body:JSON.stringify({customer:req.body})});
    res.status(r.status).json(await r.json());
  }catch{res.status(500).json({error:'Fehler bei Kundenanlage'});}  
});

/**************** 2. Kundensuche ****************/
app.get('/search-customer', async (req,res)=>{
  const q=req.query.query||'';
  try{
    const r=await fetch(`https://${SHOP}/admin/api/2023-10/customers/search.json?query=${encodeURIComponent(q)}`,{
      headers:{'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN}});
    res.status(r.status).json(await r.json());
  }catch{res.status(500).json({error:'Fehler bei Suche'});}  
});

/**************** 3. Kreationen eines Kunden lesen ****************/
app.get('/get-kreationen', async (req,res)=>{
  const customerId=req.query.customerId;
  if(!customerId) return res.status(400).json({error:'CustomerId fehlt'});
  try{
    // 3.1 Kundemetafelder holen
    const metaRes=await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`,{
      headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json'}});
    const metaJson=await metaRes.json();
    const all=metaJson.metafields;
    const handleMap=Object.fromEntries(all.filter(f=>f.key.endsWith('_handle')).map(f=>[f.key.replace('_handle',''),f.value]));
    const refs=all.filter(f=>f.type==='metaobject_reference'&&f.key.startsWith('kreation_'));
    const kreationen=[];

    for(const ref of refs){
      const refVal=ref.value; let meta=null;
      let gid = refVal;
      if(typeof refVal==='string' && refVal.startsWith('gid://')){
        gid = refVal;
        // 3.2 Versuch REST‑ID
        const id=refVal.split('/').pop();
        const rId=await fetch(`https://${SHOP}/admin/api/2023-10/metaobjects/${id}.json`,{
          headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json'}});
        if(rId.status===200){ meta=(await rId.json()).metaobject; }
      }
      // 3.3 GraphQL‑Fallback (nie 404)
      if(!meta){
        const gql=`query($id:ID!){ metaobject(id:$id){ id handle type fields{key value} } }`;
        const gRes=await fetchGraphQL(gql,{id:gid});
        meta=gRes.data?.metaobject||null;
      }
      // 3.4 Handle‑Fetch falls refVal selbst ein Handle ist
      if(!meta){
        const rH=await fetch(`https://${SHOP}/admin/api/2023-10/metaobjects/parfumkreation/${encodeURIComponent(refVal)}.json`,{headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json'}});
        if(rH.status===200) meta=(await rH.json()).metaobject;
      }
      // 3.5 Placeholder
      if(!meta){ meta={handle:handleMap[ref.key]||refVal,fields:[]}; }
      if(!(meta.fields||[]).some(f=>f.key==='name')) meta.fields=[...(meta.fields||[]),{key:'name',value:meta.handle,type:'single_line_text_field'}];
      kreationen.push(meta);
    }
    res.json({kreationen});
  }catch(e){res.status(500).json({error:'Fehler beim Lesen der Kreationen',details:e.message});}
});

/**************** 4. Kreation speichern (REST‑Variante bleibt vorerst) ****************/
app.post('/save-kreation', async (req,res)=>{
  const {customerId,kreation}=req.body;
  try{
    const typeMap={name:'single_line_text_field',konzentration:'single_line_text_field',menge_ml:'integer',datum_erstellung:'date',bemerkung:'multi_line_text_field',duft_1_name:'single_line_text_field',duft_1_anteil:'integer',duft_1_gramm:'number_decimal',duft_1_ml:'number_decimal',duft_2_name:'single_line_text_field',duft_2_anteil:'integer',duft_2_gramm:'number_decimal',duft_2_ml:'number_decimal',duft_3_name:'single_line_text_field',duft_3_anteil:'integer',duft_3_gramm:'number_decimal',duft_3_ml:'number_decimal'};
    const fields=Object.entries(kreation).filter(([_,v])=>v!==null&&v!==undefined).map(([k,v])=>({key:k,value:String(v)||'keine',type:typeMap[k]||'single_line_text_field'}));
    const handle=`kreation-${Date.now()}`;
    const newMO={metaobject:{type:'parfumkreation',published:true,handle,fields}};
    const moRes=await fetch(`https://${SHOP}/admin/api/2023-10/metaobjects.json`,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN},body:JSON.stringify(newMO)});
    const moJson=await moRes.json();
    const metaobjectId=moJson?.metaobject?.id;
    if(!metaobjectId) return res.status(400).json({error:'Metaobject nicht erstellt'});

    const slots=['kreation_1','kreation_2','kreation_3','kreation_4','kreation_5'];
    const custMeta=await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`,{headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json'}}).then(r=>r.json());
    for(const s of slots){
      if(!custMeta.metafields.find(f=>f.key===s)){
        // GID referenz + Handle Text
        await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`,{method:'POST',headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json'},body:JSON.stringify({metafield:{namespace:'custom',key:s,type:'metaobject_reference',value:metaobjectId,owner_resource:'customer',owner_id:customerId}})});
        await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`,{method:'POST',headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json'},body:JSON.stringify({metafield:{namespace:'custom',key:`${s}_handle`,type:'single_line_text_field',value:handle,owner_resource:'customer',owner_id:customerId}})});
        return res.json({success:true,slot:s});
      }
    }
    res.status(400).json({error:'Alle Slots belegt'});
  }catch(e){res.status(500).json({error:e.message});}
});

app.listen(PORT,()=>console.log(`🚀 Middleware läuft auf Port ${PORT}`));
