using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
namespace Orbit.Desktop;
// Only the sign-in content is WebView2. The Orbit workspace and its services are native C#.
public sealed class RobloxSignIn : Window
{
    private readonly WebView2 browser = new();
    private readonly TextBlock status = new() { Text = "Opening a separate Roblox sign-in session…", Margin = new(16), TextWrapping = TextWrapping.Wrap };
    private readonly string profile = Path.Combine(Path.GetTempPath(), "Orbit-SignIn-" + Guid.NewGuid());
    private bool disposed;
    public string? Session { get; private set; }
    public RobloxSignIn(Window owner)
    {
        Owner = owner; Title = "Roblox sign-in · Orbit"; Width = 860; Height = 720; WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var panel = new DockPanel(); var footer = new StackPanel { Margin = new(12), Orientation = Orientation.Horizontal };
        var finish = new Button { Content = "Finish sign-in" }; finish.Click += Finish;
        var cancel = new Button { Content = "Cancel", IsCancel = true }; footer.Children.Add(finish); footer.Children.Add(cancel);
        DockPanel.SetDock(footer, Dock.Bottom); panel.Children.Add(footer); DockPanel.SetDock(status, Dock.Top); panel.Children.Add(status); panel.Children.Add(browser); Content = panel;
        Loaded += Initialize; Closed += Cleanup;
    }
    private async void Initialize(object sender, RoutedEventArgs e)
    {
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(userDataFolder: profile);
            if (disposed) return;
            await browser.EnsureCoreWebView2Async(env);
            if (disposed) return;
            browser.CoreWebView2.Settings.AreDevToolsEnabled = false;
            browser.CoreWebView2.Settings.IsPasswordAutosaveEnabled = false;
            browser.CoreWebView2.Settings.IsGeneralAutofillEnabled = false;
            browser.CoreWebView2.Settings.IsWebMessageEnabled = false;
            browser.CoreWebView2.Settings.AreHostObjectsAllowed = false;
            browser.CoreWebView2.NewWindowRequested += (_, args) => args.Handled = true;
            browser.CoreWebView2.DownloadStarting += (_, args) => args.Cancel = true;
            browser.CoreWebView2.NavigationStarting += (_, args) =>
            {
                if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri) || uri.Scheme != "https" || !(uri.Host == "roblox.com" || uri.Host.EndsWith(".roblox.com", StringComparison.OrdinalIgnoreCase))) args.Cancel = true;
            };
            browser.CoreWebView2.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
            browser.CoreWebView2.Navigate("https://www.roblox.com/login");
            status.Text = "Sign in directly with Roblox, including any verification. Then choose Finish sign-in. This browser profile is separate from your normal browser.";
        }
        catch (Exception) { if (!disposed) status.Text = "Sign-in could not open. Install the Microsoft Edge WebView2 Runtime, or use Add account → Paste session instead."; }
    }
    private async void Finish(object sender, RoutedEventArgs e)
    {
        try
        {
            if (browser.CoreWebView2 is null) return;
            var cookies = await browser.CoreWebView2.CookieManager.GetCookiesAsync("https://www.roblox.com");
            if (disposed) return;
            Session = cookies.FirstOrDefault(c => c.Name == ".ROBLOSECURITY" && (c.Domain.TrimStart('.') == "roblox.com" || c.Domain.TrimStart('.') == "www.roblox.com"))?.Value;
            if (string.IsNullOrWhiteSpace(Session)) { status.Text = "Complete Roblox sign-in first. No session was found."; return; }
            browser.CoreWebView2.CookieManager.DeleteAllCookies(); DialogResult = true;
        }
        catch (Exception) { if (!disposed) status.Text = "The session could not be read. Complete sign-in and try again."; }
    }
    private async void Cleanup(object? sender, EventArgs e)
    {
        disposed = true;
        try { browser.CoreWebView2?.CookieManager.DeleteAllCookies(); } catch (InvalidOperationException) { }
        browser.Dispose();
        for (var i = 0; i < 10; i++)
        {
            try { if (Directory.Exists(profile)) Directory.Delete(profile, true); return; }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { await Task.Delay(300); }
        }
        // WebView2 shutdown can briefly retain file handles. Its profile is OS-protected in the temp folder;
        // clearing cookies before success also prevents a completed sign-in persisting there.
    }
}
