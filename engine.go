package main

import (
	"bytes"
	"compress/gzip"
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

//go:embed desktop/generated/node.gz
var nodeArchive []byte

//go:embed desktop/generated/worker.cjs
var worker []byte

//go:embed desktop/generated/runtime.json
var runtimeMetadata []byte

type Response struct {
	Status int             `json:"status"`
	Data   json.RawMessage `json:"data"`
}

// Engine sólo intercambia JSON por pipes privados. No escucha en localhost.
type Engine struct {
	mu     sync.Mutex
	ctx    context.Context
	cancel context.CancelFunc
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	input  *json.Encoder
	output *json.Decoder
	dir    string
}

func newEngine(ctx context.Context) *Engine {
	ctx, cancel := context.WithCancel(ctx)
	return &Engine{ctx: ctx, cancel: cancel}
}

func (e *Engine) start() error {
	var meta struct{ Platform, Arch string }
	if err := json.Unmarshal(runtimeMetadata, &meta); err != nil {
		return err
	}
	arch := runtime.GOARCH
	if arch == "amd64" {
		arch = "x64"
	}
	platform := runtime.GOOS
	if platform == "windows" {
		platform = "win32"
	}
	if meta.Platform != platform || meta.Arch != arch {
		return fmt.Errorf("el motor incluido es %s/%s; recompila en %s/%s", meta.Platform, meta.Arch, platform, arch)
	}
	dir, err := os.MkdirTemp("", "make-me-yaml-")
	if err != nil {
		return err
	}
	e.dir = dir
	defer func() {
		if e.cmd == nil {
			os.RemoveAll(dir)
			e.dir = ""
		}
	}()
	name := "node"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	nodePath := filepath.Join(dir, name)
	archive, err := gzip.NewReader(bytes.NewReader(nodeArchive))
	if err != nil {
		return err
	}
	defer archive.Close()
	binary, err := os.OpenFile(nodePath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0700)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(binary, archive)
	closeErr := binary.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	scriptPath := filepath.Join(dir, "worker.cjs")
	if err := os.WriteFile(scriptPath, worker, 0600); err != nil {
		return err
	}
	cmd := exec.CommandContext(e.ctx, nodePath, scriptPath)
	cmd.Dir = dir
	for _, value := range os.Environ() {
		key, _, _ := strings.Cut(value, "=")
		if !strings.EqualFold(key, "NODE_OPTIONS") && !strings.EqualFold(key, "NODE_PATH") {
			cmd.Env = append(cmd.Env, value)
		}
	}
	cmd.Stderr = os.Stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		stdin.Close()
		return err
	}
	if err := cmd.Start(); err != nil {
		stdin.Close()
		stdout.Close()
		return err
	}
	e.cmd, e.stdin = cmd, stdin
	e.input, e.output = json.NewEncoder(stdin), json.NewDecoder(stdout)
	return nil
}

func (e *Engine) call(request any) (Response, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.ctx.Err() != nil {
		return Response{}, fmt.Errorf("la aplicación se está cerrando")
	}
	if e.cmd == nil {
		if err := e.start(); err != nil {
			return Response{}, fmt.Errorf("no se pudo iniciar el motor YAML: %w", err)
		}
	}
	cmd := e.cmd
	timer := time.AfterFunc(2*time.Minute, func() { _ = cmd.Process.Kill() })
	defer timer.Stop()
	var response Response
	err := e.input.Encode(request)
	if err == nil {
		err = e.output.Decode(&response)
	}
	if err != nil {
		e.dispose()
		return Response{}, fmt.Errorf("se interrumpió el motor YAML; vuelve a abrir la carpeta: %w", err)
	}
	return response, nil
}

// Se llama con el mutex adquirido; elimina sólo el directorio temporal propio.
func (e *Engine) dispose() {
	if e.cmd != nil {
		_ = e.stdin.Close()
		_ = e.cmd.Process.Kill()
		_ = e.cmd.Wait()
		e.cmd = nil
	}
	if e.dir != "" {
		_ = os.RemoveAll(e.dir)
		e.dir = ""
	}
}

func (e *Engine) close() {
	e.cancel()
	e.mu.Lock()
	defer e.mu.Unlock()
	e.dispose()
}
