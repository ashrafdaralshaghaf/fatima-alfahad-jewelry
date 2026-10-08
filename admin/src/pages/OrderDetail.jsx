import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, d0, dt, kwd, label, waLink } from "../api.js";
import { Badge, Confirm, Field, PageHead, useLoad, useToast } from "../ui.jsx";
import { ORDER_STATUS, PAY_STATUS } from "./Orders.jsx";

export default function OrderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data, loading, reload } = useLoad(() => api(`/orders/${id}`), [id]);
  const [status, setStatus] = useState("");
  const [pay, setPay] = useState("");
  const [ref, setRef] = useState("");
  const [notes, setNotes] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!data) return;
    setStatus(data.order.status); setPay(data.order.payment_status);
    setRef(data.order.payment_ref || ""); setNotes(data.order.admin_notes || ""); setNote("");
  }, [data]);

  if (loading && !data) return <div className="spin">Loading…</div>;
  if (!data) return null;
  const { order: o, items, events } = data;
  const changedStatus = status !== o.status;

  async function save() {
    setBusy(true);
    try {
      await api(`/orders/${id}`, { method: "PATCH", body: {
        ...(status !== o.status ? { status } : {}),
        ...(pay !== o.payment_status ? { paymentStatus: pay } : {}),
        paymentRef: ref, adminNotes: notes, ...(note ? { note } : {}),
      } });
      toast("Order updated" + (changedStatus && !["pending", "refunded"].includes(status) ? " · customer notified by e-mail" : ""));
      setConfirm(false); reload();
    } catch (e) { toast(e.message, "err"); setConfirm(false); }
    setBusy(false);
  }
  const dirty = changedStatus || pay !== o.payment_status || ref !== (o.payment_ref || "") || notes !== (o.admin_notes || "") || !!note;
  const submit = () => (["cancelled", "refunded"].includes(status) && changedStatus ? setConfirm(true) : save());

  return (
    <>
      <PageHead title={o.order_no} sub={`Placed ${dt(o.created_at)}`}>
        <button className="btn" onClick={() => nav("/orders")}>← Orders</button>
      </PageHead>
      <div className="cols">
        <div>
          <div className="panel">
            <h2>Pieces</h2>
            <div className="tablewrap" style={{ border: 0 }}>
              <table>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td style={{ width: 70 }}>{i.image ? <img className="thumb" src={i.image} alt="" /> : <div className="thumb" />}</td>
                      <td>
                        {i.product_id ? <Link to={`/products/${i.product_id}`}>{i.name_en}</Link> : i.name_en} <span className="muted">× {i.qty}</span>
                        <div className="muted">
                          {[i.diamond && `${label(i.diamond)} diamond`, i.size && `Size ${i.size}`, i.engraving && `Engraving “${i.engraving}”`, i.gift_wrap && "Gift wrapped"].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className="right mono">{kwd(i.unit_price_kwd * i.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="list" style={{ marginTop: 10 }}>
              <div><span>Subtotal</span><span className="mono">{kwd(o.subtotal_kwd)}</span></div>
              <div><span>Delivery</span><span className="mono">{kwd(o.shipping_kwd)}</span></div>
              <div><b style={{ fontWeight: 400, color: "var(--gold-light)" }}>Total</b><b className="mono" style={{ fontWeight: 400, color: "var(--gold-light)" }}>{kwd(o.total_kwd)}</b></div>
              {o.currency !== "KWD" && <div><span className="muted">Shown to customer as</span><span className="mono">{o.total_display.toLocaleString()} {o.currency}</span></div>}
            </div>
          </div>

          <div className="panel">
            <h2>Customer & delivery</h2>
            <dl className="dl">
              <dt>Name</dt><dd>{o.customer_name}</dd>
              <dt>Email</dt><dd><a href={`mailto:${o.customer_email}`}>{o.customer_email}</a></dd>
              <dt>Mobile</dt><dd><a href={`tel:${o.customer_phone}`}>{o.customer_phone}</a>{" "}<a className="btn sm primary" target="_blank" rel="noreferrer" href={waLink(o.customer_phone, `Hello ${o.customer_name}, this is Fatima Alfahad Jewelry about your order ${o.order_no} (${kwd(o.total_kwd)}). How would you like to arrange payment?`)}>WhatsApp ↗</a></dd>
              <dt>Address</dt><dd>{[o.country, o.area, `Block ${o.block}`, `Street ${o.street}`, o.avenue && `Avenue ${o.avenue}`, `House ${o.house}`].filter(Boolean).join(", ")}</dd>
              <dt>Delivery date</dt><dd>{d0(o.delivery_date)}</dd>
              <dt>Gift message</dt><dd>{o.gift_message || <span className="muted">—</span>}</dd>
              <dt>Language</dt><dd>{o.lang === "ar" ? "Arabic" : "English"}</dd>
              <dt>Account</dt><dd>{o.user_id ? <Link to={`/customers`}>Registered customer</Link> : <span className="muted">Guest checkout</span>}</dd>
            </dl>
          </div>
        </div>

        <div>
          <div className="panel">
            <h2>Manage</h2>
            <div className="stack">
              <div><Badge value={o.status} /> <Badge value={o.payment_status} /> <span className="muted">{o.payment_method.toUpperCase()}</span></div>
              <Field label="Order status">
                <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                  {ORDER_STATUS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </select>
              </Field>
              <Field label="Payment status">
                <select className="select" value={pay} onChange={(e) => setPay(e.target.value)}>
                  {PAY_STATUS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </select>
              </Field>
              <Field label="Payment reference" hint="KNET / card transaction ID"><input className="input" maxLength={120} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
              <Field label="Timeline note" hint="Added to the history when you save."><input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <Field label="Internal notes (never shown to the customer)"><textarea className="textarea" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
              <button className="btn primary" disabled={!dirty || busy} onClick={submit}>{busy ? "Saving…" : "Save changes"}</button>
            </div>
          </div>
          <div className="panel">
            <h2>History</h2>
            <div className="timeline">
              {events.map((e) => (
                <div key={e.id}>
                  <b style={{ fontWeight: 400 }}>{e.kind === "created" ? "Order placed" : e.kind === "status" ? `Status → ${label(e.value)}` : e.kind === "payment" ? `Payment → ${label(e.value)}` : "Note"}</b>
                  {e.note && <div>{e.note}</div>}
                  <small>{dt(e.created_at)}{e.actor ? ` · ${e.actor}` : ""}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {confirm && (
        <Confirm danger title={`Mark as ${status}?`} confirmLabel="Yes, continue" onCancel={() => setConfirm(false)} onConfirm={save}
          body="Reserved stock is returned and the customer receives an e-mail." />
      )}
    </>
  );
}
