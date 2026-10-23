using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;
namespace Orbit.Desktop;
public static class ProtocolPipe
{
    private static string Name=>"Orbit.Native."+Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Environment.UserDomainName+"\\"+Environment.UserName)))[..20];
    public static async Task Send(string uri)
    {var valid=ProtocolIntegration.ValidateLaunch(uri);using var pipe=new NamedPipeClientStream(".",Name,PipeDirection.Out,PipeOptions.Asynchronous);using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(4));await pipe.ConnectAsync(timeout.Token);var bytes=Encoding.UTF8.GetBytes(valid);await pipe.WriteAsync(BitConverter.GetBytes(bytes.Length),timeout.Token);await pipe.WriteAsync(bytes,timeout.Token);}
    public static async Task Listen(Func<string,Task> handle,CancellationToken ct)
    {
        while(!ct.IsCancellationRequested)
        {
            try
            {using var pipe=new NamedPipeServerStream(Name,PipeDirection.In,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous|PipeOptions.CurrentUserOnly);await pipe.WaitForConnectionAsync(ct);using var request=CancellationTokenSource.CreateLinkedTokenSource(ct);request.CancelAfter(TimeSpan.FromSeconds(5));var length=new byte[4];await pipe.ReadExactlyAsync(length,request.Token);var size=BitConverter.ToInt32(length);if(size is <1 or >20000)continue;var payload=new byte[size];await pipe.ReadExactlyAsync(payload,request.Token);await handle(Encoding.UTF8.GetString(payload));}
            catch(Exception e)when(e is IOException or OperationCanceledException or ArgumentException){if(ct.IsCancellationRequested)return;}
        }
    }
}
