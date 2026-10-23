using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
namespace Orbit.Desktop;
public static class GameCapture
{
    [DllImport("user32.dll")]private static extern bool PrintWindow(nint h,nint dc,uint flags);
    public static byte[]? Jpeg(nint handle,int height=720)
    {
        if(handle==0||!OrbitWindow.GetClientRect(handle,out var rect)||rect.Right<=0||rect.Bottom<=0||(long)rect.Right*rect.Bottom>16_000_000)return null;
        using var original=new Bitmap(rect.Right,rect.Bottom);using(var graphics=Graphics.FromImage(original)){var dc=graphics.GetHdc();try{if(!PrintWindow(handle,dc,3))return null;}finally{graphics.ReleaseHdc(dc);}}
        var ratio=Math.Min(1,height/(double)rect.Bottom);using var scaled=new Bitmap(original,new Size(Math.Max(1,(int)(rect.Right*ratio)),Math.Max(1,(int)(rect.Bottom*ratio))));using var output=new MemoryStream();var codec=ImageCodecInfo.GetImageEncoders().First(c=>c.FormatID==ImageFormat.Jpeg.Guid);using var parameters=new EncoderParameters(1);parameters.Param[0]=new EncoderParameter(System.Drawing.Imaging.Encoder.Quality,70L);scaled.Save(output,codec,parameters);if(output.Length>4_000_000)return null;return output.ToArray();
    }
}
