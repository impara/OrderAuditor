# Duplicate Guard landing page - static site for Coolify
FROM python:3.12-alpine AS seo-index
WORKDIR /site
COPY . .
RUN python3 tools/seo_index.py --check || python3 tools/seo_index.py

FROM nginx:alpine

# Remove default static content
RUN rm -rf /usr/share/nginx/html/*

# Copy generated static files (HTML + assets)
COPY --from=seo-index /site/*.html /site/robots.txt /site/sitemap.xml /usr/share/nginx/html/
COPY --from=seo-index /site/assets/ /usr/share/nginx/html/assets/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
