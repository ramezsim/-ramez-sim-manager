# Vendored third-party libraries

Served from this site instead of public CDNs, so the Content-Security-Policy can
allow scripts from `'self'` only. Files were downloaded on 2026-10-03 and verified
to be byte-identical across two independent CDNs.

| File | Version | Source | sha384 |
|---|---|---|---|
| `jspdf.umd.min.js` | jsPDF 2.5.1 (MIT) | cdnjs + jsDelivr | `JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk` |
| `sql-wasm.js` | sql.js 1.13.0 (MIT) | jsDelivr + unpkg | `DJiKBv+LC78e5InEB+MvFIAH079ynMK/ERTtFUCpDzXhH1Bht7aVfpg3yOVsuYl9` |
| `sql-wasm.wasm` | sql.js 1.13.0 (MIT) | jsDelivr + unpkg | `6ZuuATBQILaZsPJlJK3qnWdqkbq+uewAZt7SZG+qToG8hZJu8u88xg2ipZi99uOA` |

The `<script>` tags that load these files carry the matching `integrity` attribute.
To upgrade: download the new version from two CDNs, compare, update the hashes here
and in `js/core.js` (`VENDOR`).
