package main

// signup_account_test.go — B59.8: sign-up asks who the account is for and the kind of money, and both reach Lens's
// POST /v1/provision on the call that makes the workspace. Driven through the door (B61.25): a new number, its code
// and a passcode, then POST /auth/signup/account with the answers, so what is asserted is what Lens was sent. Google
// sign-in, which these tests once drove, is gone (B61.29).

import (
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
)

var signupNumbers atomic.Int64

// signUpAs joins a new number through br (nil: the phone app, with its Bearer token) and answers sign-up's step with
// answers: the status and the body.
func (s *doorSuite) signUpAs(br *http.Client, answers map[string]string) (int, map[string]any) {
	s.t.Helper()
	phone := fmt.Sprintf("+4477009%05d", 50000+signupNumbers.Add(1))
	check, has := s.confirm(br, phone)
	if has {
		s.t.Fatalf("a new number reads as held")
	}
	st, out, _ := s.post(br, "", phoneJoinPath, map[string]string{"check": check, "passcode": "418263"})
	if st != http.StatusOK || out["signup_unfinished"] != true {
		s.t.Fatalf("join: %d %v", st, out)
	}
	bearer, _ := out["token"].(string)
	st, out, _ = s.post(br, bearer, signupAccountPath, answers)
	return st, out
}

// accountOf is what Lens was sent for the account a sign-up answered.
func (s *doorSuite) accountOf(out map[string]any) ([3]string, [2]string) {
	s.t.Helper()
	ws, _ := out["account_id"].(string)
	if ws == "" {
		s.t.Fatalf("sign-up named no account: %v", out)
	}
	s.lens.mu.Lock()
	defer s.lens.mu.Unlock()
	return s.lens.accounts[ws], s.lens.profiles[ws]
}

// madeNone reports a failure if Lens made any account since n.
func (s *doorSuite) madeNone(n int) {
	s.t.Helper()
	s.lens.mu.Lock()
	defer s.lens.mu.Unlock()
	if len(s.lens.accounts) != n {
		s.t.Fatalf("a refused sign-up made a workspace")
	}
}

func (s *doorSuite) accountCount() int {
	s.lens.mu.Lock()
	defer s.lens.mu.Unlock()
	return len(s.lens.accounts)
}

func TestB598_EachOfTheSixChoicesReachesLensAsItsTypeAndKind(t *testing.T) {
	s := startDoorSuite(t, nil)
	for _, typ := range []string{"personal", "business"} {
		for _, kind := range []string{"fiat", "stablecoin", "hybrid"} {
			name := "Maya Lind"
			if typ == "business" {
				name = "Northwind Studio"
			}
			st, out := s.signUpAs(s.browser(), map[string]string{"account_type": typ, "money_kind": kind, "name": "  " + name + " "})
			if st != http.StatusOK {
				t.Fatalf("%s %s: %d %v", typ, kind, st, out)
			}
			if got, _ := s.accountOf(out); got != [3]string{typ, kind, name} {
				t.Errorf("Lens was sent %q, want %q", got, [3]string{typ, kind, name})
			}
		}
	}
}

func TestB598_SignUpCannotFinishWithoutBoth(t *testing.T) {
	s := startDoorSuite(t, nil)
	for _, q := range []map[string]string{
		{"account_type": "personal", "name": "Maya Lind"},
		{"money_kind": "fiat", "name": "Maya Lind"},
		{"account_type": "personal", "money_kind": "", "name": "Maya Lind"},
		{"account_type": "family", "money_kind": "fiat", "name": "Maya Lind"},
		{"account_type": "business", "money_kind": "gold", "name": "Northwind Studio"},
		{"account_type": "personal", "money_kind": "hybrid"},
		{"account_type": "personal", "money_kind": "hybrid", "name": strings.Repeat("n", 81)},
		{"account_type": "personal", "money_kind": "hybrid", "name": "Maya‮Lind"},
		{"account_type": "personal", "money_kind": "hybrid", "name": "Maya\nLind"},
	} {
		n := s.accountCount()
		if st, out := s.signUpAs(s.browser(), q); st != http.StatusBadRequest {
			t.Errorf("%v: got %d (%v), want 400", q, st, out)
		}
		s.madeNone(n)
	}
}

// The phone (B59.9) sends the same answers, on its Bearer token.
func TestB598_ThePhoneSendsTheSameAnswers(t *testing.T) {
	s := startDoorSuite(t, nil)
	n := s.accountCount()
	if st, out := s.signUpAs(nil, map[string]string{"account_type": "personal"}); st != http.StatusBadRequest {
		t.Fatalf("the type without the kind: %d (%v), want 400", st, out)
	}
	s.madeNone(n)
	st, out := s.signUpAs(nil, map[string]string{"account_type": "business", "money_kind": "stablecoin", "name": "Northwind Studio"})
	if st != http.StatusOK {
		t.Fatalf("phone sign-up: %d (%v)", st, out)
	}
	if got, want := func() [3]string { a, _ := s.accountOf(out); return a }(), [3]string{"business", "stablecoin", "Northwind Studio"}; got != want {
		t.Errorf("Lens was sent %q, want %q", got, want)
	}
}

// B59.41: sign-up's country and a business's registration number reach Lens's POST /v1/provision with the other
// answers, from the web and from the phone, the country upper-case and both trimmed as Lens keeps them (B59.40).
func TestB5941_CountryAndRegistrationNumberReachLens(t *testing.T) {
	s := startDoorSuite(t, nil)
	for _, tc := range []struct {
		br                         *http.Client
		typ, name, country, number string
		want                       [2]string
	}{
		{s.browser(), "personal", "Maya Lind", " gb ", "", [2]string{"GB", ""}},
		{s.browser(), "business", "Northwind Studio", "DE", " HRB 12345 ", [2]string{"DE", "HRB 12345"}},
		{nil, "business", "Northwind Studio", "FR", "552 100 554", [2]string{"FR", "552 100 554"}},
	} {
		st, out := s.signUpAs(tc.br, map[string]string{"account_type": tc.typ, "money_kind": "fiat", "name": tc.name,
			"country": tc.country, "registration_number": tc.number})
		if st != http.StatusOK {
			t.Fatalf("%s: %d (%v)", tc.typ, st, out)
		}
		if _, got := s.accountOf(out); got != tc.want {
			t.Errorf("%s (phone: %t): Lens was sent %q, want %q", tc.typ, tc.br == nil, got, tc.want)
		}
	}
}

// A country that is not two letters, a registration number on a personal account, and one past Lens's 64 characters
// are refused, as the other answers are.
func TestB5941_ABadProfileIsRefused(t *testing.T) {
	s := startDoorSuite(t, nil)
	business := func(country, number string) map[string]string {
		return map[string]string{"account_type": "business", "money_kind": "fiat", "name": "Northwind Studio",
			"country": country, "registration_number": number}
	}
	for _, q := range []map[string]string{
		business("GBR", "123"),
		business("G1", "123"),
		business("GB", strings.Repeat("1", 65)),
		business("GB", "12\n34"),
		{"account_type": "personal", "money_kind": "fiat", "name": "Maya Lind", "country": "GB", "registration_number": "123"},
		{"country": "GB"},
	} {
		n := s.accountCount()
		if st, out := s.signUpAs(s.browser(), q); st != http.StatusBadRequest {
			t.Errorf("%v: got %d (%v), want 400", q, st, out)
		}
		s.madeNone(n)
	}
}
