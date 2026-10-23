using System.Security.Cryptography;
using Orbit.Core;
public static class RobloxPackageProbe
{
    public static async Task<int> Run(string folder)
    {
        var root=Path.Combine(Path.GetTempPath(),"orbit-real-package-probe-"+Guid.NewGuid());
        try
        {
            var packages=Deployment.ParseManifest(await File.ReadAllTextAsync(Path.Combine(folder,"manifest.txt")));
            foreach(var package in packages)
            {
                await using var archive=File.OpenRead(Path.Combine(folder,package.Name));
                if(archive.Length!=package.PackedSize||!Convert.ToHexString(await MD5.HashDataAsync(archive)).Equals(package.Md5,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Checksum mismatch: "+package.Name);
                archive.Position=0;var relative=Deployment.Directories[package.Name];var target=relative.Length==0?root:Deployment.SafePath(root,relative);
                await Deployment.ExtractAsync(archive,target,package.UnpackedSize,default);Console.WriteLine("PASS real archive: "+package.Name);
            }
            Console.WriteLine($"PASS: {packages.Count} verified real Roblox packages extracted; {Directory.GetFiles(root,"*",SearchOption.AllDirectories).Length} files.");return 0;
        }
        catch(Exception error){Console.Error.WriteLine("FAIL real Roblox package extraction: "+error.Message);return 1;}
        finally{if(Directory.Exists(root))Directory.Delete(root,true);}
    }
}
