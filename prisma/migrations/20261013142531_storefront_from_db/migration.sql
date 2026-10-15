-- AlterTable
ALTER TABLE `categories` ADD COLUMN `is_active` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `landing_collection_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `collections` ADD COLUMN `is_active` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `home_sections` ADD COLUMN `is_active` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `placement` ENUM('HOME', 'PRODUCT_RELATED') NOT NULL DEFAULT 'HOME',
    ADD COLUMN `product_limit` INTEGER NOT NULL DEFAULT 4,
    ADD COLUMN `rules` JSON NULL,
    ADD COLUMN `see_all_category_id` INTEGER NULL,
    ADD COLUMN `see_all_collection_id` INTEGER NULL,
    ADD COLUMN `see_all_type` ENUM('NONE', 'SECTION_PAGE', 'COLLECTION', 'CATEGORY', 'URL') NOT NULL DEFAULT 'NONE',
    ADD COLUMN `see_all_url` VARCHAR(500) NULL,
    ADD COLUMN `show_more_button` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `source` ENUM('MANUAL', 'RULE') NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE `navigation_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `placement` ENUM('SEARCH_MENU', 'HOME_SHORTCUT') NOT NULL,
    `label` VARCHAR(80) NOT NULL,
    `image_url` VARCHAR(500) NULL,
    `link_type` ENUM('COLLECTION', 'CATEGORY', 'URL') NOT NULL,
    `collection_id` INTEGER NULL,
    `category_id` INTEGER NULL,
    `url` VARCHAR(500) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `navigation_items_placement_sort_order_idx`(`placement`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `home_sections_placement_sort_order_idx` ON `home_sections`(`placement`, `sort_order`);

-- AddForeignKey
ALTER TABLE `categories` ADD CONSTRAINT `categories_landing_collection_id_fkey` FOREIGN KEY (`landing_collection_id`) REFERENCES `collections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `home_sections` ADD CONSTRAINT `home_sections_see_all_collection_id_fkey` FOREIGN KEY (`see_all_collection_id`) REFERENCES `collections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `home_sections` ADD CONSTRAINT `home_sections_see_all_category_id_fkey` FOREIGN KEY (`see_all_category_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `navigation_items` ADD CONSTRAINT `navigation_items_collection_id_fkey` FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `navigation_items` ADD CONSTRAINT `navigation_items_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Data awal: setara isi template sebelumnya ─────────────
-- Supaya database yang sudah ada langsung tampil sama tanpa seed ulang (di DB kosong, perintah ini tidak mengubah apa pun).

-- Menu Kategori: Membership menaut ke koleksi membership.
UPDATE `categories` c JOIN `collections` k ON k.`key` = 'membership'
SET c.`landing_collection_id` = k.`id` WHERE c.`slug` = 'membership';

-- Seksi beranda: link "Lihat Semua" ke koleksi; "Baru di store" 12 produk + tombol di bawah grid.
UPDATE `home_sections` s JOIN `collections` k ON k.`key` = s.`key`
SET s.`see_all_type` = 'COLLECTION', s.`see_all_collection_id` = k.`id`
WHERE s.`key` IN ('terlaris', 'rekomendasi', 'merchandise');
UPDATE `home_sections` s JOIN `collections` k ON k.`key` = 'terbaru'
SET s.`see_all_type` = 'COLLECTION', s.`see_all_collection_id` = k.`id`, s.`product_limit` = 12, s.`show_more_button` = true
WHERE s.`key` = 'baru';
UPDATE `home_sections` SET `placement` = 'PRODUCT_RELATED', `product_limit` = 8 WHERE `key` = 'related';

-- Menu di bawah kolom pencarian.
INSERT INTO `navigation_items` (`placement`, `label`, `link_type`, `collection_id`, `sort_order`, `updated_at`)
SELECT 'SEARCH_MENU', t.`label`, 'COLLECTION', k.`id`, t.`ord`, CURRENT_TIMESTAMP(3)
FROM (
  SELECT 'terlaris' AS `key`, 'Terlaris' AS `label`, 0 AS `ord`
  UNION ALL SELECT 'rekomendasi', 'Rekomendasi', 1
  UNION ALL SELECT 'merchandise', 'Merchandise', 2
  UNION ALL SELECT 'video-premium', 'Video premium', 3
  UNION ALL SELECT 'event', 'Event', 4
  UNION ALL SELECT 'membership', 'Membership', 5
) t JOIN `collections` k ON k.`key` = t.`key`;

-- Kartu Kategori Pilihan di beranda.
INSERT INTO `navigation_items` (`placement`, `label`, `image_url`, `link_type`, `collection_id`, `sort_order`, `updated_at`)
SELECT 'HOME_SHORTCUT', t.`label`, t.`image`, 'COLLECTION', k.`id`, t.`ord`, CURRENT_TIMESTAMP(3)
FROM (
  SELECT 'diskon' AS `key`, 'Diskon Spesial' AS `label`, '/images/store-v2/cat-diskon-spesial.png' AS `image`, 0 AS `ord`
  UNION ALL SELECT 'rekomendasi', 'Rekomendasi', '/images/store-v2/cat-rekomendasi.png', 1
  UNION ALL SELECT 'terbaru', 'Terbaru', '/images/store-v2/cat-terbaru.png', 2
  UNION ALL SELECT 'merchandise', 'Merchandise', '/images/store-v2/cat-merchandise.png', 3
  UNION ALL SELECT 'membership', 'Membership', '/images/store-v2/cat-membership.png', 4
  UNION ALL SELECT 'event', 'Event', '/images/store-v2/cat-event.png', 5
) t JOIN `collections` k ON k.`key` = t.`key`;
