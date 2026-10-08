import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api, authApi, setUnauthorizedHandler } from "./api.js";
import { ToastProvider } from "./ui.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Products from "./pages/Products.jsx";
import ProductEdit from "./pages/ProductEdit.jsx";
import Taxonomy from "./pages/Taxonomy.jsx";
import Orders from "./pages/Orders.jsx";
import OrderDetail from "./pages/OrderDetail.jsx";
import Customers from "./pages/Customers.jsx";
import { Appointments, Bespoke } from "./pages/Requests.jsx";
import Subscribers from "./pages/Subscribers.jsx";
import Settings from "./pages/Settings.jsx";

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    authApi("/me").then((r) => setUser(r.user?.role === "admin" ? r.user : null)).catch(() => setUser(null));
  }, []);

  if (user === undefined) return <div className="spin">Loading…</div>;
  return (
    <ToastProvider>
      {user ? <Shell user={user} onSignOut={() => setUser(null)} /> : <Login onLogin={setUser} />}
    </ToastProvider>
  );
}

function Shell({ user, onSignOut }) {
  const [open, setOpen] = useState(false);
  const [badges, setBadges] = useState({});
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    api("/stats").then((s) => setBadges({
      orders: s.byStatus.pending || 0, appointments: s.counts.appointments_new, bespoke: s.counts.bespoke_new,
    })).catch(() => {});
  }, [loc.pathname]);

  const signOut = async () => { await authApi("/logout", { method: "POST" }).catch(() => {}); onSignOut(); };
  const Item = ({ to, children, n }) => (
    <NavLink to={to} end={to === "/"}>{children}{n > 0 && <span className="pill">{n}</span>}</NavLink>
  );

  return (
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`side ${open ? "open" : ""}`}>
        <div className="brand"><i /><b>Fatima Alfahad<br />Dashboard</b></div>
        <nav className="nav" aria-label="Main">
          <Item to="/">Overview</Item>
          <h4>Sales</h4>
          <Item to="/orders" n={badges.orders}>Orders</Item>
          <Item to="/customers">Customers</Item>
          <h4>Catalog</h4>
          <Item to="/products">Products</Item>
          <Item to="/categories">Categories</Item>
          <Item to="/collections">Collections</Item>
          <h4>Clients</h4>
          <Item to="/appointments" n={badges.appointments}>Appointments</Item>
          <Item to="/bespoke" n={badges.bespoke}>Bespoke requests</Item>
          <Item to="/subscribers">Newsletter</Item>
          <h4>Store</h4>
          <Item to="/settings">Settings & security</Item>
        </nav>
        <div className="me">
          <b title={user.email}>{user.fullName}</b>
          <span className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</span>
          <a className="btn sm" href="/" target="_blank" rel="noreferrer">View storefront ↗</a>
          <button className="btn sm" onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        <button className="btn sm menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">☰ Menu</button>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/new" element={<ProductEdit />} />
          <Route path="/products/:id" element={<ProductEdit />} />
          <Route path="/categories" element={<Taxonomy kind="categories" />} />
          <Route path="/collections" element={<Taxonomy kind="collections" />} />
          <Route path="/appointments" element={<Appointments />} />
          <Route path="/bespoke" element={<Bespoke />} />
          <Route path="/subscribers" element={<Subscribers />} />
          <Route path="/settings" element={<Settings user={user} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
