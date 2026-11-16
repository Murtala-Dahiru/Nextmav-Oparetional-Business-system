import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const base = process.env.PUBLIC_CHECK_ORIGIN || "http://localhost:3000";
const routes = [
  "/",
  "/features",
  "/solutions",
  "/solutions/agencies",
  "/solutions/consulting",
  "/solutions/technology",
  "/solutions/construction",
  "/solutions/other-businesses",
  "/pricing",
  "/about",
  "/contact",
  "/docs",
  "/help",
  "/blog",
  "/status",
  "/privacy",
  "/terms",
  "/cookies",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify",
  "/accept-invite",
];
const pages = new Map();
for (const route of routes) {
  const response = await fetch(base + route, {
    signal: AbortSignal.timeout(90000),
  });
  assert.equal(response.status, 200, route);
  const html = await response.text();
  assert(html.includes("nm-public"), `${route} lacks public scope`);
  assert(!html.includes("data-next-error"), `${route} has a render error`);
  pages.set(route, html);
  console.log(`PASS ${route}`);
}
let links = 0;
for (const [route, html] of pages) {
  for (const [, href] of html.matchAll(/<a\b[^>]*href="([^"<]+)"/g)) {
    if (!href.startsWith("/") || href.startsWith("//")) continue;
    const [pathWithQuery, anchor] = href.split("#");
    const path = pathWithQuery.split("?")[0] || route;
    if (pages.has(path) && anchor)
      assert(
        pages.get(path).includes(`id="${anchor}"`),
        `${route}: broken anchor ${href}`,
      );
    else if (!pages.has(path) && !["/dashboard"].includes(path)) {
      const response = await fetch(base + path, {
        signal: AbortSignal.timeout(90000),
      });
      assert(response.status < 400, `${route}: broken link ${href}`);
    }
    links++;
  }
}
for (const route of ["/onboarding", "/change-password", "/dashboard"]) {
  const response = await fetch(base + route, { redirect: "manual" });
  assert(
    [302, 303, 307, 308].includes(response.status),
    `${route}: unauthenticated access was not redirected`,
  );
  assert(
    response.headers.get("location")?.includes("/login"),
    `${route}: expected login guard`,
  );
  console.log(`PASS ${route} login guard`);
}
assert(pages.get("/login").includes('href="/forgot-password"'));
assert(pages.get("/login").includes('href="/signup"'));
assert(pages.get("/signup").includes('href="/login"'));
assert(pages.get("/pricing").includes("provisional"));
assert(
  /Contact channel unavailable|Open email draft/.test(pages.get("/contact")),
);
const logo = await fetch(base + "/logo.svg");
assert.equal(logo.status, 200);
const css = ["premium", "editorial"]
  .map((name) => readFileSync(`src/styles/public/${name}.css`, "utf8"))
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");
for (const match of css.matchAll(/([^{}]+)\{/g)) {
  const selector = match[1].trim();
  if (selector.startsWith("@")) continue;
  // Split selector lists only at top level, not inside :where(h1, h2, h3).
  const parts = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < selector.length; i++) {
    if (selector[i] === "(") depth++;
    if (selector[i] === ")") depth--;
    if (selector[i] === "," && depth === 0) {
      parts.push(selector.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(selector.slice(start));
  assert(
    parts.every((s) => s.trim().startsWith(".nm-public")),
    `unscoped CSS: ${selector}`,
  );
}
console.log(
  `PASS ${links} internal links, auth navigation, local logo and CSS isolation`,
);
console.log(
  "Public HTTP checks passed. Browser interaction and authenticated lifecycle tests are separate checks.",
);
