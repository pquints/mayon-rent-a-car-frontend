# Frontend workflow (single source of truth)

Use `Public/` as the editable source for all frontend pages.

## Rule

- Edit pages only in `Public/*.html`.
- Before commit or push, sync pages to root so Vercel root routes stay stable.

## Sync command

Run from project root:

```bash
bash scripts/sync-public-to-root.sh
```

## Typical flow

```bash
# 1) edit Public files
# 2) sync
bash scripts/sync-public-to-root.sh

# 3) commit and push
git add Public/*.html *.html vercel.json
git commit -m "update frontend pages"
git push origin main
```
