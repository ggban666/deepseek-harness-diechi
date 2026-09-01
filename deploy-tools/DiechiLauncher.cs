using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

// 蝶翅APP 启动器（纯 GUI，无控制台黑窗口）
// 职责：一键拉起本地 Qwen3.8 懒加载代理(8081) + 主服务(3090) + 自动开浏览器。
// 中文全部走 GUI 原生渲染，彻底规避 cmd 代码页/UTF-8 乱码问题。

class DiechiLauncher
{
    static string BaseDir = AppDomain.CurrentDomain.BaseDirectory;
    static string LogFile = Path.Combine(BaseDir, "DiechiLauncher.log");

    // 关键路径（以启动器所在目录为基准；启动器放在蝶翅-app 根目录）
    static string AppRoot;          // 蝶翅-app 根目录
    static string Harness;          // diechi-harness
    static string DshHome;          // diechi-home
    static string VendorNode;       // vendor/node/node.exe
    static string VendorPython;     // vendor/python/python.exe
    static string EnginePy;         // deploy-tools/evolve/engine.py
    static string Qwen38Model;      // 本地 Qwen3.8 模型 gguf

    static Form _form;
    static TextBox _log;
    static Button _btnStart;
    static Button _btnOpen;
    static Button _btnStop;
    static Label _status;
    static System.Windows.Forms.Timer _poll;

    const int PortMain = 3090;
    const int PortLazy = 8081;

    static void Log(string msg)
    {
        string line = "[" + DateTime.Now.ToString("HH:mm:ss") + "] " + msg;
        try { File.AppendAllText(LogFile, line + Environment.NewLine, Encoding.UTF8); } catch { }
        if (_log != null)
        {
            _log.AppendText(line + Environment.NewLine);
        }
    }

    static void SetStatus(string text, Color color)
    {
        if (_status == null) return;
        _status.Text = text;
        _status.ForeColor = color;
    }

