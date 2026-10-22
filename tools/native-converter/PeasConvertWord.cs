using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;

// Runs only the configured LibreOffice; no shell, inherited credentials, or network capabilities.
internal static class PeasConvertWord
{
    const uint Suspended = 4, UnicodeEnvironment = 0x400, ExtendedStartup = 0x80000, NoWindow = 0x08000000;
    const uint KillOnClose = 0x2000, JobMemory = 0x200, ActiveProcess = 8;
    const int TimeoutMs = 285000;
    static int Main(string[] args)
    {
        try
        {
            if (args.Length > 0 && args[0] == "--sandbox-probe") return Probe(args);
            if (args.Length > 0 && args[0] == "--sleep-probe")
            {
                File.WriteAllText(args[1], Process.GetCurrentProcess().Id.ToString());
                Thread.Sleep(Timeout.Infinite);
                return 0;
            }
            if (args.Length > 0 && args[0] == "--tree-probe")
            {
                Process.Start(new ProcessStartInfo(Self(), "--sleep-probe " + Quote(args[1])) { UseShellExecute = false, CreateNoWindow = true });
                Thread.Sleep(Timeout.Infinite);
                return 0;
            }
            if (args.Length == 1 && args[0] == "--identity") { Console.WriteLine(WindowsIdentity.GetCurrent().User.Value); return 0; }
            if (args.Length == 2 && args[0] == "--self-test") return SelfTest(CheckedPath(args[1], true));
            var engine = Environment.GetEnvironmentVariable("IMPORT_WINDOWS_SOFFICE_PATH");
            if (String.IsNullOrEmpty(engine) || !Path.IsPathRooted(engine) || !File.Exists(engine)) throw new InvalidOperationException("Configure an absolute IMPORT_WINDOWS_SOFFICE_PATH to soffice.com.");
            if (!String.Equals(Path.GetFileName(engine), "soffice.com", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("The native converter requires soffice.com.");
            RejectReparsePoints(engine);
            if (args.Length == 1 && args[0] == "--version")
            {
                Console.WriteLine("LibreOffice " + FileVersionInfo.GetVersionInfo(Path.Combine(Path.GetDirectoryName(engine), "soffice.bin")).ProductVersion);
                return 0;
            }
            // Accept exactly the existing worker contract, never arbitrary LibreOffice switches.
            if (args.Length != 10 || !args[0].StartsWith("-env:UserInstallation=", StringComparison.Ordinal) ||
                args[1] != "--headless" || args[2] != "--nologo" || args[3] != "--nodefault" || args[4] != "--norestore" ||
                args[5] != "--convert-to" || args[6] != "pdf:writer_pdf_Export" || args[7] != "--outdir") throw new InvalidOperationException("Unsupported conversion arguments.");
            var output = CheckedPath(args[8], true);
            var source = CheckedPath(args[9], false);
            if (!new[] { ".doc", ".docx" }.Contains(Path.GetExtension(source).ToLowerInvariant())) throw new InvalidOperationException("A Word source is required.");
            var profile = new Uri(args[0].Substring("-env:UserInstallation=".Length));
            if (!profile.IsFile || !String.Equals(Path.GetFullPath(profile.LocalPath).TrimEnd('\\'), Path.Combine(output, "profile"), StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Profile must be inside the job directory.");
            if (IsUnder(source, output) || IsUnder(output, Path.GetDirectoryName(source))) throw new InvalidOperationException("Source and output must be separate job directories.");
            Run(engine, args, output, source, TimeoutMs);
            return 0;
        }
        catch (Exception error)
        {
            // The worker logs this private diagnostic; public APIs expose only a bounded error code.
            Console.Error.WriteLine("Native conversion failed: " + error.Message);
            return 1;
        }
    }

    static string Self() { return Process.GetCurrentProcess().MainModule.FileName; }
    static string CheckedPath(string path, bool directory)
    {
        var root = Environment.GetEnvironmentVariable("IMPORT_STAGING_ROOT");
        if (String.IsNullOrEmpty(root) || !Path.IsPathRooted(root) || !Path.IsPathRooted(path)) throw new InvalidOperationException("Absolute staging paths are required.");
        var full = Path.GetFullPath(path).TrimEnd('\\');
        if (!IsUnder(full, Path.GetFullPath(root))) throw new InvalidOperationException("Path is outside import staging.");
        if (directory ? !Directory.Exists(full) : !File.Exists(full)) throw new FileNotFoundException("Staged path is missing.");
        RejectReparsePoints(full);
        return full;
    }
    static bool IsUnder(string path, string root) { return path.StartsWith(root.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase); }
    static void RejectReparsePoints(string path)
    {
        for (var item = path; !String.IsNullOrEmpty(item); item = Path.GetDirectoryName(item))
            if ((File.GetAttributes(item) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Reparse points are not allowed.");
    }
    static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        var slashes = 0;
        foreach (var c in value)
        {
            if (c == '\\') { slashes++; continue; }
            result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
            result.Append(c); slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }
    static void Check(bool success) { if (!success) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static void Grant(string path, SecurityIdentifier sid, FileSystemRights rights, bool inherit, List<Action> cleanup)
    {
        if (Directory.Exists(path))
        {
            var rule = new FileSystemAccessRule(sid, rights, inherit ? InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit : InheritanceFlags.None, PropagationFlags.None, AccessControlType.Allow);
            var acl = Directory.GetAccessControl(path); acl.AddAccessRule(rule); Directory.SetAccessControl(path, acl);
            cleanup.Add(() => { var current = Directory.GetAccessControl(path); current.RemoveAccessRuleSpecific(rule); Directory.SetAccessControl(path, current); });
        }
        else
        {
            var rule = new FileSystemAccessRule(sid, rights, AccessControlType.Allow);
            var acl = File.GetAccessControl(path); acl.AddAccessRule(rule); File.SetAccessControl(path, acl);
            cleanup.Add(() => { var current = File.GetAccessControl(path); current.RemoveAccessRuleSpecific(rule); File.SetAccessControl(path, current); });
        }
    }
    static void LowIntegrity(string directory)
    {
        IntPtr descriptor = IntPtr.Zero, sacl;
        try
        {
            Check(ConvertStringSecurityDescriptorToSecurityDescriptor("S:(ML;OICI;NW;;;LW)", 1, out descriptor, IntPtr.Zero));
            bool present, defaulted;
            Check(GetSecurityDescriptorSacl(descriptor, out present, out sacl, out defaulted));
            var error = SetNamedSecurityInfo(directory, 1, 0x10, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, sacl);
            if (error != 0) throw new Win32Exception((int)error);
        }
        finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
    }
    static void Run(string executable, string[] args, string output, string source, int timeout)
    {
        var profileName = "PeAS.Convert." + Guid.NewGuid().ToString("N");
        IntPtr sid = IntPtr.Zero, job = IntPtr.Zero, attributes = IntPtr.Zero, capabilities = IntPtr.Zero, environment = IntPtr.Zero;
        var process = new ProcessInformation();
        var cleanup = new List<Action>();
        bool profileCreated = false, attributesInitialized = false;
        try
        {
            Marshal.ThrowExceptionForHR(CreateAppContainerProfile(profileName, profileName, "PeAS isolated conversion", IntPtr.Zero, 0, out sid));
            profileCreated = true;
            var identity = new SecurityIdentifier(sid);
            Grant(output, identity, FileSystemRights.Modify, true, cleanup);
            LowIntegrity(output);
            // Traverse ancestors only; this does not grant access to other manuscripts.
            foreach (var file in new[] { source, executable }.Where(p => p != null))
            {
                Grant(file, identity, file == source ? FileSystemRights.Read : FileSystemRights.ReadAndExecute, false, cleanup);
                for (var parent = Path.GetDirectoryName(file); !String.IsNullOrEmpty(parent); parent = Path.GetDirectoryName(parent))
                    Grant(parent, identity, FileSystemRights.Traverse, false, cleanup);
            }
            job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero);
            var limits = new ExtendedLimits();
            limits.Basic.LimitFlags = KillOnClose | JobMemory | ActiveProcess;
            limits.Basic.ActiveProcessLimit = 128;
            limits.JobMemoryLimit = new UIntPtr(1024UL * 1024 * 1024);
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))));
            IntPtr bytes = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref bytes);
            attributes = Marshal.AllocHGlobal(bytes);
            Check(InitializeProcThreadAttributeList(attributes, 1, 0, ref bytes));
            attributesInitialized = true;
            var security = new SecurityCapabilities { AppContainerSid = sid };
            capabilities = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SecurityCapabilities)));
            Marshal.StructureToPtr(security, capabilities, false);
            Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20009), capabilities, new IntPtr(Marshal.SizeOf(typeof(SecurityCapabilities))), IntPtr.Zero, IntPtr.Zero));
            var startup = new StartupInfoEx();
            startup.Startup.cb = Marshal.SizeOf(typeof(StartupInfoEx));
            startup.Attributes = attributes;
            var windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            var variables = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
                { "SystemRoot", windows }, { "WINDIR", windows }, { "TEMP", output }, { "TMP", output },
                { "APPDATA", output }, { "LOCALAPPDATA", output }, { "USERPROFILE", output },
                { "PATH", Path.GetDirectoryName(executable) + ";" + Path.Combine(windows, "System32") }
            };
            environment = Marshal.StringToHGlobalUni(String.Join("\0", variables.Select(pair => pair.Key + "=" + pair.Value)) + "\0\0");
            var command = new StringBuilder(Quote(executable) + " " + String.Join(" ", args.Select(Quote)));
            Check(CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, false, Suspended | UnicodeEnvironment | ExtendedStartup | NoWindow, environment, output, ref startup, out process));
            Check(AssignProcessToJobObject(job, process.Process));
            if (ResumeThread(process.Thread) == UInt32.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error());
            var clock = Stopwatch.StartNew();
            while (true)
            {
                var accounting = new Accounting();
                Check(QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
                if (accounting.ActiveProcesses == 0) break;
                if (clock.ElapsedMilliseconds >= timeout) throw new TimeoutException("Conversion exceeded its time limit; the process tree was terminated.");
                Thread.Sleep(50);
            }
            uint exit;
            Check(GetExitCodeProcess(process.Process, out exit));
            if (exit != 0) throw new InvalidOperationException("Converter exited unsuccessfully (" + exit + ").");
        }
        finally
        {
            if (job != IntPtr.Zero) { TerminateJobObject(job, 1); CloseHandle(job); }
            // Assignment failure must also terminate the still-suspended process.
            if (process.Process != IntPtr.Zero) { TerminateProcess(process.Process, 1); WaitForSingleObject(process.Process, 5000); CloseHandle(process.Process); }
            if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
            Exception cleanupError = null;
            for (int i = cleanup.Count - 1; i >= 0; i--)
                try { cleanup[i](); } catch (Exception error) { cleanupError = error; }
            if (attributes != IntPtr.Zero) { if (attributesInitialized) DeleteProcThreadAttributeList(attributes); Marshal.FreeHGlobal(attributes); }
            if (capabilities != IntPtr.Zero) Marshal.FreeHGlobal(capabilities);
            if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
            int deleted = profileCreated ? DeleteAppContainerProfile(profileName) : 0;
            if (sid != IntPtr.Zero) FreeSid(sid);
            if (cleanupError != null) throw new InvalidOperationException("Native sandbox ACL cleanup failed.", cleanupError);
            Marshal.ThrowExceptionForHR(deleted);
        }
    }
    static int Probe(string[] args)
    {
        // No production credential is used as a canary.
        bool readDenied = false, writeDenied = false, networkDenied = false, internetDenied = false;
        try { File.ReadAllText(args[2]); } catch (UnauthorizedAccessException) { readDenied = true; }
        try { File.WriteAllText(args[2], "changed"); } catch (UnauthorizedAccessException) { writeDenied = true; }
        try { using (var client = new TcpClient()) { client.Connect(IPAddress.Loopback, Int32.Parse(args[3])); } }
        catch (SocketException error) { networkDenied = error.SocketErrorCode == SocketError.AccessDenied; }
        using (var socket = new TcpClient())
        {
            try
            {
                var connection = socket.BeginConnect(IPAddress.Parse("192.0.2.1"), 9, null, null);
                using (connection.AsyncWaitHandle)
                    if (connection.AsyncWaitHandle.WaitOne(1000)) socket.EndConnect(connection);
            }
            catch (SocketException error) { internetDenied = error.SocketErrorCode == SocketError.AccessDenied; }
        }
        bool environmentClean = Environment.GetEnvironmentVariable("PEAS_CONVERTER_CANARY") == null;
        File.WriteAllText(Path.Combine(args[1], "probe.txt"), readDenied + "," + writeDenied + "," + networkDenied + "," + internetDenied + "," + environmentClean);
        return readDenied && writeDenied && networkDenied && internetDenied && environmentClean ? 0 : 1;
    }
    static int SelfTest(string root)
    {
        var secret = Path.Combine(root, "canary.txt");
        var output = Path.Combine(root, "sandbox");
        Directory.CreateDirectory(output);
        File.WriteAllText(secret, "synthetic-canary");
        var oldCanary = Environment.GetEnvironmentVariable("PEAS_CONVERTER_CANARY");
        Environment.SetEnvironmentVariable("PEAS_CONVERTER_CANARY", "must-not-reach-child");
        var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        try
        {
            Run(Self(), new[] { "--sandbox-probe", output, secret, ((IPEndPoint)listener.LocalEndpoint).Port.ToString() }, output, null, 15000);
            if (File.ReadAllText(secret) != "synthetic-canary" || File.ReadAllText(Path.Combine(output, "probe.txt")) != "True,True,True,True,True") throw new InvalidOperationException("Isolation probe failed.");
            var pidFile = Path.Combine(output, "child.pid");
            bool timedOut = false;
            try { Run(Self(), new[] { "--tree-probe", pidFile }, output, null, 3000); }
            catch (TimeoutException) { timedOut = true; }
            if (!timedOut || !File.Exists(pidFile)) throw new InvalidOperationException("Process-tree probe failed to start.");
            int pid = Int32.Parse(File.ReadAllText(pidFile));
            try { using (var child = Process.GetProcessById(pid)) { if (!child.HasExited && !child.WaitForExit(5000)) throw new InvalidOperationException("A converter child survived termination."); } }
            catch (ArgumentException) { /* no process remains */ }
            Console.WriteLine("Native isolation passed: private canary denied, network denied, environment scrubbed, job output writable, process tree terminated.");
            return 0;
        }
        finally { listener.Stop(); Environment.SetEnvironmentVariable("PEAS_CONVERTER_CANARY", oldCanary); }
    }

    [StructLayout(LayoutKind.Sequential)] struct SecurityCapabilities { public IntPtr AppContainerSid, Capabilities; public uint CapabilityCount, Reserved; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct StartupInfo { public int cb; public string Reserved, Desktop, Title; public uint X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags; public ushort ShowWindow, Reserved2; public IntPtr ReservedBytes, Input, Output, Error; }
    [StructLayout(LayoutKind.Sequential)] struct StartupInfoEx { public StartupInfo Startup; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInformation { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits { public long ProcessTime, JobTime; public uint LimitFlags; public UIntPtr MinimumWorkingSet, MaximumWorkingSet; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits { public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemory, PeakJobMemory; }
    [StructLayout(LayoutKind.Sequential)] struct Accounting { public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime; public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses; }
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int CreateAppContainerProfile(string name, string display, string description, IntPtr capabilities, uint count, out IntPtr sid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int DeleteAppContainerProfile(string name);
    [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr sid);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text, uint revision, out IntPtr descriptor, IntPtr size);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetSecurityDescriptorSacl(IntPtr descriptor, out bool present, out IntPtr sacl, out bool defaulted);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)] static extern uint SetNamedSecurityInfo(string name, int type, uint information, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int information, ref ExtendedLimits limits, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int information, out Accounting accounting, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcess(string application, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInformation process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
}
