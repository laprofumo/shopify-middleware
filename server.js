// server.js – Shopify‑Middleware (GraphQL‑Version) – Handle‑Fix
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';

const app   = express();
const PORT  = process.env.PORT || 3000;

// ✅  Shop‑Daten – Access‑Token im Render‑Dashboard hinterlegen
const SHOP  = 'la-profumoteca-gmbh.myshopify.com';
const TOKEN = process.env.SHOPIFY_TOKEN;

app.use(cors({ origin:true }));
app.use(bodyParser.json());

/* ─────────────────────────────────────────── HELPERS ─────────────────────────────────────────── */

/** Low‑level GraphQL‑Call an Shopify Admin‑API */
async function shopifyGraphQL(query, variables = {}) {
  const res = await fetch(`https://${SHOP}/admin/api/2023-10/graphql.json`, {
    method : 'POST',
    headers: {
      'Content-Type'          : 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body : JSON.stringify({ query, variables })
  });

  const raw = await res.text();
  console.log('🟣 GraphQL', res.status, raw.slice(0,300));
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('Antwort kein JSON'); }
  if (data.errors && data.errors.length) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

/* ─────────────────────────────────────────── KUNDE ─────────────────────────────────────────── */

app.post('/create-customer', async (req, res) => {
  try {
    const r = await fetch(`https://${SHOP}/admin/api/2023-10/customers.json`, {
      method :'POST',
      headers:{ 'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN },
      body   : JSON.stringify({ customer:req.body })
    });
    const j = await r.json();
    res.status(r.status).json(j);
  } catch (e) {
    res.status(500).json({ error:'Fehler bei Kundenanlage', details:e.message });
  }
});

app.get('/search-customer', async (req,res)=>{
  try{
    const r = await fetch(`https://${SHOP}/admin/api/2023-10/customers/search.json?query=${encodeURIComponent(req.query.query||'')}`,{
      headers:{'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN}
    });
    const j = await r.json();
    res.status(r.status).json(j);
  }catch(e){res.status(500).json({error:'Fehler bei Suche',details:e.message});}
});

/* ───────────────────────────────────── KREATION LESEN ───────────────────────────────────── */

app.get('/get-kreationen', async (req,res)=>{
  const customerId = req.query.customerId;
  if(!customerId) return res.status(400).json({error:'customerId fehlt'});
  try{
    const metaRes = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`,{
      headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json'}
    });
    const meta = await metaRes.json();
    console.log('📦 Kundemetafelder',JSON.stringify(meta));
    const refs = meta.metafields.filter(m=>m.key.startsWith('kreation_'));
    const kreationen=[];
    const q=`query Get($id:ID!){ metaobject(id:$id){ id handle type fields{key value} }}`;
    for(const r of refs){
      try{const d=await shopifyGraphQL(q,{id:r.value});kreationen.push(d.metaobject);}catch{console.warn('⚠️ metaobject fehlend');}
    }
    res.json({kreationen});
  }catch(e){res.status(500).json({error:'Fehler beim Laden',details:e.message});}
});

/* ───────────────────────────────── KREATION SPEICHERN ───────────────────────────────── */

app.post('/save-kreation', async (req,res)=>{
  const { customerId, metaobjectId, kreation } = req.body;
  if(!customerId||!kreation) return res.status(400).json({error:'Pflichtdaten fehlen'});

  try{
    const typeMap={ name:'single_line_text_field', konzentration:'single_line_text_field', menge_ml:'integer', datum_erstellung:'date', bemerkung:'multi_line_text_field',
    duft_1_name:'single_line_text_field',duft_1_anteil:'integer',duft_1_gramm:'number_decimal',duft_1_ml:'number_decimal',
    duft_2_name:'single_line_text_field',duft_2_anteil:'integer',duft_2_gramm:'number_decimal',duft_2_ml:'number_decimal',
    duft_3_name:'single_line_text_field',duft_3_anteil:'integer',duft_3_gramm:'number_decimal',duft_3_ml:'number_decimal'};
    const fields=Object.entries(kreation).map(([k,v])=>({key:k,value:String(v),type:typeMap[k]||'single_line_text_field'}));

    const gql=`mutation Upsert($meta:MetaobjectUpsertInput!){
      metaobjectUpsert(metaobject:$meta){ metaobject{ id handle } userErrors{field message} }
    }`;

    const metaInput = metaobjectId
      ? { id: metaobjectId, fields }
      : { handle:{ value:`kreation-${Date.now()}` }, type:'parfumkreation', status:'ACTIVE', fields };

    console.log('🆕 UPSERT', JSON.stringify(metaInput,null,2));

    const up = await shopifyGraphQL(gql,{ meta: metaInput });
    const errs = up.metaobjectUpsert.userErrors;
    if(errs && errs.length) return res.status(400).json({ error: errs.map(e=>e.message).join(', ') });
    const newId = up.metaobjectUpsert.metaobject.id;

    // neuen Slot setzen falls neu
    if(!metaobjectId){
      const slotNames=['kreation_1','kreation_2','kreation_3','kreation_4','kreation_5'];
      const existing = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`,{headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json'}}).then(r=>r.json());
      for(const key of slotNames){
        if(!existing.metafields.find(m=>m.key===key)){
          await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`,{
            method:'POST',headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json'},
            body:JSON.stringify({metafield:{namespace:'custom',key,type:'metaobject_reference',value:newId,owner_resource:'customer',owner_id:customerId}})
          });
          break;
        }
      }
    }

    res.json({success:true,id:newId});
  }catch(e){console.error('❌',e);res.status(500).json({error:e.message});}
});

app.listen(PORT,()=>console.log(`🚀 Middleware Port ${PORT}`));
