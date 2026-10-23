using System.Security.Cryptography;
using System.Text;
namespace Orbit.Core;
public static class RemoteSecurity
{
    public static Uri Address(string value)
    {
        if(!Uri.TryCreate(value,UriKind.Absolute,out var uri)||uri.Scheme!="https"||uri.UserInfo.Length>0||uri.AbsolutePath!="/"||uri.Query.Length>0||uri.Fragment.Length>0)throw new ArgumentException("Enter an HTTPS machine origin, e.g. https://192.168.1.20:43129");return uri;
    }
    public static string Fingerprint(string value)
    {var clean=value.Replace(":","").ToUpperInvariant();if(clean.Length!=64||!clean.All(Uri.IsHexDigit))throw new ArgumentException("Enter the complete SHA-256 host fingerprint.");return clean;}
    public static bool TokenMatches(string actual,string expected)
    {var a=Encoding.UTF8.GetBytes(actual);var b=Encoding.UTF8.GetBytes(expected);return a.Length==b.Length&&a.Length>20&&CryptographicOperations.FixedTimeEquals(a,b);}
}
public sealed class ControlLease(Func<DateTimeOffset>? clock=null)
{
    private readonly Func<DateTimeOffset> now=clock??(()=>DateTimeOffset.UtcNow);
    public string AccountId {get;private set;}="";
    private string token="";
    public DateTimeOffset Until {get;private set;}
    public bool Active=>token.Length>0&&now()<Until;
    public string Acquire(string account)
    {if(Active)throw new InvalidOperationException("Another controller already holds this host’s input lease.");AccountId=account;token=Convert.ToHexString(RandomNumberGenerator.GetBytes(32));Until=now().AddSeconds(8);return token;}
    public bool Accept(string account,string candidate)
    {if(!Active||AccountId!=account||!RemoteSecurity.TokenMatches(candidate,token))return false;Until=now().AddSeconds(8);return true;}
    public void Release(){AccountId="";token="";Until=DateTimeOffset.MinValue;}
}
