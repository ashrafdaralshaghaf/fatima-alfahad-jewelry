-- Payment is arranged manually over WhatsApp for now.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check CHECK (payment_method IN ('whatsapp','knet','card'));
ALTER TABLE orders ALTER COLUMN payment_method SET DEFAULT 'whatsapp';
