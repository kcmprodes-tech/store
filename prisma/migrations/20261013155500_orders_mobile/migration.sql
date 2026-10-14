-- AlterTable
ALTER TABLE `admin_users` ADD COLUMN `notification_prefs` JSON NULL;

-- AlterTable
ALTER TABLE `order_items` ADD COLUMN `packed_qty` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `reserved_qty` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `returned_qty` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `shipped_qty` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `stock_location_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `order_status_history` ADD COLUMN `actor` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `orders` ADD COLUMN `buyer_name` VARCHAR(160) NULL,
    ADD COLUMN `buyer_phone` VARCHAR(30) NULL,
    ADD COLUMN `cancel_reason` VARCHAR(255) NULL,
    ADD COLUMN `packed_at` DATETIME(3) NULL,
    ADD COLUMN `packed_by` VARCHAR(191) NULL,
    ADD COLUMN `picked_up_at` DATETIME(3) NULL,
    ADD COLUMN `picked_up_by` VARCHAR(191) NULL,
    ADD COLUMN `ready_at` DATETIME(3) NULL,
    ADD COLUMN `shipped_at` DATETIME(3) NULL,
    ADD COLUMN `shipped_by` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `product_variants` ADD COLUMN `barcode` VARCHAR(64) NULL;

-- CreateTable
CREATE TABLE `order_attachments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` INTEGER NOT NULL,
    `return_id` INTEGER NULL,
    `kind` ENUM('PACKAGE', 'RETURN') NOT NULL,
    `path` VARCHAR(255) NOT NULL,
    `mime` VARCHAR(40) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `note` VARCHAR(255) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `order_attachments_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refunds` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` INTEGER NOT NULL,
    `amount` INTEGER NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED') NOT NULL DEFAULT 'REQUESTED',
    `requested_by_id` INTEGER NULL,
    `requested_by` VARCHAR(191) NOT NULL,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `due_at` DATETIME(3) NOT NULL,
    `decided_by_id` INTEGER NULL,
    `decided_by` VARCHAR(191) NULL,
    `decided_at` DATETIME(3) NULL,
    `decision_note` VARCHAR(500) NULL,
    `completed_by` VARCHAR(191) NULL,
    `completed_at` DATETIME(3) NULL,

    INDEX `refunds_status_due_at_idx`(`status`, `due_at`),
    INDEX `refunds_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_returns` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` INTEGER NOT NULL,
    `items` JSON NOT NULL,
    `note` VARCHAR(500) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `order_returns_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `admin_user_id` INTEGER NOT NULL,
    `type` VARCHAR(40) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `body` VARCHAR(500) NOT NULL,
    `url` VARCHAR(255) NOT NULL,
    `dedupe_key` VARCHAR(120) NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_admin_user_id_read_at_created_at_idx`(`admin_user_id`, `read_at`, `created_at`),
    UNIQUE INDEX `notifications_admin_user_id_dedupe_key_key`(`admin_user_id`, `dedupe_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `push_subscriptions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `admin_user_id` INTEGER NOT NULL,
    `endpoint` VARCHAR(500) NOT NULL,
    `p256dh` VARCHAR(200) NOT NULL,
    `auth` VARCHAR(100) NOT NULL,
    `vapid_key_id` VARCHAR(16) NOT NULL,
    `session_id` CHAR(64) NULL,
    `user_agent` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_success_at` DATETIME(3) NULL,
    `fail_count` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `push_subscriptions_endpoint_key`(`endpoint`),
    INDEX `push_subscriptions_admin_user_id_idx`(`admin_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_passkeys` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `admin_user_id` INTEGER NOT NULL,
    `credential_id` VARCHAR(512) NOT NULL,
    `public_key` BLOB NOT NULL,
    `counter` BIGINT NOT NULL DEFAULT 0,
    `transports` JSON NULL,
    `name` VARCHAR(80) NOT NULL,
    `backed_up` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_used_at` DATETIME(3) NULL,

    UNIQUE INDEX `admin_passkeys_credential_id_key`(`credential_id`),
    INDEX `admin_passkeys_admin_user_id_idx`(`admin_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_auth_challenges` (
    `id` CHAR(43) NOT NULL,
    `challenge` VARCHAR(128) NOT NULL,
    `purpose` VARCHAR(20) NOT NULL,
    `admin_user_id` INTEGER NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `admin_auth_challenges_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `admin_user_id` INTEGER NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `request_hash` CHAR(64) NOT NULL,
    `response` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `client_requests_admin_user_id_key_key`(`admin_user_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `orders_tracking_no_idx` ON `orders`(`tracking_no`);

-- CreateIndex
CREATE INDEX `orders_buyer_phone_idx` ON `orders`(`buyer_phone`);

-- CreateIndex
CREATE UNIQUE INDEX `product_variants_barcode_key` ON `product_variants`(`barcode`);

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_stock_location_id_fkey` FOREIGN KEY (`stock_location_id`) REFERENCES `stock_locations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_attachments` ADD CONSTRAINT `order_attachments_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_attachments` ADD CONSTRAINT `order_attachments_return_id_fkey` FOREIGN KEY (`return_id`) REFERENCES `order_returns`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_returns` ADD CONSTRAINT `order_returns_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_admin_user_id_fkey` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `push_subscriptions_admin_user_id_fkey` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_passkeys` ADD CONSTRAINT `admin_passkeys_admin_user_id_fkey` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_requests` ADD CONSTRAINT `client_requests_admin_user_id_fkey` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

