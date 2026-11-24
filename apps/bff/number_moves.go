package main

// number_moves.go — B61.91: when Lens moves a person's number, every email address the BFF holds for them is told, and
// an operator's move ends every session of theirs, web and phone, so the lost phone is signed out.
//
// Lens holds no email addresses and sends no mail. It keeps each move in person_number_moves and hands each one to the
// BFF once (POST /v1/auth/phone/number-moves/claim, on the provision secret): {moves: [{id, person_id, identity,
// old_phone, new_phone, moved_at, by}]}, by "operator" for help's move (talyvor-lens B61.30) or "person" for a
// person's own change (B61.104).
//
// THE ADDRESSES are the ones the person gave for their contact check (POST /api/verification/contact, verification.go):
// each one Lens took is kept as (sub, address) in person_emails, with the account it was given for in
// person_email_accounts. Sign-in carries no address since Google's went (B61.29).
//
// CLOSED, AND GONE (B61.122). When Talyvor closes an account (help_closed.go reads it), the addresses given for that
// account alone are deleted, with the mails their moves still kept for them; a person left with no address here keeps
// each move only as its id and time, its sub blanked, once every session an operator's move owed is ended. An address
// the person also gave for an account still open stays, and so do its mails.
//
// ONCE, AND KEPT. Every numberMoveSweep the BFF claims the moves and, in one transaction per move, writes the move and
// one row per address into number_move_mails, so a restart loses none of them. An operator's move then ends the person
// everywhere (endPerson, as sign out everywhere does) until that is kept. A person's own change ends nothing: the
// session that made it is theirs. Each mail is marked sent before it goes and unmarked only when the sender refused
// it, so a mail is sent at most once, never twice.
//
// THE SENDER is SMTP (BFF_SMTP_HOST, BFF_SMTP_PORT, BFF_SMTP_USER, BFF_SMTP_PASSWORD, BFF_EMAIL_FROM). Unset, the mails
// are kept unsent and go when it is set. Without BFF_DATABASE_URL nothing is claimed: the BFF could keep neither the
// addresses nor the once.

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log"
	"mime"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// numberMoveSweep is how often the moves are claimed and the mails owed are sent.
const numberMoveSweep = 30 * time.Second

// numberMoveMail is what each address is told: the words of Lens's push to the person's devices (B61.30, B61.104).
var numberMoveMail = map[string]string{
	"operator": "Your phone number on Talyvor was changed by our help team. If this was not you, contact help now.",
	"person":   "Your phone number on Talyvor was changed. If this was not you, contact help now.",
}

const numberMoveSubject = "Your phone number on Talyvor was changed"

// numberMove is one move Lens handed over.
type numberMove struct {
	ID       string    `json:"id"`
	PersonID string    `json:"person_id"`
	Identity string    `json:"identity"`
	MovedAt  time.Time `json:"moved_at"`
	By       string    `json:"by"`
}

// mailer sends one plain-text mail.
type mailer interface {
	send(ctx context.Context, to, subject, body string) error
}

// rememberEmail keeps an address of sub's, given for ws's contact check, for a move of their number to tell. A failure
// costs only that mail, so it never fails the request that gave it. An account Talyvor closed keeps none.
func (a *app) rememberEmail(ctx context.Context, sub, ws, email string) {
	email = strings.ToLower(strings.TrimSpace(email))
	if a.oauth.db == nil || sub == "" || ws == "" || !plainAddress(email) {
		return
	}
	if shut, err := a.help.isClosed(ctx, ws); err != nil || shut {
		return
	}
	if err := pgx.BeginFunc(ctx, a.oauth.db.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO person_emails (sub, email, last_seen_at) VALUES ($1, $2, now())
			ON CONFLICT (sub, email) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`, sub, email); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO person_email_accounts (sub, email, workspace_id) VALUES ($1, $2, $3)
			ON CONFLICT DO NOTHING`, sub, email, ws)
		return err
	}); err != nil {
		log.Printf("bff: an address of sub=%s could not be kept: %v", sub, err)
	}
}

