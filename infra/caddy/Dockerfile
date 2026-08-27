# Custom Caddy build with the ClouDNS DNS-01 plugin
# (github.com/caddy-dns/cloudns) baked in — the stock Caddy image doesn't
# bundle third-party DNS provider plugins, so a real cert via DNS-01 needs
# a build with it compiled in. See docs/PLAN.md "Hosting & data
# residency" and infra/deploy/README.md "TLS via Caddy + ClouDNS".
FROM caddy:2-builder-alpine AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudns

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
