-- Initial schema for the Hotel Management System (MySQL 8+, InnoDB, utf8mb4)

CREATE TABLE users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','manager','staff') NOT NULL DEFAULT 'staff',
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customers (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(150) NOT NULL,
  phone      VARCHAR(40) NOT NULL,
  email      VARCHAR(190) NULL,
  address    VARCHAR(255) NULL,
  id_number  VARCHAR(60) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_customers_name (name),
  KEY idx_customers_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE rooms (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_number     VARCHAR(20) NOT NULL,
  room_type       VARCHAR(50) NOT NULL,
  price_per_night DECIMAL(12,2) NOT NULL,
  capacity        TINYINT UNSIGNED NOT NULL DEFAULT 2,
  status          ENUM('Available','Occupied','Cleaning','Maintenance') NOT NULL DEFAULT 'Available',
  notes           VARCHAR(255) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rooms_number (room_number),
  KEY idx_rooms_status (status),
  CONSTRAINT chk_rooms_price CHECK (price_per_night >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bookings (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id      INT UNSIGNED NOT NULL,
  room_id          INT UNSIGNED NOT NULL,
  check_in         DATE NOT NULL,
  check_out        DATE NOT NULL,
  guests           TINYINT UNSIGNED NOT NULL DEFAULT 1,
  status           ENUM('Reserved','Checked-In','Checked-Out','Cancelled') NOT NULL DEFAULT 'Reserved',
  price_per_night  DECIMAL(12,2) NOT NULL,
  total_amount     DECIMAL(12,2) NOT NULL,
  notes            VARCHAR(500) NULL,
  actual_check_in  DATETIME NULL,
  actual_check_out DATETIME NULL,
  created_by       INT UNSIGNED NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bookings_room_dates (room_id, check_in, check_out),
  KEY idx_bookings_customer (customer_id),
  KEY idx_bookings_status (status),
  KEY idx_bookings_check_in (check_in),
  KEY idx_bookings_check_out (check_out),
  CONSTRAINT fk_bookings_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_room FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_bookings_dates CHECK (check_out > check_in)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE menu_categories (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(80) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_menu_categories_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE menu_items (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  category_id  INT UNSIGNED NOT NULL,
  name         VARCHAR(150) NOT NULL,
  description  VARCHAR(500) NULL,
  price        DECIMAL(12,2) NOT NULL,
  is_available TINYINT(1) NOT NULL DEFAULT 1,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_menu_items_name (name),
  KEY idx_menu_items_category (category_id),
  CONSTRAINT fk_menu_items_category FOREIGN KEY (category_id) REFERENCES menu_categories (id) ON DELETE RESTRICT,
  CONSTRAINT chk_menu_items_price CHECK (price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inventory_items (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name           VARCHAR(150) NOT NULL,
  category       VARCHAR(80) NOT NULL,
  quantity       DECIMAL(12,3) NOT NULL DEFAULT 0,
  unit           VARCHAR(20) NOT NULL,
  min_stock      DECIMAL(12,3) NOT NULL DEFAULT 0,
  purchase_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  supplier       VARCHAR(150) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inventory_items_name (name),
  KEY idx_inventory_items_category (category),
  CONSTRAINT chk_inventory_quantity CHECK (quantity >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inventory_transactions (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  inventory_item_id INT UNSIGNED NOT NULL,
  type              ENUM('Initial','Stock In','Stock Out','Order Usage') NOT NULL,
  quantity_change   DECIMAL(12,3) NOT NULL,
  quantity_after    DECIMAL(12,3) NOT NULL,
  unit_cost         DECIMAL(12,2) NULL,
  reference_type    VARCHAR(30) NULL,
  reference_id      INT UNSIGNED NULL,
  note              VARCHAR(255) NULL,
  created_by        INT UNSIGNED NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_inv_tx_item_date (inventory_item_id, created_at),
  KEY idx_inv_tx_type_date (type, created_at),
  CONSTRAINT fk_inv_tx_item FOREIGN KEY (inventory_item_id) REFERENCES inventory_items (id) ON DELETE CASCADE,
  CONSTRAINT fk_inv_tx_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE menu_item_ingredients (
  menu_item_id      INT UNSIGNED NOT NULL,
  inventory_item_id INT UNSIGNED NOT NULL,
  quantity          DECIMAL(12,3) NOT NULL,
  PRIMARY KEY (menu_item_id, inventory_item_id),
  CONSTRAINT fk_mii_menu_item FOREIGN KEY (menu_item_id) REFERENCES menu_items (id) ON DELETE CASCADE,
  CONSTRAINT fk_mii_inventory FOREIGN KEY (inventory_item_id) REFERENCES inventory_items (id) ON DELETE RESTRICT,
  CONSTRAINT chk_mii_quantity CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE orders (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id        INT UNSIGNED NULL,
  location           VARCHAR(60) NULL,
  status             ENUM('Pending','Preparing','Completed','Cancelled') NOT NULL DEFAULT 'Pending',
  subtotal           DECIMAL(12,2) NOT NULL,
  discount           DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_rate           DECIMAL(5,2) NOT NULL DEFAULT 0,
  tax                DECIMAL(12,2) NOT NULL DEFAULT 0,
  total              DECIMAL(12,2) NOT NULL,
  notes              VARCHAR(500) NULL,
  inventory_deducted TINYINT(1) NOT NULL DEFAULT 0,
  completed_at       DATETIME NULL,
  created_by         INT UNSIGNED NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_orders_status (status),
  KEY idx_orders_created (created_at),
  KEY idx_orders_customer (customer_id),
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE RESTRICT,
  CONSTRAINT fk_orders_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE order_items (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id     INT UNSIGNED NOT NULL,
  menu_item_id INT UNSIGNED NULL,
  item_name    VARCHAR(150) NOT NULL,
  unit_price   DECIMAL(12,2) NOT NULL,
  quantity     INT UNSIGNED NOT NULL,
  line_total   DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_order_items_order (order_id),
  KEY idx_order_items_menu (menu_item_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_menu FOREIGN KEY (menu_item_id) REFERENCES menu_items (id) ON DELETE SET NULL,
  CONSTRAINT chk_order_items_qty CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bills (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id    INT UNSIGNED NULL,
  booking_id     INT UNSIGNED NULL,
  room_charges   DECIMAL(12,2) NOT NULL DEFAULT 0,
  food_charges   DECIMAL(12,2) NOT NULL DEFAULT 0,
  subtotal       DECIMAL(12,2) NOT NULL,
  discount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_rate       DECIMAL(5,2) NOT NULL DEFAULT 0,
  tax            DECIMAL(12,2) NOT NULL DEFAULT 0,
  grand_total    DECIMAL(12,2) NOT NULL,
  amount_paid    DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_status ENUM('Unpaid','Partial','Paid') NOT NULL DEFAULT 'Unpaid',
  payment_method ENUM('Cash','Card','Bank Transfer','Online') NULL,
  paid_at        DATETIME NULL,
  notes          VARCHAR(500) NULL,
  created_by     INT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bills_booking (booking_id),
  KEY idx_bills_customer (customer_id),
  KEY idx_bills_created (created_at),
  KEY idx_bills_payment_status (payment_status),
  CONSTRAINT fk_bills_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE RESTRICT,
  CONSTRAINT fk_bills_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE RESTRICT,
  CONSTRAINT fk_bills_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bill_items (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  bill_id     INT UNSIGNED NOT NULL,
  item_type   ENUM('Room','Food') NOT NULL,
  description VARCHAR(255) NOT NULL,
  quantity    INT UNSIGNED NOT NULL,
  unit_price  DECIMAL(12,2) NOT NULL,
  line_total  DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_bill_items_bill (bill_id),
  CONSTRAINT fk_bill_items_bill FOREIGN KEY (bill_id) REFERENCES bills (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- An order can be part of at most one bill (UNIQUE order_id).
CREATE TABLE bill_orders (
  bill_id  INT UNSIGNED NOT NULL,
  order_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (bill_id, order_id),
  UNIQUE KEY uq_bill_orders_order (order_id),
  CONSTRAINT fk_bill_orders_bill FOREIGN KEY (bill_id) REFERENCES bills (id) ON DELETE CASCADE,
  CONSTRAINT fk_bill_orders_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
