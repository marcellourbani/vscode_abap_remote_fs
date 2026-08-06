@echo off
echo 🚀 Building and Installing ABAP Intelligence Extension...
echo ⏰ Build started at %TIME% on %DATE%
set start_time=%TIME%
echo 📦 Packaging extension (vsce runs vscode:prepublish, which builds everything)...
call npx vsce package --allow-star-activation --allow-missing-repository --out "abap-fs-local.vsix"
if %errorlevel% neq 0 (
    echo ❌ Build or packaging failed!
    pause
    exit /b 1
)
echo ✅ Packaging successful!

echo 🔧 Installing extension to VS Code...
call code --install-extension "abap-fs-local.vsix" --force
if %errorlevel% neq 0 (
    echo ❌ Installation failed!
    pause
    exit /b 1
)
echo ✅ Extension installed successfully!

echo 🎉 ABAP Intelligence Extension is ready to use!
set end_time=%TIME%
echo ⏰ Build started at %start_time%
echo ⏰ Build completed at %end_time%
echo 💡 Restart VS Code or reload the window (Ctrl+Shift+P ^> 'Developer: Reload Window') to use the updated extension.
pause
