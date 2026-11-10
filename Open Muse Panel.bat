@echo off
start "" msedge --user-data-dir="%LOCALAPPDATA%\MusePanelProfile" --enable-experimental-web-platform-features --enable-features=WebBluetoothNewPermissionsBackend --window-size=1600,930 --app="file:///%~dp0muse-panel.html"
