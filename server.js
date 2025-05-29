// server.js – sichere Middleware für Shopify API (3‑Düfte‑Final + Debug)
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

const SHOP  = 'la-profumoteca-gmbh.myshopify.com';
const TOKEN = process.env.SHOPIFY_TOKEN;

app.use(cors({ origin: true }));
app.use(bodyParser.json());

/******************** Kunden anlegen ********************/
app.post('/create-customer', async (req, res) => {
  try {
    const r = await fetch(`https://${SHOP}/admin/api/2023-10/customers.json`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN },
      body: JSON.stringify({ customer: req.body })
    });
    const d = await r.json();
    res.status(r.status).json(d);
  } catch(e){ res.status(500).json({ error:'Fehler bei Kundenanlage' }); }
});

/******************** Kundensuche ********************/
app.get('/search-customer', async (req,res)=>{
  const q=req.query.query||'';
  try{
    const r=await fetch(`https://${SHOP}/admin/api/2023-10/customers/search.json?query=${encodeURIComponent(q)}`,{
      headers:{'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN}
    });
    const d=await r.json();res.status(r.status).json(d);
  }catch(e){res.status(500).json({error:'Fehler bei Suche'});}
});

/******************** Kreationen eines Kunden holen ********************/
app.get('/get-kreationen', async (req, res) => {
  const customerId = req.query.customerId;
  if (!customerId) return res.status(400).json({ error: 'CustomerId fehlt' });

  try {
    const metaRes = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`, {
      headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' }
    });
    const metaJson = await metaRes.json();
    const kreationRefs = metaJson.metafields.filter(f => f.key.startsWith('kreation_'));
    const kreationen = [];

    for (const ref of kreationRefs) {
      let refId = ref.value;
      // Wert kann eine gid sein ➜ numerische ID extrahieren
      if (typeof refId === 'string' && refId.startsWith('gid://')) {
        refId = refId.split('/').pop();
      }
      try {
        const kRes = await fetch(`https://${SHOP}/admin/api/2023-10/metaobjects/${refId}.json`, {
          headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' }
        });
        if (kRes.status === 200) {
          const raw = await kRes.json();
          console.log('🔎 RAW Metaobject‑Antwort:', raw);
          const meta = raw.metaobject || raw;
          // Name-Feld sicherstellen
          const hasName = (meta.fields || []).some(f => f.key === 'name');
          if (!hasName) meta.fields = [...(meta.fields || []), { key: 'name', value: meta.handle, type: 'single_line_text_field' }];
          kreationen.push(meta);
        } else {
          console.log('⚠️ Metaobject', refId, 'nicht gefunden (Status', kRes.status, ')');
        }
      } catch (err) {
        console.log('❌ Fehler beim Laden Metaobject', refId, err.message);
      }
    }

    res.json({ kreationen });
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Lesen der Kreationen', details: error.message });
  }
});
  try{
    // 1) alle Metafelder des Kunden lesen
    const metaRes = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`,{
      headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json'}
    });
    const metaJson = await metaRes.json();
    const kreationRefs = metaJson.metafields.filter(f=>f.key.startsWith('kreation_'));
    const kreationen=[];

    for(const ref of kreationRefs){
      const refId = ref.value;
      const kRes = await fetch(`https://${SHOP}/admin/api/2023-10/metaobjects/${refId}.json`,{
        headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json'}
      });
      const raw = await kRes.json();
      console.log('🔎 RAW Metaobject‑Antwort:', raw); // <-- Debug‑Log

      const meta = raw.metaobject || raw;            // Fallback falls Struktur anders
      // falls kein Feld "name" vorhanden -> Name = handle
      const hasName = (meta.fields||[]).some(f=>f.key==='name');
      if(!hasName){
        meta.fields = [...(meta.fields||[]), {key:'name',value:meta.handle,type:'single_line_text_field'}];
      }
      kreationen.push(meta);
    }
    res.json({kreationen});
  }catch(e){res.status(500).json({error:'Fehler beim Lesen der Kreationen',details:e.message});}
});

/******************** Kreation speichern ********************/
app.post('/save-kreation', async (req,res)=>{
  const {customerId,kreation}=req.body;
  try{
    const fields=Object.entries(kreation).filter(([_,v])=>v!==null&&v!==undefined).map(([k,v])=>{
      const map={name:'single_line_text_field',konzentration:'single_line_text_field',menge_ml:'integer',datum_erstellung:'date',bemerkung:'multi_line_text_field',duft_1_name:'single_line_text_field',duft_1_anteil:'integer',duft_1_gramm:'number_decimal',duft_1_ml:'number_decimal',duft_2_name:'single_line_text_field',duft_2_anteil:'integer',duft_2_gramm:'number_decimal',duft_2_ml:'number_decimal',duft_3_name:'single_line_text_field',duft_3_anteil:'integer',duft_3_gramm:'number_decimal',duft_3_ml:'number_decimal'};
      return {key:k,value:String(v).trim()===''?'keine':String(v),type:map[k]||'single_line_text_field'};});
    const payload={metaobject:{type:'parfumkreation',published:true,handle:`kreation-${Date.now()}`,fields}};
    const moRes = await fetch(`https://${SHOP}/admin/api/2023-10/metaobjects.json`,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN},body:JSON.stringify(payload)});
    const moJson = await moRes.json();
    const metaobjectId = moJson?.metaobject?.id;if(!metaobjectId) return res.status(400).json({error:'Fehler beim Metaobject'});

    // freien Slot finden und Referenz speichern
    const slots=['kreation_1','kreation_2','kreation_3','kreation_4','kreation_5'];
    const custMeta=await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`,{headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json'}}).then(r=>r.json());
    for(const s of slots){if(!custMeta.metafields.find(f=>f.key===s)){
      await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`,{
        method:'POST',headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json'},
        body:JSON.stringify({metafield:{namespace:'custom',key:s,type:'metaobject_reference',value:metaobjectId,owner_resource:'customer',owner_id:customerId}})});
      return res.json({success:true,slot:s});}}
    res.status(400).json({error:'Alle Slots belegt'});
  }catch(e){res.status(500).json({error:e.message||'Fehler beim Speichern'});}
});

app.listen(PORT,()=>console.log(`🚀 Middleware läuft auf Port ${PORT}`));
