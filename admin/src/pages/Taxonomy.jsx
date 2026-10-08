import { useState } from "react";
import { api } from "../api.js";
import { Confirm, Field, ImageManager, PageHead, useLoad, useToast } from "../ui.jsx";

const blankCat = { slug: "", name: { en: "", ar: "" }, image: null, sortOrder: 0, sizeKind: "", sizes: "", defaultSize: "", engravable: true, isActive: true };
const blankCol = { slug: "", name: { en: "", ar: "" }, tag: { en: "", ar: "" }, desc: { en: "", ar: "" }, image: null, sortOrder: 0, isActive: true };

/** One editor for both categories and collections. */
export default function Taxonomy({ kind }) {
  const isCat = kind === "categories";
  const singular = isCat ? "category" : "collection";
  const toast = useToast();
  const { data, loading, reload } = useLoad(() => api(`/${kind}`), [kind]);
  const [edit, setEdit] = useState(null); // form state or null
  const [isNew, setIsNew] = useState(false);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);

  const open = (item) => {
    if (!item) { setIsNew(true); setEdit(isCat ? blankCat : blankCol); return; }
    setIsNew(false);
    setEdit(isCat
      ? { ...item, sizes: item.sizes.join(", "), sizeKind: item.sizeKind || "", defaultSize: item.defaultSize ?? "" }
      : { ...item });
  };
  const setL = (k, lang, v) => setEdit((x) => ({ ...x, [k]: { ...x[k], [lang]: v } }));
  const set = (k, v) => setEdit((x) => ({ ...x, [k]: v }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const common = { name: edit.name, image: edit.image, sortOrder: Number(edit.sortOrder) || 0, isActive: edit.isActive };
    const body = isCat
      ? { ...common, ...(isNew && edit.slug ? { slug: edit.slug } : {}), sizeKind: edit.sizeKind || null,
          sizes: String(edit.sizes).split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n)),
          defaultSize: edit.defaultSize === "" ? null : Number(edit.defaultSize), engravable: edit.engravable }
      : { ...common, ...(isNew && edit.slug ? { slug: edit.slug } : {}), tag: edit.tag, desc: edit.desc };
    try {
      if (isNew) await api(`/${kind}`, { method: "POST", body });
      else await api(`/${kind}/${edit.slug}`, { method: "PUT", body });
      toast("Saved"); setEdit(null); reload();
    } catch (err) { toast(err.message, "err"); }
    setBusy(false);
  }
  async function remove() {
    try { await api(`/${kind}/${del.slug}`, { method: "DELETE" }); toast("Deleted"); setDel(null); reload(); }
    catch (err) { toast(err.message, "err"); setDel(null); }
  }

  return (
    <>
      <PageHead title={isCat ? "Categories" : "Collections"} sub={isCat ? "Rings, earrings… and how customers pick a size" : "Stories that group pieces together"}>
        <button className="btn primary" onClick={() => open(null)}>+ New {singular}</button>
      </PageHead>
      <div className="tablewrap">
        <table>
          <thead><tr><th></th><th>Name</th><th>{isCat ? "Options" : "Tagline"}</th><th>Products</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {data?.items.map((c) => (
              <tr key={c.slug}>
                <td style={{ width: 70 }}>{c.image ? <img className="thumb" src={c.image} alt="" /> : <div className="thumb" />}</td>
                <td><b style={{ fontWeight: 400, color: "var(--gold-light)" }}>{c.name.en}</b> <span className="muted" dir="rtl">· {c.name.ar}</span><div className="muted">{c.slug}</div></td>
                <td className="muted">{isCat
                  ? `${c.sizeKind === "ring" ? "Ring sizes" : c.sizeKind === "length" ? "Lengths" : "No sizes"}${c.sizes.length ? ` (${c.sizes.join(", ")})` : ""} · ${c.engravable ? "Engraving" : "No engraving"}`
                  : c.tag.en}</td>
                <td>{c.products}</td>
                <td>{c.isActive ? <span className="badge ok">Visible</span> : <span className="badge">Hidden</span>}</td>
                <td className="right" style={{ whiteSpace: "nowrap" }}>
                  <button className="btn sm" onClick={() => open(c)}>Edit</button>{" "}
                  <button className="btn sm danger" onClick={() => setDel(c)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && data?.items.length === 0 && <div className="empty">Nothing here yet.</div>}
      </div>

      {edit && (
        <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && setEdit(null)}>
          <form className="modal" style={{ width: "min(680px,100%)", maxHeight: "92vh", overflow: "auto" }} onSubmit={save}>
            <h2>{isNew ? `New ${singular}` : `Edit ${edit.name.en}`}</h2>
            <div className="grid2">
              <Field label="Name (English)"><input className="input" required maxLength={80} value={edit.name.en} onChange={(e) => setL("name", "en", e.target.value)} /></Field>
              <Field label="Name (Arabic)"><input className="input" dir="rtl" required maxLength={80} value={edit.name.ar} onChange={(e) => setL("name", "ar", e.target.value)} /></Field>
            </div>
            {!isCat && (
              <>
                <div className="grid2">
                  <Field label="Tagline (English)"><input className="input" maxLength={200} value={edit.tag.en} onChange={(e) => setL("tag", "en", e.target.value)} /></Field>
                  <Field label="Tagline (Arabic)"><input className="input" dir="rtl" maxLength={200} value={edit.tag.ar} onChange={(e) => setL("tag", "ar", e.target.value)} /></Field>
                </div>
                <div className="grid2">
                  <Field label="Description (English)"><textarea className="textarea" maxLength={400} value={edit.desc.en} onChange={(e) => setL("desc", "en", e.target.value)} /></Field>
                  <Field label="Description (Arabic)"><textarea className="textarea" dir="rtl" maxLength={400} value={edit.desc.ar} onChange={(e) => setL("desc", "ar", e.target.value)} /></Field>
                </div>
              </>
            )}
            {isCat && (
              <>
                <div className="grid3">
                  <Field label="Size selector">
                    <select className="select" value={edit.sizeKind} onChange={(e) => set("sizeKind", e.target.value)}>
                      <option value="">None</option><option value="ring">Ring size (with size guide)</option><option value="length">Length in cm</option>
                    </select>
                  </Field>
                  <Field label="Available sizes" hint="Comma separated, e.g. 48, 50, 52"><input className="input" value={edit.sizes} onChange={(e) => set("sizes", e.target.value)} disabled={!edit.sizeKind} /></Field>
                  <Field label="Default size" hint="Optional"><input className="input" type="number" value={edit.defaultSize} onChange={(e) => set("defaultSize", e.target.value)} disabled={!edit.sizeKind} /></Field>
                </div>
                <label className="check"><input type="checkbox" checked={edit.engravable} onChange={(e) => set("engravable", e.target.checked)} /> Offer free engraving</label>
              </>
            )}
            <div className="grid2">
              <Field label="Sort order"><input className="input" type="number" value={edit.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} /></Field>
              {isNew && <Field label="Slug (optional)" hint="Used in the address. Auto-generated if empty."><input className="input" pattern="[a-z0-9]+(-[a-z0-9]+)*" value={edit.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} /></Field>}
            </div>
            <div><span className="lbl">Cover image</span><div style={{ marginTop: 8 }}><ImageManager single value={edit.image ? [edit.image] : []} onChange={(v) => set("image", v[0] || null)} /></div></div>
            <label className="check"><input type="checkbox" checked={edit.isActive} onChange={(e) => set("isActive", e.target.checked)} /> Visible in the shop</label>
            <div className="actions">
              <button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </div>
      )}
      {del && (
        <Confirm danger title={`Delete ${singular}?`} confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={remove}
          body={isCat ? <>“{del.name.en}” can only be deleted when it has no products.</> : <>“{del.name.en}” will be removed. Its products stay in the shop without a collection.</>} />
      )}
    </>
  );
}
