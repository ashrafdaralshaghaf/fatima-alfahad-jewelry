import { query } from "../db.js";
import { getRates } from "./common.js";

/** Shape the storefront already uses: P (products), COLS, CATS plus the exchange rates. */
export async function publicCatalog() {
  const [cats, cols, prods, imgs, rates] = await Promise.all([
    query(`SELECT * FROM categories WHERE is_active ORDER BY sort_order, slug`),
    query(`SELECT * FROM collections WHERE is_active ORDER BY sort_order, slug`),
    query(`SELECT p.* FROM products p
             JOIN categories c ON c.slug = p.category AND c.is_active
            WHERE p.is_active ORDER BY p.sort_order, p.created_at DESC`),
    query(`SELECT product_id, url FROM product_images ORDER BY product_id, sort_order, id`),
    getRates(),
  ]);

  const byProduct = new Map();
  for (const i of imgs.rows) (byProduct.get(i.product_id) ?? byProduct.set(i.product_id, []).get(i.product_id)).push(i.url);
  const activeCols = new Set(cols.rows.map((c) => c.slug));

  return {
    rates,
    cats: Object.fromEntries(cats.rows.map((c) => [c.slug, {
      en: c.name_en, ar: c.name_ar, img: c.image,
      sizeKind: c.size_kind, sizes: c.sizes, defaultSize: c.default_size, engravable: c.engravable,
    }])),
    cols: Object.fromEntries(cols.rows.map((c) => [c.slug, {
      img: c.image,
      name: { en: c.name_en, ar: c.name_ar },
      tag: { en: c.tag_en, ar: c.tag_ar },
      desc: { en: c.desc_en, ar: c.desc_ar },
    }])),
    products: prods.rows.map((p) => ({
      id: p.id,
      cat: p.category,
      col: p.collection && activeCols.has(p.collection) ? p.collection : null,
      price: p.price_kwd,
      natural: p.natural_price_kwd,
      imgs: byProduct.get(p.id) ?? [],
      name: { en: p.name_en, ar: p.name_ar },
      story: { en: p.story_en, ar: p.story_ar },
      metal: { en: p.metal_en, ar: p.metal_ar },
      stone: { en: p.stone_en, ar: p.stone_ar },
      isNew: p.is_new,
      soldOut: p.stock !== null && p.stock <= 0,
    })),
  };
}
