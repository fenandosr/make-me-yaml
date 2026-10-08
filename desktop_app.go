package main

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sync/atomic"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type Selection struct {
	Directory    string `json:"directory"`
	Mode         string `json:"mode"`
	ManifestName string `json:"manifestName"`
}

type App struct {
	ctx    context.Context
	engine *Engine
	dirty  atomic.Bool
	writes atomic.Int32
}

func (a *App) startup(ctx context.Context) { a.ctx = ctx; a.engine = newEngine(ctx) }
func (a *App) shutdown(context.Context) {
	if a.engine != nil {
		a.engine.close()
	}
}

func (a *App) ChooseDirectory() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Elige la carpeta de configuración YAML", ShowHiddenFiles: true})
}

func (a *App) ChooseManifest() (Selection, error) {
	file, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Elige el manifiesto", ShowHiddenFiles: true,
		Filters: []runtime.FileFilter{{DisplayName: "Manifiestos YAML (*.yaml, *.yml)", Pattern: "*.yaml;*.yml"}},
	})
	if err != nil || file == "" {
		return Selection{}, err
	}
	return Selection{Directory: filepath.Dir(file), Mode: "manifest", ManifestName: filepath.Base(file)}, nil
}

func (a *App) InspectWorkspace(selection Selection) (Response, error) {
	return a.engine.call(map[string]any{"op": "inspect", "selection": selection})
}

func (a *App) OpenWorkspace(selection Selection) (Response, error) {
	if a.writes.Load() > 0 {
		return Response{}, fmt.Errorf("espera a que termine el guardado")
	}
	return a.engine.call(map[string]any{"op": "open", "selection": selection})
}

func (a *App) Request(workspaceID, method, url, body string) (Response, error) {
	var data any
	if body != "" {
		if err := json.Unmarshal([]byte(body), &data); err != nil {
			return Response{}, err
		}
	}
	if method == "PUT" || url == "/api/restore" {
		a.writes.Add(1)
		defer a.writes.Add(-1)
	}
	return a.engine.call(map[string]any{"op": "api", "workspaceId": workspaceID, "method": method, "url": url, "body": data})
}

func (a *App) SetDirty(dirty bool) { a.dirty.Store(dirty) }

func (a *App) beforeClose(ctx context.Context) bool {
	if a.writes.Load() > 0 {
		_, _ = runtime.MessageDialog(ctx, runtime.MessageDialogOptions{Type: runtime.InfoDialog, Title: "Guardando cambios", Message: "Espera a que termine el guardado antes de cerrar.", Buttons: []string{"Aceptar"}})
		return true
	}
	if !a.dirty.Load() {
		return false
	}
	answer, err := runtime.MessageDialog(ctx, runtime.MessageDialogOptions{
		Type: runtime.WarningDialog, Title: "Cambios sin guardar", Message: "Hay cambios sin guardar. ¿Quieres salir y descartarlos?",
		Buttons: []string{"Cancelar", "Salir"}, DefaultButton: "Cancelar", CancelButton: "Cancelar",
	})
	return err != nil || answer != "Salir"
}
