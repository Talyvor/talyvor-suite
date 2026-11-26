package main

import "mime"

// B29.1: Go's own table has no .ico, so its type came from the host's /etc/mime.types
// (image/vnd.microsoft.icon on Debian) or from sniffing. Pin what browsers and the brand check read.
func init() {
	_ = mime.AddExtensionType(".ico", "image/x-icon")
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
	// B61.128: the sounds in /sounds; Go's table has no .wav either.
	_ = mime.AddExtensionType(".wav", "audio/wav")
}
