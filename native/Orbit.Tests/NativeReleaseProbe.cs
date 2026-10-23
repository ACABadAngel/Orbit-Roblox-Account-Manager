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
            var expected=Version.Parse(expectedVersion.Split('-')[0]);
            UpdateOffer? offer=null;var checkedVersions=new List<string>();
            foreach(var current in new[]{new Version(0,6,1,0),new Version(0,6,2,0)})
            {
                if(current>=expected)continue;
                for(var attempt=0;attempt<6;attempt++)
                {
                    offer=await NativeUpdate.Check(client,current,channel,lifetime.Token);
                    if(offer?.Tag==expectedTag)break;
                    if(attempt<5)await Task.Delay(TimeSpan.FromSeconds(5),lifetime.Token);
                }
                if(offer?.Tag!=expectedTag)throw new InvalidDataException("Orbit "+current.ToString(3)+" cannot discover "+expectedTag+" on the "+channel+" channel.");
                checkedVersions.Add(current.ToString(3));
            }
            if(offer is null)throw new InvalidDataException("No older native version was checked.");
            var archive=await NativeUpdate.Download(client,offer,folder,lifetime.Token);
            using var zip=ZipFile.OpenRead(archive);
            if(!zip.Entries.Any(e=>e.FullName=="Orbit.Native.exe"))throw new InvalidDataException("Published update is missing Orbit.Native.exe.");
            Console.WriteLine("PASS: installed Orbit "+string.Join(" / ",checkedVersions)+" discovers "+offer.Version+", follows the public download, verifies SHA-256 and reads the portable update ZIP. No installer is required.");
            return 0;
        }
        catch(Exception e){Console.Error.WriteLine("FAIL published native update: "+e.Message);return 1;}
        finally{if(Directory.Exists(folder))Directory.Delete(folder,true);}
    }
}
