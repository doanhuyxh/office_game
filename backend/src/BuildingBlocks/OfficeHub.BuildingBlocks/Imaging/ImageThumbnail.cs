using SkiaSharp;

namespace OfficeHub.BuildingBlocks.Imaging;

/// <summary>
/// Thu nhỏ ảnh (JPEG / PNG / WebP / GIF khung đầu) thành JPEG cạnh dài ≤ <c>maxSide</c> — để trợ lý AI xem ảnh tệp đính kèm (TEST-151) mà không
/// tốn token cho ảnh gốc. Thư viện: SkiaSharp (MIT; native linux-musl cho image Alpine qua SkiaSharp.NativeAssets.Linux.NoDependencies) —
/// không chọn ImageSharp vì giấy phép Six Labors Split License đòi mua bản thương mại khi doanh thu công ty ≥ 1 triệu USD / năm.
/// <para>
/// An toàn: ảnh quá <see cref="MaxPixels"/> điểm ảnh (bom giải nén) hoặc không giải mã được → null; giải mã thu nhỏ sẵn khi codec hỗ trợ
/// (JPEG 1/2–1/8) để bớt RAM; xoay theo EXIF (ảnh điện thoại); nền trong suốt → trắng.
/// </para>
/// </summary>
public static class ImageThumbnail
{
    public const int DefaultMaxSide = 1280;
    public const int DefaultQuality = 80;
    /// <summary>Tối đa 40 triệu điểm ảnh (~160 MB RGBA khi codec không giải mã thu nhỏ được) — ảnh lớn hơn bị từ chối.</summary>
    public const long MaxPixels = 40_000_000;
    public const string ContentType = "image/jpeg";

    public sealed record Result(byte[] Data, int Width, int Height, string ContentType = ContentType);

    /// <summary>JPEG cạnh dài ≤ <paramref name="maxSide"/> (ảnh nhỏ hơn giữ nguyên kích thước); null = không phải ảnh / hỏng / quá lớn.</summary>
    public static Result? ToJpeg(Stream input, int maxSide = DefaultMaxSide, int quality = DefaultQuality)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(maxSide, 1);
        using var codec = SKCodec.Create(input);
        if (codec is null) return null;
        var src = codec.Info;
        if (src.Width <= 0 || src.Height <= 0 || (long)src.Width * src.Height > MaxPixels) return null;

        var scale = Math.Min(1f, (float)maxSide / Math.Max(src.Width, src.Height));
        var dims = scale < 1 ? codec.GetScaledDimensions(scale) : new SKSizeI(src.Width, src.Height);
        using var decoded = new SKBitmap(new SKImageInfo(dims.Width, dims.Height, SKColorType.Rgba8888, SKAlphaType.Premul));
        var r = codec.GetPixels(decoded.Info, decoded.GetPixels());
        if (r is not (SKCodecResult.Success or SKCodecResult.IncompleteInput)) return null;

        var (w, h) = Fit(src.Width, src.Height, maxSide);
        var origin = codec.EncodedOrigin;
        var swap = SwapsAxes(origin);
        var (outW, outH) = swap ? (h, w) : (w, h);
        using var output = new SKBitmap(new SKImageInfo(outW, outH, SKColorType.Rgba8888, SKAlphaType.Premul));
        using (var canvas = new SKCanvas(output))
        {
            canvas.Clear(SKColors.White);
            canvas.SetMatrix(OriginMatrix(origin, w, h));
            using var image = SKImage.FromBitmap(decoded);
            using var paint = new SKPaint();
            canvas.DrawImage(image, new SKRect(0, 0, w, h), new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear), paint);
        }
        using var data = output.Encode(SKEncodedImageFormat.Jpeg, Math.Clamp(quality, 1, 100));
        return data is null ? null : new Result(data.ToArray(), outW, outH);
    }

    /// <summary>Kích thước sau khi thu cạnh dài về ≤ <paramref name="maxSide"/>, giữ tỉ lệ, tối thiểu 1px.</summary>
    public static (int Width, int Height) Fit(int width, int height, int maxSide)
    {
        var longest = Math.Max(width, height);
        if (longest <= maxSide) return (width, height);
        var k = (double)maxSide / longest;
        return (Math.Max(1, (int)Math.Round(width * k)), Math.Max(1, (int)Math.Round(height * k)));
    }

    internal static bool SwapsAxes(SKEncodedOrigin o) =>
        o is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;

    /// <summary>Ma trận đưa ảnh đã mã hoá (w × h) về hướng hiển thị theo EXIF — như SkEncodedOriginToMatrix của Skia.</summary>
    internal static SKMatrix OriginMatrix(SKEncodedOrigin o, int w, int h) => o switch
    {
        SKEncodedOrigin.TopRight => new SKMatrix(-1, 0, w, 0, 1, 0, 0, 0, 1),
        SKEncodedOrigin.BottomRight => new SKMatrix(-1, 0, w, 0, -1, h, 0, 0, 1),
        SKEncodedOrigin.BottomLeft => new SKMatrix(1, 0, 0, 0, -1, h, 0, 0, 1),
        SKEncodedOrigin.LeftTop => new SKMatrix(0, 1, 0, 1, 0, 0, 0, 0, 1),
        SKEncodedOrigin.RightTop => new SKMatrix(0, -1, h, 1, 0, 0, 0, 0, 1),
        SKEncodedOrigin.RightBottom => new SKMatrix(0, -1, h, -1, 0, w, 0, 0, 1),
        SKEncodedOrigin.LeftBottom => new SKMatrix(0, 1, 0, -1, 0, w, 0, 0, 1),
        _ => SKMatrix.Identity,
    };
}
