-- =============================================================================
-- Atelier Boutique POS - Esquema Relacional MariaDB (InnoDB / utf8mb4)
-- =============================================================================
-- Script DDL 100% compatible con MariaDB 10.6+ / 10.11 LTS / 11.x.
-- Motor: InnoDB | Codificación: utf8mb4 / utf8mb4_unicode_ci
-- Paridad 1:1 con src/types/boutique.ts y RestApiAdapter.
-- NOTA: Sin datos de prueba ni semillas iniciales (arranque limpio).
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';
SET FOREIGN_KEY_CHECKS = 1;

-- -----------------------------------------------------------------------------
-- 1. Sucursales (branches)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(80) NOT NULL,
  city VARCHAR(80) NOT NULL DEFAULT '',
  address VARCHAR(200) NOT NULL DEFAULT '',
  phone VARCHAR(32) NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_branches_active_sort (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 2. Usuarios y Permisos Granulares (users)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) NOT NULL,
  nombre_completo VARCHAR(120) NOT NULL,
  usuario VARCHAR(64) NOT NULL,
  pin_hash CHAR(64) NOT NULL,
  rol VARCHAR(16) NOT NULL,
  sucursal_asignada VARCHAR(64) NOT NULL,
  permisos JSON NOT NULL,
  modo_oscuro BOOLEAN NOT NULL DEFAULT FALSE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  operating_scope VARCHAR(64) NOT NULL DEFAULT 'general',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  last_login_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_usuario (usuario),
  INDEX idx_users_sucursal_asignada (sucursal_asignada),
  INDEX idx_users_activo_rol (activo, rol),
  CONSTRAINT chk_users_rol CHECK (rol IN ('admin', 'vendedor')),
  CONSTRAINT chk_users_permisos_json CHECK (JSON_VALID(permisos)),
  CONSTRAINT fk_users_branch FOREIGN KEY (sucursal_asignada)
    REFERENCES branches (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. Identidad de Empresa / Branding (branding_settings)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branding_settings (
  id VARCHAR(32) NOT NULL DEFAULT 'branding',
  company_name VARCHAR(80) NOT NULL DEFAULT 'Atelier Aurelia',
  company_logo_url MEDIUMTEXT NOT NULL,
  updated_by_uid VARCHAR(64) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_branding_updated_by FOREIGN KEY (updated_by_uid)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 4. Categorías de Catálogo (categories)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(64) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  updated_by_uid VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_name (name),
  INDEX idx_categories_sort (sort_order, name),
  CONSTRAINT fk_categories_updated_by FOREIGN KEY (updated_by_uid)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 5. Productos / Catálogo Maestro (products)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(64) NOT NULL,
  sku VARCHAR(64) NOT NULL,
  barcode_sku VARCHAR(64) NOT NULL,
  codigo_modelo VARCHAR(64) NOT NULL DEFAULT '',
  codigo_actual VARCHAR(64) NOT NULL DEFAULT '',
  name VARCHAR(140) NOT NULL,
  category_id VARCHAR(64) NULL,
  category_name VARCHAR(64) NOT NULL,
  size VARCHAR(32) NOT NULL DEFAULT 'Única',
  color VARCHAR(48) NOT NULL DEFAULT '',
  marca VARCHAR(64) NOT NULL DEFAULT '',
  especificaciones VARCHAR(240) NOT NULL DEFAULT '',
  estatus_original VARCHAR(64) NOT NULL DEFAULT '',
  costo_referencia DECIMAL(12, 2) NULL,
  price DECIMAL(12, 2) NOT NULL,
  extra_attributes JSON NULL,
  created_by_uid VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_sku (sku),
  UNIQUE KEY uq_products_barcode_sku (barcode_sku),
  INDEX idx_products_barcode_sku (barcode_sku),
  INDEX idx_products_category_name (category_name),
  INDEX idx_products_name (name),
  INDEX idx_products_codigo_modelo (codigo_modelo),
  CONSTRAINT chk_products_costo_ref CHECK (costo_referencia IS NULL OR costo_referencia >= 0),
  CONSTRAINT chk_products_price CHECK (price >= 0),
  CONSTRAINT chk_products_extra_json CHECK (extra_attributes IS NULL OR JSON_VALID(extra_attributes)),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id)
    REFERENCES categories (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_products_created_by FOREIGN KEY (created_by_uid)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 6. Inventario por Sucursal (branch_inventory)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branch_inventory (
  product_id VARCHAR(64) NOT NULL,
  branch_id VARCHAR(64) NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (product_id, branch_id),
  INDEX idx_branch_inventory_branch_id (branch_id, quantity),
  CONSTRAINT chk_branch_inventory_qty CHECK (quantity >= 0),
  CONSTRAINT fk_branch_inventory_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_branch_inventory_branch FOREIGN KEY (branch_id)
    REFERENCES branches (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 7. Clientes y Datos Fiscales CRM (customers)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(64) NOT NULL,
  nombre_completo VARCHAR(120) NOT NULL,
  telefono VARCHAR(32) NOT NULL DEFAULT '',
  email VARCHAR(120) NOT NULL DEFAULT '',
  fecha_evento VARCHAR(20) NOT NULL DEFAULT '',
  notas VARCHAR(500) NOT NULL DEFAULT '',
  rfc VARCHAR(16) NOT NULL DEFAULT '',
  razon_social VARCHAR(160) NOT NULL DEFAULT '',
  codigo_postal VARCHAR(10) NOT NULL DEFAULT '',
  regimen_fiscal VARCHAR(100) NOT NULL DEFAULT '',
  uso_cfdi VARCHAR(100) NOT NULL DEFAULT '',
  extra_attributes JSON NULL,
  created_by_uid VARCHAR(64) NULL,
  created_by_name VARCHAR(120) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_customers_nombre (nombre_completo),
  INDEX idx_customers_telefono (telefono),
  INDEX idx_customers_rfc (rfc),
  CONSTRAINT chk_customers_extra_json CHECK (extra_attributes IS NULL OR JSON_VALID(extra_attributes)),
  CONSTRAINT fk_customers_created_by FOREIGN KEY (created_by_uid)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 8. Contadores de Folios Atómicos por Sucursal (folio_counters)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS folio_counters (
  counter_key VARCHAR(96) NOT NULL,
  branch_id VARCHAR(64) NULL,
  last_sequence INT NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (counter_key),
  INDEX idx_folio_counters_branch_id (branch_id),
  CONSTRAINT chk_folio_counters_seq CHECK (last_sequence >= 0),
  CONSTRAINT fk_folio_counters_branch FOREIGN KEY (branch_id)
    REFERENCES branches (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 9. Ventas Directas POS (sales)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
  id VARCHAR(64) NOT NULL,
  folio VARCHAR(48) NOT NULL,
  branch_id VARCHAR(64) NOT NULL,
  branch_name VARCHAR(80) NOT NULL,
  seller_uid VARCHAR(64) NULL,
  seller_name VARCHAR(120) NOT NULL,
  seller_usuario VARCHAR(64) NOT NULL DEFAULT '',
  customer_id VARCHAR(64) NULL,
  customer_name VARCHAR(120) NOT NULL DEFAULT '',
  subtotal DECIMAL(12, 2) NOT NULL,
  discount_type VARCHAR(16) NOT NULL DEFAULT 'none',
  discount_value DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  total DECIMAL(12, 2) NOT NULL,
  payment_method VARCHAR(24) NOT NULL,
  cash_received DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  change_given DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  card_reference VARCHAR(64) NOT NULL DEFAULT '',
  transfer_reference VARCHAR(64) NOT NULL DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'completada',
  cancelled_at DATETIME(3) NULL,
  cancelled_by_uid VARCHAR(64) NULL,
  cancelled_by_name VARCHAR(120) NULL,
  cancellation_reason VARCHAR(300) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sales_folio (folio),
  INDEX idx_sales_folio (folio),
  INDEX idx_sales_branch_id_created (branch_id, created_at),
  INDEX idx_sales_branch_status_created (branch_id, status, created_at),
  INDEX idx_sales_customer_id (customer_id),
  CONSTRAINT chk_sales_subtotal CHECK (subtotal >= 0),
  CONSTRAINT chk_sales_discount_type CHECK (discount_type IN ('none', 'fixed', 'percent')),
  CONSTRAINT chk_sales_discount_value CHECK (discount_value >= 0),
  CONSTRAINT chk_sales_discount_amount CHECK (discount_amount >= 0),
  CONSTRAINT chk_sales_total CHECK (total >= 0),
  CONSTRAINT chk_sales_payment_method CHECK (payment_method IN ('Efectivo', 'Tarjeta', 'Transferencia')),
  CONSTRAINT chk_sales_cash_received CHECK (cash_received >= 0),
  CONSTRAINT chk_sales_change_given CHECK (change_given >= 0),
  CONSTRAINT chk_sales_status CHECK (status IN ('completada', 'cancelada')),
  CONSTRAINT fk_sales_branch FOREIGN KEY (branch_id)
    REFERENCES branches (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_sales_seller FOREIGN KEY (seller_uid)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_sales_customer FOREIGN KEY (customer_id)
    REFERENCES customers (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_sales_cancelled_by FOREIGN KEY (cancelled_by_uid)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 10. Detalle de Artículos por Venta (sale_items)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sale_id VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NULL,
  sku VARCHAR(64) NOT NULL,
  name VARCHAR(140) NOT NULL,
  size VARCHAR(32) NOT NULL DEFAULT 'Única',
  color VARCHAR(48) NOT NULL DEFAULT '',
  unit_price DECIMAL(12, 2) NOT NULL,
  quantity INT NOT NULL,
  line_total DECIMAL(12, 2) NOT NULL,
  PRIMARY KEY (id),
  INDEX idx_sale_items_sale_id (sale_id),
  INDEX idx_sale_items_product_id (product_id),
  INDEX idx_sale_items_sku (sku),
  CONSTRAINT chk_sale_items_unit_price CHECK (unit_price >= 0),
  CONSTRAINT chk_sale_items_qty CHECK (quantity > 0),
  CONSTRAINT chk_sale_items_line_total CHECK (line_total >= 0),
  CONSTRAINT fk_sale_items_sale FOREIGN KEY (sale_id)
    REFERENCES sales (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_sale_items_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 11. Apartados de Mercancía (layaways)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS layaways (
  id VARCHAR(64) NOT NULL,
  folio VARCHAR(48) NOT NULL,
  branch_id VARCHAR(64) NOT NULL,
  branch_name VARCHAR(80) NOT NULL,
  customer_id VARCHAR(64) NOT NULL,
  customer_name VARCHAR(120) NOT NULL,
  customer_phone VARCHAR(32) NOT NULL DEFAULT '',
  seller_uid VARCHAR(64) NULL,
  seller_name VARCHAR(120) NOT NULL,
  seller_usuario VARCHAR(64) NOT NULL DEFAULT '',
  total DECIMAL(12, 2) NOT NULL,
  total_paid DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  remaining_balance DECIMAL(12, 2) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'activo',
  notes VARCHAR(400) NOT NULL DEFAULT '',
  settled_at DATETIME(3) NULL,
  delivered_at DATETIME(3) NULL,
  delivered_by_uid VARCHAR(64) NULL,
  delivered_by_name VARCHAR(120) NULL,
  cancelled_at DATETIME(3) NULL,
  cancelled_by_uid VARCHAR(64) NULL,
  cancelled_by_name VARCHAR(120) NULL,
  cancellation_reason VARCHAR(300) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_layaways_folio (folio),
  INDEX idx_layaways_folio (folio),
  INDEX idx_layaways_branch_status_created (branch_id, status, created_at),
  INDEX idx_layaways_customer_created (customer_id, created_at),
  CONSTRAINT chk_layaways_total CHECK (total >= 0),
  CONSTRAINT chk_layaways_total_paid CHECK (total_paid >= 0),
  CONSTRAINT chk_layaways_remaining CHECK (remaining_balance >= 0),
  CONSTRAINT chk_layaways_status CHECK (status IN ('activo', 'liquidado', 'entregado', 'cancelado')),
  CONSTRAINT fk_layaways_branch FOREIGN KEY (branch_id)
    REFERENCES branches (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_layaways_customer FOREIGN KEY (customer_id)
    REFERENCES customers (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_layaways_seller FOREIGN KEY (seller_uid)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_layaways_delivered_by FOREIGN KEY (delivered_by_uid)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_layaways_cancelled_by FOREIGN KEY (cancelled_by_uid)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 12. Detalle de Artículos por Apartado (layaway_items)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS layaway_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  layaway_id VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NULL,
  sku VARCHAR(64) NOT NULL,
  name VARCHAR(140) NOT NULL,
  size VARCHAR(32) NOT NULL DEFAULT 'Única',
  color VARCHAR(48) NOT NULL DEFAULT '',
  unit_price DECIMAL(12, 2) NOT NULL,
  quantity INT NOT NULL,
  line_total DECIMAL(12, 2) NOT NULL,
  PRIMARY KEY (id),
  INDEX idx_layaway_items_layaway_id (layaway_id),
  INDEX idx_layaway_items_product_id (product_id),
  INDEX idx_layaway_items_sku (sku),
  CONSTRAINT chk_layaway_items_unit_price CHECK (unit_price >= 0),
  CONSTRAINT chk_layaway_items_qty CHECK (quantity > 0),
  CONSTRAINT chk_layaway_items_line_total CHECK (line_total >= 0),
  CONSTRAINT fk_layaway_items_layaway FOREIGN KEY (layaway_id)
    REFERENCES layaways (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_layaway_items_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 13. Abonos Libres a Apartados (layaway_payments)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS layaway_payments (
  id VARCHAR(64) NOT NULL,
  receipt_folio VARCHAR(48) NOT NULL,
  layaway_id VARCHAR(64) NOT NULL,
  layaway_folio VARCHAR(48) NOT NULL,
  branch_id VARCHAR(64) NOT NULL,
  branch_name VARCHAR(80) NOT NULL,
  customer_id VARCHAR(64) NOT NULL,
  customer_name VARCHAR(120) NOT NULL,
  seller_uid VARCHAR(64) NULL,
  seller_name VARCHAR(120) NOT NULL,
  seller_usuario VARCHAR(64) NOT NULL DEFAULT '',
  amount DECIMAL(12, 2) NOT NULL,
  payment_method VARCHAR(24) NOT NULL,
  cash_received DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  change_given DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  reference VARCHAR(64) NOT NULL DEFAULT '',
  balance_before DECIMAL(12, 2) NOT NULL,
  balance_after DECIMAL(12, 2) NOT NULL,
  is_initial_deposit BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_layaway_payments_receipt_folio (receipt_folio),
  INDEX idx_layaway_payments_layaway_id (layaway_id, created_at),
  INDEX idx_layaway_payments_layaway_folio (layaway_folio),
  INDEX idx_layaway_payments_branch_created (branch_id, created_at),
  CONSTRAINT chk_layaway_payments_amount CHECK (amount > 0),
  CONSTRAINT chk_layaway_payments_method CHECK (payment_method IN ('Efectivo', 'Tarjeta', 'Transferencia')),
  CONSTRAINT chk_layaway_payments_cash_rx CHECK (cash_received >= 0),
  CONSTRAINT chk_layaway_payments_change CHECK (change_given >= 0),
  CONSTRAINT chk_layaway_payments_bal_before CHECK (balance_before >= 0),
  CONSTRAINT chk_layaway_payments_bal_after CHECK (balance_after >= 0),
  CONSTRAINT fk_layaway_payments_layaway FOREIGN KEY (layaway_id)
    REFERENCES layaways (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_layaway_payments_branch FOREIGN KEY (branch_id)
    REFERENCES branches (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_layaway_payments_customer FOREIGN KEY (customer_id)
    REFERENCES customers (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_layaway_payments_seller FOREIGN KEY (seller_uid)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 14. Aperturas y Cierres / Cortes de Caja (cash_closures)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_closures (
  id VARCHAR(64) NOT NULL,
  folio VARCHAR(48) NOT NULL,
  branch_id VARCHAR(64) NOT NULL,
  branch_name VARCHAR(80) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  opening_fund DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  opened_by_uid VARCHAR(64) NULL,
  opened_by_name VARCHAR(120) NOT NULL,
  opened_by_usuario VARCHAR(64) NOT NULL DEFAULT '',
  opened_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  closed_by_uid VARCHAR(64) NULL,
  closed_by_name VARCHAR(120) NULL,
  closed_by_usuario VARCHAR(64) NULL,
  closed_at DATETIME(3) NULL,
  direct_sales_count INT NOT NULL DEFAULT 0,
  direct_sales_cash DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  direct_sales_card DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  direct_sales_transfer DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  direct_sales_total DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  layaway_payments_count INT NOT NULL DEFAULT 0,
  layaway_cash DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  layaway_card DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  layaway_transfer DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  layaway_total DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  expected_cash_total DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  total_card DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  total_transfer DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  grand_total_income DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  counted_cash DECIMAL(12, 2) NULL,
  difference DECIMAL(12, 2) NULL,
  observations VARCHAR(500) NOT NULL DEFAULT '',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_cash_closures_folio (folio),
  INDEX idx_cash_closures_folio (folio),
  INDEX idx_cash_closures_branch_status_opened (branch_id, status, opened_at),
  CONSTRAINT chk_cash_closures_status CHECK (status IN ('open', 'closed')),
  CONSTRAINT chk_cash_closures_opening_fund CHECK (opening_fund >= 0),
  CONSTRAINT fk_cash_closures_branch FOREIGN KEY (branch_id)
    REFERENCES branches (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_cash_closures_opened_by FOREIGN KEY (opened_by_uid)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_cash_closures_closed_by FOREIGN KEY (closed_by_uid)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 15. Bitácora de Auditoría (audit_logs)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) NOT NULL,
  user_uid VARCHAR(64) NULL,
  user_name VARCHAR(120) NOT NULL,
  user_usuario VARCHAR(64) NOT NULL DEFAULT '',
  branch_id VARCHAR(64) NOT NULL,
  branch_name VARCHAR(80) NOT NULL,
  action_type VARCHAR(48) NOT NULL,
  description VARCHAR(600) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_audit_logs_created_at (created_at),
  INDEX idx_audit_logs_branch_action_created (branch_id, action_type, created_at),
  INDEX idx_audit_logs_user_created (user_uid, created_at),
  CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_uid)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
