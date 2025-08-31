// server.js – Shopify Middleware (GraphQL Create/Update für Metaobjects)
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';

const app  = express();
const PORT = process.env.PORT || 3000;

// Shop-Konfiguration
const SHOP  = 'la-profumoteca-gmbh.myshopify.com';
const TOKEN = process.env.SHOPIFY_TOKEN;

app.use(cors({ origin:true }));
app.use(bodyParser.json());

/* ───────────────────────────── Helpers ───────────────────────────── */

async function shopifyGraphQL(query, variables = {}) {
  const resp = await fetch(`https://${SHOP}/admin/api/2023-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type'          : 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: JSON.stringify({ query, variables })
  });
  const text = await resp.text();
  console.log('🟣 GraphQL', resp.status, text.slice(0, 300));
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('Antwort kein JSON'); }
  if (json.errors && json.errors.length) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

/* ───────────────────────────── Kunden ───────────────────────────── */

app.post('/create-customer', async (req,res)=>{
  try{
    const r = await fetch(`https://${SHOP}/admin/api/2023-10/customers.json`,{
      method:'POST',
      headers:{'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN},
      body:JSON.stringify({ customer:req.body })
    });
    const j = await r.json();
    res.status(r.status).json(j);
  }catch(e){ res.status(500).json({ error:'Fehler bei Kundenanlage', details:e.message }); }
});

app.get('/search-customer', async (req,res)=>{
  try{
    const r = await fetch(`https://${SHOP}/admin/api/2023-10/customers/search.json?query=${encodeURIComponent(req.query.query||'')}`,{
      headers:{'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN}
    });
    const j = await r.json();
    res.status(r.status).json(j);
  }catch(e){ res.status(500).json({ error:'Fehler bei Suche', details:e.message }); }
});

/* ───────────────────── Kreationen lesen (REST + GraphQL) ───────────────────── */

app.get('/get-kreationen', async (req,res)=>{
  const customerId = req.query.customerId;
  if(!customerId) return res.status(400).json({ error:'customerId fehlt' });

  try{
    const metaRes = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`,{
      headers:{ 'X-Shopify-Access-Token':TOKEN, 'Content-Type':'application/json' }
    });
    const meta = await metaRes.json();
    console.log('📦 Kundemetafelder', JSON.stringify(meta));
    const refs = (meta.metafields||[]).filter(m=>m.key.startsWith('kreation_') && typeof m.value==='string' && m.value.includes('gid://shopify/Metaobject/'));

    const kreationen=[];
    const q = `query GetOne($id:ID!){
      metaobject(id:$id){ id handle type fields{ key value } }
    }`;

    for(const r of refs){
      try{
        const d = await shopifyGraphQL(q,{ id:r.value });
        if(d?.metaobject) kreationen.push(d.metaobject);
        else console.warn('⚠️ metaobject leer', r.value);
      }catch(err){
        console.warn('⚠️ metaobject nicht auflösbar', r.value, err.message);
      }
    }

    res.json({ kreationen });
  }catch(e){
    res.status(500).json({ error:'Fehler beim Laden', details:e.message });
  }
});

/* ───────────────────── Kreation speichern (GraphQL) ─────────────────────
   - Neu:  metaobjectCreate(type, handle, fields)
   - Update: metaobjectUpdate(id, fields)
   Danach (nur bei Neu) Kunden-Metafield (metaobject_reference) auf freien Slot legen.
-------------------------------------------------------------------------- */

app.post('/save-kreation', async (req,res)=>{
  const { customerId, metaobjectId, kreation } = req.body || {};
  if(!customerId || !kreation) return res.status(400).json({ error:'Pflichtdaten fehlen' });

  try{
    // GraphQL Felder: NUR key/value (kein type!)
    const fields = Object.entries(kreation)
      .filter(([_,v]) => v!==undefined && v!==null && String(v).trim()!=='')
      .map(([key,value]) => ({ key, value: String(value) }));

    let newId = metaobjectId || null;

    if (metaobjectId) {
      // Update bestehendes Metaobject
      const mut = `mutation UpdateMetaobject($id:ID!,$meta:MetaobjectUpdateInput!){
        metaobjectUpdate(id:$id, metaobject:$meta){
          metaobject{ id handle }
          userErrors{ field message }
        }
      }`;
      const data = await shopifyGraphQL(mut,{ id: metaobjectId, meta: { fields } });
      const errs = data.metaobjectUpdate.userErrors;
      if (errs && errs.length) return res.status(400).json({ error: errs.map(e=>e.message).join(', ') });
      newId = data.metaobjectUpdate.metaobject.id;

    } else {
      // Neu anlegen
      const mut = `mutation CreateMetaobject($meta:MetaobjectCreateInput!){
        metaobjectCreate(metaobject:$meta){
          metaobject{ id handle }
          userErrors{ field message }
        }
      }`;
      const handle = `kreation-${Date.now()}`;
      const data = await shopifyGraphQL(mut,{
        meta: { type:'parfumkreation', handle, fields }
      });
      const errs = data.metaobjectCreate.userErrors;
      if (errs && errs.length) return res.status(400).json({ error: errs.map(e=>e.message).join(', ') });
      newId = data.metaobjectCreate.metaobject.id;

      // Kunden-Metafield Slot belegen (REST)
      const slots=['kreation_1','kreation_2','kreation_3','kreation_4','kreation_5'];
      const existing = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`,{
        headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json'}
      }).then(r=>r.json());

      for(const key of slots){
        if(!existing.metafields.find(m=>m.key===key)){
          const resp = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`,{
            method:'POST',
            headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json'},
            body:JSON.stringify({
              metafield:{
                namespace:'custom',
                key,
                type:'metaobject_reference',
                value:newId,
                owner_resource:'customer',
                owner_id:customerId
              }
            })
          });
          const t = await resp.text();
          if(!resp.ok) console.warn('⚠️ Metafield Slot POST fehlgeschlagen', resp.status, t);
          break;
        }
      }
    }

    res.json({ success:true, id:newId });
  }catch(e){
    console.error('❌ save-kreation', e.message);
    res.status(500).json({ error:e.message||'Fehler beim Speichern' });
  }
});

app.listen(PORT, ()=>console.log(`🚀 Middleware läuft auf Port ${PORT}`));
