import { describe, expect, it } from "vitest";
import { fillItemFromEntry, type VenueEntry } from "./venueCatalog";

describe("fillItemFromEntry", () => {
  it("giữ xuống dòng trong tên hạng mục khi chèn sang báo giá", () => {
    const item: Record<string, unknown> = {};
    const entry: VenueEntry = {
      cat: "", region: "HCM", venue: "CGV LM81", name: "Quầy vé lớn\n6.5 x 1",
      dim: null, w: null, h: null, unit: "m2", qty: null, note: null,
    };

    fillItemFromEntry(item, entry);

    expect(item.name).toBe("Quầy vé lớn\n6.5 x 1 — CGV LM81");
    expect(item.unit).toBe("m2");
  });
});
