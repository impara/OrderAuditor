#!/usr/bin/env python3
"""Generate and validate Duplicate Guard static SEO discovery surfaces.

This keeps XML discovery (sitemap.xml) and crawlable internal discovery
(resources.html) in sync from the same source: canonical, indexable HTML files.
"""
from __future__ import annotations

import argparse
import html
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse

BASE_URL = "https://duplicateguard.amertech.online"
ROOT = Path(__file__).resolve().parents[1]

CONTENT_EXCLUDES = {"index.html", "privacy.html", "resources.html"}
FILENAME_EXCLUDES = {
    # Legacy generated artifact kept out of discovery; canonical page is order-merger-alternative.html.
    "order-merger-alternative-page-2026-05-24.html",
}

@dataclass(frozen=True)
class Page:
    path: Path
    url_path: str
    title: str
    description: str
    h1: str
    canonical: str | None
    robots: str | None
    mtime: float

    @property
    def loc(self) -> str:
        if self.url_path == "/index.html":
            return f"{BASE_URL}/"
        return f"{BASE_URL}{self.url_path}"

    @property
    def is_home(self) -> bool:
        return self.path.name == "index.html"

    @property
    def is_indexable(self) -> bool:
        if self.path.name in FILENAME_EXCLUDES:
            return False
        if self.robots and "noindex" in self.robots.lower():
            return False
        if self.canonical:
            parsed = urlparse(self.canonical)
            if f"{parsed.scheme}://{parsed.netloc}" != BASE_URL:
                return False
            canonical_path = parsed.path or "/"
            expected_path = "/" if self.is_home else self.url_path
            if canonical_path != expected_path:
                return False
        return True

    @property
    def appears_in_resources(self) -> bool:
        return self.is_indexable and self.path.name not in CONTENT_EXCLUDES


def first_match(pattern: str, text: str, flags: int = re.I | re.S, group: int = 1) -> str | None:
    match = re.search(pattern, text, flags)
    if not match:
        return None
    return html.unescape(match.group(group).strip())


def read_page(path: Path) -> Page:
    text = path.read_text(encoding="utf-8", errors="replace")
    title = first_match(r"<title[^>]*>(.*?)</title>", text) or path.stem.replace("-", " ").title()
    description = first_match(r'<meta\s+name=["\']description["\']\s+content=(["\'])(.*?)\1', text, group=2) or ""
    h1 = first_match(r"<h1[^>]*>(.*?)</h1>", text) or title
    h1 = re.sub(r"<[^>]+>", " ", h1)
    h1 = re.sub(r"\s+", " ", h1).strip()
    canonical = first_match(r'<link\s+rel=["\']canonical["\']\s+href=(["\'])(.*?)\1', text, group=2)
    robots = first_match(r'<meta\s+name=["\']robots["\']\s+content=(["\'])(.*?)\1', text, group=2)
    return Page(
        path=path,
        url_path=f"/{path.name}",
        title=title,
        description=description,
        h1=h1,
        canonical=canonical,
        robots=robots,
        mtime=path.stat().st_mtime,
    )


def discover_pages() -> list[Page]:
    pages = [read_page(path) for path in sorted(ROOT.glob("*.html"))]
    indexable = [page for page in pages if page.is_indexable]
    indexable.sort(key=lambda page: (0 if page.is_home else 1, page.path.name))
    return indexable


def generate_sitemap(pages: Iterable[Page]) -> str:
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for page in pages:
        lines.extend([
            "  <url>",
            f"    <loc>{html.escape(page.loc)}</loc>",
            "  </url>",
        ])
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


