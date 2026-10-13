-- AlterTable
ALTER TABLE `product_images` ADD COLUMN `option_value_id` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `product_images` ADD CONSTRAINT `product_images_option_value_id_fkey` FOREIGN KEY (`option_value_id`) REFERENCES `product_option_values`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
