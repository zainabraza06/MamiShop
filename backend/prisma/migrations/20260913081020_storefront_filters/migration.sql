-- CreateEnum
CREATE TYPE "FilterKind" AS ENUM ('COLOR', 'PRICE', 'FABRIC', 'FIT', 'ATTRIBUTE');

-- CreateTable
CREATE TABLE "storefront_filters" (
    "id" TEXT NOT NULL,
    "kind" "FilterKind" NOT NULL,
    "label" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_filters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "filter_options" (
    "id" TEXT NOT NULL,
    "filterId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "filter_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_filter_values" (
    "productId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,

    CONSTRAINT "product_filter_values_pkey" PRIMARY KEY ("productId","optionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "storefront_filters_slug_key" ON "storefront_filters"("slug");

-- CreateIndex
CREATE INDEX "storefront_filters_isVisible_position_idx" ON "storefront_filters"("isVisible", "position");

-- CreateIndex
CREATE UNIQUE INDEX "filter_options_filterId_slug_key" ON "filter_options"("filterId", "slug");

-- CreateIndex
CREATE INDEX "product_filter_values_optionId_idx" ON "product_filter_values"("optionId");

-- AddForeignKey
ALTER TABLE "filter_options" ADD CONSTRAINT "filter_options_filterId_fkey" FOREIGN KEY ("filterId") REFERENCES "storefront_filters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_filter_values" ADD CONSTRAINT "product_filter_values_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_filter_values" ADD CONSTRAINT "product_filter_values_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "filter_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Built-in filters. Inserted by the migration rather than seed.ts so every
-- environment, production included, has them as soon as this is applied.
INSERT INTO "storefront_filters" ("id", "kind", "label", "slug", "position", "isVisible", "createdAt", "updatedAt") VALUES
  ('filter_color',  'COLOR',  'Colour',     'color',  0, true, NOW(), NOW()),
  ('filter_price',  'PRICE',  'Price (Rs)', 'price',  1, true, NOW(), NOW()),
  ('filter_fabric', 'FABRIC', 'Fabric',     'fabric', 2, true, NOW(), NOW()),
  ('filter_fit',    'FIT',    'Fit',        'fit',    3, true, NOW(), NOW());
