// Loads the catalog that was hard-coded in the original index.html into PostgreSQL.
// Safe to run more than once: existing rows are left untouched.
import { migrate, pool, tx } from "../src/db.js";

const CATS = [
  ["rings", "Rings", "خواتم", "wg-kite", "ring", [48, 50, 52, 54, 56, 58], null, true],
  ["earrings", "Earrings", "حلق", "wg-studs", null, [], null, false],
  ["necklaces", "Necklaces", "عقد", "wg-tennis", "length", [40, 45], 45, true],
  ["bracelets", "Bracelets", "أساور", "wg-tbrace", null, [], null, true],
];
const COLS = [
  ["grace", "Grace", "جريس", "Champagne gold, clean lines.", "ذهب شمبانيا وخطوط نقية.", "Step cut stones on clean champagne gold.", "قَصّات متدرجة على ذهب شمبانيا نقي.", "wg-tennis"],
  ["wild", "Wild", "وايلد", "Matte black, sharp geometry.", "أسود مطفي وهندسة حادة.", "The cheetah's instinct, kept clean and architectural.", "غريزة الفهد، بخطوط نقية ومعمارية.", "wg-pear"],
];
const CG = ["18K champagne gold", "ذهب شمبانيا عيار 18"];
const BK = ["Matte black and champagne gold", "أسود مطفي وذهب شمبانيا"];
// id, category, collection, price, natural, image, nameEn, nameAr, storyEn, storyAr, metal, stoneEn, stoneAr
const PRODUCTS = [
  ["grace-line", "necklaces", "grace", 380, 1150, "wg-line", "Grace Line I", "قلادة جريس لاين", "A single row of light resting at the throat.", "صفّ واحد من الضوء يستقر عند العنق.", CG, "Pear step cut, prong set", "قَصّة كمثرية متدرجة، ترصيع بالمخالب"],
  ["tennis-necklace", "necklaces", "grace", 890, 2950, "wg-tennis", "Tennis · Three Cuts", "قلادة التنس بثلاث قَصّات", "Step cuts reclining in one horizontal line.", "قَصّات متدرجة تستلقي في خط أفقي واحد.", CG, "Emerald, marquise and hexagon step cuts", "قَصّات زمردية وماركيز وسداسية"],
  ["wild-collar", "necklaces", "wild", 520, 1480, "wg-collar", "Wild Collar", "طوق وايلد", "A graphic collar built from pure geometry.", "طوق جرافيكي من هندسة خالصة.", BK, "Emerald step cut", "قَصّة زمردية متدرجة"],
  ["toi-et-moi", "rings", "grace", 640, 2380, "wg-toi", "Hexagon · Toi et Moi", "خاتم توا إي موا", "Two step cuts in quiet conversation.", "قَصّتان متدرجتان في حوار هادئ.", CG, "Hexagon step cuts, prong set", "قَصّات سداسية متدرجة، ترصيع بالمخالب"],
  ["hexagon-kite", "rings", "grace", 590, 2190, "wg-kite", "Hexagon and Kite", "خاتم السداسي والمعيّن", "Two step cut geometries set side by side.", "هندستان متدرجتان جنبًا إلى جنب.", CG, "Hexagon and kite step cuts", "قَصّة سداسية ومعيّنة متدرجة"],
  ["black-shank", "rings", "wild", 560, 2050, "wg-shank", "Hexagon · Black Shank", "خاتم السداسي الأسود", "A luminous stone on a graphic dark band.", "حجر مضيء على حلقة داكنة.", BK, "Hexagon step cut", "قَصّة سداسية متدرجة"],
  ["rhombus-studs", "earrings", "grace", 260, 790, "wg-studs", "Hexagon and Rhombus Studs", "أقراط السداسي والمعيّن", "Two step cut geometries paired at the lobe.", "هندستان متدرجتان معًا على شحمة الأذن.", CG, "Hexagon and kite step cuts", "قَصّة سداسية ومعيّنة متدرجة"],
  ["ear-climber", "earrings", "grace", 310, 980, "wg-climber", "Ear Climber", "القرط المتسلّق", "A rising line of step cuts along the ear.", "خط صاعد من القَصّات المتدرجة على طول الأذن.", CG, "Step cut and marquise", "قَصّات متدرجة وماركيز"],
  ["tennis-bracelet", "bracelets", "grace", 720, 2400, "wg-tbrace", "Tennis Bracelet · Three Cuts", "سوار التنس بثلاث قَصّات", "Reclining step cuts in one continuous line.", "قَصّات متدرجة مستلقية في خط واحد متصل.", CG, "Emerald, marquise and hexagon step cuts", "قَصّات زمردية وماركيز وسداسية"],
  ["toi-bracelet", "bracelets", "grace", 480, 1650, "wg-tbangle", "Toi et Moi Bracelet", "سوار توا إي موا", "Two step cut stones meeting on an open band.", "حجران بقَصّة متدرجة يلتقيان على سوار مفتوح.", CG, "Emerald and marquise step cuts", "قَصّة زمردية وماركيز متدرجة"],
  ["wild-pear", "earrings", "wild", 690, 2600, "wg-pear", "Pear · Black Frame", "أقراط الكمثرى السوداء", "A clean drop framed in matte black.", "قطرة نقية بإطار أسود مطفي.", BK, "Pear step cut, prong set", "قَصّة كمثرية متدرجة، ترصيع بالمخالب"],
];

await migrate(() => {});
await tx(async (c) => {
  for (const [i, k] of CATS.entries())
    await c.query(
      `INSERT INTO categories (slug, name_en, name_ar, image, sort_order, size_kind, sizes, default_size, engravable)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [k[0], k[1], k[2], `/a/${k[3]}.webp`, i * 10, k[4], k[5], k[6], k[7]]);
  for (const [i, k] of COLS.entries())
    await c.query(
      `INSERT INTO collections (slug, name_en, name_ar, tag_en, tag_ar, desc_en, desc_ar, image, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [k[0], k[1], k[2], k[3], k[4], k[5], k[6], `/a/${k[7]}.webp`, i * 10]);
  for (const [i, p] of PRODUCTS.entries()) {
    const r = await c.query(
      `INSERT INTO products (id, category, collection, price_kwd, natural_price_kwd, name_en, name_ar, story_en, story_ar,
         metal_en, metal_ar, stone_en, stone_ar, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`,
      [p[0], p[1], p[2], p[3], p[4], p[6], p[7], p[8], p[9], p[10][0], p[10][1], p[11], p[12], i * 10]);
    if (r.rowCount) {
      await c.query(`INSERT INTO product_images (product_id, url, sort_order) VALUES ($1,$2,0),($1,'/a/boxes.webp',1)`, [p[0], `/a/${p[5]}.webp`]);
    }
  }
});
console.log(`Seeded ${CATS.length} categories, ${COLS.length} collections, ${PRODUCTS.length} products.`);
await pool.end();
