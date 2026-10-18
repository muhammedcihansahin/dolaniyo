// Yılan.io başlatıcısı (Oyna.exe). Derlemek için: npm run launcher (tools/launcher/build.ps1).
//
// Oda sunucusunu (8080) ve oyunu (Vite, 5173) tek pencereden başlatır, durdurur, tarayıcıda açar.
// Bütün alt süreçler bir Windows iş nesnesine (Job Object) bağlıdır: pencere kapanınca — başlatıcı
// çökse ya da Görev Yöneticisi'nden sonlandırılsa bile — sunucu ve oyunun adresi de kapanır.
// Windows'la gelen .NET Framework derleyicisiyle (C# 5) derlenir; ek kurulum gerekmez.

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Management;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace YilanLauncher
{
    internal static class Program
    {
        public const string Title = "Yılan.io Başlatıcı";

        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length == 2 && args[0] == "--write-icon")
            {
                using (var fs = File.Create(args[1])) Art.WriteIco(fs);
                return 0;
            }
            bool first;
            using (new Mutex(true, @"Local\YilanIoLauncher", out first))
            {
                // İkinci kez açılırsa yeni sunucu başlatmaz, açık pencereyi öne getirir
                if (!first)
                {
                    Native.FocusWindow(Title);
                    return 0;
                }
                Native.SetProcessDPIAware();
                using (var g = Graphics.FromHwnd(IntPtr.Zero)) Art.Scale = g.DpiX / 96f;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new LauncherForm(AppDomain.CurrentDomain.BaseDirectory));
            }
            return 0;
        }
    }

    internal enum RunState
    {
        Stopped,
        Installing,
        Starting,
        Running,
        Error,
    }

    internal sealed class LauncherForm : Form
    {
        private const int ClientPort = 5173;
        private const int ServerPort = 8080;
        private const int StartTimeoutSeconds = 90;
        private const string LocalUrl = "http://localhost:5173/";
        private const int W = 580;

        private static readonly Regex Ansi = new Regex(@"\x1B\[[0-9;?]*[ -/]*[@-~]");

        private readonly string root;
        private readonly Settings settings = Settings.Load();
        private readonly List<Process> procs = new List<Process>();
        private readonly ConcurrentQueue<string> pendingLog = new ConcurrentQueue<string>();
        private readonly System.Windows.Forms.Timer uiTimer = new System.Windows.Forms.Timer();

        private string nodeExe;
        private Job job;
        private RunState state = RunState.Stopped;
        /// <summary>Her başlatma/durdurmada artar; eski çalıştırmanın geç gelen olayları yok sayılır.</summary>
        private int runId;
        private bool openWhenReady;
        private string lanUrl;
        private int pulse;

        private Dot dot;
        private Label stateLabel;
        private Label detailLabel;
        private LinkLabel localLink;
        private LinkLabel lanLink;
        private PillButton copyButton;
        private PillButton startButton;
        private PillButton openButton;
        private PillButton restartButton;
        private PillButton logButton;
        private Toggle openCheck;
        private Toggle autoCheck;
        private Card logCard;
        private TextBox logBox;

        public LauncherForm(string root)
        {
            this.root = root.TrimEnd('\\', '/');
            Text = Program.Title;
            BackColor = Art.Bg;
            ForeColor = Art.Text;
            Font = new Font("Segoe UI", 10f);
            AutoScaleMode = AutoScaleMode.None;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoSize = true;
            AutoSizeMode = AutoSizeMode.GrowAndShrink;
            Padding = new Padding(S(22), S(14), S(22), S(14));
            using (var ms = new MemoryStream())
            {
                Art.WriteIco(ms);
                ms.Position = 0;
                Icon = new Icon(ms);
            }
            BuildUi();
            uiTimer.Interval = 100;
            uiTimer.Tick += delegate { OnUiTick(); };
            uiTimer.Start();
            SetState(RunState.Stopped, "Sunucu kapalı. Başlatmak için “Başlat”a bas.");
        }

        private static int S(float v)
        {
            return (int)Math.Round(v * Art.Scale);
        }

        private bool IsBusy
        {
            get { return state == RunState.Installing || state == RunState.Starting || state == RunState.Running; }
        }

        // ---------------------------------------------------------------- arayüz

        private void BuildUi()
        {
            var flow = new FlowLayoutPanel
            {
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                Location = new Point(S(22), S(14)),
                Margin = Padding.Empty,
                BackColor = Art.Bg,
            };
            Controls.Add(flow);

            flow.Controls.Add(new HeaderView { Size = new Size(S(W), S(76)), Margin = new Padding(0, 0, 0, S(10)) });

            // Durum kartı: renkli nokta + başlık + açıklama
            var status = new Card { Size = new Size(S(W), S(92)), Margin = new Padding(0, 0, 0, S(10)) };
            dot = new Dot { Bounds = new Rectangle(S(18), S(17), S(22), S(22)) };
            stateLabel = new Label
            {
                AutoSize = false,
                Bounds = new Rectangle(S(50), S(13), S(W - 66), S(30)),
                Font = new Font("Segoe UI Semibold", 13f),
                ForeColor = Art.Text,
                BackColor = Art.Panel,
            };
            detailLabel = new Label
            {
                AutoSize = false,
                Bounds = new Rectangle(S(50), S(44), S(W - 66), S(42)),
                ForeColor = Art.Muted,
                BackColor = Art.Panel,
            };
            status.Controls.Add(dot);
            status.Controls.Add(stateLabel);
            status.Controls.Add(detailLabel);
            flow.Controls.Add(status);

            // Adresler
            var addr = new Card { Size = new Size(S(W), S(90)), Margin = new Padding(0, 0, 0, S(12)) };
            addr.Controls.Add(MutedLabel("Bu bilgisayardan:", S(18), S(16), S(190)));
            localLink = MakeLink(LocalUrl.TrimEnd('/'), S(210), S(16));
            localLink.LinkClicked += delegate { OpenGame(); };
            addr.Controls.Add(localLink);
            addr.Controls.Add(MutedLabel("Aynı ağdaki arkadaşlar:", S(18), S(52), S(190)));
            lanLink = MakeLink("aranıyor…", S(210), S(52));
            lanLink.LinkClicked += delegate { if (lanUrl != null) OpenUrl(lanUrl); };
            addr.Controls.Add(lanLink);
            copyButton = new PillButton
            {
                Text = "Kopyala",
                Bounds = new Rectangle(S(W - 18 - 104), S(46), S(104), S(32)),
                Font = new Font("Segoe UI Semibold", 9.5f),
                Enabled = false,
            };
            copyButton.SetLook(Art.PanelBorder, Art.Text);
            copyButton.Click += delegate { CopyLan(); };
            addr.Controls.Add(copyButton);
            flow.Controls.Add(addr);

            // Düğmeler
            var row = new Panel { Size = new Size(S(W), S(46)), Margin = new Padding(0, 0, 0, S(12)), BackColor = Art.Bg };
            startButton = new PillButton { Bounds = new Rectangle(0, 0, S(160), S(46)), Font = new Font("Segoe UI Semibold", 11.5f) };
            startButton.Click += delegate
            {
                if (IsBusy) StopRun("Sunucu durduruldu. Oyunun adresi artık kapalı.");
                else Launch(openCheck.Checked);
            };
            openButton = new PillButton { Text = "Oyunu aç  ↗", Bounds = new Rectangle(S(170), 0, S(140), S(46)) };
            openButton.SetLook(Art.Blue, Color.White);
            openButton.Click += delegate
            {
                if (state == RunState.Running) OpenGame();
                else if (IsBusy) openWhenReady = true;
                else Launch(true);
            };
            restartButton = new PillButton { Text = "↻  Yeniden başlat", Bounds = new Rectangle(S(320), 0, S(160), S(46)) };
            restartButton.SetLook(Art.PanelBorder, Art.Text);
            restartButton.Click += delegate { Restart(); };
            logButton = new PillButton { Bounds = new Rectangle(S(490), 0, S(90), S(46)) };
            logButton.SetLook(Art.PanelBorder, Art.Text);
            logButton.Click += delegate { ShowLog(!logCard.Visible); };
            row.Controls.Add(startButton);
            row.Controls.Add(openButton);
            row.Controls.Add(restartButton);
            row.Controls.Add(logButton);
            flow.Controls.Add(row);

            openCheck = MakeCheck("Sunucu hazır olunca oyunu tarayıcıda aç", settings.OpenOnReady);
            openCheck.CheckedChanged += delegate { settings.OpenOnReady = openCheck.Checked; };
            autoCheck = MakeCheck("Başlatıcı açılınca sunucuyu kendiliğinden başlat", settings.AutoStart);
            autoCheck.CheckedChanged += delegate { settings.AutoStart = autoCheck.Checked; };
            flow.Controls.Add(openCheck);
            flow.Controls.Add(autoCheck);

            // Kayıtlar (sunucu çıktısı)
            logCard = new Card
            {
                Size = new Size(S(W), S(230)),
                Margin = new Padding(0, S(10), 0, 0),
                Padding = new Padding(S(12), S(10), S(4), S(10)),
            };
            logBox = new TextBox
            {
                Multiline = true,
                ReadOnly = true,
                WordWrap = true,
                ScrollBars = ScrollBars.Vertical,
                BorderStyle = BorderStyle.None,
                Dock = DockStyle.Fill,
                Font = new Font("Consolas", 9f),
                BackColor = Art.Panel,
                ForeColor = Art.LogText,
            };
            logBox.HandleCreated += delegate { Native.DarkScrollbars(logBox.Handle); };
            logCard.Controls.Add(logBox);
            flow.Controls.Add(logCard);

            flow.Controls.Add(new Label
            {
                AutoSize = false,
                Size = new Size(S(W), S(40)),
                Margin = new Padding(0, S(10), 0, 0),
                ForeColor = Art.Muted,
                Font = new Font("Segoe UI", 9f),
                Text = "Bu pencereyi kapatınca oda sunucusu ve oyun da kapanır. Arkadaşların bağlanamıyorsa "
                    + "Windows güvenlik duvarında Node.js'e “Özel ağlar” izni ver.",
            });
        }

        private static Label MutedLabel(string text, int x, int y, int w)
        {
            return new Label
            {
                Text = text,
                AutoSize = false,
                Bounds = new Rectangle(x, y, w, S(24)),
                ForeColor = Art.Muted,
                BackColor = Art.Panel,
            };
        }

        private static LinkLabel MakeLink(string text, int x, int y)
        {
            return new LinkLabel
            {
                Text = text,
                AutoSize = true,
                Location = new Point(x, y),
                Font = new Font("Segoe UI Semibold", 10.5f),
                BackColor = Art.Panel,
                LinkColor = Art.Cyan,
                ActiveLinkColor = Art.Yellow,
                VisitedLinkColor = Art.Cyan,
                LinkBehavior = LinkBehavior.HoverUnderline,
            };
        }

        private static Toggle MakeCheck(string text, bool on)
        {
            return new Toggle
            {
                Text = text,
                Checked = on,
                Margin = new Padding(S(2), S(1), 0, S(3)),
                ForeColor = Art.Text,
                BackColor = Art.Bg,
            };
        }

        private void ShowLog(bool show)
        {
            logCard.Visible = show;
            logButton.Text = show ? "Gizle" : "Kayıtlar";
            settings.ShowLog = show;
        }

        private void SetState(RunState s, string detail)
        {
            state = s;
            string title;
            Color c;
            switch (s)
            {
                case RunState.Installing:
                    title = "Paketler kuruluyor…";
                    c = Art.Orange;
                    break;
                case RunState.Starting:
                    title = "Başlatılıyor…";
                    c = Art.Orange;
                    break;
                case RunState.Running:
                    title = "Çalışıyor";
                    c = Art.Green;
                    break;
                case RunState.Error:
                    title = "Bir sorun var";
                    c = Art.Red;
                    break;
                default:
                    title = "Kapalı";
                    c = Art.Muted;
                    break;
            }
            stateLabel.Text = title;
            detailLabel.Text = detail;
            dot.DotColor = c;
            dot.Glow = s == RunState.Running ? 1f : 0.3f;
            bool busy = IsBusy;
            startButton.Text = busy ? "■  Durdur" : "▶  Başlat";
            startButton.SetLook(busy ? Art.Red : Art.Green, busy ? Color.White : Art.Ink);
            restartButton.Enabled = s == RunState.Running || s == RunState.Error;
            Color link = s == RunState.Running ? Art.Cyan : Art.Muted;
            localLink.LinkColor = localLink.VisitedLinkColor = link;
            lanLink.LinkColor = lanLink.VisitedLinkColor = link;
        }

        private void OnUiTick()
        {
            if (state == RunState.Starting || state == RunState.Installing)
            {
                pulse++;
                dot.Glow = 0.5f + 0.5f * (float)Math.Sin(pulse * 0.3);
            }
            FlushLog();
        }

        // ---------------------------------------------------------------- yaşam döngüsü

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Native.DarkTitleBar(Handle, Art.Bg);
        }

        protected override async void OnShown(EventArgs e)
        {
            base.OnShown(e);
            ShowLog(settings.ShowLog);
            if (settings.AutoStart) Launch(openCheck.Checked);
            string ip = await Task.Run(() => Net.LanAddress());
            if (IsDisposed) return;
            if (ip != null)
            {
                lanUrl = "http://" + ip + ":" + ClientPort;
                lanLink.Text = lanUrl;
                copyButton.Enabled = true;
            }
            else
            {
                lanLink.Text = "bulunamadı (ağa bağlı değilsin)";
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            // Pencere kapanınca sunucu ve oyun da kapanır (iş nesnesi bunu çökmede de garanti eder)
            runId++;
            KillAll();
            settings.Save();
            base.OnFormClosing(e);
        }

        private async void Launch(bool openBrowser)
        {
            int run = ++runId;
            KillAll();
            openWhenReady = openBrowser;
            SetState(RunState.Starting, "Hazırlanıyor…");

            if (!File.Exists(Path.Combine(root, "package.json")) || !Directory.Exists(Path.Combine(root, @"packages\client")))
            {
                Fail("Oyna.exe oyunun proje klasöründe olmalı (yanında package.json ve packages klasörü bulunmalı).");
                return;
            }
            nodeExe = Net.FindNode();
            if (nodeExe == null)
            {
                Fail("Node.js bulunamadı. nodejs.org adresinden LTS sürümünü kurup başlatıcıyı yeniden aç.");
                return;
            }
            Log("başlatıcı", "Node.js: " + nodeExe + " " + Net.NodeVersion(nodeExe));

            if (!await FreePorts(run) || run != runId) return;

            job = new Job();
            if (NeedsInstall())
            {
                SetState(RunState.Installing, "İlk açılış ya da yeni paket: gerekli paketler indiriliyor. Birkaç dakika sürebilir…");
                ShowLog(true);
                int code = await Install(run);
                if (run != runId) return;
                if (code != 0)
                {
                    Fail("Paket kurulumu başarısız oldu (kod " + code + "). İnternet bağlantını kontrol edip tekrar dene.");
                    return;
                }
                TouchInstallMarker();
            }

            SetState(RunState.Starting, "Oda sunucusu ve oyun başlatılıyor…");
            try
            {
                Spawn("oda", nodeExe, "node_modules/tsx/dist/cli.mjs packages/server/src/index.ts", run, null);
                Spawn("oyun", nodeExe, "node_modules/vite/bin/vite.js packages/client --port " + ClientPort + " --strictPort", run, null);
            }
            catch (Exception ex)
            {
                Fail("Sunucu başlatılamadı: " + ex.Message);
                return;
            }
            await WaitReady(run);
        }

        private async void Restart()
        {
            if (state != RunState.Running && state != RunState.Error) return;
            runId++;
            KillAll();
            SetState(RunState.Starting, "Yeniden başlatılıyor…");
            await Task.Delay(250);
            Launch(false);
        }

        private void StopRun(string message)
        {
            runId++;
            KillAll();
            SetState(RunState.Stopped, message);
            Log("başlatıcı", "Durduruldu.");
        }

        private void Fail(string message)
        {
            runId++;
            KillAll();
            SetState(RunState.Error, message);
            ShowLog(true);
            Log("başlatıcı", "HATA: " + message);
        }

        private async Task WaitReady(int run)
        {
            DateTime deadline = DateTime.UtcNow.AddSeconds(StartTimeoutSeconds);
            while (true)
            {
                bool ok = await Task.Run(() =>
                    Net.Probe("http://127.0.0.1:" + ServerPort + "/health") && Net.Probe("http://127.0.0.1:" + ClientPort + "/"));
                if (run != runId) return;
                if (ok) break;
                if (DateTime.UtcNow > deadline)
                {
                    Fail("Sunucu " + StartTimeoutSeconds + " saniye içinde açılmadı. Ayrıntılar aşağıdaki kayıtlarda.");
                    return;
                }
                await Task.Delay(400);
                if (run != runId) return;
            }
            SetState(RunState.Running, "Oyun hazır. Bu pencere açık kaldıkça oyun da açık kalır.");
            Log("başlatıcı", "Hazır: " + LocalUrl);
            if (openWhenReady) OpenGame();
        }

        /// <summary>
        /// Portlar boş mu? Eski bir oyun sunucusu (ör. Oyna.bat'tan kalan) portu tutuyorsa
        /// kullanıcıya sorup kapatır; başka bir program tutuyorsa hata verir.
        /// </summary>
        private async Task<bool> FreePorts(int run)
        {
            foreach (int port in new[] { ServerPort, ClientPort })
            {
                int pid = await WaitPortFree(port, 2500);
                if (run != runId) return false;
                if (pid == 0) continue;
                string name = ProcName(pid);
                if (string.Equals(name, "node", StringComparison.OrdinalIgnoreCase))
                {
                    var answer = MessageBox.Show(
                        this,
                        string.Format(
                            "Daha önce açılmış bir oyun sunucusu hâlâ çalışıyor ({0} portunu node.exe kullanıyor, işlem {1}). "
                                + "Büyük ihtimalle eski bir pencereden (ör. Oyna.bat) kaldı.\n\nOnu kapatıp yeniden başlatayım mı?",
                            port,
                            pid),
                        Program.Title,
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Question);
                    if (run != runId) return false;
                    if (answer == DialogResult.Yes)
                    {
                        int top = await Task.Run(() => ToolingRoot(pid));
                        Log("başlatıcı", "Eski sunucu kapatılıyor (işlem " + top + ")");
                        await Task.Run(() => KillTree(top));
                        if (await WaitPortFree(port, 4000) == 0) continue;
                    }
                    Fail(port + " portu hâlâ kullanımda. Eski sunucuyu kapatıp tekrar dene.");
                    return false;
                }
                Fail(string.Format(
                    "{0} portunu başka bir program kullanıyor ({1}, işlem {2}). O programı kapatıp tekrar dene.",
                    port,
                    name,
                    pid));
                return false;
            }
            return true;
        }

        private static async Task<int> WaitPortFree(int port, int ms)
        {
            DateTime until = DateTime.UtcNow.AddMilliseconds(ms);
            while (true)
            {
                int pid = Ports.Owner(port);
                if (pid == 0 || DateTime.UtcNow > until) return pid;
                await Task.Delay(200);
            }
        }

        private bool NeedsInstall()
        {
            string[] required =
            {
                @"node_modules\vite\bin\vite.js",
                @"node_modules\tsx\dist\cli.mjs",
                @"node_modules\ws\package.json",
                @"node_modules\pixi.js\package.json",
                @"node_modules\@yilan\shared\package.json",
            };
            foreach (string f in required)
            {
                if (!File.Exists(Path.Combine(root, f))) return true;
            }
            // package-lock.json kurulumdan sonra değiştiyse (yeni paket eklendi) yeniden kurulur
            string lockFile = Path.Combine(root, "package-lock.json");
            string marker = Path.Combine(root, @"node_modules\.package-lock.json");
            return File.Exists(lockFile)
                && File.Exists(marker)
                && File.GetLastWriteTimeUtc(lockFile) > File.GetLastWriteTimeUtc(marker).AddSeconds(30);
        }

        private void TouchInstallMarker()
        {
            try
            {
                File.SetLastWriteTimeUtc(Path.Combine(root, @"node_modules\.package-lock.json"), DateTime.UtcNow);
            }
            catch
            {
                // işaret dosyası yoksa sonraki açılışta bir kez daha kurulur
            }
        }

        private Task<int> Install(int run)
        {
            var done = new TaskCompletionSource<int>();
            string npmCli = Path.Combine(Path.GetDirectoryName(nodeExe), @"node_modules\npm\bin\npm-cli.js");
            try
            {
                if (File.Exists(npmCli))
                    Spawn("kurulum", nodeExe, "\"" + npmCli + "\" install --no-audit --no-fund", run, code => done.TrySetResult(code));
                else
                    Spawn("kurulum", "cmd.exe", "/d /c npm install --no-audit --no-fund", run, code => done.TrySetResult(code));
            }
            catch (Exception ex)
            {
                Log("kurulum", ex.Message);
                done.TrySetResult(-1);
            }
            return done.Task;
        }

        /// <summary>Görünmez bir alt süreç başlatır; çıktısı kayıtlara akar, iş nesnesine eklenir.</summary>
        private void Spawn(string tag, string exe, string args, int run, Action<int> onExit)
        {
            var psi = new ProcessStartInfo(exe, args)
            {
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            psi.EnvironmentVariables["PATH"] = Path.GetDirectoryName(nodeExe) + ";" + Environment.GetEnvironmentVariable("PATH");
            psi.EnvironmentVariables["NO_COLOR"] = "1";
            psi.EnvironmentVariables["FORCE_COLOR"] = "0";
            psi.EnvironmentVariables["BROWSER"] = "none";

            var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
            DataReceivedEventHandler onData = delegate(object sender, DataReceivedEventArgs e)
            {
                if (e.Data == null) return;
                string line = Ansi.Replace(e.Data, "").TrimEnd();
                if (line.Length > 0) Log(tag, line);
            };
            p.OutputDataReceived += onData;
            p.ErrorDataReceived += onData;
            p.Exited += delegate
            {
                int code = -1;
                try { code = p.ExitCode; }
                catch { }
                if (onExit != null) onExit(code);
                else Ui(delegate { OnProcessExit(tag, code, run); });
            };
            p.Start();
            if (job == null || !job.Add(p)) Log("başlatıcı", "Uyarı: " + tag + " süreci gruba eklenemedi; kapanışta ayrıca sonlandırılacak.");
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            procs.Add(p);
        }

        private void OnProcessExit(string tag, int code, int run)
        {
            if (run != runId) return; // bilerek durdurduk
            string who = tag == "oda" ? "Oda sunucusu" : "Oyun sunucusu (Vite)";
            Fail(who + " beklenmedik şekilde kapandı (kod " + code + "). Ayrıntılar aşağıdaki kayıtlarda.");
        }

        /// <summary>Tüm alt süreçleri (ve onların alt süreçlerini) sonlandırır.</summary>
        private void KillAll()
        {
            bool grouped = job != null;
            if (job != null)
            {
                job.KillAll();
                job.Dispose();
                job = null;
            }
            foreach (Process p in procs)
            {
                try
                {
                    if (!p.WaitForExit(grouped ? 2000 : 0)) KillTree(p.Id);
                }
                catch
                {
                    // zaten kapanmış
                }
            }
            procs.Clear();
        }

        private static void KillTree(int pid)
        {
            try
            {
                var psi = new ProcessStartInfo("taskkill", "/PID " + pid + " /T /F") { CreateNoWindow = true, UseShellExecute = false };
                using (Process k = Process.Start(psi)) k.WaitForExit(5000);
            }
            catch
            {
                // taskkill yoksa yapacak bir şey yok
            }
        }

        /// <summary>
        /// Portu tutan node sürecinin, onu başlatan geliştirme araçlarıyla (tsx, vite, npm,
        /// concurrently) birlikte en üstteki node atası. Yalnız alt süreç kapatılırsa
        /// "tsx watch" gibi bir üst süreç sunucuyu yeniden açabilir.
        /// </summary>
        private static int ToolingRoot(int pid)
        {
            int top = pid;
            try
            {
                for (int depth = 0; depth < 4; depth++)
                {
                    int parent = 0;
                    using (var q = new ManagementObjectSearcher("SELECT ParentProcessId FROM Win32_Process WHERE ProcessId=" + top))
                    {
                        foreach (ManagementObject o in q.Get()) parent = Convert.ToInt32(o["ParentProcessId"]);
                    }
                    if (parent == 0) break;
                    string name = null;
                    string cmd = null;
                    using (var q = new ManagementObjectSearcher("SELECT Name, CommandLine FROM Win32_Process WHERE ProcessId=" + parent))
                    {
                        foreach (ManagementObject o in q.Get())
                        {
                            name = o["Name"] as string;
                            cmd = o["CommandLine"] as string;
                        }
                    }
                    if (!string.Equals(name, "node.exe", StringComparison.OrdinalIgnoreCase) || cmd == null) break;
                    string c = cmd.ToLowerInvariant();
                    if (!(c.Contains("tsx") || c.Contains("vite") || c.Contains("concurrently") || c.Contains("npm"))) break;
                    top = parent;
                }
            }
            catch
            {
                // WMI okunamazsa yalnız portu tutan süreç kapatılır
            }
            return top;
        }

        private static string ProcName(int pid)
        {
            try
            {
                using (Process p = Process.GetProcessById(pid)) return p.ProcessName;
            }
            catch
            {
                return "bilinmeyen program";
            }
        }

        // ---------------------------------------------------------------- yardımcılar

        private void OpenGame()
        {
            OpenUrl(LocalUrl);
        }

        private void OpenUrl(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "Tarayıcı açılamadı: " + ex.Message + "\n\nAdres: " + url, Program.Title);
            }
        }

        private async void CopyLan()
        {
            if (lanUrl == null) return;
            try
            {
                Clipboard.SetText(lanUrl + "/");
            }
            catch
            {
                return;
            }
            copyButton.Text = "Kopyalandı ✓";
            await Task.Delay(1500);
            if (!IsDisposed) copyButton.Text = "Kopyala";
        }

        private void Log(string tag, string line)
        {
            pendingLog.Enqueue(DateTime.Now.ToString("HH:mm:ss") + "  [" + tag + "] " + line);
        }

        private void FlushLog()
        {
            if (pendingLog.IsEmpty) return;
            var sb = new StringBuilder();
            string line;
            int n = 0;
            while (n < 400 && pendingLog.TryDequeue(out line))
            {
                sb.Append(line).Append("\r\n");
                n++;
            }
            if (logBox.TextLength > 200000) logBox.Text = logBox.Text.Substring(100000);
            logBox.AppendText(sb.ToString());
        }

        private void Ui(Action action)
        {
            if (IsDisposed || !IsHandleCreated) return;
            try
            {
                BeginInvoke(action);
            }
            catch (InvalidOperationException)
            {
                // pencere kapanıyor
            }
        }
    }

    /// <summary>Alt süreçleri tek grupta tutar; son tutamaç kapanınca (başlatıcı çıkınca) hepsi sonlanır.</summary>
    internal sealed class Job : IDisposable
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

        [DllImport("kernel32.dll")]
        private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, int size);

        [DllImport("kernel32.dll")]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll")]
        private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

        [DllImport("kernel32.dll")]
        private static extern bool CloseHandle(IntPtr handle);

