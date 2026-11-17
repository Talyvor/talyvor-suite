package main

// phone_check_seal.go — B61.115: a confirmed number survives a restart of the app.
//
// A phone check (phone_signin.go) was only in memory, and every deploy restarts this process, so anyone between "the
// code" and "Type it again" during a deploy was sent back to the number with "That confirmation has ended". Now the
// check id IS the check, sealed as sessions are (session_seal.go): AES-256-GCM over the number, Lens's ticket, whether
// a person holds the number and the expiry, under a key derived from LENS_PROVISION_SECRET with its own purpose label.
// The id is opaque and the ticket never reaches the browser in the clear.
//
// The map stays the fast path. A check the map does not hold is opened from its seal, but only one this process could
// not have seen end: issued before it started (a check issued here and missing from the map was spent or expired
// here), not ended since it was restored, and not expired. A spent check stays spent across a restart because Lens
// refuses a used ticket (ticket_ended), and that refusal deletes the check as it always has: a restored check reaches
// Lens like any other and skips none of its refusals. Without the secret checks stay in memory only.

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
	"sync"
	"time"
)

// checkSealPrefix marks a sealed check id.
const checkSealPrefix = "c1."

type checkSealer struct {
	aead     cipher.AEAD
	bootedAt time.Time

	mu    sync.Mutex
	ended map[string]time.Time // a restored check spent here, until it would have expired
}

// newCheckSealer returns nil without a secret: checks are then in memory only.
func newCheckSealer(secret string) *checkSealer {
	if secret == "" {
		return nil
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("talyvor-bff phone check seal v1"))
	block, err := aes.NewCipher(mac.Sum(nil))
	if err != nil {
		return nil
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil
	}
	return &checkSealer{aead: aead, bootedAt: time.Now(), ended: map[string]time.Time{}}
}

type sealedCheck struct {
	Issued    int64  `json:"iat"`
	Expires   int64  `json:"exp"`
	Phone     string `json:"ph"`
	Ticket    string `json:"tk"`
	HasPerson bool   `json:"hp,omitempty"`
}

// seal returns a new check id carrying c.
func (z *checkSealer) seal(c phoneCheck) (string, error) {
	p := sealedCheck{Issued: time.Now().UnixNano(), Expires: c.expires.UnixNano(), Phone: c.phone, Ticket: c.ticket,
		HasPerson: c.hasPerson}
	plain, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, z.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return checkSealPrefix + base64.RawURLEncoding.EncodeToString(z.aead.Seal(nonce, nonce, plain, []byte(checkSealPrefix))), nil
}

// open returns the check sealed in id, if this process may restore it.
func (z *checkSealer) open(id string) (phoneCheck, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(id, checkSealPrefix))
	if !strings.HasPrefix(id, checkSealPrefix) || err != nil || len(raw) < z.aead.NonceSize() {
		return phoneCheck{}, false
	}
	n := z.aead.NonceSize()
	plain, err := z.aead.Open(nil, raw[:n], raw[n:], []byte(checkSealPrefix))
	if err != nil {
		return phoneCheck{}, false
	}
	var p sealedCheck
	if json.Unmarshal(plain, &p) != nil || p.Ticket == "" || p.Phone == "" {
		return phoneCheck{}, false
	}
	issued, expires := time.Unix(0, p.Issued), time.Unix(0, p.Expires)
	if !issued.Before(z.bootedAt) || !time.Now().Before(expires) {
		return phoneCheck{}, false
	}
	z.mu.Lock()
	_, ended := z.ended[id]
	z.mu.Unlock()
	if ended {
		return phoneCheck{}, false
	}
	return phoneCheck{phone: p.Phone, ticket: p.Ticket, hasPerson: p.HasPerson, expires: expires}, true
}

// end remembers that id was spent in this process, so its seal cannot bring it back.
func (z *checkSealer) end(id string, until time.Time) {
	if !strings.HasPrefix(id, checkSealPrefix) {
		return
	}
	z.mu.Lock()
	defer z.mu.Unlock()
	now := time.Now()
	for k, u := range z.ended {
		if now.After(u) {
			delete(z.ended, k)
		}
	}
	z.ended[id] = until
}
