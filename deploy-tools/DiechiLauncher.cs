using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

class DiechiLauncher
{
    // 日志放在启动器自身目录，便于用户查看。
    static string logFile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "DiechiLauncher.log");

    static void Log(string message)
    {
        string line = "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + message;
        try { File.AppendAllText(logFile, line + Environment.NewLine, Encoding.UTF8); } catch { }
    }

    static void SafeTitle(string t) { try { Console.Title = t; } catch { } }
    static void SafeWriteLine(string s) { try { Console.WriteLine(s); } catch { } }
    static void SafeColor(ConsoleColor c) { try { Console.ForegroundColor = c; } catch { } }
    static void SafeReset() { try { Console.ResetColor(); } catch { } }
    static void SafeReadKey() { try { Console.ReadKey(); } catch { Thread.Sleep(3000); } }
    static void ShowError(string msg) { try { MessageBox.Show(msg, "蝶翅APP 启动器", MessageBoxButtons.OK, MessageBoxIcon.Error); } catch { } }
    static void ShowInfo(string msg) { try { MessageBox.Show(msg, "蝶翅APP 启动器", MessageBoxButtons.OK, MessageBoxIcon.Information); } catch { } }

    static int Main(string[] args)
    {
        SafeTitle("蝶翅APP 启动器 - 端口3090");
        SafeColor(ConsoleColor.Cyan);
        SafeWriteLine("==================================================");
        SafeWriteLine("  蝶翅APP 启动器");
        SafeWriteLine("  端口: 3090");
        SafeWriteLine("==================================================");
        SafeReset();
        SafeWriteLine("");

        // 启动器放在蝶翅-app根目录或deploy-tools目录均可：以自身目录为基准。
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string startCmd = Path.Combine(baseDir, "deploy-tools", "start-diechi.cmd");
        if (!File.Exists(startCmd))
        {
            // 也可能启动器本身就放在 deploy-tools 里（源码/编译输出位置）。
            startCmd = Path.Combine(baseDir, "..", "start-diechi.cmd");
            startCmd = Path.GetFullPath(startCmd);
        }
        int port = 3090;

        try
        {
            Log("启动器开始运行，baseDir=" + baseDir);

            if (!File.Exists(startCmd))
            {
                throw new FileNotFoundException("找不到启动脚本: " + startCmd + "\n请确认本启动器位于 蝶翅-app 根目录或其 deploy-tools 子目录。");
            }
            Log("使用启动脚本: " + startCmd);

            // 若服务已在运行，直接打开浏览器，避免重复启动。
            if (IsPortListening(port))
            {
                SafeWriteLine("服务已在端口 " + port + " 运行，直接打开浏览器...");
                Log("服务已运行，直接打开浏览器");
                OpenBrowser(port);
                SafeWriteLine("按任意键关闭窗口...");
                SafeReadKey();
                return 0;
            }

            SafeWriteLine("正在启动 蝶翅APP...");
            SafeWriteLine("启动脚本: " + startCmd);
            Log("启动脚本: " + startCmd);

            // 调用 start-diechi.cmd，由它统一负责：
            //  - 停止旧进程
            //  - 启动 8081 lazy proxy（本地 Qwen3.8）
            //  - 启动 3090 主服务
            //  - 打开浏览器
            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/c \"\"\"" + startCmd + "\"\"\"",
                WorkingDirectory = Path.GetDirectoryName(startCmd),
                UseShellExecute = true,   // 显示 cmd 窗口，让用户看到启动过程
                CreateNoWindow = false
            };
            Process.Start(psi);

            SafeWriteLine("启动脚本已运行，请在弹出的命令行窗口中查看进度。");
            Log("启动脚本已运行");

            SafeWriteLine("");
            SafeColor(ConsoleColor.Green);
            SafeWriteLine("==================================================");
            SafeWriteLine("  启动脚本已启动");
            SafeWriteLine("==================================================");
            SafeReset();
            SafeWriteLine("");
            SafeWriteLine("访问地址: http://127.0.0.1:" + port);
            SafeWriteLine("日志文件: " + logFile);
            SafeWriteLine("");
            SafeWriteLine("按任意键关闭本窗口（不会停止服务）...");
            SafeReadKey();
            return 0;
        }
        catch (Exception ex)
        {
            SafeColor(ConsoleColor.Red);
            SafeWriteLine("启动失败: " + ex.Message);
            SafeReset();
            Log("启动失败: " + ex.Message);
            ShowError("蝶翅APP 启动失败:\n" + ex.Message + "\n日志: " + logFile);
            SafeWriteLine("按任意键关闭窗口...");
            SafeReadKey();
            return 1;
        }
    }

    static bool IsPortListening(int port)
    {
        try
        {
            using (Process p = new Process())
            {
                p.StartInfo.FileName = "netstat";
                p.StartInfo.Arguments = "-ano";
                p.StartInfo.UseShellExecute = false;
                p.StartInfo.RedirectStandardOutput = true;
                p.StartInfo.CreateNoWindow = true;
                p.Start();
                string output = p.StandardOutput.ReadToEnd();
                p.WaitForExit(5000);
                string needle = ":" + port;
                foreach (string line in output.Split('\n'))
                {
                    if (line.Contains(needle) && line.Contains("LISTENING"))
                        return true;
                }
            }
        }
        catch (Exception ex)
        {
            Log("端口检查异常: " + ex.Message);
        }
        return false;
    }

    static void OpenBrowser(int port)
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "http://127.0.0.1:" + port,
                UseShellExecute = true
            });
        }
        catch { }
    }
}
