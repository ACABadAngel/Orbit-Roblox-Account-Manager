using System.IO.Compression;
using Orbit.Core;

public static class NativeReleaseProbe
{
    // Uses the unchanged updater from installed 0.6.1, without a GitHub token.
    public static async Task<int> Run(string expectedVersion)
    {
        var folder=Path.Combine(Path.GetTempPath(),"orbit-published-update-"+Guid.NewGuid());
        try
        {
            var expectedTag="native-v"+expectedVersion;
            var channel=expectedVersion.Contains('-')?"beta":"stable";
            using var client=new HttpClient{Timeout=TimeSpan.FromMinutes(5)};
            using var lifetime=new CancellationTokenSource(TimeSpan.FromMinutes(8));
            UpdateOffer? offer=null;
            for(var attempt=0;attempt<6;attempt++)
            {
                offer=await NativeUpdate.Check(client,new Version(0,6,1,0),channel,lifetime.Token);
                if(offer?.Tag==expectedTag)break;
                if(attempt<5)await Task.Delay(TimeSpan.FromSeconds(5),lifetime.Token);
            }
            if(offer?.Tag!=expectedTag)throw new InvalidDataException("Orbit 0.6.1 cannot discover "+expectedTag+" on the "+channel+" channel.");
            var archive=await NativeUpdate.Download(client,offer,folder,lifetime.Token);
            using var zip=ZipFile.OpenRead(archive);
            if(!zip.Entries.Any(e=>e.FullName=="Orbit.Native.exe"))throw new InvalidDataException("Published update is missing Orbit.Native.exe.");
            Console.WriteLine("PASS: installed Orbit 0.6.1 discovers "+offer.Version+", follows the public download, verifies SHA-256 and reads the portable update ZIP. No installer is required.");
            return 0;
        }
        catch(Exception e){Console.Error.WriteLine("FAIL published native update: "+e.Message);return 1;}
        finally{if(Directory.Exists(folder))Directory.Delete(folder,true);}
    }
}
