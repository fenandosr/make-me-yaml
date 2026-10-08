package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBundledEngine(t *testing.T) {
	engine := newEngine(context.Background())
	t.Cleanup(engine.close)
	root := filepath.Join(t.TempDir(), "configuración con espacios")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	yaml := filepath.Join(root, "app.yaml")
	if err := os.WriteFile(yaml, []byte("# conservar comentario\nvalue: 1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	call := func(request any) Response {
		t.Helper()
		response, err := engine.call(request)
		if err != nil {
			t.Fatal(err)
		}
		if response.Status != 200 {
			t.Fatalf("status %d: %s", response.Status, response.Data)
		}
		return response
	}
	opened := call(map[string]any{"op": "open", "selection": Selection{Directory: root, Mode: "auto", ManifestName: "editor.manifest.yaml"}})
	var info struct {
		ID    string
		Count int
	}
	if err := json.Unmarshal(opened.Data, &info); err != nil {
		t.Fatal(err)
	}
	if info.ID == "" || info.Count != 1 {
		t.Fatalf("sesión inválida: %s", opened.Data)
	}
	loaded := call(map[string]any{"op": "api", "workspaceId": info.ID, "method": "GET", "url": "/api/file?path=app.yaml"})
	var file struct {
		Hash string
		Raw  string
	}
	if err := json.Unmarshal(loaded.Data, &file); err != nil {
		t.Fatal(err)
	}
	call(map[string]any{"op": "api", "workspaceId": info.ID, "method": "PUT", "url": "/api/file", "body": map[string]any{"path": "app.yaml", "baseHash": file.Hash, "raw": strings.Replace(file.Raw, "value: 1", "value: 2", 1)}})
	saved, err := os.ReadFile(yaml)
	if err != nil {
		t.Fatal(err)
	}
	if string(saved) != "# conservar comentario\nvalue: 2\n" {
		t.Fatalf("contenido inesperado: %s", saved)
	}
	history := call(map[string]any{"op": "api", "workspaceId": info.ID, "method": "GET", "url": "/api/history?path=app.yaml"})
	if !strings.Contains(string(history.Data), "version") {
		t.Fatal("sin historial")
	}
	dir := engine.dir
	engine.close()
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatal("no se eliminó el motor temporal")
	}
}
