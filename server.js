// server.js – Shopify‑Middleware | Metaobjects lesen (inkl. Debug‑Logs)
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

/************ Helper: GraphQL‑Call ************/
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
    console.log('📦 Kundemetafelder', JSON.stringify(metaJson, null, 2));

    const all=metaJson.metafields;
    const handleMap=Object.fromEntries(all.filter(f=>f.key.endsWith('_handle')).map(f=>[f.key.replace('_handle',''),f.value]));
        // Metaobject‑Referenzen können als "metaobject_reference" **oder** "mixed_reference" gespeichert sein
    const refs = all.filter(f => ['metaobject_reference','mixed_reference'].includes(f.type) && f.key.startsWith('kreation_'));
