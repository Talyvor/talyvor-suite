package main

import (
	"errors"
	"strings"
	"unicode/utf8"
)

// signup_account.go — B59.8: what sign-up asks before the identity provider, sent to Lens when the workspace is made.
//
// The web's /signup sends them as /auth/login's query and the phone (B59.9) in /auth/mobile/session's body. They ride
// the pending login to the callback, never a cookie of their own, and go to Lens's POST /v1/provision, which sets the
// type and the kind only on the call that makes the workspace (talyvor-lens B59.6): a returning person who arrives
// through sign-up again changes nothing. Signing in sends none of them, and Lens's default applies to a workspace
// that is new then (business and hybrid).
type signupAccount struct {
	accountType string // business or personal
	moneyKind   string // fiat, stablecoin or hybrid
	name        string // the person's name or the company's: the workspace's name
}

// signupNameMax is Lens's limit on a workspace's name (B46.15).
const signupNameMax = 80

var errSignupAccount = errors.New("sign-up needs who the account is for (business or personal), the kind of money " +
	"(fiat, stablecoin or hybrid) and a name of at most 80 characters")

// parseSignupAccount reads the three answers. None at all is a sign-in; any one of them is a sign-up, which needs all
// three, so a sign-up cannot finish without both the type and the kind.
func parseSignupAccount(accountType, moneyKind, name string) (signupAccount, error) {
	name = strings.TrimSpace(name)
	if accountType == "" && moneyKind == "" && name == "" {
		return signupAccount{}, nil
	}
	switch {
	case accountType != "business" && accountType != "personal",
		moneyKind != "fiat" && moneyKind != "stablecoin" && moneyKind != "hybrid",
		name == "", utf8.RuneCountInString(name) > signupNameMax:
		return signupAccount{}, errSignupAccount
	}
	return signupAccount{accountType: accountType, moneyKind: moneyKind, name: name}, nil
}
