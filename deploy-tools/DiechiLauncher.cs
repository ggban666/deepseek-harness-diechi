using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Windows.Forms;

class DiechiLauncher
{
    static string logFile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "蝶翅APP 启动日志.txt");

    static void Log(string message)
    {
        string line = "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + message;
        try { File.AppendAllText(logFile, line + Environment.NewLine, Encoding.UTF8); } catch { }
    }

    static void SafeTitle(string t) { try { Console.Title = t; } catch { } }
    static void SafeWrite(string s) { try { Console.Write(s); } catch { } }
    static void SafeWriteLine(string s) { try { Console.WriteLine(s); } catch { } }
    static void SafeColor(ConsoleColor c) { try { Console.ForegroundColor = c; } catch { } }
    static void SafeReset() { try { Console.ResetColor(); } catch { } }
    static void SafeReadKey() { try { Console.ReadKey(); } catch { Thread.Sleep(3000); } }
    static void ShowError(string msg) { try { MessageBox.Show(msg, "蝶翅APP 启动器", MessageBoxButtons.OK, MessageBoxIcon.Error); } catch { } }

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

        string harnessPath = @"D:\桌面\振翅科技\蝶翅-app\diechi-harness";
        string dataHome = @"D:\桌面\振翅科技\蝶翅-app\diechi-home";
        string pnpmPath = @"C:\Users\wang\AppData\Roaming\npm\pnpm.cmd";
        int port = 3090;

        try
        {
            Log("启动器开始运行");
            SafeWriteLine("正在停止占用端口 " + port + " 的旧进程...");
            HashSet<int> portPids = FindPidsOnPort(port);
            foreach (Process p in Process.GetProcessesByName("node"))
            {
                if (portPids.Contains(p.Id)) { try { p.Kill(); p.WaitForExit(3000); } catch { } }
            }
            SafeWriteLine("旧进程已停止");
            Log("旧进程已停止");

            int visionPort = 8080;
            string visionPython = @"D:\vllm-env\Scripts\python.exe";
            string visionScript = @"D:\桌面\振翅科技\蝶翅-app\deploy-tools\vision-server.py";
            SafeWriteLine("正在停止占用端口 " + visionPort + " 的旧视觉服务...");
            HashSet<int> visionPids = FindPidsOnPort(visionPort);
            foreach (Process p in Process.GetProcessesByName("python"))
            {
                if (visionPids.Contains(p.Id)) { try { p.Kill(); p.WaitForExit(3000); } catch { } }
            }
            if (File.Exists(visionPython) && File.Exists(visionScript))
            {
                SafeWriteLine("正在启动本地视觉+语音服务...");
                Log("启动视觉服务: " + visionPython + " " + visionScript);
                ProcessStartInfo vpsi = new ProcessStartInfo
                {
                    FileName = visionPython,
                    Arguments = "\"" + visionScript + "\" " + visionPort,
                    WorkingDirectory = @"D:\桌面\振翅科技\蝶翅-app\deploy-tools",
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                vpsi.EnvironmentVariables["CUDA_PATH"] = @"D:\cuda-root";
                vpsi.EnvironmentVariables["CUDA_LIB_PATH"] = @"D:\cuda-root\bin";
                try
                {
                    Process vproc = Process.Start(vpsi);
                    Log("视觉服务进程ID: " + vproc.Id);
                }
                catch (Exception ve) { Log("视觉服务启动失败: " + ve.Message); }
            }
            else
            {
                SafeWriteLine("警告: 未找到视觉服务文件，跳过（识别/视频功能不可用）");
                Log("视觉服务文件缺失，跳过");
            }

            if (!Directory.Exists(harnessPath)) throw new Exception("Harness路径不存在: " + harnessPath);
            if (!Directory.Exists(dataHome)) throw new Exception("数据目录不存在: " + dataHome);

            SafeWriteLine("正在启动 蝶翅APP...");
            Log("当前目录: " + harnessPath);
            Log("数据目录: " + dataHome);
            Log("启动命令: " + pnpmPath + " dsh web --port " + port);

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/c \"" + pnpmPath + "\" dsh web --port " + port,
                WorkingDirectory = harnessPath,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            psi.EnvironmentVariables["DSH_HOME"] = dataHome;
            string npmDir = @"C:\Users\wang\AppData\Roaming\npm";
            string currentPath = psi.EnvironmentVariables["PATH"];
            psi.EnvironmentVariables["PATH"] = npmDir + ";" + (currentPath == null ? "" : currentPath);
            Process proc = Process.Start(psi);
            SafeWriteLine("进程已启动 (PID: " + proc.Id + ")");
            Log("进程ID: " + proc.Id);

            SafeWriteLine("等待服务启动（最多4分钟，首次 tsx 编译较慢）...");
            bool ready = false;
            for (int i = 0; i < 240; i++)
            {
                Thread.Sleep(1000);
                try
                {
                    System.Net.HttpWebRequest req = (System.Net.HttpWebRequest)System.Net.WebRequest.Create("http://127.0.0.1:" + port + "/");
                    req.Timeout = 1500;
                    using (System.Net.HttpWebResponse resp = (System.Net.HttpWebResponse)req.GetResponse())
                    {
                        if ((int)resp.StatusCode == 200) { ready = true; break; }
                    }
                }
                catch { }
            }

            SafeWriteLine("");
            SafeColor(ConsoleColor.Green);
            SafeWriteLine("==================================================");
            SafeWriteLine("  启动" + (ready ? "完成！" : "超时，请查看日志"));
            SafeWriteLine("==================================================");
            SafeReset();
            SafeWriteLine("");
            SafeWriteLine("访问地址: http://127.0.0.1:" + port);
            SafeWriteLine("日志文件: " + logFile);
            SafeWriteLine("");

            Log(ready ? "启动完成" : "启动超时（240 秒未就绪）");
            Log("访问地址: http://127.0.0.1:" + port);

            if (ready)
            {
                try { Process.Start(new ProcessStartInfo { FileName = "http://127.0.0.1:" + port, UseShellExecute = true }); } catch { }
            }
            else
            {
                ShowError("蝶翅APP 240 秒内未能启动，请查看日志:\n" + logFile);
            }

            SafeWriteLine("按任意键关闭窗口...");
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

    static HashSet<int> FindPidsOnPort(int port)
    {
        HashSet<int> pids = new HashSet<int>();
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo("netstat", "-ano")
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                CreateNoWindow = true
            };
            using (Process p = Process.Start(psi))
            {
                string output = p.StandardOutput.ReadToEnd();
                foreach (string line in output.Split('\n'))
                {
                    if (line.Contains(":" + port))
                    {
                        string[] parts = line.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                        if (parts.Length > 0)
                        {
                            int pid;
                            if (int.TryParse(parts[parts.Length - 1], out pid))
                                pids.Add(pid);
                        }
                    }
                }
            }
        }
        catch { }
        return pids;
    }
}