    static void AppendUi(string msg)
    {
        if (_log != null)
        {
            if (_log.InvokeRequired)
                _log.BeginInvoke(new Action(() => _log.AppendText(msg + Environment.NewLine)));
            else
                _log.AppendText(msg + Environment.NewLine);
        }
    }

    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        BuildPaths();
        _form = BuildForm();
        Application.Run(_form);
    }

    static void BuildPaths()
    {
        // 定位蝶翅-app 根目录：启动器在根目录时 BaseDir 即根；在 deploy-tools 时上一级是根。
        string probe = Path.Combine(BaseDir, "deploy-tools", "start-diechi.cmd");
        if (File.Exists(probe))
        {
            AppRoot = Path.GetFullPath(BaseDir);
        }
        else
        {
            AppRoot = Path.GetFullPath(Path.Combine(BaseDir, ".."));
        }

        Harness   = Path.Combine(AppRoot, "diechi-harness");
        DshHome   = Path.Combine(AppRoot, "diechi-home");
        VendorNode   = Path.Combine(AppRoot, "vendor", "node", "node.exe");
        VendorPython = Path.Combine(AppRoot, "vendor", "python", "python.exe");
        EnginePy  = Path.Combine(AppRoot, "deploy-tools", "evolve", "engine.py");
        Qwen38Model = Path.Combine(AppRoot, "models", "Qwen3.8-27B-UD-IQ1_S", "Qwen3.8-27B-UD-IQ1_S.gguf");
    }

    static Form BuildForm()
    {
        var f = new Form
        {
            Text = "蝶翅APP 启动器",
            Width = 560,
            Height = 460,
            StartPosition = FormStartPosition.CenterScreen,
            Font = new Font("Microsoft YaHei UI", 9f),
            FormBorderStyle = FormBorderStyle.FixedSingle,
            MaximizeBox = false,
            BackColor = Color.FromArgb(24, 26, 32),
            ForeColor = Color.FromArgb(230, 230, 230)
        };

        var title = new Label
        {
            Text = "蝶翅APP",
            Font = new Font("Microsoft YaHei UI", 18f, FontStyle.Bold),
            ForeColor = Color.FromArgb(120, 200, 255),
            AutoSize = true,
            Location = new Point(24, 20)
        };
        f.Controls.Add(title);

        var subtitle = new Label
        {
            Text = "一键启动本地 AI 工作台（Qwen3.8 对话 + 视觉语音 + 三架构自进化）",
            ForeColor = Color.FromArgb(160, 160, 170),
            AutoSize = true,
            Location = new Point(26, 58)
        };
        f.Controls.Add(subtitle);

        _status = new Label
        {
            Text = "就绪",
            ForeColor = Color.FromArgb(180, 180, 180),
            AutoSize = true,
            Location = new Point(26, 86)
        };
        f.Controls.Add(_status);

        _log = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            BackColor = Color.FromArgb(16, 17, 22),
            ForeColor = Color.FromArgb(200, 200, 210),
            BorderStyle = BorderStyle.FixedSingle,
            Font = new Font("Consolas", 9f),
            Location = new Point(24, 116),
            Size = new Size(496, 220),
            WordWrap = false
        };
        f.Controls.Add(_log);

        _btnStart = new Button
        {
            Text = "一键启动",
            BackColor = Color.FromArgb(46, 120, 200),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
            Size = new Size(110, 40),
            Location = new Point(24, 350),
            Cursor = Cursors.Hand
        };
        _btnStart.FlatAppearance.BorderSize = 0;
        _btnStart.Click += (s, e) => { Task.Run(() => StartAll()); };
        f.Controls.Add(_btnStart);

        _btnOpen = new Button
        {
            Text = "打开界面",
            BackColor = Color.FromArgb(60, 66, 80),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
            Size = new Size(110, 40),
            Location = new Point(150, 350),
            Cursor = Cursors.Hand,
            Enabled = false
        };
        _btnOpen.FlatAppearance.BorderSize = 0;
        _btnOpen.Click += (s, e) => OpenBrowser();
        f.Controls.Add(_btnOpen);

        _btnStop = new Button
        {
            Text = "停止服务",
            BackColor = Color.FromArgb(160, 50, 50),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
            Size = new Size(110, 40),
            Location = new Point(276, 350),
            Cursor = Cursors.Hand
        };
        _btnStop.FlatAppearance.BorderSize = 0;
        _btnStop.Click += (s, e) => { Task.Run(() => StopAll()); };
        f.Controls.Add(_btnStop);

        var hint = new Label
        {
            Text = "访问地址: http://127.0.0.1:" + PortMain,
            ForeColor = Color.FromArgb(140, 140, 150),
            AutoSize = true,
            Location = new Point(26, 404)
        };
        f.Controls.Add(hint);

        // 轮询端口状态，刷新按钮可用性
        _poll = new System.Windows.Forms.Timer { Interval = 1500 };
        _poll.Tick += (s, e) => RefreshState();
        _poll.Start();

        f.Shown += (s, e) => RefreshState();
        return f;
    }

    static void RefreshState()
    {
        bool mainUp = IsListening(PortMain);
        _btnOpen.Enabled = mainUp;
        if (mainUp)
            SetStatus("服务运行中 (3090)", Color.FromArgb(110, 220, 130));
        else
            SetStatus("服务未启动", Color.FromArgb(200, 160, 80));
    }

    static bool IsListening(int port)
    {
        try
        {
            using (var p = new Process())
            {
                p.StartInfo.FileName = "netstat";
                p.StartInfo.Arguments = "-ano";
                p.StartInfo.UseShellExecute = false;
                p.StartInfo.RedirectStandardOutput = true;
                p.StartInfo.CreateNoWindow = true;
                p.Start();
                string output = p.StandardOutput.ReadToEnd();
                p.WaitForExit(4000);
                string needle = ":" + port + " ";
                foreach (string line in output.Split('\n'))
                    if (line.Contains(needle) && line.Contains("LISTENING"))
                        return true;
            }
        }
        catch { }
        return false;
    }

    static void StartAll()
    {
        _btnStart.Enabled = false;
        SetStatus("正在检查环境...", Color.FromArgb(200, 160, 80));

        // 1. 校验关键文件
        if (!File.Exists(VendorNode))
        {
            Fail("找不到 Node 运行时: " + VendorNode + "\n请先运行 setup-vendor.cmd 创建 vendor 目录。");
            return;
        }
        if (!File.Exists(VendorPython))
        {
            Fail("找不到 Python 运行时: " + VendorPython + "\n请先运行 setup-vendor.cmd 创建 vendor 目录。");
            return;
        }
        if (!File.Exists(EnginePy))
        {
            Fail("找不到懒加载引擎: " + EnginePy);
            return;
        }
        if (!File.Exists(Qwen38Model))
        {
            Fail("找不到本地模型: " + Qwen38Model);
            return;
        }
        string binJs = Path.Combine(Harness, "apps", "cli", "lib", "bin.js");
        if (!File.Exists(binJs))
        {
            Fail("找不到主服务入口: " + binJs + "\n请先在 diechi-harness 执行 tsc -b 构建。");
            return;
        }

        // 2. 主服务已在跑则直接开浏览器
        if (IsListening(PortMain))
        {
            AppendUi("[跳过] 主服务已在 3090 运行");
            SetStatus("服务已在运行", Color.FromArgb(110, 220, 130));
            OpenBrowser();
            _btnStart.Enabled = true;
            return;
        }

        // 3. 拉起 8081 懒加载代理
        try
        {
            if (!IsListening(PortLazy))
            {
                AppendUi("[启动] 本地 Qwen3.8 懒加载代理 (8081)...");
                var psi = new ProcessStartInfo
                {
                    FileName = VendorPython,
                    Arguments = "\"" + EnginePy + "\" serve-lazy --model \"" + Qwen38Model + "\" --port " + PortLazy + " --internal-port 18081 --ngl 99 --ctx 32768 --idle-sec 600",
                    WorkingDirectory = Path.GetDirectoryName(EnginePy),
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                var proc = Process.Start(psi);
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();
                AppendUi("[OK] 8081 懒加载代理已拉起 (PID " + proc.Id + ")");
            }
            else
            {
                AppendUi("[跳过] 8081 代理已在运行");
            }
        }
        catch (Exception ex)
        {
            AppendUi("[警告] 8081 代理启动异常: " + ex.Message);
        }

        // 4. 拉起 3090 主服务（独立进程，不随本窗口退出）
        try
        {
            AppendUi("[启动] 主服务 (3090)...");
            var psi = new ProcessStartInfo
            {
                FileName = VendorNode,
                Arguments = "apps/cli/lib/bin.js web --port " + PortMain,
                WorkingDirectory = Harness,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            psi.EnvironmentVariables["DSH_HOME"] = DshHome;
            psi.EnvironmentVariables["QWEN38_API_KEY"] = "sk-local-dummy";
            psi.EnvironmentVariables["EVOLVE_ENGINE_URL"] = "http://127.0.0.1:" + PortLazy + "/v1";
            psi.EnvironmentVariables["EVOLVE_ENGINE_MODEL"] = "Qwen3.8-27B-UD-IQ1_S";
            var proc = Process.Start(psi);
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();
            AppendUi("[OK] 主服务已拉起 (PID " + proc.Id + ")");
        }
        catch (Exception ex)
        {
            Fail("主服务启动失败: " + ex.Message);
            return;
        }

        // 5. 等待 3090 就绪后开浏览器
        SetStatus("等待主服务就绪...", Color.FromArgb(200, 160, 80));
        Task.Run(() =>
        {
            for (int i = 0; i < 45; i++)
            {
                if (IsListening(PortMain)) break;
                System.Threading.Thread.Sleep(2000);
            }
            if (IsListening(PortMain))
            {
                SetStatus("服务运行中 (3090)", Color.FromArgb(110, 220, 130));
                AppendUi("[就绪] 主服务已监听 3090，打开浏览器");
                OpenBrowser();
            }
            else
            {
                SetStatus("启动超时（90 秒）", Color.FromArgb(220, 90, 90));
                AppendUi("[超时] 主服务 90 秒内未就绪，请查看日志");
            }
            _btnStart.Enabled = true;
        });
    }

    static void StopAll()
    {
        SetStatus("正在停止服务...", Color.FromArgb(200, 160, 80));
        KillByPort(PortMain);
        KillByPort(PortLazy);
        KillByPort(18081);
        AppendUi("[停止] 已尝试停止 3090 / 8081 / 18081 相关进程");
        SetStatus("服务未启动", Color.FromArgb(200, 160, 80));
    }

    static void KillByPort(int port)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/c for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :" + port + " ^| findstr LISTENING') do taskkill /F /PID %a >nul 2>&1",
                UseShellExecute = false,
                CreateNoWindow = true
            };
            Process.Start(psi);
        }
        catch { }
    }

    static void OpenBrowser()
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "http://127.0.0.1:" + PortMain,
                UseShellExecute = true
            });
        }
        catch { }
    }

    static void Fail(string msg)
    {
        SetStatus("启动失败", Color.FromArgb(220, 90, 90));
        AppendUi("[错误] " + msg.Replace("\n", " "));
        MessageBox.Show(msg, "蝶翅APP 启动器", MessageBoxButtons.OK, MessageBoxIcon.Error);
        _btnStart.Enabled = true;
    }
}
