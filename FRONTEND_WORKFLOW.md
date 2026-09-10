# Frontend workflow

`Public/` is the only editable frontend source. The root HTML files are generated compatibility copies for existing routes and local tools.

## Daily process

1. Edit HTML, CSS, and JavaScript in `Public/` only.
2. Preview the site from `Public/`:

	```bash
	python3 -m http.server 8080 --directory Public
	```

3. Before committing, sync the supported root HTML copies:

	```bash
	bash scripts/sync-public-to-root.sh
	```

4. Check that the copies are aligned:

	```bash
	bash scripts/check-frontend-sync.sh
	```

5. Review `git diff`, then commit and push only when explicitly approved.

## Important rules

- Do not edit root HTML files directly; changes will be overwritten by the sync step.
- Do not duplicate `app.js`, `styles.css`, or dashboard assets in the root. Vercel rewrites those requests to `Public/`.
- Keep `vercel.json` rewrites pointing to `Public/`.
- If a page is missing from the sync script, add it there before treating it as a supported root route.
