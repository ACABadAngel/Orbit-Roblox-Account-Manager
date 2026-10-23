using System.Net.Http;
using System.Text;
using System.Windows;
using Orbit.Core;
namespace Orbit.Desktop;
internal static class NativeRobloxInstallProbe
{
    // CI installs real public packages into an isolated folder. It never launches
    // Roblox or opens the user's workspace, accounts, sessions or machine host.
    public static async Task Run(App app,string outputDirectory)
    {
        app.ShutdownMode=ShutdownMode.OnExplicitShutdown;
        var root=Path.Combine(Path.GetTempPath(),"orbit-real-roblox-install-"+Guid.NewGuid());
        var log=new StringBuilder();var exitCode=0;string? last=null;
        Directory.CreateDirectory(outputDirectory);
        try
        {
            using var client=new HttpClient(new HttpClientHandler{AllowAutoRedirect=false,UseCookies=false}){Timeout=TimeSpan.FromMinutes(6),MaxResponseContentBufferSize=5_500_000};
            client.DefaultRequestHeaders.UserAgent.ParseAdd("Orbit-Native-Install-Compatibility-Probe");
            using var timeout=new CancellationTokenSource(TimeSpan.FromMinutes(10));
            var installer=new RobloxInstaller(client,root,PublisherVerifier.Roblox);
            var installed=await installer.EnsureAsync("live",true,false,new Progress<InstallProgress>(progress=>{if(progress.Message!=last){last=progress.Message;log.AppendLine(progress.Message);}}),timeout.Token);
            if(installer.Current()?.Version!=installed.Version||!File.Exists(installed.Executable))throw new InvalidDataException("Verified Roblox installation was not activated.");
            log.AppendLine("PASS: real Roblox Windows Player "+installed.Version+" downloaded from Roblox, package sizes/checksums verified, every ZIP extracted, Roblox Corporation Authenticode signature verified and current installation activated.");
            log.AppendLine("Extracted files: "+Directory.GetFiles(installed.Directory,"*",SearchOption.AllDirectories).Length);
            log.AppendLine("No Roblox game was launched; the account workspace was not opened.");
        }
        catch(Exception error){exitCode=1;log.AppendLine("FAIL real Roblox install: "+error);}
        finally{if(Directory.Exists(root))Directory.Delete(root,true);}
        await File.WriteAllTextAsync(Path.Combine(outputDirectory,"roblox-install.txt"),log.ToString());
        app.Shutdown(exitCode);
    }
}
