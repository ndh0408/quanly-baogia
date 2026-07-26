-- Danh mục kích thước theo RẠP: Venue (rạp) + VenueItem (hạng mục đo sẵn).
-- Thay cho việc tra Google Sheet tay khi tạo báo giá.
CREATE TABLE "Venue" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT '',
    "cluster" TEXT,
    "code" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VenueItem" (
    "id" SERIAL NOT NULL,
    "venueId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dim" TEXT,
    "widthM" DECIMAL(12,4),
    "heightM" DECIMAL(12,4),
    "unit" TEXT,
    "quantity" DECIMAL(18,4),
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Venue_name_region_key" ON "Venue"("name", "region");
CREATE INDEX "Venue_active_idx" ON "Venue"("active");
CREATE INDEX "Venue_region_idx" ON "Venue"("region");
CREATE INDEX "VenueItem_venueId_sortOrder_idx" ON "VenueItem"("venueId", "sortOrder");
CREATE INDEX "VenueItem_category_idx" ON "VenueItem"("category");
CREATE INDEX "VenueItem_active_idx" ON "VenueItem"("active");

ALTER TABLE "Venue" ADD CONSTRAINT "Venue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VenueItem" ADD CONSTRAINT "VenueItem_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
