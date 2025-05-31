// server.js – revert to placeholder logic + richer logging
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;
const SHOP = 'la-profumoteca-gmbh.myshopify.com';
const TOKEN = process.env.SHOPIFY_TOKEN;

app.use(cors({ origin: true }));
app.use(bodyParser.json());

/**************** 1. Kunde anlegen ****************/
app.post('/create-customer', async (req, res) => {
  try {
    const r = await fetch(`https://${SHOP}/admin/api/2023-10/customers.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
      body: JSON.stringify({ customer: req.body })
    });
    res.status(r.status).json(await r.json());
  } catch {
    res.status(500).json({ error: 'Fehler bei Kundenanlage' });
  }
});

/**************** 2. Kundensuche ****************/
app.get('/search-customer', async (req, res) => {
  const q = req.query.query || '';
  try {
    const r = await fetch(`https://${SHOP}/admin/api/2023-10/customers/search.json?query=${encodeURIComponent(q)}`, {
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN }
    });
    res.status(r.status).json(await r.json());
  } catch {
    res.status(500).json({ error: 'Fehler bei Suche' });
  }
});

/**************** 3. Kreationen eines Kunden lesen ****************/
app.get('/get-kreationen', async (req, res) => {
  const customerId = req.query.customerId;
  if (!customerId) return res.status(400).json({ error: 'CustomerId fehlt' });
  try {
    // alle Metafelder des Kunden
    const metaRes = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`, {
      headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' }
    });
    const metaJson = await metaRes.json();
    const allFields = metaJson.metafields;
    // Map für Handles (kreation_1_handle etc.)
    const handleMap = Object.fromEntries(allFields.filter(f => f.key.startsWith('kreation_') && f.key.endsWith('_handle')).map(f => [f.key.replace('_handle',''), f.value]));
    // nur metaobject_reference nehmen
    const kreationRefs = allFields.filter(f => f.type === 'metaobject_reference' && f.key.startsWith('kreation_'));
    const kreationen=[];

    for(const ref of kreationRefs){
      const refVal=ref.value; let meta=null;
      // 1) gid
      if(typeof refVal==='string' && refVal.startsWith('gid://')){
        const id=refVal.split('/').pop();
        const rId=await fetch(`https://${SHOP}/admin/api/2023-10/metaobjects/${id}.json`,{headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json'}});
        if(rId.status===200) meta=(await rId.json()).metaobject;
      }
      // 2) handle direct
      if(!meta){const rH=await fetch(`https://${SHOP}/admin/api/2023-10/metaobjects/parfumkreation/${encodeURIComponent(refVal)}.json`,{headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json'}});if(rH.status===200) meta=(await rH.json()).metaobject;}
      // 3) placeholder mit gespeichertem handle
      if(!meta){const handle=handleMap[ref.key]||refVal;meta={handle,fields:[]};}
      if(!(meta.fields||[]).some(f=>f.key==='name')) meta.fields=[...(meta.fields||[]),{key:'name',value:meta.handle,type:'single_line_text_field'}];
      kreationen.push(meta);
    }
    res.json({kreationen});
  }catch(e){res.status(500).json({error:'Fehler beim Lesen der Kreationen',details:e.message});}
});

  try {
    const metaRes = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`, {
      headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' }
    });
    const metaJson = await metaRes.json();
    const kreationRefs = metaJson.metafields.filter(f => f.key.startsWith('kreation_'));
    const kreationen = [];

    for (const ref of kreationRefs) {
      const refVal = ref.value;
      let meta = null;
      // 1️⃣ Versuch über gid → ID
      if (typeof refVal === 'string' && refVal.startsWith('gid://')) {
        const id = refVal.split('/').pop();
        const rId = await fetch(`https://${SHOP}/admin/api/2023-10/metaobjects/${id}.json`, {
          headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' }
        });
        if (rId.status === 200) meta = (await rId.json()).metaobject;
      }
      // 2️⃣ Versuch über Handle
      if (!meta) {
        const rHandle = await fetch(`https://${SHOP}/admin/api/2023-10/metaobjects/parfumkreation/${encodeURIComponent(refVal)}.json`, {
          headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' }
        });
        if (rHandle.status === 200) meta = (await rHandle.json()).metaobject;
      }
      // 3️⃣ Wenn beides nicht klappt → Platzhalter erzeugen (wie frühere Version)
      if (!meta) {
        console.log('⚠️ Metaobject', refVal, 'nicht gefunden – Platzhalter angelegt');
        meta = { handle: refVal, fields: [] };
      }
      // Name-Feld sicherstellen
      if (!(meta.fields || []).some(f => f.key === 'name')) {
        meta.fields = [...(meta.fields || []), { key: 'name', value: meta.handle, type: 'single_line_text_field' }];
      }
      kreationen.push(meta);
    }

    res.json({ kreationen });
  } catch (e) {
    res.status(500).json({ error: 'Fehler beim Lesen der Kreationen', details: e.message });
  }
});