#pragma warning disable 0649
        [StructLayout(LayoutKind.Sequential)]
        private struct BasicLimits
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ExtendedLimits
        {
            public BasicLimits Basic;
            public IoCounters Io;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }
#pragma warning restore 0649

        private const uint KillOnJobClose = 0x2000;
        private const int ExtendedLimitInformation = 9;
        private IntPtr handle;

        public Job()
        {
            handle = CreateJobObject(IntPtr.Zero, null);
            var info = new ExtendedLimits();
            info.Basic.LimitFlags = KillOnJobClose;
            SetInformationJobObject(handle, ExtendedLimitInformation, ref info, Marshal.SizeOf(typeof(ExtendedLimits)));
        }

        public bool Add(Process p)
        {
            try
            {
                return handle != IntPtr.Zero && AssignProcessToJobObject(handle, p.Handle);
            }
            catch
            {
                return false;
            }
        }

        public void KillAll()
        {
            if (handle != IntPtr.Zero) TerminateJobObject(handle, 1);
        }

        public void Dispose()
        {
            if (handle == IntPtr.Zero) return;
            CloseHandle(handle);
            handle = IntPtr.Zero;
        }
    }

    internal static class Ports
    {
        [DllImport("iphlpapi.dll")]
        private static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool order, int af, int tableClass, uint reserved);

        private const int OwnerPidListener = 3;
        private const uint InsufficientBuffer = 122;

        /// <summary><paramref name="port"/>u dinleyen sürecin kimliği (IPv4 veya IPv6); dinleyen yoksa 0.</summary>
        public static int Owner(int port)
        {
            foreach (int af in new[] { 2, 23 })
            {
                int rowSize = af == 2 ? 24 : 56;
                int portOffset = af == 2 ? 8 : 20;
                int pidOffset = af == 2 ? 20 : 52;
                int size = 0;
                GetExtendedTcpTable(IntPtr.Zero, ref size, false, af, OwnerPidListener, 0);
                for (int attempt = 0; attempt < 3 && size > 0; attempt++)
                {
                    IntPtr buf = Marshal.AllocHGlobal(size);
                    try
                    {
                        uint err = GetExtendedTcpTable(buf, ref size, false, af, OwnerPidListener, 0);
                        if (err == InsufficientBuffer) continue; // tablo bu arada büyüdü
                        if (err != 0) break;
                        int n = Marshal.ReadInt32(buf);
                        for (int i = 0; i < n; i++)
                        {
                            IntPtr row = IntPtr.Add(buf, 4 + i * rowSize);
                            int raw = Marshal.ReadInt32(row, portOffset);
                            if ((((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF)) == port) return Marshal.ReadInt32(row, pidOffset);
                        }
                        break;
                    }
                    finally
                    {
                        Marshal.FreeHGlobal(buf);
                    }
                }
            }
            return 0;
        }
    }

    internal static class Net
    {
        /// <summary>Önce PATH, sonra taşınabilir (~\.tools\node) ve standart kurulum klasörleri.</summary>
        public static string FindNode()
        {
            string path = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in path.Split(';'))
            {
                try
                {
                    string d = dir.Trim().Trim('"');
                    if (d.Length == 0) continue;
                    string f = Path.Combine(d, "node.exe");
                    if (File.Exists(f)) return f;
                }
                catch
                {
                    // geçersiz PATH girdisi
                }
            }
            string[] extra =
            {
                Environment.ExpandEnvironmentVariables(@"%USERPROFILE%\.tools\node\node.exe"),
                Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\nodejs\node.exe"),
                Environment.ExpandEnvironmentVariables(@"%LOCALAPPDATA%\Programs\nodejs\node.exe"),
            };
            foreach (string f in extra)
            {
                if (File.Exists(f)) return f;
            }
            return null;
        }

        public static string NodeVersion(string node)
        {
            try
            {
                var psi = new ProcessStartInfo(node, "--version")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                };
                using (Process p = Process.Start(psi))
                {
                    string v = p.StandardOutput.ReadToEnd().Trim();
                    p.WaitForExit(3000);
                    return v;
                }
            }
            catch
            {
                return "";
            }
        }

        public static bool Probe(string url)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = 1500;
                req.Proxy = null;
                using (var res = (HttpWebResponse)req.GetResponse()) return (int)res.StatusCode < 500;
            }
            catch (WebException ex)
            {
                var res = ex.Response as HttpWebResponse;
                if (res == null) return false;
                res.Close();
                return (int)res.StatusCode < 500;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>Arkadaşların ulaşabileceği yerel ağ adresi (varsayılan ağ yolunun IPv4'ü).</summary>
        public static string LanAddress()
        {
            try
            {
                // UDP soketini "bağlamak" paket göndermez; yalnızca işletim sistemine yol seçtirir
                using (var s = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp))
                {
                    s.Connect("8.8.8.8", 53);
                    var ep = s.LocalEndPoint as IPEndPoint;
                    if (ep != null && !IPAddress.IsLoopback(ep.Address) && !ep.Address.Equals(IPAddress.Any)) return ep.Address.ToString();
                }
            }
            catch
            {
                // ağ yok: arayüzlere bak
            }
            try
            {
                foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    foreach (UnicastIPAddressInformation ua in ni.GetIPProperties().UnicastAddresses)
                    {
                        string a = ua.Address.ToString();
                        if (ua.Address.AddressFamily == AddressFamily.InterNetwork && !a.StartsWith("169.254.")) return a;
                    }
                }
            }
            catch
            {
                // arayüzler okunamadı
            }
            return null;
        }
    }

    internal sealed class Settings
    {
        public bool OpenOnReady = true;
        public bool AutoStart;
        public bool ShowLog;

        private static string FilePath
        {
            get
            {
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Yilan.io", "baslatici.ini");
            }
        }

        public static Settings Load()
        {
            var s = new Settings();
            try
            {
                foreach (string line in File.ReadAllLines(FilePath))
                {
                    int eq = line.IndexOf('=');
                    if (eq < 0) continue;
                    string key = line.Substring(0, eq).Trim();
                    bool on = line.Substring(eq + 1).Trim() == "1";
                    if (key == "openOnReady") s.OpenOnReady = on;
                    else if (key == "autoStart") s.AutoStart = on;
                    else if (key == "showLog") s.ShowLog = on;
                }
            }
            catch
            {
                // ilk açılış: varsayılanlar
            }
            return s;
        }

        public void Save()
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(FilePath));
                File.WriteAllLines(FilePath, new[]
                {
                    "openOnReady=" + (OpenOnReady ? 1 : 0),
                    "autoStart=" + (AutoStart ? 1 : 0),
                    "showLog=" + (ShowLog ? 1 : 0),
                });
            }
            catch
            {
                // ayarlar kaydedilemezse bir sonraki açılış varsayılanlarla başlar
            }
        }
    }

    internal static class Native
    {
        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr FindWindow(string className, string title);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hwnd, int cmd);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hwnd);

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)]
        private static extern int SetWindowTheme(IntPtr hwnd, string app, string idList);

        public static void FocusWindow(string title)
        {
            IntPtr h = FindWindow(null, title);
            if (h == IntPtr.Zero) return;
            ShowWindow(h, 9); // SW_RESTORE
            SetForegroundWindow(h);
        }

        /// <summary>Koyu başlık çubuğu (Windows 10/11) ve Windows 11'de oyunun lacivert rengi.</summary>
        public static void DarkTitleBar(IntPtr hwnd, Color caption)
        {
            try
            {
                int on = 1;
                if (DwmSetWindowAttribute(hwnd, 20, ref on, 4) != 0) DwmSetWindowAttribute(hwnd, 19, ref on, 4);
                int color = caption.R | (caption.G << 8) | (caption.B << 16);
                DwmSetWindowAttribute(hwnd, 35, ref color, 4);
            }
            catch
            {
                // eski Windows: varsayılan başlık çubuğu
            }
        }

        public static void DarkScrollbars(IntPtr hwnd)
        {
            try
            {
                SetWindowTheme(hwnd, "DarkMode_Explorer", null);
            }
            catch
            {
                // tema yoksa açık kaydırma çubuğu kalır
            }
        }
    }

    // -------------------------------------------------------------------- çizim

    internal static class Art
    {
        public static float Scale = 1f;

        public static readonly Color Bg = Hex("#0a1633");
        public static readonly Color Panel = Hex("#12234a");
        public static readonly Color PanelBorder = Hex("#243b70");
        public static readonly Color Text = Hex("#e8eefc");
        public static readonly Color Muted = Hex("#8fa3c8");
        public static readonly Color LogText = Hex("#b9c7e6");
        public static readonly Color Ink = Hex("#06122b");
        public static readonly Color Cyan = Hex("#4de8ff");
        public static readonly Color Yellow = Hex("#ffe14d");
        public static readonly Color Green = Hex("#4dff88");
        public static readonly Color Red = Hex("#ff4d5e");
        public static readonly Color Orange = Hex("#ffa94d");
        public static readonly Color Blue = Hex("#3b6dff");

        private static Color Hex(string s)
        {
            return ColorTranslator.FromHtml(s);
        }

        public static Color Mix(Color a, Color b, float t)
        {
            return Color.FromArgb(
                (int)(a.R + (b.R - a.R) * t),
                (int)(a.G + (b.G - a.G) * t),
                (int)(a.B + (b.B - a.B) * t));
        }

        public static GraphicsPath RoundRect(RectangleF r, float radius)
        {
            float d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
            var p = new GraphicsPath();
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        private static void Disc(Graphics g, Color c, float x, float y, float r)
        {
            using (var b = new SolidBrush(c)) g.FillEllipse(b, x - r, y - r, r * 2, r * 2);
        }

        /// <summary>Simge: lacivert daire içinde S çizen neon yılan (oyundaki çizimin sadeleşmişi).</summary>
        public static Bitmap Draw(int size)
        {
            var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.Clear(Color.Transparent);
                float k = size / 64f;
                g.ScaleTransform(k, k);
                using (var bg = new LinearGradientBrush(new RectangleF(0, 0, 64, 64), Hex("#1a3778"), Hex("#081129"), 90f))
                    g.FillEllipse(bg, 1.5f, 1.5f, 61f, 61f);
                using (var ring = new Pen(Color.FromArgb(235, 0x6f, 0xb6, 0xff), 3f)) g.DrawEllipse(ring, 3f, 3f, 58f, 58f);

                const int n = 14;
                var pts = new PointF[n];
                var rad = new float[n];
                for (int i = 0; i < n; i++)
                {
                    float t = i / (float)(n - 1); // 0 = kuyruk, 1 = baş
                    pts[i] = new PointF(32f + 11.5f * (float)Math.Sin(t * Math.PI * 1.8 - 0.4), 50f - 33f * t);
                    rad[i] = 4.2f + 3f * t;
                }
                for (int i = 0; i < n; i++) Disc(g, Color.FromArgb(70, Cyan), pts[i].X, pts[i].Y, rad[i] + 2.4f);
                for (int i = 0; i < n; i++) Disc(g, Hex("#05070d"), pts[i].X, pts[i].Y, rad[i]);
                for (int i = 0; i < n - 1; i++) Disc(g, Mix(Cyan, Color.White, 0.2f), pts[i].X, pts[i].Y, rad[i] * 0.55f);

                PointF h = pts[n - 1];
                PointF prev = pts[n - 2];
                float dx = h.X - prev.X;
                float dy = h.Y - prev.Y;
                float len = (float)Math.Sqrt(dx * dx + dy * dy);
                dx /= len;
                dy /= len;
                Disc(g, Cyan, h.X, h.Y, 8.4f);
                for (int side = -1; side <= 1; side += 2)
                {
                    float ex = h.X + dx * 2.2f - dy * side * 3.5f;
                    float ey = h.Y + dy * 2.2f + dx * side * 3.5f;
                    Disc(g, Color.White, ex, ey, 2.8f);
                    Disc(g, Ink, ex + dx * 0.9f, ey + dy * 0.9f, 1.6f);
                }
            }
            return bmp;
        }

        /// <summary>
        /// Çok boyutlu .ico yazar: küçük boyutlar klasik 32 bit DIB (her yerde açılır),
        /// 256 piksel PNG sıkıştırmalı.
        /// </summary>
        public static void WriteIco(Stream output)
        {
            int[] sizes = { 16, 20, 24, 32, 40, 48, 64, 256 };
            var images = new List<byte[]>();
            foreach (int size in sizes)
            {
                using (Bitmap bmp = Draw(size)) images.Add(size >= 256 ? Png(bmp) : Dib(bmp));
            }
            var w = new BinaryWriter(output);
            w.Write((short)0);
            w.Write((short)1);
            w.Write((short)sizes.Length);
            int offset = 6 + 16 * sizes.Length;
            for (int i = 0; i < sizes.Length; i++)
            {
                byte dim = (byte)(sizes[i] >= 256 ? 0 : sizes[i]);
                w.Write(dim);
                w.Write(dim);
                w.Write((byte)0);
                w.Write((byte)0);
                w.Write((short)1);
                w.Write((short)32);
                w.Write(images[i].Length);
                w.Write(offset);
                offset += images[i].Length;
            }
            foreach (byte[] img in images) w.Write(img);
            w.Flush();
        }

        private static byte[] Png(Bitmap bmp)
        {
            using (var ms = new MemoryStream())
            {
                bmp.Save(ms, ImageFormat.Png);
                return ms.ToArray();
            }
        }

        private static byte[] Dib(Bitmap bmp)
        {
            int n = bmp.Width;
            var data = bmp.LockBits(new Rectangle(0, 0, n, n), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            var pixels = new byte[n * n * 4];
            try
            {
                for (int y = 0; y < n; y++) Marshal.Copy(IntPtr.Add(data.Scan0, y * data.Stride), pixels, y * n * 4, n * 4);
            }
            finally
            {
                bmp.UnlockBits(data);
            }
            int maskStride = ((n + 31) / 32) * 4;
            using (var ms = new MemoryStream())
            {
                var w = new BinaryWriter(ms);
                w.Write(40);
                w.Write(n);
                w.Write(n * 2);
                w.Write((short)1);
                w.Write((short)32);
                w.Write(0);
                w.Write(n * n * 4 + maskStride * n);
                w.Write(0);
                w.Write(0);
                w.Write(0);
                w.Write(0);
                for (int y = n - 1; y >= 0; y--) w.Write(pixels, y * n * 4, n * 4); // alttan üste
                for (int y = n - 1; y >= 0; y--)
                {
                    var mask = new byte[maskStride];
                    for (int x = 0; x < n; x++)
                    {
                        if (pixels[(y * n + x) * 4 + 3] == 0) mask[x >> 3] |= (byte)(0x80 >> (x & 7));
                    }
                    w.Write(mask);
                }
                w.Flush();
                return ms.ToArray();
            }
        }
    }

    /// <summary>Üst başlık: simge + neon "Yılan.io" yazısı + alt başlık.</summary>
    internal sealed class HeaderView : Control
    {
        private readonly Bitmap icon = Art.Draw(128);

        public HeaderView()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            BackColor = Art.Bg;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            float s = Art.Scale;
            float ih = 62 * s;
            g.DrawImage(icon, new RectangleF(0, (Height - ih) / 2, ih, ih));

            float x = ih + 14 * s;
            using (var fam = new FontFamily("Segoe UI"))
            {
                const FontStyle bold = FontStyle.Bold;
                float em = fam.GetEmHeight(bold);
                float asc = fam.GetCellAscent(bold) / em;
                float big = 34f * s;
                float small = 22f * s;
                float baseline = 2 * s + asc * big;
                using (var main = new GraphicsPath())
                using (var ext = new GraphicsPath())
                {
                    main.AddString("Yılan", fam, (int)bold, big, new PointF(x, baseline - asc * big), StringFormat.GenericTypographic);
                    RectangleF b = main.GetBounds();
                    ext.AddString(".io", fam, (int)bold, small, new PointF(b.Right + 1.5f * s, baseline - asc * small), StringFormat.GenericTypographic);
                    Neon(g, main, Art.Cyan);
                    Neon(g, ext, Art.Yellow);
                }
                using (var sub = new Font("Segoe UI", 10f))
                {
                    TextRenderer.DrawText(g, "Başlatıcı · oda sunucusu ve oyun tek tıkla", sub, new Point((int)x, (int)(baseline + 9 * s)), Art.Muted, BackColor);
                }
            }
        }

        private static void Neon(Graphics g, GraphicsPath path, Color c)
        {
            for (int i = 4; i >= 1; i--)
            {
                using (var pen = new Pen(Color.FromArgb(20, c), i * 2.6f * Art.Scale) { LineJoin = LineJoin.Round })
                    g.DrawPath(pen, path);
            }
            using (var brush = new SolidBrush(c)) g.FillPath(brush, path);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) icon.Dispose();
            base.Dispose(disposing);
        }
    }

    /// <summary>Yuvarlak köşeli koyu kart.</summary>
    internal sealed class Card : Panel
    {
        public Card()
        {
            DoubleBuffered = true;
            ResizeRedraw = true;
            BackColor = Art.Panel;
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(Parent != null ? Parent.BackColor : Art.Bg);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
            using (GraphicsPath p = Art.RoundRect(r, 12 * Art.Scale))
            using (var fill = new SolidBrush(Art.Panel))
            using (var border = new Pen(Art.PanelBorder, Math.Max(1f, Art.Scale)))
            {
                g.FillPath(fill, p);
                g.DrawPath(border, p);
            }
        }
    }

    /// <summary>Durum noktası: renkli disk ve çevresinde parlaklığı değişen hale.</summary>
    internal sealed class Dot : Control
    {
        private Color dotColor = Art.Muted;
        private float glow;

        public Dot()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
            BackColor = Art.Panel;
        }

        public Color DotColor
        {
            get { return dotColor; }
            set { dotColor = value; Invalidate(); }
        }

        public float Glow
        {
            get { return glow; }
            set { glow = value; Invalidate(); }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float d = Math.Min(Width, Height) - 1;
            using (var halo = new SolidBrush(Color.FromArgb((int)(40 + 90 * glow), dotColor)))
                g.FillEllipse(halo, (Width - d) / 2f, (Height - d) / 2f, d, d);
            float c = d * 0.56f;
            using (var core = new SolidBrush(dotColor)) g.FillEllipse(core, (Width - c) / 2f, (Height - c) / 2f, c, c);
        }
    }

    /// <summary>Koyu temaya uygun onay kutusu: işaretliyken turkuaz dolu kutu ve tik.</summary>
    internal sealed class Toggle : CheckBox
    {
        private bool hover;

        public Toggle()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
            Cursor = Cursors.Hand;
            AutoSize = true;
        }

        public override Size GetPreferredSize(Size proposedSize)
        {
            Size t = TextRenderer.MeasureText(Text, Font);
            float s = Art.Scale;
            return new Size((int)(30 * s) + t.Width, Math.Max((int)(26 * s), t.Height + (int)(4 * s)));
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            hover = true;
            Invalidate();
            base.OnMouseEnter(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            hover = false;
            Invalidate();
            base.OnMouseLeave(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float s = Art.Scale;
            float box = 18 * s;
            var r = new RectangleF(1 * s, (Height - box) / 2f, box, box);
            using (GraphicsPath p = Art.RoundRect(r, 5 * s))
            {
                if (Checked)
                {
                    using (var b = new SolidBrush(hover ? Art.Mix(Art.Cyan, Color.White, 0.25f) : Art.Cyan)) g.FillPath(b, p);
                    using (var pen = new Pen(Art.Ink, 2.4f * s) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
                    {
                        g.DrawLines(pen, new[]
                        {
                            new PointF(r.X + 4.5f * s, r.Y + 9.5f * s),
                            new PointF(r.X + 7.8f * s, r.Y + 12.8f * s),
                            new PointF(r.X + 13.5f * s, r.Y + 5.6f * s),
                        });
                    }
                }
                else
                {
                    using (var b = new SolidBrush(Art.Panel)) g.FillPath(b, p);
                    using (var pen = new Pen(hover ? Art.Cyan : Art.Muted, 1.5f * s)) g.DrawPath(pen, p);
                }
            }
            Size t = TextRenderer.MeasureText(Text, Font);
            TextRenderer.DrawText(g, Text, Font, new Point((int)(r.Right + 10 * s), (Height - t.Height) / 2), ForeColor, BackColor);
            if (Focused && ShowFocusCues)
            {
                using (GraphicsPath p = Art.RoundRect(RectangleF.Inflate(r, 2.5f * s, 2.5f * s), 7 * s))
                using (var pen = new Pen(Color.FromArgb(150, Color.White), Math.Max(1f, s)))
                    g.DrawPath(pen, p);
            }
        }
    }

    /// <summary>Yuvarlak köşeli, üzerine gelince açılan düz düğme.</summary>
    internal sealed class PillButton : Button
    {
        private Color fill = Art.PanelBorder;
        private Color ink = Color.White;
        private bool hover;
        private bool down;

        public PillButton()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 0;
            Cursor = Cursors.Hand;
            Font = new Font("Segoe UI Semibold", 10.5f);
            BackColor = Art.Bg;
        }

        public void SetLook(Color fillColor, Color textColor)
        {
            fill = fillColor;
            ink = textColor;
            Invalidate();
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            hover = true;
            Invalidate();
            base.OnMouseEnter(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            hover = false;
            down = false;
            Invalidate();
            base.OnMouseLeave(e);
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left)
            {
                down = true;
                Invalidate();
            }
            base.OnMouseDown(e);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            down = false;
            Invalidate();
            base.OnMouseUp(e);
        }

        protected override void OnEnabledChanged(EventArgs e)
        {
            Cursor = Enabled ? Cursors.Hand : Cursors.Default;
            Invalidate();
            base.OnEnabledChanged(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(Parent != null ? Parent.BackColor : Art.Bg);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            Color c = !Enabled ? Art.Mix(fill, Art.Bg, 0.55f)
                : down ? Art.Mix(fill, Color.Black, 0.15f)
                : hover ? Art.Mix(fill, Color.White, 0.16f)
                : fill;
            var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
            using (GraphicsPath p = Art.RoundRect(r, 10 * Art.Scale))
            using (var b = new SolidBrush(c))
                g.FillPath(b, p);
            if (Focused && ShowFocusCues)
            {
                using (GraphicsPath p = Art.RoundRect(RectangleF.Inflate(r, -3f * Art.Scale, -3f * Art.Scale), 8 * Art.Scale))
                using (var pen = new Pen(Color.FromArgb(150, Color.White), Math.Max(1f, Art.Scale)))
                    g.DrawPath(pen, p);
            }
            Color tc = Enabled ? ink : Art.Mix(ink, Art.Bg, 0.5f);
            TextRenderer.DrawText(g, Text, Font, ClientRectangle, tc,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
        }
    }
}
