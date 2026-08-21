@echo off

:: 文件存在性验证脚本
:: 用于检查项目立项文档是否存在

echo 🔍 正在检查文件...
echo.

:: 检查文件是否存在
if exist "D:\桌面\振迅新科\蝶翅-app\项目立项.md" (
    echo ✅ 文件存在！
    echo.
    echo 📄 文件信息：
    echo   路径：D:\桌面\振迅新科\蝶翅-app\项目立项.md
    echo   大小：%~z1 字节
    echo   创建时间：%~t1
    echo.
    echo 📝 文件内容预览（前5行）：
    echo   ----------------------------------------
    for /f "tokens=1-3 delims=¶" %%a in ('type "D:\桌面\振迅新科\蝶翅-app\项目立项.md" ^| findstr /n . ^| findstr "^[1-5]:"') do echo   %%b
    echo   ----------------------------------------
    echo.
    echo 🎉 文件已成功创建并可访问！
    pause
) else (
    echo ❌ 文件不存在！
    echo.
    echo 🔍 正在检查目录...
    if exist "D:\桌面\振迅新科\蝶翅-app" (
        echo ✅ 目录存在
        echo 📂 目录内容：
        dir "D:\桌面\振迅新科\蝶翅-app"
    ) else (
        echo ❌ 目录也不存在
        echo 💡 可能需要重新创建文件
    )
    pause
)
