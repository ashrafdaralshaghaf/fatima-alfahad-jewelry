import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Field, ImageManager, PageHead, useLoad, useToast } from "../ui.jsx";

const blank = {
  id: "", category: "", collection: "", price: "", natural: "", stock: "", sortOrder: 0, isActive: true, isNew: false,
  name: { en: "", ar: "" }, story: { en: "", ar: "" }, metal: { en: "", ar: "" }, stone: { en: "", ar: "" }, images: [],
};
const num = (v) => (v === "" || v == null ? null : Number(v));

export default function ProductEdit() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const cats = useLoad(() => api("/categories"), []);
  const cols = useLoad(() => api("/collections"), []);
  const prod = useLoad(() => (editing ? api(`/products/${id}`) : Promise.resolve(null)), [id]);

  useEffect(() => {
    const p = prod.data;
    if (p) setF({ ...blank, ...p, collection: p.collection || "", price: p.price, natural: p.natural ?? "", stock: p.stock ?? "" });
  }, [prod.data]);
  useEffect(() => {
    if (!editing && cats.data && !f.category) setF((x) => ({ ...x, category: cats.data.items[0]?.slug || "" }));
  }, [cats.data, editing, f.category]);

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setL = (k, lang, v) => setF((x) => ({ ...x, [k]: { ...x[k], [lang]: v } }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const body = {
      ...(editing ? {} : f.id ? { id: f.id } : {}),
      category: f.category, collection: f.collection || null,
      price: Number(f.price), natural: num(f.natural), stock: num(f.stock),
      name: f.name, story: f.story, metal: f.metal, stone: f.stone,
      isActive: f.isActive, isNew: f.isNew, sortOrder: Number(f.sortOrder) || 0, images: f.images,
    };
    try {
      if (editing) { await api(`/products/${id}`, { method: "PUT", body }); toast("Product saved"); }
      else { const r = await api("/products", { method: "POST", body }); toast("Product created"); nav(`/products/${r.id}`, { replace: true }); }
    } catch (err) { toast(err.message, "err"); }
    setBusy(false);
  }

  if (editing && prod.loading && !prod.data) return <div className="spin">Loading…</div>;
  const cat = cats.data?.items.find((c) => c.slug === f.category);

  return (
    <form onSubmit={save}>
      <PageHead title={editing ? f.name.en || "Edit product" : "New product"} sub={editing ? `ID: ${id}` : "Add a piece to the shop"}>
        <button type="button" className="btn" onClick={() => nav("/products")}>← Back</button>
      </PageHead>

      <div className="panel">
        <h2>Photos</h2>
        <p className="muted" style={{ marginTop: -6 }}>The first image is the cover. JPEG, PNG or WebP, up to 10 MB each.</p>
        <ImageManager value={f.images} onChange={(v) => set("images", v)} />
      </div>

      <div className="panel">
        <h2>Name & story</h2>
        <div className="stack">
          <div className="grid2">
            <Field label="Name (English)"><input className="input" required maxLength={150} value={f.name.en} onChange={(e) => setL("name", "en", e.target.value)} /></Field>
            <Field label="Name (Arabic)"><input className="input" dir="rtl" required maxLength={150} value={f.name.ar} onChange={(e) => setL("name", "ar", e.target.value)} /></Field>
          </div>
          <div className="grid2">
            <Field label="Story (English)"><textarea className="textarea" maxLength={600} value={f.story.en} onChange={(e) => setL("story", "en", e.target.value)} /></Field>
            <Field label="Story (Arabic)"><textarea className="textarea" dir="rtl" maxLength={600} value={f.story.ar} onChange={(e) => setL("story", "ar", e.target.value)} /></Field>
          </div>
          <div className="grid2">
            <Field label="Metal (English)"><input className="input" maxLength={150} value={f.metal.en} onChange={(e) => setL("metal", "en", e.target.value)} /></Field>
            <Field label="Metal (Arabic)"><input className="input" dir="rtl" maxLength={150} value={f.metal.ar} onChange={(e) => setL("metal", "ar", e.target.value)} /></Field>
          </div>
          <div className="grid2">
            <Field label="Stones (English)"><input className="input" maxLength={250} value={f.stone.en} onChange={(e) => setL("stone", "en", e.target.value)} /></Field>
            <Field label="Stones (Arabic)"><input className="input" dir="rtl" maxLength={250} value={f.stone.ar} onChange={(e) => setL("stone", "ar", e.target.value)} /></Field>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Pricing & organisation</h2>
        <div className="stack">
          <div className="grid3">
            <Field label="Price · lab-grown (KWD)"><input className="input" type="number" step="0.001" min="0" required value={f.price} onChange={(e) => set("price", e.target.value)} /></Field>
            <Field label="Price · natural diamond (KWD)" hint="Leave empty if there is no natural option.">
              <input className="input" type="number" step="0.001" min="0" value={f.natural} onChange={(e) => set("natural", e.target.value)} /></Field>
            <Field label="Stock" hint="Empty = made to order (unlimited).">
              <input className="input" type="number" min="0" step="1" value={f.stock} onChange={(e) => set("stock", e.target.value)} /></Field>
          </div>
          <div className="grid3">
            <Field label="Category">
              <select className="select" required value={f.category} onChange={(e) => set("category", e.target.value)}>
                {cats.data?.items.map((c) => <option key={c.slug} value={c.slug}>{c.name.en}</option>)}
              </select>
            </Field>
            <Field label="Collection">
              <select className="select" value={f.collection} onChange={(e) => set("collection", e.target.value)}>
                <option value="">— None —</option>
                {cols.data?.items.map((c) => <option key={c.slug} value={c.slug}>{c.name.en}</option>)}
              </select>
            </Field>
            <Field label="Sort order" hint="Lower numbers appear first.">
              <input className="input" type="number" step="1" value={f.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} /></Field>
          </div>
          {cat && (
            <p className="muted">
              {cat.sizeKind === "ring" ? `Customers choose a ring size (${cat.sizes.join(", ")}).` : cat.sizeKind === "length" ? `Customers choose a length in cm (${cat.sizes.join(", ")}).` : "No size selector for this category."}{" "}
              {cat.engravable ? "Engraving is offered." : "Engraving is not offered."} <span>(Edit this under Categories.)</span>
            </p>
          )}
          {!editing && (
            <Field label="Product ID (optional)" hint="Used in the page address. Leave empty to generate it from the English name. It cannot be changed later.">
              <input className="input" pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} value={f.id} onChange={(e) => set("id", e.target.value.toLowerCase())} placeholder="e.g. grace-ring-ii" /></Field>
          )}
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            <label className="check"><input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} /> Visible in the shop</label>
            <label className="check"><input type="checkbox" checked={f.isNew} onChange={(e) => set("isNew", e.target.checked)} /> Mark as new</label>
          </div>
        </div>
      </div>

      <div className="sticky-save">
        <button type="button" className="btn" onClick={() => nav("/products")}>Cancel</button>
        <button className="btn primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create product"}</button>
      </div>
    </form>
  );
}