// forgetClosedAccountsAddresses deletes what ws's closing owes (B61.122): the addresses given for ws alone, their mails,
// and the sub of every move of a person left with no address. sub, when known, is the person reading ws's requests: an
// address of theirs kept before addresses carried their account goes too. Without sub such an address stays, as it may
// be one their account still open is told by.
func (a *app) forgetClosedAccountsAddresses(ctx context.Context, ws, sub string) error {
	if a.oauth.db == nil || ws == "" {
		return nil
	}
	pool := a.oauth.db.pool
	rows, _ := pool.Query(ctx, `SELECT sub, email FROM person_email_accounts WHERE workspace_id = $1
		UNION SELECT e.sub, e.email FROM person_emails e WHERE e.sub = $2 AND $2 <> ''
			AND NOT EXISTS (SELECT 1 FROM person_email_accounts x WHERE x.sub = e.sub AND x.email = e.email)`, ws, sub)
	type kept struct{ sub, email string }
	pairs, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (k kept, err error) { return k, r.Scan(&k.sub, &k.email) })
	if err != nil || len(pairs) == 0 {
		return err
	}
	subs, emails := make([]string, len(pairs)), make([]string, len(pairs))
	for i, k := range pairs {
		subs[i], emails[i] = k.sub, k.email
	}
	// A blanked move can no longer end its person's sessions, so the ones owed are ended first; until they are, nothing goes.
	if err := a.endMovedPeople(ctx); err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM person_email_accounts WHERE workspace_id = $1`, ws); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM person_emails e USING unnest($1::text[], $2::text[]) AS g (sub, email)
			WHERE e.sub = g.sub AND e.email = g.email
				AND NOT EXISTS (SELECT 1 FROM person_email_accounts x WHERE x.sub = e.sub AND x.email = e.email)`, subs, emails); err != nil {
			return err
		}
		for _, q := range []string{
			`DELETE FROM number_move_mails x USING number_moves m WHERE m.id = x.move_id AND m.sub = ANY($1)
				AND NOT EXISTS (SELECT 1 FROM person_emails e WHERE e.sub = m.sub AND e.email = x.email)`,
			`UPDATE number_moves m SET sub = '' WHERE m.sub = ANY($1)
				AND (m.moved_by = 'person' OR m.sessions_ended_at IS NOT NULL)
				AND NOT EXISTS (SELECT 1 FROM person_emails e WHERE e.sub = m.sub)`,
		} {
			if _, err := tx.Exec(ctx, q, subs); err != nil {
				return err
			}
		}
		return nil
	})
}

// relayStatus is a ResponseWriter that remembers the status written through it (200 when only a body was).
type relayStatus struct {
	http.ResponseWriter
	code int
}

