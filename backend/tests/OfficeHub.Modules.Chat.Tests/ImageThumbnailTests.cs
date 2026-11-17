using OfficeHub.BuildingBlocks.Imaging;
using SkiaSharp;

namespace OfficeHub.Modules.Chat.Tests;

/// <summary>Ảnh thu nhỏ cho trợ lý AI xem tệp chat (TEST-151, tool MCP view_attachment).</summary>
public class ImageThumbnailTests
{
    private static byte[] Encode(int w, int h, SKEncodedImageFormat format, SKColor fill)
    {
        using var bmp = new SKBitmap(new SKImageInfo(w, h, SKColorType.Rgba8888, SKAlphaType.Premul));
        bmp.Erase(fill);
        using var data = bmp.Encode(format, 90);
        return data.ToArray();
    }

    private static SKBitmap Decode(byte[] jpeg) => SKBitmap.Decode(jpeg) ?? throw new InvalidOperationException("không giải mã được JPEG");

    [Fact]
    public void Large_png_is_shrunk_to_1280_long_side_as_jpeg_with_white_background()
    {
        var r = ImageThumbnail.ToJpeg(new MemoryStream(Encode(3000, 1500, SKEncodedImageFormat.Png, SKColors.Transparent)));

        Assert.NotNull(r);
        Assert.Equal((1280, 640), (r.Width, r.Height));
        Assert.Equal("image/jpeg", r.ContentType);
        Assert.Equal([0xFF, 0xD8], r.Data[..2]); // SOI của JPEG
        using var back = Decode(r.Data);
        Assert.Equal((1280, 640), (back.Width, back.Height));
        var px = back.GetPixel(10, 10);
        Assert.True(px.Red > 240 && px.Green > 240 && px.Blue > 240, $"nền trong suốt phải thành trắng, được {px}");
    }

    [Fact]
    public void Small_image_keeps_its_size()
    {
        var r = ImageThumbnail.ToJpeg(new MemoryStream(Encode(200, 100, SKEncodedImageFormat.Jpeg, SKColors.Red)));
        Assert.NotNull(r);
        Assert.Equal((200, 100), (r.Width, r.Height));
    }

    [Fact]
    public void Custom_max_side_is_respected()
    {
        var r = ImageThumbnail.ToJpeg(new MemoryStream(Encode(1000, 2000, SKEncodedImageFormat.Jpeg, SKColors.Blue)), maxSide: 256);
        Assert.NotNull(r);
        Assert.Equal((128, 256), (r.Width, r.Height));
    }

    [Fact]
    public void Exif_rotated_photo_is_turned_upright()
    {
        // Ảnh điện thoại dựng đứng: điểm ảnh lưu 400 × 200 + EXIF Orientation = 6 (xoay 90° theo chiều kim đồng hồ khi hiển thị)
        var jpeg = WithExifOrientation(Encode(400, 200, SKEncodedImageFormat.Jpeg, SKColors.Green), 6);
        var r = ImageThumbnail.ToJpeg(new MemoryStream(jpeg));
        Assert.NotNull(r);
        Assert.Equal((200, 400), (r.Width, r.Height));
    }

    [Fact]
    public void Not_an_image_returns_null()
    {
        Assert.Null(ImageThumbnail.ToJpeg(new MemoryStream("%PDF-1.7 không phải ảnh"u8.ToArray())));
        Assert.Null(ImageThumbnail.ToJpeg(new MemoryStream([])));
    }

    [Theory]
    [InlineData(3000, 1500, 1280, 1280, 640)]
    [InlineData(1500, 3000, 1280, 640, 1280)]
    [InlineData(1280, 10, 1280, 1280, 10)]
    [InlineData(5000, 1, 1280, 1280, 1)] // tối thiểu 1px
    [InlineData(800, 600, 1280, 800, 600)]
    public void Fit_keeps_aspect_ratio(int w, int h, int max, int ew, int eh) => Assert.Equal((ew, eh), ImageThumbnail.Fit(w, h, max));

    /// <summary>Chèn đoạn APP1 Exif (TIFF big-endian, một thẻ Orientation) ngay sau SOI.</summary>
    private static byte[] WithExifOrientation(byte[] jpeg, ushort orientation)
    {
        byte[] tiff =
        [
            (byte)'M', (byte)'M', 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08, // header, IFD0 ở offset 8
            0x00, 0x01,                                               // 1 thẻ
            0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01,           // Orientation, SHORT, count 1
            (byte)(orientation >> 8), (byte)orientation, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,                                   // không có IFD kế
        ];
        var payload = "Exif\0\0"u8.ToArray().Concat(tiff).ToArray();
        var len = payload.Length + 2;
        byte[] app1 = [0xFF, 0xE1, (byte)(len >> 8), (byte)len, .. payload];
        return [.. jpeg[..2], .. app1, .. jpeg[2..]];
    }
}
