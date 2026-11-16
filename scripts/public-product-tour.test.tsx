import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductPreview } from "../src/components/marketing/product-preview";
import { TOUR, TOUR_GROUPS, type TourKey } from "../src/components/marketing/product-tour-data";
import { CAPABILITIES } from "../src/components/marketing/capabilities";

const keys = Object.keys(TOUR) as TourKey[];
const grouped = TOUR_GROUPS.flatMap(group => group.keys);
assert.equal(keys.length, 12);
assert.equal(new Set(grouped).size, keys.length, "Every module is reachable once");
assert.deepEqual([...grouped].sort(), [...keys].sort());
for (const key of keys) {
  const tour = TOUR[key];
  assert(CAPABILITIES.some(capability => capability.id === tour.anchor && capability.status === "live"), `${key}: capability destination must exist and be available`);
  const html = renderToStaticMarkup(<ProductPreview initialView={key}/>);
  assert(html.includes("ILLUSTRATIVE PREVIEW"), `${key}: sample disclosure`);
  assert(html.includes(`href="/features#${tour.anchor}"`), `${key}: capability link`);
  assert(html.includes('aria-live="polite"'), `${key}: announce view changes`);
  assert.equal((html.match(/<option /g) || []).length, 12, `${key}: every module reachable on mobile`);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 2, `${key}: one active category and module`);
  assert(html.includes(tour.rows[0][0].replaceAll("&", "&amp;")), `${key}: visual content rendered`);
  console.log(`PASS ${key}`);
}
const pair = renderToStaticMarkup(<><ProductPreview/><ProductPreview initialView="crm"/></>);
const ids = [...pair.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, "Multiple galleries must have unique control/label IDs");
console.log("PASS all 12 previews, mobile choices, capability destinations and unique accessibility IDs");
