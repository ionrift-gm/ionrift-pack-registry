# Ionrift pack registry

`registry.json` is the public catalog of pack and module metadata. Download bytes stay in the catalog that ships with the middleware. This file records labels, tiers, and which version is current.

## Overlay `channel`

Optional on `overlays` entries. Also valid on `packs` and `modules` entries when a row should stay out of the public listing.

| Value | Meaning |
| --- | --- |
| `released` | Default when the field is omitted. The row can be listed and bundled. |
| `incubating` | Sounds or content for a module that has not shipped. Do not list it, do not bundle it, and do not set `latest`. |
| `preview` | Hidden from the status listing and from bundles. A `latest` pointer may exist for a later publish. |

`preview: true` still hides an overlay on its own. `channel: "preview"` does the same when the boolean is absent.

The catalog bump refuses to set `latest` while `channel` is `incubating`. Leave incubating rows out of `registry.json` until the module ships, or keep them with no `latest` change. This document does not add or edit any registry rows.
