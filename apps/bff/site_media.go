package main

import "regexp"

// B64.4 — the marketing page's media (apps/web/public/site) is named by its own content, name.<first 8 hex of its
// sha256>.ext (Landing.test.tsx holds every file to it), so a new cut is a new name and the old one can be kept a year.
var hashedSiteMedia = regexp.MustCompile(`^/site/[a-z0-9-]+\.[0-9a-f]{8}\.[a-z0-9]+$`)
