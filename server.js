// server.js  –  Shopify-Middleware (GraphQL‐Version)
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

const SHOP = "la-profumoteca-gmbh.myshopify.com";
const API_VERSION = "2024-04";               //  GraphQL-Version ≥ 2023-01
const TOKEN = process.env.SHOPIFY_TOKEN;     //  muss Scope „write_metaobjects“ & „write_customers“ haben

app.use(cors({ origin: true }));
app.use(bodyParser.json());

/* ─────────────────────────  HELPER  ──────────────────────── */
async function callGraphQL(query, variables = {}) {
  const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
      "Accept": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

/* ─────────────────────────  CUSTOMER  ─────────────────────── */
app.post("/create-customer", async (req, res) => {
  try {
    const { first_name, last_name, email, phone } = req.body;
    const gql = `
      mutation($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer { id firstName lastName }
          userErrors { field message }
        }
      }`;
    const data = await callGraphQL(gql, {
      input: {
        firstName: first_name,
        lastName:  last_name,
        email,
        phone
      }
    });
    res.json({ customer: data.customerCreate.customer, errors: data.customerCreate.userErrors });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/search-customer", async (req, res) => {
  const query = req.query.query || "";
  try {
    const gql = `
      query($q: String!) {
        customers(first: 10, query: $q) {
          edges { node { id firstName lastName email } }
        }
      }`;
    const d = await callGraphQL(gql, { q: query });
    res.json({ customers: d.customers.edges.map(e => ({ ...e.node, id: e.node.id.split("/").pop() })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ──────────────  KREATION LESEN  ───────────── */
app.get("/get-kreationen", async (req, res) => {
  const customerId = req.query.customerId;
  if (!customerId) return res.status(400).json({ error: "customerId fehlt" });

  try {
    /* 1️⃣  Kundimetafelder lesen */
    const metaGQL = `
      query($id: ID!){
        customer(id: $id) {
          metafields(first: 10, namespace: "custom") {
            edges { node { key value type } }
          }
        }
      }`;
    const metaData = await callGraphQL(metaGQL, { id: `gid://shopify/Customer/${customerId}` });
    const refs = metaData.customer.metafields.edges
      .filter(e => e.node.type === "metaobject_reference")
      .map(e => e.node.value);

    /* 2️⃣  Alle referenzierten Metaobjects abholen */
    if (!refs.length) return res.json({ kreationen: [] });

    const kreationGQL = `
      query($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Metaobject { id handle type fields { key value } }
        }
      }`;
    const kreationenData = await callGraphQL(kreationGQL, { ids: refs });
    res.json({ kreationen: kreationenData.nodes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ──────────────  KREATION SPEICHERN / UPDATEN  ───────────── */
app.post("/save-kreation", async (req, res) => {
  const { customerId, metaobjectId, kreation } = req.body;
  if (!customerId) return res.status(400).json({ error: "customerId fehlt" });

  try {
    /* 1️⃣  metaobjectUpsert (create oder update) */
    const fields = Object.entries(kreation).map(([k, v]) => ({ key: k, value: String(v) }));
    const upsertGQL = `
      mutation($input: MetaobjectUpsertInput!) {
        metaobjectUpsert(metaobject: $input) {
          metaobject { id handle }
          userErrors { field message }
        }
      }`;
    const upsertData = await callGraphQL(upsertGQL, {
      input: {
        id: metaobjectId || null,
        type: "parfumkreation",
        handle: metaobjectId ? undefined : `kreation-${Date.now()}`,
        fields
      }
    });
    const moId = upsertData.metaobjectUpsert.metaobject.id;

    /* 2️⃣  Falls neu: freien Slot am Kunden finden - oder beim Update überspringen */
    if (!metaobjectId) {
      const slots = ["kreation_1", "kreation_2", "kreation_3", "kreation_4", "kreation_5"];
      const setGQL = `
        mutation($customerId: ID!, $namespace:String!, $key:String!, $value:JSON!) {
          metafieldsSet(metafields: [{
            ownerId: $customerId,
            namespace: $namespace,
            key: $key,
            type: "metaobject_reference",
            value: $value
          }]) {
            metafields { id }
            userErrors { field message }
          }
        }`;
      /*  Metafelder des Kunden holen – um belegte Schlüssel zu überspringen */
      const metaGQL = `query($id:ID!){ customer(id:$id){ metafields(first:10,namespace:"custom"){edges{node{key}}}}}`;
      const metaData = await callGraphQL(metaGQL, { id: `gid://shopify/Customer/${customerId}` });
      const used = metaData.customer.metafields.edges.map(e => e.node.key);

      const slot = slots.find(s => !used.includes(s));
      if (!slot) return res.status(400).json({ error: "Alle Slots belegt" });

      await callGraphQL(setGQL, {
        customerId: `gid://shopify/Customer/${customerId}`,
        namespace: "custom",
        key: slot,
        value: moId
      });
      return res.json({ success: true, slot });
    }

    /* – bei Update – */
    res.json({ success: true, updated: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Middleware läuft auf Port ${PORT}`));
