using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using Orbit.Core;
public static class NativeUpdateTests
{
    private sealed class Handler(Func<HttpRequestMessage,HttpResponseMessage> reply):HttpMessageHandler
    {protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)=>Task.FromResult(reply(request));}
    private static object Release(string tag,bool draft=false,bool prerelease=false,bool complete=true)=>new
    {
        tag_name=tag,draft,prerelease,assets=(complete?new[]{"Orbit-Native-win-x64.zip","Orbit-Native-win-x64.zip.sha256"}:new[]{"Orbit-Native-Setup.exe"}).Select(name=>new{name,browser_download_url=$"https://github.com/ACABadAngel/Orbit-Roblox-Account-Manager/releases/download/{tag}/{name}"}).ToArray()
    };
    private static HttpClient Client(params object[] releases)=>new(new Handler(_=>new(HttpStatusCode.OK){Content=new StringContent(JsonSerializer.Serialize(releases))}));
    private static void Assert(bool value){if(!value)throw new Exception("Native update assertion failed.");}
    public static void Register(Action<string,Func<Task>> add)
    {
        add("installed 0.6.1 discovers the published native patch on stable",async()=>
        {using var client=Client(Release("native-v0.6.9",draft:true),Release("native-v0.6.4-beta.1",prerelease:true),Release("v99.0.0"),Release("native-v0.6.2"));var offer=await NativeUpdate.Check(client,new(0,6,1,0),"stable",default);Assert(offer?.Tag=="native-v0.6.2"&&offer.Version=="0.6.2");});
        add("beta channel can see native prereleases",async()=>
        {using var client=Client(Release("native-v0.6.3-beta.1",prerelease:true));Assert((await NativeUpdate.Check(client,new(0,6,1),"beta",default))?.Tag=="native-v0.6.3-beta.1");});
        add("draft and incomplete native releases never become update offers",async()=>
        {using var client=Client(Release("native-v0.6.3",draft:true),Release("native-v0.6.2",complete:false));Assert(await NativeUpdate.Check(client,new(0,6,1),"stable",default) is null);});
        add("current native versions do not offer older or identical builds",async()=>
        {using var client=Client(Release("native-v0.6.2"),Release("native-v0.6.1"));Assert(await NativeUpdate.Check(client,new(0,6,2,0),"stable",default) is null);});
        add("native update downloads are verified against the published checksum",async()=>
        {
            var bytes=new byte[]{1,2,3,4};var correct=true;var folder=Path.Combine(Path.GetTempPath(),"orbit-update-test-"+Guid.NewGuid());
            using var client=new HttpClient(new Handler(req=>new(HttpStatusCode.OK){Content=req.RequestUri!.AbsolutePath.EndsWith(".sha256")?new StringContent(correct?Convert.ToHexString(SHA256.HashData(bytes)):new string('0',64)):new ByteArrayContent(bytes)}));
            var offer=new UpdateOffer("native-v0.6.2","0.6.2","https://github.com/ACABadAngel/Orbit-Roblox-Account-Manager/releases/download/native-v0.6.2/app.zip","https://github.com/ACABadAngel/Orbit-Roblox-Account-Manager/releases/download/native-v0.6.2/app.zip.sha256");
            try{var path=await NativeUpdate.Download(client,offer,folder,default);Assert(File.ReadAllBytes(path).SequenceEqual(bytes));correct=false;try{await NativeUpdate.Download(client,offer,folder,default);throw new Exception("Bad update checksum accepted");}catch(InvalidDataException){}}
            finally{if(Directory.Exists(folder))Directory.Delete(folder,true);}
        });
    }
}
