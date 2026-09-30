import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTitle, buildPayload, missingForUpload } from "./listing.js";

test("titles", () => {
  assert.equal(buildTitle({ brandName: "Apple", model: "iPhone 13", storage: 128 }), "iPhone 13 128GB");
  assert.equal(buildTitle({ brandName: "Honor", model: "X8", storage: 128 }), "Honor X8 128GB");
  assert.equal(buildTitle({ brandName: "Samsung", model: "Vivo Y20" }), "Vivo Y20");
  assert.equal(buildTitle({ brandName: "Samsung", model: "A52", storage: 1024 }), "Samsung A52 1TB");
});

test("payload + missing", () => {
  const f = { brandName: "Apple", brandId: "a".repeat(24), model: "iPhone 13", price: 340, currency: "USD", imei: "Bor" };
  const p = buildPayload(f, ["https://x/1.jpg"]);
  assert.equal(p.condition, "used");
  assert.equal(p.images.length, 1);
  assert.match(p.description, /IMEI: Bor/);
  assert.deepEqual(missingForUpload({ ...f, brandId: null, price: null }), ["brend", "narx"]);
});