/**************** 4. Kreation speichern ****************/
app.post('/save-kreation', async (req, res) => {
  const { customerId, kreation } = req.body;
  try {
    const typeMap = {
      name: 'single_line_text_field', konzentration: 'single_line_text_field', menge_ml: 'integer', datum_erstellung: 'date', bemerkung: 'multi_line_text_field',
      duft_1_name: 'single_line_text_field', duft_1_anteil: 'integer', duft_1_gramm: 'number_decimal', duft_1_ml: 'number_decimal',
      duft_2_name: 'single_line_text_field', duft_2_anteil: 'integer', duft_2_gramm: 'number_decimal', duft_2_ml: 'number_decimal',
      duft_3_name: 'single_line_text_field', duft_3_anteil: 'integer', duft_3_gramm: 'number_decimal', duft_3_ml: 'number_decimal'
    };
    const fields = Object.entries(kreation)
      .filter(([_, v]) => v !== null && v !== undefined)
      .map(([k, v]) => ({ key: k, value: String(v) || 'keine', type: typeMap[k] || 'single_line_text_field' }));

    const newMO = { metaobject: { type: 'parfumkreation', published: true, handle: `kreation-${Date.now()}`, fields } };
    const moRes = await fetch(`https://${SHOP}/admin/api/2023-10/metaobjects.json`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN }, body: JSON.stringify(newMO)
    });
    const moJson = await moRes.json();
    const metaobjectId = moJson?.metaobject?.id;
    if (!metaobjectId) return res.status(400).json({ error: 'Metaobject nicht erstellt' });

    const slots = ['kreation_1', 'kreation_2', 'kreation_3', 'kreation_4', 'kreation_5'];
    const custMeta = await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`, {
      headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' }
    }).then(r => r.json());

    for(const s of slots){
      if(!custMeta.metafields.find(f=>f.key===s)){
        // 1️⃣ GID referenz speichern
        await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`,{
          method:'POST', headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json'},
          body:JSON.stringify({metafield:{namespace:'custom',key:s,type:'metaobject_reference',value:metaobjectId,owner_resource:'customer',owner_id:customerId}})});
        // 2️⃣ zusätzlich Handle ablegen (leichte Anzeige im Frontend)
        await fetch(`https://${SHOP}/admin/api/2023-10/customers/${customerId}/metafields.json`,{
          method:'POST', headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json'},
          body:JSON.stringify({metafield:{namespace:'custom',key:`${s}_handle`,type:'single_line_text_field',value:newMO.metaobject.handle,owner_resource:'customer',owner_id:customerId}})});
        return res.json({success:true,slot:s});
      }
    }
    res.status(400).json({error:'Alle Slots belegt'});({ error: 'Alle Slots belegt' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Middleware läuft auf Port ${PORT}`));
