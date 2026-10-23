using System.Net;
using System.Text.Json;
using Orbit.Core;

public static class ArtworkTests
{
    private static readonly byte[] Png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==");
    private static void Assert(bool value){if(!value)throw new Exception("Artwork assertion failed.");}
    private static HttpResponseMessage Json(object body)=>new(HttpStatusCode.OK){Content=new StringContent(JsonSerializer.Serialize(body))};
    private sealed class Handler(Func<HttpRequestMessage,HttpResponseMessage> reply):HttpMessageHandler
    {protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct){ct.ThrowIfCancellationRequested();return Task.FromResult(reply(request));}}
    private static HttpResponseMessage Standard(HttpRequestMessage req)
    {
        var path=req.RequestUri!.AbsolutePath;
        Assert(!req.Headers.Contains("Cookie")&&!req.Headers.Contains("Authorization"));
        if(path.Contains("/places/"))return Json(new{universeId=99});
        if(req.RequestUri.Host=="games.roblox.com")return Json(new{data=new[]{new{id=98,name="Wrong game",creator=new{name="Wrong"}},new{id=99,name="Actual game",creator=new{name="Creator"}}}});
        if(path.Contains("multiget"))return Json(new{data=new[]{new{universeId=99,thumbnails=new[]{new{state="Completed",imageUrl="https://tr.rbxcdn.com/wide.png"}}}}});
        if(req.RequestUri.Host=="thumbnails.roblox.com")return Json(new{data=new[]{new{targetId=98,state="Completed",imageUrl="https://evil.test/wrong"},new{targetId=99,state="Completed",imageUrl="https://tr.rbxcdn.com/icon.png"}}});
        return new(HttpStatusCode.OK){Content=new ByteArrayContent(Png)};
    }
    public static void Register(Action<string,Func<Task>> add)
    {
        add("game art resolves place to universe, matches IDs and caches images",async()=>
        {var calls=0;using var http=new HttpClient(new Handler(req=>{calls++;return Standard(req);}));var service=new RobloxArtwork(http);var a=await service.Game("123");var b=await service.Game("123");Assert(a.Name=="Actual game"&&a.Creator=="Creator"&&a.Icon.SequenceEqual(Png)&&a.Thumbnail!.SequenceEqual(Png)&&ReferenceEquals(a,b)&&calls==6);});
        add("concurrent game panels share one artwork request",async()=>
        {var calls=0;using var http=new HttpClient(new Handler(req=>{calls++;return Standard(req);}));var service=new RobloxArtwork(http);await Task.WhenAll(Enumerable.Range(0,12).Select(_=>service.Game("123")));Assert(calls==6);});
        add("failed artwork requests can be retried",async()=>
        {var failed=true;using var http=new HttpClient(new Handler(req=>failed?new(HttpStatusCode.ServiceUnavailable):Standard(req)));var service=new RobloxArtwork(http);try{await service.Game("123");throw new Exception("Failure accepted");}catch(HttpRequestException){}failed=false;Assert((await service.Game("123")).Name=="Actual game");});
        add("pending Roblox images are polled before download",async()=>
        {var icons=0;using var http=new HttpClient(new Handler(req=>{if(req.RequestUri!.AbsolutePath.EndsWith("/icons")&&++icons==1)return Json(new{data=new[]{new{targetId=99,state="Pending",imageUrl=(string?)null}}});return Standard(req);}));var result=await new RobloxArtwork(http).Game("123");Assert(icons==2&&result.Icon.Length>0);});
        add("unavailable wide thumbnail falls back to the game icon",async()=>
        {using var http=new HttpClient(new Handler(req=>req.RequestUri!.AbsolutePath.Contains("multiget")?Json(new{data=Array.Empty<object>()}):Standard(req)));var result=await new RobloxArtwork(http).Game("123");Assert(result.Icon.Length>0&&result.Thumbnail is null);});
        add("image CDN validation rejects spoofed hosts and non-HTTPS addresses",()=>
        {foreach(var url in new[]{"http://tr.rbxcdn.com/x","https://rbxcdn.com.evil.test/x","https://user@tr.rbxcdn.com/x","https://tr.rbxcdn.com:4433/x","https://evil.test/x"}){try{RobloxArtwork.ImageUri(url);throw new Exception("Unsafe URL accepted");}catch(InvalidDataException){}}Assert(RobloxArtwork.ImageUri("https://tr.rbxcdn.com/x").Host=="tr.rbxcdn.com");return Task.CompletedTask;});
        add("oversized image bodies are rejected before decoding",async()=>
        {using var http=new HttpClient(new Handler(req=>{if(req.RequestUri!.Host=="tr.rbxcdn.com"){var response=new HttpResponseMessage(HttpStatusCode.OK){Content=new ByteArrayContent(Png)};response.Content.Headers.ContentLength=4_000_001;return response;}return Standard(req);}));try{await new RobloxArtwork(http).Game("123");throw new Exception("Oversize accepted");}catch(InvalidDataException){}});
        add("avatar uses public headshots and caches the decoded bytes",async()=>
        {var calls=0;using var http=new HttpClient(new Handler(req=>{calls++;if(req.RequestUri!.Host=="thumbnails.roblox.com"){Assert(req.RequestUri.AbsolutePath.EndsWith("avatar-headshot"));return Json(new{data=new[]{new{targetId=123,state="Completed",imageUrl="https://tr.rbxcdn.com/avatar.png"}}});}return new(HttpStatusCode.OK){Content=new ByteArrayContent(Png)};}));var art=new RobloxArtwork(http);await art.Avatar(123);await art.Avatar(123);Assert(calls==2);});
        add("non-numeric Roblox IDs never trigger network requests",async()=>
        {using var http=new HttpClient(new Handler(_=>throw new Exception("Unexpected network")));try{await new RobloxArtwork(http).Game("../123");throw new Exception("ID accepted");}catch(ArgumentException){}});
    }
}
