import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, kwd } from "../api.js";
import { Badge, Confirm, PageHead, Pager, useDebounced, useLoad, useToast } from "../ui.jsx";

export default function Products() {
  const nav = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [del, setDel] = useState(null);
  const dq = useDebounced(q);
  const cats = useLoad(() => api("/categories"), []);
  const { data, loading, reload } = useLoad(
    () => api(`/products?page=${page}&limit=25&q=${encodeURIComponent(dq)}&category=${category}&status=${status}`),
    [page, dq, category, status],
  );

  async function toggle(p) {
    try {
      await api(`/products/${p.id}/active`, { method: "PATCH", body: { isActive: !p.isActive } });
      toast(p.isActive ? "Hidden from the storefront" : "Now visible on the storefront");
      reload();
    } catch (e) { toast(e.message, "err"); }
  }
  async function remove() {
    try { await api(`/products/${del.id}`, { method: "DELETE" }); toast("Product deleted"); setDel(null); reload(); }
    catch (e) { toast(e.message, "err"); }
  }

  return (
    <>
      <PageHead title="Products" sub="Everything that appears in the shop">
        <Link className="btn primary" to="/products/new">+ New product</Link>
      </PageHead>
      <div className="toolbar">
        <input className="input" placeholder="Search name or ID…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search products" />
        <select className="select" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label="Category">
          <option value="">All categories</option>
          {cats.data?.items.map((c) => <option key={c.slug} value={c.slug}>{c.name.en}</option>)}
        </select>
        <select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
          <option value="">Any status</option><option value="active">Visible</option><option value="hidden">Hidden</option>
        </select>
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th></th><th>Piece</th><th>Category</th><th className="right">Lab price</th><th className="right">Natural</th><th>Stock</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {data?.items.map((p) => (
              <tr key={p.id} className="click" onClick={() => nav(`/products/${p.id}`)}>
                <td style={{ width: 70 }}>{p.image ? <img className="thumb" src={p.image} alt="" /> : <div className="thumb" />}</td>
                <td><b style={{ fontWeight: 400, color: "var(--gold-light)" }}>{p.name.en}</b><div className="muted" dir="rtl" style={{ textAlign: "left" }}>{p.name.ar}</div></td>
                <td>{p.category}{p.collection && <span className="muted"> · {p.collection}</span>}</td>
                <td className="right mono">{kwd(p.price)}</td>
                <td className="right mono">{p.natural != null ? kwd(p.natural) : "—"}</td>
                <td>{p.stock == null ? <span className="muted">Made to order</span> : p.stock <= 2 ? <span className="badge warn">{p.stock} left</span> : p.stock}</td>
                <td>{p.isActive ? <span className="badge ok">Visible</span> : <Badge value="hidden" />}{p.isNew && <span className="badge info" style={{ marginLeft: 6 }}>New</span>}</td>
                <td className="right" onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                  <button className="btn sm" onClick={() => toggle(p)}>{p.isActive ? "Hide" : "Show"}</button>{" "}
                  <button className="btn sm danger" onClick={() => setDel(p)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && data?.items.length === 0 && <div className="empty">No products match.</div>}
      </div>
      {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
      {del && (
        <Confirm danger title="Delete product?" confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={remove}
          body={<>“{del.name.en}” will be removed permanently. Past orders keep their own copy of the details. To only take it off the shop, use <b>Hide</b> instead.</>} />
      )}
    </>
  );
}
