package main

import "testing"

func TestLoadConfigSessionLimit(t *testing.T) {
	t.Setenv("COMBO_BASE", "https://combo.example")
	t.Setenv("COMBO_PAIR_ID", "pair")
	t.Setenv("COMBO_CODE", "code")
	t.Setenv("COMBO_SESSION_LIMIT", "50")

	cfg, err := loadConfig()
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}
	if cfg.SessionLimit != 50 {
		t.Fatalf("SessionLimit = %d, want 50", cfg.SessionLimit)
	}
}