func (w *relayStatus) WriteHeader(code int) {
	if w.code == 0 {
		w.code = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *relayStatus) Write(b []byte) (int, error) {
	if w.code == 0 {
		w.code = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}

// keepTellingNumberMoves claims and tells the moves now and every numberMoveSweep until ctx ends.
func (a *app) keepTellingNumberMoves(ctx context.Context) {
	if a.oauth.db == nil {
		log.Printf("bff: BFF_DATABASE_URL unset — a number Lens moves is not told to the person's email addresses")
		return
	}
	if a.mail == nil {
		log.Printf("bff: BFF_SMTP_HOST or BFF_EMAIL_FROM unset — the mails a moved number owes are kept until they are set")
	}
	t := time.NewTicker(numberMoveSweep)
	defer t.Stop()
	for {
		a.tellNumberMoves(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// tellNumberMoves claims what Lens has, ends the sessions an operator's move owes, and sends the mails owed.
func (a *app) tellNumberMoves(ctx context.Context) {
	if err := a.claimNumberMoves(ctx); err != nil {
		log.Printf("bff: number moves could not be claimed from Lens: %v", err)
	}
	if err := a.endMovedPeople(ctx); err != nil {
		log.Printf("bff: the sessions of a moved number could not be ended, tried again in %s: %v", numberMoveSweep, err)
	}
	if err := a.sendNumberMoveMails(ctx); err != nil {
		log.Printf("bff: number-move mails: %v", err)
	}
}

// claimNumberMoves takes Lens's moves and keeps each, with a mail for each address its person gave.
func (a *app) claimNumberMoves(ctx context.Context) error {
	var out struct {
		Moves []numberMove `json:"moves"`
	}
	if err := a.lensDoor(ctx, "/v1/auth/phone/number-moves/claim", map[string]string{}, &out); err != nil {
		return err
	}
	var failed error
	for _, m := range out.Moves {
		sub, ok := a.subOf(m.Identity)
		if !ok {
			// Still kept, so the move is on record here; no address of theirs is known to this BFF.
			log.Printf("bff: number move %s is for a person whose identity this BFF did not make (person=%s)", m.ID, m.PersonID)
		}
		if numberMoveMail[m.By] == "" {
			m.By = "operator" // a move Lens names no mover for was help's (B61.30 came before "by")
		}
		err := pgx.BeginFunc(ctx, a.oauth.db.pool, func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `
				WITH m AS (INSERT INTO number_moves (id, person_id, sub, moved_by, moved_at, claimed_at)
					VALUES ($1, $2, $3, $4, $5, now()) ON CONFLICT (id) DO NOTHING RETURNING id, sub)
				INSERT INTO number_move_mails (move_id, email)
					SELECT m.id, e.email FROM m JOIN person_emails e ON e.sub = m.sub
				ON CONFLICT (move_id, email) DO NOTHING`, m.ID, m.PersonID, sub, m.By, m.MovedAt)
			return err
		})
		if err != nil {
			// Lens hands a move over once, so the rest of the batch is still kept rather than lost with this one.
			failed = errors.Join(failed, fmt.Errorf("move %s (person=%s) was claimed and could not be kept: %w", m.ID, m.PersonID, err))
			continue
		}
		log.Printf("bff: number move %s claimed (person=%s, by=%s)", m.ID, m.PersonID, m.By)
	}
	return failed
}

// endMovedPeople ends, everywhere, each person an operator moved and not yet ended.
func (a *app) endMovedPeople(ctx context.Context) error {
	rows, _ := a.oauth.db.pool.Query(ctx, `SELECT id, sub FROM number_moves
		WHERE moved_by = 'operator' AND sessions_ended_at IS NULL AND sub <> '' ORDER BY moved_at, id`)
	type owed struct{ id, sub string }
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (o owed, err error) { return o, r.Scan(&o.id, &o.sub) })
	if err != nil {
		return err
	}
	for _, o := range list {
		at := time.Now()
		if err := a.oauth.db.endPerson(ctx, o.sub, "", at, false, func() {
			a.oauth.grants.deleteWhere(func(g oauthGrant) bool { return g.Who.sub == o.sub })
			a.oauth.codes.deleteWhere(func(c oauthCode) bool { return c.who.sub == o.sub })
			if a.auth != nil {
				a.auth.endPerson(o.sub, at)
			}
		}); err != nil {
			return err
		}
		a.connectionsEnded()
		if _, err := a.oauth.db.pool.Exec(ctx, `UPDATE number_moves SET sessions_ended_at = $2 WHERE id = $1`, o.id, at); err != nil {
			return err
		}
		log.Printf("bff: number move %s: every session of sub=%s ended", o.id, o.sub)
	}
	return nil
}

// sendNumberMoveMails sends each mail owed, once: marked sent first, and unmarked only when the sender refused it for
// now, to be tried again a sweep later; one it refused for good (a 5xx) is marked failed. Neither holds up the rest.
func (a *app) sendNumberMoveMails(ctx context.Context) error {
	if a.mail == nil {
		return nil
	}
	var failed error
	for {
		var moveID, email, by string
		err := a.oauth.db.pool.QueryRow(ctx, `UPDATE number_move_mails x SET sent_at = now()
			FROM number_moves m
			WHERE m.id = x.move_id AND (x.move_id, x.email) = (SELECT move_id, email FROM number_move_mails
				WHERE sent_at IS NULL AND failed_at IS NULL AND next_try_at <= now()
				ORDER BY next_try_at, move_id, email LIMIT 1 FOR UPDATE SKIP LOCKED)
			RETURNING x.move_id, x.email, m.moved_by`).Scan(&moveID, &email, &by)
		if errors.Is(err, pgx.ErrNoRows) {
			return failed
		}
		if err != nil {
			return errors.Join(failed, err)
		}
		serr := a.mail.send(ctx, email, numberMoveSubject, numberMoveMail[by])
		if serr == nil {
			log.Printf("bff: number move %s told by mail", moveID)
			continue
		}
		var refused *textproto.Error
		forGood := errors.As(serr, &refused) && refused.Code >= 500
		if _, err := a.oauth.db.pool.Exec(ctx, `UPDATE number_move_mails SET sent_at = NULL,
			failed_at = CASE WHEN $3 THEN now() END, next_try_at = now() + $4::interval
			WHERE move_id = $1 AND email = $2`, moveID, email, forGood, numberMoveSweep.String()); err != nil {
			return errors.Join(failed, err)
		}
		if forGood {
			failed = errors.Join(failed, fmt.Errorf("move %s: the mail server refused an address for good: %w", moveID, serr))
		} else {
			failed = errors.Join(failed, fmt.Errorf("move %s, sent again in %s: %w", moveID, numberMoveSweep, serr))
		}
	}
}

// smtpMailer sends over SMTP. Port 465 speaks TLS from the first byte; any other port must offer STARTTLS, except on
// loopback.
type smtpMailer struct {
	host, user, password, from string
	port                       int
}

func (s smtpMailer) send(ctx context.Context, to, subject, body string) error {
	if !plainAddress(to) {
		return &textproto.Error{Code: 553, Msg: "not a plain email address"}
	}
	addr := net.JoinHostPort(s.host, strconv.Itoa(s.port))
	d := net.Dialer{Timeout: 15 * time.Second}
	var conn net.Conn
	var err error
	if s.port == 465 {
		conn, err = (&tls.Dialer{NetDialer: &d, Config: &tls.Config{ServerName: s.host, MinVersion: tls.VersionTLS12}}).DialContext(ctx, "tcp", addr)
	} else {
		conn, err = d.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return err
	}
	_ = conn.SetDeadline(time.Now().Add(30 * time.Second))
	c, err := smtp.NewClient(conn, s.host)
	if err != nil {
		_ = conn.Close()
		return err
	}
	defer func() { _ = c.Close() }()
	if ok, _ := c.Extension("STARTTLS"); ok && s.port != 465 {
		if err := c.StartTLS(&tls.Config{ServerName: s.host, MinVersion: tls.VersionTLS12}); err != nil {
			return err
		}
	} else if s.port != 465 && !isLoopbackHost(s.host) {
		return fmt.Errorf("%s offers no STARTTLS", s.host) // a stripped offer must not turn into mail in the clear
	}
	if s.user != "" {
		if err := c.Auth(smtp.PlainAuth("", s.user, s.password, s.host)); err != nil {
			return err
		}
	}
	from, err := mail.ParseAddress(s.from)
	if err != nil {
		return err
	}
	if err := c.Mail(from.Address); err != nil {
		return err
	}
	if err := c.Rcpt(to); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nMIME-Version: 1.0\r\n"+
		"Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n%s\r\n",
		s.from, to, mime.QEncoding.Encode("utf-8", subject), time.Now().UTC().Format(time.RFC1123Z), body)
	if _, err := w.Write([]byte(msg)); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}

// plainAddress is a bare email address and nothing else: no name, no line break that could start another header.
func plainAddress(s string) bool {
	a, err := mail.ParseAddress(s)
	return err == nil && a.Address == s && !strings.ContainsAny(s, "\r\n")
}

// smtpFromEnv is the sender BFF_SMTP_* and BFF_EMAIL_FROM name; ok is false while the host or the From is unset.
func smtpFromEnv() (smtpMailer, bool, error) {
	s := smtpMailer{host: strings.TrimSpace(os.Getenv("BFF_SMTP_HOST")), user: os.Getenv("BFF_SMTP_USER"),
		password: os.Getenv("BFF_SMTP_PASSWORD"), from: strings.TrimSpace(os.Getenv("BFF_EMAIL_FROM")), port: 465}
	if s.host == "" || s.from == "" {
		return s, false, nil
	}
	if _, err := mail.ParseAddress(s.from); err != nil {
		return s, false, errors.New("BFF_EMAIL_FROM must be an email address")
	}
	if v := strings.TrimSpace(os.Getenv("BFF_SMTP_PORT")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 65535 {
			return s, false, errors.New("BFF_SMTP_PORT must be a port number")
		}
		s.port = n
	}
	return s, true, nil
}