def generate_resources(pages: Iterable[Page]) -> str:
    cards = []
    for page in pages:
        if not page.appears_in_resources:
            continue
        desc = page.description or page.h1
        cards.append(f"""
      <article class=\"resource-card\">
        <h2><a href=\"{html.escape(page.url_path)}\">{html.escape(page.h1)}</a></h2>
        <p>{html.escape(desc)}</p>
      </article>""")
    card_html = "\n".join(cards)
    return f"""<!DOCTYPE html>
<html lang=\"en\">
<head>
<meta charset=\"UTF-8\">
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
<title>Duplicate Guard resources for Shopify order review</title>
<meta name=\"description\" content=\"Guides for Shopify merchants reviewing duplicate-looking orders, free sample abuse, one-per-customer limits, and order-merging decisions before fulfillment.\">
<link rel=\"canonical\" href=\"{BASE_URL}/resources.html\">
<meta property=\"og:title\" content=\"Duplicate Guard resources for Shopify order review\">
<meta property=\"og:description\" content=\"Guides for Shopify merchants reviewing duplicate-looking orders, free sample abuse, one-per-customer limits, and order-merging decisions before fulfillment.\">
<meta property=\"og:type\" content=\"website\">
<style>
:root {{ --primary: #008060; --primary-dark: #004c3f; --text-main: #202223; --text-sub: #6d7175; --bg-light: #f6f6f7; --border: #e1e3e5; }}
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; color: var(--text-main); line-height: 1.6; background: #fff; }}
a {{ color: var(--primary); }}
.site-header, .container, .site-footer {{ max-width: 960px; margin: 0 auto; padding-left: 1.5rem; padding-right: 1.5rem; }}
.site-header {{ padding-top: 1rem; padding-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); }}
.brand {{ color: var(--primary); font-weight: 700; text-decoration: none; }}
.header-cta {{ background: var(--primary); color: white; text-decoration: none; padding: .55rem .85rem; border-radius: .5rem; font-weight: 600; }}
.container {{ padding-top: 2.5rem; padding-bottom: 2.5rem; }}
h1 {{ color: var(--primary-dark); font-size: clamp(2rem, 5vw, 3rem); line-height: 1.1; margin: 0 0 1rem; }}
.intro {{ color: var(--text-sub); font-size: 1.15rem; max-width: 740px; }}
.resource-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; margin-top: 2rem; }}
.resource-card {{ border: 1px solid var(--border); border-radius: .9rem; padding: 1.25rem; background: var(--bg-light); }}
.resource-card h2 {{ font-size: 1.15rem; line-height: 1.3; margin: 0 0 .6rem; }}
.resource-card h2 a {{ text-decoration: none; color: var(--primary-dark); }}
.resource-card p {{ color: var(--text-sub); margin: 0; }}
.site-footer {{ padding-top: 1.5rem; padding-bottom: 1.5rem; border-top: 1px solid var(--border); color: var(--text-sub); }}
</style>
</head>
<body>
<header class=\"site-header\">
  <a class=\"brand\" href=\"/\" aria-label=\"Duplicate Guard home\">Duplicate Guard</a>
  <a class=\"header-cta\" href=\"https://apps.shopify.com/duplicate-guard\" rel=\"noopener\">Install app</a>
</header>
<main class=\"container\">
  <h1>Duplicate Guard resources for Shopify order review</h1>
  <p class=\"intro\">Practical guides for merchants who want to catch duplicate-looking orders, sample-limit bypasses, repeated household details, and order-merging decisions before fulfillment.</p>
  <section class=\"resource-grid\" aria-label=\"Duplicate Guard resource guides\">{card_html}
  </section>
</main>
<footer class=\"site-footer\">
  <p><a href=\"/\">Back to Duplicate Guard home</a> · <a href=\"/sitemap.xml\">XML sitemap</a></p>
</footer>
</body>
</html>
"""


def write_if_changed(path: Path, content: str) -> bool:
    old = path.read_text(encoding="utf-8") if path.exists() else ""
    if old == content:
        return False
    path.write_text(content, encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="verify generated files are current without writing")
    args = parser.parse_args()

    pages = discover_pages()
    sitemap = generate_sitemap(pages)
    resources = generate_resources(pages)

    outputs = {
        ROOT / "sitemap.xml": sitemap,
        ROOT / "resources.html": resources,
    }

    changed = []
    if args.check:
        for path, content in outputs.items():
            actual = path.read_text(encoding="utf-8") if path.exists() else ""
            if actual != content:
                changed.append(str(path.relative_to(ROOT)))
        if changed:
            print("SEO index files are stale:", ", ".join(changed))
            return 1
        print(f"SEO index OK: {len(pages)} indexable page(s)")
        return 0

    for path, content in outputs.items():
        if write_if_changed(path, content):
            changed.append(str(path.relative_to(ROOT)))
    print(f"Indexed {len(pages)} page(s). Updated: {', '.join(changed) if changed else 'nothing'}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
