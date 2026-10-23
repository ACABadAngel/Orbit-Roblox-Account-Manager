using System.IO.Compression;
using Orbit.Core;
public static class ArchivePathTests
{
    private static byte[] Archive(params (string Path,string Content,int Attributes)[] entries)
    {
        using var output=new MemoryStream();
        using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true))foreach(var item in entries){var entry=zip.CreateEntry(item.Path);entry.ExternalAttributes=item.Attributes;using var writer=new StreamWriter(entry.Open());writer.Write(item.Content);}
        return output.ToArray();
    }
    private static string Root()=>Path.Combine(Path.GetTempPath(),"orbit-archive-regression-"+Guid.NewGuid());
    private static async Task Reject(byte[] bytes,string root)
    {using var stream=new MemoryStream(bytes);try{await Deployment.ExtractAsync(stream,root,100,default);}catch(InvalidDataException){return;}throw new Exception("Unsafe archive entry accepted.");}
    public static void Register(Action<string,Func<Task>> add)
    {
        add("real Roblox DOS folder markers extract inside the package root",async()=>
        {
            var root=Root();try{using var stream=new MemoryStream(Archive(("\\","",0x10),("\\abilities\\","",0x10),("\\abilities\\nested\\","",0x10),("abilities\\nested\\Animation.rbxm","play",0x20),("\\empty\\","",0x10)));await Deployment.ExtractAsync(stream,root,4,default);if(File.ReadAllText(Path.Combine(root,"abilities","nested","Animation.rbxm"))!="play"||!Directory.Exists(Path.Combine(root,"empty")))throw new Exception("Roblox directory entries were not mapped correctly.");}finally{if(Directory.Exists(root))Directory.Delete(root,true);}
        });
        add("a Roblox root directory marker can represent an empty package",async()=>
        {var root=Root();try{using var stream=new MemoryStream(Archive(("\\","",0x10)));await Deployment.ExtractAsync(stream,root,0,default);if(!Directory.Exists(root))throw new Exception("Package root missing.");}finally{if(Directory.Exists(root))Directory.Delete(root,true);}});
        add("rooted files, UNC names and traversal directory markers stay rejected",async()=>
        {
            var root=Root();try{foreach(var path in new[]{"\\evil.exe","/evil.exe","/absolute/","\\\\server\\share\\","\\..\\escape\\","\\nested\\..\\escape\\","\\C:\\escape\\"})await Reject(Archive((path,"",path.EndsWith('/')||path.EndsWith('\\')?0x10:0x20)),root);if(Directory.Exists(root))throw new Exception("An invalid path created the package root.");}finally{if(Directory.Exists(root))Directory.Delete(root,true);}
        });
        add("rooted directory markers require the DOS directory flag and zero data",async()=>
        {var root=Root();try{await Reject(Archive(("\\folder\\","",0x20)),root);await Reject(Archive(("\\folder\\","payload",0x10)),root);}finally{if(Directory.Exists(root))Directory.Delete(root,true);}});
        add("symbolic links cannot bypass directory marker validation",async()=>
        {var root=Root();try{await Reject(Archive(("\\","",unchecked((int)0xA1FF0010))),root);}finally{if(Directory.Exists(root))Directory.Delete(root,true);}});
        add("failed archive paths identify the offending entry",async()=>
        {var root=Root();try{using var stream=new MemoryStream(Archive(("../outside","x",0x20)));try{await Deployment.ExtractAsync(stream,root,1,default);}catch(InvalidDataException error){if(error.Message.Contains("../outside",StringComparison.Ordinal))return;throw new Exception("Archive error omitted its entry name.");}throw new Exception("Traversal was accepted.");}finally{if(Directory.Exists(root))Directory.Delete(root,true);}});
    }
}
