package main

import (
	"embed"
	"io/fs"
	"log"
	"runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:desktop/generated/frontend
var frontend embed.FS

func main() {
	assets, err := fs.Sub(frontend, "desktop/generated/frontend")
	if err != nil {
		log.Fatal(err)
	}
	app := &App{}
	var appMenu *menu.Menu
	if runtime.GOOS == "darwin" {
		appMenu = menu.NewMenu()
		appMenu.Append(menu.AppMenu())
		appMenu.Append(menu.EditMenu())
	}
	err = wails.Run(&options.App{
		Title: "Make Me YAML!", Width: 1280, Height: 900, MinWidth: 640, MinHeight: 500,
		BackgroundColour: options.NewRGB(255, 250, 238),
		AssetServer:      &assetserver.Options{Assets: assets},
		Menu:             appMenu, OnStartup: app.startup, OnShutdown: app.shutdown,
		OnBeforeClose: app.beforeClose, Bind: []interface{}{app},
	})
	if err != nil {
		log.Fatal(err)
	}
}
