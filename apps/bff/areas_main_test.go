package main

import (
	"context"
	"os"
	"sort"
	"testing"
)

// TestMain opens every area for this package's tests: each tests its area as it behaves once the
// operator has switched it on. The gate itself is tested in areas_test.go, which puts Lens's read
// back on its own app.
func TestMain(m *testing.M) {
	areasReader = func(*app) func(context.Context, tenant) ([]string, error) {
		return func(context.Context, tenant) ([]string, error) {
			all := make([]string, 0, len(knownAreas))
			for name := range knownAreas {
				all = append(all, name)
			}
			sort.Strings(all)
			return all, nil
		}
	}
	os.Exit(m.Run())
}
